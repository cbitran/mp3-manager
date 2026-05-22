import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useEffect } from "react";
import { useAppStore, type Track } from "./store";
import TrackTable from "./components/TrackTable";
import Inspector from "./components/Inspector";
import Sidebar from "./components/Sidebar";
import MiniPlayer from "./components/MiniPlayer";

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
  } = useAppStore();

  const allTracks = useAppStore((s) => s.tracks);
  const tracks = filteredTracks();
  const problemCount = allTracks.filter((t) => t.issues.length > 0).length;

  async function scanFolder(folder: string) {
    setLastFolder(folder);
    setScanning(true);
    try {
      const result = await invoke<Track[]>("scan_folder", { folder });
      setTracks(result);
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

  return (
    <div className="flex flex-col h-screen bg-[#1a1a1f] text-gray-100 font-sans overflow-hidden">
      {/* Toolbar */}
      <div
        className="flex items-center gap-2 px-3 py-2 border-b border-white/[0.06] bg-[#1f1f26]"
        style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
      >
        {/* Spacer para área de semáforo no macOS */}
        <div className="w-20 shrink-0" />

        <button
          onClick={pickFolder}
          disabled={isScanning}
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-blue-600 hover:bg-blue-500 active:bg-blue-700 disabled:opacity-50 text-xs font-semibold transition-colors shadow-sm"
        >
          {isScanning ? (
            <>
              <span className="animate-spin">⟳</span> Escaneando…
            </>
          ) : (
            <>📂 Abrir Pasta</>
          )}
        </button>

        <div
          className="flex gap-0.5 ml-2"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
          {(["all", "problems", "ok"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setFilterTab(tab)}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                filterTab === tab
                  ? "bg-white/10 text-white"
                  : "text-gray-500 hover:text-gray-300 hover:bg-white/5"
              }`}
            >
              {tab === "all" && `Todas · ${allTracks.length}`}
              {tab === "problems" && `⚠ Problemas · ${problemCount}`}
              {tab === "ok" && `✓ OK · ${allTracks.length - problemCount}`}
            </button>
          ))}
        </div>

        <div className="flex-1" />

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
          <TrackTable tracks={tracks} />
          {selectedIds.size > 0 && <Inspector />}
        </div>
      </div>

      {/* Mini-player */}
      <MiniPlayer />
    </div>
  );
}
