import { useState, useRef, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { generateRGBWaveform, type WaveBar } from "../lib/waveformAnalyzer";
import { type Track, type CuePoint } from "../store";

interface Props {
  track: Track;
  onClose: () => void;
  onSaved?: (cues: CuePoint[]) => void;
}

const BARS = 300;
const WF_H = 120;
const WF_W_VB = BARS * 2.4;

const DEFAULT_COLORS = [
  "#CC0000", "#CC6600", "#CCCC00", "#00CC00",
  "#00CCCC", "#0000CC", "#CC00CC", "#CC0088",
];

function fmtMs(ms: number): string {
  if (!isFinite(ms)) return "0:00.000";
  const total_s = ms / 1000;
  const m = Math.floor(total_s / 60);
  const s = Math.floor(total_s % 60);
  const ms_ = Math.round(ms % 1000);
  return `${m}:${String(s).padStart(2, "0")}.${String(ms_).padStart(3, "0")}`;
}

function barColor(bass: number, treble: number): string {
  const total = bass + treble + 1e-9;
  const t = treble / total;
  let r: number, g: number, b: number;
  if (t < 0.5) {
    const k = t * 2;
    r = Math.round(217 + k * (245 - 217));
    g = Math.round(83  + k * (169 - 83));
    b = Math.round(64  + k * (74  - 64));
  } else {
    const k = (t - 0.5) * 2;
    r = Math.round(245 + k * (122 - 245));
    g = Math.round(169 + k * (178 - 169));
    b = Math.round(74  + k * (117 - 74));
  }
  return `rgb(${r},${g},${b})`;
}

export default function CuePointsModal({ track, onClose, onSaved }: Props) {
  const [bars, setBars] = useState<WaveBar[] | null>(null);
  const [cues, setCues] = useState<CuePoint[]>(() =>
    [...(track.cue_points ?? [])].sort((a, b) => a.position_ms - b.position_ms)
  );
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<{ cueIdx: number; startX: number; startMs: number } | null>(null);

  const duration = (track.duration_secs ?? 0) * 1000; // ms
  const bpm = track.bpm ? parseFloat(track.bpm) : null;

  useEffect(() => {
    generateRGBWaveform(track.path, BARS)
      .then((data) => { if (data) setBars(data); })
      .catch(() => {});
  }, [track.path]);

  function msFromSvgX(clientX: number): number {
    const svg = svgRef.current;
    if (!svg || duration <= 0) return 0;
    const rect = svg.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return Math.round(ratio * duration);
  }

  function handleWaveformClick(e: React.MouseEvent<SVGSVGElement>) {
    if (dragRef.current) return; // was dragging
    const ms = msFromSvgX(e.clientX);

    // Check if near existing cue (within ~12px)
    const svg = svgRef.current;
    if (svg) {
      const svgWidth = svg.getBoundingClientRect().width;
      const THRESHOLD_MS = duration * (12 / svgWidth);
      const near = cues.findIndex((c) => Math.abs(c.position_ms - ms) < THRESHOLD_MS);
      if (near >= 0) { setSelectedIdx(near); return; }
    }

    // Add new cue
    const nextIndex = Math.min(7, cues.length);
    const newCue: CuePoint = {
      index: nextIndex,
      position_ms: ms,
      label: "",
      color: DEFAULT_COLORS[nextIndex % DEFAULT_COLORS.length],
    };
    const updated = [...cues, newCue].sort((a, b) => a.position_ms - b.position_ms);
    setCues(updated);
    setSelectedIdx(updated.findIndex((c) => c.position_ms === ms && c.index === nextIndex));
  }

  const handleMarkerMouseDown = useCallback((e: React.MouseEvent, cueIdx: number) => {
    e.preventDefault();
    e.stopPropagation();
    setSelectedIdx(cueIdx);
    dragRef.current = { cueIdx, startX: e.clientX, startMs: cues[cueIdx].position_ms };

    function onMove(ev: MouseEvent) {
      if (!dragRef.current) return;
      const svg = svgRef.current;
      if (!svg || duration <= 0) return;
      const rect = svg.getBoundingClientRect();
      const dx = ev.clientX - rect.left;
      const ms = Math.max(0, Math.min(duration, Math.round((dx / rect.width) * duration)));
      setCues((prev) => {
        const next = [...prev];
        next[dragRef.current!.cueIdx] = { ...next[dragRef.current!.cueIdx], position_ms: ms };
        return next;
      });
    }

    function onUp() {
      dragRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [cues, duration]);

  function updateCue(idx: number, updates: Partial<CuePoint>) {
    setCues((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], ...updates };
      return next;
    });
  }

  function deleteCue(idx: number) {
    setCues((prev) => {
      const next = prev.filter((_, i) => i !== idx);
      // re-assign index values in order
      return next.map((c, i) => ({ ...c, index: i }));
    });
    setSelectedIdx(null);
  }

  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    try {
      await invoke("save_cue_points", { path: track.path, cues });
      onSaved?.(cues);
      onClose();
    } catch (err) {
      setSaveError(String(err));
    } finally {
      setSaving(false);
    }
  }

  // Beat grid positions
  const beatPositions: number[] = [];
  if (bpm && bpm > 0 && duration > 0) {
    const beatMs = 60000 / bpm;
    for (let ms = 0; ms < duration; ms += beatMs) {
      beatPositions.push(ms / duration);
    }
  }

  const canEdit = track.format === "MP3" || track.format === "AIFF" || track.format === "AIF";

  return (
    <div
      className="fixed inset-0 z-[600] flex items-center justify-center bg-black/75 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative flex flex-col rounded-2xl overflow-hidden shadow-2xl select-none"
        style={{ width: "min(820px, 92vw)", maxHeight: "88vh", background: "#0E0D0C", border: "1px solid rgba(255,255,255,0.07)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-3 border-b shrink-0" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="#D95340" strokeWidth="1.5" strokeLinecap="round">
            <circle cx="6.5" cy="6.5" r="5.5"/>
            <line x1="6.5" y1="3" x2="6.5" y2="6.5"/>
            <circle cx="6.5" cy="9" r="0.7" fill="#D95340" stroke="none"/>
          </svg>
          <div className="flex-1 min-w-0">
            <p className="text-[12px] font-semibold truncate" style={{ color: "#C2BEBC" }}>
              {track.title || track.filename}
            </p>
            {track.artist && (
              <p className="text-[10px] truncate" style={{ color: "#605A55" }}>{track.artist}</p>
            )}
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {bpm && (
              <span className="text-[10px] font-mono" style={{ color: "#4C4743" }}>
                {bpm.toFixed(0)} BPM
              </span>
            )}
            <span className="text-[10px] font-mono" style={{ color: "#4C4743" }}>
              {cues.length} cue{cues.length !== 1 ? "s" : ""}
            </span>
          </div>
          <button
            onClick={onClose}
            className="w-6 h-6 flex items-center justify-center rounded-full transition-colors"
            style={{ color: "#605A55" }}
            onMouseEnter={(e) => { e.currentTarget.style.color = "#C2BEBC"; e.currentTarget.style.background = "rgba(255,255,255,0.06)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = "#605A55"; e.currentTarget.style.background = "transparent"; }}
          >
            <svg width="9" height="9" viewBox="0 0 9 9" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
              <line x1="1" y1="1" x2="8" y2="8"/><line x1="8" y1="1" x2="1" y2="8"/>
            </svg>
          </button>
        </div>

        {/* Waveform + CUE grid */}
        <div className="shrink-0 px-4 pt-4 pb-2">
          <div
            className="relative rounded-xl overflow-hidden"
            style={{ background: "#08080A", border: "1px solid rgba(255,255,255,0.06)" }}
          >
            {/* Click hint */}
            {canEdit && cues.length === 0 && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
                <span className="text-[11px]" style={{ color: "#4C4743" }}>
                  Clique na forma de onda para adicionar CUE Points
                </span>
              </div>
            )}

            <svg
              ref={svgRef}
              width="100%"
              height={WF_H}
              viewBox={`0 0 ${WF_W_VB} ${WF_H}`}
              preserveAspectRatio="none"
              className="block"
              style={{ cursor: canEdit ? "crosshair" : "default" }}
              onClick={canEdit ? handleWaveformClick : undefined}
            >
              {/* Beat grid */}
              {beatPositions.map((ratio, i) => (
                <line
                  key={i}
                  x1={ratio * WF_W_VB}
                  y1={0}
                  x2={ratio * WF_W_VB}
                  y2={WF_H}
                  stroke="rgba(255,255,255,0.04)"
                  strokeWidth={i % 4 === 0 ? 1.2 : 0.6}
                />
              ))}

              {/* Waveform bars */}
              {bars ? bars.map((bar, i) => {
                const barH = Math.max(1.5, bar.amp * (WF_H - 8));
                const y = (WF_H - barH) / 2;
                return (
                  <rect
                    key={i}
                    x={i * 2.4}
                    y={y}
                    width={1.6}
                    height={barH}
                    fill={barColor(bar.bass, bar.treble)}
                    opacity={0.25 + bar.amp * 0.65}
                    rx={0.5}
                  />
                );
              }) : Array.from({ length: BARS }, (_, i) => (
                <rect
                  key={i}
                  x={i * 2.4}
                  y={WF_H * 0.3}
                  width={1.6}
                  height={WF_H * 0.4}
                  fill="#D95340"
                  opacity={0.06}
                  rx={0.5}
                />
              ))}

              {/* CUE markers */}
              {cues.map((cue, i) => {
                const x = duration > 0 ? (cue.position_ms / duration) * WF_W_VB : 0;
                const isSelected = selectedIdx === i;
                return (
                  <g key={i} style={{ cursor: "ew-resize" }} onMouseDown={(e) => handleMarkerMouseDown(e, i)}>
                    {/* Vertical line */}
                    <line
                      x1={x} y1={0} x2={x} y2={WF_H}
                      stroke={cue.color}
                      strokeWidth={isSelected ? 2 : 1.5}
                      opacity={isSelected ? 1 : 0.8}
                    />
                    {/* Badge top */}
                    <rect
                      x={x - 8} y={0}
                      width={16} height={16}
                      fill={cue.color}
                      rx={3}
                      opacity={isSelected ? 1 : 0.85}
                    />
                    <text
                      x={x} y={11.5}
                      textAnchor="middle"
                      fill="white"
                      fontSize={9}
                      fontFamily="monospace"
                      fontWeight="bold"
                      style={{ pointerEvents: "none" }}
                    >
                      {i + 1}
                    </text>
                    {/* Invisible wider hit target */}
                    <line
                      x1={x} y1={16} x2={x} y2={WF_H}
                      stroke="transparent"
                      strokeWidth={12}
                    />
                  </g>
                );
              })}
            </svg>

            {/* Time ruler */}
            <div className="flex px-2 pb-1.5 pt-0.5" style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}>
              {Array.from({ length: 9 }, (_, i) => (
                <div key={i} className="flex-1 text-center">
                  <span className="text-[9px] font-mono" style={{ color: "#373331" }}>
                    {duration > 0 ? fmtMs((i / 8) * duration).split(".")[0] : ""}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* CUE list */}
        <div className="flex-1 overflow-y-auto px-4 pb-2 min-h-0">
          {cues.length === 0 ? (
            <div className="py-6 text-center text-[11px]" style={{ color: "#4C4743" }}>
              {canEdit ? "Nenhum CUE Point. Clique na forma de onda para adicionar." : "Nenhum CUE Point encontrado. Formato não suportado para edição."}
            </div>
          ) : (
            <div className="space-y-1.5">
              {cues.map((cue, i) => {
                const isSelected = selectedIdx === i;
                return (
                  <div
                    key={i}
                    className="flex items-center gap-2.5 px-3 py-2 rounded-lg cursor-pointer transition-colors"
                    style={{
                      background: isSelected ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.02)",
                      border: isSelected ? "1px solid rgba(255,255,255,0.09)" : "1px solid rgba(255,255,255,0.04)",
                    }}
                    onClick={() => setSelectedIdx(i)}
                  >
                    {/* Index badge */}
                    <div
                      className="w-5 h-5 rounded flex items-center justify-center shrink-0 text-white font-bold"
                      style={{ background: cue.color, fontSize: 10 }}
                    >
                      {i + 1}
                    </div>

                    {/* Time */}
                    <span className="text-[11px] font-mono w-24 shrink-0" style={{ color: "#8F8883" }}>
                      {fmtMs(cue.position_ms)}
                    </span>

                    {/* Label */}
                    <input
                      type="text"
                      value={cue.label}
                      placeholder={`CUE ${i + 1}`}
                      maxLength={32}
                      onChange={(e) => updateCue(i, { label: e.target.value })}
                      onClick={(e) => { e.stopPropagation(); setSelectedIdx(i); }}
                      className="flex-1 min-w-0 bg-transparent outline-none text-[11px] font-mono"
                      style={{ color: "#C2BEBC" }}
                    />

                    {/* Color swatches */}
                    <div className="flex gap-1 shrink-0">
                      {DEFAULT_COLORS.map((col) => (
                        <button
                          key={col}
                          title={col}
                          className="w-3.5 h-3.5 rounded-full transition-transform hover:scale-125"
                          style={{
                            background: col,
                            boxShadow: cue.color === col ? `0 0 0 2px rgba(255,255,255,0.4)` : "none",
                          }}
                          onClick={(e) => { e.stopPropagation(); updateCue(i, { color: col }); setSelectedIdx(i); }}
                        />
                      ))}
                    </div>

                    {/* Delete */}
                    {canEdit && (
                      <button
                        onClick={(e) => { e.stopPropagation(); deleteCue(i); }}
                        className="shrink-0 transition-colors"
                        style={{ color: "#4C4743" }}
                        onMouseEnter={(e) => e.currentTarget.style.color = "#D95340"}
                        onMouseLeave={(e) => e.currentTarget.style.color = "#4C4743"}
                        title="Remover CUE Point"
                      >
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
        <div
          className="flex items-center justify-between px-5 py-3 shrink-0 border-t"
          style={{ borderColor: "rgba(255,255,255,0.06)", background: "rgba(0,0,0,0.3)" }}
        >
          <div className="flex items-center gap-3">
            {!canEdit && (
              <span className="text-[10px]" style={{ color: "#605A55" }}>
                Edição disponível apenas para MP3 e AIFF
              </span>
            )}
            {saveError && (
              <span className="text-[10px] text-red-400">{saveError}</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-1.5 rounded-lg text-[12px] transition-colors"
              style={{ color: "#8F8883", background: "rgba(255,255,255,0.04)" }}
              onMouseEnter={(e) => e.currentTarget.style.background = "rgba(255,255,255,0.07)"}
              onMouseLeave={(e) => e.currentTarget.style.background = "rgba(255,255,255,0.04)"}
            >
              Cancelar
            </button>
            {canEdit && (
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-5 py-1.5 rounded-lg text-[12px] font-semibold text-white transition-colors disabled:opacity-40"
                style={{ background: "#D95340" }}
                onMouseEnter={(e) => { if (!saving) e.currentTarget.style.background = "#E07364"; }}
                onMouseLeave={(e) => e.currentTarget.style.background = "#D95340"}
              >
                {saving ? "Salvando…" : "Salvar"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
