import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";

interface FilenameIssue {
  path: string;
  current: string;
  suggested: string;
  tags: string[];
}

interface Props {
  issues: FilenameIssue[];
  onDismiss: () => void;
  onFixed: (oldPath: string, newPath: string, newName: string) => void;
}

export default function FilenamePrompt({ issues, onDismiss, onFixed }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set(issues.map((i) => i.path)));
  const [fixing, setFixing] = useState(false);
  const [done, setDone] = useState(false);

  const allTags = [...new Set(issues.flatMap((i) => i.tags))];

  async function applyFixes() {
    setFixing(true);
    const targets = issues.filter((i) => selected.has(i.path));
    for (const issue of targets) {
      try {
        const newPath = await invoke<string>("apply_filename_fix", {
          path: issue.path,
          newName: issue.suggested,
        });
        onFixed(issue.path, newPath, issue.suggested);
      } catch {
        // silently skip
      }
    }
    setFixing(false);
    setDone(true);
    setTimeout(onDismiss, 1200);
  }

  if (done) {
    return (
      <div className="mx-3 mb-2 px-3 py-2 rounded-md bg-[#D95340]/12 border border-[#D95340]/20 flex items-center gap-2">
        <span className="text-[#D95340] text-xs">✓</span>
        <span className="text-xs text-[#D95340]/80 font-medium">Nomes de arquivo corrigidos</span>
      </div>
    );
  }

  return (
    <div className="mx-3 mb-2 rounded-md border border-[#8B2A42]/40 bg-[#8B2A42]/30 overflow-hidden">
      {/* Bar */}
      <div className="flex items-center gap-2 px-3 py-2">
        <span className="w-1.5 h-1.5 rounded-full bg-[#E07364] shrink-0" />
        <span className="text-[11px] font-semibold text-[#FAFAF9]">
          {issues.length} nomes de arquivo precisam de limpeza
        </span>
        <span className="text-[10px] text-[#C99BA6]">
          · {allTags.join(", ")}
        </span>
        <div className="flex-1" />
        <button
          onClick={() => setExpanded((v) => !v)}
          className="text-[11px] text-[#FAFAF9] hover:text-[#E07364] font-semibold transition-colors"
        >
          {expanded ? "Fechar" : "Ver e corrigir"}
        </button>
        <button
          onClick={onDismiss}
          className="text-[#C99BA6] hover:text-[#FAFAF9] text-xs ml-1 transition-colors"
        >
          ✕
        </button>
      </div>

      {/* Expanded list */}
      {expanded && (
        <div className="border-t border-[#D95340]/10">
          {/* Select all */}
          <div className="flex items-center gap-2 px-3 py-1.5 border-b border-white/[0.04]">
            <input
              type="checkbox"
              checked={selected.size === issues.length}
              onChange={() =>
                setSelected(
                  selected.size === issues.length
                    ? new Set()
                    : new Set(issues.map((i) => i.path))
                )
              }
            />
            <span className="text-[10px] text-[#605A55] uppercase tracking-wider">
              Selecionar tudo
            </span>
          </div>

          {/* Issue rows */}
          <div className="max-h-52 overflow-y-auto">
            {issues.map((issue) => (
              <div
                key={issue.path}
                className="flex items-start gap-2 px-3 py-1.5 border-b border-white/[0.02] hover:bg-white/[0.02]"
              >
                <input
                  type="checkbox"
                  className="mt-0.5 shrink-0"
                  checked={selected.has(issue.path)}
                  onChange={() => {
                    const next = new Set(selected);
                    if (next.has(issue.path)) next.delete(issue.path);
                    else next.add(issue.path);
                    setSelected(next);
                  }}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] text-[#756D67] font-mono truncate leading-tight">
                    {issue.current}
                  </p>
                  <p className="text-[11px] text-[#C2BEBC] font-mono truncate leading-tight mt-px">
                    → {issue.suggested}
                  </p>
                </div>
                <div className="flex gap-1 shrink-0 mt-0.5">
                  {issue.tags.map((t) => (
                    <span
                      key={t}
                      className="px-1 py-px rounded-sm text-[9px] bg-[#D95340]/15 text-[#D95340] uppercase tracking-wide"
                    >
                      {t}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Apply button */}
          <div className="px-3 py-2 flex items-center justify-between">
            <span className="text-[10px] text-[#605A55]">
              {selected.size} selecionadas
            </span>
            <button
              onClick={applyFixes}
              disabled={fixing || selected.size === 0}
              className="px-3 py-1.5 rounded-md text-[11px] font-bold uppercase tracking-wide bg-[#D95340] hover:bg-[#E07364] disabled:opacity-40 text-white transition-colors"
            >
              {fixing ? "Corrigindo…" : `Corrigir ${selected.size}`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export type { FilenameIssue };
