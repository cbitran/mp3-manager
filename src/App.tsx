import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useState } from "react";
import { useAppStore, type Track } from "./store";
import TrackTable from "./components/TrackTable";
import Inspector from "./components/Inspector";
import Sidebar from "./components/Sidebar";
import MiniPlayer from "./components/MiniPlayer";
import DeleteConfirmDialog from "./components/DeleteConfirmDialog";
import MissingMetaPrompt from "./components/MissingMetaPrompt";

export default function App() {
  const {
    isScanning,
    setTracks,
    setScanning,
    filterTab,
    setFilterTab,
    searchQuery,
    setSearchQuery,
    filteredTracks,
    selectedIds,
    lastFolder,
    setLastFolder,
    favoriteTrackPaths,
  } = useAppStore();

  const allTracks = useAppStore((s) => s.tracks);
  const tracks = filteredTracks();
  const problemCount  = allTracks.filter((t) => t.issues.length > 0).length;
  const favoriteCount = allTracks.filter((t) => favoriteTrackPaths.has(t.path)).length;

  const [deleteTargets, setDeleteTargets]   = useState<Track[]>([]);
  const [compact, setCompact]               = useState(false);
  const [missingMeta, setMissingMeta]       = useState<{
    missingGenre: number; missingYear: number; missingAlbum: number;
  } | null>(null);

  function requestDelete() {
    const targets = allTracks.filter((t) => selectedIds.has(t.id));
    if (targets.length > 0) setDeleteTargets(targets);
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (
        (e.key === "Delete" || e.key === "Backspace") &&
        (e.target as HTMLElement).tagName !== "INPUT" &&
        (e.target as HTMLElement).tagName !== "TEXTAREA"
      ) {
        if (selectedIds.size > 0) {
          e.preventDefault();
          requestDelete();
        }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedIds, allTracks]);

  function checkMissingMeta(loaded: Track[]) {
    if (loaded.length < 5) return;
    const missingGenre  = loaded.filter((t) => !t.genre).length;
    const missingYear   = loaded.filter((t) => !t.year).length;
    const missingAlbum  = loaded.filter((t) => !t.album).length;
    const total = missingGenre + missingYear + missingAlbum;
    if (total > (loaded.length * 3) / 4) {
      setTimeout(
        () => setMissingMeta({ missingGenre, missingYear, missingAlbum }),
        600
      );
    }
  }

  async function scanFolder(folder: string) {
    setLastFolder(folder);
    setScanning(true);
    try {
      const result = await invoke<Track[]>("scan_folder", { folder });
      setTracks(result);
      checkMissingMeta(result);
    } finally {
      setScanning(false);
    }
  }

  async function pickFolder() {
    const folder = await open({ directory: true, multiple: false });
    if (!folder || typeof folder !== "string") return;
    await scanFolder(folder);
  }

  useEffect(() => {
    if (lastFolder) scanFolder(lastFolder);
  }, []);

  const tabs: { id: typeof filterTab; label: string }[] = [
    { id: "all",       label: `Todas · ${allTracks.length}` },
    { id: "favorites", label: `★ ${favoriteCount}` },
    { id: "problems",  label: `⚠ ${problemCount}` },
    { id: "ok",        label: `✓ ${allTracks.length - problemCount}` },
  ];

  return (
    <div className="flex flex-col h-screen bg-[#1a1a1f] text-gray-100 font-sans overflow-hidden">
      {/* Toolbar */}
      <div
        className="flex items-center gap-2 px-3 py-2 border-b border-white/[0.06] bg-[#1f1f26]"
        style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
      >
        <div className="w-20 shrink-0" />

        <button
          onClick={pickFolder}
          disabled={isScanning}
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-blue-600 hover:bg-blue-500 active:bg-blue-700 disabled:opacity-50 text-xs font-semibold transition-colors shadow-sm"
        >
          {isScanning ? (
            <><span className="animate-spin">⟳</span> Escaneando…</>
          ) : (
            <>📂 Abrir Pasta</>
          )}
        </button>

        {/* Filter tabs */}
        <div
          className="flex gap-0.5 ml-2"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setFilterTab(tab.id)}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                filterTab === tab.id
                  ? "bg-white/10 text-white"
                  : "text-gray-500 hover:text-gray-300 hover:bg-white/5"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex-1" />

        {/* Compact toggle */}
        <button
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
          onClick={() => setCompact((v) => !v)}
          title={compact ? "Modo normal" : "Modo compacto"}
          className={`px-2 py-1.5 rounded-md text-xs transition-colors ${
            compact ? "bg-white/10 text-white" : "text-gray-600 hover:text-gray-400 hover:bg-white/5"
          }`}
        >
          {compact ? "▤" : "▣"}
        </button>

        {/* Search */}
        <input
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
          className="w-56 px-3 py-1.5 rounded-md bg-white/5 border border-white/10 text-xs placeholder-gray-600 focus:outline-none focus:border-blue-500 focus:bg-white/8 transition-colors"
          placeholder="⌕  Buscar…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        <Sidebar onFolderSelect={scanFolder} />

        <div className="flex flex-1 overflow-hidden">
          <TrackTable tracks={tracks} compact={compact} />
          {selectedIds.size > 0 && <Inspector />}
        </div>
      </div>

      <MiniPlayer />

      {deleteTargets.length > 0 && (
        <DeleteConfirmDialog
          tracks={deleteTargets}
          onClose={() => setDeleteTargets([])}
        />
      )}

      {missingMeta && (
        <MissingMetaPrompt
          totalTracks={allTracks.length}
          missingGenre={missingMeta.missingGenre}
          missingYear={missingMeta.missingYear}
          missingAlbum={missingMeta.missingAlbum}
          onDismiss={() => setMissingMeta(null)}
          onEnrich={() => {
            setMissingMeta(null);
            // Selecionar todas e abrir Inspector (usuário clica Enriquecer manualmente)
            // TODO: trigger batch enrichment
          }}
        />
      )}
    </div>
  );
}
