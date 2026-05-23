import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open, save } from "@tauri-apps/plugin-dialog";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAppStore, type Track } from "./store";
import TrackTable from "./components/TrackTable";
import Inspector from "./components/Inspector";
import Sidebar from "./components/Sidebar";
import MiniPlayer from "./components/MiniPlayer";
import DeleteConfirmDialog from "./components/DeleteConfirmDialog";
import MissingMetaPrompt from "./components/MissingMetaPrompt";
import TrialBanner from "./components/TrialBanner";
import TrialExpiredModal from "./components/TrialExpiredModal";
import FilenamePrompt, { type FilenameIssue } from "./components/FilenamePrompt";
import DuplicatePrompt, { type DuplicateGroup } from "./components/DuplicatePrompt";
import ToastContainer, { toast } from "./components/Toast";
import ParenReviewPrompt, { type ParenIssue } from "./components/ParenReviewPrompt";
import LibraryStats from "./components/LibraryStats";
import Onboarding, { shouldShowOnboarding } from "./components/Onboarding";
import Settings from "./components/Settings";

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
    recordScan,
    genreFilter,
    setGenreFilter,
  } = useAppStore();

  const allTracks = useAppStore((s) => s.tracks);
  const playerTrackId = useAppStore((s) => s.playerTrackId);
  const baseFiltered = filteredTracks();

  // ── Advanced filter state ────────────────────────────────────────
  const [showAdvFilter, setShowAdvFilter] = useState(false);
  const advFilterRef = useRef<HTMLDivElement>(null);
  const [advFilter, setAdvFilter] = useState({
    bpmMin: "", bpmMax: "", yearMin: "", yearMax: "", key: "",
  });
  const isAdvFilterActive = advFilter.bpmMin || advFilter.bpmMax || advFilter.yearMin || advFilter.yearMax || advFilter.key;

  const availableKeys = useMemo(() => {
    const ks = new Set(allTracks.map((t) => t.key).filter(Boolean) as string[]);
    return [...ks].sort();
  }, [allTracks]);

  const tracks = useMemo(() => {
    if (!isAdvFilterActive) return baseFiltered;
    return baseFiltered.filter((t) => {
      if (advFilter.bpmMin) {
        const min = parseFloat(advFilter.bpmMin);
        if (!isNaN(min) && (!t.bpm || parseFloat(t.bpm) < min)) return false;
      }
      if (advFilter.bpmMax) {
        const max = parseFloat(advFilter.bpmMax);
        if (!isNaN(max) && (!t.bpm || parseFloat(t.bpm) > max)) return false;
      }
      if (advFilter.yearMin) {
        const min = parseInt(advFilter.yearMin);
        if (!isNaN(min) && (!t.year || t.year < min)) return false;
      }
      if (advFilter.yearMax) {
        const max = parseInt(advFilter.yearMax);
        if (!isNaN(max) && (!t.year || t.year > max)) return false;
      }
      if (advFilter.key && t.key !== advFilter.key) return false;
      return true;
    });
  }, [baseFiltered, advFilter, isAdvFilterActive]);

  useEffect(() => {
    if (!showAdvFilter) return;
    const handler = (e: MouseEvent) => {
      if (advFilterRef.current && !advFilterRef.current.contains(e.target as Node)) {
        setShowAdvFilter(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showAdvFilter]);

  const problemCount  = allTracks.filter((t) => t.issues.length > 0).length;
  const favoriteCount = allTracks.filter((t) => favoriteTrackPaths.has(t.path)).length;
  const recentCutoff  = Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60;
  const recentCount   = allTracks.filter((t) => (t.modified_at ?? 0) >= recentCutoff).length;

  const [deleteTargets, setDeleteTargets]   = useState<Track[]>([]);
  const [showSettings, setShowSettings]     = useState(false);
  const [compact, setCompact]               = useState(false);
  const [missingMeta, setMissingMeta]       = useState<{
    missingGenre: number; missingYear: number; missingAlbum: number;
  } | null>(null);
  const [filenameIssues, setFilenameIssues] = useState<FilenameIssue[]>([]);
  const [parenIssues, setParenIssues] = useState<ParenIssue[]>([]);
  const [duplicateGroups, setDuplicateGroups] = useState<DuplicateGroup[]>([]);
  const [normalizing, setNormalizing]     = useState(false);
  const [exporting, setExporting]         = useState(false);
  const [enriching, setEnriching]         = useState(false);
  const [enrichProgress, setEnrichProgress] = useState<{ done: number; total: number } | null>(null);
  const [scanTotal, setScanTotal]       = useState<number | null>(null);
  const [scanDone, setScanDone]         = useState<number>(0);
  const [windowWidth, setWindowWidth]   = useState(window.innerWidth);
  const [isDragOver, setIsDragOver]     = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(() => shouldShowOnboarding());
  const isBusyRef = useRef(false);

  useEffect(() => {
    const handleResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Limpa issues quando todas as faixas são removidas; filtra grupos órfãos quando algumas são removidas
  useEffect(() => {
    if (allTracks.length === 0) {
      setFilenameIssues([]);
      setParenIssues([]);
      setDuplicateGroups([]);
      return;
    }
    const paths = new Set(allTracks.map((t) => t.path));
    setFilenameIssues((prev) => prev.filter((i) => paths.has(i.path)));
    setParenIssues((prev) => prev.filter((i) => paths.has(i.path)));
    setDuplicateGroups((prev) =>
      prev
        .map((g) => ({ ...g, paths: g.paths.filter((p) => paths.has(p)) }))
        .filter((g) => g.paths.length > 1)
    );
  }, [allTracks]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    getCurrentWebview().onDragDropEvent((event) => {
      if (event.payload.type === "enter") {
        setIsDragOver(true);
      } else if (event.payload.type === "leave") {
        setIsDragOver(false);
      } else if (event.payload.type === "drop") {
        setIsDragOver(false);
        const paths = event.payload.paths;
        if (paths.length > 0) {
          scanFolder(paths[0]);
        }
      }
    }).then((fn) => { unlisten = fn; });
    return () => { unlisten?.(); };
  }, []);

  const inspectorOverlay = windowWidth < 820;

  // Listen to scan_progress events from Rust
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen<{ done: number; total: number }>("scan_progress", (event) => {
      setScanDone(event.payload.done);
      setScanTotal(event.payload.total);
    }).then((fn) => { unlisten = fn; });
    return () => { unlisten?.(); };
  }, []);

  // Sync busy state to ref for window close handler
  useEffect(() => { isBusyRef.current = isScanning || normalizing || exporting || enriching; }, [isScanning, normalizing, exporting, enriching]);

  // Nenhum handler de onCloseRequested — deixa o botão nativo fechar normalmente

  async function normalizeTags() {
    if (allTracks.length === 0) return;
    setNormalizing(true);
    try {
      const paths = allTracks.map((t) => t.path);
      const results = await invoke<{ path: string; changed: boolean }[]>("normalize_tags", { paths });
      const changed = results.filter((r) => r.changed).length;
      toast(changed > 0 ? `${changed} tag${changed !== 1 ? "s" : ""} normalizada${changed !== 1 ? "s" : ""}` : "Todas as tags já estão normalizadas", changed > 0 ? "success" : "info");
    } finally {
      setNormalizing(false);
    }
  }

  async function exportRekordbox() {
    if (allTracks.length === 0) return;
    const outPath = await save({
      defaultPath: "TagWave_Export.xml",
      filters: [{ name: "Rekordbox XML", extensions: ["xml"] }],
    });
    if (!outPath) return;
    setExporting(true);
    try {
      const count = await invoke<number>("export_rekordbox", {
        tracks: allTracks,
        outputPath: outPath,
      });
      toast(`${count} faixa${count !== 1 ? "s" : ""} exportada${count !== 1 ? "s" : ""} para Rekordbox`);
    } finally {
      setExporting(false);
    }
  }

  async function exportM3U() {
    if (allTracks.length === 0) return;
    const outPath = await save({
      defaultPath: "TagWave_Playlist.m3u",
      filters: [{ name: "Playlist M3U", extensions: ["m3u"] }],
    });
    if (!outPath) return;
    setExporting(true);
    try {
      const m3uCount = await invoke<number>("export_m3u", { tracks: allTracks, outputPath: outPath });
      toast(`Playlist M3U criada · ${m3uCount} faixas`);
    } finally {
      setExporting(false);
    }
  }

  async function batchEnrich() {
    const selected = allTracks.filter((t) => selectedIds.has(t.id));
    const targets = selected.length > 0
      ? selected
      : allTracks.filter((t) => !t.genre || !t.album || !t.year);
    if (targets.length === 0) { toast("Todas as faixas já têm metadados completos", "info"); return; }
    setEnriching(true);
    setEnrichProgress({ done: 0, total: targets.length });
    let enriched = 0;
    const CHUNK = 5;
    try {
      for (let i = 0; i < targets.length; i += CHUNK) {
        const chunk = targets.slice(i, i + CHUNK);
        const req = chunk.map((t) => ({ path: t.path, title: t.title ?? null, artist: t.artist ?? null }));
        const results = await invoke<{ path: string; genre: string | null; album: string | null; year: number | null; cover_url: string | null }[]>("batch_enrich_itunes", { tracks: req });
        for (const r of results) {
          const track = useAppStore.getState().tracks.find((t) => t.path === r.path);
          if (!track) continue;
          const hasMetaChange = (r.genre && !track.genre) || (r.album && !track.album) || (r.year && !track.year);
          let updated = { ...track };
          if (hasMetaChange) {
            updated = { ...updated, genre: r.genre ?? track.genre, album: r.album ?? track.album, year: r.year ?? track.year };
            await invoke("save_tags", {
              path: track.path, title: updated.title ?? null, artist: updated.artist ?? null,
              album: updated.album ?? null, genre: updated.genre ?? null, year: updated.year ?? null,
              trackNumber: updated.track_number ?? null, bpm: updated.bpm ?? null,
              key: updated.key ?? null, rating: updated.rating ?? null,
            }).catch(() => {});
            enriched++;
          }
          // Download cover if missing
          if (!track.has_cover && r.cover_url) {
            const ok = await invoke("save_cover", { path: track.path, coverUrl: r.cover_url }).then(() => true).catch(() => false);
            if (ok) {
              updated = {
                ...updated,
                has_cover: true,
                cover_version: (updated.cover_version ?? 0) + 1,
                issues: updated.issues.filter((i) => i !== "sem capa"),
              };
            }
          }
          if (updated !== track) useAppStore.getState().updateTrack(updated);
        }
        setEnrichProgress({ done: Math.min(i + CHUNK, targets.length), total: targets.length });
      }
      toast(enriched > 0 ? `${enriched} faixa${enriched !== 1 ? "s" : ""} enriquecida${enriched !== 1 ? "s" : ""} via iTunes` : "Nenhuma informação nova encontrada", enriched > 0 ? "success" : "info");
    } finally {
      setEnriching(false);
      setEnrichProgress(null);
    }
  }

  function requestDelete() {
    const targets = allTracks.filter((t) => selectedIds.has(t.id));
    if (targets.length > 0) setDeleteTargets(targets);
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      const isInput = target.tagName === "INPUT" || target.tagName === "TEXTAREA";
      if ((e.key === "Delete" || e.key === "Backspace") && !isInput) {
        if (selectedIds.size > 0) { e.preventDefault(); requestDelete(); }
      }
      if ((e.key === "o" || e.key === "O") && (e.metaKey || e.ctrlKey) && !isInput) {
        e.preventDefault();
        pickFolder();
      }
      if (e.key === "Escape" && !isInput && selectedIds.size > 0) {
        e.preventDefault();
        useAppStore.getState().clearSelection();
      }
      if ((e.key === "a" || e.key === "A") && (e.metaKey || e.ctrlKey) && !isInput) {
        e.preventDefault();
        useAppStore.getState().selectAll(tracks.map((t) => t.id));
      }
      if ((e.key === "," || e.key === "،") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setShowSettings((v) => !v);
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
    setScanTotal(null);
    setScanDone(0);
    setFilenameIssues([]);
    setParenIssues([]);
    setDuplicateGroups([]);
    setGenreFilter(null);
    try {
      const result = await invoke<Track[]>("scan_folder", { folder });
      setTracks(result);
      recordScan(result.length);
      checkMissingMeta(result);

      // Background analysis
      if (result.length > 0) {
        const paths = result.map((t) => t.path);
        invoke<FilenameIssue[]>("analyze_filename_issues", { paths })
          .then((issues) => { if (issues.length > 0) setFilenameIssues(issues); })
          .catch(() => {});
        invoke<ParenIssue[]>("analyze_paren_content", { paths })
          .then((issues) => { if (issues.length > 0) setParenIssues(issues); })
          .catch(() => {});
        invoke<DuplicateGroup[]>("find_duplicates", { tracks: result })
          .then((groups) => { if (groups.length > 0) setDuplicateGroups(groups); })
          .catch(() => {});
      }
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

  const cleanupCount = allTracks.filter((t) => t.issues.length > 0).length;

  function autoSelectCleanup() {
    allTracks.filter((t) => t.issues.length > 0).forEach((t) => {
      if (!selectedIds.has(t.id)) useAppStore.getState().toggleSelect(t.id);
    });
    setFilterTab("problems");
  }

  return (
    <div className="flex flex-col h-screen bg-[#0E0D0C] text-[#F5F5F4] font-sans overflow-hidden">
      {/* Toolbar */}
      <div
        className="flex items-center gap-2 px-3 py-2 border-b border-white/[0.05] bg-[#23201E]"
        style={{ cursor: "default" }}
        onMouseDown={(e) => {
          const target = e.target as HTMLElement;
          if (target.closest('button, input, select, a, [role="button"]')) return;
          const isMac = navigator.platform.startsWith("Mac");
          if (isMac) {
            getCurrentWindow().startDragging().catch(() => {});
          } else {
            // Windows/Linux: dead zone de 4px para não conflitar com botão fechar nativo
            const startX = e.clientX, startY = e.clientY;
            const onMove = (mv: MouseEvent) => {
              if (Math.abs(mv.clientX - startX) > 4 || Math.abs(mv.clientY - startY) > 4) {
                cleanup();
                getCurrentWindow().startDragging().catch(() => {});
              }
            };
            const cleanup = () => {
              document.removeEventListener("mousemove", onMove);
              document.removeEventListener("mouseup", cleanup);
            };
            document.addEventListener("mousemove", onMove);
            document.addEventListener("mouseup", cleanup);
          }
        }}
      >
        {/* Espaço para os traffic lights do macOS */}
        <div className="w-20 shrink-0" />

        {/* Abrir pasta */}
        <button
          onClick={pickFolder}
          disabled={isScanning}
         
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[#D95340] hover:bg-[#E07364] active:bg-[#B34435] disabled:opacity-50 text-xs font-bold uppercase tracking-wide text-white transition-colors"
        >
          {isScanning ? (
            <>
              <svg className="animate-spin shrink-0" width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <circle cx="5.5" cy="5.5" r="4" strokeDasharray="20" strokeDashoffset="8" opacity="0.4"/>
                <path d="M5.5 1.5a4 4 0 014 4"/>
              </svg>
              {scanTotal !== null ? `${scanDone}/${scanTotal}` : "Escaneando…"}
            </>
          ) : (
            <>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M1 3.5C1 2.67 1.67 2 2.5 2H4.5L5.5 3H9.5C10.33 3 11 3.67 11 4.5V8.5C11 9.33 10.33 10 9.5 10H2.5C1.67 10 1 9.33 1 8.5V3.5Z"/>
              </svg>
              Abrir Pasta
            </>
          )}
        </button>

        {/* Quick actions */}
        <div
          className="flex items-center gap-1 ml-1"
         
        >
          {cleanupCount > 0 && (
            <button
              onClick={autoSelectCleanup}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-semibold border border-[#D95340]/30 text-[#D95340] hover:bg-[#D95340]/10 transition-colors whitespace-nowrap shrink-0"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-[#D95340] inline-block shrink-0" />
              {cleanupCount} precisam de limpeza
            </button>
          )}
          {allTracks.length > 0 && (
            <button
              onClick={batchEnrich}
              disabled={enriching || isScanning}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-semibold text-[#605A55] hover:text-[#756D67] hover:bg-white/[0.04] disabled:opacity-40 transition-colors whitespace-nowrap shrink-0"
              title="Enriquecer metadados faltantes via iTunes"
            >
              <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="5.5" cy="5.5" r="4"/>
                <path d="M5.5 3.5v2l1.5 1"/>
              </svg>
              {enriching && enrichProgress
                ? `${enrichProgress.done}/${enrichProgress.total}`
                : selectedIds.size > 0
                  ? `Enriquecer ${selectedIds.size}`
                  : "Enriquecer"}
            </button>
          )}
          {allTracks.length > 0 && (
            <button
              onClick={normalizeTags}
              disabled={normalizing}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-semibold text-[#605A55] hover:text-[#756D67] hover:bg-white/[0.04] disabled:opacity-40 transition-colors whitespace-nowrap shrink-0"
            >
              <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
                <path d="M1 3h9M3 5.5h5M4.5 8h2"/>
              </svg>
              {normalizing ? "Normalizando…" : "Normalizar Tags"}
            </button>
          )}
          {allTracks.length > 0 && (
            <div className="relative group">
              <button
                disabled={exporting}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-semibold text-[#605A55] hover:text-[#756D67] hover:bg-white/[0.04] disabled:opacity-40 transition-colors"
              >
                <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5.5 1v6M3 4l2.5-3 2.5 3"/>
                  <path d="M2 8v1.5h7V8"/>
                </svg>
                {exporting ? "Exportando…" : "Exportar"}
              </button>
              <div className="absolute top-full left-0 mt-1 py-1 bg-[#1c1917] border border-white/[0.07] rounded-md shadow-xl hidden group-hover:block z-50 min-w-[140px]">
                <button
                  onClick={exportRekordbox}
                  className="w-full px-3 py-1.5 text-left text-[11px] text-[#C2BEBC] hover:bg-white/[0.05] transition-colors"
                >
                  Rekordbox XML
                </button>
                <button
                  onClick={exportM3U}
                  className="w-full px-3 py-1.5 text-left text-[11px] text-[#C2BEBC] hover:bg-white/[0.05] transition-colors"
                >
                  Playlist M3U
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Stats */}
        {allTracks.length > 0 && (
          <span
            className="text-[11px] text-[#605A55] font-mono ml-1"
           
          >
            {allTracks.length.toLocaleString("pt-BR")} faixas
          </span>
        )}

        {/* Filter chips */}
        <div
          className="flex gap-0.5 ml-2"
         
        >
          {(
            [
              { id: "all" as const,       label: "Todas" },
              { id: "recent" as const,    label: `+ ${recentCount}` },
              { id: "favorites" as const, label: `★ ${favoriteCount}` },
              { id: "problems" as const,  label: `⚠ ${problemCount}` },
              { id: "ok" as const,        label: `✓ ${allTracks.length - problemCount}` },
            ] as { id: typeof filterTab; label: string }[]
          ).map((tab) => (
            <button
              key={tab.id}
              onClick={() => setFilterTab(tab.id)}
              className={`px-2.5 py-1 rounded-md text-[11px] font-semibold uppercase tracking-wide transition-colors ${
                filterTab === tab.id
                  ? "bg-[#D95340]/20 text-[#D95340] border border-[#D95340]/25"
                  : "text-[#605A55] hover:text-[#756D67] hover:bg-white/[0.04]"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Genre filter chip */}
        {genreFilter && (
          <div>
            <button
              onClick={() => setGenreFilter(null)}
              className="flex items-center gap-1.5 px-2 py-1 rounded-full text-[10px] font-semibold bg-[#D95340]/15 border border-[#D95340]/25 text-[#D95340]/80 hover:text-[#D95340] hover:bg-[#D95340]/20 transition-colors"
            >
              {genreFilter} ×
            </button>
          </div>
        )}

        <div className="flex-1" />

        {/* Settings */}
        <button
         
          onClick={() => setShowSettings(true)}
          title="Configurações (⌘,)"
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-semibold text-[#8F8883] hover:text-[#C2BEBC] hover:bg-white/[0.06] transition-colors border border-white/[0.06]"
        >
          <svg width="12" height="12" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="6.5" cy="6.5" r="2"/>
            <path d="M6.5 1v1.5M6.5 10.5V12M1 6.5h1.5M10.5 6.5H12M2.57 2.57l1.06 1.06M9.37 9.37l1.06 1.06M9.37 3.63L8.31 4.69M3.63 9.37L2.57 10.43"/>
          </svg>
          Configurações
        </button>

        <TrialBanner />

        {/* Compact toggle */}
        <button
         
          onClick={() => setCompact((v) => !v)}
          title={compact ? "Modo normal" : "Modo compacto"}
          className={`px-2 py-1.5 rounded-md text-xs transition-colors ${
            compact ? "bg-white/8 text-[#F5F5F4]" : "text-[#605A55] hover:text-[#8F8883] hover:bg-white/[0.04]"
          }`}
        >
          {compact ? "▤" : "▣"}
        </button>

        {/* Advanced filter + Search */}
        <div
          className="flex items-center gap-1"
         
        >
          {/* Filter popover */}
          <div className="relative" ref={advFilterRef}>
            <button
              onClick={() => setShowAdvFilter((v) => !v)}
              title="Filtro avançado"
              className={`flex items-center gap-1 px-2 py-1.5 rounded-md text-[11px] font-semibold transition-colors border ${
                isAdvFilterActive
                  ? "bg-[#D95340]/15 border-[#D95340]/35 text-[#D95340]"
                  : showAdvFilter
                  ? "bg-white/[0.06] border-white/[0.08] text-[#C2BEBC]"
                  : "border-white/[0.06] text-[#605A55] hover:text-[#8F8883] hover:bg-white/[0.04]"
              }`}
            >
              <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
                <path d="M1 2.5h9M2.5 5.5h6M4 8.5h3"/>
              </svg>
              {isAdvFilterActive && <span className="w-1.5 h-1.5 rounded-full bg-[#D95340] inline-block" />}
            </button>

            {showAdvFilter && (
              <div className="absolute right-0 top-full mt-1 bg-[#1c1715] border border-white/[0.08] rounded-lg shadow-2xl z-[200] w-64 p-3">
                <div className="flex items-center justify-between mb-2.5">
                  <p className="text-[9px] font-bold text-[#8F8883] uppercase tracking-widest">Filtro Avançado</p>
                  {isAdvFilterActive && (
                    <button
                      onClick={() => setAdvFilter({ bpmMin: "", bpmMax: "", yearMin: "", yearMax: "", key: "" })}
                      className="text-[10px] text-[#D95340] hover:text-[#E07364] transition-colors"
                    >
                      Limpar
                    </button>
                  )}
                </div>

                {/* BPM Range */}
                <div className="mb-2.5">
                  <label className="text-[9px] font-semibold text-[#605A55] uppercase tracking-widest block mb-1">BPM</label>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="number"
                      placeholder="min"
                      value={advFilter.bpmMin}
                      onChange={(e) => setAdvFilter((f) => ({ ...f, bpmMin: e.target.value }))}
                      className="w-full px-2 py-1 rounded-md bg-white/[0.04] border border-white/[0.08] text-xs text-[#C2BEBC] placeholder-[#605A55] focus:outline-none focus:border-[#D95340]/50 font-mono"
                    />
                    <span className="text-[#4C4743] text-xs">—</span>
                    <input
                      type="number"
                      placeholder="max"
                      value={advFilter.bpmMax}
                      onChange={(e) => setAdvFilter((f) => ({ ...f, bpmMax: e.target.value }))}
                      className="w-full px-2 py-1 rounded-md bg-white/[0.04] border border-white/[0.08] text-xs text-[#C2BEBC] placeholder-[#605A55] focus:outline-none focus:border-[#D95340]/50 font-mono"
                    />
                  </div>
                </div>

                {/* Year Range */}
                <div className="mb-2.5">
                  <label className="text-[9px] font-semibold text-[#605A55] uppercase tracking-widest block mb-1">Ano</label>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="number"
                      placeholder="min"
                      value={advFilter.yearMin}
                      onChange={(e) => setAdvFilter((f) => ({ ...f, yearMin: e.target.value }))}
                      className="w-full px-2 py-1 rounded-md bg-white/[0.04] border border-white/[0.08] text-xs text-[#C2BEBC] placeholder-[#605A55] focus:outline-none focus:border-[#D95340]/50 font-mono"
                    />
                    <span className="text-[#4C4743] text-xs">—</span>
                    <input
                      type="number"
                      placeholder="max"
                      value={advFilter.yearMax}
                      onChange={(e) => setAdvFilter((f) => ({ ...f, yearMax: e.target.value }))}
                      className="w-full px-2 py-1 rounded-md bg-white/[0.04] border border-white/[0.08] text-xs text-[#C2BEBC] placeholder-[#605A55] focus:outline-none focus:border-[#D95340]/50 font-mono"
                    />
                  </div>
                </div>

                {/* Key filter */}
                {availableKeys.length > 0 && (
                  <div>
                    <label className="text-[9px] font-semibold text-[#605A55] uppercase tracking-widest block mb-1">Tom</label>
                    <select
                      value={advFilter.key}
                      onChange={(e) => setAdvFilter((f) => ({ ...f, key: e.target.value }))}
                      className="w-full px-2 py-1 rounded-md bg-[#120D0B] border border-white/[0.08] text-xs text-[#C2BEBC] focus:outline-none focus:border-[#D95340]/50 font-mono"
                    >
                      <option value="">Todos</option>
                      {availableKeys.map((k) => (
                        <option key={k} value={k}>{k}</option>
                      ))}
                    </select>
                  </div>
                )}

                {isAdvFilterActive && (
                  <p className="mt-2 text-[9px] text-[#8F8883] text-center">
                    {tracks.length} de {baseFiltered.length} faixas
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="relative flex items-center">
            <svg className="absolute left-2.5 pointer-events-none shrink-0" width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="#605A55" strokeWidth="1.5" strokeLinecap="round">
              <circle cx="5.5" cy="5.5" r="4"/>
              <line x1="8.7" y1="8.7" x2="12" y2="12"/>
            </svg>
            <input
              className="w-52 pl-8 pr-3 py-1.5 rounded-md bg-white/[0.04] border border-white/[0.08] text-xs text-[#C2BEBC] placeholder-[#605A55] focus:outline-none focus:border-[#D95340]/50 focus:bg-white/[0.06] transition-colors font-mono"
              placeholder="buscar…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        <Sidebar onFolderSelect={scanFolder} />

        <div className="flex flex-col flex-1 overflow-hidden">
          {/* Filename cleanup prompt */}
          {(filenameIssues.length > 0 || parenIssues.length > 0 || duplicateGroups.length > 0) && (
            <div className="pt-2 flex flex-col gap-0">
              {filenameIssues.length > 0 && (
                <FilenamePrompt
                  issues={filenameIssues}
                  onDismiss={() => setFilenameIssues([])}
                  onFixed={(oldPath, newPath, newName) => {
                    const existing = useAppStore.getState().tracks.find((t) => t.path === oldPath);
                    if (existing) useAppStore.getState().updateTrack({ ...existing, path: newPath, filename: newName });
                    setFilenameIssues((prev) => prev.filter((i) => i.path !== oldPath));
                  }}
                />
              )}
              {parenIssues.length > 0 && (
                <ParenReviewPrompt
                  issues={parenIssues}
                  onDismiss={() => setParenIssues([])}
                  onFixed={(oldPath, newPath, newName) => {
                    const existing = useAppStore.getState().tracks.find((t) => t.path === oldPath);
                    if (existing) useAppStore.getState().updateTrack({ ...existing, path: newPath, filename: newName });
                    setParenIssues((prev) => prev.filter((i) => i.path !== oldPath));
                  }}
                />
              )}
              {duplicateGroups.length > 0 && (
                <DuplicatePrompt
                  groups={duplicateGroups}
                  onDismiss={() => setDuplicateGroups([])}
                />
              )}
            </div>
          )}
          <div className="flex flex-1 overflow-hidden relative">
            <TrackTable tracks={tracks} compact={compact} hasFolder={!!lastFolder} />
            {selectedIds.size > 0 ? (
              inspectorOverlay ? (
                <div className="absolute inset-y-0 right-0 w-[280px] z-30 bg-[#23201E] border-l border-white/[0.06] shadow-2xl flex flex-col animate-[fade-in-right_0.15s_ease-out]">
                  <Inspector />
                </div>
              ) : (
                <Inspector />
              )
            ) : allTracks.length > 0 ? (
              <LibraryStats />
            ) : null}
          </div>
        </div>
      </div>

      {(selectedIds.size > 0 || !!playerTrackId) && (
        <div style={{ animation: 'slide-up-player 0.18s ease-out' }}>
          <MiniPlayer />
        </div>
      )}

      {deleteTargets.length > 0 && (
        <DeleteConfirmDialog
          tracks={deleteTargets}
          onClose={() => setDeleteTargets([])}
        />
      )}

      <TrialExpiredModal />
      {showOnboarding && <Onboarding onComplete={() => setShowOnboarding(false)} />}
      {showSettings && <Settings onClose={() => setShowSettings(false)} />}
      <ToastContainer />

      {/* Drag & drop overlay */}
      {isDragOver && (
        <div className="fixed inset-0 z-[500] bg-[#0E0D0C]/80 flex items-center justify-center pointer-events-none">
          <div className="flex flex-col items-center gap-3 border-2 border-dashed border-[#D95340]/60 rounded-2xl px-16 py-12 bg-[#D95340]/[0.04]">
            <svg width="40" height="40" viewBox="0 0 40 40" fill="none" stroke="#D95340" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="opacity-80">
              <path d="M6 14C6 11.24 8.24 9 11 9H16L19 12H29C31.76 12 34 14.24 34 17V28C34 30.76 31.76 33 29 33H11C8.24 33 6 30.76 6 28V14Z"/>
              <path d="M20 18v8M17 23l3 3 3-3"/>
            </svg>
            <span className="text-[#D95340] text-sm font-semibold uppercase tracking-widest">Soltar para escanear</span>
          </div>
        </div>
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
