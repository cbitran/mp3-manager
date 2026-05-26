import { useState, useRef, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { type WaveBar } from "../lib/waveformAnalyzer";
import { loadWaveform, WAVEFORM_BARS } from "../lib/waveformCache";
import { type Track, type CuePoint, useAppStore } from "../store";
import { globalAudio } from "../lib/globalAudio";

interface Props {
  track: Track;
  onClose: () => void;
  onSaved?: (cues: CuePoint[]) => void;
  inline?: boolean;
}

type BeatAnchor = { beat_index: number; position_ms: number };

const BARS  = WAVEFORM_BARS;   // 300, from shared cache

const DEFAULT_COLORS = [
  "#CC2222","#CC6600","#2266DD","#DDAA00",
  "#22AA44","#AA22AA","#00AAAA","#DD44AA",
];

function fmtMs(ms: number): string {
  if (!isFinite(ms)) return "0:00";
  const s = ms / 1000;
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}

function fmtMsFull(ms: number): string {
  if (!isFinite(ms)) return "0:00.000";
  const s = ms / 1000;
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}.${String(Math.round(ms % 1000)).padStart(3, "0")}`;
}

// Serato-style color: red (bass) → blue/purple (mid) → cyan/white (treble)
function barColor(bass: number, treble: number, amp: number): string {
  const total = bass + treble + 1e-9;
  const t = treble / total;
  const br = 0.5 + amp * 0.5;
  let r: number, g: number, b: number;
  if (t < 0.33) {
    const k = t / 0.33;
    r = 255; g = Math.round(20 + k * 70); b = Math.round(15 * (1 - k));
  } else if (t < 0.66) {
    const k = (t - 0.33) / 0.33;
    r = Math.round(200 - k * 160); g = Math.round(40 + k * 60); b = Math.round(200 + k * 55);
  } else {
    const k = (t - 0.66) / 0.34;
    r = Math.round(40 + k * 215); g = Math.round(190 + k * 65); b = 255;
  }
  return `rgb(${Math.min(255,Math.round(r*br))},${Math.min(255,Math.round(g*br))},${Math.min(255,Math.round(b*br))})`;
}

function getBeatPositionMs(
  beatIndex: number,
  bpm: number,
  phaseMs: number,
  anchors: BeatAnchor[],
): number {
  const natural = phaseMs + beatIndex * (60000 / bpm);
  if (anchors.length === 0) return natural;

  const sorted = [...anchors].sort((a, b) => a.beat_index - b.beat_index);

  // Exact match
  const exact = sorted.find((a) => a.beat_index === beatIndex);
  if (exact) return exact.position_ms;

  // Before first anchor
  if (beatIndex < sorted[0].beat_index) {
    const a0 = sorted[0];
    const natural0 = phaseMs + a0.beat_index * (60000 / bpm);
    const offset = a0.position_ms - natural0;
    return natural + offset;
  }

  // After last anchor
  if (beatIndex > sorted[sorted.length - 1].beat_index) {
    const aLast = sorted[sorted.length - 1];
    const beatDurAfter = 60000 / bpm;
    return aLast.position_ms + (beatIndex - aLast.beat_index) * beatDurAfter;
  }

  // Interpolate between surrounding anchors
  let lo = sorted[0];
  let hi = sorted[sorted.length - 1];
  for (let i = 0; i < sorted.length - 1; i++) {
    if (sorted[i].beat_index <= beatIndex && sorted[i + 1].beat_index >= beatIndex) {
      lo = sorted[i];
      hi = sorted[i + 1];
      break;
    }
  }
  const span = hi.beat_index - lo.beat_index;
  if (span === 0) return lo.position_ms;
  const t = (beatIndex - lo.beat_index) / span;
  return lo.position_ms + t * (hi.position_ms - lo.position_ms);
}


export default function CuePointsModal({ track, onClose, onSaved, inline = false }: Props) {
  const requestOneShot    = useAppStore((s) => s.requestOneShot);
  const playerProgress    = useAppStore((s) => s.playerProgress);
  const playerTrackId     = useAppStore((s) => s.playerTrackId);
  const quantizeEnabled      = useAppStore((s) => s.quantizeEnabled);
  const setQuantizeEnabled   = useAppStore((s) => s.setQuantizeEnabled);
  const quantizeResolution   = useAppStore((s) => s.quantizeResolution);
  const setQuantizeResolution = useAppStore((s) => s.setQuantizeResolution);

  const [wfH, setWfH] = useState(() =>
    Math.max(60, Math.min(380, parseInt(localStorage.getItem("tagwave_cue_wf_height") ?? "120", 10)))
  );

  const [bars, setBars]           = useState<WaveBar[] | null>(null);
  const [cues, setCues]           = useState<CuePoint[]>(() =>
    [...(track.cue_points ?? [])].sort((a, b) => a.position_ms - b.position_ms)
  );
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [saving, setSaving]           = useState(false);
  const [saveError, setSaveError]     = useState<string | null>(null);
  const [analyzing, setAnalyzing]     = useState(false);
  const [localPhaseMs, setLocalPhaseMs] = useState<number | null>(track.beat_phase_ms ?? null);
  const [gridStatus, setGridStatus]   = useState<"idle" | "ok" | "err">("idle");
  const [beatAnchors, setBeatAnchors] = useState<BeatAnchor[]>(
    () => track.beat_anchors ?? []
  );

  // Zoom state
  const [zoom, setZoom]           = useState(1);    // 1=full, 2×, 4×, 8×
  const [winCenter, setWinCenter] = useState(0.5);  // center of visible window (0–1 fraction of track)
  const maxZoom = 32;

  const [hoverMs, setHoverMs]         = useState<number | null>(null);
  const [isHoveringWf, setIsHoveringWf] = useState(false);
  const hoverRafRef  = useRef<number | null>(null);

  const svgRef       = useRef<SVGSVGElement>(null);
  const dragRef      = useRef<{ cueIdx: number } | null>(null);
  const warpDragRef  = useRef<{ beatIndex: number } | null>(null);
  const panMovedRef  = useRef(false);
  const historyRef   = useRef<CuePoint[][]>([]);

  function pushHistory() {
    const snap = cues.map((c) => ({ ...c }));
    historyRef.current = [...historyRef.current.slice(-49), snap];
  }

  const duration = (track.duration_secs ?? 0) * 1000;
  const bpm = track.bpm ? parseFloat(track.bpm) : null;

  function snapToBeat(ms: number): number {
    if (!bpm || bpm <= 0) return ms;
    const subdivMs  = (60000 / bpm) / quantizeResolution;
    const phaseMs   = localPhaseMs ?? track.beat_phase_ms ?? 0;
    const relative  = ms - phaseMs;
    const snapped   = Math.round(relative / subdivMs) * subdivMs + phaseMs;
    return Math.max(0, Math.min(duration, snapped));
  }

  // Load waveform from shared cache
  useEffect(() => {
    loadWaveform(track.path).then((data) => { if (data) setBars(data); }).catch(() => {});
  }, [track.path]);

  // Ctrl+Z / Cmd+Z undo — deps [] é seguro: handleUndo só usa historyRef e setters estáveis
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        const h = historyRef.current;
        if (h.length === 0) return;
        const prev = h[h.length - 1];
        historyRef.current = h.slice(0, -1);
        setCues(prev);
        setSelectedIdx(null);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Visible window (fractions 0–1 of track)
  const halfWin   = 0.5 / zoom;
  const winStart  = Math.max(0, Math.min(1 - halfWin * 2, winCenter - halfWin));
  const winEnd    = Math.min(1, winStart + halfWin * 2);
  const barStart  = Math.floor(winStart * BARS);
  const barEnd    = Math.min(BARS, Math.ceil(winEnd * BARS));
  const visN      = Math.max(1, barEnd - barStart);

  // ViewBox width for the visible slice
  const VB_W = visN * 2.8;

  // Convert click X → absolute ms
  function xToMs(clientX: number): number {
    const svg = svgRef.current;
    if (!svg || duration <= 0) return 0;
    const rect = svg.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const absFrac = winStart + ratio * (winEnd - winStart);
    return Math.round(absFrac * duration);
  }

  function handleWaveformClick(e: React.MouseEvent<SVGSVGElement>) {
    if (panMovedRef.current) { panMovedRef.current = false; return; }
    if (dragRef.current) return;
    if (warpDragRef.current) return;
    const rawMs = xToMs(e.clientX);
    const ms = quantizeEnabled ? snapToBeat(rawMs) : rawMs;
    // Clique próximo a CUE existente → seleciona e preview
    const svg = svgRef.current;
    if (svg) {
      const threshold = duration * (14 / svg.getBoundingClientRect().width) * (winEnd - winStart);
      const near = cues.findIndex((c) => Math.abs(c.position_ms - ms) < threshold);
      if (near >= 0) { setSelectedIdx(near); requestOneShot(ms); return; }
    }
    // Clique em área vazia → posiciona cursor silenciosamente, sem play
    setHoverMs(ms);
    if (globalAudio.el) globalAudio.el.currentTime = ms / 1000;
  }

  const handleMarkerMouseDown = useCallback((e: React.MouseEvent, cueIdx: number) => {
    e.preventDefault(); e.stopPropagation();
    setSelectedIdx(cueIdx);
    pushHistory();
    dragRef.current = { cueIdx };
    function onMove(ev: MouseEvent) {
      if (!dragRef.current) return;
      const svg = svgRef.current;
      if (!svg || duration <= 0) return;
      const rect = svg.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
      let ms = Math.round((winStart + ratio * (winEnd - winStart)) * duration);
      const { quantizeEnabled: qOn, quantizeResolution: qRes } = useAppStore.getState();
      if (qOn && bpm && bpm > 0) {
        const subdivMs = (60000 / bpm) / qRes;
        ms = Math.max(0, Math.min(duration, Math.round(Math.round(ms / subdivMs) * subdivMs)));
      }
      setCues((prev) => { const n = [...prev]; n[dragRef.current!.cueIdx] = { ...n[dragRef.current!.cueIdx], position_ms: ms }; return n; });
    }
    function onUp() { dragRef.current = null; window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [cues, duration, winStart, winEnd]);

  // Warp handle drag
  const handleWarpMouseDown = useCallback((e: React.MouseEvent, beatIndex: number) => {
    e.preventDefault(); e.stopPropagation();
    warpDragRef.current = { beatIndex };

    function onMove(ev: MouseEvent) {
      if (!warpDragRef.current) return;
      const svg = svgRef.current;
      if (!svg || duration <= 0) return;
      const rect = svg.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
      const newMs = (winStart + ratio * (winEnd - winStart)) * duration;
      setBeatAnchors((prev) => {
        const filtered = prev.filter((a) => a.beat_index !== warpDragRef.current!.beatIndex);
        return [...filtered, { beat_index: warpDragRef.current!.beatIndex, position_ms: newMs }];
      });
    }

    function onUp() {
      warpDragRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      setBeatAnchors((current) => {
        invoke("save_beat_anchors", { path: track.path, anchors: current }).catch(console.error);
        return current;
      });
    }

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [duration, winStart, winEnd, track.path]);

  // Arraste esquerdo com zoom > 1 ou botão do meio = pan; zoom = 1 = scrub
  function handleWaveformMouseDown(e: React.MouseEvent<SVGSVGElement>) {
    if (e.button !== 0 && e.button !== 1) return;
    const isPan = zoom > 1 || e.button === 1;
    if (isPan) e.preventDefault();
    const startX = e.clientX;
    const startCenter = winCenter;
    panMovedRef.current = false;
    const wasAudioPaused = globalAudio.el?.paused ?? true;

    const onMove = (ev: MouseEvent) => {
      if (Math.abs(ev.clientX - startX) > 3) panMovedRef.current = true;
      if (!panMovedRef.current) return;

      if (isPan) {
        const svg = svgRef.current;
        if (!svg) return;
        const w = svg.getBoundingClientRect().width;
        const dx = (ev.clientX - startX) / w;
        const winW = winEnd - winStart;
        const newCenter = Math.max(winW / 2, Math.min(1 - winW / 2, startCenter - dx * winW * 2));
        setWinCenter(newCenter);
      } else {
        // Scrub — seek direto no áudio, sem passar pelo store
        const svg = svgRef.current;
        if (!svg || duration <= 0) return;
        const rect = svg.getBoundingClientRect();
        const ratio = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
        const absFrac = winStart + ratio * (winEnd - winStart);
        const rawMs = Math.round(absFrac * duration);
        const ms = quantizeEnabled ? snapToBeat(rawMs) : rawMs;
        setHoverMs(ms);
        setIsHoveringWf(true);
        if (globalAudio.el) {
          globalAudio.el.currentTime = ms / 1000;
          if (globalAudio.el.paused) globalAudio.el.play().catch(() => {});
        }
      }
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      // Pausa ao soltar se estava pausado antes do scrub
      if (!isPan && wasAudioPaused && globalAudio.el && !globalAudio.el.paused) {
        globalAudio.el.pause();
      }
      setTimeout(() => { panMovedRef.current = false; }, 50);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  // Scroll wheel = zoom
  function handleWheel(e: React.WheelEvent) {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.25 : 0.8;
    setZoom((z) => Math.max(1, Math.min(maxZoom, z * factor)));
    const svg = svgRef.current;
    if (svg) {
      const rect = svg.getBoundingClientRect();
      const ratio = (e.clientX - rect.left) / rect.width;
      const curFrac = winStart + ratio * (winEnd - winStart);
      setWinCenter(Math.max(0, Math.min(1, curFrac)));
    }
  }

  function handleWfResize(e: React.MouseEvent) {
    e.preventDefault();
    const startY = e.clientY;
    const startH = wfH;
    let curH = startH;
    const onMove = (ev: MouseEvent) => {
      curH = Math.max(60, Math.min(380, startH + (ev.clientY - startY)));
      setWfH(curH);
    };
    const onUp = () => {
      localStorage.setItem("tagwave_cue_wf_height", String(curH));
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  function updateCue(idx: number, updates: Partial<CuePoint>, skipHistory = false) {
    if (!skipHistory) pushHistory();
    setCues((prev) => { const n = [...prev]; n[idx] = { ...n[idx], ...updates }; return n; });
  }
  function deleteCue(idx: number) {
    pushHistory();
    setCues((prev) => prev.filter((_, i) => i !== idx).map((c, i) => ({ ...c, index: i, color: DEFAULT_COLORS[i] })));
    setSelectedIdx(null);
  }

  function addCueAtHoverMs() {
    if (!canEdit || cues.length >= 8) return;
    const rawMs = hoverMs !== null ? hoverMs : (playerTrackId === track.id ? Math.round(playerProgress * 1000) : 0);
    const ms = quantizeEnabled ? snapToBeat(rawMs) : rawMs;
    pushHistory();
    const nextIndex = cues.length;
    const newCue: CuePoint = { index: nextIndex, position_ms: ms, label: "", color: DEFAULT_COLORS[nextIndex % 8] };
    const updated = [...cues, newCue].sort((a, b) => a.position_ms - b.position_ms);
    setCues(updated);
    setSelectedIdx(updated.findIndex((c) => c === newCue));
    requestOneShot(ms);
  }

  async function handleCalibrateGrid() {
    if (!duration) return;
    setAnalyzing(true);
    setGridStatus("idle");
    try {
      const result = await invoke<{ bpm: number; phase_ms: number }>("detect_beat_grid", {
        path: track.path,
        hintBpm: bpm ?? null,
      });
      setLocalPhaseMs(result.phase_ms);
      await invoke("save_beat_grid", { path: track.path, phaseMs: result.phase_ms });
      setGridStatus("ok");
    } catch {
      setGridStatus("err");
    } finally {
      setAnalyzing(false);
    }
  }

  async function handleSave() {
    setSaving(true); setSaveError(null);
    try {
      await invoke("save_cue_points", { path: track.path, cues });
      onSaved?.(cues);
      onClose();
    } catch (err) { setSaveError(String(err)); }
    finally { setSaving(false); }
  }

  // Beat grid lines within visible window — using getBeatPositionMs with anchors
  const beatLines: { x: number; major: boolean; measureNum: number | null; beatIndex: number; isMeasure: boolean }[] = [];
  const phaseMs = localPhaseMs ?? track.beat_phase_ms ?? 0;
  if (bpm && bpm > 0 && duration > 0) {
    const beatFrac  = (60000 / bpm) / duration;
    const phaseFrac = phaseMs / duration;
    const n0 = Math.floor((winStart - phaseFrac) / beatFrac);
    let beatIdx = n0;
    let beatN = 0;
    while (beatN < 600) {
      const posMs = getBeatPositionMs(beatIdx, bpm, phaseMs, beatAnchors);
      const f = posMs / duration;
      if (f > winEnd) break;
      if (f >= winStart) {
        const isMeasure = ((beatIdx % 4) + 4) % 4 === 0;
        const isPhrase  = ((beatIdx % 16) + 16) % 16 === 0;
        const isMajor   = isPhrase;
        if (zoom > 1 || isMeasure) {
          const x = ((f - winStart) / (winEnd - winStart)) * VB_W;
          const measureIdx = Math.floor(beatIdx / 4);
          const showNum = isMeasure && (zoom >= 2 || measureIdx % 4 === 0 || isPhrase);
          beatLines.push({ x, major: isMajor, measureNum: showNum ? measureIdx + 1 : null, beatIndex: beatIdx, isMeasure });
        }
      }
      beatIdx++;
      beatN++;
    }
  }

  const isNativeFmt = track.format === "MP3" || track.format === "AIFF" || track.format === "AIF";
  const canEdit    = duration > 0;
  const canAnalyze = duration > 0;
  const slotMap = new Map<number, { cue: CuePoint; listIdx: number }>();
  cues.forEach((c, i) => slotMap.set(i, { cue: c, listIdx: i }));

  const displayBars = bars ?? [];

  // Dual waveform zone heights
  const transientH = wfH * 0.18;
  const bassH      = wfH * 0.18;
  const mainTop    = transientH;
  const mainBot    = wfH - bassH;
  const mainMid    = (mainTop + mainBot) / 2;
  const mainHalf   = (mainBot - mainTop) / 2;

  const inner = (
      <div
        className={`relative flex flex-col overflow-hidden select-none ${inline ? "flex-1 h-full rounded-none border-0" : "rounded-2xl shadow-2xl"}`}
        style={inline ? { background: "#0E0D0C" } : { width: "min(860px, 94vw)", maxHeight: "92vh", background: "#0E0D0C", border: "1px solid rgba(255,255,255,0.07)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-3 border-b shrink-0" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="#D95340" strokeWidth="1.5" strokeLinecap="round">
            <circle cx="6.5" cy="6.5" r="5.5"/><line x1="6.5" y1="3" x2="6.5" y2="6.5"/><circle cx="6.5" cy="9" r="0.7" fill="#D95340" stroke="none"/>
          </svg>
          <div className="flex-1 min-w-0">
            <p className="text-[12px] font-semibold truncate" style={{ color: "#C2BEBC" }}>{track.title || track.filename}</p>
            {track.artist && <p className="text-[10px] truncate" style={{ color: "#605A55" }}>{track.artist}</p>}
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {bpm && <span className="text-[10px] font-mono" style={{ color: "#4C4743" }}>{bpm.toFixed(0)} BPM</span>}
            <span className="text-[10px] font-mono" style={{ color: "#4C4743" }}>{cues.length} cue{cues.length !== 1 ? "s" : ""}</span>
          </div>
          <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded-full"
            style={{ color: "#605A55" }}
            onMouseEnter={(e) => { e.currentTarget.style.color = "#C2BEBC"; e.currentTarget.style.background = "rgba(255,255,255,0.06)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = "#605A55"; e.currentTarget.style.background = "transparent"; }}>
            <svg width="9" height="9" viewBox="0 0 9 9" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
              <line x1="1" y1="1" x2="8" y2="8"/><line x1="8" y1="1" x2="1" y2="8"/>
            </svg>
          </button>
        </div>

        {/* ── Waveform + Zoom ───────────────────────────────────────────── */}
        <div className="shrink-0 px-4 pt-4 pb-0">
          {/* Zoom + Quantize toolbar */}
          <div className="flex flex-col gap-1.5 pb-2">
            {/* Row 1: Zoom */}
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono shrink-0" style={{ color: "#4C4743", width: 62 }}>ZOOM</span>
              <button onClick={() => setZoom((z) => Math.max(1, z / 2))} disabled={zoom <= 1} title="Reduzir zoom"
                className="w-7 h-7 flex items-center justify-center rounded-lg disabled:opacity-25 transition-all hover:brightness-125"
                style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)", color: "#8F8883" }}>
                <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                  <circle cx="5.5" cy="5.5" r="4"/><line x1="3.5" y1="5.5" x2="7.5" y2="5.5"/><line x1="9.5" y1="9.5" x2="12" y2="12"/>
                </svg>
              </button>
              <button onClick={() => { setZoom(1); setWinCenter(0.5); }} title="Resetar zoom"
                className="px-2 h-7 rounded-lg text-[10px] font-mono font-semibold transition-all hover:brightness-125"
                style={{ background: zoom > 1 ? "rgba(201,123,64,0.15)" : "rgba(255,255,255,0.04)", border: `1px solid ${zoom > 1 ? "rgba(201,123,64,0.35)" : "rgba(255,255,255,0.06)"}`, color: zoom > 1 ? "#C97B40" : "#4C4743", minWidth: 40, textAlign: "center" }}>
                {zoom >= 2 ? `${zoom.toFixed(zoom < 10 ? 1 : 0)}×` : "1×"}
              </button>
              <button onClick={() => setZoom((z) => Math.min(maxZoom, z * 2))} disabled={zoom >= maxZoom} title="Ampliar zoom"
                className="w-7 h-7 flex items-center justify-center rounded-lg disabled:opacity-25 transition-all hover:brightness-125"
                style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)", color: "#8F8883" }}>
                <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                  <circle cx="5.5" cy="5.5" r="4"/><line x1="3.5" y1="5.5" x2="7.5" y2="5.5"/><line x1="5.5" y1="3.5" x2="5.5" y2="7.5"/><line x1="9.5" y1="9.5" x2="12" y2="12"/>
                </svg>
              </button>
              <div className="flex gap-1 ml-1">
                {[2, 4, 8, 16].map((level) => (
                  <button key={level} onClick={() => setZoom(zoom === level ? 1 : level)}
                    className="h-7 rounded-lg text-[9px] font-mono transition-all hover:brightness-125"
                    style={{ paddingLeft: 7, paddingRight: 7, background: zoom === level ? "rgba(201,123,64,0.18)" : "rgba(255,255,255,0.04)", border: `1px solid ${zoom === level ? "rgba(201,123,64,0.4)" : "rgba(255,255,255,0.06)"}`, color: zoom === level ? "#C97B40" : "#605A55" }}>
                    {level}×
                  </button>
                ))}
              </div>
              {zoom > 1 && (
                <span className="text-[9px] ml-auto" style={{ color: "#3a3530" }}>Scroll para zoom · arraste para navegar</span>
              )}
            </div>
            {/* Row 2: Quantize */}
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono shrink-0" style={{ color: "#4C4743", width: 62 }}>QUANTIZE</span>
              <button
                onClick={() => setQuantizeEnabled(!quantizeEnabled)}
                disabled={!bpm}
                title={!bpm ? "BPM necessário para o Quantize" : quantizeEnabled ? "Quantize ativo — clique para desativar" : "Ativar Quantize — snap ao beat"}
                className="flex items-center gap-1.5 h-7 rounded-lg text-[10px] font-mono font-semibold transition-all hover:brightness-125 disabled:opacity-25"
                style={{
                  paddingLeft: 8, paddingRight: 8,
                  background: quantizeEnabled ? "rgba(201,123,64,0.20)" : "rgba(255,255,255,0.04)",
                  border: `1px solid ${quantizeEnabled ? "rgba(201,123,64,0.55)" : "rgba(255,255,255,0.07)"}`,
                  color: quantizeEnabled ? "#C97B40" : "#605A55",
                  boxShadow: quantizeEnabled ? "0 0 10px rgba(201,123,64,0.22)" : "none",
                }}>
                <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
                  <line x1="0.5" y1="1" x2="0.5" y2="10" strokeOpacity="0.55"/>
                  <line x1="10.5" y1="1" x2="10.5" y2="10" strokeOpacity="0.55"/>
                  <line x1="5.5" y1="2.5" x2="5.5" y2="8.5"/>
                  <line x1="3" y1="5.5" x2="8" y2="5.5" strokeOpacity="0.55"/>
                  <circle cx="5.5" cy="5.5" r="1.4" fill="currentColor" stroke="none"/>
                </svg>
                Q
              </button>
              {!!bpm && (
                <div className="flex gap-1">
                  {([1, 2, 4, 8] as number[]).map((res) => {
                    const label = res === 1 ? "1/4" : res === 2 ? "1/8" : res === 4 ? "1/16" : "1/32";
                    const isActive = quantizeResolution === res;
                    return (
                      <button key={res}
                        onClick={() => setQuantizeResolution(res)}
                        title={`Snap a cada ${label} nota`}
                        className="h-7 rounded-lg text-[9px] font-mono transition-all hover:brightness-125"
                        style={{
                          paddingLeft: 6, paddingRight: 6,
                          opacity: quantizeEnabled ? 1 : 0.45,
                          background: isActive && quantizeEnabled ? "rgba(201,123,64,0.18)" : "rgba(255,255,255,0.03)",
                          border: `1px solid ${isActive && quantizeEnabled ? "rgba(201,123,64,0.4)" : "rgba(255,255,255,0.06)"}`,
                          color: isActive && quantizeEnabled ? "#C97B40" : "#605A55",
                        }}>
                        {label}
                      </button>
                    );
                  })}
                </div>
              )}
              {!bpm && <span className="text-[9px]" style={{ color: "#3a3530" }}>BPM necessário</span>}
            </div>
          </div>

          <div className="relative rounded-xl overflow-hidden" style={{ background: "#06060A", border: "1px solid rgba(255,255,255,0.06)" }}>

            {/* "Clique para adicionar" hint */}
            {cues.length === 0 && !bars && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
                <span className="text-[11px]" style={{ color: "#3a3530" }}>Carregando waveform…</span>
              </div>
            )}
            {cues.length === 0 && bars && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
                <span className="text-[11px]" style={{ color: "#3a3530" }}>Arraste para navegar · clique + para adicionar CUE</span>
              </div>
            )}

            <svg
              ref={svgRef}
              width="100%"
              height={wfH}
              viewBox={`0 0 ${VB_W} ${wfH}`}
              preserveAspectRatio="none"
              className="block"
              style={{ cursor: zoom > 1 ? "grab" : (canEdit ? "crosshair" : "default") }}
              onClick={canEdit ? handleWaveformClick : undefined}
              onMouseDown={handleWaveformMouseDown}
              onWheel={handleWheel}
              onMouseMove={(e) => {
                const clientX = e.clientX;
                if (hoverRafRef.current) return;
                hoverRafRef.current = requestAnimationFrame(() => {
                  hoverRafRef.current = null;
                  setIsHoveringWf(true);
                  const rawMs = xToMs(clientX);
                  setHoverMs(quantizeEnabled ? snapToBeat(rawMs) : rawMs);
                });
              }}
              onMouseLeave={() => { if (hoverRafRef.current) { cancelAnimationFrame(hoverRafRef.current); hoverRafRef.current = null; } setIsHoveringWf(false); }}
            >
              {/* Beat grid */}
              {beatLines.map((bl, i) => (
                <g key={i}>
                  <line x1={bl.x} y1={0} x2={bl.x} y2={wfH}
                    stroke={bl.major
                      ? "rgba(201,123,64,0.55)"
                      : quantizeEnabled
                        ? "rgba(201,123,64,0.18)"
                        : "rgba(255,255,255,0.13)"}
                    strokeWidth={bl.major ? 1.2 : 0.6}
                    vectorEffect="non-scaling-stroke"
                  />
                  {bl.measureNum != null && (
                    <text x={bl.x + 2} y={wfH - 4}
                      fill={bl.major ? "rgba(201,123,64,0.70)" : "rgba(255,255,255,0.28)"}
                      fontSize={8} fontFamily="monospace"
                      style={{ pointerEvents: "none", userSelect: "none" }}>
                      {bl.measureNum}
                    </text>
                  )}
                </g>
              ))}

              {/* Hover cursor line */}
              {hoverMs !== null && duration > 0 && (() => {
                const hoverFrac = hoverMs / duration;
                if (hoverFrac < winStart || hoverFrac > winEnd) return null;
                const x = ((hoverFrac - winStart) / (winEnd - winStart)) * VB_W;
                return (
                  <line x1={x} y1={0} x2={x} y2={wfH}
                    stroke="rgba(255,255,255,0.70)"
                    strokeWidth={1.5}
                    strokeDasharray={isHoveringWf ? undefined : "4,3"}
                    opacity={isHoveringWf ? 0.75 : 0.30}
                    vectorEffect="non-scaling-stroke"
                  />
                );
              })()}

              {/* Playhead */}
              {playerTrackId === track.id && duration > 0 && (() => {
                const progFrac = playerProgress / (duration / 1000);
                if (progFrac < winStart || progFrac > winEnd) return null;
                const x = ((progFrac - winStart) / (winEnd - winStart)) * VB_W;
                return (
                  <line x1={x} y1={0} x2={x} y2={wfH}
                    stroke="rgba(255,255,255,0.80)"
                    strokeWidth={1.5}
                    vectorEffect="non-scaling-stroke"
                  />
                );
              })()}

              {/* Separator lines between zones */}
              <line x1={0} y1={transientH} x2={VB_W} y2={transientH}
                stroke="rgba(255,255,255,0.06)" strokeWidth={0.5} />
              <line x1={0} y1={mainBot} x2={VB_W} y2={mainBot}
                stroke="rgba(255,255,255,0.06)" strokeWidth={0.5} />

              {/* Center line */}
              <line x1={0} y1={mainMid} x2={VB_W} y2={mainMid}
                stroke="rgba(255,255,255,0.04)" strokeWidth={0.5} />

              {bars ? (
                displayBars.slice(barStart, barEnd).map((bar, i) => {
                  const cx = ((i + 0.5) / visN) * VB_W;
                  const color = barColor(bar.bass, bar.treble, bar.amp);
                  const opacity = 0.5 + bar.amp * 0.5;

                  // Top transient strip: downward spikes from y=0
                  const trebleH = Math.max(0.8, bar.treble * transientH);
                  const trebleOpacity = (0.4 + bar.treble * 0.6) * opacity;

                  // Main center waveform in [mainTop, mainBot]
                  const mainH = Math.max(0.8, bar.amp * (mainHalf - 4));

                  // Bottom bass strip: upward spikes from y=wfH
                  const bassAmp = Math.max(0.8, bar.bass * bassH);
                  const bassColor = barColor(bar.bass, bar.treble * 0.3, bar.amp);

                  return (
                    <g key={i}>
                      {/* Transient strip */}
                      <line
                        x1={cx} y1={0}
                        x2={cx} y2={trebleH}
                        stroke={`rgb(217,83,64)`}
                        strokeWidth={1.0}
                        strokeLinecap="round"
                        opacity={trebleOpacity}
                        vectorEffect="non-scaling-stroke"
                      />
                      {/* Main waveform */}
                      <line
                        x1={cx} y1={mainMid - mainH}
                        x2={cx} y2={mainMid + mainH}
                        stroke={color}
                        strokeWidth={1.2}
                        strokeLinecap="round"
                        opacity={opacity}
                        vectorEffect="non-scaling-stroke"
                      />
                      {/* Bass strip */}
                      <line
                        x1={cx} y1={wfH}
                        x2={cx} y2={wfH - bassAmp}
                        stroke={bassColor}
                        strokeWidth={1.0}
                        strokeLinecap="round"
                        opacity={trebleOpacity}
                        vectorEffect="non-scaling-stroke"
                      />
                    </g>
                  );
                })
              ) : (
                Array.from({ length: 80 }, (_, i) => (
                  <line key={i}
                    x1={((i + 0.5) / 80) * VB_W} y1={mainMid * 0.8}
                    x2={((i + 0.5) / 80) * VB_W} y2={mainMid * 1.2}
                    stroke="#D95340" strokeWidth={0.6} opacity={0.08}
                  />
                ))
              )}

            </svg>

            {/* Warp handles — overlay HTML com tamanho fixo, sem distorção do SVG */}
            {bpm && bpm > 0 && beatLines.filter((bl) => bl.isMeasure).map((bl, i) => {
              const leftPct = (bl.x / VB_W) * 100;
              const isAnchor = beatAnchors.some((a) => a.beat_index === bl.beatIndex);
              const color = bl.major ? "#C97B40" : (isAnchor ? "#E0A060" : "rgba(255,255,255,0.55)");
              return (
                <div key={`warp-${i}`}
                  className="absolute top-0"
                  style={{ left: `${leftPct}%`, transform: "translateX(-50%)", width: 16, height: 16, cursor: "ew-resize", zIndex: 4, pointerEvents: "auto" }}
                  onMouseDown={(e) => handleWarpMouseDown(e as unknown as React.MouseEvent, bl.beatIndex)}>
                  <div style={{ position: "absolute", top: 0, left: "50%", transform: "translateX(-50%)", width: 0, height: 0, borderLeft: "5px solid transparent", borderRight: "5px solid transparent", borderTop: `10px solid ${color}`, opacity: isAnchor ? 1 : 0.7 }} />
                </div>
              );
            })}

            {/* Hover cursor time tooltip */}
            {isHoveringWf && hoverMs !== null && duration > 0 && (() => {
              const hoverFrac = hoverMs / duration;
              if (hoverFrac < winStart || hoverFrac > winEnd) return null;
              const leftPct = ((hoverFrac - winStart) / (winEnd - winStart)) * 100;
              return (
                <div className="absolute top-1 pointer-events-none z-20"
                  style={{ left: `${leftPct}%`, transform: "translateX(-50%)" }}>
                  <div className="px-1.5 py-0.5 rounded text-[8px] font-mono whitespace-nowrap"
                    style={{ background: "rgba(0,0,0,0.80)", color: "#C2BEBC", border: "1px solid rgba(255,255,255,0.12)" }}>
                    {fmtMsFull(hoverMs)}
                  </div>
                </div>
              );
            })()}

            {/* CUE markers — CSS overlay */}
            <div className="absolute inset-x-0 pointer-events-none" style={{ top: 0, height: wfH }}>
              {cues.map((cue, i) => {
                const cueFrac = duration > 0 ? cue.position_ms / duration : 0;
                if (cueFrac < winStart || cueFrac > winEnd) return null;
                const leftPct = ((cueFrac - winStart) / (winEnd - winStart)) * 100;
                const isSelected = selectedIdx === i;
                return (
                  <div key={i} className="absolute top-0 bottom-0"
                    style={{ left: `${leftPct}%`, transform: "translateX(-50%)", width: 16, pointerEvents: "auto", cursor: "ew-resize", zIndex: 5 }}
                    onMouseDown={(e) => handleMarkerMouseDown(e as unknown as React.MouseEvent, i)}>
                    <div style={{ position: "absolute", top: 0, left: "50%", transform: "translateX(-50%)",
                      width: 0, height: 0,
                      borderLeft: "6px solid transparent", borderRight: "6px solid transparent",
                      borderTop: `11px solid ${cue.color}`,
                      opacity: isSelected ? 1 : 0.88,
                      filter: isSelected ? `drop-shadow(0 0 3px ${cue.color})` : "none",
                    }} />
                    <div style={{ position: "absolute", top: 1, left: "50%", transform: "translateX(-50%)",
                      fontSize: 7, color: "white", fontFamily: "monospace", fontWeight: "bold",
                      lineHeight: 1, pointerEvents: "none", zIndex: 1 }}>{i + 1}</div>
                    <div style={{ position: "absolute", top: 11, left: "50%", transform: "translateX(-50%)",
                      width: isSelected ? 2 : 1, bottom: 0,
                      background: cue.color,
                      opacity: isSelected ? 0.85 : 0.5,
                    }} />
                  </div>
                );
              })}
            </div>

            {/* Time ruler */}
            <div className="flex px-2 pb-1.5 pt-0.5" style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}>
              {Array.from({ length: 9 }, (_, i) => {
                const frac = winStart + (i / 8) * (winEnd - winStart);
                return (
                  <div key={i} className="flex-1 text-center">
                    <span className="text-[9px] font-mono" style={{ color: "#332e2a" }}>
                      {duration > 0 ? fmtMs(frac * duration) : ""}
                    </span>
                  </div>
                );
              })}
            </div>

          </div>

          {/* Resize handle */}
          <div
            className="flex items-center justify-center mt-1"
            style={{ height: 10, cursor: "ns-resize" }}
            title="Arraste para redimensionar o waveform"
            onMouseDown={handleWfResize}>
            <div style={{ width: 32, height: 3, borderRadius: 2, background: "rgba(255,255,255,0.09)" }} />
          </div>
        </div>

        {/* ── Hotcue grid 4×2 ───────────────────────────────────────────── */}
        <div className="shrink-0 px-4 pt-3 pb-0">
          <div className="grid grid-cols-4 gap-2">
            {Array.from({ length: 8 }, (_, slot) => {
              const entry = slotMap.get(slot);
              const color = DEFAULT_COLORS[slot];
              if (!entry) {
                return (
                  <div key={slot} className="rounded-xl flex flex-col px-3 pt-2 pb-2 gap-1"
                    style={{ height: 52, background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.05)" }}>
                    <span className="text-[9px] font-mono" style={{ color: "#3a3530" }}>CUE {slot + 1}</span>
                    <div className="flex-1 flex items-center gap-2">
                      <svg width="11" height="13" viewBox="0 0 11 13" fill={color} opacity={0.16}><path d="M0.5 0.5L10.5 6.5 0.5 12.5V0.5z"/></svg>
                      {canEdit && cues.length < 8 && (
                        <button
                          onClick={() => addCueAtHoverMs()}
                          title={hoverMs !== null ? `Adicionar CUE em ${fmtMsFull(hoverMs)}` : "Posicione o cursor no waveform primeiro"}
                          className="w-5 h-5 rounded-full flex items-center justify-center transition-all hover:brightness-125 active:scale-90"
                          style={{ background: `${color}33`, border: `1px solid ${color}55`, opacity: hoverMs !== null ? 1 : 0.35 }}>
                          <svg width="7" height="7" viewBox="0 0 7 7" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round">
                            <line x1="3.5" y1="1" x2="3.5" y2="6"/><line x1="1" y1="3.5" x2="6" y2="3.5"/>
                          </svg>
                        </button>
                      )}
                    </div>
                  </div>
                );
              }
              const { cue, listIdx } = entry;
              const isSelected = selectedIdx === listIdx;
              return (
                <div key={slot} className="relative group">
                  <button
                    onClick={() => { setSelectedIdx(listIdx); requestOneShot(cue.position_ms); setWinCenter(cue.position_ms / duration); }}
                    className="w-full rounded-xl flex flex-col px-3 pt-2 pb-2 gap-0.5 text-left transition-all hover:brightness-115 active:scale-[0.97]"
                    style={{ height: 56, background: isSelected ? cue.color : `${cue.color}CC`, border: isSelected ? "1px solid white" : "1px solid transparent", boxShadow: isSelected ? `0 0 14px ${cue.color}88` : "none" }}>
                    <span className="text-[9px] font-mono font-semibold text-white/80 truncate w-full pr-4">{cue.label || `CUE ${slot + 1}`}</span>
                    <span className="text-[8px] font-mono text-white/55">{fmtMs(cue.position_ms)}</span>
                    <div className="flex-1 flex items-end">
                      <svg width="11" height="13" viewBox="0 0 11 13" fill="white" opacity={0.85}><path d="M0.5 0.5L10.5 6.5 0.5 12.5V0.5z"/></svg>
                    </div>
                  </button>
                  {canEdit && (
                    <button
                      onClick={(e) => { e.stopPropagation(); deleteCue(listIdx); }}
                      className="absolute top-1 right-1 w-5 h-5 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                      style={{ background: "rgba(0,0,0,0.45)" }}>
                      <svg width="7" height="7" viewBox="0 0 7 7" fill="none" stroke="white" strokeWidth="1.5" strokeLinecap="round">
                        <line x1="1" y1="1" x2="6" y2="6"/><line x1="6" y1="1" x2="1" y2="6"/>
                      </svg>
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Serato-style Adjust/Slip panel ───────────────────────────── */}
        {selectedIdx !== null && canEdit && (() => {
          const sel = cues[selectedIdx];
          if (!sel) return null;
          const isCurrentTrack = playerTrackId === track.id;
          function nudge(deltaMs: number) {
            if (selectedIdx === null) return;
            pushHistory();
            const newMs = Math.max(0, Math.min(duration - 1, sel.position_ms + deltaMs));
            updateCue(selectedIdx, { position_ms: newMs }, true);
            setWinCenter(newMs / duration);
          }
          function setAtCurrent() {
            if (!isCurrentTrack || selectedIdx === null) return;
            pushHistory();
            const ms = Math.round(playerProgress * 1000);
            updateCue(selectedIdx, { position_ms: Math.max(0, Math.min(duration - 1, ms)) }, true);
            setWinCenter(ms / duration);
          }
          type BtnProps = { label: string; title?: string; onClick: () => void; accent?: boolean };
          function Btn({ label, title, onClick, accent }: BtnProps) {
            return (
              <button onClick={onClick} title={title}
                className="flex-1 h-8 rounded-md text-[11px] font-mono font-semibold transition-all hover:brightness-125 active:scale-95"
                style={{ background: accent ? "rgba(217,83,64,0.18)" : "rgba(255,255,255,0.07)", border: `1px solid ${accent ? "rgba(217,83,64,0.4)" : "rgba(255,255,255,0.14)"}`, color: accent ? "#E07060" : "#C2BEBC" }}>
                {label}
              </button>
            );
          }
          return (
            <div className="shrink-0 px-4 pt-2 pb-0">
              <div className="rounded-xl px-3 py-2.5" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
                <div className="flex items-center gap-1.5 mb-2">
                  <span className="text-[9px] font-mono uppercase tracking-widest w-14 shrink-0" style={{ color: "#756D67" }}>Markers</span>
                  <Btn label="Set" title={isCurrentTrack ? "Definir nesta posição" : "Reproduza a faixa primeiro"} onClick={setAtCurrent} accent={isCurrentTrack} />
                  <Btn label="Clear" title="Remover CUE" onClick={() => deleteCue(selectedIdx)} />
                </div>
                <div className="flex items-center gap-1.5 mb-2">
                  <span className="text-[9px] font-mono uppercase tracking-widest w-14 shrink-0" style={{ color: "#756D67" }}>Adjust</span>
                  <Btn label="-500" title="-500ms" onClick={() => nudge(-500)} />
                  <Btn label="-50" title="-50ms" onClick={() => nudge(-50)} />
                  <Btn label="+50" title="+50ms" onClick={() => nudge(50)} />
                  <Btn label="+500" title="+500ms" onClick={() => nudge(500)} />
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-[9px] font-mono uppercase tracking-widest w-14 shrink-0" style={{ color: "#756D67" }}>Slip</span>
                  <Btn label="-10" title="-10ms" onClick={() => nudge(-10)} />
                  <Btn label="-1" title="-1ms" onClick={() => nudge(-1)} />
                  <Btn label="+1" title="+1ms" onClick={() => nudge(1)} />
                  <Btn label="+10" title="+10ms" onClick={() => nudge(10)} />
                </div>
              </div>
            </div>
          );
        })()}

        {/* ── CUE list ──────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto px-4 pt-2 pb-2 min-h-0">
          {cues.length === 0 ? (
            <div className="py-3 text-center text-[10px]" style={{ color: "#3a3530" }}>
              {"Nenhum CUE. Clique no waveform para adicionar."}
            </div>
          ) : (
            <div className="space-y-1">
              {cues.map((cue, i) => {
                const isSelected = selectedIdx === i;
                return (
                  <div key={i}
                    className="flex items-center gap-2.5 px-3 py-2 rounded-lg cursor-pointer"
                    style={{ background: isSelected ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.02)", border: isSelected ? "1px solid rgba(255,255,255,0.09)" : "1px solid rgba(255,255,255,0.04)" }}
                    onClick={() => { setSelectedIdx(i); setWinCenter(cue.position_ms / duration); }}>
                    <button title="Ouvir (4s)"
                      onClick={(e) => { e.stopPropagation(); setSelectedIdx(i); requestOneShot(cue.position_ms); setWinCenter(cue.position_ms / duration); if (zoom < 4) setZoom(4); }}
                      className="w-6 h-6 rounded-md flex items-center justify-center shrink-0 transition-all hover:brightness-125 active:scale-90"
                      style={{ background: cue.color }}>
                      <svg width="7" height="8" viewBox="0 0 7 8" fill="white"><path d="M0.5 0.5L6.5 4 0.5 7.5V0.5z"/></svg>
                    </button>
                    <span className="text-[11px] font-mono w-24 shrink-0" style={{ color: "#8F8883" }}>{fmtMsFull(cue.position_ms)}</span>
                    <input type="text" value={cue.label} placeholder={`CUE ${i + 1}`} maxLength={32}
                      onFocus={() => pushHistory()}
                      onChange={(e) => updateCue(i, { label: e.target.value }, true)}
                      onClick={(e) => { e.stopPropagation(); setSelectedIdx(i); }}
                      className="flex-1 min-w-0 bg-transparent outline-none text-[11px] font-mono" style={{ color: "#C2BEBC" }} />
                    <div className="flex gap-1 shrink-0">
                      {DEFAULT_COLORS.map((col) => (
                        <button key={col}
                          className="w-3.5 h-3.5 rounded-full transition-transform hover:scale-125"
                          style={{ background: col, boxShadow: cue.color === col ? `0 0 0 2px rgba(255,255,255,0.4)` : "none" }}
                          onClick={(e) => { e.stopPropagation(); updateCue(i, { color: col }); }} />
                      ))}
                    </div>
                    {canEdit && (
                      <button onClick={(e) => { e.stopPropagation(); deleteCue(i); }}
                        className="shrink-0" style={{ color: "#4C4743" }}
                        onMouseEnter={(e) => e.currentTarget.style.color = "#D95340"}
                        onMouseLeave={(e) => e.currentTarget.style.color = "#4C4743"}>
                        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                          <line x1="1" y1="1" x2="9" y2="9"/><line x1="9" y1="1" x2="1" y2="9"/>
                        </svg>
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 shrink-0 border-t"
          style={{ borderColor: "rgba(255,255,255,0.06)", background: "rgba(0,0,0,0.3)" }}>
          <div className="flex items-center gap-3">
            {canAnalyze && (
              <button onClick={handleCalibrateGrid} disabled={analyzing}
                title="Detecta o BPM e o offset do primeiro beat — calibra o grid para bater com a música"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold disabled:opacity-50"
                style={{
                  background: gridStatus === "ok" ? "rgba(217,83,64,0.18)" : "rgba(255,255,255,0.06)",
                  color:      gridStatus === "ok" ? "#E08880" : "#C2BEBC",
                  border:     gridStatus === "ok" ? "1px solid rgba(217,83,64,0.35)" : "1px solid rgba(255,255,255,0.08)",
                }}
                onMouseEnter={(e) => { if (!analyzing) e.currentTarget.style.background = "rgba(255,255,255,0.10)"; }}
                onMouseLeave={(e) => e.currentTarget.style.background = gridStatus === "ok" ? "rgba(217,83,64,0.18)" : "rgba(255,255,255,0.06)"}>
                {analyzing ? (
                  <><svg className="animate-spin" width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="5" cy="5" r="4" strokeDasharray="18" strokeDashoffset="6"/></svg>Calibrando…</>
                ) : gridStatus === "ok" ? (
                  <><svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><polyline points="1.5,5.5 4,8 8.5,2"/></svg>Grid calibrado</>
                ) : (
                  <><svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><line x1="1" y1="5" x2="9" y2="5"/><line x1="5" y1="1" x2="5" y2="9"/><line x1="1" y1="1" x2="9" y2="9" strokeOpacity="0" /><rect x="0.5" y="2.5" width="1.5" height="5" rx="0.3" fill="currentColor" stroke="none"/><rect x="3" y="1.5" width="1.5" height="7" rx="0.3" fill="currentColor" stroke="none"/><rect x="5.5" y="3" width="1.5" height="4" rx="0.3" fill="currentColor" stroke="none"/><rect x="8" y="2" width="1.5" height="6" rx="0.3" fill="currentColor" stroke="none"/></svg>Set Grid</>
                )}
              </button>
            )}
            {localPhaseMs != null && (
              <span className="text-[10px] font-mono" style={{ color: "#4C4743" }}>
                offset {localPhaseMs.toFixed(0)}ms
              </span>
            )}
            {beatAnchors.length > 0 && (
              <span className="text-[10px] font-mono" style={{ color: "#756D67" }}>
                {beatAnchors.length} warp{beatAnchors.length !== 1 ? "s" : ""}
              </span>
            )}
            {!isNativeFmt && <span className="text-[10px]" style={{ color: "#605A55" }} title="CUE points salvos em arquivo local — não no arquivo de áudio">{track.format} · salvo localmente</span>}
            {saveError && <span className="text-[10px] text-red-400">{saveError}</span>}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onClose}
              className="px-4 py-1.5 rounded-lg text-[12px]"
              style={{ color: "#8F8883", background: "rgba(255,255,255,0.04)" }}
              onMouseEnter={(e) => e.currentTarget.style.background = "rgba(255,255,255,0.07)"}
              onMouseLeave={(e) => e.currentTarget.style.background = "rgba(255,255,255,0.04)"}>
              Cancelar
            </button>
            {canEdit && (
              <button onClick={handleSave} disabled={saving}
                className="px-5 py-1.5 rounded-lg text-[12px] font-semibold text-white disabled:opacity-40"
                style={{ background: "#D95340" }}
                onMouseEnter={(e) => { if (!saving) e.currentTarget.style.background = "#E07364"; }}
                onMouseLeave={(e) => e.currentTarget.style.background = "#D95340"}>
                {saving ? "Salvando…" : "Salvar"}
              </button>
            )}
          </div>
        </div>
      </div>
  );

  if (inline) return inner;

  return (
    <div className="fixed inset-0 z-[600] flex items-center justify-center bg-black/75 backdrop-blur-sm">
      {inner}
    </div>
  );
}
