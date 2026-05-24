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
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
      <div className="w-[400px] bg-[#23201E] rounded-xl border border-white/[0.07] shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-white/[0.05]">
          <div className="w-9 h-9 rounded-full flex items-center justify-center text-base text-white shrink-0 bg-[#D95340]/20 border border-[#D95340]/30">
            ✦
          </div>
          <div>
            <p className="text-sm font-bold text-[#F5F5F4]">Metadados Incompletos</p>
            <p className="text-xs text-[#756D67]">{totalTracks} faixas carregadas</p>
          </div>
        </div>

        {/* Body */}
        <div className="px-5 py-4">
          <p className="text-[13px] text-[#756D67] mb-4 leading-relaxed">
            Foram identificados campos sem informação nos metadados. Deseja que eu busque e preencha automaticamente?
          </p>
          <div className="flex flex-col gap-2.5 p-3 rounded-lg bg-white/[0.02] border border-white/[0.04]">
            {missingGenre > 0 && (
              <MetaRow label="Gênero" count={missingGenre} total={totalTracks} opacity={1} />
            )}
            {missingYear > 0 && (
              <MetaRow label="Ano" count={missingYear} total={totalTracks} opacity={0.7} />
            )}
            {missingAlbum > 0 && (
              <MetaRow label="Álbum" count={missingAlbum} total={totalTracks} opacity={0.5} />
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2 px-5 pb-5">
          <button
            onClick={onDismiss}
            className="flex-1 py-2 rounded-lg border border-white/[0.08] text-[13px] text-[#605A55] hover:text-[#756D67] hover:bg-white/[0.03] transition-colors"
          >
            Deixar para depois
          </button>
          <button
            onClick={onEnrich}
            className="flex-1 py-2 rounded-lg text-[13px] font-semibold text-white bg-[#D95340] hover:bg-[#E07364] active:bg-[#B34435] transition-colors"
          >
            ✦ Enriquecer agora
          </button>
        </div>
      </div>
    </div>
  );
}

function MetaRow({
  label, count, total, opacity,
}: {
  label: string;
  count: number;
  total: number;
  opacity: number;
}) {
  const pct = Math.round((count / total) * 100);
  return (
    <div className="flex items-center gap-2">
      <span
        className="w-1.5 h-1.5 rounded-full shrink-0"
        style={{ backgroundColor: `rgba(220,85,71,${opacity})` }}
      />
      <span className="text-[11px] text-[#A8A3A0] w-12 shrink-0">{label}</span>
      <div className="flex-1 h-0.5 bg-white/[0.06] rounded-full overflow-hidden">
        <div
          className="h-full rounded-full"
          style={{ width: `${pct}%`, backgroundColor: `rgba(220,85,71,${opacity})` }}
        />
      </div>
      <span className="text-[10px] text-right shrink-0 font-mono tabular-nums whitespace-nowrap">
        <span className="text-[#D95340] font-bold">{count}</span>
        <span className="text-[#8F8883]"> de {total}</span>
      </span>
    </div>
  );
}
