import { useState, useRef, useEffect, useCallback } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { useAppStore, consumeAutoPlay, Track } from "../store";
import { loadWaveform, setCachedWaveform, getCachedWaveform, WAVEFORM_BARS } from "../lib/waveformCache";
import { globalAudio } from "../lib/globalAudio";

const PLAYER_BARS = WAVEFORM_BARS;

const IS_WIN = navigator.platform.toLowerCase().startsWith("win") ||
               navigator.userAgent.toLowerCase().includes("windows");

interface WaveBarRGB { amp: number; bass: number; treble: number; }
// waveCache local removido — usa waveformCache compartilhado

function strHash(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h) ^ s.charCodeAt(i);
  return Math.abs(h);
}

function makeFallback(path: string): WaveBarRGB[] {
  const seed = strHash(path);
  return Array.from({ length: PLAYER_BARS }, (_, i) => {
    const t = i / PLAYER_BARS;
    const amp = Math.min(1, 0.3 + 0.4 * Math.abs(Math.sin((seed % 100) * 0.07 + t * 6.28))
                            + 0.1 * Math.abs(Math.sin((seed % 77) * 0.13 + t * 12.1)));
    return { amp, bass: 0.5, treble: 0.3 };
  });
}


function fmt(s: number) {
  if (!isFinite(s) || s < 0) return "0:00";
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}

const WF_EXPANDED = 68;

