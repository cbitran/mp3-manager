import React, { useRef, useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore, type Playlist } from "../store";
import { invoke } from "@tauri-apps/api/core";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { toast } from "./Toast";
import PlaylistSettingsModal from "./PlaylistSettingsModal";
import { applyPlaylistRules } from "../lib/playlistRules";
import { activeFolderDragPath, setActiveFolderDragPath, activeFileDragPaths, activeFileDragName, clearActiveFileDrag } from "../lib/folderDrag";

const IS_WIN = navigator.platform.toLowerCase().startsWith("win") ||
               navigator.userAgent.toLowerCase().includes("windows");
const FILE_MANAGER = IS_WIN ? "Explorer" : "Finder";

interface SidebarProps {
  onFolderSelect: (folder: string) => void;
  onFolderDropWithChoice?: (folder: string) => void;
  onFilesDropWithChoice?: (paths: string[], name: string) => void;
  onBrowse?: (path: string) => void;
  onAnalyzeBpmFolder?: (folderPath: string) => void;
  onEnrichFolder?: (folderPath: string) => void;
  onExportPlaylist?: (pl: Playlist) => void;
  onLoadAllFolders?: () => void;
  onNewPlaylist?: () => void;
  onNewSubPlaylist?: (parentId: string) => void;
  onNewLibrary?: () => void;
  onFolderClear?: () => void; // limpa análise/timers ao remover pasta
  scanProgress?: number | null; // 0–1 determinado, null = indeterminado
  onNavigate?: () => void; // fecha FolderBrowser ao mudar de aba/playlist
}

interface DeleteDialogState {
  path: string;
  name: string;
}

