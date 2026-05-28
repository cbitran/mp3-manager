import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";

interface DirEntry {
  name: string;
  path: string;
  is_dir: boolean;
  has_subdirs: boolean;
  audio_count: number;
}

interface Props {
  rootPath: string;
  onLoadFolder: (path: string) => void;
  onLoadFiles?: (paths: string[], name: string) => void;
  onClose: () => void;
}

// Normaliza backslashes para forward slashes (compatibilidade Windows)
const norm = (p: string) => p.replace(/\\/g, "/");

export default function FolderBrowser({ rootPath, onLoadFolder, onLoadFiles, onClose }: Props) {
  const [currentPath, setCurrentPath] = useState(norm(rootPath));
  const [history, setHistory] = useState<string[]>([]);
  const [entries, setEntries] = useState<DirEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const lastClickRef = useRef<{ path: string; time: number }>({ path: "", time: 0 });
  const lastSelectedIndexRef = useRef<number>(-1);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setEntries(null);
    invoke<DirEntry[]>("list_dir_contents", { path: currentPath })
      .then((r) => { if (!cancelled) setEntries(r); })
      .catch((e) => { if (!cancelled) setError(String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [currentPath]);

  function navigate(path: string) {
    setHistory((h) => [...h, currentPath]);
    setCurrentPath(norm(path));
    setSelectedFiles(new Set());
    lastSelectedIndexRef.current = -1;
  }

  function goBack() {
    const prev = history[history.length - 1];
    if (!prev) { onClose(); return; }
    setHistory((h) => h.slice(0, -1));
    setCurrentPath(prev);
    setSelectedFiles(new Set());
    lastSelectedIndexRef.current = -1;
  }

  function goToCrumb(path: string) {
    if (path === currentPath) return;
    setHistory((h) => [...h, currentPath]);
    setCurrentPath(path);
    setSelectedFiles(new Set());
    lastSelectedIndexRef.current = -1;
  }

  function toggleFile(path: string) {
    setSelectedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  }

  function handleFileClick(path: string, index: number, e: React.MouseEvent) {
    if (!onLoadFiles) return;
    if (e.shiftKey && lastSelectedIndexRef.current >= 0) {
      // Seleciona range entre último clicado e atual
      const start = Math.min(lastSelectedIndexRef.current, index);
      const end   = Math.max(lastSelectedIndexRef.current, index);
      setSelectedFiles((prev) => {
        const next = new Set(prev);
        files.slice(start, end + 1).forEach((f) => next.add(f.path));
        return next;
      });
    } else {
      toggleFile(path);
      lastSelectedIndexRef.current = index;
    }
  }

  function toggleAll() {
    if (selectedFiles.size === files.length) {
      setSelectedFiles(new Set());
      lastSelectedIndexRef.current = -1;
    } else {
      setSelectedFiles(new Set(files.map((f) => f.path)));
      lastSelectedIndexRef.current = files.length - 1;
    }
  }

  // Build breadcrumb segments from path (já normalizado com forward slashes)
  const segments = currentPath.replace(/\/$/, "").split("/").filter(Boolean);
  // Windows: "F:" é o primeiro segmento — reconstrói "F:/" em vez de "/F:"
  const isWinDrive = segments[0]?.match(/^[A-Z]:$/i);
  const crumbs = segments.map((seg, i) => {
    const parts = segments.slice(0, i + 1);
    const path = isWinDrive
      ? parts.join("/") + (i === 0 ? "/" : "")
      : "/" + parts.join("/");
    return { name: seg, path };
  });

  const folders = entries?.filter((e) => e.is_dir) ?? [];
  const files   = entries?.filter((e) => !e.is_dir) ?? [];
  const folderName = currentPath.split("/").filter(Boolean).pop() ?? currentPath;

  // Ctrl/Cmd+A para selecionar tudo
  useEffect(() => {
    if (!onLoadFiles) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "a" && files.length > 0) {
        e.preventDefault();
        setSelectedFiles(new Set(files.map((f) => f.path)));
        lastSelectedIndexRef.current = files.length - 1;
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [files, onLoadFiles]);

  return (
    <div className="flex flex-col flex-1 overflow-hidden select-none" style={{ background: "#0E0D0C" }}>

      {/* ── Header / Breadcrumb ─────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-5 py-3 shrink-0 border-b" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
        <button onClick={goBack} title="Voltar"
          className="w-7 h-7 flex items-center justify-center rounded-lg transition-all hover:brightness-125 shrink-0"
          style={{ background: "rgba(255,255,255,0.06)", color: "#8F8883", border: "1px solid rgba(255,255,255,0.08)" }}>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M8 2L4 6l4 4"/>
          </svg>
        </button>

        {/* Breadcrumb — scrollable */}
        <div className="flex items-center gap-0.5 flex-1 min-w-0 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
          {crumbs.map((bc, i) => {
            const isCurrent = i === crumbs.length - 1;
            return (
              <span key={bc.path} className="flex items-center gap-0.5 shrink-0">
                {i > 0 && <span className="text-[11px] px-0.5" style={{ color: "#2e2a27" }}>›</span>}
                <button
                  onClick={() => goToCrumb(bc.path)}
                  disabled={isCurrent}
                  className="text-[12px] font-medium px-1 py-0.5 rounded transition-colors"
                  style={{ color: isCurrent ? "#C2BEBC" : "#C97B40", cursor: isCurrent ? "default" : "pointer" }}
                  onMouseEnter={(e) => { if (!isCurrent) e.currentTarget.style.color = "#E09850"; }}
                  onMouseLeave={(e) => { if (!isCurrent) e.currentTarget.style.color = "#C97B40"; }}>
                  {bc.name}
                </button>
              </span>
            );
          })}
        </div>

        <button onClick={onClose} title="Fechar browser"
          className="w-6 h-6 flex items-center justify-center rounded-full shrink-0 transition-all"
          style={{ color: "#605A55" }}
          onMouseEnter={(e) => { e.currentTarget.style.color = "#C2BEBC"; e.currentTarget.style.background = "rgba(255,255,255,0.06)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = "#605A55"; e.currentTarget.style.background = "transparent"; }}>
          <svg width="9" height="9" viewBox="0 0 9 9" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
            <line x1="1" y1="1" x2="8" y2="8"/><line x1="8" y1="1" x2="1" y2="8"/>
          </svg>
        </button>
      </div>

      {/* ── Content ─────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-5 py-4 min-h-0">

        {loading && (
          <div className="flex items-center justify-center h-48">
            <span className="text-[12px]" style={{ color: "#4C4743" }}>Carregando…</span>
          </div>
        )}

        {error && (
          <div className="flex items-center justify-center h-48">
            <span className="text-[11px] text-red-400/70">{error}</span>
          </div>
        )}

        {!loading && !error && entries && folders.length === 0 && files.length === 0 && (
          <div className="flex flex-col items-center justify-center h-48 gap-3">
            <svg width="32" height="28" viewBox="0 0 32 28" fill="none" stroke="#3a3530" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 8a2 2 0 012-2h6l2.5 2.5H28a2 2 0 012 2v12a2 2 0 01-2 2H4a2 2 0 01-2-2V8z"/>
            </svg>
            <span className="text-[12px]" style={{ color: "#4C4743" }}>Pasta vazia ou sem arquivos de áudio</span>
          </div>
        )}

        {/* ── Lista estilo Finder ──────────────────────────────────── */}
        {!loading && !error && (folders.length > 0 || files.length > 0) && (
          <div className="flex flex-col">
            {folders.map((f) => (
              <button key={f.path}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData("text/folder-path", f.path);
                  e.dataTransfer.effectAllowed = "copy";
                }}
                onClick={() => {
                  const now = Date.now();
                  if (lastClickRef.current.path === f.path && now - lastClickRef.current.time < 400) {
                    onLoadFolder(f.path);
                  } else {
                    lastClickRef.current = { path: f.path, time: now };
                    navigate(f.path);
                  }
                }}
                className="flex items-center gap-2 px-2 h-8 rounded-md w-full text-left transition-colors"
                style={{ color: "#C2BEBC", background: "transparent" }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.05)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}>
                <svg width="15" height="13" viewBox="0 0 15 13" fill="none" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                  <path d="M1 3.5A1.5 1.5 0 012.5 2h3.19L7.5 3.5H13A1.5 1.5 0 0114.5 5v6A1.5 1.5 0 0113 12.5H2A1.5 1.5 0 01.5 11V3.5z"
                    fill="rgba(201,123,64,0.15)" stroke="#C97B40" strokeWidth="1.2"/>
                </svg>
                <span className="flex-1 text-[12px] truncate">{f.name}</span>
                {f.audio_count > 0 && (
                  <span className="text-[10px] font-mono shrink-0 tabular-nums" style={{ color: "#D95340", opacity: 0.65 }}>
                    {f.audio_count}
                  </span>
                )}
                {f.has_subdirs && (
                  <svg width="5" height="9" viewBox="0 0 5 9" fill="none" stroke="#3a3530" strokeWidth="1.5" strokeLinecap="round" className="shrink-0">
                    <path d="M1 1l3 3.5L1 8"/>
                  </svg>
                )}
              </button>
            ))}

            {folders.length > 0 && files.length > 0 && (
              <div className="flex items-center justify-between px-2 pt-2 pb-1">
                <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "#4C4743" }}>
                  {files.length} faixa{files.length !== 1 ? "s" : ""}
                </span>
                {onLoadFiles && files.length > 0 && (
                  <button
                    onClick={toggleAll}
                    className="text-[10px] transition-colors"
                    style={{ color: selectedFiles.size === files.length ? "#D95340" : "#605A55" }}>
                    {selectedFiles.size === files.length ? "Desmarcar tudo" : "Selecionar tudo"}
                  </button>
                )}
              </div>
            )}

            {files.slice(0, 200).map((f, idx) => (
              <div
                key={f.path}
                onClick={(e) => handleFileClick(f.path, idx, e)}
                className="flex items-center gap-2 px-2 h-7 rounded-md transition-colors"
                style={{
                  color: selectedFiles.has(f.path) ? "#C2BEBC" : "#706A65",
                  background: selectedFiles.has(f.path) ? "rgba(217,83,64,0.08)" : "transparent",
                  cursor: onLoadFiles ? "pointer" : "default",
                }}>
                {onLoadFiles && (
                  <div
                    className="w-3.5 h-3.5 rounded shrink-0 flex items-center justify-center transition-colors"
                    style={{
                      background: selectedFiles.has(f.path) ? "#D95340" : "transparent",
                      border: selectedFiles.has(f.path) ? "1px solid #D95340" : "1px solid rgba(255,255,255,0.15)",
                    }}>
                    {selectedFiles.has(f.path) && (
                      <svg width="8" height="6" viewBox="0 0 8 6" fill="none" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M1 3l2 2 4-4"/>
                      </svg>
                    )}
                  </div>
                )}
                {!onLoadFiles && (
                  <svg width="8" height="9" viewBox="0 0 8 9" fill="#D95340" opacity={0.4} className="shrink-0">
                    <path d="M1 0.5L7.5 4.5 1 8.5V0.5z"/>
                  </svg>
                )}
                <span className="flex-1 text-[11px] font-mono truncate">{f.name}</span>
              </div>
            ))}

            {files.length > 200 && (
              <div className="px-2 py-1 text-[10px]" style={{ color: "#4C4743" }}>
                +{files.length - 200} arquivos…
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Footer: load button ─────────────────────────────────────── */}
      {!loading && entries && (folders.length > 0 || files.length > 0) && (
        <div className="shrink-0 px-5 py-3 border-t flex flex-col gap-2" style={{ borderColor: "rgba(255,255,255,0.06)", background: "rgba(0,0,0,0.25)" }}>
          {selectedFiles.size > 0 && onLoadFiles && (
            <button
              onClick={() => { onLoadFiles([...selectedFiles], folderName); onClose(); }}
              className="w-full py-2.5 rounded-xl text-[13px] font-semibold text-white transition-all hover:brightness-110 active:scale-[0.99]"
              style={{ background: "#D95340" }}>
              Carregar {selectedFiles.size} faixa{selectedFiles.size !== 1 ? "s" : ""} selecionada{selectedFiles.size !== 1 ? "s" : ""}
            </button>
          )}
          <button
            onClick={() => onLoadFolder(currentPath)}
            className="w-full py-2.5 rounded-xl text-[13px] font-semibold transition-all hover:brightness-110 active:scale-[0.99]"
            style={selectedFiles.size > 0 ? { background: "rgba(255,255,255,0.06)", color: "#8F8883", border: "1px solid rgba(255,255,255,0.08)" } : { background: "#D95340", color: "white" }}>
            Carregar pasta "{folderName}"
          </button>
        </div>
      )}

    </div>
  );
}