export default function MiniPlayer({ displayTracks }: { displayTracks?: Track[] }) {
  const { tracks, selectedIds, playerTrackId, playerTrackNonce, setPlayerTrack, setIsPlayingGlobal, setPlayerPlayback, seekRequest, oneShotRequest, scrubSeekRequest, playRequest } = useAppStore();
  // setCueEditorTrack desativada na produção
  const [isPlaying, setIsPlaying]   = useState(false);
  const [progress, setProgress]     = useState(0);
  const [duration, setDuration]     = useState(0);
  const [volume, setVolume]         = useState(0.8);
  const [coverUrl, setCoverUrl]     = useState<string | null>(null);
  const [waveBars, setWaveBars]     = useState<WaveBarRGB[] | null>(null);
  const [hoverPct, setHoverPct]     = useState<number | null>(null);
  const wfExpanded = true;

  const audioRef     = useRef<HTMLAudioElement | null>(null);
  const loadedPath   = useRef<string | null>(null);
  const audioCtxRef  = useRef<AudioContext | null>(null);
  const analyserRef  = useRef<AnalyserNode | null>(null);
  const gainNodeRef  = useRef<GainNode | null>(null);
  const animFrameRef = useRef<number>(0);
  const liveCanvasRef = useRef<HTMLCanvasElement>(null);
  const waveBarsRef  = useRef<WaveBarRGB[]>([]);
  const isPlayingRef     = useRef(false);
  const wfRef            = useRef<SVGSVGElement>(null);
  const oneShotTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrubRef         = useRef(false);
  const scrubTimerRef    = useRef<ReturnType<typeof setTimeout> | null>(null);

  const selectedArr = [...selectedIds];
  const activeId    = playerTrackId ?? selectedArr[0] ?? null;
  const activeTrack = tracks.find((t) => t.id === activeId) ?? null;

  const wfH       = WF_EXPANDED;
  const windowDur = duration;
  const winStart  = 0;
  const barStart  = 0;
  const barEnd    = PLAYER_BARS;
  const winPct    = duration > 0 ? Math.max(0, Math.min(1, progress / duration)) : 0;
  const BAR_W     = 0.8;
  const BAR_GAP   = 1.2;
  const BAR_STR   = BAR_W + BAR_GAP;

  useEffect(() => { if (waveBars) waveBarsRef.current = waveBars; }, [waveBars]);
  useEffect(() => { isPlayingRef.current = isPlaying; setIsPlayingGlobal(isPlaying); }, [isPlaying, setIsPlayingGlobal]);

  async function setupAudioCtx() {
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
      src.connect(analyser); analyser.connect(gainNode); gainNode.connect(ctx.destination);
      audioCtxRef.current = ctx; analyserRef.current = analyser; gainNodeRef.current = gainNode;
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
          const pf = pd > 0 ? pp / pd : 0;
          for (let i = 0; i < PLAYER_BARS; i++) {
            const isPlayed = i / PLAYER_BARS < pf;
            const s = Math.floor(i * step), e2 = Math.floor((i + 1) * step);
            let sum = 0;
            for (let j = s; j < e2; j++) sum += freqData[j];
            const beatAmp = sum / Math.max(1, e2 - s) / 255;
            if (beatAmp < 0.01) continue;
            const waveBase = bars.length > i ? bars[i].amp : 0.5;
            const finalAmp = waveBase * (0.4 + beatAmp * 0.6);
            const bh = Math.max(1.5, finalAmp * H * 0.85);
            const x = i * bw + bw * 0.15;
            const alpha = isPlayed ? 0.08 + finalAmp * 0.12 : 0.22 + finalAmp * 0.55;
            c.fillStyle = `rgba(217,83,64,${alpha})`;
            c.beginPath();
            if (c.roundRect) c.roundRect(x, (H - bh) / 2, bw * 0.7, bh, 0.5);
            else c.rect(x, (H - bh) / 2, bw * 0.7, bh);
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

  const VIDEO_EXTS = new Set(["mp4","mkv","avi","mov","wmv","webm","m4v"]);

  useEffect(() => {
    if (!audioRef.current) return;
    if (!activeTrack || VIDEO_EXTS.has((activeTrack.format ?? "").toLowerCase())) {
      audioRef.current.pause(); audioRef.current.currentTime = 0;
      loadedPath.current = null; setIsPlaying(false); stopLiveAnim(); return;
    }
    const shouldAutoPlay = consumeAutoPlay();
    if (loadedPath.current === activeTrack.path) {
      if (shouldAutoPlay && !isPlayingRef.current) {
        setupAudioCtx().then(() => {
          const audio = audioRef.current;
          if (!audio) return;
          const doPlay = () => {
            audio.play()
              .then(() => { setIsPlaying(true); startLiveAnim(); })
              .catch((err) => {
                if ((err as DOMException)?.name === 'AbortError' || audio.readyState < 2) {
                  audio.addEventListener('canplay', () => {
                    audio.play().then(() => { setIsPlaying(true); startLiveAnim(); }).catch(console.error);
                  }, { once: true });
                }
              });
          };
          if (audio.readyState >= 2) doPlay();
          else audio.addEventListener('canplay', doPlay, { once: true });
        });
      }
      return;
    }
    audioRef.current.pause(); stopLiveAnim();
    loadedPath.current = activeTrack.path;
    audioRef.current.src = convertFileSrc(activeTrack.path);
    audioRef.current.volume = volume;
    audioRef.current.load();
    setProgress(0); setDuration(0);
    if (isPlayingRef.current || shouldAutoPlay) {
      setupAudioCtx().then(() => {
        const attemptPlay = () => {
          const audio = audioRef.current;
          if (!audio) return;
          audio.play()
            .then(() => { setIsPlaying(true); startLiveAnim(); })
            .catch((err) => {
              // AbortError = load() interrupted play(); retry after canplay
              if ((err as DOMException)?.name === 'AbortError' || audio.readyState < 2) {
                audio.addEventListener('canplay', () => {
                  audio.play().then(() => { setIsPlaying(true); startLiveAnim(); }).catch(console.error);
                }, { once: true });
              } else {
                console.error('[MiniPlayer] play error:', err);
              }
            });
        };
        // If already have enough data, play immediately; otherwise wait for canplay
        if (audioRef.current && audioRef.current.readyState >= 2) {
          attemptPlay();
        } else {
          audioRef.current?.addEventListener('canplay', attemptPlay, { once: true });
        }
      });
    } else { setIsPlaying(false); }

    if (activeTrack.has_cover) {
      invoke<string | null>("read_cover_base64", { path: activeTrack.path })
        .then((b64) => setCoverUrl(b64 ? `data:image/jpeg;base64,${b64}` : null))
        .catch(() => setCoverUrl(null));
    } else { setCoverUrl(null); }

    const hit = getCachedWaveform(activeTrack.path);
    if (hit) {
      const rgb: WaveBarRGB[] = hit.map(b => ({ amp: b.amp, bass: b.bass, treble: b.treble }));
      waveBarsRef.current = rgb; setWaveBars(rgb); return;
    }
    setWaveBars(null);
    loadWaveform(activeTrack.path)
      .then((bars) => {
        if (!bars) throw new Error();
        const rgb: WaveBarRGB[] = bars.map(b => ({ amp: b.amp, bass: b.bass, treble: b.treble }));
        setCachedWaveform(activeTrack.path, bars);
        waveBarsRef.current = rgb;
        setWaveBars(rgb);
      })
      .catch(() => {
        const fb = makeFallback(activeTrack.path);
        waveBarsRef.current = fb;
        setWaveBars(fb);
      });
  }, [activeTrack?.id, playerTrackId, playerTrackNonce]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onTime = () => { setProgress(audio.currentTime); setPlayerPlayback(audio.currentTime, isFinite(audio.duration) ? audio.duration : 0); };
    const onDur  = () => setDuration(isFinite(audio.duration) ? audio.duration : 0);
    const onEnd  = () => {
      setProgress(0); stopLiveAnim();
      const { tracks: all, playerTrackId: cur } = useAppStore.getState();
      if (cur) { const idx = all.findIndex((t) => t.id === cur); const next = all[idx+1]; if (next) { useAppStore.getState().setPlayerTrack(next.id); return; } }
      setIsPlaying(false);
    };
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("loadedmetadata", onDur);
    audio.addEventListener("ended", onEnd);
    return () => { audio.removeEventListener("timeupdate", onTime); audio.removeEventListener("loadedmetadata", onDur); audio.removeEventListener("ended", onEnd); };
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA") return;
      if (e.key === " ") {
        e.preventDefault();
        togglePlay();
      } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const { tracks: all, selectedIds: sel, clearSelection, toggleSelect } = useAppStore.getState();
        const selArr = [...sel];
        const anchorId = selArr[selArr.length - 1] ?? playerTrackId ?? null;
        if (!anchorId) return;
        const idx = all.findIndex((tr) => tr.id === anchorId);
        if (idx < 0) return;
        const nextIdx = e.key === "ArrowDown"
          ? Math.min(all.length - 1, idx + 1)
          : Math.max(0, idx - 1);
        const next = all[nextIdx];
        if (next && next.id !== anchorId) { clearSelection(); toggleSelect(next.id); }
      } else if (e.key === "ArrowRight") {
        e.preventDefault(); skipTrack(1);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault(); skipTrack(-1);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeTrack, isPlaying, volume, playerTrackId]);

  useEffect(() => { return () => { cancelAnimationFrame(animFrameRef.current); audioCtxRef.current?.close().catch(() => {}); }; }, []);

  useEffect(() => {
    if (!seekRequest || !audioRef.current) return;
    if (oneShotTimerRef.current) { clearTimeout(oneShotTimerRef.current); oneShotTimerRef.current = null; }
    const t = seekRequest.ms / 1000;
    audioRef.current.currentTime = Math.max(0, t);
    setProgress(Math.max(0, t));
    if (!isPlayingRef.current) {
      setupAudioCtx().then(() => { audioRef.current?.play().catch(console.error); setIsPlaying(true); startLiveAnim(); });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seekRequest]);

  // Scrub seek — toca na posição enquanto arrasta, pausa 250ms após o último pedido
  useEffect(() => {
    if (!scrubSeekRequest || !audioRef.current) return;
    if (scrubTimerRef.current) { clearTimeout(scrubTimerRef.current); scrubTimerRef.current = null; }
    if (oneShotTimerRef.current) { clearTimeout(oneShotTimerRef.current); oneShotTimerRef.current = null; }
    const t = Math.max(0, scrubSeekRequest.ms / 1000);
    audioRef.current.currentTime = t;
    setProgress(t);
    if (!isPlayingRef.current) {
      setupAudioCtx().then(() => {
        audioRef.current?.play().catch(() => {});
        setIsPlaying(true);
        startLiveAnim();
      });
    }
    scrubTimerRef.current = setTimeout(() => {
      audioRef.current?.pause();
      setIsPlaying(false);
      stopLiveAnim();
      scrubTimerRef.current = null;
    }, 250);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrubSeekRequest]);

  // One-shot: play from position for 4s then stop
  useEffect(() => {
    if (!oneShotRequest || !audioRef.current) return;
    if (oneShotTimerRef.current) { clearTimeout(oneShotTimerRef.current); oneShotTimerRef.current = null; }
    const t = oneShotRequest.ms / 1000;
    audioRef.current.currentTime = Math.max(0, t);
    setProgress(Math.max(0, t));
    setupAudioCtx().then(() => {
      audioRef.current?.play().catch(console.error);
      setIsPlaying(true);
      startLiveAnim();
      oneShotTimerRef.current = setTimeout(() => {
        audioRef.current?.pause();
        setIsPlaying(false);
        stopLiveAnim();
        oneShotTimerRef.current = null;
      }, 4000);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oneShotRequest]);

  // playRequest — duplo clique na tabela → play direto, sem flag module-level
  useEffect(() => {
    if (!playRequest || !audioRef.current) return;
    const track = tracks.find((t) => t.id === playRequest.trackId);
    if (!track) return;
    if (oneShotTimerRef.current) { clearTimeout(oneShotTimerRef.current); oneShotTimerRef.current = null; }
    audioRef.current.pause(); stopLiveAnim();
    loadedPath.current = track.path;
    audioRef.current.src = convertFileSrc(track.path);
    audioRef.current.volume = volume;
    audioRef.current.load();
    setProgress(0); setDuration(0);
    setupAudioCtx().then(() => {
      const audio = audioRef.current;
      if (!audio) return;
      const doPlay = () => {
        audio.play()
          .then(() => { setIsPlaying(true); startLiveAnim(); })
          .catch((err) => {
            if ((err as DOMException)?.name === 'AbortError' || audio.readyState < 2) {
              audio.addEventListener('canplay', () => {
                audio.play().then(() => { setIsPlaying(true); startLiveAnim(); }).catch(console.error);
              }, { once: true });
            }
          });
      };
      if (audio.readyState >= 2) doPlay();
      else audio.addEventListener('canplay', doPlay, { once: true });
    });
    if (track.has_cover) {
      invoke<string | null>("read_cover_base64", { path: track.path })
        .then((b64) => setCoverUrl(b64 ? `data:image/jpeg;base64,${b64}` : null))
        .catch(() => setCoverUrl(null));
    } else { setCoverUrl(null); }
    const hit = getCachedWaveform(track.path);
    if (hit) { const rgb = hit.map(b => ({ amp: b.amp, bass: b.bass, treble: b.treble })); waveBarsRef.current = rgb; setWaveBars(rgb); }
    else {
      setWaveBars(null);
      loadWaveform(track.path).then((bars) => {
        if (!bars) throw new Error();
        const rgb = bars.map(b => ({ amp: b.amp, bass: b.bass, treble: b.treble }));
        setCachedWaveform(track.path, bars); waveBarsRef.current = rgb; setWaveBars(rgb);
      }).catch(() => { const fb = makeFallback(track.path); waveBarsRef.current = fb; setWaveBars(fb); });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playRequest]);

  async function togglePlay() {
    if (!audioRef.current || !activeTrack) return;
    if (!playerTrackId && selectedArr[0]) setPlayerTrack(selectedArr[0]);
    if (isPlaying) { audioRef.current.pause(); setIsPlaying(false); stopLiveAnim(); }
    else { await setupAudioCtx(); audioRef.current.play().catch(console.error); setIsPlaying(true); startLiveAnim(); }
  }

  function skipTrack(dir: 1 | -1) {
    if (!activeTrack) return;
    const list = displayTracks ?? tracks;
    const idx = list.findIndex((t) => t.id === activeTrack.id);
    const next = list[idx + dir];
    if (next) { setPlayerTrack(next.id); setIsPlaying(true); }
  }

  const seekToMs = useCallback((ms: number) => {
    if (!audioRef.current || !duration) return;
    audioRef.current.currentTime = Math.max(0, Math.min(ms / 1000, duration));
    setProgress(audioRef.current.currentTime);
  }, [duration]);

  const handleWfClick = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (scrubRef.current) return; // drag = scrub, not click
    const svg = wfRef.current;
    if (!svg || !duration) return;
    const rect = svg.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    seekToMs((winStart + ratio * windowDur) * 1000);
  }, [duration, seekToMs, winStart, windowDur]);

  const handleWfMouseDown = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (e.button !== 0 || !duration || !audioRef.current) return;
    e.preventDefault();
    scrubRef.current = false;

    const doSeek = (clientX: number) => {
      const svg = wfRef.current;
      if (!svg || !duration) return;
      const rect = svg.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const t = (winStart + ratio * windowDur) * 1000;
      if (audioRef.current) {
        audioRef.current.currentTime = Math.max(0, Math.min(t / 1000, duration));
        setProgress(audioRef.current.currentTime);
      }
    };

    doSeek(e.clientX);

    const onMove = (ev: MouseEvent) => {
      scrubRef.current = true;
      doSeek(ev.clientX);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      setTimeout(() => { scrubRef.current = false; }, 50);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [duration, winStart, windowDur]);


  const rawDisplayBars = (waveBars ?? makeFallback(activeTrack?.path ?? "")).slice(barStart, barEnd);
  const MAX_MINI_BARS = 700;
  const barStep = rawDisplayBars.length <= MAX_MINI_BARS ? 1 : Math.ceil(rawDisplayBars.length / MAX_MINI_BARS);
  const displayBars = rawDisplayBars.length <= MAX_MINI_BARS
    ? rawDisplayBars
    : rawDisplayBars.filter((_, i) => i % barStep === 0);
  const VB_W = displayBars.length * BAR_STR;
  const localCues = activeTrack?.cue_points ?? [];

  const volMuted = volume === 0;
  const volIcon = (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <path d="M1.5 4.5h2L6 2v8L3.5 7.5H1.5V4.5z" fill="currentColor"/>
      {!volMuted && volume > 0.01 && <path d="M8 3.5a3.5 3.5 0 010 5" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>}
      {!volMuted && volume > 0.5  && <path d="M9.5 2a5.5 5.5 0 010 8" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>}
      {volMuted && (<><path d="M8.5 4.5L11 7" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/><path d="M11 4.5L8.5 7" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/></>)}
    </svg>
  );

  return (
    <>
      <div
        className="bg-[#0E0D0C] select-none flex items-stretch"
        style={{ height: 48 + WF_EXPANDED + 12 }}
      >
        <audio ref={(el) => { audioRef.current = el; globalAudio.el = el; }} preload="auto" />

        {/* Info */}
        <div
          className={`flex ${wfExpanded ? "flex-col items-center justify-center py-2" : "items-center"} gap-2.5 px-3 shrink-0`}
          style={{ width: wfExpanded ? 148 : 230 }}
        >
          {/* Vinyl disc */}
          {(() => {
            const D = wfExpanded ? 64 : 52;
            return (
              <div className="shrink-0 relative" style={{ width: D, height: D }}>
                <svg width={D} height={D} viewBox="0 0 44 44" className={isPlaying ? "mini-disc-spin" : ""}>
                  <defs>
                    <clipPath id="vinyl-art-clip">
                      <circle cx="22" cy="22" r="11.5"/>
                    </clipPath>
                  </defs>
                  <circle cx="22" cy="22" r="21.5" fill="#111010"/>
                  <circle cx="22" cy="22" r="21.5" fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="0.5"/>
                  {[19.5, 17, 15, 13.5].map(r => (
                    <circle key={r} cx="22" cy="22" r={r} fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="0.5"/>
                  ))}
                  <circle cx="22" cy="22" r="12.5" fill="#1c1917"/>
                  {coverUrl ? (
                    <image href={coverUrl} x="10.5" y="10.5" width="23" height="23" clipPath="url(#vinyl-art-clip)"/>
                  ) : (
                    <>
                      <circle cx="22" cy="22" r="11.5" fill="#23201E"/>
                      <circle cx="22" cy="22" r="11.5" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="0.5"/>
                    </>
                  )}
                  <circle cx="22" cy="22" r="1.8" fill="#0A0908"/>
                </svg>
                <span className={`absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 w-2 h-2 rounded-full border border-[#0E0D0C] ${isPlaying ? "bg-[#D95340]" : "bg-[#3a3530]"}`}
                  style={isPlaying ? { boxShadow: "0 0 5px rgba(217,83,64,0.7)" } : {}}/>
              </div>
            );
          })()}
          {wfExpanded ? (
            <div className="flex flex-col items-center gap-0.5 min-w-0 w-full">
              <p className="text-[8px] text-[#8F8883] truncate uppercase tracking-wide w-full text-center">{activeTrack?.artist ?? ""}</p>
              <p className="text-[10px] font-semibold text-[#DCDAD8] truncate leading-tight w-full text-center">
                {activeTrack?.title ?? activeTrack?.filename ?? <span className="text-[#605A55] font-normal italic">sem faixa</span>}
              </p>
              {(activeTrack?.bpm || activeTrack?.key) && (
                <div className="flex items-end gap-2.5 mt-1">
                  {activeTrack?.bpm && (
                    <div className="flex flex-col items-center leading-none">
                      <span className="text-[22px] font-mono text-[#C97B40] font-bold tabular-nums leading-none">{parseFloat(activeTrack.bpm).toFixed(0)}</span>
                      <span className="text-[8px] text-[#756D67] uppercase tracking-widest mt-0.5">bpm</span>
                    </div>
                  )}
                  {activeTrack?.key && (
                    <div className="flex flex-col items-center leading-none">
                      <span className="text-[16px] font-mono font-bold text-[#8F8883] leading-none">{activeTrack.key}</span>
                      <span className="text-[8px] text-[#756D67] uppercase tracking-widest mt-0.5">key</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-semibold text-[#DCDAD8] truncate leading-tight">
                {activeTrack?.title ?? activeTrack?.filename ?? <span className="text-[#605A55] font-normal italic">sem faixa</span>}
              </p>
              <p className="text-[8px] text-[#8F8883] truncate uppercase tracking-wide">{activeTrack?.artist ?? ""}</p>
            </div>
          )}
        </div>

        <div className="w-px self-stretch my-2 bg-[#23201E] shrink-0" />

        {/* Transport + Volume */}
        <div className="flex flex-col items-center justify-center gap-5 px-4 shrink-0" style={{ minWidth: 130 }}>
          {/* Botões */}
          <div className="flex items-center gap-3">
            <button onClick={() => skipTrack(-1)} disabled={!activeTrack} className="text-[#756D67] hover:text-[#A8A3A0] disabled:opacity-25 transition-colors">
              <svg width="11" height="11" viewBox="0 0 12 12" fill="currentColor"><rect x="1" y="1" width="1.5" height="10" rx="0.5"/><path d="M10.5 1.5L4 6l6.5 4.5V1.5z"/></svg>
            </button>
            <button onClick={togglePlay} disabled={!activeTrack}
              className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 transition-all duration-150 disabled:opacity-25 ${isPlaying ? "bg-[#D95340] shadow-[0_0_10px_rgba(217,83,64,0.35)]" : "bg-transparent border border-[#D95340]/70 hover:border-[#D95340]"}`}>
              {isPlaying
                ? <svg width="7" height="8" viewBox="0 0 8 9" fill="white"><rect x="0.5" y="0.5" width="2.5" height="8" rx="0.5"/><rect x="5" y="0.5" width="2.5" height="8" rx="0.5"/></svg>
                : <svg width="7" height="8" viewBox="0 0 8 9" fill="#D95340" style={{ marginLeft: "1px" }}><path d="M1 0.5L7.5 4.5 1 8.5V0.5z"/></svg>
              }
            </button>
            <button onClick={() => skipTrack(1)} disabled={!activeTrack} className="text-[#756D67] hover:text-[#A8A3A0] disabled:opacity-25 transition-colors">
              <svg width="11" height="11" viewBox="0 0 12 12" fill="currentColor"><rect x="9.5" y="1" width="1.5" height="10" rx="0.5"/><path d="M1.5 1.5L8 6 1.5 10.5V1.5z"/></svg>
            </button>
          </div>
          {/* Volume — linha fina abaixo dos controles */}
          <div className="flex items-center gap-1.5 w-full">
            <button
              onClick={() => { const v = volume > 0 ? 0 : 0.8; setVolume(v); if (gainNodeRef.current) gainNodeRef.current.gain.value = v; if (audioRef.current) audioRef.current.volume = v; }}
              className="text-[#605A55] hover:text-[#8F8883] transition-colors shrink-0">
              {volIcon}
            </button>
            <input
              type="range" min={0} max={1} step={0.005}
              value={volume}
              onChange={(e) => { const v = parseFloat(e.target.value); setVolume(v); if (gainNodeRef.current) gainNodeRef.current.gain.value = v; if (audioRef.current) audioRef.current.volume = v; }}
              className="volume-slider-horiz flex-1"
              style={{ background: `linear-gradient(to right, #D95340 0%, #D95340 ${volume * 100}%, #2a2623 ${volume * 100}%, #2a2623 100%)` }}
            />
          </div>
        </div>

        <div className="w-px self-stretch my-2 bg-[#23201E] shrink-0" />

        {/* ── Coluna CUE — mini chips de atalho (editor desativado na produção) */}
        {localCues.length > 0 && (
          <div className="flex items-center shrink-0 px-2 py-2 gap-0.5 flex-wrap" style={{ width: 76 }}>
            {localCues.slice(0, 6).map((c, i) => (
              <button key={i} title={`CUE ${i+1}${c.label ? ` — ${c.label}` : ""} · ${fmt(c.position_ms / 1000)}`}
                onClick={() => seekToMs(c.position_ms)}
                className="w-5 h-5 rounded flex items-center justify-center text-white font-bold transition-opacity hover:opacity-80"
                style={{ background: c.color, fontSize: 8 }}>{i + 1}</button>
            ))}
          </div>
        )}

        {/* ── Waveform progress ─────────────────────────────────────────── */}
        <div className="flex-1 min-w-0 flex flex-col justify-center px-3"
          style={{ paddingTop: wfExpanded ? 7 : 0, paddingBottom: wfExpanded ? 5 : 0, gap: wfExpanded ? 4 : 2 }}>
          {/* Times */}
          <div className="flex items-center justify-between pointer-events-none">
            <span className="text-[11px] font-mono text-[#D95340] font-semibold tabular-nums">{fmt(progress)}</span>
            <span className="text-[10px] font-mono text-[#605A55] tabular-nums">{fmt(duration)}</span>
          </div>

          {/* SVG Waveform */}
          <div className="relative rounded-sm overflow-hidden" style={{ height: wfH, transition: "height 0.2s ease" }}>
            <svg ref={wfRef} width="100%" height="100%" viewBox={`0 0 ${VB_W} ${wfH}`} preserveAspectRatio="none"
              className="absolute inset-0" style={{ cursor: "ew-resize" }}
              onClick={handleWfClick}
              onMouseDown={handleWfMouseDown}
              onMouseMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); setHoverPct((e.clientX - r.left) / r.width); }}
              onMouseLeave={() => setHoverPct(null)}>
              {/* Beat grid — compassos com números */}
              {wfExpanded && activeTrack?.bpm && duration > 0 && (() => {
                const beatMs  = 60000 / parseFloat(activeTrack.bpm!);
                const phaseMs = activeTrack.beat_phase_ms ?? 0;
                const nodes: React.ReactNode[] = [];
                let ms  = phaseMs % beatMs;
                let measureNum = 0;
                let idx = 0;
                while (ms <= duration * 1000 && idx < 2000) {
                  const beatIdx   = Math.round((ms - phaseMs) / beatMs);
                  const isMeasure = ((beatIdx % 4) + 4) % 4 === 0;
                  const isPhrase  = ((beatIdx % 16) + 16) % 16 === 0;
                  if (isMeasure) {
                    const x = ((ms / 1000 - winStart) / windowDur) * VB_W;
                    nodes.push(
                      <line key={`l${idx}`} x1={x} y1={0} x2={x} y2={wfH}
                        stroke={isPhrase ? "rgba(201,123,64,0.50)" : "rgba(255,255,255,0.14)"}
                        strokeWidth={isPhrase ? 1.2 : 0.7}
                        vectorEffect="non-scaling-stroke" />
                    );
                    if (measureNum % 4 === 0 || isPhrase) {
                      nodes.push(
                        <text key={`t${idx}`} x={x + 2} y={wfH - 3}
                          fill={isPhrase ? "rgba(201,123,64,0.65)" : "rgba(255,255,255,0.20)"}
                          fontSize={7} fontFamily="monospace" style={{ pointerEvents: "none" }}>
                          {measureNum + 1}
                        </text>
                      );
                    }
                    measureNum++;
                  }
                  ms += beatMs;
                  idx++;
                }
                return nodes;
              })()}
              {/* Transient strip — thin downward spikes from top (treble content) */}
              {wfExpanded && displayBars.map((bar, i) => {
                const transientZoneH = 12;
                const spikeH = Math.max(0.5, bar.treble * transientZoneH);
                const alpha = (0.35 + bar.treble * 0.55) * (0.4 + bar.amp * 0.6);
                return (
                  <line key={`tr${i}`}
                    x1={i * BAR_STR + BAR_W / 2} y1={0}
                    x2={i * BAR_STR + BAR_W / 2} y2={spikeH}
                    stroke={`rgba(217,83,64,${alpha.toFixed(2)})`}
                    strokeWidth={BAR_W}
                    strokeLinecap="round"
                    vectorEffect="non-scaling-stroke"
                  />
                );
              })}
              {/* Bars — shifted down slightly to accommodate transient strip */}
              {displayBars.map((bar, i) => {
                const transientOffset = wfExpanded ? 12 : 0;
                const availH = wfH - transientOffset;
                const barH  = Math.max(wfExpanded ? 2 : 1.5, bar.amp * (availH - (wfExpanded ? 10 : 4)));
                const midY  = transientOffset + availH / 2;
                const y     = midY - barH / 2;
                const barPos = (barStart + i * barStep) / PLAYER_BARS;
                const barFrac = windowDur > 0 ? (barPos - winStart / duration) / (windowDur / duration) : barPos;
                const played  = barFrac < winPct;
                const hovered = hoverPct !== null && !played && barFrac < hoverPct;
                return (
                  <rect key={i} x={i * BAR_STR} y={y} width={BAR_W} height={barH} rx={0.3}
                    fill={played ? "#D95340" : "#A8A3A0"}
                    opacity={played ? 1 : hovered ? 0.75 + bar.amp * 0.15 : 0.55 + bar.amp * 0.25}
                  />
                );
              })}
              {/* Playhead */}
              <line x1={winPct * VB_W} y1={0} x2={winPct * VB_W} y2={wfH} stroke="white" strokeWidth={1.5} opacity={0.65} />
            </svg>

            {/* Live canvas */}
            <canvas ref={liveCanvasRef} className="absolute inset-0 w-full h-full pointer-events-none"
              width={PLAYER_BARS * 3} height={wfH} />

            {/* CUE markers HTML overlay — tamanho fixo, sem distorção de SVG */}
            {duration > 0 && localCues.map((cue, i) => {
              const absPct = cue.position_ms / (duration * 1000);
              if (absPct < 0 || absPct > 1) return null;
              const TH = wfExpanded ? 10 : 8;
              const TW = wfExpanded ? 5 : 4;
              return (
                <div key={i} className="absolute top-0 bottom-0"
                  style={{ left: `${absPct * 100}%`, transform: "translateX(-50%)", width: 14, zIndex: 6, cursor: "pointer", pointerEvents: "auto" }}
                  onClick={(e) => { e.stopPropagation(); seekToMs(cue.position_ms); }}>
                  <div style={{ position: "absolute", top: 0, left: "50%", transform: "translateX(-50%)", width: 0, height: 0, borderLeft: `${TW}px solid transparent`, borderRight: `${TW}px solid transparent`, borderTop: `${TH}px solid ${cue.color}`, opacity: 0.92 }} />
                  <div style={{ position: "absolute", top: 1, left: "50%", transform: "translateX(-50%)", fontSize: wfExpanded ? 6 : 5, color: "white", fontFamily: "monospace", fontWeight: "bold", lineHeight: 1, pointerEvents: "none", userSelect: "none" }}>{i + 1}</div>
                  <div style={{ position: "absolute", top: TH, left: "50%", transform: "translateX(-50%)", width: wfExpanded ? 1 : 0.8, bottom: 0, background: cue.color, opacity: 0.45 }} />
                </div>
              );
            })}

            {/* Hover tooltip */}
            {hoverPct !== null && duration > 0 && (
              <div className="absolute bottom-full mb-0.5 -translate-x-1/2 px-1.5 py-0.5 rounded bg-[#1c1715] border border-white/[0.08] text-[8px] font-mono text-[#C2BEBC] pointer-events-none whitespace-nowrap z-10"
                style={{ left: `${hoverPct * 100}%` }}>
                {fmt(winStart + hoverPct * windowDur)}
              </div>
            )}
          </div>

        </div>


        {/* BPM · Key — só no compacto; expandido exibe no info esquerdo */}
        {!wfExpanded && (activeTrack?.bpm || activeTrack?.key) && (
          <>
            <div className="w-px self-stretch my-2 bg-[#23201E] shrink-0" />
            <div className="flex items-center gap-3 px-3 shrink-0">
              {activeTrack?.bpm && (
                <div className="flex flex-col items-center leading-none">
                  <span className="text-[20px] font-mono text-[#C97B40] font-bold tabular-nums leading-none">{parseFloat(activeTrack.bpm).toFixed(0)}</span>
                  <span className="text-[7px] text-[#4C4743] uppercase tracking-widest mt-0.5">bpm</span>
                </div>
              )}
              {activeTrack?.key && (
                <div className="flex flex-col items-center leading-none">
                  <span className="text-[15px] font-mono font-bold text-[#8F8883] leading-none">{activeTrack.key}</span>
                  <span className="text-[7px] text-[#4C4743] uppercase tracking-widest mt-0.5">key</span>
                </div>
              )}
            </div>
          </>
        )}

        {/* Zona reservada para o botão do agente AI (fixed bottom-[68px] right-4, w-12) */}
        <div className="shrink-0" style={{ width: 72 }} />

      </div>

    </>
  );
}
