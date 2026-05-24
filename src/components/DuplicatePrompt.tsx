import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "../store";

export interface DuplicateGroup {
  key: string;
  paths: string[];
}

interface Props {
  groups: DuplicateGroup[];
  onDismiss: () => void;
}

function fileName(p: string) {
  return p.split(/[\\/]/).filter(Boolean).pop() ?? p;
}

function formatGroupKey(key: string) {
  const parts = key.split("|||");
  if (parts.length >= 2) return `${parts[0]} · ${parts[1]}`;
  return key;
}

export default function DuplicatePrompt({ groups, onDismiss }: Props) {
  const [expanded, setExpanded] = useState(false);
  const { tracks, toggleSelect, clearSelection, setFilterTab } = useAppStore();

  // Paths marcados para remoção (checkbox vermelho)
  const [markedPaths, setMarkedPaths] = useState<Set<string>>(() => {
    const initial = new Set<string>();
    groups.forEach((g) => g.paths.slice(1).forEach((p) => initial.add(p)));
    return initial;
  });

  // Paths ignorados individualmente (não aparecem mais na lista)
  const [ignoredPaths, setIgnoredPaths] = useState<Set<string>>(new Set());

  const totalDupes = groups.reduce((n, g) => n + g.paths.length - 1, 0);

  function toggleMark(path: string) {
    setMarkedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  function ignorePath(path: string) {
    setIgnoredPaths((prev) => new Set(prev).add(path));
    // Se estava marcado para remoção, desmarcar
    setMarkedPaths((prev) => {
      const next = new Set(prev);
      next.delete(path);
      return next;
    });
  }

  function undoIgnore(path: string) {
    setIgnoredPaths((prev) => {
      const next = new Set(prev);
      next.delete(path);
      return next;
    });
  }

  function applySelection() {
    clearSelection();
    markedPaths.forEach((p) => {
      const t = tracks.find((t) => t.path === p);
      if (t) toggleSelect(t.id);
    });
    setFilterTab("all");
    onDismiss();
  }

  // Grupos que ainda têm pelo menos 2 arquivos visíveis (não ignorados)
  const visibleGroups = groups
    .map((g) => ({ ...g, visiblePaths: g.paths.filter((p) => !ignoredPaths.has(p)) }))
    .filter((g) => g.visiblePaths.length >= 2);

  const markedCount = [...markedPaths].filter((p) => !ignoredPaths.has(p)).length;

  return (
    <div className="mx-3 mb-2 rounded-md border border-[#D95340]/20 bg-[#D95340]/5 overflow-hidden">
      {/* Header */}
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
          {expanded ? "Fechar" : "Revisar"}
        </button>
        <span className="text-[#373331] text-[10px]">·</span>
        <button
          onClick={onDismiss}
          className="text-[11px] text-[#605A55] hover:text-[#8F8883] font-medium transition-colors"
          title="Fechar sem fazer nenhuma alteração"
        >
          Ignorar tudo
        </button>
      </div>

      {/* Expanded review */}
      {expanded && (
        <div className="border-t border-[#D95340]/10">
          <div className="max-h-72 overflow-y-auto">
            {visibleGroups.length === 0 ? (
              <div className="px-3 py-4 text-center text-[11px] text-[#4C4743]">
                Todos os arquivos foram ignorados.
              </div>
            ) : (
              visibleGroups.map((g) => (
                <div key={g.key} className="px-3 py-2 border-b border-white/[0.03]">
                  {/* Grupo header */}
                  <p className="text-[9px] text-[#D95340]/40 uppercase tracking-widest mb-2 font-mono truncate">
                    {formatGroupKey(g.key)}
                  </p>

                  {g.visiblePaths.map((p) => {
                    const name = fileName(p);
                    const marked = markedPaths.has(p);
                    return (
                      <div
                        key={p}
                        className={`flex items-center gap-2 px-2 py-1.5 rounded-md mb-1 transition-colors ${
                          marked
                            ? "bg-[#D95340]/10 border border-[#D95340]/20"
                            : "bg-white/[0.02] border border-white/[0.03]"
                        }`}
                      >
                        {/* Checkbox de remoção */}
                        <button
                          onClick={() => toggleMark(p)}
                          title={marked ? "Manter este arquivo" : "Marcar para remover"}
                          className={`w-4 h-4 rounded shrink-0 flex items-center justify-center border transition-colors ${
                            marked
                              ? "bg-[#D95340]/80 border-[#D95340] text-white"
                              : "border-white/[0.12] text-transparent hover:border-[#D95340]/50"
                          }`}
                        >
                          <svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                            <line x1="1.5" y1="1.5" x2="6.5" y2="6.5"/>
                            <line x1="6.5" y1="1.5" x2="1.5" y2="6.5"/>
                          </svg>
                        </button>

                        {/* Nome do arquivo */}
                        <span className={`flex-1 text-[11px] font-mono truncate min-w-0 ${
                          marked ? "text-[#D95340]/70 line-through" : "text-[#a09890]"
                        }`}>
                          {name}
                        </span>

                        {/* Ignorar individualmente */}
                        <button
                          onClick={() => ignorePath(p)}
                          title="Ignorar este arquivo (não aparecerá mais nesta revisão)"
                          className="shrink-0 text-[10px] text-[#4C4743] hover:text-[#8F8883] transition-colors px-1"
                        >
                          Ignorar
                        </button>

                        {/* Revelar no Finder */}
                        <button
                          onClick={() => invoke("reveal_in_finder", { path: p }).catch(() => {})}
                          title="Revelar arquivo no Finder"
                          className="shrink-0 text-[#4C4743] hover:text-[#8F8883] transition-colors"
                        >
                          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="1" y="2" width="10" height="8" rx="1"/>
                            <path d="M1 5h10"/>
                            <path d="M4 2v3"/>
                          </svg>
                        </button>
                      </div>
                    );
                  })}
                </div>
              ))
            )}

            {/* Arquivos ignorados individualmente — seção colapsável de desfazer */}
            {ignoredPaths.size > 0 && (
              <div className="px-3 py-2 border-t border-white/[0.03]">
                <p className="text-[9px] text-[#4C4743] uppercase tracking-widest mb-1.5">
                  Ignorados ({ignoredPaths.size})
                </p>
                {[...ignoredPaths].map((p) => (
                  <div key={p} className="flex items-center gap-2 px-2 py-1 rounded-md mb-0.5 bg-white/[0.01]">
                    <span className="flex-1 text-[10px] font-mono text-[#4C4743] truncate min-w-0">
                      {fileName(p)}
                    </span>
                    <button
                      onClick={() => undoIgnore(p)}
                      className="shrink-0 text-[10px] text-[#605A55] hover:text-[#8F8883] transition-colors"
                    >
                      Desfazer
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Footer de ação */}
          <div className="flex items-center justify-between px-3 py-2 border-t border-[#D95340]/10 bg-[#D95340]/[0.03]">
            <span className="text-[10px] text-[#756D67]">
              {markedCount > 0
                ? `${markedCount} arquivo${markedCount !== 1 ? "s" : ""} marcado${markedCount !== 1 ? "s" : ""} para remover`
                : "Nenhum marcado"}
            </span>
            <button
              onClick={applySelection}
              disabled={markedCount === 0}
              className="px-3 py-1 rounded-md text-[11px] font-semibold transition-colors disabled:opacity-30 disabled:cursor-not-allowed bg-[#D95340]/80 hover:bg-[#D95340] text-white"
            >
              Selecionar marcados
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
