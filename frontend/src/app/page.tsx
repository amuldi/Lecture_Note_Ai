"use client";
import { useEffect, useMemo, useRef, useState } from "react";

/** ---------- Types ---------- */
type Segment = { start: number; end: number; text: string; speaker?: number };
type Transcript = { segments: Segment[]; language?: string } | null;

type RecordItem = {
  id: string;
  title: string;
  segments: Segment[];
  language?: string;
  savedAt: number;   // created
  updatedAt: number; // last modified
};

type RecordsPayload = {
  version: number;
  items: RecordItem[];
};

/** ---------- Constants ---------- */
const STORAGE_KEY_SINGLE = "lnai_transcript_v1"; // (구버전 호환 로드용)
const STORAGE_KEY_LIST = "lnai_records_v1";
const VERSION = 1;

const ACCENT = {
  solid: "bg-blue-600 hover:bg-blue-700 text-white",
  ring: "focus:outline-none focus:ring-2 focus:ring-blue-600/40 focus:ring-offset-2",
};

/** ---------- Helpers (id/time) ---------- */
const genId = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
const fmtDateTime = (ms: number) =>
  new Date(ms).toLocaleString();

/** ---------- Storage Helpers ---------- */
function loadRecords(): RecordsPayload {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_LIST);
    if (!raw) return { version: VERSION, items: [] };
    const data = JSON.parse(raw) as RecordsPayload;
    if (!data.items) return { version: VERSION, items: [] };
    return data;
  } catch {
    return { version: VERSION, items: [] };
  }
}
function saveRecords(payload: RecordsPayload) {
  localStorage.setItem(STORAGE_KEY_LIST, JSON.stringify(payload));
}

/** 마이그레이션: 단일 저장분이 있으면 목록으로 옮김 */
function migrateSingleToList() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_SINGLE);
    if (!raw) return;
    const single = JSON.parse(raw) as { segments: Segment[]; language?: string; savedAt?: number };
    if (!single?.segments?.length) return;

    const list = loadRecords();
    const now = Date.now();
    const item: RecordItem = {
      id: genId(),
      title: "이전 저장본",
      segments: single.segments,
      language: single.language,
      savedAt: single.savedAt ?? now,
      updatedAt: now,
    };
    list.items.unshift(item);
    saveRecords(list);
    localStorage.removeItem(STORAGE_KEY_SINGLE);
  } catch {
    /* noop */
  }
}

