import os, io, json, uuid, subprocess, tempfile
from typing import List, Dict, Any
from fastapi import FastAPI, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from pydub import AudioSegment
import requests

CLOVA_INVOKE_URL = os.getenv("CLOVA_INVOKE_URL")
CLOVA_API_KEY    = os.getenv("CLOVA_API_KEY")

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"]
)

# --- 유틸: FFmpeg 전처리 (하이패스 + 라우드니스 정규화) ---
def ffmpeg_preprocess(src_path: str, dst_path: str):
    # 80Hz 하이패스 + ITU-R BS.1770 loudnorm
    # 참고: 노이즈 억제는 RNNoise/플러그인 등을 추가로 물릴 수 있음 (옵션)
    # https://github.com/werman/noise-suppression-for-voice  (RNNoise 기반)  [oai_citation:1‡GitHub](https://github.com/werman/noise-suppression-for-voice?utm_source=chatgpt.com)
    cmd = [
        "ffmpeg", "-y", "-i", src_path,
        "-af", "highpass=f=80,loudnorm=I=-20:TP=-1.5:LRA=11",
        "-ar", "16000", "-ac", "1",        # 16kHz/mono
        "-c:a", "pcm_s16le",               # 16-bit PCM
        dst_path
    ]
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

# --- 세그먼트 분할 (긴 파일 안정성/정확도 향상) ---
def split_segments(wav_path: str, seg_ms: int = 60_000) -> List[str]:
    audio = AudioSegment.from_file(wav_path)
    segs = []
    for i in range(0, len(audio), seg_ms):
        chunk = audio[i:i+seg_ms]
        seg_path = wav_path.replace(".wav", f".seg{i//seg_ms}.wav")
        chunk.export(seg_path, format="wav")
        segs.append(seg_path)
    return segs

# --- 클로바 호출 ---
def call_clova_wav(wav_path: str, custom_words: List[str]) -> Dict[str, Any]:
    # 요청 파라미터: diarization(화자분리), timestamps, boosting(용어 가중치)
    # 'upload'형식(longsentence local)과 동일 계열의 Recognizer 엔드포인트 사용.  [oai_citation:2‡api.ncloud-docs.com](https://api.ncloud-docs.com/docs/en/ai-application-service-clovaspeech-longsentence-local?utm_source=chatgpt.com)
    with open(wav_path, "rb") as f:
        files = {
            'media': (os.path.basename(wav_path), f, 'audio/wav')
        }
        # 문서의 공통 헤더: X-CLOVASPEECH-API-KEY (Secret) 사용.  [oai_citation:3‡api.ncloud-docs.com](https://api.ncloud-docs.com/docs/en/ai-application-service-clovaspeech-shortsentence?utm_source=chatgpt.com)
        headers = {
            "X-CLOVASPEECH-API-KEY": CLOVA_API_KEY
        }
        params = {
            "language": "ko-KR",
            "completion": "sync",                 # 간단히 동기 처리. 길면 async로 토큰 받아 폴링 가능
            "diarization": {
                "enable": True,
                "speakerCountMin": 1,
                "speakerCountMax": 5
            },
            "enableTimestamp": True,
            "fullText": True,
            "boostings": [{"words": custom_words, "weight": 20}] if custom_words else []
        }
        data = {
            'params': (None, json.dumps(params), 'application/json; charset=utf-8')
        }
        res = requests.post(CLOVA_INVOKE_URL + "/upload", headers=headers, files={**files, **data}, timeout=120)
        res.raise_for_status()
        return res.json()

def flatten_result(res: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    클로바 응답에서 (스피커, 텍스트, 시작-끝 ms, confidence) 리스트로 변환
    실제 필드명은 계정/버전에 따라 약간 다를 수 있으므로 키 존재 체크를 준수.
    """
    items = []
    segments = res.get("segments") or res.get("results") or []
    for seg in segments:
        speaker = seg.get("speaker") or seg.get("spk", "S0")
        start = seg.get("startTime", seg.get("start", 0))
        end   = seg.get("endTime", seg.get("end", 0))
        text  = seg.get("text") or seg.get("utterance") or ""
        conf  = seg.get("confidence", 0.0)
        items.append({"speaker": speaker, "text": text, "start": start, "end": end, "confidence": conf})
    # 백업: 단일 fullText가 있을 수 있음
    if not items and res.get("text"):
        items.append({"speaker": "S0", "text": res["text"], "start": 0, "end": 0, "confidence": 1.0})
    return items

@app.post("/api/transcribe")
async def transcribe(
    file: UploadFile = File(...),
    words: str = Form("")  # "그람슈미트,에이다부스트,k-means" 식 CSV
):
    # 1) 업로드 저장
    raw_fd, raw_path = tempfile.mkstemp(suffix=".wav")
    with os.fdopen(raw_fd, "wb") as w:
        w.write(await file.read())

    # 2) 전처리
    pre_path = raw_path.replace(".wav", ".pre.wav")
    ffmpeg_preprocess(raw_path, pre_path)

    # 3) 세그먼트 분할(1분 단위)
    segs = split_segments(pre_path, 60_000)

    # 4) 용어 부스팅 목록
    custom_words = [w.strip() for w in words.split(",") if w.strip()]

    # 5) 클로바 호출(세그먼트 병렬 가능; 여기선 직렬)
    merged = []
    offset_ms = 0
    for seg in segs:
        res = call_clova_wav(seg, custom_words)
        items = flatten_result(res)
        # 세그먼트 오프셋 보정
        for it in items:
            it["start"] = (it["start"] or 0) + offset_ms
            it["end"]   = (it["end"] or 0) + offset_ms
        merged.extend(items)
        # 길이 측정해 오프셋 증가
        audio = AudioSegment.from_file(seg)
        offset_ms += len(audio)

       # 6) 저신뢰도 플래그(0.85 미만)
    for it in merged:
        it["low_conf"] = (it.get("confidence", 1.0) < 0.85)

    # --- 통계 계산 ---
    confs = [it.get("confidence", 1.0) for it in merged if it.get("confidence") is not None]
    avg_conf = round(sum(confs) / len(confs), 4) if confs else 0.0
    low_rate = round(sum(1 for it in merged if it["low_conf"]) / max(1, len(merged)), 4)

    # 부스팅 용어 적중(아주 단순 매칭)
    import re
    boost_hits = 0
    if custom_words:
        pattern = re.compile(r"\b(" + "|".join(re.escape(w) for w in custom_words) + r")\b", re.IGNORECASE)
        boost_hits = sum(len(pattern.findall(it["text"])) for it in merged if it.get("text"))

    # 선택: 기준 정답 텍스트(ref)가 들어오면 WER 계산
    # pip3 install jiwer  후 사용 가능
    wer_score = None
    try:
        from jiwer import wer
        # 업로드 폼에 ref(정답문) 텍스트가 오면 비교
        # -> 프론트에서 같이 보낼 수 있음(없으면 생략)
        # FastAPI Form으로 받으려면 함수 시그니처에 ref: str = Form("") 추가
        pass
    except Exception:
        wer_score = None

    # 7) 정렬 및 응답
    merged.sort(key=lambda x: x["start"])
    total_ms = offset_ms
    return {
        "items": merged,
        "duration_ms": total_ms,
        "stats": {
            "avg_conf": avg_conf,        # 평균 신뢰도(↑ 좋음)
            "low_rate": low_rate,        # 저신뢰 문장 비율(↓ 좋음)
            "boost_hits": boost_hits,    # 부스팅 용어 인식 횟수(↑ 좋음)
            "wer": wer_score             # 선택: 기준문 대비 단어오류율(↓ 좋음)
        }
    }