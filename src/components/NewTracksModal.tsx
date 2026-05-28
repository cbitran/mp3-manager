import { useState } from "react";
import type { Track } from "../store";

interface Props {
  tracks: Track[];
  onAddAndEnrich: (tracks: Track[]) => void;
  onAddOnly: (tracks: Track[]) => void;
  onDefer: () => void;
}

export default function NewTracksModal({ tracks, onAddAndEnrich, onAddOnly, onDefer }: Props) {
  const [expanded, setExpanded] = useState(false);

  // Agrupa por pasta para exibição
  const byFolder = tracks.reduce<Record<string, Track[]>>((acc, t) => {
    const parts = t.path.split(/[\\/]/);
    const folder = parts.slice(0, -1).join("/");
    (acc[folder] ??= []).push(t);
    return acc;
  }, {});

  const withMeta = tracks.filter((t) => t.title && t.artist).length;
  const withoutMeta = tracks.length - withMeta;
  const folderNames = Object.keys(byFolder);

  return (
    <div className="fixed inset-0 bg-black/75 flex items-center justify-center z-[250]">
      <div className="bg-[#19100F] rounded-2xl w-[460px] mx-4 border border-white/[0.08] shadow-2xl overflow-hidden">

        {/* Borda superior colorida */}
        <div className="h-px bg-[#D95340] opacity-60" />

        <div className="px-8 py-7 flex flex-col gap-5">

          {/* Header */}
          <div className="flex items-start gap-3">
            <div className="relative shrink-0 mt-0.5">
              <div className="w-2.5 h-2.5 rounded-full bg-[#D95340]" />
              <div className="absolute inset-0 rounded-full bg-[#D95340] animate-ping opacity-50" />
            </div>
            <div>
              <p className="text-[10px] font-bold text-[#605A55] uppercase tracking-widest mb-0.5">
                Novas faixas detectadas
              </p>
              <h2 className="text-[18px] font-bold text-[#F5F5F4] leading-tight">
                {tracks.length} {tracks.length === 1 ? "música nova" : "músicas novas"}
              </h2>
              {folderNames.length === 1 && (
                <p className="text-[11px] text-[#605A55] mt-0.5 font-mono">
                  {shortName(folderNames[0])}
                </p>
              )}
            </div>
          </div>

          {/* Resumo de metadados */}
          <div className="flex items-center gap-0 rounded-xl bg-white/[0.02] border border-white/[0.04] overflow-hidden">
            <MetaStat
              value={withMeta}
              label={withMeta === 1 ? "já tem metadados" : "já têm metadados"}
              ok
            />
            <div className="w-px self-stretch bg-white/[0.05]" />
            <MetaStat
              value={withoutMeta}
              label={withoutMeta === 1 ? "precisa enriquecer" : "precisam enriquecer"}
              ok={false}
            />
          </div>

          {/* Lista expansível de faixas */}
          <div>
            <button
              onClick={() => setExpanded((v) => !v)}
              className="flex items-center gap-1.5 text-[10px] text-[#605A55] hover:text-[#8F8883] transition-colors"
            >
              <svg
                width="8" height="8" viewBox="0 0 8 8" fill="currentColor"
                style={{ transform: expanded ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 0.15s" }}
              >
                <path d="M1 1l6 3-6 3V1z" />
              </svg>
              {expanded ? "Esconder lista" : "Ver todas as faixas"}
            </button>

            {expanded && (
              <div className="mt-2 max-h-48 overflow-y-auto flex flex-col gap-0.5 pr-1">
                {folderNames.map((folder) => (
                  <div key={folder}>
                    {folderNames.length > 1 && (
                      <p className="text-[9px] font-mono text-[#4C4743] uppercase tracking-widest mt-1.5 mb-0.5">
                        {shortName(folder)}
                      </p>
                    )}
                    {byFolder[folder].map((t) => (
                      <div
                        key={t.path}
                        className="flex items-center gap-2 py-1 px-2 rounded-lg hover:bg-white/[0.03] group"
                      >
                        <span
                          className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                            t.title && t.artist ? "bg-[#4CAF50]/60" : "bg-[#D95340]/40"
                          }`}
                        />
                        <span className="text-[11px] text-[#C2BEBC] truncate flex-1">
                          {t.title && t.artist
                            ? `${t.artist} — ${t.title}`
                            : t.filename}
                        </span>
                        {(!t.title || !t.artist) && (
                          <span className="text-[9px] text-[#4C4743] shrink-0">sem meta</span>
                        )}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Ações */}
          <div className="flex flex-col gap-2.5 pt-1 border-t border-white/[0.05]">
            {withoutMeta > 0 && (
              <button
                onClick={() => onAddAndEnrich(tracks)}
                className="w-full py-3 rounded-xl text-[13px] font-bold tracking-wide transition-all hover:scale-[1.02] active:scale-[0.98]"
                style={{
                  background: "#D95340",
                  color: "white",
                  boxShadow: "0 4px 20px rgba(217,83,64,0.35)",
                }}
              >
                Adicionar e enriquecer metadados
              </button>
            )}
            <button
              onClick={() => onAddOnly(tracks)}
              className={`w-full py-3 rounded-xl text-[13px] font-semibold transition-all hover:scale-[1.02] active:scale-[0.98] border ${
                withoutMeta === 0
                  ? "bg-[#D95340] text-white border-transparent hover:bg-[#E07364]"
                  : "bg-white/[0.04] text-[#C2BEBC] border-white/[0.08] hover:bg-white/[0.07]"
              }`}
              style={withoutMeta === 0 ? { boxShadow: "0 4px 20px rgba(217,83,64,0.35)" } : {}}
            >
              {withoutMeta === 0 ? "Adicionar à biblioteca" : "Só adicionar (sem enriquecer)"}
            </button>
          </div>

          {/* Rodapé */}
          <div className="flex items-center justify-between">
            <p className="text-[10px] text-[#4C4743] leading-relaxed max-w-[260px]">
              Se preferir, na próxima abertura do TagWave estas faixas serão integradas automaticamente.
            </p>
            <button
              onClick={onDefer}
              className="text-[11px] text-[#4C4743] hover:text-[#605A55] transition-colors shrink-0 ml-3"
            >
              Deixar para depois →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function MetaStat({ value, label, ok }: { value: number; label: string; ok: boolean }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-1 py-3 px-2 min-h-[56px]">
      <span
        className="text-lg font-bold tabular-nums"
        style={{ color: ok ? "#6DBF7E" : value === 0 ? "#4C4743" : "#D95340" }}
      >
        {value}
      </span>
      <span className="text-[9px] text-[#4C4743] text-center uppercase tracking-wide leading-tight">
        {label}
      </span>
    </div>
  );
}

function shortName(folderPath: string): string {
  const parts = folderPath.split(/[\\/]/);
  return parts.slice(-2).join("/");
}
