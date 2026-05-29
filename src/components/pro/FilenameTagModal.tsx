import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "../../store";
import { toast } from "../Toast";

interface Props { onClose: () => void; }

const VARS = ["%artist%", "%title%", "%album%", "%year%", "%track%", "%genre%", "%ignore%"];

function applyPattern(filename: string, pattern: string): Record<string, string> {
  const base = filename.replace(/\.[^.]+$/, "");
  const result: Record<string, string> = {};
  const escaped = pattern.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&");
  const regexStr = VARS.reduce((acc, v) =>
    acc.replace(v.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&"), "(.+?)"), escaped);
  const varOrder = [...pattern.matchAll(/%([a-z]+)%/g)].map((m) => m[1]);
  try {
    const rx = new RegExp(`^${regexStr}$`, "i");
    const match = base.match(rx);
    if (match) varOrder.forEach((v, i) => { if (v !== "ignore") result[v] = match[i + 1]?.trim() ?? ""; });
  } catch { /* invalid regex */ }
  return result;
}

export default function FilenameTagModal({ onClose }: Props) {
  const { t } = useTranslation();
  const tracks = useAppStore((s) => s.tracks);
  const selectedIds = useAppStore((s) => s.selectedIds);
  const updateTrack = useAppStore((s) => s.updateTrack);

  const targets = useMemo(() => {
    const sel = selectedIds.size > 0 ? tracks.filter((tr) => selectedIds.has(tr.id)) : tracks;
    return sel.slice(0, 200);
  }, [tracks, selectedIds]);

  const [pattern, setPattern] = useState("%artist% - %title%");
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState(0);

  const PRESETS = [
    "%artist% - %title%",
    "%track% - %title%",
    "%artist% - %album% - %title%",
    "%title% (%artist%)",
  ];

  const FIELD_LABELS: Record<string, string> = {
    title: t("inspector.title"), artist: t("inspector.artist"), album: t("inspector.album"),
    year: t("inspector.year"), track: t("inspector.track"), genre: t("inspector.genre"),
  };

  const previews = useMemo(() =>
    targets.slice(0, 8).map((tr) => ({ track: tr, extracted: applyPattern(tr.filename, pattern) })),
    [targets, pattern]);

  const handleApply = async () => {
    setApplying(true);
    let count = 0;
    for (const tr of targets) {
      const extracted = applyPattern(tr.filename, pattern);
      if (!Object.keys(extracted).length) continue;
      const updated = {
        ...tr,
        title:        extracted.title  ?? tr.title,
        artist:       extracted.artist ?? tr.artist,
        album:        extracted.album  ?? tr.album,
        year:         extracted.year ? (parseInt(extracted.year) || tr.year) : tr.year,
        genre:        extracted.genre  ?? tr.genre,
        track_number: extracted.track ? (parseInt(extracted.track) || tr.track_number) : tr.track_number,
      };
      try {
        await invoke("save_tags", {
          path: updated.path, title: updated.title ?? null, artist: updated.artist ?? null,
          album: updated.album ?? null, genre: updated.genre ?? null, year: updated.year ?? null,
          trackNumber: updated.track_number ?? null, totalTracks: updated.total_tracks ?? null,
          bpm: updated.bpm ?? null, key: updated.key ?? null, rating: updated.rating ?? null, comment: updated.comment ?? null,
        });
        updateTrack(updated);
        count++;
      } catch { /* skip */ }
    }
    setApplying(false);
    setApplied(count);
    toast(t("pro.filenameTag.successToast", { count }), "success");
    setTimeout(onClose, 1200);
  };

  return (
    <div className="fixed inset-0 z-[500] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-[#1c1715] border border-white/[0.08] rounded-2xl w-[560px] max-h-[85vh] overflow-hidden flex flex-col shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-white/[0.06] flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-[#D95340]/15 flex items-center justify-center">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="#D95340" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 7h10M7 2l5 5-5 5"/>
            </svg>
          </div>
          <div>
            <h2 className="text-[13px] font-bold text-[#F5F5F4]">{t("pro.filenameTag.title")}</h2>
            <p className="text-[10px] text-[#605A55]">{t("pro.filenameTag.subtitle", { count: targets.length })}</p>
          </div>
          <span className="ml-auto text-[9px] font-bold px-1.5 py-0.5 rounded bg-[#D95340]/20 text-[#D95340]">{t("pro.badge")}</span>
        </div>

        <div className="flex-1 overflow-y-auto no-scrollbar px-5 py-4 space-y-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-[#4C4743] mb-2">{t("pro.filenameTag.patternLabel")}</p>
            <input type="text" value={pattern} onChange={(e) => setPattern(e.target.value)}
              className="w-full px-3 py-2 rounded-lg text-[12px] font-mono focus:outline-none focus:border-[#D95340]/50"
              style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.10)", color: "#E8E4E1" }}
            />
            <div className="flex flex-wrap gap-1.5 mt-2">
              {VARS.map((v) => (
                <button key={v} onClick={() => setPattern((p) => p + v)}
                  className="px-2 py-0.5 rounded text-[10px] font-mono text-[#D95340] transition-colors"
                  style={{ background: "rgba(217,83,64,0.10)", border: "1px solid rgba(217,83,64,0.20)" }}>
                  {v}
                </button>
              ))}
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {PRESETS.map((p) => (
                <button key={p} onClick={() => setPattern(p)}
                  className="px-2 py-0.5 rounded text-[9px] text-[#605A55] hover:text-[#C2BEBC] transition-colors"
                  style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.05)" }}>
                  {p}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-[#4C4743] mb-2">{t("pro.filenameTag.previewLabel")}</p>
            <div className="space-y-1.5">
              {previews.map(({ track: tr, extracted }) => {
                const hasMatch = Object.keys(extracted).length > 0;
                return (
                  <div key={tr.id} className="rounded-lg px-3 py-2"
                    style={{
                      background: hasMatch ? "rgba(91,160,85,0.06)" : "rgba(255,255,255,0.02)",
                      border: `1px solid ${hasMatch ? "rgba(91,160,85,0.15)" : "rgba(255,255,255,0.04)"}`,
                    }}>
                    <p className="text-[10px] font-mono text-[#605A55] truncate mb-1">{tr.filename}</p>
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
                      <p className="text-[10px] text-[#4C4743]">{t("pro.filenameTag.noMatch")}</p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="px-5 py-3.5 border-t border-white/[0.06] flex items-center justify-between">
          <p className="text-[10px] text-[#4C4743]">
            {applied > 0
              ? t("pro.filenameTag.updated", { count: applied })
              : t("pro.filenameTag.willProcess", { count: targets.length })}
          </p>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="px-4 py-1.5 text-[12px] text-[#756D67] hover:text-[#C2BEBC] transition-colors rounded-lg hover:bg-white/[0.04]">
              {t("common.cancel")}
            </button>
            <button onClick={handleApply} disabled={applying}
              className="px-4 py-1.5 text-[12px] font-semibold bg-[#D95340] hover:bg-[#E07364] text-white rounded-lg transition-colors disabled:opacity-50">
              {applying ? t("pro.filenameTag.applying") : t("pro.filenameTag.applyBtn")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
