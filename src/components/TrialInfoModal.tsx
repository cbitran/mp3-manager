import { useState } from "react";
import { useAppStore } from "../store";
import { openUrl } from "@tauri-apps/plugin-opener";
import { LS_PRODUCT_URL } from "../services/LicenseService";

const PRO_URL = "https://tagwave.app/pro";

const TRIAL_DAYS = 14;

export default function TrialInfoModal({ onClose }: { onClose: () => void }) {
  const {
    trialStartDate,
    tracksAnalyzed,
    tagsEnriched,
    estimatedTimeSaved,
    daysRemaining,
    activateLicense,
    extendForBeta,
  } = useAppStore();

  const [showLicense, setShowLicense] = useState(false);
  const [licenseInput, setLicenseInput] = useState("");

  const days = daysRemaining();
  const daysUsed = TRIAL_DAYS - days;
  const progressPct = Math.min(100, (daysUsed / TRIAL_DAYS) * 100);

  const expiresAt = new Date(trialStartDate.getTime() + TRIAL_DAYS * 86_400_000);
  const fmtDate = (d: Date) =>
    d.toLocaleDateString(navigator.language, { day: "2-digit", month: "short", year: "numeric" });

  const urgencyColor = days <= 3 ? "#D95340" : days <= 7 ? "#E07364" : "#D95340";

  return (
    <div
      className="fixed inset-0 bg-black/70 flex items-center justify-center z-[200]"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-[#23201E] rounded-2xl w-[420px] mx-4 border border-white/[0.07] shadow-2xl overflow-hidden">

        {/* Accent line */}
        <div className="h-px" style={{ background: urgencyColor, opacity: 0.7 }} />

        <div className="px-8 py-7 flex flex-col gap-5">

          {/* Header */}
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[10px] font-bold text-[#605A55] uppercase tracking-widest mb-0.5">
                Avaliação Gratuita
              </p>
              <div className="flex items-baseline gap-1.5">
                <span className="text-3xl font-bold tabular-nums" style={{ color: urgencyColor }}>
                  {days}
                </span>
                <span className="text-sm font-medium text-[#8F8883]">
                  dia{days === 1 ? "" : "s"} restante{days === 1 ? "" : "s"}
                </span>
              </div>
            </div>
            <button
              onClick={onClose}
              className="w-7 h-7 flex items-center justify-center rounded-md text-[#4C4743] hover:text-[#8F8883] hover:bg-white/[0.06] transition-colors"
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <line x1="1" y1="1" x2="9" y2="9"/><line x1="9" y1="1" x2="1" y2="9"/>
              </svg>
            </button>
          </div>

          {/* Progress bar */}
          <div>
            <div className="w-full h-1 rounded-full bg-white/[0.06] overflow-hidden">
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${progressPct}%`, background: urgencyColor, opacity: 0.7 }}
              />
            </div>
            <div className="flex justify-between mt-1">
              <span className="text-[9px] font-mono text-[#4C4743]">Início: {fmtDate(trialStartDate)}</span>
              <span className="text-[9px] font-mono text-[#4C4743]">Expira: {fmtDate(expiresAt)}</span>
            </div>
          </div>

          {/* Metrics */}
          <div className="flex items-center gap-0 rounded-xl bg-white/[0.02] border border-white/[0.04] overflow-hidden">
            <Stat value={String(tracksAnalyzed)} label={"faixas\norganizadas"} />
            <div className="w-px self-stretch bg-white/[0.05]" />
            <Stat value={String(tagsEnriched)} label={"tags\nenriquecidas"} />
            <div className="w-px self-stretch bg-white/[0.05]" />
            <Stat value={estimatedTimeSaved()} label={"tempo\neconomizado"} />
          </div>

          {/* Info note */}
          <p className="text-[11px] text-[#4C4743] text-center leading-relaxed">
            Após o período de avaliação, você precisará de uma licença para continuar usando o TagWave.
          </p>

          {/* License input or CTA */}
          {showLicense ? (
            <div className="flex flex-col gap-3">
              <p className="text-[11px] text-[#8F8883] text-center">Insira sua chave de licença TagWave:</p>
              <div className="flex gap-2">
                <input
                  autoFocus
                  className="flex-1 px-3 py-2 rounded-lg bg-white/[0.04] border border-white/[0.08] text-[12px] font-mono text-[#C2BEBC] placeholder-[#373331] focus:outline-none focus:border-[#D95340]/50 transition-colors"
                  placeholder="TAGW-XXXX-XXXX-XXXX"
                  value={licenseInput}
                  onChange={(e) => setLicenseInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && licenseInput.length >= 8) { activateLicense(licenseInput); onClose(); } }}
                />
                <button
                  onClick={() => { activateLicense(licenseInput); onClose(); }}
                  disabled={licenseInput.length < 8}
                  className="px-4 py-2 rounded-lg bg-[#D95340] hover:bg-[#E07364] disabled:opacity-40 text-white text-[12px] font-semibold transition-colors"
                >
                  Ativar
                </button>
              </div>
              <button
                onClick={() => setShowLicense(false)}
                className="text-[10px] text-[#4C4743] hover:text-[#756D67] transition-colors text-center"
              >
                Voltar
              </button>
            </div>
          ) : (
            <>
              {/* Planos */}
              <div className="flex gap-2">
                {/* Standard */}
                <button
                  onClick={() => LS_PRODUCT_URL ? openUrl(LS_PRODUCT_URL).catch(() => {}) : setShowLicense(true)}
                  className="flex-1 flex flex-col items-start gap-0.5 p-3 rounded-xl border transition-all text-left hover:border-white/[0.15]"
                  style={{ background: "rgba(255,255,255,0.03)", borderColor: "rgba(255,255,255,0.07)" }}
                >
                  <span className="text-[9px] font-bold uppercase tracking-widest text-[#4C4743]">Standard</span>
                  <span className="text-[22px] font-bold text-[#F5F5F4] leading-tight">$39</span>
                  <span className="text-[9px] text-[#4C4743]">pagamento único</span>
                  <span className="text-[9px] text-[#605A55] leading-relaxed mt-1">Gestão de tags, playlists, exportação DJ</span>
                </button>

                {/* Pro */}
                <button
                  onClick={() => openUrl(PRO_URL).catch(() => {})}
                  className="flex-1 flex flex-col items-start gap-0.5 p-3 rounded-xl border transition-all text-left hover:border-[#D95340]/60"
                  style={{ background: "rgba(217,83,64,0.07)", borderColor: "rgba(217,83,64,0.28)" }}
                >
                  <div className="flex items-center gap-1.5">
                    <span className="text-[9px] font-bold uppercase tracking-widest text-[#D95340]">Pro</span>
                    <span className="text-[8px] bg-[#D95340] text-white px-1 py-px rounded-sm font-bold leading-tight">MAIS</span>
                  </div>
                  <span className="text-[22px] font-bold text-[#F5F5F4] leading-tight">$69</span>
                  <span className="text-[9px] text-[#4C4743]">pagamento único</span>
                  <span className="text-[9px] text-[#D95340]/70 leading-relaxed mt-1">+ AcoustID, Tags Avançadas, Filename→Tag</span>
                </button>
              </div>

              <div className="border-t border-white/[0.05]" />

              <div className="flex items-center justify-between">
                <button
                  onClick={() => setShowLicense(true)}
                  className="text-[11px] font-semibold transition-colors"
                  style={{ color: urgencyColor }}
                >
                  Já tenho uma chave →
                </button>
                <button
                  onClick={() => { extendForBeta(); onClose(); }}
                  className="text-[11px] text-[#4C4743] hover:text-[#605A55] transition-colors"
                >
                  Continuar em modo beta
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-1 py-3 px-2 min-h-[64px]">
      <span className="text-base font-bold text-[#F5F5F4] tabular-nums text-center leading-tight">{value}</span>
      <span className="text-[9px] text-[#4C4743] text-center whitespace-pre-line uppercase tracking-wide leading-tight">
        {label}
      </span>
    </div>
  );
}
