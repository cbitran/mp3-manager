import { useState } from "react";
import { useAppStore } from "../store";

export interface DuplicateGroup {
  key: string;
  paths: string[];
}

interface Props {
  groups: DuplicateGroup[];
  onDismiss: () => void;
}

export default function DuplicatePrompt({ groups, onDismiss }: Props) {
  const [expanded, setExpanded] = useState(false);
  const { tracks, toggleSelect, clearSelection, setFilterTab } = useAppStore();

  const totalDupes = groups.reduce((n, g) => n + g.paths.length - 1, 0);

  function selectDuplicates() {
    clearSelection();
    groups.forEach((g) => {
      // Keep first path, select the rest for review
      g.paths.slice(1).forEach((p) => {
        const t = tracks.find((t) => t.path === p);
        if (t) toggleSelect(t.id);
      });
    });
    setFilterTab("all");
    onDismiss();
  }

  return (
    <div className="mx-3 mb-2 rounded-md border border-[#D95340]/20 bg-[#D95340]/5 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2">
        <span className="w-1.5 h-1.5 rounded-full bg-[#D95340] shrink-0" />
        <span className="text-[11px] font-semibold text-[#D95340]/80">
          {groups.length} grupos duplicados · {totalDupes} arquivo{totalDupes !== 1 ? "s" : ""} extra
        </span>
        <div className="flex-1" />
        <button
          onClick={() => setExpanded((v) => !v)}
          className="text-[11px] text-[#D95340]/70 hover:text-[#D95340] font-semibold transition-colors"
        >
          {expanded ? "Fechar" : "Ver"}
        </button>
        <button
          onClick={selectDuplicates}
          className="text-[11px] text-[#D95340]/70 hover:text-[#D95340] font-semibold transition-colors ml-2"
        >
          Selecionar extras
        </button>
        <button
          onClick={onDismiss}
          className="text-[#373331] hover:text-[#605A55] text-xs ml-1 transition-colors"
        >
          ✕
        </button>
      </div>

      {expanded && (
        <div className="border-t border-[#D95340]/10">
          <div className="max-h-48 overflow-y-auto">
            {groups.map((g) => (
              <div key={g.key} className="px-3 py-1.5 border-b border-white/[0.02]">
                <p className="text-[10px] text-[#D95340]/50 uppercase tracking-wide mb-1 truncate font-mono">
                  {g.key}
                </p>
                {g.paths.map((p, i) => (
                  <p
                    key={p}
                    className={`text-[11px] font-mono truncate leading-tight ${
                      i === 0 ? "text-[#756D67]" : "text-[#D95340]/70"
                    }`}
                  >
                    {i === 0 ? "✓ " : "× "}{p.split("/").pop()}
                  </p>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
