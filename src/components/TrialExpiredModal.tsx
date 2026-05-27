import { useState } from "react";
import { useAppStore } from "../store";
import { activateLicenseKey, LS_PRODUCT_URL } from "../services/LicenseService";

export default function TrialExpiredModal() {
  const {
    isTrialExpired,
    tracksAnalyzed,
    tagsEnriched,
    estimatedTimeSaved,
    extendForBeta,
    activateLicense,
  } = useAppStore();

  const [showField, setShowField] = useState(false);
  const [keyInput, setKeyInput]   = useState("");
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState("");
  const [success, setSuccess]     = useState(false);

  if (!isTrialExpired()) return null;

  async function handleActivate() {
    if (keyInput.trim().length < 10) return;
    setLoading(true);
    setError("");
    try {
      const result = await activateLicenseKey(keyInput.trim());
      if (result.valid) {
        activateLicense(result.instance_id || keyInput.trim(), result.email);
        setSuccess(true);
      } else {
        setError(result.error ?? "Chave inválida");
      }
    } catch (e: unknown) {
      setError(typeof e === "string" ? e : "Erro ao validar chave");
    } finally {
      setLoading(false);
    }
  }

  function handleBuy() {
    if (!LS_PRODUCT_URL) return;
    import("@tauri-apps/plugin-opener").then(({ openUrl }) => openUrl(LS_PRODUCT_URL));
  }

  return (
    <div className="fixed inset-0 bg-black/75 flex items-center justify-center z-50">
      <div className="bg-[#23201E] rounded-2xl max-w-[480px] w-full mx-4 border border-white/[0.07] shadow-2xl overflow-hidden">

        <div className="h-px bg-[#D95340]/60" />

        <div className="px-10 py-9 flex flex-col items-center gap-6">

          <img src="/tagwave-logo.png" alt="TagWave" className="h-8 opacity-80" />

          <div className="text-center">
            <h2 className="text-xl font-bold text-[#F5F5F4] mb-1.5">Sua avaliação encerrou</h2>
            <p className="text-[13px] text-[#4C4743]">Você aproveitou os 14 dias do TagWave.</p>
          </div>

          {/* Métricas de uso */}
          <div className="flex items-center gap-8 px-4 py-3 rounded-lg bg-white/[0.02] border border-white/[0.04] w-full justify-center">
            <StatBlock value={String(tracksAnalyzed)} label={"faixas\norganizadas"} />
            <div className="w-px h-8 bg-white/[0.06]" />
            <StatBlock value={String(tagsEnriched)} label={"tags\nenriquecidas"} />
            <div className="w-px h-8 bg-white/[0.06]" />
            <StatBlock value={estimatedTimeSaved()} label={"tempo\neconomizado"} />
          </div>

          {/* Botão comprar */}
          <div className="flex flex-col items-center gap-1.5 w-full">
            {LS_PRODUCT_URL ? (
              <button
                onClick={handleBuy}
                className="w-full py-2.5 rounded-lg bg-[#D95340] hover:bg-[#E07364] text-white font-semibold text-[13px] uppercase tracking-wide transition-colors"
              >
                Continuar por $39
              </button>
            ) : (
              <>
                <button
                  disabled
                  className="w-full py-2.5 rounded-lg bg-[#D95340]/30 text-[#D95340]/40 font-semibold text-[13px] cursor-not-allowed uppercase tracking-wide"
                >
                  Continuar por $39
                </button>
                <p className="text-[11px] text-[#373331] text-center">
                  Sistema de pagamento em preparação — lançamento em breve
                </p>
              </>
            )}
          </div>

          <div className="w-full border-t border-white/[0.05]" />

          {/* Campo de licença */}
          {success ? (
            <p className="text-[13px] text-[#D95340] font-medium">Licença ativada com sucesso!</p>
          ) : showField ? (
            <div className="flex flex-col gap-2 w-full">
              <div className="flex gap-2">
                <input
                  className="flex-1 px-3 py-2 rounded-lg bg-white/[0.04] border border-white/[0.08] text-[13px] font-mono text-[#C2BEBC] placeholder-[#373331] focus:outline-none focus:border-[#D95340]/50 transition-colors disabled:opacity-50"
                  placeholder="TAGW-XXXX-XXXX-XXXX"
                  value={keyInput}
                  disabled={loading}
                  onChange={(e) => { setKeyInput(e.target.value); setError(""); }}
                  onKeyDown={(e) => e.key === "Enter" && handleActivate()}
                />
                <button
                  onClick={handleActivate}
                  disabled={keyInput.trim().length < 10 || loading}
                  className="px-4 py-2 rounded-lg bg-[#D95340] hover:bg-[#E07364] disabled:opacity-40 text-white text-[13px] font-semibold transition-colors min-w-[72px]"
                >
                  {loading ? (
                    <span className="flex items-center justify-center gap-1.5">
                      <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none">
                        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="40" strokeDashoffset="10" strokeLinecap="round"/>
                      </svg>
                    </span>
                  ) : "Ativar"}
                </button>
              </div>
              {error && (
                <p className="text-[11px] text-[#D95340] px-1">{error}</p>
              )}
            </div>
          ) : (
            <button
              onClick={() => setShowField(true)}
              className="text-[13px] text-[#4C4743] hover:text-[#756D67] transition-colors"
            >
              Já tenho uma licença
            </button>
          )}

          {import.meta.env.DEV && (
            <button
              onClick={extendForBeta}
              className="text-[11px] text-[#23201E] hover:text-[#373331] transition-colors"
            >
              Continuar em modo beta
            </button>
          )}
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
