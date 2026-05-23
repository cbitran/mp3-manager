import { useAppStore } from "../store";

export default function TrialBanner() {
  const { isTrialActivated, daysRemaining, tracksAnalyzed, estimatedTimeSaved } = useAppStore();

  if (isTrialActivated()) return null;

  const days = daysRemaining();

  const colorClass =
    days <= 3 ? "text-[#D95340] border-[#D95340]/50 bg-[#D95340]/12" :
    days <= 7 ? "text-[#E07364] border-[#E07364]/30 bg-[#E07364]/8" :
                "text-[#D95340]/70 border-[#D95340]/20 bg-[#D95340]/5";

  return (
    <div
      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium border ${colorClass}`}
      style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      title={`Avaliação gratuita: ${days} dia${days === 1 ? "" : "s"} restante${days === 1 ? "" : "s"}`}
    >
      <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
        <circle cx="5" cy="5" r="4.5" stroke="currentColor" strokeWidth="1" fill="none"/>
        <path d="M5 2.5v2.75l1.5 1" stroke="currentColor" strokeWidth="1" strokeLinecap="round" fill="none"/>
      </svg>
      <span>Trial · {days}d</span>
      {tracksAnalyzed > 0 && (
        <span className="opacity-50">
          · {tracksAnalyzed} faixas · {estimatedTimeSaved()}
        </span>
      )}
    </div>
  );
}
