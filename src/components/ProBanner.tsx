import { useState, useEffect } from "react";
import { useAppStore } from "../store";
import { ProUpgradeModal } from "./ProGate";

export default function ProBanner() {
  // Lê os campos diretos em vez de chamar isPro() para evitar instabilidade de referência
  const proValidated = useAppStore((s) => s.proValidated);
  const proLicenseKey = useAppStore((s) => s.proLicenseKey);
  const userIsPro = !!(proValidated && proLicenseKey);

  const [visible, setVisible] = useState(false);
  const [showModal, setShowModal] = useState(false);

  useEffect(() => {
    if (userIsPro) return;
    // Limpa flag de sessão antiga para garantir que aparece em novas sessões
    const shown = sessionStorage.getItem("tw_pro_banner_shown");
    if (!shown) {
      setVisible(true);
      sessionStorage.setItem("tw_pro_banner_shown", "1");
      const t = setTimeout(() => setVisible(false), 8000);
      return () => clearTimeout(t);
    }
  }, [userIsPro]);

  if (!visible || userIsPro) return null;

  return (
    <>
      <div
        className="w-full flex items-center justify-between px-4 py-1.5 relative overflow-hidden shrink-0"
        style={{
          background: "linear-gradient(90deg, rgba(217,83,64,0.15) 0%, rgba(217,83,64,0.08) 50%, rgba(217,83,64,0.15) 100%)",
          borderBottom: "1px solid rgba(217,83,64,0.18)",
        }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <svg width="11" height="11" viewBox="0 0 12 12" fill="#D95340" className="shrink-0">
            <polygon points="6 1 7.55 4.13 11 4.64 8.5 7.07 9.09 10.5 6 8.88 2.91 10.5 3.5 7.07 1 4.64 4.45 4.13 6 1"/>
          </svg>
          <span className="text-[11px] font-bold text-[#D95340] shrink-0">TagWave Pro</span>
          <span className="text-[11px] text-[#8F8883] truncate">Identifique faixas sem tag, extraia metadados do nome do arquivo e edite tags avançadas.</span>
        </div>

        <div className="flex items-center gap-2 shrink-0 ml-3">
          <button
            onClick={() => { setVisible(false); setShowModal(true); }}
            className="text-[10px] font-bold px-2.5 py-1 rounded-md bg-[#D95340] text-white hover:bg-[#E07364] transition-colors whitespace-nowrap"
          >
            Ver planos
          </button>
          <button
            onClick={() => setVisible(false)}
            className="text-[#605A55] hover:text-[#C2BEBC] transition-colors p-1 rounded"
          >
            <svg width="9" height="9" viewBox="0 0 9 9" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <line x1="1" y1="1" x2="8" y2="8"/><line x1="8" y1="1" x2="1" y2="8"/>
            </svg>
          </button>
        </div>
      </div>

      {showModal && (
        <ProUpgradeModal
          onClose={() => setShowModal(false)}
          feature="TagWave Pro"
          description="Desbloqueie identificação automática de faixas, extração de metadados por nome de arquivo e editor completo de tags avançadas."
        />
      )}
    </>
  );
}
