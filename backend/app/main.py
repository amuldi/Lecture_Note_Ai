from fastapi import FastAPI, UploadFile, File
from pydantic import BaseModel
from faster_whisper import WhisperModel
from fastapi.middleware.cors import CORSMiddleware
import uvicorn, os, uuid
import yake
import asyncio
import httpx

# OpenAI API Key
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")

# OpenAI Summarize 함수
async def openai_summarize(text: str, lang_hint: str | None):
    if not OPENAI_API_KEY:
        return None
    prompt = f"다음 강의 전사를 {lang_hint or '한국어'}로 5문장 내 요약:\n\n{text[:12000]}"
    async with httpx.AsyncClient(timeout=60) as client:
        r = await client.post(
            "https://api.openai.com/v1/chat/completions",
            headers={"Authorization": f"Bearer {OPENAI_API_KEY}"},
            json={
                "model": "gpt-4o-mini",
                "messages": [{"role": "user", "content": prompt}],
                "temperature": 0.2,
            },
        )
    return r.json()["choices"][0]["message"]["content"].strip()

# FastAPI + CORS
app = FastAPI(title="Lecture Notes AI – Backend")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],  # 프론트엔드 주소
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Whisper 모델 불러오기
MODEL_SIZE = os.getenv("WHISPER_MODEL", "small")
COMPUTE = os.getenv("WHISPER_COMPUTE", "int8")
model = WhisperModel(MODEL_SIZE, compute_type=COMPUTE)

# 요청 스키마
class AnalyzeReq(BaseModel):
    segments: list[dict]
    language: str | None = None

# Health 체크
@app.get("/health")
async def health():
    return {"ok": True}

# 음성 전사
@app.post("/transcribe")
async def transcribe(file: UploadFile = File(...)):
    fid = str(uuid.uuid4())
    path = f"/tmp/{fid}_{file.filename}"
    with open(path, "wb") as f:
        f.write(await file.read())

    segments = []
    generator, info = model.transcribe(path, vad_filter=True, word_timestamps=False)
    for seg in generator:
        segments.append({"start": seg.start, "end": seg.end, "text": seg.text})

    # SRT 변환
    def to_srt_time(t: float):
        h = int(t // 3600)
        m = int((t % 3600) // 60)
        s = int(t % 60)
        ms = int((t * 1000) % 1000)
        return f"{h:02}:{m:02}:{s:02},{ms:03}"

    srt_lines = []
    for i, s in enumerate(segments, 1):
        srt_lines.append(
            f"{i}\n{to_srt_time(s['start'])} --> {to_srt_time(s['end'])}\n{s['text'].strip()}\n"
        )

    return {"segments": segments, "srt": "\n".join(srt_lines), "language": info.language}

# 요약/키워드 추출
@app.post("/analyze")
async def analyze(req: AnalyzeReq):
    full_text = "\n".join(s.get("text", "") for s in req.segments)

    # 1) OpenAI가 있으면 우선 사용
    summary = await openai_summarize(full_text, req.language)
    if not summary:
        # 2) OpenAI 없으면 간단 요약
        sentences = [
            t.strip() for t in full_text.replace("\n", " ").split(".") if t.strip()
        ]
        summary = " . ".join(sentences[:5])

    # 3) 키워드 추출
    kw_extractor = yake.KeywordExtractor(
        lan=(req.language or "auto")[:2], n=1, top=10
    )
    keywords = [k for k, _ in kw_extractor.extract_keywords(full_text)]
    topics = keywords[:5]

    return {"summary": summary, "keywords": keywords, "topics": topics}

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("API_PORT", 8000)))