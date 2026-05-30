import { useAppStore } from "../store";

const DJ_COLORS: Record<string, string> = {
  serato:    "#1DB954",
  rekordbox: "#00A0E9",
  traktor:   "#FF5900",
  vdj:       "#E2001A",
  djay:      "#A259FF",
  engine_dj: "#00D4AA",
  m3u:       "#8F8883",
};

const DJ_ICONS: Record<string, string> = {
  serato:    "S",
  rekordbox: "R",
  traktor:   "T",
  vdj:       "V",
  djay:      "D",
  engine_dj: "E",
  m3u:       "M3U",
};

export default function DjExportOverlay() {
  const overlay = useAppStore((s) => s.djExportOverlay);
  if (!overlay) return null;

  const iconColor = DJ_COLORS[overlay.softwareId] ?? "#D95340";
  const iconLabel = DJ_ICONS[overlay.softwareId] ?? overlay.softwareId[0]?.toUpperCase() ?? "?";

  return (
    <div
      className="fixed inset-0 z-[900] flex flex-col items-center justify-center gap-6"
      style={{ background: "rgba(14,13,12,0.82)", backdropFilter: "blur(8px)" }}
    >
      {/* Logo TagWave com spinner */}
      <div className="relative flex items-center justify-center" style={{ width: 96, height: 96 }}>
        {/* Anel externo girando — cauda + arco principal */}
        <svg
          className="animate-[spin_1.4s_linear_infinite]"
          viewBox="0 0 100 100" width="96" height="96"
          style={{ position: "absolute", inset: 0 }}
        >
          <circle cx="50" cy="50" r="48" fill="none" stroke="#D95340"
            strokeWidth="2" strokeLinecap="round"
            strokeDasharray="120 182" opacity="0.18"/>
          <circle cx="50" cy="50" r="48" fill="none" stroke="#D95340"
            strokeWidth="2.5" strokeLinecap="round"
            strokeDasharray="56 246" opacity="0.95"/>
        </svg>

        {/* Disco vinílico estático */}
        <svg viewBox="0 0 100 100" width="84" height="84"
          style={{ position: "absolute", top: 6, left: 6 }}>
          <circle cx="50" cy="50" r="46" fill="#D95340"/>
          <circle cx="50" cy="50" r="43" fill="none" stroke="#B84030" strokeWidth="0.7" opacity="0.6"/>
          <circle cx="50" cy="50" r="39" fill="none" stroke="#B84030" strokeWidth="0.7" opacity="0.55"/>
          <circle cx="50" cy="50" r="35" fill="none" stroke="#B84030" strokeWidth="0.7" opacity="0.5"/>
          <circle cx="50" cy="50" r="31" fill="none" stroke="#B84030" strokeWidth="0.7" opacity="0.4"/>
          <circle cx="50" cy="50" r="27" fill="#0E0D0C"/>
        </svg>

        {/* Badge do software DJ — canto inferior direito */}
        <div
          className="absolute bottom-0 right-0 flex items-center justify-center rounded-full text-white font-black z-10"
          style={{
            width: 28, height: 28,
            background: iconColor,
            fontSize: iconLabel.length > 1 ? 8 : 11,
            border: "2.5px solid #0E0D0C",
            letterSpacing: "-0.02em",
          }}
        >
          {iconLabel}
        </div>
      </div>

      {/* Texto */}
      <div className="flex flex-col items-center gap-1.5">
        <span className="text-[11px] uppercase tracking-[0.18em] font-mono" style={{ color: "#605A55" }}>
          Exportando para
        </span>
        <span className="text-[16px] font-bold tracking-tight" style={{ color: "#F5F5F4" }}>
          {overlay.softwareName}
        </span>
        {overlay.detail && (
          <span className="text-[11px] font-mono" style={{ color: "#8F8883" }}>
            {overlay.detail}
          </span>
        )}
      </div>

      {/* Barra de progresso indeterminada */}
      <div className="overflow-hidden rounded-full" style={{ width: 160, height: 2, background: "rgba(217,83,64,0.15)" }}>
        <div
          className="h-full rounded-full"
          style={{
            width: "45%",
            background: "#D95340",
            animation: "dj-export-bar 1.4s ease-in-out infinite",
          }}
        />
      </div>

      <style>{`
        @keyframes dj-export-bar {
          0%   { transform: translateX(-100%); }
          50%  { transform: translateX(120%); }
          100% { transform: translateX(350%); }
        }
      `}</style>
    </div>
  );
}
