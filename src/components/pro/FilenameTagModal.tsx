import { useState, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "../../store";
import { toast } from "../Toast";

interface Props { onClose: () => void; }

const VARS = ["%artist%", "%title%", "%album%", "%year%", "%track%", "%genre%", "%ignore%"];

const PRESETS = [
  "Formato: %artist% - %title%",
  "Formato: %track% - %title%",
  "Formato: %artist% - %album% - %title%",
  "Formato: %title% (%artist%)",
];

function applyPattern(filename: string, pattern: string): Record<string, string> {
  // Remove extensão
  const base = filename.replace(/\.[^.]+$/, "");
  const result: Record<string, string> = {};

  // Substitui variáveis por grupos de captura
  const escaped = pattern.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&");
  const regexStr = VARS.reduce((acc, v) => {
    return acc.replace(v.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&"), `(.+?)`);
  }, escaped);

  const varOrder = [...pattern.matchAll(/%([a-z]+)%/g)].map((m) => m[1]);
  try {
    const rx = new RegExp(`^${regexStr}$`, "i");
    const match = base.match(rx);
    if (match) {
      varOrder.forEach((varName, i) => {
        if (varName !== "ignore") result[varName] = match[i + 1]?.trim() ?? "";
      });
    }
  } catch { /* regex inválida */ }

  return result;
}

export default function FilenameTagModal({ onClose }: Props) {
  const tracks = useAppStore((s) => s.tracks);
  const selectedIds = useAppStore((s) => s.selectedIds);
  const updateTrack = useAppStore((s) => s.updateTrack);

  const targets = useMemo(() => {
    const sel = selectedIds.size > 0
      ? tracks.filter((t) => selectedIds.has(t.id))
      : tracks;
    return sel.slice(0, 200);
  }, [tracks, selectedIds]);

  const [pattern, setPattern] = useState("%artist% - %title%");
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState(0);

  const previews = useMemo(() => {
    return targets.slice(0, 8).map((t) => ({
      track: t,
      extracted: applyPattern(t.filename, pattern),
    }));
  }, [targets, pattern]);

  const handleApply = async () => {
    setApplying(true);
    let count = 0;
    for (const t of targets) {
      const extracted = applyPattern(t.filename, pattern);
      if (Object.keys(extracted).length === 0) continue;
      const updated = {
        ...t,
        title:  extracted.title  ?? t.title,
        artist: extracted.artist ?? t.artist,
        album:  extracted.album  ?? t.album,
        year:   extracted.year ? (parseInt(extracted.year) || t.year) : t.year,
        genre:  extracted.genre  ?? t.genre,
        track_number: extracted.track ? (parseInt(extracted.track) || t.track_number) : t.track_number,
      };
      try {
        await invoke("save_tags", {
          path: t.path, title: updated.title ?? null, artist: updated.artist ?? null,
          album: updated.album ?? null, genre: updated.genre ?? null,
          year: updated.year ?? null, trackNumber: updated.track_number ?? null,
          totalTracks: updated.total_tracks ?? null, bpm: updated.bpm ?? null,
          key: updated.key ?? null, rating: updated.rating ?? null, comment: updated.comment ?? null,
        });
        updateTrack(updated);
        count++;
      } catch { /* ignora erros individuais */ }
    }
    setApplying(false);
    setApplied(count);
    toast(`Tags extraídas em ${count} faixa${count !== 1 ? "s" : ""}`, "success");
    setTimeout(onClose, 1200);
  };

  const FIELD_LABELS: Record<string, string> = {
    title: "Título", artist: "Artista", album: "Álbum",
    year: "Ano", track: "Faixa", genre: "Gênero",
  };

  return (
    <div className="fixed inset-0 z-[500] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-[#1c1715] border border-white/[0.08] rounded-2xl w-[560px] max-h-[85vh] overflow-hidden flex flex-col shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="px-5 py-4 border-b border-white/[0.06] flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-[#D95340]/15 flex items-center justify-center">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="#D95340" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 7h10M7 2l5 5-5 5"/>
            </svg>
          </div>
          <div>
            <h2 className="text-[13px] font-bold text-[#F5F5F4]">Filename → Tag</h2>
            <p className="text-[10px] text-[#605A55]">Extrai metadados do nome do arquivo · {targets.length} faixa{targets.length !== 1 ? "s" : ""}</p>
          </div>
          <div className="ml-auto flex items-center gap-1">
            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-[#D95340]/20 text-[#D95340]">PRO</span>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto no-scrollbar px-5 py-4 space-y-4">
          {/* Padrão */}
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-[#4C4743] mb-2">Padrão do nome</p>
            <input
              type="text"
              value={pattern}
              onChange={(e) => setPattern(e.target.value)}
              className="w-full px-3 py-2 rounded-lg text-[12px] font-mono focus:outline-none focus:border-[#D95340]/50"
              style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.10)", color: "#E8E4E1" }}
            />
            {/* Variáveis */}
            <div className="flex flex-wrap gap-1.5 mt-2">
              {VARS.map((v) => (
                <button key={v} onClick={() => setPattern((p) => p + v)}
                  className="px-2 py-0.5 rounded text-[10px] font-mono text-[#D95340] transition-colors"
                  style={{ background: "rgba(217,83,64,0.10)", border: "1px solid rgba(217,83,64,0.20)" }}>
                  {v}
                </button>
              ))}
            </div>
            {/* Presets */}
            <div className="mt-2 flex flex-wrap gap-1.5">
              {PRESETS.map((p) => {
                const pat = p.replace("Formato: ", "");
                return (
                  <button key={p} onClick={() => setPattern(pat)}
                    className="px-2 py-0.5 rounded text-[9px] text-[#605A55] hover:text-[#C2BEBC] transition-colors"
                    style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.05)" }}>
                    {p}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Preview */}
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-[#4C4743] mb-2">Preview (primeiras 8 faixas)</p>
            <div className="space-y-1.5">
              {previews.map(({ track, extracted }) => {
                const hasMatch = Object.keys(extracted).length > 0;
                return (
                  <div key={track.id} className="rounded-lg px-3 py-2"
                    style={{ background: hasMatch ? "rgba(91,160,85,0.06)" : "rgba(255,255,255,0.02)", border: `1px solid ${hasMatch ? "rgba(91,160,85,0.15)" : "rgba(255,255,255,0.04)"}` }}>
                    <p className="text-[10px] font-mono text-[#605A55] truncate mb-1">{track.filename}</p>
                    {hasMatch ? (
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                        {Object.entries(extracted).map(([k, v]) => (
                          <span key={k} className="text-[10px]">
                            <span className="text-[#4C4743]">{FIELD_LABELS[k] ?? k}: </span>
                            <span className="text-[#C2BEBC] font-medium">{v}</span>
                          </span>
                        ))}
                      </div>
                    ) : (
                      <p className="text-[10px] text-[#4C4743]">Padrão não encontrado</p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 border-t border-white/[0.06] flex items-center justify-between">
          <p className="text-[10px] text-[#4C4743]">
            {applied > 0 ? `${applied} faixas atualizadas` : `${targets.length} faixa${targets.length !== 1 ? "s" : ""} serão processadas`}
          </p>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="px-4 py-1.5 text-[12px] text-[#756D67] hover:text-[#C2BEBC] transition-colors rounded-lg hover:bg-white/[0.04]">
              Cancelar
            </button>
            <button onClick={handleApply} disabled={applying}
              className="px-4 py-1.5 text-[12px] font-semibold bg-[#D95340] hover:bg-[#E07364] text-white rounded-lg transition-colors disabled:opacity-50">
              {applying ? "Aplicando…" : "Aplicar tags"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
