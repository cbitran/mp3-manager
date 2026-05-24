interface Props {
  total: number;
  enriched: number;
  covers: number;
  folderName: string;
  onClose: () => void;
  onUndo?: () => void;
}

export default function EnrichResultModal({ total, enriched, covers, folderName, onClose, onUndo }: Props) {
  const notFound = total - enriched;
  const pct = total > 0 ? Math.round((enriched / total) * 100) : 0;

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
      <div className="w-[420px] bg-[#1c1715] rounded-xl border border-white/[0.07] shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-white/[0.05]">
          <div
            className="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
            style={{ background: enriched > 0 ? "rgba(91,160,85,0.15)" : "rgba(217,83,64,0.15)", border: `1px solid ${enriched > 0 ? "rgba(91,160,85,0.3)" : "rgba(217,83,64,0.3)"}` }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={enriched > 0 ? "#5BA055" : "#D95340"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              {enriched > 0
                ? <><polyline points="20 6 9 17 4 12"/></>
                : <><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></>
              }
            </svg>
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-[#F5F5F4]">Enriquecimento Concluído</p>
            <p className="text-[11px] text-[#756D67] truncate">{folderName}</p>
          </div>
        </div>

        {/* Stats */}
        <div className="px-5 py-4 flex flex-col gap-3">
          {/* Progress bar */}
          <div className="flex flex-col gap-1.5">
            <div className="flex justify-between items-center">
              <span className="text-[11px] text-[#8F8883]">Faixas processadas</span>
              <span className="text-[11px] font-mono text-[#C2BEBC]">{enriched} / {total}</span>
            </div>
            <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${pct}%`, background: enriched > 0 ? "#5BA055" : "#605A55" }}
              />
            </div>
          </div>

          {/* Grid de stats */}
          <div className="grid grid-cols-3 gap-2">
            <StatBox
              value={enriched}
              label="enriquecidas"
              color="#5BA055"
            />
            <StatBox
              value={covers}
              label="capas adicionadas"
              color="#C9A84C"
            />
            <StatBox
              value={notFound}
              label="sem dados"
              color={notFound > 0 ? "#D95340" : "#605A55"}
            />
          </div>

          {/* Nota informativa */}
          <p className="text-[11px] text-[#605A55] leading-relaxed">
            As tags foram gravadas diretamente nos arquivos de áudio no disco.{" "}
            {onUndo && <span>Você pode desfazer antes de fechar.</span>}
          </p>
        </div>

        {/* Actions */}
        <div className="flex gap-2 px-5 pb-5">
          {onUndo && (
            <button
              onClick={() => { onUndo(); onClose(); }}
              className="px-4 py-2 rounded-lg border border-white/[0.08] text-[13px] text-[#605A55] hover:text-[#C2BEBC] hover:bg-white/[0.03] transition-colors"
            >
              Desfazer
            </button>
          )}
          <button
            onClick={onClose}
            className="flex-1 py-2 rounded-lg text-[13px] font-semibold text-white transition-colors"
            style={{ background: "#D95340" }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "#E07364"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "#D95340"; }}
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}

function StatBox({ value, label, color }: { value: number; label: string; color: string }) {
  return (
    <div
      className="flex flex-col items-center gap-0.5 py-3 px-2 rounded-lg"
      style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)" }}
    >
      <span className="text-2xl font-bold tabular-nums leading-none" style={{ color }}>
        {value}
      </span>
      <span className="text-[9px] text-[#605A55] text-center leading-tight uppercase tracking-wide">
        {label}
      </span>
    </div>
  );
}
