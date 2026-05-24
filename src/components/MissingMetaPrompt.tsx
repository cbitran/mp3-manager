interface Props {
  totalTracks: number;
  folderName?: string;
  missingGenre: number;
  missingYear: number;
  missingAlbum: number;
  bitrateHigh: number;
  bitrateMid: number;
  bitrateLow: number;
  onEnrich: () => void;
  onDismiss: () => void;
}

export default function MissingMetaPrompt({
  totalTracks, folderName, missingGenre, missingYear, missingAlbum,
  bitrateHigh, bitrateMid, bitrateLow, onEnrich, onDismiss,
}: Props) {
  const bitrateTotal = bitrateHigh + bitrateMid + bitrateLow;
  const hasMixedBitrate = bitrateTotal > 0 && (bitrateMid > 0 || bitrateLow > 0) && bitrateHigh > 0;

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
      <div className="w-[400px] bg-[#23201E] rounded-xl border border-white/[0.07] shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-white/[0.05]">
          <div className="w-9 h-9 rounded-full flex items-center justify-center text-base text-white shrink-0 bg-[#D95340]/20 border border-[#D95340]/30">
            ✦
          </div>
          <div className="min-w-0">
            <p className="text-sm font-bold text-[#F5F5F4]">Metadados Incompletos</p>
            <p className="text-xs text-[#756D67]">
              {totalTracks} faixas carregadas
              {folderName && (
                <span className="ml-1 text-[#605A55]">· <span className="font-mono">{folderName}</span></span>
              )}
            </p>
          </div>
        </div>

        {/* Body */}
        <div className="px-5 py-4 flex flex-col gap-3">
          <p className="text-[13px] text-[#756D67] leading-relaxed">
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

          {/* Distribuição de Bitrate */}
          {bitrateTotal > 0 && (
            <div className="p-3 rounded-lg bg-white/[0.02] border border-white/[0.04]">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-bold uppercase tracking-widest text-[#756D67]">
                  Qualidade de Áudio (kbps)
                </span>
                {hasMixedBitrate && (
                  <span className="text-[9px] text-[#C9A84C] font-semibold uppercase tracking-wide">
                    Bitrates mistos
                  </span>
                )}
              </div>
              {/* Barra segmentada */}
              <div className="flex h-1.5 rounded-full overflow-hidden gap-px mb-2.5">
                {bitrateHigh > 0 && (
                  <div
                    className="rounded-full"
                    style={{ flex: bitrateHigh, background: "#5BA055" }}
                  />
                )}
                {bitrateMid > 0 && (
                  <div
                    className="rounded-full"
                    style={{ flex: bitrateMid, background: "#C9A84C" }}
                  />
                )}
                {bitrateLow > 0 && (
                  <div
                    className="rounded-full"
                    style={{ flex: bitrateLow, background: "#D95340" }}
                  />
                )}
              </div>
              {/* Legenda */}
              <div className="flex items-center gap-3 flex-wrap">
                {bitrateHigh > 0 && (
                  <span className="flex items-center gap-1 text-[10px]">
                    <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: "#5BA055" }} />
                    <span style={{ color: "#5BA055" }} className="font-bold">{bitrateHigh}</span>
                    <span className="text-[#605A55]">≥ 320</span>
                  </span>
                )}
                {bitrateMid > 0 && (
                  <span className="flex items-center gap-1 text-[10px]">
                    <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: "#C9A84C" }} />
                    <span style={{ color: "#C9A84C" }} className="font-bold">{bitrateMid}</span>
                    <span className="text-[#605A55]">192–319</span>
                  </span>
                )}
                {bitrateLow > 0 && (
                  <span className="flex items-center gap-1 text-[10px]">
                    <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: "#D95340" }} />
                    <span style={{ color: "#D95340" }} className="font-bold">{bitrateLow}</span>
                    <span className="text-[#605A55]">{"< 192"}</span>
                  </span>
                )}
              </div>
              {hasMixedBitrate && (
                <p className="text-[10px] text-[#605A55] mt-2 leading-relaxed">
                  Faixas com bitrates diferentes podem precisar de nivelamento de volume.
                </p>
              )}
            </div>
          )}
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
