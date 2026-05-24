import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export interface ParenIssue {
  path: string;
  current_filename: string;
  suggested_filename: string;
  paren_content: string;
  suggested_content: string;
}

interface Props {
  issues: ParenIssue[];
  onDismiss: () => void;
  onFixed: (oldPath: string, newPath: string, newName: string) => void;
}

export default function ParenReviewPrompt({ issues, onDismiss, onFixed }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [ignored, setIgnored] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set(issues.map((i) => i.path)));
  const [fixing, setFixing] = useState(false);
  const [done, setDone] = useState(false);

  const visible = issues.filter((i) => !ignored.has(i.path));

  function ignoreItem(path: string) {
    const next = new Set(ignored);
    next.add(path);
    setIgnored(next);
    setSelected((prev) => { const s = new Set(prev); s.delete(path); return s; });
    if (next.size === issues.length) onDismiss();
  }

  async function applyFixes() {
    setFixing(true);
    const targets = visible.filter((i) => selected.has(i.path));
    for (const issue of targets) {
      try {
        const newPath = await invoke<string>("apply_paren_fix", {
          path: issue.path,
          newName: issue.suggested_filename,
        });
        onFixed(issue.path, newPath, issue.suggested_filename);
      } catch { /* skip */ }
    }
    setFixing(false);
    setDone(true);
    setTimeout(onDismiss, 1200);
  }

  if (done) {
    return (
      <div className="mx-3 mb-2 px-3 py-2 rounded-md bg-[#D95340]/12 border border-[#D95340]/20 flex items-center gap-2">
        <span className="text-[#D95340] text-xs">✓</span>
        <span className="text-xs text-[#D95340]/80 font-medium">Parênteses corrigidos</span>
      </div>
    );
  }

  return (
    <div className="mx-3 mb-2 rounded-md border border-[#D95340]/15 bg-[#D95340]/4 overflow-hidden">
      {/* Header — clicável em toda a área */}
      <div
        className="flex items-center gap-2 px-3 py-2 cursor-pointer select-none"
        onClick={() => setExpanded((v) => !v)}
      >
        <span className="w-1.5 h-1.5 rounded-full bg-[#D95340]/60 shrink-0" />
        <span className="text-[11px] font-semibold text-[#D95340]/80">
          {visible.length} arquivo{visible.length !== 1 ? "s" : ""} com conteúdo suspeito em parênteses
        </span>
        <div className="flex-1" />
        <span className="text-[11px] text-[#D95340]/70 font-semibold shrink-0">
          {expanded ? "Fechar" : "Revisar"}
        </span>
        <button
          onClick={(e) => { e.stopPropagation(); onDismiss(); }}
          className="text-[#373331] hover:text-[#605A55] text-xs ml-1 transition-colors shrink-0"
        >
          ✕
        </button>
      </div>

      {expanded && (
        <div className="border-t border-[#D95340]/10">
          <div className="flex items-center gap-2 px-3 py-1.5 border-b border-white/[0.04]">
            <input
              type="checkbox"
              checked={selected.size === visible.length && visible.length > 0}
              onChange={() =>
                setSelected(
                  selected.size === visible.length
                    ? new Set()
                    : new Set(visible.map((i) => i.path))
                )
              }
            />
            <span className="text-[10px] text-[#605A55] uppercase tracking-wider">Selecionar tudo</span>
          </div>

          <div className="max-h-52 overflow-y-auto">
            {visible.map((issue) => (
              <div
                key={issue.path}
                className="flex items-start gap-2 px-3 py-1.5 border-b border-white/[0.02] hover:bg-white/[0.02] group"
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
                    {issue.current_filename}
                  </p>
                  <p className="text-[11px] text-[#C2BEBC] font-mono truncate leading-tight mt-px">
                    → {issue.suggested_filename}
                  </p>
                </div>
                <div className="text-[10px] font-mono shrink-0 text-right flex flex-col items-end gap-px">
                  <p className="text-[#605A55] line-through">{issue.paren_content}</p>
                  <p className="text-[#D95340]/70">{issue.suggested_content}</p>
                </div>
                {/* Ignorar item individual */}
                <button
                  onClick={() => ignoreItem(issue.path)}
                  title="Ignorar este item"
                  className="shrink-0 mt-0.5 opacity-0 group-hover:opacity-100 text-[#605A55] hover:text-[#C99BA6] transition-all text-xs leading-none"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>

          <div className="px-3 py-2 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-[10px] text-[#605A55]">{selected.size} selecionados</span>
              <button
                onClick={onDismiss}
                className="text-[10px] text-[#605A55] hover:text-[#C99BA6] transition-colors"
              >
                Ignorar tudo
              </button>
            </div>
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
