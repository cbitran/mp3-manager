interface Props {
  totalTracks: number;
  missingGenre: number;
  missingYear: number;
  missingAlbum: number;
  onEnrich: () => void;
  onDismiss: () => void;
}

export default function MissingMetaPrompt({
  totalTracks, missingGenre, missingYear, missingAlbum, onEnrich, onDismiss,
}: Props) {
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="w-[400px] bg-[#1f1f26] rounded-xl border border-white/10 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-white/[0.06]">
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center text-lg text-white shrink-0"
            style={{ background: "linear-gradient(135deg, #1e9e66, #2e6bd4)" }}
          >
            ✦
          </div>
          <div>
            <p className="text-sm font-bold text-white">Metadados Incompletos</p>
            <p className="text-xs text-gray-500">{totalTracks} faixas carregadas</p>
          </div>
        </div>

        {/* Body */}
        <div className="px-5 py-4">
          <p className="text-sm text-gray-300 mb-4">
            Foram identificados campos sem informação nos metadados. Deseja que eu busque e preencha
            automaticamente?
          </p>
          <div className="flex flex-col gap-2.5 p-3 rounded-lg bg-white/[0.03] border border-white/[0.05]">
            {missingGenre > 0 && (
              <MetaRow label="Gênero" count={missingGenre} total={totalTracks} color="#a855f7" />
            )}
            {missingYear > 0 && (
              <MetaRow label="Ano" count={missingYear} total={totalTracks} color="#f97316" />
            )}
            {missingAlbum > 0 && (
              <MetaRow label="Álbum" count={missingAlbum} total={totalTracks} color="#3b82f6" />
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2 px-5 pb-5">
          <button
            onClick={onDismiss}
            className="flex-1 py-2 rounded-lg border border-white/10 text-sm text-gray-400 hover:bg-white/5 transition-colors"
          >
            Deixar para depois
          </button>
          <button
            onClick={onEnrich}
            className="flex-1 py-2 rounded-lg text-sm font-semibold text-white transition-opacity hover:opacity-90"
            style={{ background: "linear-gradient(to right, #1e9e66, #2e6bd4)" }}
          >
            ✦ Enriquecer agora
          </button>
        </div>
      </div>
    </div>
  );
}

function MetaRow({
  label, count, total, color,
}: {
  label: string;
  count: number;
  total: number;
  color: string;
}) {
  const pct = Math.round((count / total) * 100);
  return (
    <div className="flex items-center gap-2">
      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
      <span className="text-xs text-gray-400 w-12 shrink-0">{label}</span>
      <div className="flex-1 h-1 bg-white/5 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
      <span className="text-[10px] text-gray-600 w-16 text-right shrink-0">
        {count} de {total}
      </span>
    </div>
  );
}
