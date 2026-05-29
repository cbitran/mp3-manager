import { useState, useEffect } from "react";
import { useAppStore } from "../store";
import { ProUpgradeModal } from "./ProGate";

export default function ProBanner() {
  const isPro = useAppStore((s) => s.isPro);
  const [visible, setVisible] = useState(false);
  const [showModal, setShowModal] = useState(false);

  useEffect(() => {
    if (isPro()) return;
    // Mostrar banner uma vez por sessão
    const shown = sessionStorage.getItem("tw_pro_banner_shown");
    if (!shown) {
      setVisible(true);
      sessionStorage.setItem("tw_pro_banner_shown", "1");
      // Auto-dismiss após 8s
      const t = setTimeout(() => setVisible(false), 8000);
      return () => clearTimeout(t);
    }
  }, []);

  if (!visible || isPro()) return null;

  return (
    <>
      <div
        className="w-full flex items-center justify-between px-4 py-1.5 relative overflow-hidden"
        style={{
          background: "linear-gradient(90deg, rgba(217,83,64,0.18) 0%, rgba(217,83,64,0.10) 50%, rgba(217,83,64,0.18) 100%)",
          borderBottom: "1px solid rgba(217,83,64,0.20)",
          animation: "banner-shimmer 3s ease-in-out infinite",
        }}
      >
        {/* Shimmer overlay */}
        <style>{`
          @keyframes banner-shimmer {
            0%, 100% { background: linear-gradient(90deg, rgba(217,83,64,0.18) 0%, rgba(217,83,64,0.08) 50%, rgba(217,83,64,0.18) 100%); }
            50%       { background: linear-gradient(90deg, rgba(217,83,64,0.10) 0%, rgba(217,83,64,0.20) 50%, rgba(217,83,64,0.10) 100%); }
          }
        `}</style>

        <div className="flex items-center gap-2">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="#D95340">
            <polygon points="6 1 7.55 4.13 11 4.64 8.5 7.07 9.09 10.5 6 8.88 2.91 10.5 3.5 7.07 1 4.64 4.45 4.13 6 1"/>
          </svg>
          <span className="text-[11px] font-semibold text-[#D95340]">TagWave Pro</span>
          <span className="text-[11px] text-[#C2BEBC]">— Identifique faixas sem tag, extraia metadados de nomes de arquivo e edite tags avançadas.</span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => { setVisible(false); setShowModal(true); }}
            className="text-[10px] font-bold px-2.5 py-1 rounded-md bg-[#D95340] text-white hover:bg-[#E07364] transition-colors"
          >
            Ver planos
          </button>
          <button
            onClick={() => setVisible(false)}
            className="text-[#605A55] hover:text-[#C2BEBC] transition-colors p-0.5"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <line x1="1" y1="1" x2="9" y2="9"/><line x1="9" y1="1" x2="1" y2="9"/>
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
