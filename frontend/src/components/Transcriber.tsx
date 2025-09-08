// frontend/src/components/Transcriber.tsx
import { useRef, useState } from "react";

type Item = {
  speaker: string; text: string; start: number; end: number; confidence: number; low_conf: boolean;
};

export default function Transcriber() {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [audioURL, setAudioURL] = useState<string>("");

  const onUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    setAudioURL(URL.createObjectURL(file));
    const form = new FormData();
    form.append("file", file);
    form.append("words", "그람슈미트,에이다부스트,k-means,엔트로피"); // 전공 용어 예시

    setLoading(true);
    const res = await fetch(import.meta.env.VITE_API_BASE + "/api/transcribe", { method: "POST", body: form });
    const data = await res.json();
    setItems(data.items || []);
    setLoading(false);
  };

  const jump = (ms: number) => {
    if (!audioRef.current) return;
    audioRef.current.currentTime = ms / 1000;
    audioRef.current.play();
  };

  return (
    <div className="mx-auto max-w-3xl p-4 space-y-4">
      <input type="file" accept="audio/*" onChange={onUpload}
             className="block w-full rounded-xl border px-4 py-3" />
      {audioRef && <audio ref={audioRef} controls src={audioURL} className="w-full" />}
      {loading && <div className="mt-2 text-sm opacity-70">전사 중… (세그먼트 처리)</div>}

      <div className="space-y-2">
        {items.map((it, i) => (
          <div key={i} className={`rounded-xl border p-3 ${it.low_conf ? "bg-yellow-50" : "bg-white"}`}>
            <div className="text-xs opacity-60">
              {it.speaker} · {Math.round(it.confidence * 100)}% ·
              <button onClick={() => jump(it.start)} className="ml-2 underline">▶ {Math.floor(it.start/1000)}s</button>
            </div>
            <div className={`mt-1 leading-relaxed ${it.low_conf ? "underline decoration-dotted" : ""}`}>
              {it.text}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
// frontend/src/components/Transcriber.tsx
import { useRef, useState } from "react";

// ===== Types =====
type Item = {
  speaker: string;
  text: string;
  start: number;
  end: number;
  confidence: number;
  low_conf: boolean;
};

type Stats = {
  avg_conf: number;
  low_rate: number;
  boost_hits: number;
  wer?: number | null;
};

export default function Transcriber() {
  const [items, setItems] = useState<Item[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>("");
  const audioRef = useRef<HTMLAudioElement>(null);
  const [audioURL, setAudioURL] = useState<string>("");

  const onUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setAudioURL(URL.createObjectURL(file));
    const form = new FormData();
    form.append("file", file);
    // 전공/도메인 용어는 필요에 따라 업데이트하세요.
    form.append("words", "그람슈미트,에이다부스트,k-means,엔트로피");

    setLoading(true);
    setError("");
    try {
      const base = import.meta.env.VITE_API_BASE || "http://localhost:8000";
      const res = await fetch(`${base}/api/transcribe`, { method: "POST", body: form });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setItems(data.items || []);
      setStats(data.stats || null);
    } catch (err: any) {
      console.error(err);
      setError("전사 요청에 실패했습니다. 백엔드 실행 상태와 .env 설정을 확인하세요.");
      setItems([]);
      setStats(null);
    } finally {
      setLoading(false);
    }
  };

  const jump = (ms: number) => {
    if (!audioRef.current) return;
    audioRef.current.currentTime = ms / 1000;
    audioRef.current.play();
  };

  return (
    <div className="mx-auto max-w-3xl p-4 space-y-4">
      <input
        type="file"
        accept="audio/*"
        onChange={onUpload}
        className="block w-full rounded-xl border px-4 py-3"
      />

      {audioRef && (
        <audio ref={audioRef} controls src={audioURL} className="w-full" />
      )}

      {loading && (
        <div className="mt-2 text-sm opacity-70">전사 중… (세그먼트 처리)</div>
      )}

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      )}

      {/* ===== 통계 요약 패널 ===== */}
      {stats && (
        <div className="rounded-xl border p-4 bg-gray-50">
          <div className="text-sm grid grid-cols-2 gap-y-1 gap-x-4">
            <div>
              평균 신뢰도: <b>{(stats.avg_conf * 100).toFixed(1)}%</b>
            </div>
            <div>
              저신뢰 구간 비율: <b>{(stats.low_rate * 100).toFixed(1)}%</b>
            </div>
            <div>
              부스팅 용어 적중: <b>{stats.boost_hits}</b> 회
            </div>
            {typeof stats.wer === "number" && (
              <div>WER(정답 대비): <b>{(stats.wer * 100).toFixed(1)}%</b></div>
            )}
          </div>
        </div>
      )}

      {/* ===== 전사 결과 리스트 ===== */}
      <div className="space-y-2">
        {items.map((it, i) => (
          <div
            key={i}
            className={`rounded-xl border p-3 ${it.low_conf ? "bg-yellow-50" : "bg-white"}`}
          >
            <div className="text-xs opacity-60">
              {it.speaker} · {Math.round(it.confidence * 100)}% ·
              <button onClick={() => jump(it.start)} className="ml-2 underline">
                ▶ {Math.floor(it.start / 1000)}s
              </button>
            </div>
            <div
              className={`mt-1 leading-relaxed ${it.low_conf ? "underline decoration-dotted" : ""}`}
            >
              {it.text}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}