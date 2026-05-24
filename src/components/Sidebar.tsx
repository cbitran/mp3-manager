import { useRef, useState } from "react";
import { useAppStore } from "../store";
import { invoke } from "@tauri-apps/api/core";

interface SidebarProps {
  onFolderSelect: (folder: string) => void;
  onAnalyzeBpmFolder?: (folderPath: string) => void;
}

interface DeleteDialogState {
  path: string;
  name: string;
}

export default function Sidebar({ onFolderSelect, onAnalyzeBpmFolder }: SidebarProps) {
  const { tracks, favoriteFolders, recentFolders, lastFolder, toggleFavorite, removeRecentFolder, setTracks, setLastFolder, isScanning } = useAppStore();
  const setPlayerTrack = useAppStore((s) => s.setPlayerTrack);
  const clearSelection = useAppStore((s) => s.clearSelection);

  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [subfolderMap, setSubfolderMap] = useState<Record<string, string[]>>({});
  const [deleteDialog, setDeleteDialog] = useState<DeleteDialogState | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; path: string } | null>(null);
  const [sidebarTab, setSidebarTab] = useState<"recent" | "favorites">("recent");
  const [isDragOver, setIsDragOver] = useState(false);
  const [dupDialog, setDupDialog] = useState<{ path: string; name: string } | null>(null);
  const dragCounterRef = useRef(0);

  const clearFolderTracks = (path: string) => {
    if (path === lastFolder) {
      setTracks([]);
      setPlayerTrack(null);
      clearSelection();
      setLastFolder(null);
    }
  };

  const isFavorite = (path: string) => favoriteFolders.includes(path);

  const toggleExpand = async (path: string) => {
    const next = new Set(expandedFolders);
    if (next.has(path)) {
      next.delete(path);
    } else {
      next.add(path);
      if (!subfolderMap[path]) {
        try {
          const subs: string[] = await invoke("list_subfolders", { path });
          setSubfolderMap((m) => ({ ...m, [path]: subs }));
        } catch {
          setSubfolderMap((m) => ({ ...m, [path]: [] }));
        }
      }
    }
    setExpandedFolders(next);
  };

  const handleRemoveFromList = (path: string) => {
    clearFolderTracks(path);
    removeRecentFolder(path);
    if (isFavorite(path)) toggleFavorite(path);
    setDeleteDialog(null);
  };

  const handleMoveToTrash = async (path: string) => {
    try {
      await invoke("trash_folder", { path });
    } catch (e) {
      console.error("Erro ao mover para lixeira:", e);
    }
    clearFolderTracks(path);
    removeRecentFolder(path);
    if (isFavorite(path)) toggleFavorite(path);
    setDeleteDialog(null);
  };

  const handleContextMenu = (e: React.MouseEvent, path: string) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, path });
  };

  const closeContextMenu = () => setContextMenu(null);

  function handleDragEnter(e: React.DragEvent) {
    e.preventDefault();
    dragCounterRef.current++;
    setIsDragOver(true);
  }

  function handleDragLeave() {
    dragCounterRef.current--;
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0;
      setIsDragOver(false);
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    dragCounterRef.current = 0;
    setIsDragOver(false);
    const files = e.dataTransfer.files;
    if (files.length === 0) return;
    // @ts-expect-error — Tauri expõe .path em File
    const droppedPath: string = files[0].path;
    if (!droppedPath) return;
    // Verifica se a pasta já existe na lista
    if (recentFolders.includes(droppedPath)) {
      const name = droppedPath.split(/[\\/]/).filter(Boolean).pop() ?? droppedPath;
      setDupDialog({ path: droppedPath, name });
    } else {
      onFolderSelect(droppedPath);
    }
  }

  return (
    <div
      className="w-full flex flex-col border-r border-white/[0.05] bg-[#0E0D0C] overflow-y-auto no-scrollbar relative"
      onClick={closeContextMenu}
      onDragEnter={handleDragEnter}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Drag overlay */}
      {isDragOver && (
        <div className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-2 bg-[#0E0D0C]/90 border-2 border-dashed border-[#D95340]/60 rounded-sm pointer-events-none">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#D95340" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="opacity-70">
            <path d="M3 7a2 2 0 012-2h3l2 3h9a2 2 0 012 2v7a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"/>
          </svg>
          <span className="text-[11px] font-semibold text-[#D95340]/80 text-center px-3">
            Solte para adicionar pasta
          </span>
        </div>
      )}

      {/* Abas Recentes / Favoritos */}
      {(recentFolders.length > 0 || favoriteFolders.length > 0) && (
        <div className="flex flex-col flex-1 overflow-hidden">
          {/* Tab bar */}
          <div className="flex px-3 pt-2 gap-0 border-b border-white/[0.05]">
            {(["recent", "favorites"] as const).map((tab) => {
              const label = tab === "recent" ? "Recentes" : "Favoritos";
              const count = tab === "recent" ? recentFolders.length : favoriteFolders.length;
              const active = sidebarTab === tab;
              return (
                <button
                  key={tab}
                  onClick={() => setSidebarTab(tab)}
                  className={`flex items-center gap-1.5 px-2 pb-2 text-[10px] font-semibold transition-colors border-b-2 -mb-px ${
                    active
                      ? "text-[#F5F5F4] border-[#D95340]"
                      : "text-[#605A55] border-transparent hover:text-[#8F8883]"
                  }`}
                >
                  {label}
                  {count > 0 && (
                    <span className={`text-[9px] font-mono tabular-nums px-1 py-px rounded-sm ${
                      active ? "bg-[#D95340]/20 text-[#D95340]" : "bg-white/[0.05] text-[#605A55]"
                    }`}>
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Tab content */}
          <div className="flex-1 overflow-y-auto no-scrollbar px-2 pt-2">
            {sidebarTab === "recent" && (
              recentFolders.length > 0
                ? recentFolders.map((f) => (
                    <FolderRow
                      key={f}
                      path={f}
                      isSelected={lastFolder === f}
                      isFavorite={isFavorite(f)}
                      isExpanded={expandedFolders.has(f)}
                      subfolders={subfolderMap[f] ?? null}
                      onOpen={() => onFolderSelect(f)}
                      onToggleExpand={() => toggleExpand(f)}
                      onToggleFavorite={() => toggleFavorite(f)}
                      onContextMenu={(e) => handleContextMenu(e, f)}
                      onFolderSelect={onFolderSelect}
                      lastFolder={lastFolder}
                    />
                  ))
                : <p className="px-2 py-4 text-[10px] text-[#4C4743]">Nenhuma pasta recente</p>
            )}
            {sidebarTab === "favorites" && (
              favoriteFolders.length > 0
                ? favoriteFolders.map((f) => (
                    <FolderRow
                      key={f}
                      path={f}
                      isSelected={lastFolder === f}
                      isFavorite={isFavorite(f)}
                      isExpanded={expandedFolders.has(f)}
                      subfolders={subfolderMap[f] ?? null}
                      onOpen={() => onFolderSelect(f)}
                      onToggleExpand={() => toggleExpand(f)}
                      onToggleFavorite={() => toggleFavorite(f)}
                      onContextMenu={(e) => handleContextMenu(e, f)}
                      onFolderSelect={onFolderSelect}
                      lastFolder={lastFolder}
                    />
                  ))
                : <p className="px-2 py-4 text-[10px] text-[#4C4743]">Nenhum favorito ainda — marque uma pasta com ★</p>
            )}
          </div>
        </div>
      )}

      {/* Footer stats */}
      <div className="mt-auto px-4 py-3 border-t border-white/[0.06]">
        <p className="text-[11px] text-[#8F8883]">
          {tracks.length.toLocaleString("pt-BR")} faixas
        </p>
        <p className="text-[11px] text-[#605A55]">
          {(tracks.reduce((s, t) => s + t.file_size_bytes, 0) / 1024 / 1024 / 1024).toFixed(2)} GB
          {" · "}
          {(() => {
            const totalSecs = tracks.reduce((s, t) => s + (t.duration_secs ?? 0), 0);
            const h = Math.floor(totalSecs / 3600);
            const m = Math.floor((totalSecs % 3600) / 60);
            return h > 0 ? `${h}h ${m}min` : `${m} min`;
          })()}
        </p>
      </div>

      {/* Duplicate folder dialog */}
      {dupDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-[#1c1715] border border-white/10 rounded-xl p-6 w-80 shadow-2xl">
            <h3 className="text-sm font-semibold text-[#F5F5F4] mb-2">Pasta já existe</h3>
            <p className="text-xs text-[#8F8883] mb-5">
              <span className="text-[#C2BEBC] font-medium">"{dupDialog.name}"</span> já está na sua lista de pastas recentes. Deseja recarregá-la?
            </p>
            <div className="flex flex-col gap-2">
              <button
                className="w-full py-2 rounded-lg bg-[#D95340] hover:bg-[#E07364] text-white text-sm font-medium transition-colors"
                onClick={() => { onFolderSelect(dupDialog.path); setDupDialog(null); }}
              >
                Sim, recarregar
              </button>
              <button
                className="w-full py-2 rounded-lg bg-transparent hover:bg-white/5 text-[#756D67] text-sm transition-colors"
                onClick={() => setDupDialog(null)}
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Context Menu */}
      {contextMenu && (
        <div
          className="fixed z-50 bg-[#1c1715] border border-white/10 rounded-lg shadow-2xl py-1 min-w-[180px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            className="w-full px-3 py-1.5 text-left text-sm text-[#C2BEBC] hover:bg-white/8 flex items-center gap-2"
            onClick={() => { onFolderSelect(contextMenu.path); closeContextMenu(); }}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" className="opacity-60"><path d="M1 3A1.5 1.5 0 012.5 1.5h2.086a1 1 0 01.707.293L6 2.5H10A1.5 1.5 0 0111.5 4v5A1.5 1.5 0 0110 10.5H2A1.5 1.5 0 01.5 9V3z"/></svg>
            Abrir
          </button>
          <button
            className="w-full px-3 py-1.5 text-left text-sm text-[#C2BEBC] hover:bg-white/8 flex items-center gap-2"
            onClick={() => { toggleFavorite(contextMenu.path); closeContextMenu(); }}
          >
            <span className="text-[#D95340]">{isFavorite(contextMenu.path) ? "☆" : "★"}</span>
            {isFavorite(contextMenu.path) ? "Remover dos Favoritos" : "Adicionar aos Favoritos"}
          </button>
          {onAnalyzeBpmFolder && (
            <button
              className="w-full px-3 py-1.5 text-left text-sm text-[#C2BEBC] hover:bg-white/8 flex items-center gap-2"
              onClick={() => { onAnalyzeBpmFolder(contextMenu.path); closeContextMenu(); }}
            >
              <svg width="11" height="11" viewBox="0 0 11 11" fill="currentColor" className="opacity-60">
                <path d="M1 5.5a.5.5 0 01.5-.5h1a.5.5 0 010 1h-1a.5.5 0 01-.5-.5zm2-2a.5.5 0 01.5-.5h1a.5.5 0 010 1h-1a.5.5 0 01-.5-.5zm0 4a.5.5 0 01.5-.5h1a.5.5 0 010 1h-1a.5.5 0 01-.5-.5zm2-5a.5.5 0 01.5-.5h1a.5.5 0 010 1h-1a.5.5 0 01-.5-.5zm0 8a.5.5 0 01.5-.5h1a.5.5 0 010 1h-1a.5.5 0 01-.5-.5zm0-4a.5.5 0 01.5-.5h1a.5.5 0 010 1h-1a.5.5 0 01-.5-.5zm2-2a.5.5 0 01.5-.5h1a.5.5 0 010 1h-1a.5.5 0 01-.5-.5zm0 4a.5.5 0 01.5-.5h1a.5.5 0 010 1h-1a.5.5 0 01-.5-.5z"/>
              </svg>
              Analisar BPM da pasta
            </button>
          )}
          <div className="h-px bg-white/10 my-1" />
          <button
            className="w-full px-3 py-1.5 text-left text-sm text-[#D95340]/80 hover:bg-white/8 flex items-center gap-2"
            onClick={() => {
              const name = contextMenu.path.split(/[\\/]/).filter(Boolean).pop() ?? contextMenu.path;
              setDeleteDialog({ path: contextMenu.path, name });
              closeContextMenu();
            }}
          >
            <svg width="11" height="11" viewBox="0 0 11 11" fill="currentColor" className="opacity-70"><path d="M4 1h3a1 1 0 011 1v.5H2.5V2A1 1 0 014 1zM1 3h9l-.8 6.5A1 1 0 018.2 10H2.8a1 1 0 01-.997-.9L1 3z"/></svg>
            Remover…
          </button>
        </div>
      )}

      {/* Delete Dialog */}
      {deleteDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-[#1c1715] border border-white/10 rounded-xl p-6 w-80 shadow-2xl">
            <h3 className="text-sm font-semibold text-[#F5F5F4] mb-1">
              Remover "{deleteDialog.name}"
            </h3>
            {isScanning && deleteDialog.path === lastFolder && (
              <p className="text-[11px] text-[#D95340] mb-2 flex items-center gap-1.5">
                <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor"><path d="M5 1a4 4 0 100 8A4 4 0 005 1zm0 2.25a.5.5 0 01.5.5v2a.5.5 0 01-1 0v-2a.5.5 0 01.5-.5zm0 4.25a.625.625 0 110-1.25.625.625 0 010 1.25z"/></svg>
                Scan em andamento — será interrompido.
              </p>
            )}
            <p className="text-xs text-[#8F8883] mb-5">
              {deleteDialog.path === lastFolder ? "As faixas carregadas serão removidas da lista." : "Escolha o que deseja fazer com esta pasta."}
            </p>
            <div className="flex flex-col gap-2">
              <button
                className="w-full py-2 rounded-lg bg-red-600/80 hover:bg-red-600 text-white text-sm font-medium transition-colors"
                onClick={() => handleMoveToTrash(deleteDialog.path)}
              >
                Mover para a Lixeira
              </button>
              <button
                className="w-full py-2 rounded-lg bg-white/8 hover:bg-white/12 text-[#D95340] text-sm font-medium transition-colors"
                onClick={() => handleRemoveFromList(deleteDialog.path)}
              >
                Remover da Lista
              </button>
              <button
                className="w-full py-2 rounded-lg bg-transparent hover:bg-white/5 text-[#756D67] text-sm transition-colors"
                onClick={() => setDeleteDialog(null)}
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// MARK: - FolderRow

interface FolderRowProps {
  path: string;
  isSelected: boolean;
  isFavorite: boolean;
  isExpanded: boolean;
  subfolders: string[] | null;
  onOpen: () => void;
  onToggleExpand: () => void;
  onToggleFavorite?: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onFolderSelect: (path: string) => void;
  lastFolder: string | null;
}

function FolderRow({
  path, isSelected, isFavorite, isExpanded, subfolders,
  onOpen, onToggleExpand, onToggleFavorite, onContextMenu, onFolderSelect, lastFolder
}: FolderRowProps) {
  const name = path.split(/[\\/]/).filter(Boolean).pop() ?? path;
  const hasSubs = subfolders === null || subfolders.length > 0;

  return (
    <div>
      <div className="flex items-center group">
        {/* Chevron */}
        <button
          className="w-5 h-6 flex items-center justify-center shrink-0 text-[#4C4743] hover:text-[#8F8883] transition-colors"
          onClick={hasSubs ? onToggleExpand : undefined}
          style={{ visibility: hasSubs ? "visible" : "hidden" }}
        >
          <svg
            width="8" height="8" viewBox="0 0 8 8" fill="currentColor"
            style={{ transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 0.18s" }}
          >
            <path d="M2 1l4 3-4 3V1z" />
          </svg>
        </button>

        <button
          onClick={onOpen}
          onContextMenu={onContextMenu}
          className={`flex-1 flex items-center gap-1.5 px-1.5 py-1.5 rounded-md text-xs transition-colors text-left min-w-0
            ${isSelected
              ? "bg-[#D95340]/15 text-[#F5F5F4] border border-[#D95340]/20"
              : "text-[#8F8883] hover:text-[#C2BEBC] hover:bg-white/5"
            }`}
          title={path}
        >
          <svg width="11" height="11" viewBox="0 0 11 11" fill="currentColor" className="shrink-0 opacity-50"><path d="M1 2.5A1.5 1.5 0 012.5 1h1.586a1 1 0 01.707.293L5.5 2H9a1.5 1.5 0 011.5 1.5v5A1.5 1.5 0 019 10H2a1.5 1.5 0 01-1.5-1.5v-6z"/></svg>
          <span className="truncate flex-1">{name}</span>
        </button>
        {onToggleFavorite && (
          <button
            onClick={(e) => { e.stopPropagation(); onToggleFavorite(); }}
            title={isFavorite ? "Remover dos favoritos" : "Adicionar aos favoritos"}
            className={`shrink-0 w-5 h-6 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity ${
              isFavorite ? "text-[#D95340]" : "text-[#4C4743] hover:text-[#D95340]"
            }`}
          >
            <svg width="10" height="10" viewBox="0 0 12 12" fill={isFavorite ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round">
              <polygon points="6,1.2 7.5,4.5 11,4.9 8.5,7.3 9.2,10.8 6,9 2.8,10.8 3.5,7.3 1,4.9 4.5,4.5"/>
            </svg>
          </button>
        )}
      </div>

      {/* Subfolders */}
      {isExpanded && subfolders && subfolders.length > 0 && (
        <div className="pl-5">
          {subfolders.map((sub) => (
            <button
              key={sub}
              onClick={() => onFolderSelect(sub)}
              className={`w-full flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] transition-colors text-left truncate
                ${lastFolder === sub
                  ? "bg-[#D95340]/15 text-[#F5F5F4]"
                  : "text-[#8F8883] hover:text-[#C2BEBC] hover:bg-white/5"
                }`}
              title={sub}
            >
              <svg width="10" height="10" viewBox="0 0 11 11" fill="currentColor" className="shrink-0 opacity-40"><path d="M1 2.5A1.5 1.5 0 012.5 1h1.586a1 1 0 01.707.293L5.5 2H9a1.5 1.5 0 011.5 1.5v5A1.5 1.5 0 019 10H2a1.5 1.5 0 01-1.5-1.5v-6z"/></svg>
              {sub.split(/[\\/]/).filter(Boolean).pop()}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
