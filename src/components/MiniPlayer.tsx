import { useState, useRef, useEffect, useCallback } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { useAppStore, consumeAutoPlay } from "../store";

const PLAYER_BARS = 130;
const waveCache = new Map<string, number[]>();

function strHash(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h) ^ s.charCodeAt(i);
  return Math.abs(h);
}

function makeFallback(path: string): number[] {
  const seed = strHash(path);
  return Array.from({ length: PLAYER_BARS }, (_, i) => {
    const t = i / PLAYER_BARS;
    const a = 0.3 + 0.4 * Math.abs(Math.sin((seed % 100) * 0.07 + t * 6.28));
    const b = 0.1 + 0.3 * Math.abs(Math.sin((seed % 77) * 0.13 + t * 12.1));
    const c = 0.05 * Math.abs(Math.sin(t * 31 + seed % 17));
    return Math.min(1, a + b + c);
  });
}

export default function MiniPlayer() {
  const { tracks, selectedIds, playerTrackId, setPlayerTrack } = useAppStore();
  const [isPlaying, setIsPlaying]   = useState(false);
  const [progress, setProgress]     = useState(0);
  const [duration, setDuration]     = useState(0);
  const [volume, setVolume]         = useState(0.8);
  const [coverUrl, setCoverUrl]     = useState<string | null>(null);
  const [waveBars, setWaveBars]     = useState<number[] | null>(null);
  const [hoverPct, setHoverPct]     = useState<number | null>(null);
  const audioRef   = useRef<HTMLAudioElement | null>(null);
  const loadedPath = useRef<string | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number>(0);
  const liveCanvasRef = useRef<HTMLCanvasElement>(null);

  const selectedArr = [...selectedIds];
  const activeId    = playerTrackId ?? selectedArr[0] ?? null;
  const activeTrack = tracks.find((t) => t.id === activeId) ?? null;

  // ── Audio Context helpers ─────────────────────────────────────────
  function setupAudioCtx() {
    if (audioCtxRef.current || !audioRef.current) return;
    try {
      const ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.78;
      const src = ctx.createMediaElementSource(audioRef.current);
      src.connect(analyser);
      analyser.connect(ctx.destination);
      audioCtxRef.current = ctx;
      analyserRef.current = analyser;
    } catch { /* silent */ }
  }

  function startLiveAnim() {
    const analyser = analyserRef.current;
    if (!analyser) return;
    const fftBins = analyser.frequencyBinCount;
    const freqData = new Uint8Array(fftBins);
    const step = fftBins / PLAYER_BARS;
    function tick() {
      analyser!.getByteFrequencyData(freqData);
      const canvas = liveCanvasRef.current;
      if (canvas) {
        const c = canvas.getContext('2d');
        if (c) {
          c.clearRect(0, 0, canvas.width, canvas.height);
          const W = canvas.width; const H = canvas.height;
          const bw = W / PLAYER_BARS;
          for (let i = 0; i < PLAYER_BARS; i++) {
            const s = Math.floor(i * step), e2 = Math.floor((i + 1) * step);
            let sum = 0;
            for (let j = s; j < e2; j++) sum += freqData[j];
            const amp = sum / Math.max(1, e2 - s) / 255;
            if (amp < 0.015) continue;
            const bh = amp * H * 0.88;
            const x = i * bw + bw * 0.12;
            const y = (H - bh) / 2;
            const w2 = bw * 0.76;
            c.fillStyle = `rgba(255, 148, 128, ${0.18 + amp * 0.65})`;
            c.beginPath();
            if (c.roundRect) c.roundRect(x, y, w2, bh, 1);
            else c.rect(x, y, w2, bh);
            c.fill();
          }
        }
      }
      animFrameRef.current = requestAnimationFrame(tick);
    }
    cancelAnimationFrame(animFrameRef.current);
    tick();
  }

  function stopLiveAnim() {
    cancelAnimationFrame(animFrameRef.current);
    const c = liveCanvasRef.current?.getContext('2d');
    if (c && liveCanvasRef.current) c.clearRect(0, 0, liveCanvasRef.current.width, liveCanvasRef.current.height);
  }

  // ── Load track ────────────────────────────────────────────────────
  useEffect(() => {
    if (!activeTrack || !audioRef.current) return;
    const shouldAutoPlay = consumeAutoPlay();
    if (loadedPath.current === activeTrack.path) {
      if (shouldAutoPlay) {
        setupAudioCtx();
        if (audioCtxRef.current?.state === 'suspended') audioCtxRef.current.resume().catch(() => {});
        audioRef.current.play().catch(console.error);
        setIsPlaying(true);
        startLiveAnim();
      }
      return;
    }
    loadedPath.current = activeTrack.path;
    const src = convertFileSrc(activeTrack.path);
    audioRef.current.src = src;
    audioRef.current.volume = volume;
    audioRef.current.load();
    setProgress(0);
    setDuration(0);
    if (isPlaying || shouldAutoPlay) {
      setupAudioCtx();
      if (audioCtxRef.current?.state === 'suspended') audioCtxRef.current.resume().catch(() => {});
      audioRef.current.play().catch(console.error);
      setIsPlaying(true);
      startLiveAnim();
    }

    if (activeTrack.has_cover) {
      invoke<string | null>("read_cover_base64", { path: activeTrack.path })
        .then((b64) => setCoverUrl(b64 ? `data:image/jpeg;base64,${b64}` : null))
        .catch(() => setCoverUrl(null));
    } else {
      setCoverUrl(null);
    }

    // Waveform
    const cached = waveCache.get(activeTrack.path);
    if (cached) { setWaveBars(cached); return; }
    setWaveBars(null);
    invoke<number[]>("generate_waveform", { path: activeTrack.path, bars: PLAYER_BARS })
      .then((data) => { waveCache.set(activeTrack.path, data); setWaveBars(data); })
      .catch(() => {
        const fb = makeFallback(activeTrack.path);
        waveCache.set(activeTrack.path, fb);
        setWaveBars(fb);
      });
  }, [activeTrack?.id]);

  // ── Audio event listeners ─────────────────────────────────────────
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onTime = () => setProgress(audio.currentTime);
    const onDur  = () => setDuration(isFinite(audio.duration) ? audio.duration : 0);
    const onEnd  = () => {
      setProgress(0);
      stopLiveAnim();
      const { tracks: all, playerTrackId: cur } = useAppStore.getState();
      if (cur) {
        const idx = all.findIndex((t) => t.id === cur);
        const next = all[idx + 1];
        if (next) { useAppStore.getState().setPlayerTrack(next.id); return; }
      }
      setIsPlaying(false);
    };
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("loadedmetadata", onDur);
    audio.addEventListener("ended", onEnd);
    return () => {
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("loadedmetadata", onDur);
      audio.removeEventListener("ended", onEnd);
    };
  }, []);

  // ── Keyboard shortcuts ────────────────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA") return;
      if (e.key === " ")               { e.preventDefault(); togglePlay(); }
      else if (e.key === "ArrowRight") { e.preventDefault(); skipTrack(1); }
      else if (e.key === "ArrowLeft")  { e.preventDefault(); skipTrack(-1); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeTrack, isPlaying]);

  function togglePlay() {
    if (!audioRef.current || !activeTrack) return;
    if (!playerTrackId && selectedArr[0]) setPlayerTrack(selectedArr[0]);
    setupAudioCtx();
    if (audioCtxRef.current?.state === 'suspended') audioCtxRef.current.resume().catch(() => {});
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
      stopLiveAnim();
    } else {
      audioRef.current.play().catch(console.error);
      setIsPlaying(true);
      startLiveAnim();
    }
  }

  function skipTrack(dir: 1 | -1) {
    if (!activeTrack) return;
    const idx = tracks.findIndex((t) => t.id === activeTrack.id);
    const next = tracks[idx + dir];
    if (next) { setPlayerTrack(next.id); setIsPlaying(true); }
  }

  const handleSeek = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!audioRef.current || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const t = ((e.clientX - rect.left) / rect.width) * duration;
    audioRef.current.currentTime = t;
    setProgress(t);
  }, [duration]);

  function handleVolume(e: React.MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const v = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    setVolume(v);
    if (audioRef.current) audioRef.current.volume = v;
  }

  function fmt(s: number) {
    if (!isFinite(s) || s < 0) return "0:00";
    return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  }

  // ── Cleanup AudioContext on unmount ───────────────────────────────
  useEffect(() => {
    return () => {
      cancelAnimationFrame(animFrameRef.current);
      audioCtxRef.current?.close().catch(() => {});
    };
  }, []);

  const pct = duration > 0 ? (progress / duration) * 100 : 0;
  const displayBars = waveBars ?? makeFallback(activeTrack?.path ?? "");

  // Bars viewBox dimensions
  const BAR_W = 1.5;
  const BAR_GAP = 0.8;
  const BAR_STRIDE = BAR_W + BAR_GAP;
  const VB_W = PLAYER_BARS * BAR_STRIDE;
  const VB_H = 32;

  return (
    <div className="bg-[#0E0D0C] select-none">
      <audio ref={audioRef} />

      {/* ── Linha de progresso no topo — assinatura visual do DS ── */}
      <div className="h-px bg-[#23201E]">
        <div className="h-full bg-[#D95340] transition-none" style={{ width: `${pct}%` }} />
      </div>

      <div className="flex items-center h-14 px-5 gap-0">

        {/* ── ZONA 1: Capa + Info ───────────────────────────────── */}
        <div className="flex items-center gap-3 w-56 shrink-0 min-w-0 pr-5">
          <span className={`w-[5px] h-[5px] rounded-full shrink-0 transition-colors ${
            isPlaying ? "bg-[#D95340]" : "bg-[#373331]"
          }`} />

          <div className="shrink-0 w-7 h-7 rounded overflow-hidden bg-[#23201E] border border-white/[0.05] flex items-center justify-center">
            {coverUrl
              ? <img src={coverUrl} alt="" className="w-full h-full object-cover" />
              : <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="#373331" strokeWidth="1.1" strokeLinecap="round">
                  <circle cx="5" cy="4.5" r="2"/><path d="M1 9.5c0-2.21 1.79-4 4-4s4 1.79 4 4"/>
                </svg>
            }
          </div>

          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold text-[#DCDAD8] truncate leading-tight tracking-[-0.01em]">
              {activeTrack?.title ?? activeTrack?.filename ?? <span className="text-[#373331] font-normal italic">sem faixa</span>}
            </p>
            <p className="text-[9px] text-[#605A55] truncate leading-none mt-[3px] tracking-wide uppercase">
              {activeTrack?.artist ?? ""}
            </p>
          </div>
        </div>

        {/* Separador */}
        <div className="w-px h-6 bg-[#23201E] shrink-0" />

        {/* ── ZONA 2: Controles de transporte ──────────────────── */}
        <div className="flex items-center gap-3.5 px-5 shrink-0">
          <button onClick={() => skipTrack(-1)} disabled={!activeTrack}
            className="text-[#4C4743] hover:text-[#756D67] disabled:opacity-25 transition-colors">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
              <rect x="1" y="1" width="1.5" height="10" rx="0.5"/>
              <path d="M10.5 1.5L4 6l6.5 4.5V1.5z"/>
            </svg>
          </button>

          <button
            onClick={togglePlay}
            disabled={!activeTrack}
            className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 transition-all duration-150 disabled:opacity-25 ${
              isPlaying
                ? "bg-[#D95340] shadow-[0_0_12px_rgba(217,83,64,0.35)]"
                : "bg-transparent border border-[#D95340]/70 hover:border-[#D95340] hover:bg-[#D95340]/8"
            }`}
          >
            {isPlaying
              ? <svg width="8" height="9" viewBox="0 0 8 9" fill="white">
                  <rect x="0.5" y="0.5" width="2.5" height="8" rx="0.5"/>
                  <rect x="5" y="0.5" width="2.5" height="8" rx="0.5"/>
                </svg>
              : <svg width="8" height="9" viewBox="0 0 8 9" fill="#D95340" style={{ marginLeft: "1px" }}>
                  <path d="M1 0.5L7.5 4.5 1 8.5V0.5z"/>
                </svg>
            }
          </button>

          <button onClick={() => skipTrack(1)} disabled={!activeTrack}
            className="text-[#4C4743] hover:text-[#756D67] disabled:opacity-25 transition-colors">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
              <rect x="9.5" y="1" width="1.5" height="10" rx="0.5"/>
              <path d="M1.5 1.5L8 6 1.5 10.5V1.5z"/>
            </svg>
          </button>
        </div>

        {/* Separador */}
        <div className="w-px h-6 bg-[#23201E] shrink-0" />

        {/* ── ZONA 3: Waveform seekável ─────────────────────────── */}
        <div className="flex items-center gap-3 flex-1 min-w-0 px-5">
          {/* Tempo decorrido */}
          <span className="text-[9px] text-[#4C4743] font-mono tabular-nums shrink-0 w-7 text-right">
            {fmt(progress)}
          </span>

          {/* Waveform */}
          <div
            className="relative flex-1 h-9 cursor-pointer group"
            onClick={handleSeek}
            onMouseMove={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              setHoverPct((e.clientX - rect.left) / rect.width);
            }}
            onMouseLeave={() => setHoverPct(null)}
          >
            <svg
              width="100%"
              height="100%"
              viewBox={`0 0 ${VB_W} ${VB_H}`}
              preserveAspectRatio="none"
              className="absolute inset-0"
            >
              {displayBars.map((amp, i) => {
                const barH  = Math.max(1.5, amp * (VB_H - 2));
                const y     = (VB_H - barH) / 2;
                const barPct = i / PLAYER_BARS;
                const played = pct > 0 && barPct < pct / 100;
                const hovered = hoverPct !== null && barPct < hoverPct && !played;
                return (
                  <rect
                    key={i}
                    x={i * BAR_STRIDE}
                    y={y}
                    width={BAR_W}
                    height={barH}
                    rx={0.5}
                    fill={
                      played  ? "#D95340" :
                      hovered ? "#605A55" :
                      "#2A2623"
                    }
                    opacity={
                      played  ? 0.35 + amp * 0.65 :
                      hovered ? 0.5 + amp * 0.5 :
                      0.25 + amp * 0.4
                    }
                  />
                );
              })}
            </svg>

            {/* Live beat canvas */}
            <canvas
              ref={liveCanvasRef}
              className="absolute inset-0 w-full h-full pointer-events-none"
              width={PLAYER_BARS * 5}
              height={36}
            />

            {/* Playhead vertical */}
            {pct > 0 && (
              <div
                className="absolute top-1 bottom-1 w-px bg-white/30 pointer-events-none"
                style={{ left: `${pct}%` }}
              />
            )}

            {/* Hover time tooltip */}
            {hoverPct !== null && duration > 0 && (
              <div
                className="absolute bottom-full mb-1 -translate-x-1/2 px-1.5 py-0.5 rounded bg-[#1c1715] border border-white/[0.08] text-[9px] font-mono text-[#C2BEBC] pointer-events-none whitespace-nowrap z-10"
                style={{ left: `${hoverPct * 100}%` }}
              >
                {fmt(hoverPct * duration)}
              </div>
            )}
          </div>

          {/* Duração total */}
          <span className="text-[9px] text-[#4C4743] font-mono tabular-nums shrink-0 w-7">
            {fmt(duration)}
          </span>
        </div>

        {/* Separador */}
        <div className="w-px h-6 bg-[#23201E] shrink-0" />

        {/* ── ZONA 4: BPM · Tom · Volume ───────────────────────── */}
        <div className="flex items-center gap-3 pl-5 shrink-0">
          {/* BPM + Tom (quando disponíveis) */}
          {activeTrack?.bpm && (
            <div className="flex items-center gap-1.5">
              <span className="text-[9px] font-mono tabular-nums text-[#4C4743]">
                {parseFloat(activeTrack.bpm).toFixed(0)}
              </span>
              <span className="text-[8px] text-[#373331] uppercase tracking-widest">bpm</span>
            </div>
          )}
          {activeTrack?.key && (
            <span className="text-[9px] font-mono font-bold text-[#605A55]">
              {activeTrack.key}
            </span>
          )}

          {/* Volume */}
          <svg width="9" height="9" viewBox="0 0 9 9" fill="none">
            <path d="M1 3h1.6L5 1v7L2.6 6H1V3z" fill="#4C4743"/>
            <path d="M6.5 2.5a2.5 2.5 0 010 4" stroke="#4C4743" strokeWidth="0.8" strokeLinecap="round" fill="none"/>
          </svg>

          <div onClick={handleVolume}
            className="relative w-14 h-5 flex items-center cursor-pointer group">
            <div className="absolute inset-x-0 h-px bg-[#23201E] rounded-full" />
            <div className="absolute left-0 h-px bg-[#605A55] group-hover:bg-[#756D67] transition-colors rounded-full"
              style={{ width: `${volume * 100}%` }} />
            <div
              className="absolute w-[5px] h-[5px] rounded-full bg-[#4C4743] group-hover:bg-[#756D67] -translate-x-1/2 transition-colors"
              style={{ left: `${volume * 100}%` }}
            />
          </div>
        </div>

      </div>
    </div>
  );
}
