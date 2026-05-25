import i18n from "../i18n";

const ONBOARDING_KEY = "tagwave_onboarding_v1";

interface Props {
  onComplete: () => void;
}

const getFeatures = () => [
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 6C3 4.34 4.34 3 6 3H9L11 5H16C17.66 5 19 6.34 19 8V15C19 16.66 17.66 18 16 18H6C4.34 18 3 16.66 3 15V6Z"/>
      </svg>
    ),
    title: i18n.t("onboarding.f1Title"),
    desc: i18n.t("onboarding.f1Desc"),
  },
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="10" cy="10" r="7"/><path d="M10 6v4l2.5 2.5"/>
      </svg>
    ),
    title: i18n.t("onboarding.f2Title"),
    desc: i18n.t("onboarding.f2Desc"),
  },
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M10 2L12.5 8H19L14 11.5L16 18L10 14L4 18L6 11.5L1 8H7.5L10 2Z"/>
      </svg>
    ),
    title: i18n.t("onboarding.f3Title"),
    desc: i18n.t("onboarding.f3Desc"),
  },
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 6h14M5 10h10M7 14h6"/>
      </svg>
    ),
    title: i18n.t("onboarding.f4Title"),
    desc: i18n.t("onboarding.f4Desc"),
  },
];

export default function Onboarding({ onComplete }: Props) {
  return (
    <div className="fixed inset-0 z-[1000] bg-[#0E0D0C]/95 backdrop-blur-sm flex items-center justify-center">
      <div className="w-[520px] bg-[#23201E] border border-white/[0.08] rounded-2xl shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="px-8 pt-8 pb-6 border-b border-white/[0.06] text-center">
          <div className="flex items-center justify-center gap-2 mb-3">
            <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
              <path d="M4 8C4 5.79 5.79 4 8 4H12L16 8H22C24.21 8 26 9.79 26 12V21C26 23.21 24.21 25 22 25H8C5.79 25 4 23.21 4 21V8Z" fill="#D95340" opacity="0.9"/>
              <path d="M11 14V18M14 12V18M17 16V18" stroke="white" strokeWidth="1.8" strokeLinecap="round"/>
            </svg>
            <span className="text-xl font-bold text-[#F5F5F4] tracking-tight">TagWave</span>
          </div>
          <p className="text-[#605A55] text-sm leading-relaxed">
            Gerenciador de tags de áudio para DJs e produtores.
          </p>
        </div>

        {/* Features */}
        <div className="px-8 py-6 grid grid-cols-2 gap-4">
          {getFeatures().map(({ icon, title, desc }) => (
            <div key={title} className="flex gap-3">
              <div className="shrink-0 w-8 h-8 rounded-lg bg-[#D95340]/10 border border-[#D95340]/20 flex items-center justify-center text-[#D95340]/80">
                {icon}
              </div>
              <div>
                <p className="text-[12px] font-semibold text-[#C2BEBC] leading-tight">{title}</p>
                <p className="text-[11px] text-[#605A55] leading-snug mt-0.5">{desc}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Trial info + CTA */}
        <div className="px-8 pb-8">
          <div className="mb-4 px-4 py-3 rounded-lg bg-[#D95340]/8 border border-[#D95340]/15 text-center">
            <p className="text-[11px] text-[#D95340]/80">
              <span className="font-semibold">14 dias gratuitos</span> · Todas as funcionalidades disponíveis durante o período de avaliação
            </p>
          </div>
          <button
            onClick={() => {
              localStorage.setItem(ONBOARDING_KEY, "done");
              onComplete();
            }}
            className="w-full py-2.5 rounded-lg bg-[#D95340] hover:bg-[#E07364] active:bg-[#B34435] text-white text-sm font-bold uppercase tracking-wider transition-colors"
          >
            Começar
          </button>
          <p className="text-center text-[10px] text-[#373331] mt-2.5">
            Arraste uma pasta para o app ou clique em "Abrir Pasta" para começar
          </p>
        </div>
      </div>
    </div>
  );
}

export function shouldShowOnboarding(): boolean {
  return !localStorage.getItem(ONBOARDING_KEY);
}
