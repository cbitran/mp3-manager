import { useState } from "react";
import { useAppStore } from "../store";

export default function TrialExpiredModal() {
  const {
    isTrialExpired,
    tracksAnalyzed,
    tagsEnriched,
    estimatedTimeSaved,
    extendForBeta,
    activateLicense,
  } = useAppStore();

  const [showLicenseField, setShowLicenseField] = useState(false);
  const [licenseInput, setLicenseInput]         = useState("");

  if (!isTrialExpired()) return null;

  return (
    <div className="fixed inset-0 bg-black/75 flex items-center justify-center z-50">
      <div className="bg-[#23201E] rounded-2xl max-w-[480px] w-full mx-4 border border-white/[0.07] shadow-2xl overflow-hidden">

        {/* Top accent bar */}
        <div className="h-px bg-[#D95340]/60" />

        <div className="px-10 py-9 flex flex-col items-center gap-6">

          {/* Logo */}
          <img src="/tagwave-logo.png" alt="TagWave" className="h-8 opacity-80" />

          {/* Título */}
          <div className="text-center">
            <h2 className="text-xl font-bold text-[#F5F5F4] mb-1.5">Sua avaliação encerrou</h2>
            <p className="text-[13px] text-[#4C4743]">Você aproveitou os 14 dias do TagWave.</p>
          </div>

          {/* Métricas */}
          <div className="flex items-center gap-8 px-4 py-3 rounded-lg bg-white/[0.02] border border-white/[0.04] w-full justify-center">
            <StatBlock value={String(tracksAnalyzed)} label={"faixas\norganizadas"} />
            <div className="w-px h-8 bg-white/[0.06]" />
            <StatBlock value={String(tagsEnriched)} label={"tags\nenriquecidas"} />
            <div className="w-px h-8 bg-white/[0.06]" />
            <StatBlock value={estimatedTimeSaved()} label={"tempo\neconomizado"} />
          </div>

          {/* CTA */}
          <div className="flex flex-col items-center gap-1.5 w-full">
            <button
              disabled
              className="w-full py-2.5 rounded-lg bg-[#D95340]/30 text-[#D95340]/40 font-semibold text-[13px] cursor-not-allowed uppercase tracking-wide"
            >
              Continuar por $39
            </button>
            <p className="text-[11px] text-[#373331] text-center">
              Sistema de pagamento em preparação — lançamento em breve
            </p>
          </div>

          <div className="w-full border-t border-white/[0.05]" />

          {/* Licença */}
          {showLicenseField ? (
            <div className="flex gap-2 w-full">
              <input
                className="flex-1 px-3 py-2 rounded-lg bg-white/[0.04] border border-white/[0.08] text-[13px] font-mono text-[#C2BEBC] placeholder-[#373331] focus:outline-none focus:border-[#D95340]/50 transition-colors"
                placeholder="TAGW-XXXX-XXXX-XXXX"
                value={licenseInput}
                onChange={(e) => setLicenseInput(e.target.value)}
              />
              <button
                onClick={() => activateLicense(licenseInput)}
                disabled={licenseInput.length < 18}
                className="px-4 py-2 rounded-lg bg-[#D95340] hover:bg-[#E07364] disabled:opacity-40 text-white text-[13px] font-semibold transition-colors"
              >
                Ativar
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowLicenseField(true)}
              className="text-[13px] text-[#4C4743] hover:text-[#756D67] transition-colors"
            >
              Já tenho uma licença
            </button>
          )}

          <button
            onClick={extendForBeta}
            className="text-[11px] text-[#23201E] hover:text-[#373331] transition-colors"
          >
            Continuar em modo beta
          </button>
        </div>
      </div>
    </div>
  );
}

function StatBlock({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <span className="text-lg font-bold text-[#F5F5F4] tabular-nums">{value}</span>
      <span className="text-[10px] text-[#4C4743] text-center whitespace-pre-line uppercase tracking-wide leading-tight">{label}</span>
    </div>
  );
}
