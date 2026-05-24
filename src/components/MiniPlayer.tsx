import { useState, useRef, useEffect, useCallback } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { useAppStore, consumeAutoPlay } from "../store";

const PLAYER_BARS = 180;
const waveCache = new Map<string, number[]>();

// No WebView2 (Windows), createMediaElementSource captura o output do <audio>
// e o redireciona exclusivamente para o grafo Web Audio API, que não encaminha
// para os alto-falantes do sistema. Resultado: áudio silencioso.
// Solução: pular o AudioContext no Windows e usar playback nativo do HTML5.
const IS_WIN = navigator.platform.toLowerCase().startsWith("win") ||
               navigator.userAgent.toLowerCase().includes("windows");

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
  const { tracks, selectedIds, playerTrackId, setPlayerTrack, setIsPlayingGlobal, setPlayerPlayback } = useAppStore();
  const [isPlaying, setIsPlaying]   = useState(false);
  const [progress, setProgress]     = useState(0);
  const [duration, setDuration]     = useState(0);
  const [volume, setVolume]         = useState(0.8);
  const [coverUrl, setCoverUrl]     = useState<string | null>(null);
  const [waveBars, setWaveBars]     = useState<number[] | null>(null);
  const [hoverPct, setHoverPct]     = useState<number | null>(null);
  const [showVolume, setShowVolume] = useState(false);

  const audioRef     = useRef<HTMLAudioElement | null>(null);
  const loadedPath   = useRef<string | null>(null);
  const audioCtxRef  = useRef<AudioContext | null>(null);
  const analyserRef  = useRef<AnalyserNode | null>(null);
  const gainNodeRef  = useRef<GainNode | null>(null);
  const animFrameRef = useRef<number>(0);
  const liveCanvasRef = useRef<HTMLCanvasElement>(null);
  const waveBarsRef  = useRef<number[]>([]);   // always current waveform data for animation loop
  const volumePopupRef = useRef<HTMLDivElement>(null);
  const isPlayingRef = useRef(false);          // sync ref for effects that can't use stale state

  const selectedArr = [...selectedIds];
  const activeId    = playerTrackId ?? selectedArr[0] ?? null;
  const activeTrack = tracks.find((t) => t.id === activeId) ?? null;

  // Keep waveBarsRef in sync
  useEffect(() => { if (waveBars) waveBarsRef.current = waveBars; }, [waveBars]);

  // Keep isPlayingRef in sync + update global store
  useEffect(() => {
    isPlayingRef.current = isPlaying;
    setIsPlayingGlobal(isPlaying);
  }, [isPlaying, setIsPlayingGlobal]);

  // ── Audio Context helpers ─────────────────────────────────────────
  async function setupAudioCtx() {
    // Windows/WebView2: pula Web Audio API para evitar áudio silencioso.
    // O playback e volume funcionam nativamente via audioRef.current.
    if (IS_WIN) return;
    if (audioCtxRef.current || !audioRef.current) return;
    try {
      const ctx = new AudioContext();
      if (ctx.state === 'suspended') await ctx.resume();
      if (ctx.state !== 'running') { ctx.close().catch(() => {}); return; }
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.78;
      const gainNode = ctx.createGain();
      gainNode.gain.value = volume;
      const src = ctx.createMediaElementSource(audioRef.current);
      src.connect(analyser);
      analyser.connect(gainNode);
      gainNode.connect(ctx.destination);
      audioCtxRef.current = ctx;
      analyserRef.current = analyser;
      gainNodeRef.current = gainNode;
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
          const bars = waveBarsRef.current;
          const { playerProgress: pp, playerDuration: pd } = useAppStore.getState();
          const playedFrac = pd > 0 ? pp / pd : 0;
          for (let i = 0; i < PLAYER_BARS; i++) {
            const barFrac = i / PLAYER_BARS;
            if (barFrac < playedFrac) continue; // skip played section
            const s = Math.floor(i * step), e2 = Math.floor((i + 1) * step);
            let sum = 0;
            for (let j = s; j < e2; j++) sum += freqData[j];
            const beatAmp = sum / Math.max(1, e2 - s) / 255;
            if (beatAmp < 0.015) continue;
            const waveBase = bars.length > i ? bars[i] : 0.5;
            const finalAmp = waveBase * (0.4 + beatAmp * 0.6);
            const bh = Math.max(1.5, finalAmp * H * 0.85);
            const x = i * bw + bw * 0.15;
            const y = (H - bh) / 2;
            const w2 = bw * 0.7;
            c.fillStyle = `rgba(255, 130, 110, ${0.25 + finalAmp * 0.65})`;
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
  const VIDEO_EXTS = new Set(["mp4", "mkv", "avi", "mov", "wmv", "webm", "m4v"]);

  useEffect(() => {
    if (!audioRef.current) return;
    // Nunca tocar faixas de vídeo no MiniPlayer — vídeo tem player próprio
    if (activeTrack && VIDEO_EXTS.has((activeTrack.format ?? "").toLowerCase())) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      loadedPath.current = null;
      setIsPlaying(false);
      stopLiveAnim();
      return;
    }
    if (!activeTrack) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      loadedPath.current = null;
      setIsPlaying(false);
      stopLiveAnim();
      return;
    }
    const shouldAutoPlay = consumeAutoPlay();

    if (loadedPath.current === activeTrack.path) {
      // Same track: only start playing if autoPlay requested and not already playing
      if (shouldAutoPlay && !isPlayingRef.current) {
        setupAudioCtx().then(() => {
          audioRef.current?.play().catch(console.error);
          setIsPlaying(true);
          startLiveAnim();
        });
      }
      return;
    }

    // New track — stop current playback first, then load
    audioRef.current.pause();
    stopLiveAnim();
    loadedPath.current = activeTrack.path;
    const src = convertFileSrc(activeTrack.path);
    audioRef.current.src = src;
    audioRef.current.volume = volume;
    audioRef.current.load();
    setProgress(0);
    setDuration(0);

    if (isPlayingRef.current || shouldAutoPlay) {
      const startPlayback = () => {
        setIsPlaying(true);
        startLiveAnim();
      };
      // Await AudioContext resume BEFORE play to prevent silent audio on Windows
      setupAudioCtx().then(() => {
        audioRef.current!.play()
          .then(startPlayback)
          .catch(() => {
            audioRef.current?.addEventListener('canplay', () => {
              audioRef.current?.play().then(startPlayback).catch(console.error);
            }, { once: true });
          });
      });
    } else {
      setIsPlaying(false);
    }

    // Cover
    if (activeTrack.has_cover) {
      invoke<string | null>("read_cover_base64", { path: activeTrack.path })
        .then((b64) => setCoverUrl(b64 ? `data:image/jpeg;base64,${b64}` : null))
        .catch(() => setCoverUrl(null));
    } else {
      setCoverUrl(null);
    }

    // Waveform
    const cached = waveCache.get(activeTrack.path);
    if (cached) { waveBarsRef.current = cached; setWaveBars(cached); return; }
    setWaveBars(null);
    invoke<number[]>("generate_waveform", { path: activeTrack.path, bars: PLAYER_BARS })
      .then((data) => { waveCache.set(activeTrack.path, data); waveBarsRef.current = data; setWaveBars(data); })
      .catch(() => {
        const fb = makeFallback(activeTrack.path);
        waveCache.set(activeTrack.path, fb);
        waveBarsRef.current = fb;
        setWaveBars(fb);
      });
  // playerTrackId added so double-click on already-selected track re-triggers play
  }, [activeTrack?.id, playerTrackId]);

  // ── Audio event listeners ─────────────────────────────────────────
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onTime = () => {
      setProgress(audio.currentTime);
      setPlayerPlayback(audio.currentTime, isFinite(audio.duration) ? audio.duration : 0);
    };
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

  // ── Volume popup: close on outside click ─────────────────────────
  useEffect(() => {
    if (!showVolume) return;
    const handler = (e: MouseEvent) => {
      if (volumePopupRef.current && !volumePopupRef.current.contains(e.target as Node)) {
        setShowVolume(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showVolume]);

  // ── Keyboard shortcuts ────────────────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA") return;
      if (showVolume && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        e.preventDefault();
        const delta = e.key === "ArrowUp" ? 0.05 : -0.05;
        const v = Math.max(0, Math.min(1, volume + delta));
        setVolume(v);
        if (gainNodeRef.current) gainNodeRef.current.gain.value = v;
        if (audioRef.current) audioRef.current.volume = v;
        return;
      }
      if (e.key === " ")               { e.preventDefault(); togglePlay(); }
      else if (e.key === "ArrowRight") { e.preventDefault(); skipTrack(1); }
      else if (e.key === "ArrowLeft")  { e.preventDefault(); skipTrack(-1); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeTrack, isPlaying, showVolume, volume]);

  async function togglePlay() {
    if (!audioRef.current || !activeTrack) return;
    if (!playerTrackId && selectedArr[0]) setPlayerTrack(selectedArr[0]);
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
      stopLiveAnim();
    } else {
      await setupAudioCtx();
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


  function fmt(s: number) {
    if (!isFinite(s) || s < 0) return "0:00";
    return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  }

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cancelAnimationFrame(animFrameRef.current);
      audioCtxRef.current?.close().catch(() => {});
    };
  }, []);

  const pct = duration > 0 ? (progress / duration) * 100 : 0;
  const displayBars = waveBars ?? makeFallback(activeTrack?.path ?? "");

  const BAR_W    = 1.0;
  const BAR_GAP  = 2.0;
  const BAR_STRIDE = BAR_W + BAR_GAP;
  const VB_W    = PLAYER_BARS * BAR_STRIDE;
  const VB_H    = 40;

  // Volume icon: muted/low/high
  const volMuted = volume === 0;
  const volIcon = (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <path d="M1.5 4.5h2L6 2v8L3.5 7.5H1.5V4.5z" fill="currentColor"/>
      {!volMuted && volume > 0.01 && (
        <path d="M8 3.5a3.5 3.5 0 010 5" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
      )}
      {!volMuted && volume > 0.5 && (
        <path d="M9.5 2a5.5 5.5 0 010 8" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
      )}
      {volMuted && (
        <>
          <path d="M8.5 4.5L11 7" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
          <path d="M11 4.5L8.5 7" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
        </>
      )}
    </svg>
  );

  return (
    <div className="bg-[#0E0D0C] select-none">
      <audio ref={audioRef} />

      {/* Progress line at top */}
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
            <p className="text-[9px] text-[#8F8883] truncate leading-none mt-[3px] tracking-wide uppercase">
              {activeTrack?.artist ?? ""}
            </p>
          </div>
        </div>

        {/* Separador */}
        <div className="w-px h-6 bg-[#23201E] shrink-0" />

        {/* ── ZONA 2: Controles de transporte ──────────────────── */}
        <div className="flex items-center gap-3.5 px-5 shrink-0">
          <button onClick={() => skipTrack(-1)} disabled={!activeTrack}
            className="text-[#756D67] hover:text-[#A8A3A0] disabled:opacity-25 transition-colors">
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
            className="text-[#756D67] hover:text-[#A8A3A0] disabled:opacity-25 transition-colors">
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
          <span className="text-[10px] text-[#C97B40] font-mono tabular-nums shrink-0 w-7 text-right font-semibold">
            {fmt(progress)}
          </span>

          <div
            className="relative flex-1 cursor-pointer group"
            style={{ height: 40 }}
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
                const barH   = Math.max(2, amp * (VB_H - 4));
                const y      = (VB_H - barH) / 2;
                const barPct = i / PLAYER_BARS;
                const played  = pct > 0 && barPct < pct / 100;
                const hovered = hoverPct !== null && barPct >= pct / 100 && barPct < hoverPct;
                return (
                  <rect
                    key={i}
                    x={i * BAR_STRIDE}
                    y={y}
                    width={BAR_W}
                    height={barH}
                    rx={0.6}
                    fill="#D95340"
                    opacity={
                      played  ? 0.55 + amp * 0.45  :   // tocado → brilhante (já percorrido)
                      hovered ? 0.25 + amp * 0.20  :   // hover na zona não tocada
                      0.05 + amp * 0.12              // não tocado → escuro (a percorrer)
                    }
                  />
                );
              })}
            </svg>

            {/* Live beat canvas — pulsa em cima das barras não tocadas */}
            <canvas
              ref={liveCanvasRef}
              className="absolute inset-0 w-full h-full pointer-events-none"
              width={PLAYER_BARS * 4}
              height={VB_H}
            />

            {/* Playhead — linha branca nítida */}
            {pct > 0 && (
              <div
                className="absolute top-1 bottom-1 pointer-events-none rounded-full"
                style={{
                  left: `calc(${pct}% - 1px)`,
                  width: "2px",
                  background: "white",
                  boxShadow: "0 0 6px rgba(255,255,255,0.7), 0 0 2px white",
                }}
              />
            )}

            {/* Hover tooltip */}
            {hoverPct !== null && duration > 0 && (
              <div
                className="absolute bottom-full mb-1 -translate-x-1/2 px-1.5 py-0.5 rounded bg-[#1c1715] border border-white/[0.08] text-[9px] font-mono text-[#C2BEBC] pointer-events-none whitespace-nowrap z-10"
                style={{ left: `${hoverPct * 100}%` }}
              >
                {fmt(hoverPct * duration)}
              </div>
            )}
          </div>

          <span className="text-[10px] text-[#C97B40] font-mono tabular-nums shrink-0 w-7 font-semibold">
            {fmt(duration)}
          </span>

          {/* Volume inline — ícone + slider horizontal */}
          <div className="flex items-center gap-1.5 shrink-0 ml-1" ref={volumePopupRef}>
            <button
              onClick={() => setShowVolume((v) => !v)}
              className={`transition-colors ${showVolume ? "text-[#C97B40]" : "text-[#605A55] hover:text-[#8F8883]"}`}
              title={`Volume: ${Math.round(volume * 100)}%`}
            >
              {volIcon}
            </button>

            {/* Slider horizontal compacto */}
            <div
              className="relative w-14 cursor-pointer"
              style={{ height: 12 }}
              onMouseDown={(e) => {
                e.preventDefault();
                const trackEl = e.currentTarget;
                const applyV = (clientX: number) => {
                  const rect = trackEl.getBoundingClientRect();
                  const v = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
                  setVolume(v);
                  if (gainNodeRef.current) gainNodeRef.current.gain.value = v;
                  if (audioRef.current) audioRef.current.volume = v;
                };
                applyV(e.clientX);
                const onMove = (mv: MouseEvent) => applyV(mv.clientX);
                const onUp = () => { document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp); };
                document.addEventListener("mousemove", onMove);
                document.addEventListener("mouseup", onUp);
              }}
            >
              <div className="absolute inset-y-[5px] inset-x-0 rounded-full bg-[#23201E]" />
              <div
                className="absolute inset-y-[5px] left-0 rounded-full bg-[#C97B40]/60 transition-none"
                style={{ width: `${volume * 100}%` }}
              />
              <div
                className="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full bg-[#C97B40] shadow-md transition-none"
                style={{ left: `calc(${volume * 100}% - 5px)` }}
              />
            </div>
          </div>
        </div>

        {/* Separador */}
        <div className="w-px h-6 bg-[#23201E] shrink-0" />

        {/* ── ZONA 4: BPM · Tom ────────────────────────────────── */}
        <div className="flex items-center gap-3 pl-5 shrink-0">
          {activeTrack?.bpm && (
            <div className="flex items-center gap-1">
              <span className="text-[10px] font-mono tabular-nums text-[#C97B40] font-semibold">
                {parseFloat(activeTrack.bpm).toFixed(0)}
              </span>
              <span className="text-[8px] text-[#605A55] uppercase tracking-widest">bpm</span>
            </div>
          )}
          {activeTrack?.key && (
            <span className="text-[9px] font-mono font-bold text-[#8F8883]">
              {activeTrack.key}
            </span>
          )}
        </div>

      </div>
    </div>
  );
}