export default function Home() {
  const baseUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

  /** ---------- Recorder ---------- */
  const [recording, setRecording] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [blobRef, setBlobRef] = useState<Blob | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    migrateSingleToList();
  }, []);

  useEffect(() => {
    let t: number | undefined;
    if (recording) t = window.setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => t && clearInterval(t);
  }, [recording]);

  const timeLabel = useMemo(() => {
    const h = String(Math.floor(seconds / 3600)).padStart(2, "0");
    const m = String(Math.floor((seconds % 3600) / 60)).padStart(2, "0");
    const s = String(seconds % 60).padStart(2, "0");
    return `${h}:${m}:${s}`;
  }, [seconds]);

  const startRec = async () => {
    try {
      setErrorMsg(null);
      setTranscript(null);
      setEditedTranscript([]);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      mediaRecorderRef.current = mr;
      chunks.current = [];
      mr.ondataavailable = (e) => e.data.size > 0 && chunks.current.push(e.data);
      mr.onstop = () => {
        const blob = new Blob(chunks.current, { type: "audio/webm" });
        setBlobRef(blob);
        const url = URL.createObjectURL(blob);
        setAudioUrl(url);
      };
      mr.start();
      setSeconds(0);
      setRecording(true);
    } catch (e: any) {
      setErrorMsg(e?.message || "마이크 권한을 확인해주세요.");
    }
  };
  const stopRec = () => {
    mediaRecorderRef.current?.stop();
    setRecording(false);
  };

  /** ---------- Upload ---------- */
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const MAX_MB = 200;

  const handleFilePick = (f: File | null) => {
    if (!f) return;
    if (f.size > MAX_MB * 1024 * 1024) {
      alert(`파일이 너무 큽니다. ${MAX_MB}MB 이하로 업로드 해주세요.`);
      return;
    }
    setSelectedFile(f);
    setErrorMsg(null);
    setTranscript(null);
    setEditedTranscript([]);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    handleFilePick(e.dataTransfer.files?.[0] || null);
  };

  /** ---------- Pipeline (transcribe) ---------- */
  const [transcript, setTranscript] = useState<Transcript>(null);
  const [status, setStatus] = useState<"idle" | "uploading" | "transcribing" | "done" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const [playbackRate, setPlaybackRate] = useState<number>(1);

  // 현재 재생 위치(타임라인 커서)
  const [curTime, setCurTime] = useState(0);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    const el = document.getElementById("player") as HTMLAudioElement | null;
    if (!el) return;
    const onTime = () => setCurTime(el.currentTime || 0);
    el.addEventListener("timeupdate", onTime);
    return () => el.removeEventListener("timeupdate", onTime);
  }, []);

  useEffect(() => {
    const el = document.getElementById("player") as HTMLAudioElement | null;
    if (el) el.playbackRate = playbackRate;
  }, [playbackRate]);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!menuRef.current) return;
      if (menuRef.current.contains(e.target as Node)) return;
      setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const runPipeline = async (blobOrFile: Blob | File) => {
    try {
      setStatus("uploading");
      setErrorMsg(null);
      const fd = new FormData();
      const name = blobOrFile instanceof File ? blobOrFile.name : "recording.webm";
      fd.append("file", blobOrFile, name);

      const r = await fetch(baseUrl + "/transcribe", { method: "POST", body: fd });
      if (!r.ok) throw new Error(`전사 실패: ${r.status}`);
      setStatus("transcribing");
      const data = await r.json();
      setTranscript(data);
      setEditedTranscript(data?.segments || []);
      setStatus("done");

      // 새 전사 자동으로 "임시 제목"으로 보관함 저장 (덮지 않고 신규 추가)
      quickSaveAsNew(data?.segments || [], data?.language, "새 전사");
    } catch (e: any) {
      setStatus("error");
      setErrorMsg("Failed to fetch");
    }
  };

  /** ---------- Editing ---------- */
  const [editMode, setEditMode] = useState(false);
  const [editedTranscript, setEditedTranscript] = useState<Segment[]>([]);

  /** ---------- Saved Records (store) ---------- */
  const [records, setRecords] = useState<RecordItem[]>([]);
  const [activeRecordId, setActiveRecordId] = useState<string | null>(null);
  const [savedToast, setSavedToast] = useState<string | null>(null);

  // 초기 로드: 목록 불러오기 + (구버전) 단일 저장분 마이그레이션 반영
  useEffect(() => {
    const list = loadRecords();
    setRecords(list.items);
  }, []);

  // 저장소 변경시 로컬스토리지 반영
  useEffect(() => {
    saveRecords({ version: VERSION, items: records });
  }, [records]);

  // 편집 중 자동 저장(현재 활성 기록이 있으면 그 기록에 반영) – 디바운스 800ms
  useEffect(() => {
    if (!editMode || !activeRecordId) return;
    const id = window.setTimeout(() => {
      setRecords((prev) =>
        prev.map((r) =>
          r.id === activeRecordId
            ? { ...r, segments: editedTranscript, updatedAt: Date.now() }
            : r
        )
      );
      setSavedToast("자동 저장됨");
      window.setTimeout(() => setSavedToast(null), 1200);
    }, 800);
    return () => clearTimeout(id);
  }, [editedTranscript, editMode, activeRecordId]);

  // 새 전사시 빠른 신규 저장
  const quickSaveAsNew = (segments: Segment[], language?: string, defaultTitle = "새 전사") => {
    const now = Date.now();
    const rec: RecordItem = {
      id: genId(),
      title: `${defaultTitle} (${new Date(now).toLocaleTimeString()})`,
      segments,
      language,
      savedAt: now,
      updatedAt: now,
    };
    setRecords((prev) => [rec, ...prev]);
    setActiveRecordId(rec.id);
  };

  // 현재 화면 상태를 "새 기록"으로 저장
  const saveAsNew = (title?: string) => {
    const segs = (editMode ? editedTranscript : transcript?.segments) || [];
    if (!segs.length) return;
    const now = Date.now();
    const rec: RecordItem = {
      id: genId(),
      title: title?.trim() || `기록 ${new Date(now).toLocaleString()}`,
      segments: segs,
      language: transcript?.language,
      savedAt: now,
      updatedAt: now,
    };
    setRecords((prev) => [rec, ...prev]);
    setActiveRecordId(rec.id);
    setSavedToast("새 기록으로 저장했습니다.");
    window.setTimeout(() => setSavedToast(null), 1400);
  };

  // 현재 활성 기록에 덮어쓰기
  const saveToCurrent = () => {
    if (!activeRecordId) {
      // 활성 기록이 없으면 새로 저장
      saveAsNew();
      return;
    }
    const segs = (editMode ? editedTranscript : transcript?.segments) || [];
    if (!segs.length) return;
    setRecords((prev) =>
      prev.map((r) =>
        r.id === activeRecordId
          ? { ...r, segments: segs, updatedAt: Date.now() }
          : r
      )
    );
    setSavedToast("현재 기록에 저장했습니다.");
    window.setTimeout(() => setSavedToast(null), 1400);
  };

  // 기록 불러오기
  const loadRecord = (rec: RecordItem) => {
    setTranscript({ segments: rec.segments, language: rec.language });
    setEditedTranscript(rec.segments);
    setActiveRecordId(rec.id);
    setEditMode(false);
  };

  // 기록 삭제
  const deleteRecord = (id: string) => {
    setRecords((prev) => prev.filter((r) => r.id !== id));
    if (activeRecordId === id) {
      setActiveRecordId(null);
    }
  };

  // 기록 이름 변경
  const renameRecord = (id: string, title: string) => {
    setRecords((prev) =>
      prev.map((r) => (r.id === id ? { ...r, title, updatedAt: Date.now() } : r))
    );
  };

  /** ---------- UI: Saved Manager Modal ---------- */
  const [managerOpen, setManagerOpen] = useState(false);
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return records;
    return records.filter((r) => r.title.toLowerCase().includes(q));
  }, [query, records]);

  /** ---------- Utilities ---------- */
  const fmtTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  };

  // helper: 시점 점프 & 스크롤
  const jumpToSeg = (idx: number) => {
    const el = document.getElementById("player") as HTMLAudioElement | null;
    const seg = transcript?.segments?.[idx];
    if (el && seg) {
      el.currentTime = seg.start;
      el.play?.();
    }
    itemRefs.current[idx]?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  return (
    <main className="min-h-screen bg-white text-gray-900">
      {/* Toast */}
      {(savedToast || errorMsg) && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 rounded-lg border bg-white px-4 py-2 text-sm shadow">
          {savedToast || errorMsg}
        </div>
      )}

      {/* ---- Recorder ---- */}
      <section className="mx-auto max-w-3xl px-4 py-6">
        <div className="flex items-center gap-3">
          <button
            className={`h-12 w-12 rounded-lg border flex items-center justify-center ${
              recording ? "bg-black text-white" : "bg-white hover:bg-gray-50"
            } ${ACCENT.ring}`}
            onClick={recording ? stopRec : startRec}
            aria-label={recording ? "녹음 중지" : "녹음 시작"}
            title={recording ? "녹음 중지" : "녹음 시작"}
          >
            {recording ? "■" : "🎙️"}
          </button>

          <div className="flex items-center gap-2">
            <button
              className="px-4 py-2 rounded-md border bg-white hover:bg-gray-50 disabled:opacity-50"
              disabled={!audioUrl}
              onClick={() => (document.getElementById("player") as HTMLAudioElement | null)?.play()}
            >
              재생
            </button>
            <button
              className={`px-4 py-2 rounded-md border ${ACCENT.solid} disabled:opacity-50`}
              disabled={!blobRef}
              onClick={() => {
                if (!blobRef) return;
                const url = URL.createObjectURL(blobRef);
                const a = document.createElement("a");
                a.href = url;
                a.download = `recording_${Date.now()}.webm`;
                a.click();
                URL.revokeObjectURL(url);
              }}
            >
              녹음 파일 저장
            </button>
            <button
              className={`px-4 py-2 rounded-md border ${ACCENT.solid} disabled:opacity-50`}
              disabled={!blobRef}
              onClick={() => blobRef && runPipeline(blobRef)}
            >
              추출
            </button>
          </div>

          <div className="flex-1 text-right">
            <div className="text-xs text-gray-600">녹음 시간</div>
            <div className="text-3xl font-bold tracking-tight">{timeLabel}</div>
          </div>
        </div>
        <div className="mt-6 flex justify-center">
          <div className="relative w-[640px] max-w-full">
            <audio id="player" src={audioUrl ?? undefined} controls className="w-full" />
            <div className="absolute right-2 top-1/2 -translate-y-1/2 z-20" ref={menuRef}>
              <button
                className="h-8 w-8 rounded-full bg-transparent hover:bg-gray-100/70 flex items-center justify-center"
                aria-label="더보기"
                title="더보기"
                onClick={() => setMenuOpen((v) => !v)}
                disabled={!audioUrl}
              >
                <span className="sr-only">메뉴</span>
              </button>
              {menuOpen && audioUrl && (
                <div className="absolute right-0 top-9 z-30 w-56 rounded-md border bg-white shadow-lg p-2">
                  <div className="px-3 py-2 text-xs text-gray-500">재생 속도</div>
                  {[0.75, 1, 1.25, 1.5, 2].map((r) => (
                    <button
                      key={r}
                      className={`w-full text-left px-3 py-2 hover:bg-gray-50 flex items-center justify-between ${playbackRate===r ? 'font-semibold text-gray-900' : 'text-gray-700'}`}
                      onClick={() => setPlaybackRate(r)}
                    >
                      {r.toFixed(2).replace(/\.00$/, '')}x
                      {playbackRate === r && <span>✓</span>}
                    </button>
                  ))}
                  <div className="my-2 h-px bg-gray-100" />
                  <button
                    className="w-full text-left px-3 py-2 text-gray-700 hover:bg-gray-50"
                    onClick={() => setManagerOpen(true)}
                  >
                    저장소 열기
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* ---- Upload ---- */}
      <section className="mx-auto max-w-3xl px-4 my-6">
        <div
          className={[
            "rounded-2xl border-2 border-dashed p-6 transition",
            "flex flex-col items-center justify-center gap-4",
            "min-h-[160px]",
            isDragging ? "border-blue-600 bg-blue-50/40" : "border-gray-300 hover:bg-gray-50",
          ].join(" ")}
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={onDrop}
        >
          <div className="mt-2 flex flex-col sm:flex-row items-center justify-center gap-3">
            <label className={`w-40 px-4 py-3 text-center rounded-md border bg-white hover:bg-gray-50 cursor-pointer ${ACCENT.ring}`}>
              파일 선택
              <input
                type="file"
                accept="audio/*,video/*"
                className="hidden"
                onChange={(e) => handleFilePick(e.target.files?.[0] || null)}
              />
            </label>
            <button
              className={`w-40 px-4 py-3 rounded-md border ${ACCENT.solid} ${ACCENT.ring} disabled:opacity-50`}
              disabled={!selectedFile}
              onClick={() => selectedFile && runPipeline(selectedFile)}
            >
              추출 시작
            </button>
          </div>

          {selectedFile && (
            <p className="mt-2 text-xs text-gray-600 truncate">선택됨: {selectedFile.name}</p>
          )}
        </div>
      </section>

      {/* ---- Results ---- */}
      <section className="mx-auto max-w-3xl px-4 my-8">
        {!transcript ? (
          <div className="text-sm text-gray-500">업로드하거나 녹음 후 결과가 여기에 표시됩니다.</div>
        ) : (
          <div className="space-y-4">
            {/* 헤더 */}
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-baseline gap-3">
                <h3 className="text-xl font-bold">음성 기록</h3>
                {activeRecordId && (
                  <span className="text-xs text-gray-500">활성 기록: {records.find(r=>r.id===activeRecordId)?.title}</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  className="text-sm text-gray-600 hover:text-gray-900"
                  onClick={() => setManagerOpen(true)}
                  title="저장소 열기"
                >
                  저장소
                </button>
                <button
                  className="text-sm text-gray-600 hover:text-gray-900"
                  onClick={() => {
                    if (editMode) {
                      setTranscript({ ...(transcript || { language: "ko" }), segments: editedTranscript });
                    }
                    setEditMode((v) => !v);
                  }}
                >
                  {editMode ? "편집 종료" : "편집"}
                </button>
                <button
                  className="text-sm text-gray-600 hover:text-gray-900"
                  onClick={saveToCurrent}
                  disabled={!((editMode ? editedTranscript : transcript?.segments)?.length)}
                  title="현재 활성 기록에 저장"
                >
                  현재에 저장
                </button>
                <button
                  className="text-sm text-gray-600 hover:text-gray-900"
                  onClick={() => saveAsNew()}
                  disabled={!((editMode ? editedTranscript : transcript?.segments)?.length)}
                  title="새 기록으로 저장"
                >
                  새로 저장
                </button>
              </div>
            </div>

            {/* 전사 리스트 */}
            <div className="space-y-4">
              {(transcript?.segments || []).map((s, idx) => (
                <div
                  key={idx}
                  ref={(el) => (itemRefs.current[idx] = el)}
                  className="flex items-start gap-3"
                >
                  <div className="h-7 w-7 shrink-0 rounded-full bg-gray-900 text-white flex items-center justify-center text-sm">
                    {(s.speaker ?? 1)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-gray-500">{fmtTime(s.start)}</div>
                    {editMode ? (
                      <textarea
                        value={(editedTranscript[idx]?.text ?? s.text) || ""}
                        onChange={(e) => {
                          const copy = [...editedTranscript];
                          copy[idx] = { ...(copy[idx] || s), text: e.target.value };
                          setEditedTranscript(copy);
                        }}
                        className="w-full rounded-md border px-2 py-1 text-sm"
                      />
                    ) : (
                      <p className="leading-relaxed">{editedTranscript[idx]?.text ?? s.text}</p>
                    )}
                  </div>
                </div>
              ))}
              {(!transcript || (transcript.segments ?? []).length === 0) && (
                <p className="text-sm text-gray-500">전사된 문장이 없습니다.</p>
              )}
            </div>

            {/* 타임라인 */}
            {(transcript?.segments?.length ?? 0) > 0 && (() => {
              const segs = transcript!.segments as Segment[];
              const start0 = segs[0].start;
              const endT = segs[segs.length - 1].end;
              const total = Math.max(0.001, endT - start0);
              const curPct = Math.min(100, Math.max(0, ((curTime - start0) / total) * 100));
              const leftPercent = (t: number) => Math.min(100, Math.max(0, ((t - start0) / total) * 100));

              const fmt = fmtTime;

              return (
                <div className="mt-6">
                  <div className="relative h-2 rounded-full bg-gray-200">
                    <span
                      aria-hidden
                      className="absolute top-0 -translate-x-1/2 h-2 w-[2px] bg-gray-900"
                      style={{ left: `${curPct}%` }}
                    />
                    {segs.map((s, i) => (
                      <div
                        key={i}
                        className="absolute -top-1 -translate-x-1/2"
                        style={{ left: `${leftPercent(s.start)}%` }}
                      >
                        <button
                          className="group block h-2 w-2 rounded-full bg-black"
                          title={`${fmt(s.start)} • ${s.text.slice(0, 24)}${s.text.length > 24 ? "…" : ""}`}
                          onClick={() => jumpToSeg(i)}
                          aria-label={`시점 ${fmt(s.start)}로 이동`}
                        />
                        <div className="pointer-events-none absolute left-1/2 z-10 hidden -translate-x-1/2 -translate-y-2 whitespace-nowrap rounded-md border bg-white px-2 py-1 text-xs text-gray-800 shadow group-hover:block">
                          {fmt(s.start)} · {s.text.slice(0, 26)}{s.text.length > 26 ? "…" : ""}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-2 flex items-center justify-between text-xs text-gray-500">
                    <span>0:00</span>
                    <span>{fmt(endT)}</span>
                  </div>
                </div>
              );
            })()}
          </div>
        )}
      </section>

      {/* ---------- Saved Manager Modal ---------- */}
      {managerOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/20"
            onClick={() => setManagerOpen(false)}
          />
          <div className="relative w-[720px] max-w-[92vw] max-h-[80vh] overflow-hidden rounded-2xl border bg-white shadow-xl">
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <h4 className="font-semibold">저장소</h4>
              <div className="flex items-center gap-2">
                <input
                  className="h-9 w-48 rounded border px-3 text-sm"
                  placeholder="검색"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                <button
                  className={`h-9 px-3 rounded-md border ${ACCENT.solid}`}
                  onClick={() => saveAsNew("새 기록")}
                  disabled={!(transcript?.segments?.length)}
                >
                  현재 화면을 새로 저장
                </button>
                <button
                  className="h-9 px-3 rounded-md border"
                  onClick={() => setManagerOpen(false)}
                >
                  닫기
                </button>
              </div>
            </div>

            <div className="px-4 py-3 overflow-auto" style={{ maxHeight: "calc(80vh - 48px)" }}>
              {filtered.length === 0 ? (
                <p className="text-sm text-gray-500 py-12 text-center">저장된 기록이 없습니다.</p>
              ) : (
                <ul className="space-y-2">
                  {filtered.map((r) => (
                    <li key={r.id} className={`rounded-lg border p-3 ${activeRecordId===r.id ? "border-blue-600" : "border-gray-200"}`}>
                      <div className="flex items-center justify-between gap-2">
                        <input
                          className="flex-1 rounded border px-2 py-1 text-sm"
                          value={r.title}
                          onChange={(e) => renameRecord(r.id, e.target.value)}
                        />
                        <div className="flex items-center gap-2">
                          <button
                            className="px-3 py-1 rounded border text-sm hover:bg-gray-50"
                            onClick={() => loadRecord(r)}
                          >
                            불러오기
                          </button>
                          <button
                            className="px-3 py-1 rounded border text-sm hover:bg-gray-50"
                            onClick={() => {
                              setActiveRecordId(r.id);
                              setManagerOpen(false);
                              setTranscript({ segments: r.segments, language: r.language });
                              setEditedTranscript(r.segments);
                              setEditMode(false);
                            }}
                          >
                            활성화
                          </button>
                          <button
                            className="px-3 py-1 rounded border text-sm text-red-600 hover:bg-red-50"
                            onClick={() => deleteRecord(r.id)}
                          >
                            삭제
                          </button>
                        </div>
                      </div>
                      <div className="mt-2 text-xs text-gray-500 flex flex-wrap gap-3">
                        <span>생성: {fmtDateTime(r.savedAt)}</span>
                        <span>수정: {fmtDateTime(r.updatedAt)}</span>
                        <span>문장 수: {r.segments.length}</span>
                        {r.language && <span>언어: {r.language}</span>}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}