export default function Sidebar({ onFolderSelect, onFolderDropWithChoice, onFilesDropWithChoice, onBrowse, onAnalyzeBpmFolder, onEnrichFolder, onExportPlaylist, onLoadAllFolders, onNewPlaylist, onNewSubPlaylist, onNewLibrary, onFolderClear, scanProgress, onNavigate }: SidebarProps) {
  const { t } = useTranslation();
  const { tracks, favoriteFolders, recentFolders, lastFolder, toggleFavorite, removeRecentFolder, setTracks, setLastFolder, isScanning, setScanning } = useAppStore();
  const updateTrack = useAppStore((s) => s.updateTrack);
  const setPlayerTrack = useAppStore((s) => s.setPlayerTrack);
  const clearSelection = useAppStore((s) => s.clearSelection);
  const playlists        = useAppStore((s) => s.playlists);
  const activePlaylistId = useAppStore((s) => s.activePlaylistId);
  const fileSessionName  = useAppStore((s) => s.fileSessionName);
  const setActivePlaylistId = useAppStore((s) => s.setActivePlaylistId);
  const deletePlaylist = useAppStore((s) => s.deletePlaylist);

  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [subfolderMap, setSubfolderMap] = useState<Record<string, string[]>>({});
  const [expandedPlaylists, setExpandedPlaylists] = useState<Set<string>>(new Set());
  const autoExpandTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Drag de playlist para reparentar ─────────────────────────────
  const plDragRef = useRef<string | null>(null);
  const plDropTargetRef = useRef<string | null>(null);
  const [plDragging, setPlDragging] = useState<string | null>(null);
  const [plDropTarget, setPlDropTarget] = useState<string | null>(null);

  const startPlDrag = (id: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    plDragRef.current = id;
    setPlDragging(id);
    document.body.style.cursor = "grabbing";

    const onMove = (me: MouseEvent) => {
      const el = document.elementFromPoint(me.clientX, me.clientY);
      const row = el?.closest("[data-pl-id]") as HTMLElement | null;
      const targetId = row?.dataset.plId ?? null;
      const pls = useAppStore.getState().playlists;
      const dragId = plDragRef.current!;
      const isDesc = (cid: string, aid: string): boolean => {
        const kids = pls.filter((p) => p.parentId === aid);
        return kids.some((k) => k.id === cid || isDesc(cid, k.id));
      };
      const valid = targetId && targetId !== dragId && !isDesc(targetId, dragId);
      const next = valid ? targetId : null;
      if (next !== plDropTargetRef.current) {
        plDropTargetRef.current = next;
        setPlDropTarget(next);
      }
    };

    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      const dragId = plDragRef.current;
      const targetId = plDropTargetRef.current;
      if (dragId && targetId) {
        useAppStore.getState().updatePlaylist(dragId, { parentId: targetId });
        setExpandedPlaylists((prev) => { const next = new Set(prev); next.add(targetId); return next; });
      }
      plDragRef.current = null;
      plDropTargetRef.current = null;
      setPlDragging(null);
      setPlDropTarget(null);
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };
  const [deleteDialog, setDeleteDialog] = useState<DeleteDialogState | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; path: string } | null>(null);
  const [sidebarTab, setSidebarTab] = useState<"recent" | "favorites" | "playlists">("recent");
  const [librarySort, setLibrarySort] = useState<"recent" | "alpha">("recent");
  const [playlistSort, setPlaylistSort] = useState<"recent" | "alpha">("recent");
  const [syncing, setSyncing] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isDragFolderInternal, setIsDragFolderInternal] = useState(false);
  const [dupDialog, setDupDialog] = useState<{ path: string; name: string } | null>(null);
  const [volumes, setVolumes] = useState<{ path: string; name: string }[]>([]);
  const [playlistCtx, setPlaylistCtx] = useState<{ x: number; y: number; pl: Playlist } | null>(null);
  const [confirmDeletePlaylist, setConfirmDeletePlaylist] = useState<{ id: string; name: string } | null>(null);

  // ── Seleção múltipla por aba ──────────────────────────────────────────
  const [selLibs, setSelLibs] = useState<Set<string>>(new Set());
  const [selFavs, setSelFavs] = useState<Set<string>>(new Set());
  const [selPls,  setSelPls]  = useState<Set<string>>(new Set());

  const toggleSel = (_: Set<string>, setFn: React.Dispatch<React.SetStateAction<Set<string>>>, id: string) => {
    setFn((prev) => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  };
  const clearSel = () => { setSelLibs(new Set()); setSelFavs(new Set()); setSelPls(new Set()); };
  const [settingsPlaylist, setSettingsPlaylist] = useState<Playlist | null>(null);
  const dragState = useAppStore((s) => s.dragState);
  const setDragState = useAppStore((s) => s.setDragState);
  const [devicesExpanded, setDevicesExpanded] = useState(true);
  const dragCounterRef = useRef(0);
  const hoveredFolderRef = useRef<{ path: string; name: string } | null>(null);
  const sidebarTabRef = useRef(sidebarTab);
  useEffect(() => { sidebarTabRef.current = sidebarTab; }, [sidebarTab]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      if ((e.target as HTMLElement).tagName === "INPUT" || (e.target as HTMLElement).tagName === "TEXTAREA") return;

      // Folder hover → delete folder
      if (hoveredFolderRef.current) {
        e.preventDefault();
        setDeleteDialog(hoveredFolderRef.current);
        return;
      }

      // Playlists tab + playlist ativa + sem faixas selecionadas → delete playlist
      if (sidebarTabRef.current === "playlists") {
        const st = useAppStore.getState();
        if (st.activePlaylistId && st.selectedIds.size === 0) {
          const pl = st.playlists.find((p) => p.id === st.activePlaylistId);
          if (pl) {
            e.preventDefault();
            setConfirmDeletePlaylist({ id: pl.id, name: pl.name });
          }
        }
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (dragState.isDragging) setSidebarTab("playlists");
    else if (autoExpandTimerRef.current) { clearTimeout(autoExpandTimerRef.current); autoExpandTimerRef.current = null; }
  }, [dragState.isDragging, playlists.length]);

  // Contagem de faixas por pasta, calculada a partir das faixas atualmente carregadas
  const folderTrackCount = (folderPath: string) => {
    const prefix = folderPath.endsWith("/") || folderPath.endsWith("\\") ? folderPath : folderPath + "/";
    return tracks.filter((t) => t.path.startsWith(prefix)).length;
  };

  const prevVolumesRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const refresh = () =>
      invoke<{ path: string; name: string }[]>("list_volumes")
        .then((vols) => {
          const newPaths = new Set(vols.map((v) => v.path));
          // Detecta volumes novos que não estavam antes
          for (const v of vols) {
            if (prevVolumesRef.current.size > 0 && !prevVolumesRef.current.has(v.path)) {
              toast(`Dispositivo "${v.name}" conectado — clique para adicionar à biblioteca`, "info");
            }
          }
          prevVolumesRef.current = newPaths;
          setVolumes(vols);
        })
        .catch(() => {});
    refresh();
    const id = setInterval(refresh, 4000);
    return () => clearInterval(id);
  }, []);

  const clearFolderTracks = (path: string) => {
    // Cancela qualquer scan/análise em curso (independente de qual pasta)
    invoke("cancel_current_scan").catch(() => {});
    onFolderClear?.();
    if (path === lastFolder) {
      setScanning(false);
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

  const handleSyncPlaylists = async () => {
    if (syncing || playlists.length === 0) return;
    setSyncing(true);
    try {
      // Coleta todos os paths únicos de todas as playlists
      const allPaths = [...new Set(playlists.flatMap((p) => p.trackPaths))];
      const missing: string[] = allPaths.length > 0
        ? await invoke<string[]>("check_paths_exist", { paths: allPaths }).catch(() => [])
        : [];

      const missingSet = new Set(missing);
      const playlistsWithMissing = playlists.filter((p) =>
        p.trackPaths.some((tp) => missingSet.has(tp))
      );
      const playlistsWithPending = playlists.filter((p) => p.pendingRulesApply);

      if (missing.length === 0 && playlistsWithPending.length === 0) {
        toast(`${playlists.length} playlist${playlists.length > 1 ? "s" : ""} verificada${playlists.length > 1 ? "s" : ""} — tudo certo`, "success");
        return;
      }

      const parts: string[] = [];
      if (missing.length > 0)
        parts.push(`${missing.length} arquivo${missing.length > 1 ? "s" : ""} não encontrado${missing.length > 1 ? "s" : ""} em ${playlistsWithMissing.length} playlist${playlistsWithMissing.length > 1 ? "s" : ""}`);
      if (playlistsWithPending.length > 0)
        parts.push(`${playlistsWithPending.length} playlist${playlistsWithPending.length > 1 ? "s com regras" : " com regra"} pendente${playlistsWithPending.length > 1 ? "s" : ""}`);
      toast(parts.join(" · "), "info");
    } finally {
      setSyncing(false);
    }
  };

  const handleRemoveFromList = (path: string) => {
    playlists
      .filter((p) => p.trackPaths.length > 0 && p.trackPaths.every((tp) => tp.startsWith(path)))
      .forEach((p) => deletePlaylist(p.id));
    clearFolderTracks(path);
    removeRecentFolder(path);
    if (isFavorite(path)) toggleFavorite(path);
    setDeleteDialog(null);
  };

  const handleDeleteSelected = () => {
    if (sidebarTab === "recent") {
      selLibs.forEach((path) => {
        playlists
          .filter((p) => p.trackPaths.length > 0 && p.trackPaths.every((tp) => tp.startsWith(path)))
          .forEach((p) => deletePlaylist(p.id));
        clearFolderTracks(path);
        removeRecentFolder(path);
        if (isFavorite(path)) toggleFavorite(path);
      });
      setSelLibs(new Set());
    } else if (sidebarTab === "favorites") {
      selFavs.forEach((path) => toggleFavorite(path));
      setSelFavs(new Set());
    } else if (sidebarTab === "playlists") {
      selPls.forEach((id) => deletePlaylist(id));
      setSelPls(new Set());
    }
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
    setIsDragFolderInternal(
      activeFolderDragPath !== null ||
      activeFileDragPaths !== null ||
      e.dataTransfer.types.includes("text/folder-path")
    );
  }

  function handleDragLeave() {
    dragCounterRef.current--;
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0;
      setIsDragOver(false);
      setIsDragFolderInternal(false);
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    dragCounterRef.current = 0;
    setIsDragOver(false);
    setIsDragFolderInternal(false);

    // Drag de ARQUIVOS vindo do FolderBrowser (Dispositivos).
    if (activeFileDragPaths && activeFileDragPaths.length > 0) {
      const paths = [...activeFileDragPaths];
      const name  = activeFileDragName;
      clearActiveFileDrag();
      if (onFilesDropWithChoice) onFilesDropWithChoice(paths, name);
      return;
    }

    // Drag interno de PASTA vinda do FolderBrowser (Dispositivos).
    // Usa variável de módulo (mais confiável que dataTransfer no WebKit/Tauri).
    const folderPath = activeFolderDragPath ?? e.dataTransfer.getData("text/folder-path");
    setActiveFolderDragPath(null);
    if (folderPath) {
      if (onFolderDropWithChoice) {
        onFolderDropWithChoice(folderPath);
      } else {
        setSidebarTab("recent");
        if (recentFolders.includes(folderPath)) {
          const name = folderPath.split(/[\\/]/).filter(Boolean).pop() ?? folderPath;
          setDupDialog({ path: folderPath, name });
        } else {
          onFolderSelect(folderPath);
        }
      }
      return;
    }

    // Drag externo de pasta/arquivo vindo do Finder/Explorer
    const files = e.dataTransfer.files;
    if (files.length === 0) return;
    // @ts-expect-error — Tauri expõe .path em File
    const droppedPath: string = files[0].path;
    if (!droppedPath) return;
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
            {activeFileDragPaths !== null
              ? "Soltar para adicionar faixas"
              : isDragFolderInternal
                ? "Soltar para adicionar à biblioteca"
                : t("toolbar.dropToAddFolder")}
          </span>
        </div>
      )}

      {/* Abas Recentes / Favoritos / Playlists */}
      <div className="flex flex-col flex-1 overflow-hidden">
        {/* Tab bar */}
        <div className="flex items-center px-2 pt-2 gap-0 border-b border-white/[0.05]" data-help="sidebar-tabs">
          {([
            { id: "recent",    label: t("sidebar.libraries"), count: recentFolders.length },
            { id: "favorites", label: t("sidebar.favorites"), count: favoriteFolders.length },
            { id: "playlists", label: t("sidebar.playlists"), count: playlists.length },
          ] as const).map((tab) => {
            const active = sidebarTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => {
                  setSidebarTab(tab.id);
                  if (tab.id !== "playlists") setActivePlaylistId(null);
                  clearSel();
                  onNavigate?.();
                }}
                className={`flex items-center gap-1 px-1.5 pb-2 text-[10px] font-semibold transition-colors border-b-2 -mb-px ${
                  active
                    ? "text-[#F5F5F4] border-[#D95340]"
                    : "text-[#605A55] border-transparent hover:text-[#8F8883]"
                }`}
              >
                {tab.label}
                {tab.count > 0 && (
                  <span className={`text-[9px] font-mono tabular-nums px-1 py-px rounded-sm ${
                    active ? "bg-[#D95340]/20 text-[#D95340]" : "bg-white/[0.05] text-[#605A55]"
                  }`}>
                    {tab.count}
                  </span>
                )}
              </button>
            );
          })}
          {sidebarTab === "recent" && onNewLibrary && (
            <button
              onClick={onNewLibrary}
              title="Nova biblioteca"
              className="ml-auto mb-1.5 p-1 rounded-md hover:bg-white/[0.08] text-[#605A55] hover:text-[#C2BEBC] transition-colors flex-shrink-0"
            >
              <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                <path d="M5.5 1v9M1 5.5h9"/>
              </svg>
            </button>
          )}
          {sidebarTab === "playlists" && (
            <div className="ml-auto mb-1.5 flex items-center gap-0.5">
              <button
                onClick={handleSyncPlaylists}
                disabled={syncing}
                title="Verificar playlists"
                className="ml-0.5 p-1 rounded-md hover:bg-white/[0.08] text-[#605A55] hover:text-[#C2BEBC] transition-colors disabled:opacity-40"
              >
                <svg
                  width="11" height="11" viewBox="0 0 11 11" fill="none"
                  stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"
                  className={syncing ? "animate-spin" : ""}
                >
                  <path d="M9.5 2A4.7 4.7 0 005.5 1 4.5 4.5 0 001 5.5"/>
                  <path d="M1.5 9A4.7 4.7 0 005.5 10 4.5 4.5 0 0010 5.5"/>
                  <path d="M9.5 2v2.5H7M1.5 9v-2.5H4"/>
                </svg>
              </button>
            </div>
          )}
          {sidebarTab === "playlists" && playlists.length <= 1 && onNewPlaylist && (
            <button
              onClick={onNewPlaylist}
              title="Nova playlist"
              className="ml-auto mb-1.5 p-1 rounded-md hover:bg-white/[0.08] text-[#605A55] hover:text-[#C2BEBC] transition-colors flex-shrink-0"
            >
              <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                <path d="M5.5 1v9M1 5.5h9"/>
              </svg>
            </button>
          )}
        </div>

        {/* Botão "Todos" — visão unificada de toda a biblioteca */}
        {onLoadAllFolders && recentFolders.length > 1 && (
          <button
            onClick={onLoadAllFolders}
            className="mx-2 mt-2 mb-1 flex items-center gap-1.5 px-2 py-1.5 rounded-md w-full text-left transition-colors hover:bg-white/[0.05]"
            style={{ color: "var(--c-t4)" }}
          >
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 opacity-60">
              <rect x="1" y="1" width="4" height="4" rx="0.8"/><rect x="7" y="1" width="4" height="4" rx="0.8"/>
              <rect x="1" y="7" width="4" height="4" rx="0.8"/><rect x="7" y="7" width="4" height="4" rx="0.8"/>
            </svg>
            <span className="text-[11px]">Toda a biblioteca</span>
            <span className="ml-auto text-[9px] font-mono text-[#605A55]">{tracks.length > 0 && !lastFolder ? tracks.length : ""}</span>
          </button>
        )}

        {/* Sub-linha de sort — visível sempre na aba ativa */}
        {(sidebarTab === "recent" || sidebarTab === "playlists") && (
          <div className="flex items-center gap-1 px-3 py-1 border-b border-white/[0.04]">
            <span className="text-[9px] text-[#4C4743] uppercase tracking-widest font-bold mr-1">
              {sidebarTab === "recent" ? "Ordem" : "Ordem"}
            </span>
            <button
              onClick={() => sidebarTab === "recent" ? setLibrarySort("recent") : setPlaylistSort("recent")}
              className={`px-2 py-0.5 rounded text-[10px] font-semibold transition-colors ${
                (sidebarTab === "recent" ? librarySort : playlistSort) === "recent"
                  ? "text-[#D95340] bg-[#D95340]/10"
                  : "text-[#605A55] hover:text-[#8F8883]"
              }`}
            >
              Recente
            </button>
            <button
              onClick={() => sidebarTab === "recent" ? setLibrarySort("alpha") : setPlaylistSort("alpha")}
              className={`px-2 py-0.5 rounded text-[10px] font-semibold transition-colors ${
                (sidebarTab === "recent" ? librarySort : playlistSort) === "alpha"
                  ? "text-[#D95340] bg-[#D95340]/10"
                  : "text-[#605A55] hover:text-[#8F8883]"
              }`}
            >
              A–Z
            </button>
          </div>
        )}

        {/* ── Barra de seleção múltipla ─────────────────────────────────── */}
        {(() => {
          const sel = sidebarTab === "recent" ? selLibs : sidebarTab === "favorites" ? selFavs : selPls;
          const allItems = sidebarTab === "recent"
            ? recentFolders
            : sidebarTab === "favorites"
              ? favoriteFolders
              : playlists.map((p) => p.id);
          const allSelected = allItems.length > 0 && allItems.every((id) => sel.has(id));

          if (allItems.length === 0) return null;

          return (
            <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-white/[0.04]">
              {/* Checkbox selecionar todos */}
              <button
                onClick={() => {
                  if (allSelected) {
                    if (sidebarTab === "recent") setSelLibs(new Set());
                    else if (sidebarTab === "favorites") setSelFavs(new Set());
                    else setSelPls(new Set());
                  } else {
                    const all = new Set(allItems);
                    if (sidebarTab === "recent") setSelLibs(all);
                    else if (sidebarTab === "favorites") setSelFavs(all);
                    else setSelPls(new Set(allItems));
                  }
                }}
                className="flex items-center gap-1.5 text-[10px] font-semibold transition-colors"
                style={{ color: sel.size > 0 ? "#D95340" : "var(--c-t6)" }}
              >
                <span
                  className="flex items-center justify-center rounded"
                  style={{
                    width: 14, height: 14, flexShrink: 0,
                    background: allSelected ? "#D95340" : sel.size > 0 ? "rgba(217,83,64,0.15)" : "var(--surface-row)",
                    border: `1.5px solid ${allSelected ? "#D95340" : sel.size > 0 ? "rgba(217,83,64,0.5)" : "var(--border-inactive)"}`,
                  }}
                >
                  {allSelected && (
                    <svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="1.5 4 3 5.5 6.5 2"/>
                    </svg>
                  )}
                  {!allSelected && sel.size > 0 && (
                    <svg width="8" height="2" viewBox="0 0 8 2" fill="none" stroke="#D95340" strokeWidth="1.8" strokeLinecap="round">
                      <line x1="1" y1="1" x2="7" y2="1"/>
                    </svg>
                  )}
                </span>
                {sel.size > 0 ? `${sel.size} selecionado${sel.size > 1 ? "s" : ""}` : "Selecionar"}
              </button>

              {sel.size > 0 && (
                <>
                  <button
                    onClick={clearSel}
                    className="text-[10px] text-[#605A55] hover:text-[#8F8883] transition-colors"
                  >
                    Limpar
                  </button>
                  <button
                    onClick={handleDeleteSelected}
                    className="ml-auto flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold transition-colors"
                    style={{ background: "rgba(217,83,64,0.12)", color: "#D95340" }}
                  >
                    <svg width="9" height="10" viewBox="0 0 9 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M1.5 3h6M3 3V1.5h3V3M2.5 3l.5 5h3l.5-5"/>
                    </svg>
                    Remover ({sel.size})
                  </button>
                </>
              )}
            </div>
          );
        })()}

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto no-scrollbar px-2 pt-2">
          {sidebarTab === "recent" && (
            <>
            {/* Sessão de arquivos arrastados — entrada virtual sem pasta */}
            {fileSessionName && !lastFolder && (
              <div className="flex items-center gap-2 px-2 py-1.5 rounded-md mb-0.5 bg-[#D95340]/10 border border-[#D95340]/20">
                <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="#D95340" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 opacity-80">
                  <path d="M1 2.5A1.5 1.5 0 012.5 1h1.586a1 1 0 01.707.293L5.5 2H9a1.5 1.5 0 011.5 1.5v5A1.5 1.5 0 019 10H2a1.5 1.5 0 01-1.5-1.5v-6z"/>
                  <path d="M4.5 5.5h2M5.5 4.5v2"/>
                </svg>
                <span className="flex-1 text-[11px] text-[#F5F5F4] truncate">{fileSessionName}</span>
                <span className="text-[9px] font-mono text-[#D95340]/60">{tracks.length}</span>
              </div>
            )}
            {recentFolders.length > 0
              ? (librarySort === "alpha"
                  ? [...recentFolders].sort((a, b) => {
                      const na = a.split(/[\\/]/).filter(Boolean).pop() ?? a;
                      const nb = b.split(/[\\/]/).filter(Boolean).pop() ?? b;
                      return na.localeCompare(nb);
                    })
                  : recentFolders
                ).map((f) => {
                  const name = f.split(/[\\/]/).filter(Boolean).pop() ?? f;
                  return (
                    <div key={f} className="flex items-center gap-1 group/selrow"
                      onMouseEnter={() => { hoveredFolderRef.current = { path: f, name }; }}
                      onMouseLeave={() => { hoveredFolderRef.current = null; }}
                    >
                      {/* Checkbox de seleção */}
                      <button
                        onClick={(e) => { e.stopPropagation(); toggleSel(selLibs, setSelLibs, f); }}
                        className="shrink-0 flex items-center justify-center rounded transition-all"
                        style={{
                          width: 14, height: 14, marginLeft: 2,
                          opacity: selLibs.has(f) ? 1 : 0,
                          background: selLibs.has(f) ? "#D95340" : "var(--surface-row)",
                          border: `1.5px solid ${selLibs.has(f) ? "#D95340" : "var(--border-inactive)"}`,
                        }}
                        onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.opacity = "1"; }}
                        onMouseLeave={(e) => { if (!selLibs.has(f)) (e.currentTarget as HTMLButtonElement).style.opacity = "0"; }}
                      >
                        {selLibs.has(f) && (
                          <svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="1.5 4 3 5.5 6.5 2"/>
                          </svg>
                        )}
                      </button>
                      <div className="flex-1 min-w-0">
                        <FolderRow
                          path={f}
                          isSelected={lastFolder === f}
                          isFavorite={isFavorite(f)}
                          isExpanded={expandedFolders.has(f)}
                          subfolders={subfolderMap[f] ?? null}
                          trackCount={folderTrackCount(f)}
                          onOpen={() => onFolderSelect(f)}
                          onToggleExpand={() => toggleExpand(f)}
                          onToggleExpandPath={toggleExpand}
                          onToggleFavorite={() => toggleFavorite(f)}
                          onContextMenu={(e) => handleContextMenu(e, f)}
                          onFolderSelect={onFolderSelect}
                          lastFolder={lastFolder}
                          tracks={tracks}
                          expandedFolders={expandedFolders}
                          subfolderMap={subfolderMap}
                          activeScanProgress={lastFolder === f && isScanning ? scanProgress : undefined}
                        />
                      </div>
                    </div>
                  );
                })
              : <p className="px-2 py-4 text-[10px] text-[#4C4743]">Nenhuma biblioteca adicionada</p>
            }
            {onNewLibrary && (
              <button
                onClick={onNewLibrary}
                className="w-full mt-2 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border border-dashed border-white/[0.07] text-[#605A55] hover:text-[#8F8883] hover:border-white/[0.14] hover:bg-white/[0.03] transition-all"
              >
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                  <path d="M5 1v8M1 5h8"/>
                </svg>
                <span className="text-[11px]">Nova biblioteca</span>
              </button>
            )}
            </>
          )}
          {sidebarTab === "favorites" && (
            favoriteFolders.length > 0
              ? favoriteFolders.map((f) => {
                  const name = f.split(/[\\/]/).filter(Boolean).pop() ?? f;
                  return (
                    <div key={f} className="flex items-center gap-1 group/selrow"
                      onMouseEnter={() => { hoveredFolderRef.current = { path: f, name }; }}
                      onMouseLeave={() => { hoveredFolderRef.current = null; }}
                    >
                      <button
                        onClick={(e) => { e.stopPropagation(); toggleSel(selFavs, setSelFavs, f); }}
                        className="shrink-0 flex items-center justify-center rounded transition-all"
                        style={{
                          width: 14, height: 14, marginLeft: 2,
                          opacity: selFavs.has(f) ? 1 : 0,
                          background: selFavs.has(f) ? "#D95340" : "var(--surface-row)",
                          border: `1.5px solid ${selFavs.has(f) ? "#D95340" : "var(--border-inactive)"}`,
                        }}
                        onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.opacity = "1"; }}
                        onMouseLeave={(e) => { if (!selFavs.has(f)) (e.currentTarget as HTMLButtonElement).style.opacity = "0"; }}
                      >
                        {selFavs.has(f) && (
                          <svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="1.5 4 3 5.5 6.5 2"/>
                          </svg>
                        )}
                      </button>
                      <div className="flex-1 min-w-0">
                        <FolderRow
                          path={f}
                          isSelected={lastFolder === f}
                          isFavorite={isFavorite(f)}
                          isExpanded={expandedFolders.has(f)}
                          subfolders={subfolderMap[f] ?? null}
                          trackCount={folderTrackCount(f)}
                          onOpen={() => onFolderSelect(f)}
                          onToggleExpand={() => toggleExpand(f)}
                          onToggleExpandPath={toggleExpand}
                          onToggleFavorite={() => toggleFavorite(f)}
                          onContextMenu={(e) => handleContextMenu(e, f)}
                          onFolderSelect={onFolderSelect}
                          lastFolder={lastFolder}
                          tracks={tracks}
                          expandedFolders={expandedFolders}
                          subfolderMap={subfolderMap}
                          activeScanProgress={lastFolder === f && isScanning ? scanProgress : undefined}
                        />
                      </div>
                    </div>
                  );
                })
              : <p className="px-2 py-4 text-[10px] text-[#4C4743]">{t("sidebar.noFavorites")}</p>
          )}
          {sidebarTab === "playlists" && (
            <div data-help="playlists-section">
              {(() => {
                // Conta faixas únicas de uma playlist incluindo todos os descendentes
                const countAll = (id: string): number => {
                  const pl = playlists.find((p) => p.id === id);
                  if (!pl) return 0;
                  const children = playlists.filter((p) => p.parentId === id);
                  const childPaths = new Set(children.flatMap((c) => {
                    const recurse = (cid: string): string[] => {
                      const cp = playlists.find((p) => p.id === cid);
                      const cc = playlists.filter((p) => p.parentId === cid);
                      return [...(cp?.trackPaths ?? []), ...cc.flatMap((x) => recurse(x.id))];
                    };
                    return recurse(c.id);
                  }));
                  return new Set([...pl.trackPaths, ...childPaths]).size;
                };

                const sortFn = playlistSort === "alpha"
                  ? (a: Playlist, b: Playlist) => a.name.localeCompare(b.name)
                  : (a: Playlist, b: Playlist) => b.updatedAt - a.updatedAt;

                // Renderiza uma playlist e seus filhos recursivamente
                const renderPl = (pl: Playlist, depth = 0): React.ReactNode => {
                  const children = [...playlists]
                    .filter((p) => p.parentId === pl.id)
                    .sort(sortFn);
                  const hasChildren = children.length > 0;
                  const isExpanded = expandedPlaylists.has(pl.id);
                  const totalCount = countAll(pl.id);

                  const isPlDropHere = plDropTarget === pl.id;
                  const INDENT = 18; // px por nível — mais largo que antes
                  return (
                    <div key={pl.id}>
                      <div style={{ paddingLeft: depth * INDENT }} className="relative">
                        {/* Linha vertical conectora (estilo Serato) */}
                        {depth > 0 && (
                          <>
                            {/* linha vertical do pai */}
                            <span className="absolute top-0 bottom-0"
                              style={{ left: (depth - 1) * INDENT + 8, width: "1px", background: "var(--tree-line)" }} />
                            {/* gancho horizontal → item */}
                            <span className="absolute"
                              style={{ left: (depth - 1) * INDENT + 8, top: "50%", width: 8, height: "1px", background: "var(--tree-line)" }} />
                          </>
                        )}
                        <div className="flex items-center gap-1 group/plrow" data-pl-id={pl.id}>
                          {/* Checkbox de seleção */}
                          <button
                            onClick={(e) => { e.stopPropagation(); toggleSel(selPls, setSelPls, pl.id); }}
                            className="shrink-0 flex items-center justify-center rounded transition-all"
                            style={{
                              width: 13, height: 13,
                              opacity: selPls.has(pl.id) ? 1 : 0,
                              background: selPls.has(pl.id) ? "#D95340" : "var(--surface-row)",
                              border: `1.5px solid ${selPls.has(pl.id) ? "#D95340" : "var(--border-inactive)"}`,
                            }}
                            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.opacity = "1"; }}
                            onMouseLeave={(e) => { if (!selPls.has(pl.id)) (e.currentTarget as HTMLButtonElement).style.opacity = "0"; }}
                          >
                            {selPls.has(pl.id) && (
                              <svg width="7" height="7" viewBox="0 0 8 8" fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="1.5 4 3 5.5 6.5 2"/>
                              </svg>
                            )}
                          </button>
                          {/* Drag handle — sempre visível em hover */}
                          {!dragState.isDragging && (
                            <button
                              className="shrink-0 w-4 h-4 flex items-center justify-center opacity-0 group-hover/plrow:opacity-100 transition-opacity cursor-grab active:cursor-grabbing"
                              style={{ color: "var(--tree-chevron)" }}
                              onMouseDown={(e) => startPlDrag(pl.id, e)}
                              title="Arrastar para aninhar em outra playlist"
                            >
                              <svg width="6" height="9" viewBox="0 0 6 9" fill="currentColor">
                                <circle cx="1.5" cy="1.5" r="1"/><circle cx="4.5" cy="1.5" r="1"/>
                                <circle cx="1.5" cy="4.5" r="1"/><circle cx="4.5" cy="4.5" r="1"/>
                                <circle cx="1.5" cy="7.5" r="1"/><circle cx="4.5" cy="7.5" r="1"/>
                              </svg>
                            </button>
                          )}
                          {hasChildren && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setExpandedPlaylists((prev) => {
                                  const next = new Set(prev);
                                  next.has(pl.id) ? next.delete(pl.id) : next.add(pl.id);
                                  return next;
                                });
                              }}
                              className="shrink-0 w-4 h-4 flex items-center justify-center text-[#605A55] hover:text-[#C2BEBC] transition-colors"
                            >
                              <svg width="7" height="7" viewBox="0 0 7 7" fill="currentColor"
                                style={{ transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 0.15s" }}>
                                <path d="M2 1l3 2.5L2 6V1z"/>
                              </svg>
                            </button>
                          )}
                          <div
                            className={hasChildren || !dragState.isDragging ? "flex-1 min-w-0" : "flex-1 min-w-0 pl-4"}
                            style={isPlDropHere ? { borderRadius: "6px", outline: "1.5px solid #D95340", outlineOffset: "1px" } : {}}
                          >
                            <PlaylistRow
                              pl={{ ...pl, trackPaths: pl.trackPaths }}
                              isActive={activePlaylistId === pl.id}
                              onOpen={() => { if (!plDragging) { setActivePlaylistId(pl.id); onNavigate?.(); } }}
                              onContextMenu={(e) => { e.preventDefault(); setPlaylistCtx({ x: e.clientX, y: e.clientY, pl }); }}
                              isDragging={dragState.isDragging}
                              isHoveredDrop={dragState.isDragging && dragState.hoveredPlaylistId === pl.id}
                              onDragEnter={() => {
                                setDragState({ hoveredPlaylistId: pl.id, hoveringNewPlaylist: false });
                                if (hasChildren && !expandedPlaylists.has(pl.id)) {
                                  if (autoExpandTimerRef.current) clearTimeout(autoExpandTimerRef.current);
                                  autoExpandTimerRef.current = setTimeout(() => {
                                    setExpandedPlaylists((prev) => { const next = new Set(prev); next.add(pl.id); return next; });
                                  }, 800);
                                }
                              }}
                              onDragLeave={() => {
                                setDragState({ hoveredPlaylistId: null });
                                if (autoExpandTimerRef.current) { clearTimeout(autoExpandTimerRef.current); autoExpandTimerRef.current = null; }
                              }}
                              isFolder={hasChildren}
                              totalCount={hasChildren ? totalCount : undefined}
                            />
                          </div>
                        </div>
                      </div>
                      {hasChildren && isExpanded && (
                        <div>{children.map((c) => renderPl(c, depth + 1))}</div>
                      )}
                    </div>
                  );
                };

                const rootPlaylists = [...playlists]
                  .filter((p) => !p.parentId)
                  .sort(sortFn);

                return rootPlaylists.length > 0
                  ? rootPlaylists.map((pl) => renderPl(pl))
                  : !dragState.isDragging && (
                    <div className="px-2 py-3 flex flex-col items-center gap-1 text-center">
                      <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="#4C4743" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="2" y="3" width="16" height="14" rx="2"/>
                        <path d="M7 8h6M7 12h4"/>
                        <circle cx="15" cy="13" r="3" fill="#4C4743" stroke="none"/>
                        <path d="M14 13l2-1v2l-2-1z" fill="#0E0D0C" stroke="none"/>
                      </svg>
                      <p className="text-[10px] text-[#4C4743]">{t("sidebar.noPlaylists")}</p>
                    </div>
                  );
              })()}

              {/* Botão Nova playlist — sempre no espaço abaixo da lista, durante uso normal */}
              {!dragState.isDragging && onNewPlaylist && (
                <button
                  onClick={onNewPlaylist}
                  className="w-full mt-2 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border border-dashed border-white/[0.07] text-[#605A55] hover:text-[#8F8883] hover:border-white/[0.14] hover:bg-white/[0.03] transition-all"
                >
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                    <path d="M5 1v8M1 5h8"/>
                  </svg>
                  <span className="text-[11px]">Nova playlist</span>
                </button>
              )}

              {/* Zona de drop para criar nova playlist — aparece sempre durante drag */}
              {dragState.isDragging && (
                <div
                  data-new-playlist-zone="true"
                  className="mx-1 mt-1.5 flex items-center gap-2 px-3 py-2.5 rounded-lg border border-dashed transition-all"
                  style={{
                    borderColor: dragState.hoveringNewPlaylist ? "#D95340" : "var(--new-pl-border)",
                    background: dragState.hoveringNewPlaylist ? "rgba(217,83,64,0.10)" : "var(--new-pl-bg)",
                  }}
                  onMouseEnter={() => setDragState({ hoveredPlaylistId: null, hoveringNewPlaylist: true })}
                  onMouseLeave={() => setDragState({ hoveringNewPlaylist: false })}
                >
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none"
                    stroke={dragState.hoveringNewPlaylist ? "#D95340" : "#605A55"}
                    strokeWidth="1.5" strokeLinecap="round">
                    <path d="M6 1v10M1 6h10"/>
                  </svg>
                  <span className="text-[11px]" style={{ color: dragState.hoveringNewPlaylist ? "#D95340" : "#605A55" }}>
                    Nova playlist
                  </span>
                </div>
              )}
            </div>
          )}
        </div>

      </div>

      {/* Dispositivos (volumes montados) */}
      {volumes.length > 0 && (
        <div className="px-3 pt-3 pb-1 border-t border-white/[0.05]">
          <button
            onClick={() => setDevicesExpanded((x) => !x)}
            className="w-full flex items-center gap-1.5 px-1 mb-1.5 group"
          >
            <svg
              width="7" height="7" viewBox="0 0 8 8" fill="#4C4743"
              style={{ transform: devicesExpanded ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 0.18s", flexShrink: 0 }}
            >
              <path d="M2 1l4 3-4 3V1z" />
            </svg>
            <span className="text-[9px] font-bold uppercase tracking-widest text-[#4C4743] group-hover:text-[#8F8883] transition-colors">
              {t("sidebar.devices")}
            </span>
          </button>
          {devicesExpanded && volumes.map((v) => (
            <div key={v.path} className="flex items-center group">
              <button
                onClick={() => onBrowse ? onBrowse(v.path) : invoke("open_folder", { path: v.path }).catch(() => {})}
                title={v.name}
                className="flex-1 flex items-center gap-2 px-2 py-1.5 rounded-l-md text-left transition-colors hover:bg-white/[0.04]"
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" className="text-[#605A55] shrink-0">
                  <rect x="1" y="3" width="10" height="7" rx="1.5"/>
                  <path d="M4 3V2a1 1 0 011-1h2a1 1 0 011 1v1"/>
                  <circle cx="9" cy="6.5" r=".8" fill="currentColor" stroke="none"/>
                </svg>
                <span className="text-[11px] text-[#8F8883] group-hover:text-[#C2BEBC] transition-colors truncate">{v.name}</span>
              </button>
              <button
                onClick={() => invoke("open_folder", { path: v.path }).catch(() => {})}
                title={`Abrir no ${FILE_MANAGER}`}
                className="px-1.5 py-1.5 rounded-r-md opacity-0 group-hover:opacity-100 transition-opacity hover:bg-white/[0.04]"
              >
                <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" className="text-[#4C4743]">
                  <path d="M2 8L8 2M5 2h3v3"/>
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Footer stats */}
      <div className="mt-auto px-4 py-3">
        <p className="text-[11px] text-[#8F8883]">
          {t("sidebar.tracksCount", { count: tracks.length })}
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

      {/* Playlist context menu */}
      {playlistCtx && (
        <>
        <div className="fixed inset-0 z-[49]" onClick={() => setPlaylistCtx(null)} />
        <div
          className="fixed z-50 bg-[#1c1715] border border-white/10 rounded-lg shadow-2xl py-1 min-w-[160px]"
          style={{ left: playlistCtx.x, top: playlistCtx.y }}
          onClick={() => setPlaylistCtx(null)}
        >
          <button
            className="w-full px-3 py-1.5 text-left text-sm text-[#C2BEBC] hover:bg-white/8 flex items-center gap-2"
            onClick={() => { setSettingsPlaylist(playlistCtx.pl); setPlaylistCtx(null); }}
          >
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" className="opacity-60">
              <circle cx="5.5" cy="5.5" r="1.5"/>
              <path d="M5.5 1v1M5.5 9v1M1 5.5h1M9 5.5h1M2.4 2.4l.7.7M8.5 8.5l-.7-.7M8.5 2.4l-.7.7M2.4 8.5l.7-.7"/>
            </svg>
            Configurações
          </button>
          <button
            className="w-full px-3 py-1.5 text-left text-sm text-[#C2BEBC] hover:bg-white/8 flex items-center gap-2"
            onClick={() => { setActivePlaylistId(playlistCtx.pl.id); setPlaylistCtx(null); }}
          >
            <svg width="11" height="11" viewBox="0 0 11 11" fill="currentColor" className="opacity-60"><path d="M2 1.5l8 4-8 4V1.5z"/></svg>
            {t("sidebar.openPlaylist")}
          </button>
          {onNewSubPlaylist && (
            <button
              className="w-full px-3 py-1.5 text-left text-sm text-[#C2BEBC] hover:bg-white/8 flex items-center gap-2"
              onClick={() => { const id = playlistCtx.pl.id; setPlaylistCtx(null); onNewSubPlaylist(id); }}
            >
              <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" className="opacity-60">
                <path d="M1 2A1 1 0 012 1h2.5L5.5 2H9a1 1 0 011 1v4a1 1 0 01-1 1H2a1 1 0 01-1-1V2z"/>
                <line x1="5.5" y1="4" x2="5.5" y2="7"/><line x1="4" y1="5.5" x2="7" y2="5.5"/>
              </svg>
              Criar subplaylist aqui
            </button>
          )}
          {playlistCtx.pl.parentId && (
            <button
              className="w-full px-3 py-1.5 text-left text-sm text-[#C2BEBC] hover:bg-white/8 flex items-center gap-2"
              onClick={() => {
                useAppStore.getState().updatePlaylist(playlistCtx.pl.id, { parentId: undefined });
                setPlaylistCtx(null);
              }}
            >
              <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" className="opacity-60">
                <path d="M1 5.5h7M5.5 3L8 5.5 5.5 8"/>
                <path d="M1 2v7"/>
              </svg>
              Remover da pasta
            </button>
          )}
          {onExportPlaylist && (
            <button
              className="w-full px-3 py-1.5 text-left text-sm text-[#C2BEBC] hover:bg-white/8 flex items-center gap-2"
              onClick={() => { onExportPlaylist(playlistCtx.pl); setPlaylistCtx(null); }}
            >
              <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" className="opacity-60">
                <path d="M5.5 1v6M3 5l2.5 2.5L8 5"/>
                <path d="M1.5 9h8"/>
              </svg>
              {t("sidebar.exportPlaylist")}
            </button>
          )}
          <button
            className="w-full px-3 py-1.5 text-left text-sm text-[#C2BEBC] hover:bg-white/8 flex items-center gap-2"
            onClick={async () => {
              const paths = playlistCtx.pl.trackPaths;
              setPlaylistCtx(null);
              if (paths.length === 0) { toast("Playlist vazia.", "info"); return; }
              interface RenameResult { old_path: string; new_path: string; }
              const results = await invoke<RenameResult[]>("rename_from_tags", { paths });
              if (results.length === 0) { toast("Nenhum arquivo renomeado — metadados insuficientes ou nome já correto.", "info"); return; }
              results.forEach(({ old_path, new_path }) => {
                const tr = tracks.find((t) => t.path === old_path);
                if (tr) updateTrack({ ...tr, path: new_path, filename: new_path.split(/[\\/]/).pop() ?? new_path });
              });
              toast(results.length === 1 ? `Arquivo renomeado para "${results[0].new_path.split(/[\\/]/).pop()}"` : `${results.length} arquivos renomeados pelo metadado`, "success");
            }}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" className="opacity-60">
              <path d="M1 5h8M5 1l4 4-4 4"/>
            </svg>
            Renomear arquivos pelo metadado
          </button>
          <button
            className="w-full px-3 py-1.5 text-left text-sm text-[#C2BEBC] hover:bg-white/8 flex items-center gap-2"
            onClick={async () => {
              const paths = playlistCtx.pl.trackPaths;
              setPlaylistCtx(null);
              if (paths.length === 0) { toast("Playlist vazia.", "info"); return; }
              const imagePath = await openFileDialog({ filters: [{ name: "Imagens", extensions: ["jpg", "jpeg", "png"] }], multiple: false });
              if (!imagePath || typeof imagePath !== "string") return;
              const ok = await invoke<number>("save_cover_batch_from_file", { paths, imagePath }).catch(() => 0);
              if (ok === 0) { toast("Nenhuma capa aplicada — verifique os arquivos.", "error"); return; }
              paths.forEach((p) => {
                const tr = tracks.find((t) => t.path === p);
                if (tr) updateTrack({ ...tr, has_cover: true, cover_version: (tr.cover_version ?? 0) + 1, issues: tr.issues.filter((i) => i !== "sem capa") });
              });
              toast(ok === 1 ? "Capa aplicada com sucesso." : `Capa aplicada em ${ok} faixas.`, "success");
            }}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" className="opacity-60">
              <rect x="1" y="1" width="8" height="8" rx="1"/>
              <circle cx="3.5" cy="3.5" r="1"/>
              <path d="M1 7l2.5-2.5 2 2 1.5-1.5 2 2"/>
            </svg>
            Trocar capa da playlist
          </button>
          {playlistCtx.pl.globalProperties?.enabled && (playlistCtx.pl.globalProperties?.activeFields?.length ?? 0) > 0 && playlistCtx.pl.trackPaths.length > 0 && (
            <button
              className="w-full px-3 py-1.5 text-left text-sm text-[#C2BEBC] hover:bg-white/8 flex items-center gap-2"
              onClick={async () => {
                const pl = playlistCtx.pl;
                const gp = pl.globalProperties!;
                setPlaylistCtx(null);
                await applyPlaylistRules(gp, pl.trackPaths);
                const count = pl.trackPaths.length;
                toast(`Regras aplicadas em ${count} faixa${count > 1 ? "s" : ""}`, "success");
              }}
            >
              <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" className="opacity-60">
                <circle cx="5.5" cy="5.5" r="1.4"/>
                <path d="M5.5 1v1M5.5 9v1M1 5.5h1M9 5.5h1M2.4 2.4l.7.7M8.5 8.5l-.7-.7M8.5 2.4l-.7.7M2.4 8.5l.7-.7"/>
              </svg>
              Aplicar regras em todas as faixas
            </button>
          )}
          <div className="h-px bg-white/10 my-1" />
          <button
            className="w-full px-3 py-1.5 text-left text-sm text-[#D95340]/80 hover:bg-white/8 flex items-center gap-2"
            onClick={() => { setConfirmDeletePlaylist({ id: playlistCtx.pl.id, name: playlistCtx.pl.name }); setPlaylistCtx(null); }}
          >
            <svg width="11" height="11" viewBox="0 0 11 11" fill="currentColor" className="opacity-70"><path d="M4 1h3a1 1 0 011 1v.5H2.5V2A1 1 0 014 1zM1 3h9l-.8 6.5A1 1 0 018.2 10H2.8a1 1 0 01-.997-.9L1 3z"/></svg>
            {t("sidebar.deletePlaylist")}
          </button>
        </div>
        </>
      )}

      {/* Duplicate folder dialog */}
      {dupDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-[#1c1715] border border-white/10 rounded-xl p-6 w-80 shadow-2xl">
            <h3 className="text-sm font-semibold text-[#F5F5F4] mb-2">{t("sidebar.folderAlreadyExists")}</h3>
            <p className="text-xs text-[#8F8883] mb-5">
              <span className="text-[#C2BEBC] font-medium">"{dupDialog.name}"</span> {t("sidebar.folderAlreadyExistsMsg")}
            </p>
            <div className="flex flex-col gap-2">
              <button
                className="w-full py-2 rounded-lg bg-[#D95340] hover:bg-[#E07364] text-white text-sm font-medium transition-colors"
                onClick={() => { onFolderSelect(dupDialog.path); setDupDialog(null); }}
              >
                {t("sidebar.yesReload")}
              </button>
              <button
                className="w-full py-2 rounded-lg bg-transparent hover:bg-white/5 text-[#756D67] text-sm transition-colors"
                onClick={() => setDupDialog(null)}
              >
                {t("common.cancel")}
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
            {t("common.open")}
          </button>
          <button
            className="w-full px-3 py-1.5 text-left text-sm text-[#C2BEBC] hover:bg-white/8 flex items-center gap-2"
            onClick={() => { toggleFavorite(contextMenu.path); closeContextMenu(); }}
          >
            <span className="text-[#D95340]">{isFavorite(contextMenu.path) ? "☆" : "★"}</span>
            {isFavorite(contextMenu.path) ? t("sidebar.removeFromFav") : t("sidebar.addToFav")}
          </button>
          {onAnalyzeBpmFolder && (
            <button
              className="w-full px-3 py-1.5 text-left text-sm text-[#C2BEBC] hover:bg-white/8 flex items-center gap-2"
              onClick={() => { onAnalyzeBpmFolder(contextMenu.path); closeContextMenu(); }}
            >
              <svg width="11" height="11" viewBox="0 0 11 11" fill="currentColor" className="opacity-60">
                <path d="M1 5.5a.5.5 0 01.5-.5h1a.5.5 0 010 1h-1a.5.5 0 01-.5-.5zm2-2a.5.5 0 01.5-.5h1a.5.5 0 010 1h-1a.5.5 0 01-.5-.5zm0 4a.5.5 0 01.5-.5h1a.5.5 0 010 1h-1a.5.5 0 01-.5-.5zm2-5a.5.5 0 01.5-.5h1a.5.5 0 010 1h-1a.5.5 0 01-.5-.5zm0 8a.5.5 0 01.5-.5h1a.5.5 0 010 1h-1a.5.5 0 01-.5-.5zm0-4a.5.5 0 01.5-.5h1a.5.5 0 010 1h-1a.5.5 0 01-.5-.5zm2-2a.5.5 0 01.5-.5h1a.5.5 0 010 1h-1a.5.5 0 01-.5-.5zm0 4a.5.5 0 01.5-.5h1a.5.5 0 010 1h-1a.5.5 0 01-.5-.5z"/>
              </svg>
              {t("sidebar.analyzeBpm")}
            </button>
          )}
          {onEnrichFolder && (
            <button
              className="w-full px-3 py-1.5 text-left text-sm text-[#C2BEBC] hover:bg-white/8 flex items-center gap-2"
              onClick={() => { onEnrichFolder(contextMenu.path); closeContextMenu(); }}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="opacity-60">
                <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
              </svg>
              {t("sidebar.enrichTracks")}
            </button>
          )}
          <button
            className="w-full px-3 py-1.5 text-left text-sm text-[#C2BEBC] hover:bg-white/8 flex items-center gap-2"
            onClick={async () => {
              const prefix = contextMenu.path.endsWith("/") || contextMenu.path.endsWith("\\") ? contextMenu.path : contextMenu.path + "/";
              const paths = tracks.filter((t) => t.path.startsWith(prefix)).map((t) => t.path);
              closeContextMenu();
              if (paths.length === 0) { toast("Nenhuma faixa carregada nesta pasta.", "info"); return; }
              interface RenameResult { old_path: string; new_path: string; }
              const results = await invoke<RenameResult[]>("rename_from_tags", { paths });
              if (results.length === 0) { toast("Nenhum arquivo renomeado — metadados insuficientes ou nome já correto.", "info"); return; }
              results.forEach(({ old_path, new_path }) => {
                const tr = tracks.find((t) => t.path === old_path);
                if (tr) updateTrack({ ...tr, path: new_path, filename: new_path.split(/[\\/]/).pop() ?? new_path });
              });
              toast(results.length === 1 ? `Arquivo renomeado para "${results[0].new_path.split(/[\\/]/).pop()}"` : `${results.length} arquivos renomeados pelo metadado`, "success");
            }}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" className="opacity-60">
              <path d="M1 5h8M5 1l4 4-4 4"/>
            </svg>
            Renomear arquivos pelo metadado
          </button>
          <button
            className="w-full px-3 py-1.5 text-left text-sm text-[#C2BEBC] hover:bg-white/8 flex items-center gap-2"
            onClick={async () => {
              const prefix = contextMenu.path.endsWith("/") || contextMenu.path.endsWith("\\") ? contextMenu.path : contextMenu.path + "/";
              const paths = tracks.filter((t) => t.path.startsWith(prefix)).map((t) => t.path);
              closeContextMenu();
              if (paths.length === 0) { toast("Nenhuma faixa carregada nesta pasta.", "info"); return; }
              const imagePath = await openFileDialog({ filters: [{ name: "Imagens", extensions: ["jpg", "jpeg", "png"] }], multiple: false });
              if (!imagePath || typeof imagePath !== "string") return;
              const ok = await invoke<number>("save_cover_batch_from_file", { paths, imagePath }).catch(() => 0);
              if (ok === 0) { toast("Nenhuma capa aplicada — verifique os arquivos.", "error"); return; }
              paths.forEach((p) => {
                const tr = tracks.find((t) => t.path === p);
                if (tr) updateTrack({ ...tr, has_cover: true, cover_version: (tr.cover_version ?? 0) + 1, issues: tr.issues.filter((i) => i !== "sem capa") });
              });
              toast(ok === 1 ? "Capa aplicada com sucesso." : `Capa aplicada em ${ok} faixas.`, "success");
            }}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" className="opacity-60">
              <rect x="1" y="1" width="8" height="8" rx="1"/>
              <circle cx="3.5" cy="3.5" r="1"/>
              <path d="M1 7l2.5-2.5 2 2 1.5-1.5 2 2"/>
            </svg>
            Trocar capa da pasta
          </button>
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
            {t("sidebar.removeFolder")}
          </button>
        </div>
      )}

      {/* Playlist Settings Modal */}
      {settingsPlaylist && (
        <PlaylistSettingsModal
          playlist={settingsPlaylist}
          onClose={() => setSettingsPlaylist(null)}
        />
      )}

      {/* Delete Dialog — remover pasta */}
      {deleteDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={(e) => { if (e.target === e.currentTarget) setDeleteDialog(null); }}>
          <div className="bg-[#1c1715] border border-white/10 rounded-xl w-[360px] shadow-2xl">
            <div className="px-5 py-4 border-b border-white/[0.06] flex items-center gap-2.5">
              <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="#D95340" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6.5 1.5L11.5 10.5H1.5L6.5 1.5z"/><path d="M6.5 5v2.5M6.5 9.5v.1"/>
              </svg>
              <h3 className="text-sm font-semibold text-[#E8E4E1]">
                {t("sidebar.removeFolderTitle", { name: deleteDialog.name })}
              </h3>
            </div>
            <div className="px-5 py-4">
              {isScanning && deleteDialog.path === lastFolder && (
                <p className="text-[11px] text-[#D95340] mb-2 flex items-center gap-1.5">
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor"><path d="M5 1a4 4 0 100 8A4 4 0 005 1zm0 2.25a.5.5 0 01.5.5v2a.5.5 0 01-1 0v-2a.5.5 0 01.5-.5zm0 4.25a.625.625 0 110-1.25.625.625 0 010 1.25z"/></svg>
                  {t("sidebar.scanInProgress")}
                </p>
              )}
              <p className="text-[12px] text-[#8F8883] leading-relaxed">
                {deleteDialog.path === lastFolder ? t("sidebar.tracksWillBeRemoved") : t("sidebar.chooseFolderAction")}
              </p>
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-white/[0.06]">
              <button
                className="px-4 py-1.5 text-[12px] text-[#756D67] hover:text-[#C2BEBC] transition-colors rounded-lg hover:bg-white/[0.04]"
                onClick={() => setDeleteDialog(null)}
              >
                {t("common.cancel")}
              </button>
              <button
                className="px-4 py-1.5 text-[12px] font-medium bg-[#D95340] hover:bg-[#E07364] text-white rounded-lg transition-colors"
                onClick={() => handleRemoveFromList(deleteDialog.path)}
              >
                {t("sidebar.removeFromList")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmação de exclusão de playlist */}
      {confirmDeletePlaylist && (() => {
        // Conta todos os descendentes recursivamente
        const countDescendants = (pid: string): number => {
          const direct = playlists.filter((p) => p.parentId === pid);
          return direct.reduce((acc, c) => acc + 1 + countDescendants(c.id), 0);
        };
        const descCount = countDescendants(confirmDeletePlaylist.id);
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={(e) => { if (e.target === e.currentTarget) setConfirmDeletePlaylist(null); }}>
            <div className="bg-[#1c1715] border border-white/10 rounded-xl w-[340px] shadow-2xl">
              <div className="px-5 py-4 border-b border-white/[0.06] flex items-center gap-2.5">
                <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="#D95340" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M6.5 1.5L11.5 10.5H1.5L6.5 1.5z"/><path d="M6.5 5v2.5M6.5 9.5v.1"/>
                </svg>
                <h3 className="text-sm font-semibold text-[#E8E4E1]">{t("sidebar.deletePlaylist")}</h3>
              </div>
              <div className="px-5 py-4 flex flex-col gap-2">
                <p className="text-[12px] text-[#8F8883] leading-relaxed">
                  A playlist <span className="text-[#C2BEBC] font-medium">"{confirmDeletePlaylist.name}"</span> será excluída permanentemente. As faixas não serão apagadas do disco.
                </p>
                {descCount > 0 && (
                  <p className="text-[12px] text-[#D95340] leading-relaxed">
                    Esta pasta contém <span className="font-semibold">{descCount} {descCount === 1 ? "subplaylist" : "subplaylists"}</span> que também serão excluídas.
                  </p>
                )}
              </div>
              <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-white/[0.06]">
                <button
                  className="px-4 py-1.5 text-[12px] text-[#756D67] hover:text-[#C2BEBC] transition-colors rounded-lg hover:bg-white/[0.04]"
                  onClick={() => setConfirmDeletePlaylist(null)}
                >
                  {t("common.cancel")}
                </button>
                <button
                  className="px-4 py-1.5 text-[12px] font-medium bg-[#D95340] hover:bg-[#E07364] text-white rounded-lg transition-colors"
                  onClick={() => {
                    deletePlaylist(confirmDeletePlaylist.id);
                    toast(`Playlist "${confirmDeletePlaylist.name}" excluída`, "info");
                    setConfirmDeletePlaylist(null);
                  }}
                >
                  {t("sidebar.deletePlaylist")}
                </button>
              </div>
            </div>
          </div>
        );
      })()}
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
  trackCount?: number;
  tracks?: import("../store").Track[];
  onOpen: () => void;
  onToggleExpand: () => void;
  onToggleExpandPath: (path: string) => void;
  onToggleFavorite?: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onFolderSelect: (path: string) => void;
  lastFolder: string | null;
  expandedFolders: Set<string>;
  subfolderMap: Record<string, string[]>;
  activeScanProgress?: number | null; // undefined = sem scan; null = indeterminado; 0–1 = progresso
}

function SubFolderTree({ path, depth, expandedFolders, subfolderMap, onFolderSelect, onToggleExpandPath, lastFolder, tracks }: {
  path: string; depth: number;
  expandedFolders: Set<string>; subfolderMap: Record<string, string[]>;
  onFolderSelect: (p: string) => void; onToggleExpandPath: (p: string) => void;
  lastFolder: string | null; tracks?: import("../store").Track[];
}) {
  const name = path.split(/[\\/]/).filter(Boolean).pop() ?? path;
  const isSelected = lastFolder === path;
  const isExpanded = expandedFolders.has(path);
  const subs = subfolderMap[path];
  const hasSubs = subs === undefined || subs.length > 0;
  const prefix = path.endsWith("/") || path.endsWith("\\") ? path : path + "/";
  const cnt = tracks ? tracks.filter((t) => t.path.startsWith(prefix)).length : 0;
  return (
    <div>
      <div className="flex items-center group" style={{ paddingLeft: depth * 10 }}>
        <button onClick={hasSubs ? () => onToggleExpandPath(path) : undefined}
          style={{ visibility: hasSubs ? "visible" : "hidden" }}
          className="w-4 h-6 flex items-center justify-center shrink-0 text-[#4C4743] hover:text-[#8F8883] transition-colors">
          <svg width="6" height="6" viewBox="0 0 8 8" fill="currentColor"
            style={{ transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 0.15s" }}>
            <path d="M2 1l4 3-4 3V1z"/>
          </svg>
        </button>
        <button onClick={() => onFolderSelect(path)}
          className={`flex-1 flex items-center gap-1.5 px-1 py-1 rounded-md text-[11px] transition-colors text-left min-w-0
            ${isSelected ? "bg-[#D95340]/15 text-[#F5F5F4]" : "text-[#8F8883] hover:text-[#C2BEBC] hover:bg-white/5"}`}
          title={path}>
          <svg width="10" height="10" viewBox="0 0 11 11" fill="currentColor"
            className={`shrink-0 transition-colors ${isSelected ? "text-[#D95340] opacity-90" : "opacity-40"}`}>
            <path d="M1 2.5A1.5 1.5 0 012.5 1h1.586a1 1 0 01.707.293L5.5 2H9a1.5 1.5 0 011.5 1.5v5A1.5 1.5 0 019 10H2a1.5 1.5 0 01-1.5-1.5v-6z"/>
          </svg>
          <span className="truncate flex-1">{name}</span>
          {cnt > 0 && <span className={`text-[9px] font-mono tabular-nums shrink-0 ${isSelected ? "text-[#D95340]/70" : "text-[#4C4743]"}`}>{cnt}</span>}
        </button>
      </div>
      {isExpanded && subs && subs.length > 0 && (
        <div>
          {subs.map((sub) => (
            <SubFolderTree key={sub} path={sub} depth={depth + 1}
              expandedFolders={expandedFolders} subfolderMap={subfolderMap}
              onFolderSelect={onFolderSelect} onToggleExpandPath={onToggleExpandPath}
              lastFolder={lastFolder} tracks={tracks} />
          ))}
        </div>
      )}
    </div>
  );
}

function FolderRow({
  path, isSelected, isFavorite, isExpanded, subfolders, trackCount, tracks,
  onOpen, onToggleExpand, onToggleExpandPath, onToggleFavorite, onContextMenu, onFolderSelect, lastFolder,
  expandedFolders, subfolderMap, activeScanProgress,
}: FolderRowProps) {
  const name = path.split(/[\\/]/).filter(Boolean).pop() ?? path;
  const hasSubs = subfolders === null || subfolders.length > 0;
  const showProgress = activeScanProgress !== undefined;

  return (
    <div className="relative">
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
          <svg
            width="11" height="11" viewBox="0 0 11 11" fill="currentColor"
            className={`shrink-0 transition-colors ${isSelected ? "text-[#D95340] opacity-90" : "opacity-50"}`}
          >
            <path d="M1 2.5A1.5 1.5 0 012.5 1h1.586a1 1 0 01.707.293L5.5 2H9a1.5 1.5 0 011.5 1.5v5A1.5 1.5 0 019 10H2a1.5 1.5 0 01-1.5-1.5v-6z"/>
          </svg>
          <span className="truncate flex-1">{name}</span>
          {trackCount != null && trackCount > 0 && (
            <span className={`text-[9px] font-mono tabular-nums shrink-0 ${isSelected ? "text-[#D95340]/70" : "text-[#605A55]"}`}>
              {trackCount}
            </span>
          )}
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

      {/* Barra de progresso do scan — visível só na pasta ativa durante o scan */}
      {showProgress && (
        <div className="absolute bottom-0 left-0 right-0 overflow-hidden" style={{ height: 2 }}>
          {activeScanProgress !== null && activeScanProgress !== undefined && activeScanProgress > 0 ? (
            <div
              className="h-full transition-all duration-200 ease-out"
              style={{ width: `${Math.round(activeScanProgress * 100)}%`, background: "#D95340" }}
            />
          ) : (
            <div className="h-full w-full" style={{ background: "#D95340", animation: "progress-indeterminate 1.4s ease-in-out infinite" }} />
          )}
        </div>
      )}

      {/* Subfolders — recursivos */}
      {isExpanded && subfolders && subfolders.length > 0 && (
        <div className="pl-5">
          {subfolders.map((sub) => (
            <SubFolderTree key={sub} path={sub} depth={0}
              expandedFolders={expandedFolders} subfolderMap={subfolderMap}
              onFolderSelect={onFolderSelect} onToggleExpandPath={onToggleExpandPath}
              lastFolder={lastFolder} tracks={tracks} />
          ))}
        </div>
      )}
    </div>
  );
}

// MARK: - PlaylistRow

const DJ_BADGE: Record<string, string> = {
  serato: "S", rekordbox: "R", traktor: "T", vdj: "V", djay: "D", m3u: "M3U",
};

function PlaylistRow({
  pl, isActive, onOpen, onContextMenu, isDragging, isHoveredDrop, onDragEnter, onDragLeave,
  isFolder, totalCount,
}: {
  pl: Playlist;
  isActive: boolean;
  onOpen: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  isDragging?: boolean;
  isHoveredDrop?: boolean;
  onDragEnter?: () => void;
  onDragLeave?: () => void;
  isFolder?: boolean;
  totalCount?: number;
}) {
  const updatePlaylist = useAppStore((s) => s.updatePlaylist);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(pl.name);
  const inputRef = useRef<HTMLInputElement>(null);

  function startEdit(e: React.MouseEvent) {
    e.stopPropagation();
    setDraft(pl.name);
    setEditing(true);
    setTimeout(() => { inputRef.current?.select(); }, 0);
  }

  function commitEdit() {
    const name = draft.trim();
    if (name && name !== pl.name) updatePlaylist(pl.id, { name });
    setEditing(false);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") { e.preventDefault(); commitEdit(); }
    if (e.key === "Escape") { setEditing(false); }
  }

  return (
    <div
      onMouseEnter={() => isDragging && onDragEnter?.()}
      onMouseLeave={() => isDragging && onDragLeave?.()}
      onContextMenu={onContextMenu}
      onDoubleClick={isDragging ? undefined : startEdit}
      onClick={isDragging || editing ? undefined : onOpen}
      className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left transition-colors group cursor-pointer
        ${isHoveredDrop
          ? "bg-[#D95340]/25 border border-[#D95340]/50 text-[#F5F5F4]"
          : isActive
          ? "bg-[#D95340]/15 text-[#F5F5F4] border border-[#D95340]/20"
          : isDragging
          ? "border border-dashed border-white/10 text-[#8F8883]"
          : "text-[#8F8883] hover:text-[#C2BEBC] hover:bg-white/5"
        }`}
    >
      {/* Ícone: pasta-mãe (folder) ou playlist normal */}
      {isFolder ? (
        <svg width="12" height="11" viewBox="0 0 12 11" fill="none" className={`shrink-0 ${isHoveredDrop ? "opacity-90" : "opacity-70"}`}>
          <path d="M1 2.5A1.5 1.5 0 012.5 1h1.586a1 1 0 01.707.293L5.5 2.5H10A1.5 1.5 0 0111.5 4v4.5A1.5 1.5 0 0110 10H2A1.5 1.5 0 01.5 8.5v-5z"
            fill={isActive ? "rgba(217,83,64,0.25)" : "rgba(201,123,64,0.15)"}
            stroke={isActive ? "#D95340" : "#C97B40"} strokeWidth="1"/>
        </svg>
      ) : (
        <svg width="11" height="11" viewBox="0 0 11 11" fill="currentColor" className={`shrink-0 ${isHoveredDrop ? "opacity-80 text-[#D95340]" : "opacity-50 text-[#D95340]"}`}>
          <rect x="1" y="1" width="9" height="2" rx="0.5"/>
          <rect x="1" y="4.5" width="7" height="2" rx="0.5"/>
          <rect x="1" y="8" width="5" height="2" rx="0.5"/>
        </svg>
      )}

      {editing ? (
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={onKeyDown}
          onClick={(e) => e.stopPropagation()}
          className="flex-1 text-[11px] bg-transparent border-b border-[#D95340]/60 outline-none text-[#F5F5F4] min-w-0"
          style={{ padding: "0 1px" }}
        />
      ) : (
        <span className="flex-1 truncate text-[11px]">{pl.name}</span>
      )}

      {pl.pendingRulesApply && !editing && (
        <span className="w-1.5 h-1.5 rounded-full bg-orange-400 animate-pulse shrink-0" title="Regras pendentes de aplicação" />
      )}
      {!editing && (isFolder ? (totalCount ?? 0) > 0 : pl.trackPaths.length > 0) && (
        <span className={`shrink-0 text-[9px] font-semibold tabular-nums px-1.5 py-0.5 rounded-md ${
          isActive
            ? "bg-[#D95340]/20 text-[#D95340]"
            : isFolder
            ? "bg-[#C97B40]/15 text-[#C97B40]"
            : "bg-white/[0.06] text-[#605A55]"
        }`}>
          {isFolder ? (totalCount ?? 0) : pl.trackPaths.length}
        </span>
      )}
      {!editing && pl.lastExportedTo && pl.lastExportedTo.length > 0 && (
        <span className="text-[8px] font-bold px-1 rounded bg-white/[0.04] text-[#4C4743]">
          {DJ_BADGE[pl.lastExportedTo[0]] ?? pl.lastExportedTo[0]}
        </span>
      )}
    </div>
  );
}
