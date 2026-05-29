import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore, type Track } from "../../store";
import { toast } from "../Toast";

interface Props { tracks: Track[]; onClose: () => void; }

interface AcoustResult {
  track: Track;
  status: "pending" | "processing" | "matched" | "no_match" | "error";
  artist?: string;
  title?: string;
  album?: string;
  year?: string;
}

export default function AcoustIDModal({ tracks, onClose }: Props) {
  const updateTrack = useAppStore((s) => s.updateTrack);
  const [apiKey] = useState(() => localStorage.getItem("tw_acoustid_key") ?? "8XaBELgH");
  const [results, setResults] = useState<AcoustResult[]>(
    tracks.map((t) => ({ track: t, status: "pending" }))
  );
  const [running, setRunning] = useState(false);
  const [applyAll, setApplyAll] = useState<Set<string>>(new Set());

  const updateResult = (id: string, patch: Partial<AcoustResult>) => {
    setResults((prev) => prev.map((r) => r.track.id === id ? { ...r, ...patch } : r));
  };

  const runFingerprint = async () => {
    setRunning(true);
    for (const r of results) {
      if (r.status !== "pending") continue;
      updateResult(r.track.id, { status: "processing" });
      try {
        const data = await invoke<Record<string, unknown>>("get_acoustid_fingerprint", {
          path: r.track.path, apiKey,
        });
        const results_arr = (data.results as unknown[]) ?? [];
        if (!results_arr.length) { updateResult(r.track.id, { status: "no_match" }); continue; }

        // Pega o primeiro resultado com recordings
        const first = results_arr[0] as Record<string, unknown>;
        const recs = (first.recordings as unknown[]) ?? [];
        if (!recs.length) { updateResult(r.track.id, { status: "no_match" }); continue; }

        const rec = recs[0] as Record<string, unknown>;
        const title = String(rec.title ?? "");
        const artists = (rec.artists as unknown[]) ?? [];
        const artist = artists.length ? String((artists[0] as Record<string,unknown>).name ?? "") : "";
        const releases = (rec.releases as unknown[]) ?? [];
        const album = releases.length ? String((releases[0] as Record<string,unknown>).title ?? "") : "";
        const year = releases.length ? String((releases[0] as Record<string,unknown>).date ?? "").slice(0, 4) : "";

        updateResult(r.track.id, { status: "matched", title, artist, album, year });
      } catch {
        updateResult(r.track.id, { status: "error" });
      }
    }
    setRunning(false);
  };

  const applyResult = async (r: AcoustResult) => {
    if (r.status !== "matched") return;
    const updated = {
      ...r.track,
      title:  r.title  || r.track.title,
      artist: r.artist || r.track.artist,
      album:  r.album  || r.track.album,
      year:   r.year ? (parseInt(r.year) || r.track.year) : r.track.year,
    };
    try {
      await invoke("save_tags", {
        path: updated.path, title: updated.title ?? null, artist: updated.artist ?? null,
        album: updated.album ?? null, genre: updated.genre ?? null, year: updated.year ?? null,
        trackNumber: updated.track_number ?? null, totalTracks: updated.total_tracks ?? null,
        bpm: updated.bpm ?? null, key: updated.key ?? null,
        rating: updated.rating ?? null, comment: updated.comment ?? null,
      });
      updateTrack(updated);
      setApplyAll((prev) => new Set([...prev, r.track.id]));
      toast(`Tags aplicadas: ${updated.title}`, "success");
    } catch (e) {
      toast(`Erro: ${e}`, "error");
    }
  };

  const applyAllMatched = () => {
    results.filter((r) => r.status === "matched" && !applyAll.has(r.track.id)).forEach(applyResult);
  };

  const matched = results.filter((r) => r.status === "matched").length;
  const noMatch = results.filter((r) => r.status === "no_match").length;
  const errors  = results.filter((r) => r.status === "error").length;

  const statusIcon = (s: AcoustResult["status"]) => {
    if (s === "matched")    return <span className="text-[#5BA055] text-[10px]">✓</span>;
    if (s === "no_match")   return <span className="text-[#605A55] text-[10px]">–</span>;
    if (s === "error")      return <span className="text-[#D95340] text-[10px]">!</span>;
    if (s === "processing") return <span className="text-[#D95340] text-[10px] animate-pulse">⋯</span>;
    return <span className="text-[#4C4743] text-[10px]">○</span>;
  };

  return (
    <div className="fixed inset-0 z-[500] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-[#1c1715] border border-white/[0.08] rounded-2xl w-[580px] max-h-[88vh] flex flex-col shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="px-5 py-4 border-b border-white/[0.06] flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-[#D95340]/15 flex items-center justify-center shrink-0">
            <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="#D95340" strokeWidth="1.5" strokeLinecap="round">
              <circle cx="7.5" cy="7.5" r="6"/>
              <path d="M5 7.5q1-2 2.5-2t2.5 2-2.5 2-2.5-2"/>
              <circle cx="7.5" cy="7.5" r="1" fill="#D95340" stroke="none"/>
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-[13px] font-bold text-[#F5F5F4]">AcoustID Fingerprinting</h2>
            <p className="text-[10px] text-[#605A55]">{tracks.length} faixa{tracks.length !== 1 ? "s" : ""} para identificar</p>
          </div>
          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-[#D95340]/20 text-[#D95340] shrink-0">PRO</span>
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto no-scrollbar px-5 py-3 space-y-1">
          {results.map((r) => (
            <div key={r.track.id} className="flex items-center gap-3 px-3 py-2 rounded-lg"
              style={{ background: r.status === "matched" ? "rgba(91,160,85,0.05)" : "rgba(255,255,255,0.02)", border: `1px solid ${r.status === "matched" ? "rgba(91,160,85,0.12)" : "rgba(255,255,255,0.04)"}` }}>
              <div className="w-5 flex items-center justify-center shrink-0">{statusIcon(r.status)}</div>
              <div className="flex-1 min-w-0">
                <p className="text-[11px] text-[#8F8883] truncate">{r.track.filename}</p>
                {r.status === "matched" && (
                  <p className="text-[11px] font-medium text-[#C2BEBC] truncate">
                    {[r.artist, r.title].filter(Boolean).join(" — ")}
                    {r.album && <span className="text-[#605A55]"> · {r.album}</span>}
                    {r.year && <span className="text-[#4C4743]"> ({r.year})</span>}
                  </p>
                )}
                {r.status === "no_match" && <p className="text-[10px] text-[#4C4743]">Não identificado</p>}
                {r.status === "error"    && <p className="text-[10px] text-[#D95340]">Erro ao processar</p>}
              </div>
              {r.status === "matched" && !applyAll.has(r.track.id) && (
                <button onClick={() => applyResult(r)}
                  className="shrink-0 px-2.5 py-1 text-[10px] font-semibold rounded-lg bg-[#5BA055]/20 text-[#5BA055] hover:bg-[#5BA055]/30 transition-colors">
                  Aplicar
                </button>
              )}
              {applyAll.has(r.track.id) && (
                <span className="shrink-0 text-[10px] text-[#5BA055]">✓ Aplicado</span>
              )}
            </div>
          ))}
        </div>

        {/* Stats */}
        {running === false && matched + noMatch + errors > 0 && (
          <div className="px-5 py-2 border-t border-white/[0.05] flex items-center gap-4 text-[10px]">
            {matched > 0  && <span className="text-[#5BA055]">✓ {matched} identificad{matched !== 1 ? "as" : "a"}</span>}
            {noMatch > 0  && <span className="text-[#605A55]">– {noMatch} sem resultado</span>}
            {errors > 0   && <span className="text-[#D95340]">! {errors} erro{errors !== 1 ? "s" : ""}</span>}
          </div>
        )}

        {/* Footer */}
        <div className="px-5 py-3.5 border-t border-white/[0.06] flex items-center justify-between">
          <button onClick={onClose} className="px-4 py-1.5 text-[12px] text-[#756D67] hover:text-[#C2BEBC] transition-colors rounded-lg hover:bg-white/[0.04]">
            Fechar
          </button>
          <div className="flex items-center gap-2">
            {matched > 1 && !running && (
              <button onClick={applyAllMatched}
                className="px-3 py-1.5 text-[11px] font-medium rounded-lg text-[#5BA055] transition-colors"
                style={{ background: "rgba(91,160,85,0.10)", border: "1px solid rgba(91,160,85,0.20)" }}>
                Aplicar todos ({matched})
              </button>
            )}
            <button onClick={runFingerprint} disabled={running}
              className="px-4 py-1.5 text-[12px] font-semibold bg-[#D95340] hover:bg-[#E07364] text-white rounded-lg transition-colors disabled:opacity-50">
              {running ? "Identificando…" : results.some((r) => r.status === "pending") ? "Identificar faixas" : "Reiniciar"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
