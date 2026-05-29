import { useEffect, useState } from "react";

export function useIsOnline() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on  = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online",  on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online",  on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return online;
}

export default function OfflineBanner({ onClose }: { onClose?: () => void }) {
  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center pointer-events-none">
      {/* Fundo semi-transparente */}
      <div className="absolute inset-0 bg-black/40 pointer-events-auto" onClick={onClose} />
      <div
        className="relative pointer-events-auto flex flex-col items-center gap-4 px-8 py-7 rounded-2xl shadow-2xl border max-w-sm text-center"
        style={{
          background: "rgba(14,13,12,0.97)",
          borderColor: "rgba(217,83,64,0.20)",
          backdropFilter: "blur(16px)",
        }}
      >
        {/* Botão fechar */}
        {onClose && (
          <button
            onClick={onClose}
            className="absolute top-3 right-3 w-6 h-6 flex items-center justify-center text-[#605A55] hover:text-[#8F8883] transition-colors"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <line x1="1" y1="1" x2="9" y2="9"/><line x1="9" y1="1" x2="1" y2="9"/>
            </svg>
          </button>
        )}

        <div
          className="w-14 h-14 rounded-full flex items-center justify-center"
          style={{ background: "rgba(217,83,64,0.08)", border: "1px solid rgba(217,83,64,0.15)" }}
        >
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#D95340" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <line x1="1" y1="1" x2="23" y2="23"/>
            <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"/>
            <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"/>
            <path d="M10.71 5.05A16 16 0 0 1 22.56 9"/>
            <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"/>
            <path d="M8.53 16.11a6 6 0 0 1 6.95 0"/>
            <line x1="12" y1="20" x2="12.01" y2="20"/>
          </svg>
        </div>

        <div>
          <p className="text-[16px] font-bold text-[#F5F5F4] mb-2">Sem conexão com a internet</p>
          <p className="text-[12px] text-[#8F8883] leading-relaxed">
            Os serviços de enriquecimento (iTunes e Spotify) precisam de conexão ativa para buscar metadados. Verifique sua rede e tente novamente.
          </p>
        </div>

        {onClose && (
          <button
            onClick={onClose}
            className="mt-1 px-5 py-2 rounded-lg text-[12px] font-semibold text-[#C2BEBC] hover:text-white transition-colors"
            style={{ background: "var(--icon-bg)", border: "1px solid var(--field-border)" }}
          >
            Entendi
          </button>
        )}
      </div>
    </div>
  );
}
