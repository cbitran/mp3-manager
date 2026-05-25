import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export interface FilenameMetaIssue {
  path: string;
  filename: string;
  extractedArtist: string;
  extractedTitle: string;
  missingArtist: boolean;
  missingTitle: boolean;
}

interface Props {
  issues: FilenameMetaIssue[];
  onDismiss: () => void;
  onApplied: (path: string, artist: string | null, title: string | null) => void;
}

export default function FilenameMetaPrompt({ issues, onDismiss, onApplied }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [ignored, setIgnored] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set(issues.map((i) => i.path)));
  const [applying, setApplying] = useState(false);
  const [done, setDone] = useState(false);

  const visible = issues.filter((i) => !ignored.has(i.path));

  function ignoreItem(path: string) {
    const next = new Set(ignored);
    next.add(path);
    setIgnored(next);
    setSelected((prev) => { const s = new Set(prev); s.delete(path); return s; });
    if (next.size === issues.length) onDismiss();
  }

  async function apply() {
    setApplying(true);
    const targets = visible.filter((i) => selected.has(i.path));
    for (const issue of targets) {
      try {
        await invoke("save_tags", {
          path: issue.path,
          title: issue.missingTitle ? issue.extractedTitle : null,
          artist: issue.missingArtist ? issue.extractedArtist : null,
          album: null,
          genre: null,
          year: null,
          trackNumber: null,
          totalTracks: null,
          bpm: null,
          key: null,
          rating: null,
          comment: null,
        });
        onApplied(
          issue.path,
          issue.missingArtist ? issue.extractedArtist : null,
          issue.missingTitle ? issue.extractedTitle : null,
        );
      } catch (err) {
        console.error("[FilenameMetaPrompt] save_tags falhou:", err);
      }
    }
    setApplying(false);
    setDone(true);
    setTimeout(onDismiss, 1200);
  }

  if (done) {
    return (
      <div className="mx-3 mb-2 px-3 py-2 rounded-md bg-[#D95340]/12 border border-[#D95340]/20 flex items-center gap-2">
        <span className="text-[#D95340] text-xs">✓</span>
        <span className="text-xs text-[#D95340]/80 font-medium">Metadados extraídos do nome do arquivo</span>
      </div>
    );
  }

  const missingBoth   = visible.filter((i) => i.missingArtist && i.missingTitle).length;
  const missingArtist = visible.filter((i) => i.missingArtist && !i.missingTitle).length;
  const missingTitle  = visible.filter((i) => i.missingTitle && !i.missingArtist).length;

  const summary = [
    missingBoth   > 0 && `${missingBoth} sem artista e título`,
    missingArtist > 0 && `${missingArtist} sem artista`,
    missingTitle  > 0 && `${missingTitle} sem título`,
  ].filter(Boolean).join(", ");

  return (
    <div className="mx-3 mb-2 rounded-md border border-[#AA6374]/40 bg-[#AA6374]/20 overflow-hidden">
      {/* Header — clicável em toda a área */}
      <div
        className="flex items-center gap-2 px-3 py-2 cursor-pointer select-none"
        onClick={() => setExpanded((v) => !v)}
      >
        <span className="w-1.5 h-1.5 rounded-full bg-[#AA6374] shrink-0" />
        <div className="flex-1 min-w-0">
          <span className="text-[11px] font-semibold text-[#FAFAF9]">
            {visible.length} faixa{visible.length !== 1 ? "s" : ""} com nome de arquivo identificável
          </span>
          <span className="text-[10px] text-[#DCDAD8]/60 ml-1.5">· {summary}</span>
        </div>
        <span className="text-[11px] text-[#FAFAF9]/70 font-semibold shrink-0">
          {expanded ? "Fechar" : "Revisar"}
        </span>
        <button
          onClick={(e) => { e.stopPropagation(); onDismiss(); }}
          className="text-[#C99BA6] hover:text-[#FAFAF9] text-xs ml-1 transition-colors shrink-0"
        >
          ✕
        </button>
      </div>

      {expanded && (
        <div className="border-t border-[#AA6374]/20">
          {/* Select all */}
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

          {/* Issue rows */}
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
                  <p className="text-[10px] text-[#756D67] font-mono truncate leading-tight">{issue.filename}</p>
                  <div className="flex gap-2 mt-0.5 flex-wrap">
                    {issue.missingArtist && (
                      <span className="text-[11px] text-[#DCDAD8] leading-tight">
                        Artista: <span className="text-[#E07364] font-medium">{issue.extractedArtist}</span>
                      </span>
                    )}
                    {issue.missingTitle && (
                      <span className="text-[11px] text-[#DCDAD8] leading-tight">
                        Título: <span className="text-[#E07364] font-medium">{issue.extractedTitle}</span>
                      </span>
                    )}
                  </div>
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

          {/* Footer */}
          <div className="px-3 py-2 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-[10px] text-[#605A55]">{selected.size} selecionadas</span>
              <button
                onClick={onDismiss}
                className="text-[10px] text-[#605A55] hover:text-[#C99BA6] transition-colors"
              >
                Ignorar tudo
              </button>
            </div>
            <button
              onClick={apply}
              disabled={applying || selected.size === 0}
              className="px-3 py-1.5 rounded-md text-[11px] font-bold uppercase tracking-wide bg-[#D95340] hover:bg-[#E07364] disabled:opacity-40 text-white transition-colors"
            >
              {applying ? "Aplicando…" : `Importar metadados (${selected.size})`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
