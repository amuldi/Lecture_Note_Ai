"use client";
import { useEffect, useMemo, useRef, useState } from "react";

export default function Home() {
  // ---------------- State ----------------
  const [tab, setTab] = useState<"record" | "upload">("record");

  const [file, setFile] = useState<File | null>(null);
  const [transcript, setTranscript] = useState<any>(null);
  const [analysis, setAnalysis] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const [recording, setRecording] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);

  const [status, setStatus] = useState<
    "idle" | "uploading" | "transcribing" | "analyzing" | "done" | "error"
  >("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const MAX_MB = 200; // 업로드 여유 상향

  // ---------- Timer for recording ----------
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    let t: any;
    if (recording) {
      t = setInterval(() => setSeconds((s) => s + 1), 1000);
    }
    return () => t && clearInterval(t);
  }, [recording]);
  const timeLabel = useMemo(() => {
    const h = Math.floor(seconds / 3600)
      .toString()
      .padStart(2, "0");
    const m = Math.floor((seconds % 3600) / 60)
      .toString()
      .padStart(2, "0");
    const s = Math.floor(seconds % 60)
      .toString()
      .padStart(2, "0");
    return `${h}:${m}:${s}`;
  }, [seconds]);

  // ---------- Drag & Drop ----------
  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };
  const onDragLeave = () => setIsDragging(false);
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (!f) return;
    if (f.size > MAX_MB * 1024 * 1024) {
      alert(`파일이 너무 큽니다. ${MAX_MB}MB 이하로 업로드 해주세요.`);
      return;
    }
    setErrorMsg(null);
    setStatus("idle");
    setFile(f);
    setTab("upload");
  };

  // ---------- Helpers ----------
  const baseUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
  const resetOutputs = () => {
    setTranscript(null);
    setAnalysis(null);
    setStatus("idle");
    setErrorMsg(null);
  };

  // ---------- Upload Flow ----------
  const onUpload = async () => {
    if (!file) return;
    resetOutputs();
    try {
      setLoading(true);
      setStatus("uploading");
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch(baseUrl + "/transcribe", { method: "POST", body: fd });
      if (!r.ok) throw new Error(`전사 실패: ${r.status}`);
      setStatus("transcribing");
      const data = await r.json();
      setTranscript(data);

      setStatus("analyzing");
      const a = await fetch(baseUrl + "/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ segments: data.segments, language: data.language }),
      });
      if (!a.ok) throw new Error(`분석 실패: ${a.status}`);
      setAnalysis(await a.json());

      setStatus("done");
    } catch (e: any) {
      setStatus("error");
      setErrorMsg(e?.message || "처리 중 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  };

  // ---------- Recording Flow ----------
  const startRecording = async () => {
    try {
      resetOutputs();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      chunks.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.current.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        try {
          setStatus("uploading");
          const blob = new Blob(chunks.current, { type: "audio/webm" });
          const url = URL.createObjectURL(blob);
          setAudioUrl(url);

          const fd = new FormData();
          fd.append("file", blob, "recording.webm");
          const r = await fetch(baseUrl + "/transcribe", { method: "POST", body: fd });
          if (!r.ok) throw new Error(`전사 실패: ${r.status}`);
          setStatus("transcribing");
          const data = await r.json();
          setTranscript(data);

          setStatus("analyzing");
          const a = await fetch(baseUrl + "/analyze", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ segments: data.segments, language: data.language }),
          });
          if (!a.ok) throw new Error(`분석 실패: ${a.status}`);
          setAnalysis(await a.json());

          setStatus("done");
        } catch (err: any) {
          setStatus("error");
          setErrorMsg(err?.message || "처리 중 오류가 발생했습니다.");
        }
      };

      mediaRecorder.start();
      setRecording(true);
      setSeconds(0);
    } catch (err: any) {
      setStatus("error");
      setErrorMsg(err?.message || "마이크 권한 또는 녹음 시작 실패");
    }
  };

  const stopRecording = () => {
    mediaRecorderRef.current?.stop();
    setRecording(false);
  };

  // ---------- Keyboard shortcut (Space = toggle record) ----------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Space" && (document.activeElement as HTMLElement)?.tagName !== "INPUT") {
        e.preventDefault();
        recording ? stopRecording() : startRecording();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [recording]);

  // ---------- Components ----------
  const StatusPill = () => (
    status !== "idle" ? (
      <div className="inline-flex items-center rounded-full bg-gray-100 border border-gray-300 px-3 py-1 text-sm">
        <span className="mr-2 h-2 w-2 rounded-full bg-black" />
        <span className="font-medium text-gray-800">
          {status === "uploading" && "업로드 중"}
          {status === "transcribing" && "전사 중"}
          {status === "analyzing" && "요약 중"}
          {status === "done" && "완료"}
          {status === "error" && "오류"}
        </span>
        {status === "error" && errorMsg && (
          <span className="ml-3 text-red-600">{errorMsg}</span>
        )}
      </div>
    ) : null
  );

  return (
    <main className="min-h-screen bg-white text-gray-900">
      {/* Header */}
      <header className="border-b">
        <div className="mx-auto max-w-6xl px-6 py-5 flex items-center justify-between">
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">
            강의 요약·기록 <span className="text-black">AI</span>
          </h1>
          <div className="text-xs text-gray-500">Space: 녹음 토글</div>
        </div>
      </header>

      {/* Body: two columns */}
      <div className="mx-auto max-w-6xl px-6 py-8 grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left: Controls */}
        <section className="lg:col-span-5 space-y-6">
          {/* Tabs */}
          <div className="bg-white rounded-2xl border shadow-sm">
            <div className="flex">
              <button
                className={`flex-1 px-4 py-3 text-sm font-medium border-b ${
                  tab === "record" ? "border-black text-black" : "border-transparent text-gray-500"
                }`}
                onClick={() => setTab("record")}
              >
                녹음
              </button>
              <button
                className={`flex-1 px-4 py-3 text-sm font-medium border-b ${
                  tab === "upload" ? "border-black text-black" : "border-transparent text-gray-500"
                }`}
                onClick={() => setTab("upload")}
              >
                파일 업로드
              </button>
            </div>

            <div className="p-6">
              {tab === "record" ? (
                <div className="space-y-5">
                  {/* Big Record Button */}
                  <div className="flex items-center gap-4">
                    <button
                      aria-label={recording ? "녹음 중지" : "녹음 시작"}
                      onClick={recording ? stopRecording : startRecording}
                      className={`h-20 w-20 rounded-full border flex items-center justify-center transition ${
                        recording ? "bg-black text-white" : "bg-white hover:bg-gray-50"
                      }`}
                    >
                      {recording ? (
                        <div className="h-4 w-4 bg-white" />
                      ) : (
                        <div className="h-6 w-6 rounded-full bg-black" />
                      )}
                    </button>
                    <div>
                      <div className="text-xs text-gray-500">녹음 시간</div>
                      <div className="text-2xl font-semibold tracking-tight">{timeLabel}</div>
                      {audioUrl && (
                        <audio controls src={audioUrl} className="mt-2 h-10" />
                      )}
                    </div>
                  </div>

                  {/* Simple visualizer (animated bars while recording) */}
                  <div className="h-12 flex items-end gap-1">
                    {Array.from({ length: 24 }).map((_, i) => (
                      <span
                        key={i}
                        className={`w-2 bg-gray-300 ${
                          recording ? "animate-pulse" : ""
                        }`}
                        style={{ height: recording ? `${8 + ((i * 7) % 40)}px` : "8px" }}
                      />
                    ))}
                  </div>

                  <StatusPill />
                </div>
              ) : (
                <div
                  className={[
                    "rounded-2xl border-2 border-dashed p-8 text-center transition",
                    isDragging ? "border-black bg-gray-100" : "border-gray-300 hover:bg-gray-50",
                  ].join(" ")}
                  onDragOver={onDragOver}
                  onDragLeave={onDragLeave}
                  onDrop={onDrop}
                >
                  <input
                    id="file"
                    type="file"
                    accept="audio/*,video/*"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0] || null;
                      setErrorMsg(null);
                      setStatus("idle");
                      if (f && f.size > MAX_MB * 1024 * 1024) {
                        alert(`파일이 너무 큽니다. ${MAX_MB}MB 이하로 업로드 해주세요.`);
                        e.target.value = "";
                        setFile(null);
                        return;
                      }
                      setFile(f);
                    }}
                  />
                  <label htmlFor="file" className="cursor-pointer inline-flex items-center gap-2 text-black font-medium">
                    파일 선택 또는 이 영역으로 드래그
                  </label>
                  {file && (
                    <div className="mt-3 text-sm text-gray-600 flex items-center justify-center gap-2">
                      <span className="inline-block truncate max-w-[240px]">{file.name}</span>
                      <button
                        className="px-3 py-1 border rounded-full text-xs hover:bg-gray-50"
                        onClick={onUpload}
                        disabled={loading}
                      >
                        {loading ? "처리 중..." : "전사 & 분석"}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Utilities */}
          <div className="bg-white rounded-2xl border shadow-sm p-4 flex items-center justify-between">
            <div className="text-sm text-gray-600">결과 초기화/새 녹음 준비</div>
            <div className="flex items-center gap-2">
              <button
                className="px-3 py-2 rounded-xl bg-white border text-gray-800 hover:bg-gray-50"
                onClick={() => {
                  setFile(null);
                  setAudioUrl(null);
                  setSeconds(0);
                  resetOutputs();
                }}
              >
                초기화
              </button>
              {transcript?.srt && (
                <button
                  className="px-3 py-2 rounded-xl bg-white border text-gray-800 hover:bg-gray-50"
                  onClick={() => {
                    const blob = new Blob([transcript.srt], { type: "text/plain;charset=utf-8" });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = "transcript.srt";
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                >
                  SRT 다운로드
                </button>
              )}
            </div>
          </div>
        </section>

        {/* Right: Results */}
        <section className="lg:col-span-7 space-y-6">
          <div className="bg-white rounded-2xl border shadow-sm p-6 min-h-[200px]">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold">전사 결과</h2>
              <StatusPill />
            </div>
            {!transcript && (
              <p className="text-sm text-gray-500">녹음 완료 후 또는 파일 업로드 후 전사 결과가 이 영역에 표시됩니다.</p>
            )}
            {transcript && (
              <div className="space-y-3">
                {transcript.segments.map((s: any, i: number) => (
                  <div key={i} className="p-3 rounded-xl bg-gray-50 hover:bg-gray-100">
                    <div className="text-xs text-gray-500 mb-1">[{s.start.toFixed(1)} − {s.end.toFixed(1)}]</div>
                    <p className="text-gray-900 leading-relaxed">{s.text}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-white rounded-2xl border shadow-sm p-6">
            <h2 className="text-lg font-semibold mb-3">요약 · 키워드 · 주제</h2>
            {!analysis && (
              <p className="text-sm text-gray-500">전사 완료 후 요약과 키워드, 주요 주제가 표시됩니다.</p>
            )}
            {analysis && (
              <div className="space-y-5">
                <div>
                  <h3 className="font-semibold text-gray-700 mb-1">요약</h3>
                  <p className="leading-7 text-gray-900">{analysis.summary}</p>
                </div>
                <div>
                  <h3 className="font-semibold text-gray-700 mb-2">키워드</h3>
                  <div className="flex gap-2 flex-wrap">
                    {analysis.keywords.map((k: string) => (
                      <span key={k} className="text-sm px-3 py-1 rounded-full bg-white text-gray-900 border border-gray-300">
                        {k}
                      </span>
                    ))}
                  </div>
                </div>
                <div>
                  <h3 className="font-semibold text-gray-700 mb-2">주요 주제</h3>
                  <div className="flex gap-2 flex-wrap">
                    {analysis.topics.map((t: string) => (
                      <span key={t} className="text-sm px-3 py-1 rounded-full bg-gray-100 text-gray-900 border">
                        {t}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}