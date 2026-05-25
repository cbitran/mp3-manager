import { useState, useRef, useEffect, useCallback } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import i18n from "../i18n";
import { type Track } from "../store";

interface Props {
  track: Track;
  onClose: () => void;
}

function fmt(s: number) {
  if (!isFinite(s)) return "00:00";
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}

export default function VideoPlayerModal({ track, onClose }: Props) {
  const videoRef    = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const timerRef    = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const [playing, setPlaying]     = useState(false);
  const [current, setCurrent]     = useState(0);
  const [duration, setDuration]   = useState(0);
  const [volume, setVolume]       = useState(1);
  const [muted, setMuted]         = useState(false);
  const [fullscreen, setFull]     = useState(false);
  const [showCtrl, setShowCtrl]   = useState(true);
  const [seeking]                 = useState(false);

  const progress = duration > 0 ? (current / duration) * 100 : 0;

  const resetTimer = useCallback(() => {
    setShowCtrl(true);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setShowCtrl(false), 3000);
  }, []);

  useEffect(() => {
    if (!playing) { setShowCtrl(true); clearTimeout(timerRef.current); }
    else resetTimer();
    return () => clearTimeout(timerRef.current);
  }, [playing]);

  useEffect(() => {
    const onFull = () => setFull(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFull);
    return () => document.removeEventListener("fullscreenchange", onFull);
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === " ")           { e.preventDefault(); togglePlay(); }
      if (e.key === "ArrowLeft")   { e.preventDefault(); skip(-10); }
      if (e.key === "ArrowRight")  { e.preventDefault(); skip(10); }
      if (e.key === "Escape")      onClose();
      if (e.key === "f" || e.key === "F") toggleFull();
      if (e.key === "m" || e.key === "M") toggleMute();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function togglePlay() {
    const v = videoRef.current; if (!v) return;
    v.paused ? v.play().catch(() => {}) : v.pause();
  }

  function skip(d: number) {
    const v = videoRef.current; if (!v) return;
    v.currentTime = Math.max(0, Math.min(v.currentTime + d, duration));
  }

  function toggleMute() {
    const v = videoRef.current; if (!v) return;
    v.muted = !v.muted;
  }

  function setVol(val: number) {
    const v = videoRef.current; if (!v) return;
    v.volume = val;
    if (val > 0 && v.muted) v.muted = false;
  }

  function toggleFull() {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) containerRef.current.requestFullscreen();
    else document.exitFullscreen();
  }

  function handleSeekClick(e: React.MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const t = ((e.clientX - rect.left) / rect.width) * duration;
    const v = videoRef.current; if (!v) return;
    v.currentTime = Math.max(0, Math.min(t, duration));
  }

  return (
    <div
      className="fixed inset-0 z-[700] flex items-center justify-center bg-black/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        ref={containerRef}
        className="relative rounded-2xl overflow-hidden shadow-2xl flex flex-col select-none"
        style={{
          width: "min(78vw, 920px)",
          maxHeight: "86vh",
          background: "#0a0908",
          border: "1px solid rgba(255,255,255,0.06)",
        }}
        onClick={(e) => e.stopPropagation()}
        onMouseMove={resetTimer}
        onMouseEnter={resetTimer}
      >
        {/* ── Header ─────────────────────────────────────────────────── */}
        <div
          className="flex items-center gap-2.5 px-4 py-2.5 shrink-0 border-b"
          style={{ background: "rgba(0,0,0,0.7)", borderColor: "rgba(255,255,255,0.05)" }}
        >
          <svg width="13" height="13" viewBox="0 0 10 10" fill="none" stroke="#D95340" strokeWidth="1.4" strokeLinecap="round">
            <rect x="1" y="2.5" width="6" height="5" rx="0.8"/>
            <path d="M7 4.5l2-1.5v4L7 5.5"/>
          </svg>
          <span className="text-[12px] font-medium truncate flex-1" style={{ color: "#C2BEBC" }}>
            {track.title || track.filename}
          </span>
          {track.duration_secs && (
            <span className="text-[10px] font-mono shrink-0" style={{ color: "#605A55" }}>
              {fmt(track.duration_secs)}
            </span>
          )}
          <button
            onClick={onClose}
            className="w-6 h-6 flex items-center justify-center rounded-full transition-colors shrink-0"
            style={{ color: "#605A55" }}
            onMouseEnter={(e) => { e.currentTarget.style.color = "#C2BEBC"; e.currentTarget.style.background = "rgba(255,255,255,0.06)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = "#605A55"; e.currentTarget.style.background = "transparent"; }}
          >
            <svg width="9" height="9" viewBox="0 0 9 9" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
              <line x1="1" y1="1" x2="8" y2="8"/><line x1="8" y1="1" x2="1" y2="8"/>
            </svg>
          </button>
        </div>

        {/* ── Vídeo ──────────────────────────────────────────────────── */}
        <div
          className="relative bg-black flex-1 cursor-pointer"
          style={{ minHeight: 0 }}
          onClick={togglePlay}
        >
          <video
            ref={videoRef}
            key={track.path}
            src={convertFileSrc(track.path)}
            autoPlay
            playsInline
            className="w-full h-full object-contain block"
            style={{ maxHeight: "calc(86vh - 116px)" }}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onTimeUpdate={(e) => { if (!seeking) setCurrent(e.currentTarget.currentTime); }}
            onDurationChange={(e) => setDuration(e.currentTarget.duration)}
            onVolumeChange={(e) => {
              setVolume(e.currentTarget.volume);
              setMuted(e.currentTarget.muted);
            }}
            onEnded={() => setPlaying(false)}
            onError={() => {
              import("@tauri-apps/plugin-opener").then(({ openPath }) => {
                openPath(track.path).catch(() => {});
              });
              onClose();
            }}
          />

          {/* Overlay: pause icon */}
          {!playing && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div
                className="w-16 h-16 rounded-full flex items-center justify-center"
                style={{ background: "rgba(0,0,0,0.55)", border: "1px solid rgba(255,255,255,0.1)", backdropFilter: "blur(4px)" }}
              >
                <svg width="20" height="22" viewBox="0 0 20 22" fill="white" className="ml-1">
                  <path d="M2 2l16 9-16 9V2z"/>
                </svg>
              </div>
            </div>
          )}
        </div>

        {/* ── Controls ───────────────────────────────────────────────── */}
        <div
          className="shrink-0 transition-opacity duration-300"
          style={{
            opacity: showCtrl ? 1 : 0,
            background: "linear-gradient(0deg, rgba(0,0,0,0.96) 0%, rgba(0,0,0,0.75) 100%)",
            pointerEvents: showCtrl ? "auto" : "none",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Progress bar */}
          <div className="px-4 pt-3 pb-1">
            <div
              className="relative h-1 rounded-full cursor-pointer group"
              style={{ background: "rgba(255,255,255,0.10)" }}
              onClick={handleSeekClick}
            >
              {/* Filled */}
              <div
                className="absolute left-0 top-0 h-full rounded-full pointer-events-none"
                style={{ width: `${progress}%`, background: "#D95340" }}
              />
              {/* Thumb */}
              <div
                className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-white shadow-md opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
                style={{ left: `calc(${progress}% - 6px)`, boxShadow: "0 0 6px rgba(217,83,64,0.6)" }}
              />
            </div>
          </div>

          {/* Button row */}
          <div className="flex items-center gap-1.5 px-4 pb-3 pt-1">

            {/* Skip –15 */}
            <button
              onClick={() => skip(-15)}
              title="Voltar 15s (←)"
              className="w-8 h-8 flex items-center justify-center rounded-lg transition-colors"
              style={{ color: "#8F8883" }}
              onMouseEnter={(e) => e.currentTarget.style.color = "#F5F5F4"}
              onMouseLeave={(e) => e.currentTarget.style.color = "#8F8883"}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="1 4 1 10 7 10"/>
                <path d="M3.51 15a9 9 0 102.13-9.36L1 10"/>
              </svg>
            </button>

            {/* Play / Pause */}
            <button
              onClick={togglePlay}
              title={playing ? i18n.t("onboarding.videoPause") : i18n.t("onboarding.videoPlay")}
              className="w-9 h-9 rounded-full flex items-center justify-center transition-colors shrink-0"
              style={{ background: "#D95340" }}
              onMouseEnter={(e) => e.currentTarget.style.background = "#E07364"}
              onMouseLeave={(e) => e.currentTarget.style.background = "#D95340"}
            >
              {playing ? (
                <svg width="11" height="13" viewBox="0 0 11 13" fill="white">
                  <rect x="0.5" y="0.5" width="3.5" height="12" rx="1"/>
                  <rect x="7" y="0.5" width="3.5" height="12" rx="1"/>
                </svg>
              ) : (
                <svg width="12" height="14" viewBox="0 0 12 14" fill="white" style={{ marginLeft: 2 }}>
                  <path d="M1 1l10 6-10 6V1z"/>
                </svg>
              )}
            </button>

            {/* Skip +15 */}
            <button
              onClick={() => skip(15)}
              title={i18n.t("onboarding.videoForward15")}
              className="w-8 h-8 flex items-center justify-center rounded-lg transition-colors"
              style={{ color: "#8F8883" }}
              onMouseEnter={(e) => e.currentTarget.style.color = "#F5F5F4"}
              onMouseLeave={(e) => e.currentTarget.style.color = "#8F8883"}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="23 4 23 10 17 10"/>
                <path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/>
              </svg>
            </button>

            {/* Time */}
            <span className="text-[11px] font-mono tabular-nums ml-1" style={{ color: "#C2BEBC" }}>
              {fmt(current)}
            </span>
            <span className="text-[11px] font-mono tabular-nums" style={{ color: "#605A55" }}>/</span>
            <span className="text-[11px] font-mono tabular-nums" style={{ color: "#605A55" }}>
              {fmt(duration)}
            </span>

            <div className="flex-1" />

            {/* Volume */}
            <button
              onClick={toggleMute}
              title={muted || volume === 0 ? "Ativar som (M)" : "Mudo (M)"}
              className="w-7 h-7 flex items-center justify-center rounded-lg transition-colors"
              style={{ color: "#8F8883" }}
              onMouseEnter={(e) => e.currentTarget.style.color = "#F5F5F4"}
              onMouseLeave={(e) => e.currentTarget.style.color = "#8F8883"}
            >
              {muted || volume === 0 ? (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                  <path d="M11 5L6 9H2v6h4l5 4V5z"/>
                  <line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/>
                </svg>
              ) : (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                  <path d="M11 5L6 9H2v6h4l5 4V5z"/>
                  {volume > 0.4 ? <path d="M19.07 4.93a10 10 0 010 14.14"/> : null}
                  <path d="M15.54 8.46a5 5 0 010 7.07"/>
                </svg>
              )}
            </button>

            <input
              type="range"
              min={0} max={1} step={0.02}
              value={muted ? 0 : volume}
              onChange={(e) => setVol(parseFloat(e.target.value))}
              className="w-16 cursor-pointer"
              style={{ accentColor: "#D95340" }}
            />

            {/* Fullscreen */}
            <button
              onClick={toggleFull}
              title={fullscreen ? "Sair de tela cheia (F)" : "Tela cheia (F)"}
              className="w-7 h-7 flex items-center justify-center rounded-lg transition-colors ml-1"
              style={{ color: "#8F8883" }}
              onMouseEnter={(e) => e.currentTarget.style.color = "#F5F5F4"}
              onMouseLeave={(e) => e.currentTarget.style.color = "#8F8883"}
            >
              {fullscreen ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                  <path d="M8 3v3a2 2 0 01-2 2H3m18 0h-3a2 2 0 01-2-2V3m0 18v-3a2 2 0 012-2h3M3 16h3a2 2 0 012 2v3"/>
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                  <path d="M8 3H5a2 2 0 00-2 2v3m18 0V5a2 2 0 00-2-2h-3m0 18h3a2 2 0 002-2v-3M3 16v3a2 2 0 002 2h3"/>
                </svg>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
