import { useMemo } from "react";
import { useAppStore } from "../store";

function pct(n: number, total: number): number {
  return total === 0 ? 0 : Math.round((n / total) * 100);
}

function Bar({ value }: { value: number }) {
  return (
    <div className="h-1 rounded-full bg-white/[0.06] overflow-hidden mt-1">
      <div
        className="h-full rounded-full bg-[#D95340]/60 transition-all duration-300"
        style={{ width: `${value}%` }}
      />
    </div>
  );
}

export default function LibraryStats({ onClose, embedded }: { onClose?: () => void; embedded?: boolean }) {
  const { tracks, genreFilter, setGenreFilter } = useAppStore();

  const stats = useMemo(() => {
    const total = tracks.length;
    if (total === 0) return null;
    const withBpm    = tracks.filter((t) => t.bpm).length;
    const withKey    = tracks.filter((t) => t.key).length;
    const withGenre  = tracks.filter((t) => t.genre).length;
    const withCover  = tracks.filter((t) => t.has_cover).length;
    const withRating = tracks.filter((t) => t.rating && t.rating > 0).length;
    const issues     = tracks.filter((t) => t.issues.length > 0).length;

    const genreMap: Record<string, number> = {};
    for (const t of tracks) {
      if (t.genre) genreMap[t.genre] = (genreMap[t.genre] ?? 0) + 1;
    }
    const topGenres = Object.entries(genreMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    const totalSizeGB = tracks.reduce((s, t) => s + t.file_size_bytes, 0) / 1e9;
    const totalDurationH = tracks.reduce((s, t) => s + (t.duration_secs ?? 0), 0) / 3600;

    return {
      total, withBpm, withKey, withGenre, withCover, withRating, issues,
      topGenres, totalSizeGB, totalDurationH,
      pctBpm: pct(withBpm, total), pctKey: pct(withKey, total),
      pctGenre: pct(withGenre, total), pctCover: pct(withCover, total),
      pctRating: pct(withRating, total),
    };
  }, [tracks]);

  if (!stats) {
    return (
      <div className={embedded ? "flex-1 flex items-center justify-center" : "w-64 shrink-0 flex flex-col border-l border-white/[0.05] bg-[#0E0D0C] items-center justify-center"}>
        <span className="text-[#605A55] text-[11px]">Nenhuma faixa carregada</span>
      </div>
    );
  }

  return (
    <div className={embedded ? "flex-1 overflow-y-auto no-scrollbar" : "w-64 shrink-0 flex flex-col border-l border-white/[0.05] bg-[#0E0D0C] overflow-y-auto"}>
      {!embedded && (
        <div className="px-4 pt-4 pb-3 border-b border-white/[0.05]">
          <div className="flex items-center justify-between mb-1">
            <p className="text-[9px] font-bold text-[#8F8883] uppercase tracking-[0.25em]">Biblioteca</p>
            {onClose && (
              <button
                onClick={onClose}
                title="Fechar"
                className="w-4 h-4 flex items-center justify-center text-[#605A55] hover:text-[#8F8883] transition-colors"
              >
                <svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                  <line x1="1" y1="1" x2="7" y2="7"/>
                  <line x1="7" y1="1" x2="1" y2="7"/>
                </svg>
              </button>
            )}
          </div>
          <p className="text-[13px] font-semibold text-[#F5F5F4]">{stats.total.toLocaleString("pt-BR")} faixas</p>
          <p className="text-[11px] text-[#8F8883] mt-0.5">
            {stats.totalSizeGB.toFixed(1)} GB · {Math.floor(stats.totalDurationH)}h {Math.round((stats.totalDurationH % 1) * 60)}min
          </p>
        </div>
      )}

      {/* Resumo compacto quando embedded */}
      {embedded && (
        <div className="px-4 pt-3 pb-2 border-b border-white/[0.05]">
          <p className="text-[13px] font-semibold text-[#F5F5F4]">{stats.total.toLocaleString("pt-BR")} faixas</p>
          <p className="text-[11px] text-[#8F8883] mt-0.5">
            {stats.totalSizeGB.toFixed(1)} GB · {Math.floor(stats.totalDurationH)}h {Math.round((stats.totalDurationH % 1) * 60)}min
          </p>
        </div>
      )}

      <div className="px-4 py-3 border-b border-white/[0.05] space-y-2.5">
        <p className="text-[9px] font-bold text-[#8F8883] uppercase tracking-[0.25em] mb-2">Cobertura de Metadados</p>

        {[
          { label: "BPM", pct: stats.pctBpm, n: stats.withBpm },
          { label: "Tom", pct: stats.pctKey, n: stats.withKey },
          { label: "Gênero", pct: stats.pctGenre, n: stats.withGenre },
          { label: "Capa", pct: stats.pctCover, n: stats.withCover },
          { label: "Rating", pct: stats.pctRating, n: stats.withRating },
        ].map(({ label, pct: p, n }) => (
          <div key={label}>
            <div className="flex justify-between items-baseline">
              <span className="text-[11px] text-[#8F8883]">{label}</span>
              <span className="text-[11px] font-mono text-[#8F8883]">{n}/{stats.total} <span className="text-[#D95340]/60">{p}%</span></span>
            </div>
            <Bar value={p} />
          </div>
        ))}
      </div>

      {stats.issues > 0 && (
        <div className="px-4 py-2 border-b border-white/[0.05]">
          <div className="flex items-center gap-1.5 py-1.5 px-2 rounded-md bg-[#D95340]/8 border border-[#D95340]/15">
            <span className="w-1.5 h-1.5 rounded-full bg-[#D95340] shrink-0" />
            <span className="text-[11px] text-[#D95340]/80">{stats.issues} faixa{stats.issues !== 1 ? "s" : ""} com problemas</span>
          </div>
        </div>
      )}

      {stats.topGenres.length > 0 && (
        <div className="px-4 py-3">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[9px] font-bold text-[#8F8883] uppercase tracking-[0.25em]">Top Gêneros</p>
            {genreFilter && (
              <button
                onClick={() => setGenreFilter(null)}
                className="text-[9px] text-[#D95340]/60 hover:text-[#D95340] transition-colors"
              >
                × limpar
              </button>
            )}
          </div>
          <div className="space-y-0.5">
            {stats.topGenres.map(([genre, count]) => {
              const active = genreFilter === genre;
              return (
                <button
                  key={genre}
                  onClick={() => setGenreFilter(active ? null : genre)}
                  className={`w-full flex justify-between items-center px-2 py-1 rounded-md transition-colors text-left ${
                    active
                      ? "bg-[#D95340]/15 border border-[#D95340]/25"
                      : "hover:bg-white/[0.04]"
                  }`}
                >
                  <span className={`text-[11px] truncate ${active ? "text-[#D95340]" : "text-[#8F8883]"}`}>{genre}</span>
                  <span className="text-[10px] font-mono text-[#8F8883] shrink-0 ml-2">{count}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
