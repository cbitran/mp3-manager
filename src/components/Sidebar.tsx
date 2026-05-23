import { useState } from "react";
import { useAppStore } from "../store";
import { invoke } from "@tauri-apps/api/core";

interface SidebarProps {
  onFolderSelect: (folder: string) => void;
}

interface DeleteDialogState {
  path: string;
  name: string;
}

export default function Sidebar({ onFolderSelect }: SidebarProps) {
  const { tracks, favoriteFolders, recentFolders, lastFolder, toggleFavorite, removeRecentFolder } = useAppStore();

  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [subfolderMap, setSubfolderMap] = useState<Record<string, string[]>>({});
  const [deleteDialog, setDeleteDialog] = useState<DeleteDialogState | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; path: string } | null>(null);

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
    removeRecentFolder(path);
    if (isFavorite(path)) toggleFavorite(path);
    setDeleteDialog(null);
  };

  const handleContextMenu = (e: React.MouseEvent, path: string) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, path });
  };

  const closeContextMenu = () => setContextMenu(null);

  return (
    <div
      className="w-52 shrink-0 flex flex-col border-r border-white/[0.06] bg-[#17171c] overflow-y-auto"
      onClick={closeContextMenu}
    >
      {/* Pasta atual */}
      {lastFolder && (
        <div className="px-3 pt-3 pb-2">
          <p className="text-[10px] font-semibold text-gray-600 uppercase tracking-widest mb-1.5">
            Pasta atual
          </p>
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-gray-400 truncate flex-1" title={lastFolder}>
              📁 {lastFolder.split("/").pop()}
            </span>
            <button
              onClick={() => toggleFavorite(lastFolder)}
              title={isFavorite(lastFolder) ? "Remover dos favoritos" : "Adicionar aos favoritos"}
              className="shrink-0 text-sm hover:scale-110 transition-transform"
            >
              {isFavorite(lastFolder) ? "★" : "☆"}
            </button>
          </div>
        </div>
      )}

      {lastFolder && <div className="h-px bg-white/[0.06] mx-3 my-1" />}

      {/* Favoritos */}
      {favoriteFolders.length > 0 && (
        <div className="px-2 pt-2">
          <p className="px-2 mb-1 text-[10px] font-semibold text-gray-600 uppercase tracking-widest">
            Favoritos
          </p>
          {favoriteFolders.map((f) => (
            <FolderRow
              key={f}
              path={f}
              isSelected={lastFolder === f}
              isFavorite={isFavorite(f)}
              isExpanded={expandedFolders.has(f)}
              subfolders={subfolderMap[f] ?? null}
              onOpen={() => onFolderSelect(f)}
              onToggleExpand={() => toggleExpand(f)}
              onContextMenu={(e) => handleContextMenu(e, f)}
              onFolderSelect={onFolderSelect}
              lastFolder={lastFolder}
            />
          ))}
        </div>
      )}

      {/* Recentes */}
      {recentFolders.length > 0 && (
        <div className="px-2 pt-2">
          <p className="px-2 mb-1 text-[10px] font-semibold text-gray-600 uppercase tracking-widest">
            Recentes
          </p>
          {recentFolders.map((f) => (
            <FolderRow
              key={f}
              path={f}
              isSelected={lastFolder === f}
              isFavorite={isFavorite(f)}
              isExpanded={expandedFolders.has(f)}
              subfolders={subfolderMap[f] ?? null}
              onOpen={() => onFolderSelect(f)}
              onToggleExpand={() => toggleExpand(f)}
              onContextMenu={(e) => handleContextMenu(e, f)}
              onFolderSelect={onFolderSelect}
              lastFolder={lastFolder}
            />
          ))}
        </div>
      )}

      {/* Footer stats */}
      <div className="mt-auto px-4 py-3 border-t border-white/[0.06]">
        <p className="text-[11px] text-gray-600">
          {tracks.length.toLocaleString("pt-BR")} faixas
        </p>
        <p className="text-[11px] text-gray-700">
          {(tracks.reduce((s, t) => s + t.file_size_bytes, 0) / 1024 / 1024 / 1024).toFixed(2)} GB
        </p>
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <div
          className="fixed z-50 bg-[#222226] border border-white/10 rounded-lg shadow-2xl py-1 min-w-[180px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            className="w-full px-3 py-1.5 text-left text-sm text-gray-300 hover:bg-white/10"
            onClick={() => { onFolderSelect(contextMenu.path); closeContextMenu(); }}
          >
            📂 Abrir
          </button>
          <button
            className="w-full px-3 py-1.5 text-left text-sm text-gray-300 hover:bg-white/10"
            onClick={() => { toggleFavorite(contextMenu.path); closeContextMenu(); }}
          >
            {isFavorite(contextMenu.path) ? "☆ Remover dos Favoritos" : "★ Adicionar aos Favoritos"}
          </button>
          <div className="h-px bg-white/10 my-1" />
          <button
            className="w-full px-3 py-1.5 text-left text-sm text-red-400 hover:bg-white/10"
            onClick={() => {
              const name = contextMenu.path.split("/").pop() ?? contextMenu.path;
              setDeleteDialog({ path: contextMenu.path, name });
              closeContextMenu();
            }}
          >
            🗑 Remover…
          </button>
        </div>
      )}

      {/* Delete Dialog */}
      {deleteDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-[#222226] border border-white/10 rounded-xl p-6 w-80 shadow-2xl">
            <h3 className="text-sm font-semibold text-gray-100 mb-1">
              Remover "{deleteDialog.name}"
            </h3>
            <p className="text-xs text-gray-500 mb-5">Escolha o que deseja fazer com esta pasta.</p>
            <div className="flex flex-col gap-2">
              <button
                className="w-full py-2 rounded-lg bg-red-600/80 hover:bg-red-600 text-white text-sm font-medium transition-colors"
                onClick={() => handleMoveToTrash(deleteDialog.path)}
              >
                Mover para a Lixeira
              </button>
              <button
                className="w-full py-2 rounded-lg bg-white/10 hover:bg-white/15 text-red-400 text-sm font-medium transition-colors"
                onClick={() => handleRemoveFromList(deleteDialog.path)}
              >
                Remover da Lista
              </button>
              <button
                className="w-full py-2 rounded-lg bg-transparent hover:bg-white/5 text-gray-500 text-sm transition-colors"
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
  onContextMenu: (e: React.MouseEvent) => void;
  onFolderSelect: (path: string) => void;
  lastFolder: string | null;
}

function FolderRow({
  path, isSelected, isExpanded, subfolders,
  onOpen, onToggleExpand, onContextMenu, onFolderSelect, lastFolder
}: FolderRowProps) {
  const name = path.split("/").pop() ?? path;
  const hasSubs = subfolders === null || subfolders.length > 0;

  return (
    <div>
      <div className="flex items-center group">
        {/* Chevron */}
        <button
          className="w-5 h-6 flex items-center justify-center shrink-0 text-gray-700 hover:text-gray-400 transition-colors"
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
          className={`flex-1 flex items-center gap-1.5 px-1.5 py-1.5 rounded-md text-xs transition-colors text-left truncate
            ${isSelected ? "bg-white/10 text-gray-200" : "text-gray-500 hover:text-gray-300 hover:bg-white/5"}`}
          title={path}
        >
          📁 {name}
        </button>
      </div>

      {/* Subfolders */}
      {isExpanded && subfolders && subfolders.length > 0 && (
        <div className="pl-5">
          {subfolders.map((sub) => (
            <button
              key={sub}
              onClick={() => onFolderSelect(sub)}
              className={`w-full flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] transition-colors text-left truncate
                ${lastFolder === sub ? "bg-white/10 text-gray-200" : "text-gray-600 hover:text-gray-300 hover:bg-white/5"}`}
              title={sub}
            >
              📁 {sub.split("/").pop()}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
