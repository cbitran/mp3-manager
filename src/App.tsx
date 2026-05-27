import { invoke } from "@tauri-apps/api/core";
import { enrichTrackFull } from "./services/SpotifyService";
import { searchTrack as iTunesSearch } from "./services/iTunesService";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open, save } from "@tauri-apps/plugin-dialog";
import { getVersion } from "@tauri-apps/api/app";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore, type Track } from "./store";
import TrackTable from "./components/TrackTable";
import Inspector from "./components/Inspector";
// import CuePointsModal from "./components/CuePointsModal"; // desativado na produção
import Sidebar from "./components/Sidebar";
import MiniPlayer from "./components/MiniPlayer";
import DeleteConfirmDialog from "./components/DeleteConfirmDialog";
import MissingMetaPrompt from "./components/MissingMetaPrompt";
import TrialExpiredModal from "./components/TrialExpiredModal";
import FirstLaunchModal from "./components/FirstLaunchModal";
import FilenamePrompt, { type FilenameIssue } from "./components/FilenamePrompt";
import FilenameMetaPrompt, { type FilenameMetaIssue } from "./components/FilenameMetaPrompt";
import DuplicatePrompt, { type DuplicateGroup } from "./components/DuplicatePrompt";
import ToastContainer, { toast } from "./components/Toast";
import ParenReviewPrompt, { type ParenIssue } from "./components/ParenReviewPrompt";
import LibraryStats from "./components/LibraryStats";
import Onboarding, { shouldShowOnboarding } from "./components/Onboarding";
import ProductTour, { shouldShowTour } from "./components/ProductTour";
import Settings from "./components/Settings";
import TrialInfoModal from "./components/TrialInfoModal";
import UpdateModal from "./components/UpdateModal";
import OfflineBanner, { useIsOnline } from "./components/OfflineBanner";
import VideoPlayerModal from "./components/VideoPlayerModal";
import EnrichResultModal from "./components/EnrichResultModal";
import AIAssistant from "./components/AIAssistant";
import FolderBrowser from "./components/FolderBrowser";
import NewTracksModal from "./components/NewTracksModal";
import NewTracksPlaylistOffer from "./components/NewTracksPlaylistOffer";
import CreatePlaylistModal from "./components/CreatePlaylistModal";
import type { PendingNewTrack } from "./store";
import { checkLicenseStatus } from "./services/LicenseService";

function loadingLabel(mode: "startup" | "closing"): string {
  const saved = localStorage.getItem("tagwave_language") ?? navigator.language;
  const lang = saved.toLowerCase();
  if (lang.startsWith("pt")) return mode === "startup" ? "carregando…" : "salvando…";
  if (lang.startsWith("es")) return mode === "startup" ? "cargando…"   : "guardando…";
  return mode === "startup" ? "loading…" : "saving…";
}

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
    isTrialActivated,
    daysRemaining,
    activateLicense,
    theme,
    fontScale,
    colorMode,
  } = useAppStore();

  const { t } = useTranslation();

  const IS_WIN = !/^Mac/.test(navigator.platform);
  const CMD = IS_WIN ? "Ctrl+" : "⌘";

  const promotePendingTracks = useAppStore((s) => s.promotePendingTracks);
  const addWatchedFolder = useAppStore((s) => s.addWatchedFolder);
  const markFolderEnriched = useAppStore((s) => s.markFolderEnriched);

  // Aplica data-theme no <html> usando a API nativa do Tauri para detectar o tema do macOS/Windows
  useEffect(() => {
    let unlisten: (() => void) | undefined;

    async function apply() {
      if (theme === "dark") {
        document.documentElement.removeAttribute("data-theme");
      } else if (theme === "light") {
        document.documentElement.setAttribute("data-theme", "light");
      } else {
        // auto: lê o tema real do sistema via Tauri (mais confiável que CSS media query em webviews)
        // dark OS → removeAttribute (igual ao "Skin"), light OS → "light"
        const applyAutoTheme = (isDark: boolean) => {
          if (isDark) document.documentElement.removeAttribute("data-theme");
          else document.documentElement.setAttribute("data-theme", "light");
        };
        try {
          const sysTheme = await getCurrentWindow().theme();
          applyAutoTheme(sysTheme !== "light");
        } catch {
          applyAutoTheme(window.matchMedia("(prefers-color-scheme: dark)").matches);
        }
        // Escuta mudanças de tema do SO em tempo real
        unlisten = await getCurrentWindow().onThemeChanged(({ payload }) => {
          applyAutoTheme(payload !== "light");
        });
      }
    }

    apply();
    return () => { unlisten?.(); };
  }, [theme]);

  // Verifica licença salva localmente ao iniciar (restaura ativação de sessões anteriores)
  useEffect(() => {
    checkLicenseStatus()
      .then((status) => {
        if (status.valid) activateLicense(status.instance_id, status.email);
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Aplica escala de fonte
  useEffect(() => {
    if (fontScale === "100") document.documentElement.removeAttribute("data-font");
    else document.documentElement.setAttribute("data-font", fontScale);
  }, [fontScale]);

  // Aplica modo de cor / acessibilidade
  useEffect(() => {
    if (colorMode === "default") document.documentElement.removeAttribute("data-color");
    else document.documentElement.setAttribute("data-color", colorMode);
  }, [colorMode]);

  // Bloqueia o menu de contexto nativo do WebView (Reload / Inspect Element)
  useEffect(() => {
    const block = (e: MouseEvent) => e.preventDefault();
    document.addEventListener("contextmenu", block);
    return () => document.removeEventListener("contextmenu", block);
  }, []);

  const allTracks = useAppStore((s) => s.tracks);
  const playerTrackId = useAppStore((s) => s.playerTrackId);
  const activePlaylistId = useAppStore((s) => s.activePlaylistId);
  const playlists = useAppStore((s) => s.playlists);
  const activePlaylist = playlists.find((p) => p.id === activePlaylistId) ?? null;
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

  const { columnVisibility, setColumnVisibility } = useAppStore();

  const HIDEABLE_COLS = [
    { id: "capa",         label: t("settings.columns.colCover") },
    { id: "album",        label: t("settings.columns.colAlbum") },
    { id: "genre",        label: t("settings.columns.colGenre") },
    { id: "artist",       label: t("settings.columns.colArtist") },
    { id: "year_col",     label: t("settings.columns.colYear") },
    { id: "status",       label: t("settings.columns.colStatus") },
    { id: "file_size",    label: t("settings.columns.colSize") },
    { id: "key",          label: t("settings.columns.colKey") },
    { id: "bpm",          label: t("settings.columns.colBpm") },
    { id: "rating",       label: t("settings.columns.colRating") },
    { id: "duration_secs",label: t("settings.columns.colDuration") },
    { id: "bitrate",      label: t("settings.columns.colBitrate") },
    { id: "tipo",         label: t("settings.columns.colType") },
    { id: "adicionada",   label: t("settings.columns.colAdded") },
    { id: "comment",      label: t("settings.columns.colComment") },
  ];
  const DEFAULT_HIDDEN_COLS = new Set(["tipo", "adicionada", "comment"]);
  const isColVisible = (id: string) =>
    id in columnVisibility ? columnVisibility[id] : !DEFAULT_HIDDEN_COLS.has(id);

  const [showColPicker, setShowColPicker] = useState(false);
  const colPickerRef = useRef<HTMLDivElement>(null);
  const [colResetToken, setColResetToken] = useState(0);

  useEffect(() => {
    if (!showColPicker) return;
    const handler = (e: MouseEvent) => {
      if (colPickerRef.current && !colPickerRef.current.contains(e.target as Node)) {
        setShowColPicker(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showColPicker]);

  const [sidebarWidth, setSidebarWidth]     = useState(240);
  const [rightPanelTab, setRightPanelTab]   = useState<"selected" | "library">("library");
  const [mediaTab, setMediaTab]             = useState<"audio" | "video">("audio");

  const VIDEO_FORMATS = new Set(["mp4", "mkv", "avi", "mov", "wmv", "webm", "m4v"]);
  const isVideo = (t: { format?: string | null }) =>
    VIDEO_FORMATS.has((t.format ?? "").toLowerCase());

  const videoCount = allTracks.filter(isVideo).length;
  const hasVideos  = videoCount > 0;

  // Filtra por playlist ativa (se houver)
  const tracksAfterPlaylist = useMemo(() => {
    if (!activePlaylist) return tracks;
    const pathSet = new Set(activePlaylist.trackPaths);
    return tracks.filter((t) => pathSet.has(t.path));
  }, [tracks, activePlaylist]);

  // Filtra por aba de mídia (Áudio / Vídeo)
  const tracksForMedia = useMemo(() =>
    mediaTab === "video" ? tracksAfterPlaylist.filter(isVideo) : tracksAfterPlaylist.filter((t) => !isVideo(t)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tracksAfterPlaylist, mediaTab]
  );

  const [deleteTargets, setDeleteTargets]   = useState<Track[]>([]);
  const [showSettings, setShowSettings]     = useState(false);
  const [compact, setCompact]               = useState(false);
  const [showRightPanel, setShowRightPanel] = useState(true);
  const [newTrackIds, setNewTrackIds]       = useState<Set<string>>(new Set());
  const [showSidebar, setShowSidebar]       = useState(true);
  const [missingMeta, setMissingMeta]       = useState<{
    missingGenre: number; missingYear: number; missingAlbum: number;
    bitrateHigh: number; bitrateMid: number; bitrateLow: number;
  } | null>(null);
  const [filenameIssues, setFilenameIssues] = useState<FilenameIssue[]>([]);
  const [filenameMetaIssues, setFilenameMetaIssues] = useState<FilenameMetaIssue[]>([]);
  const [parenIssues, setParenIssues] = useState<ParenIssue[]>([]);
  const [duplicateGroups, setDuplicateGroups] = useState<DuplicateGroup[]>([]);
  const [normalizing, setNormalizing]     = useState(false);
  const [exporting, setExporting]         = useState(false);
  const pendingBpmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [enriching, setEnriching]         = useState(false);
  const [enrichProgress, setEnrichProgress] = useState<{ done: number; total: number } | null>(null);
  const [scanTotal, setScanTotal]       = useState<number | null>(null);
  const [scanDone, setScanDone]         = useState<number>(0);
  const [windowWidth, setWindowWidth]   = useState(window.innerWidth);
  const [isDragOver, setIsDragOver]     = useState(false);
  const [ghostFolders, setGhostFolders]         = useState<string[]>([]);
  const [videoTrack, setVideoTrack]             = useState<Track | null>(null);
  const [enrichingIds, setEnrichingIds]         = useState<Set<string>>(new Set());
  const [enrichDoneIds, setEnrichDoneIds]       = useState<Set<string>>(new Set());
  const [enrichUndoSnapshot, setEnrichUndoSnapshot] = useState<Track[] | null>(null);
  const [enrichResultModal, setEnrichResultModal] = useState<{ total: number; enriched: number; covers: number; folderName: string } | null>(null);
  const [analyzingBpmIds, setAnalyzingBpmIds]   = useState<Set<string>>(new Set());
  const [bpmDoneIds, setBpmDoneIds]             = useState<Set<string>>(new Set());
  const [analyzingBpm, setAnalyzingBpm]         = useState(false);
  const [bpmProgress, setBpmProgress]           = useState<{ done: number; total: number } | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(() => shouldShowOnboarding());
  const [showTour, setShowTour] = useState(() => !shouldShowOnboarding() && shouldShowTour());

  type DjSoftwareInfo = { id: string; name: string; installed: boolean };
  const [installedDj, setInstalledDj] = useState<DjSoftwareInfo[]>([]);
  const [tourPlayerVisible, setTourPlayerVisible] = useState(false);
  const [searchExpanded, setSearchExpanded] = useState(false);
  const [showOfflineBanner, setShowOfflineBanner] = useState(false);
  const [browsePath, setBrowsePath] = useState<string | null>(null);
  const isOnline = useIsOnline();
  // Fecha o banner automaticamente quando a conexão voltar
  useEffect(() => { if (isOnline) setShowOfflineBanner(false); }, [isOnline]);

  // Auto-reset filterTab quando o tab ativo fica vazio
  useEffect(() => {
    if (filterTab === "favorites" && favoriteCount === 0) setFilterTab("all");
    if (filterTab === "problems" && problemCount === 0) setFilterTab("all");
    if (filterTab === "recent" && recentCount === 0) setFilterTab("all");
  }, [favoriteCount, problemCount, recentCount, filterTab, setFilterTab]);

  const isBusyRef = useRef(false);

  // Estado dos modais de novas faixas
  const [newTracksModal, setNewTracksModal] = useState<Track[] | null>(null);
  const [playlistOffer, setPlaylistOffer]   = useState<Track[] | null>(null);
  const [createPlaylistTracks, setCreatePlaylistTracks] = useState<Track[] | null>(null);
  const [exportPlaylistTarget, setExportPlaylistTarget] = useState<import("./store").Playlist | null>(null);

  useEffect(() => {
    const handleResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Garante largura mínima na abertura (macOS restaura tamanho salvo, ignorando tauri.conf)
  useEffect(() => {
    const MIN_W = 1340;
    if (window.innerWidth < MIN_W) {
      import("@tauri-apps/api/dpi").then(({ LogicalSize }) => {
        getCurrentWindow().setSize(new LogicalSize(MIN_W, Math.max(window.innerHeight, 820))).catch(() => {});
      }).catch(() => {});
    }
  }, []);

  useEffect(() => {
    invoke<DjSoftwareInfo[]>("detect_dj_software")
      .then((list) => setInstalledDj(list.filter((sw) => sw.installed)))
      .catch(() => {});
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
          const droppedPath = paths[0];
          const fileName = droppedPath.split("/").pop() ?? droppedPath;
          const lastDot = fileName.lastIndexOf(".");
          const ext = lastDot > 0 ? fileName.slice(lastDot + 1).toLowerCase() : "";
          const ALLOWED = new Set(["mp3","flac","aiff","aif","wav","m4a","mp4","aac",
            "ogg","opus","wma","mkv","avi","mov","wmv","webm","m4v","mpeg","mpg","mp2","wv"]);
          if (ext && !ALLOWED.has(ext)) {
            toast("Apenas arquivos de áudio/vídeo ou pastas são aceitos.", "info");
            return;
          }
          scanFolder(droppedPath);
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
      toast(changed > 0 ? t("toolbar.toast.normalized", { count: changed }) : t("toolbar.toast.alreadyNormalized"), changed > 0 ? "success" : "info");
    } finally {
      setNormalizing(false);
    }
  }

  // Retorna as faixas a exportar: seleção > playlist ativa > null (bloqueia)
  function getExportTargets(): Track[] | null {
    const fresh = useAppStore.getState();
    if (fresh.selectedIds.size > 0) {
      return fresh.tracks.filter((t) => fresh.selectedIds.has(t.id));
    }
    if (activePlaylist) {
      const paths = new Set(activePlaylist.trackPaths);
      return fresh.tracks.filter((t) => paths.has(t.path));
    }
    return null;
  }

  function requireExportTargets(): Track[] | null {
    const targets = getExportTargets();
    if (!targets) {
      toast(t("toolbar.selectToExport"), "info");
    }
    return targets;
  }

  async function exportM3U() {
    const targets = requireExportTargets();
    if (!targets) return;
    const outPath = await save({
      defaultPath: "TagWave_Playlist.m3u",
      filters: [{ name: "Playlist M3U", extensions: ["m3u"] }],
    });
    if (!outPath) return;
    setExporting(true);
    try {
      const m3uCount = await invoke<number>("export_m3u", { tracks: targets, outputPath: outPath });
      toast(t("toolbar.toast.m3uCreated", { count: m3uCount }));
    } finally {
      setExporting(false);
    }
  }

  async function exportCsv() {
    const targets = requireExportTargets();
    if (!targets) return;
    const outPath = await save({
      defaultPath: "TagWave_Export.csv",
      filters: [{ name: "CSV", extensions: ["csv"] }],
    });
    if (!outPath) return;
    setExporting(true);
    try {
      const count = await invoke<number>("export_csv", { tracks: targets, outputPath: outPath });
      toast(t("toolbar.toast.csvExported", { count }));
    } finally {
      setExporting(false);
    }
  }

  async function exportToDj(softwareId: string) {
    const targets = requireExportTargets();
    if (!targets) return;
    const folderName = lastFolder ? lastFolder.split(/[\\/]/).filter(Boolean).pop() ?? "TagWave" : "TagWave";
    setExporting(true);
    try {
      await invoke("export_playlist_to_dj", {
        playlistName: folderName,
        softwareId,
        tracks: targets,
      });
      const swName = installedDj.find((sw) => sw.id === softwareId)?.name ?? softwareId;
      toast(t("toolbar.toast.exportedDj", { count: targets.length, software: swName }));
    } catch (err) {
      toast(t("toolbar.toast.exportError", { error: String(err) }), "error");
    } finally {
      setExporting(false);
    }
  }

  // Parseia "Artista - Título [Ano].mp3" → { artist, title, year }
  function parseFilenamePattern(filename: string) {
    const base = filename.replace(/\.[^.]+$/, ""); // remove extensão
    const dashIdx = base.indexOf(" - ");
    if (dashIdx === -1) return null;
    const artist = base.slice(0, dashIdx).trim();
    let rest = base.slice(dashIdx + 3).trim();
    const yearMatch = rest.match(/\s*\[(\d{4})\]\s*$/);
    const year = yearMatch ? parseInt(yearMatch[1]) : null;
    const title = rest.replace(/\s*\[\d{4}\]\s*$/, "").trim();
    if (!artist || !title) return null;
    return { artist, title, year };
  }

  const [restoringFromName, setRestoringFromName] = useState(false);

  async function restoreFromFilename() {
    const targets = selectedIds.size > 0
      ? allTracks.filter((t) => selectedIds.has(t.id))
      : allTracks;
    const parseable = targets.filter((t) => parseFilenamePattern(t.filename) !== null);
    if (parseable.length === 0) {
      toast(t("toolbar.noTrackWithPattern"), "info");
      return;
    }
    setRestoringFromName(true);
    let restored = 0;
    const restoredIds = new Set<string>();
    try {
      for (const track of parseable) {
        const parsed = parseFilenamePattern(track.filename)!;
        await invoke("save_tags", {
          path: track.path,
          title: parsed.title,
          artist: parsed.artist,
          album: null,
          genre: null,
          year: parsed.year,
          trackNumber: null, totalTracks: null, bpm: null, key: null, rating: null, comment: null,
        }).catch((e) => console.error("[parse-filename] save_tags:", e));
        const updatedIssues = track.issues.filter((issue) => {
          if (issue === "sem artista" && parsed.artist) return false;
          if (issue === "sem título" && parsed.title) return false;
          return true;
        });
        useAppStore.getState().updateTrack({
          ...track,
          title: parsed.title,
          artist: parsed.artist,
          year: parsed.year ?? track.year,
          issues: updatedIssues,
        });
        restoredIds.add(track.id);
        restored++;
      }
      // Desseleciona as faixas que foram restauradas
      useAppStore.setState((s) => ({
        selectedIds: new Set([...s.selectedIds].filter((id) => !restoredIds.has(id))),
      }));
      toast(t("toolbar.toast.restored", { count: restored }), "success");
    } finally {
      setRestoringFromName(false);
    }
  }

  async function undoEnrich() {
    if (!enrichUndoSnapshot) return;
    const snapshot = enrichUndoSnapshot;
    setEnrichUndoSnapshot(null);
    setEnriching(true);
    try {
      for (const orig of snapshot) {
        await invoke("save_tags", {
          path: orig.path, title: orig.title ?? null, artist: orig.artist ?? null,
          album: orig.album ?? null, genre: orig.genre ?? null, year: orig.year ?? null,
          trackNumber: orig.track_number ?? null, totalTracks: orig.total_tracks ?? null,
          bpm: orig.bpm ?? null, key: orig.key ?? null, rating: orig.rating ?? null,
          comment: orig.comment ?? null,
        }).catch((e) => console.error("[undo-enrich] save_tags:", e));
        useAppStore.getState().updateTrack(orig);
      }
      toast(t("toolbar.toast.restored", { count: snapshot.length }), "success");
    } finally {
      setEnriching(false);
    }
  }

  async function batchEnrich(source: "all" | "itunes" | "spotify" = "all", folderPath?: string, explicitTrackId?: string) {
    if (!navigator.onLine) {
      setShowOfflineBanner(true);
      setTimeout(() => setShowOfflineBanner(false), 4000);
      return;
    }

    const freshTracks = useAppStore.getState().tracks;

    // Prioridade 1: ID explícito de uma única faixa (context menu em faixa não selecionada)
    if (explicitTrackId) {
      const single = freshTracks.find((t) => t.id === explicitTrackId);
      const targets = single ? [single] : [];
      if (targets.length === 0) { toast(t("toolbar.toast.trackNotFound"), "info"); return; }
      const isExplicitSelection = true;
      return runEnrich(source, targets, isExplicitSelection, freshTracks, undefined);
    }

    // Prioridade 2: faixas selecionadas no store
    const freshSelectedIds = useAppStore.getState().selectedIds;
    const selected = freshTracks.filter((t) => freshSelectedIds.has(t.id));
    const isExplicitSelection = selected.length > 0;

    // Prioridade 3 (fallback): pasta específica ou faixas com metadados incompletos
    let targets: Track[];
    if (isExplicitSelection) {
      targets = selected;
    } else if (folderPath) {
      const prefix = folderPath.endsWith("/") || folderPath.endsWith("\\") ? folderPath : folderPath + "/";
      targets = freshTracks.filter((t) => t.path.startsWith(prefix) && (!t.genre || !t.album || !t.year));
    } else {
      targets = freshTracks.filter((t) => !t.genre || !t.album || !t.year);
    }
    if (targets.length === 0) { toast(t("toolbar.toast.allMetaComplete"), "info"); return; }
    return runEnrich(source, targets, isExplicitSelection, freshTracks, folderPath);
  }

  async function runEnrich(source: "all" | "itunes" | "spotify", targets: Track[], isExplicitSelection: boolean, _freshTracks: Track[], folderPath?: string) {

    setEnrichUndoSnapshot([...targets]);
    setEnriching(true);
    setEnrichProgress({ done: 0, total: targets.length });

    // ── iTunes-only (JS direto, mais transparente que Rust batch) ─────────────
    if (source === "itunes") {
      let found = 0, enriched = 0;
      try {
        for (let i = 0; i < targets.length; i++) {
          const track = targets[i];
          setEnrichingIds(new Set([track.id]));
          try {
            const result = await iTunesSearch(track.title ?? track.filename, track.artist ?? "");
            if (result) {
              found++;
              const cur = useAppStore.getState().tracks.find((t) => t.path === track.path);
              if (cur) {
                const newGenre = result.genre || null;
                const newAlbum = result.album || null;
                const newYear = result.year ? parseInt(result.year) : null;
                const apiFoundSomething = newGenre !== null || newAlbum !== null || newYear !== null;
                const hasGap = !!(newGenre && !cur.genre) || !!(newAlbum && !cur.album) || !!(newYear && !cur.year);
                if (isExplicitSelection ? apiFoundSomething : hasGap) {
                  const resolvedGenre = newGenre ?? cur.genre;
                  const updatedIssues = cur.issues.filter(i =>
                    !(i === "sem gênero" && resolvedGenre)
                  );
                  const updated = { ...cur, genre: resolvedGenre, album: newAlbum ?? cur.album, year: newYear ?? cur.year, issues: updatedIssues };
                  await invoke("save_tags", { path: updated.path, title: updated.title ?? null, artist: updated.artist ?? null, album: updated.album ?? null, genre: updated.genre ?? null, year: updated.year ?? null, trackNumber: updated.track_number ?? null, totalTracks: updated.total_tracks ?? null, bpm: updated.bpm ?? null, key: updated.key ?? null, rating: updated.rating ?? null, comment: updated.comment ?? null }).catch((e) => console.error("[enrich-itunes] save_tags:", e));
                  useAppStore.getState().updateTrack(updated);
                  enriched++;
                }
                if (result.artworkUrl && (isExplicitSelection || !cur.has_cover)) {
                  const ok = await Promise.race([
                    invoke("save_cover", { path: track.path, coverUrl: result.artworkUrl }).then(() => true).catch(() => false),
                    new Promise<boolean>((res) => setTimeout(() => res(false), 10000)),
                  ]);
                  if (ok) {
                    const fresh = useAppStore.getState().tracks.find((t) => t.path === track.path);
                    if (fresh) useAppStore.getState().updateTrack({ ...fresh, has_cover: true, cover_version: (fresh.cover_version ?? 0) + 1, issues: fresh.issues.filter((ii) => ii !== "sem capa") });
                  }
                }
              }
            }
          } catch { /* pula */ }
          setEnrichingIds(new Set());
          setEnrichDoneIds((prev) => new Set([...prev, track.id]));
          setTimeout(() => {
            setEnrichDoneIds((prev) => { const n = new Set(prev); n.delete(track.id); return n; });
          }, 700);
          setEnrichProgress({ done: i + 1, total: targets.length });
          if (i < targets.length - 1) await new Promise<void>((res) => setTimeout(res, 250));
        }
        toast(
          found > 0
            ? t("toolbar.toast.enrichItunes", { found, total: targets.length, enriched })
            : t("toolbar.toast.enrichItunesNone", { total: targets.length }),
          found > 0 ? "success" : "info",
          found > 0 ? { label: t("toolbar.toast.undo"), fn: undoEnrich } : undefined,
        );
        if (enriched > 0) useAppStore.getState().recordEnrichment(enriched);
      } finally {
        setEnriching(false); setEnrichProgress(null); setEnrichingIds(new Set());
      }
      return;
    }

    // ── Spotify-only ──────────────────────────────────────────────────────────
    if (source === "spotify") {
      let found = 0, enriched = 0;
      try {
        for (let i = 0; i < targets.length; i++) {
          const track = targets[i];
          setEnrichingIds(new Set([track.id]));
          try {
            const sp = await enrichTrackFull(track.title ?? track.filename, track.artist ?? "");
            if (sp) {
              found++;
              const cur = useAppStore.getState().tracks.find((t) => t.path === track.path);
              if (cur) {
                const newAlbum = sp.album || null;
                const newYear = sp.year ? parseInt(sp.year) : null;
                const newBpm = sp.features?.bpm ?? null;
                const newKey = sp.features?.key ?? null;
                const apiFoundSomething = newAlbum !== null || newYear !== null || newBpm !== null || newKey !== null;
                const hasGap = !!(newAlbum && !cur.album) || !!(newYear && !cur.year) || !!(newBpm && !cur.bpm) || !!(newKey && !cur.key);
                if (isExplicitSelection ? apiFoundSomething : hasGap) {
                  const resolvedBpm = newBpm ?? cur.bpm;
                  const updatedIssues = cur.issues.filter(i =>
                    !(i === "sem BPM" && resolvedBpm)
                  );
                  const updated = { ...cur, album: newAlbum ?? cur.album, year: newYear ?? cur.year, bpm: resolvedBpm, key: newKey ?? cur.key, issues: updatedIssues };
                  await invoke("save_tags", { path: updated.path, title: updated.title ?? null, artist: updated.artist ?? null, album: updated.album ?? null, genre: updated.genre ?? null, year: updated.year ?? null, trackNumber: updated.track_number ?? null, totalTracks: updated.total_tracks ?? null, bpm: updated.bpm ?? null, key: updated.key ?? null, rating: updated.rating ?? null, comment: updated.comment ?? null }).catch((e) => console.error("[enrich-spotify] save_tags:", e));
                  useAppStore.getState().updateTrack(updated);
                  enriched++;
                }
                if (sp.coverUrl && (isExplicitSelection || !cur.has_cover)) {
                  const ok = await Promise.race([
                    invoke("save_cover", { path: track.path, coverUrl: sp.coverUrl }).then(() => true).catch(() => false),
                    new Promise<boolean>((res) => setTimeout(() => res(false), 10000)),
                  ]);
                  if (ok) {
                    const fresh = useAppStore.getState().tracks.find((t) => t.path === track.path);
                    if (fresh) useAppStore.getState().updateTrack({ ...fresh, has_cover: true, cover_version: (fresh.cover_version ?? 0) + 1, issues: fresh.issues.filter((ii) => ii !== "sem capa") });
                  }
                }
              }
            }
          } catch { /* pula */ }
          setEnrichingIds(new Set());
          setEnrichDoneIds((prev) => new Set([...prev, track.id]));
          setTimeout(() => {
            setEnrichDoneIds((prev) => { const n = new Set(prev); n.delete(track.id); return n; });
          }, 700);
          setEnrichProgress({ done: i + 1, total: targets.length });
          if (i < targets.length - 1) await new Promise<void>((res) => setTimeout(res, 350));
        }
        toast(
          found > 0
            ? t("toolbar.toast.enrichSpotify", { found, total: targets.length, enriched })
            : t("toolbar.toast.enrichSpotifyNone", { total: targets.length }),
          found > 0 ? "success" : "info",
          found > 0 ? { label: t("toolbar.toast.undo"), fn: undoEnrich } : undefined,
        );
        if (enriched > 0) useAppStore.getState().recordEnrichment(enriched);
      } finally {
        setEnriching(false); setEnrichProgress(null); setEnrichingIds(new Set());
      }
      return;
    }

    // ── All services: iTunes + Spotify combinados ────────────────────────────
    const coverStats = { count: 0 };
    const coverPromises: Promise<void>[] = [];
    let found = 0, enriched = 0;

    try {
      for (let i = 0; i < targets.length; i++) {
        const track = targets[i];
        setEnrichingIds(new Set([track.id]));

        try {
          const cur = useAppStore.getState().tracks.find((t) => t.path === track.path);
          if (!cur) { setEnrichingIds(new Set()); continue; }

          // Detecta o que está faltando nesta faixa
          const needsGenre = !cur.genre;
          const needsAlbum = !cur.album;
          const needsYear  = !cur.year;
          const needsBpm   = !cur.bpm;
          const needsKey   = !cur.key;
          const needsCover = !cur.has_cover;

          // Pula completamente se já tem tudo
          if (!needsGenre && !needsAlbum && !needsYear && !needsBpm && !needsKey && !needsCover) {
            setEnrichingIds(new Set());
            setEnrichProgress({ done: i + 1, total: targets.length });
            continue;
          }

          let newGenre: string | null = cur.genre ?? null;
          let newAlbum: string | null = cur.album ?? null;
          let newYear:  number | null = cur.year  ?? null;
          let newBpm:   string | null = cur.bpm   ?? null;
          let newKey:   string | null = cur.key   ?? null;
          let coverUrl: string | null = null;
          let serviceFound = false;

          // 1. iTunes: gênero, álbum, ano, capa — só chama se precisar de algum desses
          if (needsGenre || needsAlbum || needsYear || needsCover) {
            try {
              const iTResult = await iTunesSearch(track.title ?? track.filename, track.artist ?? "");
              if (iTResult) {
                serviceFound = true;
                if (!newGenre && iTResult.genre) newGenre = iTResult.genre;
                if (!newAlbum && iTResult.album) newAlbum = iTResult.album;
                if (!newYear  && iTResult.year)  newYear  = parseInt(iTResult.year);
                if (needsCover && iTResult.artworkUrl) coverUrl = iTResult.artworkUrl;
              }
            } catch { /* pula */ }
          }

          // 2. Spotify: BPM, tom, álbum, ano, capa — só chama se ainda há lacunas
          const stillNeedsSpotify = needsBpm || needsKey || (!newAlbum && needsAlbum) || (!newYear && needsYear) || (needsCover && !coverUrl);
          if (stillNeedsSpotify) {
            try {
              const sp = await enrichTrackFull(track.title ?? track.filename, track.artist ?? "");
              if (sp) {
                serviceFound = true;
                if (!newBpm   && sp.features?.bpm)              newBpm   = sp.features.bpm;
                if (!newKey   && sp.features?.key)              newKey   = sp.features.key;
                if (!newAlbum && sp.album)                      newAlbum = sp.album;
                if (!newYear  && sp.year)                       newYear  = parseInt(sp.year);
                if (needsCover && !coverUrl && sp.coverUrl)     coverUrl = sp.coverUrl;
              }
            } catch { /* pula */ }
          }

          if (serviceFound) found++;

          const hasNewMeta =
            newGenre !== (cur.genre ?? null) ||
            newAlbum !== (cur.album ?? null) ||
            newYear  !== (cur.year  ?? null) ||
            newBpm   !== (cur.bpm   ?? null) ||
            newKey   !== (cur.key   ?? null);

          if (hasNewMeta) {
            const resolvedGenre = newGenre ?? cur.genre;
            const resolvedBpm   = newBpm   ?? cur.bpm;
            const updatedIssues = cur.issues.filter(i =>
              !(i === "sem gênero" && resolvedGenre) &&
              !(i === "sem BPM"    && resolvedBpm)
            );
            const updated = {
              ...cur,
              genre: resolvedGenre,
              album: newAlbum ?? cur.album,
              year:  newYear  ?? cur.year,
              bpm:   resolvedBpm,
              key:   newKey   ?? cur.key,
              issues: updatedIssues,
            };
            await invoke("save_tags", {
              path: updated.path,
              title: updated.title ?? null, artist: updated.artist ?? null,
              album: updated.album ?? null, genre: updated.genre ?? null,
              year: updated.year ?? null, trackNumber: updated.track_number ?? null,
              totalTracks: updated.total_tracks ?? null, bpm: updated.bpm ?? null,
              key: updated.key ?? null, rating: updated.rating ?? null,
              comment: updated.comment ?? null,
            }).catch((e) => console.error("[enrich-main] save_tags:", e));
            useAppStore.getState().updateTrack(updated);
            enriched++;
          }

          // Capa em background: começa a baixar enquanto buscamos metadados da próxima faixa
          if (coverUrl && !cur.has_cover) {
            const p = invoke("save_cover", { path: track.path, coverUrl })
              .then(() => {
                const fresh = useAppStore.getState().tracks.find((t) => t.path === track.path);
                if (fresh) {
                  useAppStore.getState().updateTrack({
                    ...fresh,
                    has_cover: true,
                    cover_version: (fresh.cover_version ?? 0) + 1,
                    issues: fresh.issues.filter((ii) => ii !== "sem capa"),
                  });
                  coverStats.count++;
                }
              })
              .catch(() => {});
            coverPromises.push(p);
          }
        } catch { /* pula */ }

        setEnrichingIds(new Set());
        setEnrichDoneIds((prev) => new Set([...prev, track.id]));
        setTimeout(() => {
          setEnrichDoneIds((prev) => { const n = new Set(prev); n.delete(track.id); return n; });
        }, 700);
        setEnrichProgress({ done: i + 1, total: targets.length });
        if (i < targets.length - 1) await new Promise<void>((res) => setTimeout(res, 400));
      }

      // Aguarda capas (disparadas em background durante o loop de metadados)
      await Promise.allSettled(coverPromises);

      const parts: string[] = [];
      if (found > 0)            parts.push(`${found}/${targets.length} ${t("toolbar.toast.enrichFoundLabel")}`);
      if (enriched > 0)         parts.push(`${enriched} ${t("toolbar.toast.enrichEnrichedLabel")}`);
      if (coverStats.count > 0) parts.push(`${coverStats.count} ${t("toolbar.toast.enrichCoversLabel")}`);

      if (enriched > 0) useAppStore.getState().recordEnrichment(enriched);

      // Encadear análise de BPM para faixas que ainda não têm BPM após enriquecimento
      const stillNoBpm = targets.filter((track) => {
        const fresh = useAppStore.getState().tracks.find((s) => s.path === track.path);
        return !fresh?.bpm;
      });
      if (stillNoBpm.length > 0) {
        parts.push(`${stillNoBpm.length} ${t("toolbar.toast.enrichPendingLabel")}`);
        if (pendingBpmTimerRef.current) clearTimeout(pendingBpmTimerRef.current);
        pendingBpmTimerRef.current = setTimeout(() => batchAnalyzeBpm(stillNoBpm), 800);
      }

      if (folderPath) {
        // Modo pasta: exibe modal de resultado em vez de toast
        const folderName = folderPath.split(/[\\/]/).filter(Boolean).pop() ?? folderPath;
        setEnrichResultModal({ total: targets.length, enriched, covers: coverStats.count, folderName });
      } else {
        toast(
          parts.length > 0
            ? `${t("toolbar.toast.enrichBothPrefix")} ${parts.join(" · ")}`
            : t("toolbar.toast.noNewData"),
          enriched > 0 ? "success" : "info",
          enriched > 0 ? { label: t("toolbar.toast.undo"), fn: undoEnrich } : undefined,
        );
      }
    } finally {
      setEnriching(false);
      setEnrichProgress(null);
      setEnrichingIds(new Set());
    }
  }

  async function batchAnalyzeBpm(overrideTracks?: Track[]) {
    const audioOnly = (t: Track) => !VIDEO_FORMATS.has((t.format ?? "").toLowerCase());
    let targets: Track[];
    if (overrideTracks) {
      targets = overrideTracks.filter(audioOnly);
    } else {
      const selected = allTracks.filter((t) => selectedIds.has(t.id));
      targets = (selected.length > 0 ? selected : allTracks).filter(audioOnly);
    }

    if (targets.length === 0) {
      toast(t("toolbar.toast.noAudioTracks"), "info");
      return;
    }

    setAnalyzingBpm(true);
    setBpmProgress({ done: 0, total: targets.length });
    let analyzed = 0;

    try {
      for (let i = 0; i < targets.length; i++) {
        const track = targets[i];

        setAnalyzingBpmIds(new Set([track.id]));

        try {
          const bpm = await Promise.race([
            invoke<number | null>("analyze_bpm", {
              path: track.path,
              durationSecs: track.duration_secs ?? 0,
            }),
            new Promise<null>((res) => setTimeout(() => res(null), 20000)),
          ]);
          if (bpm !== null) {
            const bpmStr = bpm % 1 === 0 ? String(bpm) : bpm.toFixed(1);
            // Sempre lê a versão mais recente da faixa para não sobrescrever campos enriquecidos
            const fresh = useAppStore.getState().tracks.find((t2) => t2.path === track.path) ?? track;
            // Se a faixa não tem key, tenta obter do Spotify (credenciais padrão embutidas)
            let resolvedKey = fresh.key ?? null;
            if (!resolvedKey && (fresh.title || fresh.artist)) {
              try {
                const sp = await enrichTrackFull(fresh.title ?? fresh.filename, fresh.artist ?? "");
                resolvedKey = sp?.features?.key ?? null;
              } catch { /* sem key — não bloqueia */ }
            }
            await invoke("save_tags", {
              path: fresh.path,
              title: fresh.title ?? null, artist: fresh.artist ?? null,
              album: fresh.album ?? null, genre: fresh.genre ?? null,
              year: fresh.year ?? null, trackNumber: fresh.track_number ?? null,
              totalTracks: fresh.total_tracks ?? null, bpm: bpmStr,
              key: resolvedKey, rating: fresh.rating ?? null,
              comment: fresh.comment ?? null,
            }).catch((e) => console.error("[bpm-analysis] save_tags:", e));
            useAppStore.getState().updateTrack({ ...fresh, bpm: bpmStr, key: resolvedKey ?? fresh.key });
            analyzed++;
          }
        } catch { /* pula faixas com erro */ }

        setAnalyzingBpmIds(new Set());
        setBpmDoneIds((prev) => new Set([...prev, track.id]));
        setTimeout(() => {
          setBpmDoneIds((prev) => { const n = new Set(prev); n.delete(track.id); return n; });
        }, 700);

        setBpmProgress({ done: i + 1, total: targets.length });
      }
      toast(
        analyzed > 0
          ? t("toolbar.toast.bpmAnalyzed", { count: analyzed })
          : t("toolbar.toast.noBpmDetected"),
        analyzed > 0 ? "success" : "info",
      );
    } finally {
      setAnalyzingBpm(false);
      setBpmProgress(null);
      setAnalyzingBpmIds(new Set());
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

  function checkFilenameMetaIssues(loaded: Track[]) {
    const issues: FilenameMetaIssue[] = [];
    for (const track of loaded) {
      if (track.artist && track.title) continue;
      const basename = track.path.split("/").pop()?.split("\\").pop() ?? "";
      const nameNoExt = basename.replace(/\.[^.]+$/, "");
      const sep = nameNoExt.indexOf(" - ");
      if (sep <= 0) continue;
      const part1 = nameNoExt.slice(0, sep).trim();
      const part2 = nameNoExt.slice(sep + 3).trim();
      if (!part1 || !part2) continue;
      issues.push({
        path: track.path,
        filename: basename,
        extractedArtist: part1,
        extractedTitle: part2,
        missingArtist: !track.artist,
        missingTitle: !track.title,
      });
    }
    if (issues.length > 0) {
      setTimeout(() => setFilenameMetaIssues(issues), 800);
    }
  }

  async function filterNumericPrefixIssues(issues: FilenameIssue[], tracks: Track[]): Promise<FilenameIssue[]> {
    const trackMap = new Map(tracks.map((t) => [t.path, t]));
    const results = await Promise.all(
      issues.map(async (issue) => {
        if (!issue.tags.includes("prefixo numérico")) return issue;
        const numMatch = issue.current.match(/^(\d+)/);
        if (!numMatch) return issue;
        const stripped = numMatch[1];
        // 1. Check ID3 artist metadata
        const track = trackMap.get(issue.path);
        if (track?.artist) {
          const artistNum = track.artist.match(/^(\d+)/);
          if (artistNum && artistNum[1] === stripped) return null;
        }
        // 2. Parse filename: "ARTIST - TITLE.ext" → check if ARTIST starts with number
        const nameNoExt = issue.current.replace(/\.[^.]+$/, "");
        const dashIdx = nameNoExt.indexOf(" - ");
        if (dashIdx > 0) {
          const potentialArtist = nameNoExt.slice(0, dashIdx).trim();
          if (/^\d/.test(potentialArtist)) {
            try {
              const potentialTitle = nameNoExt.slice(dashIdx + 3).trim();
              const result = await iTunesSearch(potentialTitle, potentialArtist);
              if (result?.artistName) {
                const resNum = result.artistName.match(/^(\d+)/);
                if (resNum && resNum[1] === stripped) return null;
              }
            } catch { /* keep issue if lookup fails */ }
          }
        }
        return issue;
      })
    );
    return results.filter((r): r is FilenameIssue => r !== null);
  }

  function checkMissingMeta(loaded: Track[]) {
    if (loaded.length < 5) return;
    // Não mostra modal se enriquecimento já foi tentado nesta pasta
    const folder = useAppStore.getState().lastFolder;
    if (folder && useAppStore.getState().enrichedFolders.includes(folder)) return;
    const missingGenre  = loaded.filter((t) => !t.genre).length;
    const missingYear   = loaded.filter((t) => !t.year).length;
    const missingAlbum  = loaded.filter((t) => !t.album).length;
    const total = missingGenre + missingYear + missingAlbum;
    const bitrateHigh = loaded.filter((t) => (t.bitrate_kbps ?? 0) >= 320).length;
    const bitrateMid  = loaded.filter((t) => { const b = t.bitrate_kbps ?? 0; return b >= 192 && b < 320; }).length;
    const bitrateLow  = loaded.filter((t) => { const b = t.bitrate_kbps ?? 0; return b > 0 && b < 192; }).length;
    if (total > (loaded.length * 3) / 4) {
      setTimeout(
        () => setMissingMeta({ missingGenre, missingYear, missingAlbum, bitrateHigh, bitrateMid, bitrateLow }),
        600
      );
    }
  }

  async function scanFolder(folder: string) {
    setLastFolder(folder);
    addWatchedFolder(folder);
    setScanning(true);
    setScanTotal(null);
    setScanDone(0);
    setFilenameIssues([]);
    setFilenameMetaIssues([]);
    setParenIssues([]);
    setDuplicateGroups([]);
    setGenreFilter(null);
    setNewTrackIds(new Set());
    if (pendingBpmTimerRef.current) { clearTimeout(pendingBpmTimerRef.current); pendingBpmTimerRef.current = null; }

    const unlistenSkipped = await listen<{ count: number }>("scan_skipped", ({ payload }) => {
      const n = payload.count;
      toast(t("toolbar.toast.unsupported", { count: n }), "info");
    });

    try {
      const result = await invoke<Track[]>("scan_folder", { folder });
      setTracks(result);
      recordScan(result.length);
      checkMissingMeta(result);
      checkFilenameMetaIssues(result);

      // Background analysis
      if (result.length > 0) {
        const paths = result.map((t) => t.path);
        invoke<FilenameIssue[]>("analyze_filename_issues", { paths })
          .then((raw) => filterNumericPrefixIssues(raw, result))
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
      unlistenSkipped();
      setScanning(false);
    }
  }

  async function pickFolder() {
    const folder = await open({ directory: true, multiple: false });
    if (!folder || typeof folder !== "string") return;
    await scanFolder(folder);
  }

  async function loadAllFolders() {
    const folders = useAppStore.getState().recentFolders;
    if (folders.length === 0) { toast("Nenhuma pasta na biblioteca", "info"); return; }
    setScanning(true);
    setScanTotal(null);
    setScanDone(0);
    setFilenameIssues([]);
    setFilenameMetaIssues([]);
    setParenIssues([]);
    setDuplicateGroups([]);
    setGenreFilter(null);
    setNewTrackIds(new Set());
    useAppStore.setState({ lastFolder: null });

    try {
      const combined: Track[] = [];
      const seen = new Set<string>();
      for (const folder of folders) {
        try {
          const result = await invoke<Track[]>("scan_folder", { folder });
          for (const t of result) {
            if (!seen.has(t.path)) { seen.add(t.path); combined.push(t); }
          }
        } catch { /* pasta inacessível — ignora */ }
      }
      setTracks(combined);
    } finally {
      setScanning(false);
    }
  }

  async function handleAddNewTracks(newTracks: Track[], enrich: boolean) {
    const ids = new Set(newTracks.map((t) => t.id));
    setTracks([...newTracks, ...allTracks]);
    setNewTrackIds(ids);
    recordScan(newTracks.length);
    checkMissingMeta(newTracks);
    promotePendingTracks(newTracks.map((t) => t.path));
    setNewTracksModal(null);
    if (enrich) {
      await batchEnrich("all");
    }
    // Oferta de playlist sempre ao final (enriquecido ou não)
    setPlaylistOffer(newTracks);
  }

  function handleDeferNewTracks() {
    const storeNow = useAppStore.getState();
    const updated = storeNow.pendingNewTracks.map((p) => ({ ...p, shownSession: true }));
    storeNow.setPendingNewTracks(updated);
    setNewTracksModal(null);
  }

  const [appLoading, setAppLoading] = useState<"startup" | "closing" | null>("startup");
  const [appVersion, setAppVersion] = useState("");
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [showTrialInfo, setShowTrialInfo] = useState(false);
  const isSavingRef = useRef(false);

  useEffect(() => {
    getVersion().then((v) => {
      setAppVersion(v);
      // Checa update 8 segundos após startup para não bloquear carregamento
      setTimeout(() => setShowUpdateModal(true), 8000);
    }).catch(() => {});
  }, []);

  // Reabre o painel e troca para aba "Selecionado" quando o usuário seleciona uma faixa
  useEffect(() => {
    if (selectedIds.size > 0) {
      setShowRightPanel(true);
      setRightPanelTab("selected");
    }
  }, [selectedIds.size]);

  // Carrega cache na abertura e detecta músicas novas
  useEffect(() => {
    async function init() {
      try {
        // Verifica quais pastas em recentFolders ainda existem no disco
        const storeState = useAppStore.getState();
        const foldersToCheck = [...storeState.recentFolders];
        const missing: string[] = [];
        for (const folder of foldersToCheck) {
          try {
            const exists = await invoke<boolean>("dir_exists", { path: folder });
            if (!exists) missing.push(folder);
          } catch {
            missing.push(folder);
          }
        }
        // Mostra diálogo de confirmação; não remove automaticamente
        if (missing.length > 0) {
          setGhostFolders(missing);
        }

        // Carrega apenas as pastas válidas (excluindo as ausentes)
        const validFolders = foldersToCheck.filter((f) => !missing.includes(f));

        type CacheData = { tracks: Track[]; last_folder: string };
        const cache = await invoke<CacheData | null>("load_cache");
        if (cache && cache.tracks.length > 0) {
          // Filtra tracks que pertencem a pastas válidas
          const validTracks = cache.tracks.filter((t) =>
            validFolders.some((f) => t.path.startsWith(f))
          );

          // Filtra adicionalmente por last_folder para mostrar apenas a pasta ativa
          const lastF = cache.last_folder && validFolders.includes(cache.last_folder)
            ? cache.last_folder
            : validFolders[0] ?? null;

          const activeTracks = lastF
            ? validTracks.filter((t) => t.path.startsWith(lastF))
            : [];

          if (activeTracks.length === 0) {
            setAppLoading(null);
            return;
          }

          useAppStore.getState().setTracks(activeTracks);
          // Seta lastFolder diretamente, sem re-inserir em recentFolders
          useAppStore.setState({ lastFolder: lastF });
          checkMissingMeta(activeTracks);

          // Detecta arquivos novos / integra pendentes de sessão anterior
          try {
            const storeNow = useAppStore.getState();
            const pending = storeNow.pendingNewTracks;
            // Usa TODOS os tracks cacheados (todas as pastas válidas) como referência,
            // para não considerar faixas de outras pastas monitoradas como "novas"
            const knownPaths = new Set(validTracks.map((t) => t.path));

            // 1) Auto-integra faixas que o usuário adiou na sessão anterior (shownSession=true)
            // Limita à pasta ativa para não integrar false-positives de outras pastas
            const toAutoIntegrate = pending.filter((p) => p.shownSession && lastF !== null && p.path.startsWith(lastF));
            if (toAutoIntegrate.length > 0) {
              const autoPaths = toAutoIntegrate.map((p) => p.path);
              const autoTracks = await invoke<Track[]>("scan_specific_files", { paths: autoPaths });
              if (autoTracks.length > 0) {
                useAppStore.getState().setTracks([...autoTracks, ...activeTracks]);
                setNewTrackIds(new Set(autoTracks.map((t) => t.id)));
                storeNow.promotePendingTracks(autoPaths);
                toast(t("toolbar.toast.autoIntegrated", { count: autoTracks.length }), "info");
                autoTracks.forEach((t) => knownPaths.add(t.path));
              }
            }

            // 2) Detecta arquivos genuinamente novos APENAS na pasta ativa.
            // Detectar em todas as watchedFolders com knownPaths parcial causa falsos positivos massivos,
            // porque o cache só guarda tracks de uma pasta por vez.
            const brandNewPaths: string[] = [];
            if (lastF) {
              try {
                const found = await invoke<string[]>("find_new_files", { folder: lastF, knownPaths: [...knownPaths] });
                brandNewPaths.push(...found);
              } catch { /* pasta pode ter sido removida */ }
            }

            // Mantém apenas pendentes da pasta ativa (descarta falsos positivos de outras pastas)
            const stillPending = pending.filter(
              (p) => !p.shownSession && lastF !== null && p.path.startsWith(lastF) && !knownPaths.has(p.path)
            );
            const stillPendingPaths = new Set(stillPending.map((p) => p.path));

            // 3) Monta a lista final: pendentes válidos da pasta ativa + novos detectados agora
            const nowMs = Date.now();
            const newEntries: PendingNewTrack[] = brandNewPaths
              .filter((p) => !stillPendingPaths.has(p))
              .map((path) => ({
                path,
                folderPath: lastF ?? "",
                detectedAt: nowMs,
                shownSession: false,
              }));
            const allPending = [...stillPending, ...newEntries];

            // Persiste estado limpo (descarta entradas corrompidas/obsoletas do localStorage)
            storeNow.setPendingNewTracks(allPending);

            if (allPending.length > 0) {
              const scanned = await invoke<Track[]>("scan_specific_files", { paths: allPending.map((p) => p.path) });
              if (scanned.length > 0) setNewTracksModal(scanned);
            }
          } catch {
            // Detecção de novos é best-effort — não bloqueia a abertura
          }
        } else if (lastFolder) {
          await scanFolder(lastFolder);
        }
      } catch {
        if (lastFolder) await scanFolder(lastFolder);
      } finally {
        setAppLoading(null);
      }
    }
    init();
  }, []);

  // Salva cache no fechamento
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    getCurrentWindow().onCloseRequested(async (event) => {
      if (isSavingRef.current) return;
      event.preventDefault();
      isSavingRef.current = true;
      setAppLoading("closing");

      const tracks = useAppStore.getState().tracks;
      const folder = useAppStore.getState().lastFolder;

      // Dispara o save sem aguardar — quit_app fecha o processo depois de 1,5 s
      if (tracks.length > 0 && folder) {
        invoke("save_cache", { tracks, lastFolder: folder }).catch(() => {});
      }

      // Fecha via processo Rust após 1,5 s (evita loop close→onCloseRequested)
      setTimeout(() => {
        invoke("quit_app").catch(() => { window.close(); });
      }, 1500);
    }).then((fn) => { unlisten = fn; });
    return () => { unlisten?.(); };
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
        data-tauri-drag-region
        className="flex flex-col border-b border-white/[0.05] bg-[#23201E]"
        style={{ cursor: "default" }}
        onMouseDown={(e) => {
          const target = e.target as HTMLElement;
          if (!target.closest('button, input, select, a, [role="button"]')) {
            getCurrentWindow().startDragging().catch(() => {});
          }
        }}
        onDoubleClick={(e) => {
          const target = e.target as HTMLElement;
          if (target.closest('button, input, select, a, [role="button"]')) return;
          getCurrentWindow().toggleMaximize().catch(() => {});
        }}
      >
        {/* Linha principal */}
        <div className="flex items-center gap-2 px-3 py-2">

        {/* Espaço para os traffic lights do macOS */}
        {/^Mac/.test(navigator.platform) && <div className="w-20 shrink-0" />}

        {/* Logo — decorativo */}
        <div className="shrink-0 flex items-center justify-center w-8 h-8">
          <svg width="22" height="22" viewBox="0 0 100 100" fill="none">
            <circle cx="50" cy="50" r="46" fill="#D95340"/>
            <circle cx="50" cy="50" r="27" fill="#1A0D0B"/>
          </svg>
        </div>

        {/* Toggle sidebar */}
        <button
          onClick={() => setShowSidebar((v) => !v)}
          title={showSidebar ? "Esconder pastas" : "Mostrar pastas"}
          className="shrink-0 flex items-center justify-center w-7 h-7 rounded-md text-[#605A55] hover:text-[#C2BEBC] hover:bg-white/[0.06] transition-colors"
        >
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
            <rect x="1" y="1" width="11" height="11" rx="1.5"/>
            <path d="M4.5 1v11"/>
            {!showSidebar && <path d="M7 5l2 1.5L7 8"/>}
          </svg>
        </button>

        {/* Abrir pasta — ícone compacto */}
        <button
          data-tour="open-folder"
          onClick={pickFolder}
          disabled={isScanning}
          title={`${t("toolbar.openFolder")} (${CMD}O)`}
          className="shrink-0 flex items-center justify-center w-8 h-8 rounded-md bg-[#D95340] hover:bg-[#E07364] active:bg-[#B34435] disabled:opacity-50 transition-colors"
        >
          {isScanning ? (
            <svg className="animate-spin" width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="white" strokeWidth="1.5" strokeLinecap="round">
              <circle cx="7" cy="7" r="5" strokeDasharray="25" strokeDashoffset="10" opacity="0.4"/>
              <path d="M7 2a5 5 0 015 5"/>
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 5.5C2 4.67 2.67 4 3.5 4H6L7 5H12.5C13.33 5 14 5.67 14 6.5V11.5C14 12.33 13.33 13 12.5 13H3.5C2.67 13 2 12.33 2 11.5V5.5Z"/>
              <line x1="8" y1="7.5" x2="8" y2="11"/>
              <line x1="6.25" y1="9.25" x2="9.75" y2="9.25"/>
            </svg>
          )}
        </button>

        {/* Scan progress */}
        {isScanning && scanTotal !== null && (
          <span className="text-[10px] font-mono text-[#8F8883] whitespace-nowrap shrink-0">
            {scanDone}/{scanTotal}
          </span>
        )}

        {/* Quick actions */}
        <div className="flex items-center gap-1 ml-1">
          {/* Restaurar de Nomes — recupera Artista/Título/Ano do filename */}
          {allTracks.length > 0 && (
            <button
              onClick={restoreFromFilename}
              disabled={restoringFromName || enriching || isScanning}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-semibold disabled:opacity-40 transition-colors whitespace-nowrap shrink-0 ${
                selectedIds.size > 0
                  ? "bg-[#D95340]/15 text-[#D95340] border border-[#D95340]/25 hover:bg-[#D95340]/25"
                  : "text-[#605A55] hover:text-[#8F8883] hover:bg-white/[0.04]"
              }`}
              title={t("toolbar.restoreFromNames")}
            >
              <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 5.5A3.5 3.5 0 108.5 2.5L7 4"/><path d="M2 2.5v3h3"/>
              </svg>
              {restoringFromName
                ? t("toolbar.restoring")
                : selectedIds.size > 0
                  ? t("toolbar.restoreCount", { count: selectedIds.size })
                  : t("toolbar.restore")}
            </button>
          )}
          {/* Botão Desfazer — aparece após enriquecimento enquanto snapshot está disponível */}
          {enrichUndoSnapshot && (
            <button
              onClick={undoEnrich}
              disabled={enriching}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-semibold text-[#EAB308] hover:text-[#F59E0B] hover:bg-yellow-500/[0.08] border border-yellow-500/20 disabled:opacity-40 transition-colors whitespace-nowrap shrink-0"
              title={t("toolbar.undoEnrich")}
            >
              <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 5.5A3.5 3.5 0 108.5 2.5L7 4"/>
                <path d="M2 2.5v3h3"/>
              </svg>
              {t("common.undo")}
            </button>
          )}
          {allTracks.length > 0 && (
            <button
              data-tour="analyze-bpm"
              onClick={() => batchAnalyzeBpm()}
              disabled={analyzingBpm || isScanning || enriching}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-semibold disabled:opacity-40 transition-all whitespace-nowrap shrink-0 ${
                analyzingBpm
                  ? "text-[#D95340] bg-[#D95340]/[0.08] border border-[#D95340]/[0.30]"
                  : "text-[#605A55] hover:text-[#756D67] hover:bg-white/[0.04]"
              }`}
              title={t("toolbar.analyzeBpmTooltip")}
            >
              <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
                <path d="M1 8l2-4 2 2.5 2-5 2 3 1-2"/>
              </svg>
              {analyzingBpm && bpmProgress
                ? t("toolbar.bpmProgress", { done: bpmProgress.done, total: bpmProgress.total })
                : selectedIds.size > 0
                  ? t("toolbar.bpmCount", { count: selectedIds.size })
                  : t("toolbar.analyzeBpm")}
            </button>
          )}
          {allTracks.length > 0 && (
            <div className="relative group" data-tour="enrich">
              <button
                onClick={() => batchEnrich("all")}
                disabled={enriching || isScanning}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-semibold text-[#605A55] hover:text-[#756D67] hover:bg-white/[0.04] disabled:opacity-40 transition-colors whitespace-nowrap shrink-0"
                title={t("toolbar.enrichTooltip")}
              >
                <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="5.5" cy="5.5" r="4"/>
                  <path d="M5.5 3.5v2l1.5 1"/>
                </svg>
                {enriching && enrichProgress
                  ? t("toolbar.enrichProgress", { done: enrichProgress.done, total: enrichProgress.total })
                  : selectedIds.size > 0
                    ? t("toolbar.enrichCount", { count: selectedIds.size })
                    : t("toolbar.enrich")}
              </button>
              <div className="absolute top-full left-0 pt-1 hidden group-hover:block z-50 min-w-[180px]">
                <div className="py-1 rounded-md shadow-xl" style={{ background: "#1c1917", border: "1px solid rgba(255,255,255,0.07)" }}>
                  <button onClick={() => batchEnrich("all")} disabled={enriching} className="w-full px-3 py-1.5 text-left text-[11px] hover:bg-white/[0.07] transition-colors disabled:opacity-40" style={{ color: "#E8E4E1" }}>
                    {t("toolbar.enrichMenu.all")}
                  </button>
                  <button onClick={() => batchEnrich("itunes")} disabled={enriching} className="w-full px-3 py-1.5 text-left text-[11px] hover:bg-white/[0.07] transition-colors disabled:opacity-40" style={{ color: "#E8E4E1" }}>
                    {t("toolbar.enrichMenu.itunes")}
                  </button>
                  <button onClick={() => batchEnrich("spotify")} disabled={enriching} className="w-full px-3 py-1.5 text-left text-[11px] hover:bg-white/[0.07] transition-colors disabled:opacity-40" style={{ color: "#E8E4E1" }}>
                    {t("toolbar.enrichMenu.spotify")}
                  </button>
                  <div className="mx-2 my-1 h-px" style={{ background: "rgba(255,255,255,0.06)" }} />
                  <button
                    disabled={enriching}
                    onClick={() => {
                      const noCoverTracks = allTracks.filter((t) => !t.has_cover);
                      if (noCoverTracks.length === 0) { toast("Todas as faixas já têm capa", "info"); return; }
                      useAppStore.setState({ selectedIds: new Set(noCoverTracks.map((t) => t.id)) });
                      setTimeout(() => batchEnrich("all"), 50);
                    }}
                    className="w-full px-3 py-1.5 text-left text-[11px] hover:bg-white/[0.07] transition-colors disabled:opacity-40"
                    style={{ color: "#D4956A" }}
                  >
                    Buscar capas faltantes
                    {allTracks.filter((t) => !t.has_cover).length > 0 && (
                      <span className="ml-1 text-[9px]" style={{ color: "#756D67" }}>({allTracks.filter((t) => !t.has_cover).length})</span>
                    )}
                  </button>
                </div>
              </div>
            </div>
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
              {normalizing ? t("toolbar.normalizing") : t("toolbar.normalize")}
            </button>
          )}
          {allTracks.length > 0 && (() => {
            const hasSelection = selectedIds.size > 0;
            const canExport = hasSelection || !!activePlaylist;
            const exportLabel = exporting
              ? t("toolbar.exporting")
              : hasSelection
              ? t("toolbar.exportCount", { count: selectedIds.size })
              : activePlaylist
              ? t("toolbar.exportPlaylist", { name: activePlaylist.name })
              : t("toolbar.export");
            return (
            <div className="relative group">
              <button
                disabled={exporting || !canExport}
                title={canExport ? undefined : t("toolbar.selectToExport")}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-semibold transition-colors disabled:opacity-40 ${
                  canExport
                    ? "text-[#756D67] hover:text-[#8F8883] hover:bg-white/[0.04]"
                    : "text-[#4C4743] cursor-not-allowed"
                }`}
              >
                <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5.5 1v6M3 4l2.5-3 2.5 3"/>
                  <path d="M2 8v1.5h7V8"/>
                </svg>
                {exportLabel}
              </button>
              {/* Dropdown apenas quando exportação está disponível */}
              {canExport && !exporting && (
                <div className="absolute top-full left-0 pt-1 hidden group-hover:block z-50 min-w-[180px]">
                  <div className="py-1 rounded-md shadow-xl" style={{ background: "#1c1917", border: "1px solid rgba(255,255,255,0.07)" }}>
                    {installedDj.map((sw) => (
                      <button
                        key={sw.id}
                        onClick={() => exportToDj(sw.id)}
                        className="w-full px-3 py-1.5 text-left text-[11px] hover:bg-white/[0.07] transition-colors"
                        style={{ color: "#E8E4E1" }}
                      >
                        {sw.name}
                      </button>
                    ))}
                    {installedDj.length > 0 && (
                      <div className="my-1 h-px" style={{ background: "rgba(255,255,255,0.06)" }} />
                    )}
                    <button
                      onClick={exportM3U}
                      className="w-full px-3 py-1.5 text-left text-[11px] hover:bg-white/[0.07] transition-colors"
                      style={{ color: "#E8E4E1" }}
                    >
                      {t("toolbar.exportMenu.m3u")}
                    </button>
                    <button
                      onClick={exportCsv}
                      className="w-full px-3 py-1.5 text-left text-[11px] hover:bg-white/[0.07] transition-colors"
                      style={{ color: "#E8E4E1" }}
                    >
                      {t("toolbar.exportMenu.csv")}
                    </button>
                  </div>
                </div>
              )}
            </div>
            );
          })()}
        </div>

        {/* Stats / active playlist indicator */}
        {activePlaylist ? (
          <div className="flex items-center gap-1.5 ml-1 shrink-0">
            <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" className="text-[#D95340] opacity-70">
              <rect x="0.5" y="0.5" width="9" height="2" rx="0.5"/>
              <rect x="0.5" y="4" width="7" height="2" rx="0.5"/>
              <rect x="0.5" y="7.5" width="5" height="2" rx="0.5"/>
            </svg>
            <span className="text-[11px] text-[#D95340] font-semibold whitespace-nowrap">{activePlaylist.name}</span>
            <span className="text-[10px] text-[#605A55]">({tracksForMedia.length})</span>
            <button
              onClick={() => useAppStore.getState().setActivePlaylistId(null)}
              className="text-[10px] text-[#605A55] hover:text-[#D95340] transition-colors"
              title={t("app.closePlaylist")}
            >×</button>
          </div>
        ) : null}

        {/* Filter chips */}
        <div
          className="flex gap-0.5 ml-2"
         
        >
          {(
            [
              { id: "all" as const,       label: t("toolbar.filter.all"),        title: t("toolbar.filter.all") },
              { id: "recent" as const,    label: `+ ${recentCount}`,             title: t("toolbar.chipRecentTooltip", { count: recentCount }) },
              { id: "favorites" as const, label: `★ ${favoriteCount}`,           title: t("toolbar.chipFavoritesTooltip", { count: favoriteCount }) },
              { id: "problems" as const,  label: `⚠ ${problemCount}`,            title: t("toolbar.chipProblemsTooltip", { count: problemCount }) },
              { id: "ok" as const,        label: `✓ ${allTracks.length - problemCount}`, title: t("toolbar.chipOkTooltip", { count: allTracks.length - problemCount }) },
            ] as { id: typeof filterTab; label: string; title: string }[]
          ).map((tab) => (
            <button
              key={tab.id}
              onClick={() => setFilterTab(tab.id)}
              data-tip={tab.title}
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

        {/* Lista / Grade toggle */}
        <button
          onClick={() => setCompact((v) => !v)}
          title={compact ? t("toolbar.viewList") : t("toolbar.viewCompact")}
          className={`w-7 h-7 flex items-center justify-center rounded-md transition-colors ${
            compact ? "bg-white/[0.08] text-[#F5F5F4]" : "text-[#605A55] hover:text-[#8F8883] hover:bg-white/[0.04]"
          }`}
        >
          {compact ? (
            /* Ícone lista (modo atual = grade → clica p/ lista) */
            <svg width="13" height="11" viewBox="0 0 13 11" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
              <line x1="0" y1="1" x2="13" y2="1"/>
              <line x1="0" y1="5.5" x2="13" y2="5.5"/>
              <line x1="0" y1="10" x2="13" y2="10"/>
            </svg>
          ) : (
            /* Ícone grade (modo atual = lista → clica p/ grade) */
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
              <rect x="0.5" y="0.5" width="4.5" height="4.5" rx="0.8"/>
              <rect x="7" y="0.5" width="4.5" height="4.5" rx="0.8"/>
              <rect x="0.5" y="7" width="4.5" height="4.5" rx="0.8"/>
              <rect x="7" y="7" width="4.5" height="4.5" rx="0.8"/>
            </svg>
          )}
        </button>

        {/* Advanced filter + Search */}
        <div
          className="flex items-center gap-1"
         
        >
          {/* Filter popover */}
          <div className="relative" ref={advFilterRef}>
            <button
              onClick={() => setShowAdvFilter((v) => !v)}
              title={t("toolbar.advancedFilter")}
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
                  <p className="text-[9px] font-bold text-[#8F8883] uppercase tracking-widest">{t("toolbar.advancedFilterTitle")}</p>
                  {isAdvFilterActive && (
                    <button
                      onClick={() => setAdvFilter({ bpmMin: "", bpmMax: "", yearMin: "", yearMax: "", key: "" })}
                      className="text-[10px] text-[#D95340] hover:text-[#E07364] transition-colors"
                    >
                      {t("toolbar.clearFilter")}
                    </button>
                  )}
                </div>

                {/* BPM Range */}
                <div className="mb-2.5">
                  <label className="text-[9px] font-semibold text-[#605A55] uppercase tracking-widest block mb-1">{t("toolbar.filterBpm")}</label>
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
                  <label className="text-[9px] font-semibold text-[#605A55] uppercase tracking-widest block mb-1">{t("toolbar.filterYear")}</label>
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
                    <label className="text-[9px] font-semibold text-[#605A55] uppercase tracking-widest block mb-1">{t("toolbar.filterKey")}</label>
                    <select
                      value={advFilter.key}
                      onChange={(e) => setAdvFilter((f) => ({ ...f, key: e.target.value }))}
                      className="w-full px-2 py-1 rounded-md bg-[#120D0B] border border-white/[0.08] text-xs text-[#C2BEBC] focus:outline-none focus:border-[#D95340]/50 font-mono"
                    >
                      <option value="">{t("toolbar.filterAllKeys")}</option>
                      {availableKeys.map((k) => (
                        <option key={k} value={k}>{k}</option>
                      ))}
                    </select>
                  </div>
                )}

                {isAdvFilterActive && (
                  <p className="mt-2 text-[9px] text-[#8F8883] text-center">
                    {t("app.filterOf", { visible: tracks.length, total: baseFiltered.length })}
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="relative flex items-center shrink-0">
            {(windowWidth >= 1100 || searchExpanded || !!searchQuery) ? (
              <>
                <svg className="absolute left-2.5 pointer-events-none shrink-0" width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="#605A55" strokeWidth="1.5" strokeLinecap="round">
                  <circle cx="5.5" cy="5.5" r="4"/>
                  <line x1="8.7" y1="8.7" x2="12" y2="12"/>
                </svg>
                <input
                  autoFocus={searchExpanded && windowWidth < 1100}
                  className="w-52 pl-8 pr-3 py-1.5 rounded-md bg-white/[0.04] border border-white/[0.08] text-xs text-[#C2BEBC] placeholder-[#605A55] focus:outline-none focus:border-[#D95340]/50 focus:bg-white/[0.06] transition-colors font-mono"
                  placeholder={t("common.search") + "…"}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onBlur={() => { if (!searchQuery) setSearchExpanded(false); }}
                />
              </>
            ) : (
              <button
                onClick={() => setSearchExpanded(true)}
                title={t("toolbar.searchExpand")}
                className="flex items-center justify-center w-7 h-7 rounded-md text-[#605A55] hover:text-[#C2BEBC] hover:bg-white/[0.06] transition-colors"
              >
                <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                  <circle cx="5.5" cy="5.5" r="4"/>
                  <line x1="8.7" y1="8.7" x2="12" y2="12"/>
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* Controles de janela — Windows (macOS usa traffic lights nativos) */}
        {IS_WIN && (
          <div className="flex items-center shrink-0 ml-1">
            <button
              onClick={() => getCurrentWindow().minimize()}
              className="w-9 h-7 flex items-center justify-center text-[#605A55] hover:text-[#C2BEBC] hover:bg-white/[0.06] transition-colors rounded"
              title={t("app.minimize")}
            >
              <svg width="10" height="2" viewBox="0 0 10 2" fill="currentColor"><rect width="10" height="1.5" rx="0.5"/></svg>
            </button>
            <button
              onClick={async () => {
                const w = getCurrentWindow();
                if (await w.isMaximized()) w.unmaximize(); else w.maximize();
              }}
              className="w-9 h-7 flex items-center justify-center text-[#605A55] hover:text-[#C2BEBC] hover:bg-white/[0.06] transition-colors rounded"
              title={t("app.maximize")}
            >
              <svg width="9" height="9" viewBox="0 0 9 9" fill="none" stroke="currentColor" strokeWidth="1.4"><rect x="0.7" y="0.7" width="7.6" height="7.6" rx="1"/></svg>
            </button>
            <button
              onClick={() => getCurrentWindow().close()}
              className="w-9 h-7 flex items-center justify-center text-[#605A55] hover:text-white hover:bg-[#D95340] transition-colors rounded"
              title={t("common.close")}
            >
              <svg width="9" height="9" viewBox="0 0 9 9" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><line x1="1" y1="1" x2="8" y2="8"/><line x1="8" y1="1" x2="1" y2="8"/></svg>
            </button>
          </div>
        )}
        </div>

        {/* Sub-row: cleanup | trial + versão */}
        <div className="flex items-center justify-between px-3 py-1 border-t border-white/[0.04]">
          {cleanupCount > 0 ? (
            <button
              onClick={autoSelectCleanup}
              className="flex items-center gap-1.5 group"
              title="Selecionar faixas com problemas"
              style={{ animation: 'cleanup-pulse 2.8s ease-in-out infinite' }}
            >
              <svg width="6" height="8" viewBox="0 0 6 8" fill="#D95340" className="shrink-0">
                <path d="M0 0l6 4-6 4V0z"/>
              </svg>
              <span className="text-[10px] font-mono font-bold text-[#D95340] group-hover:text-[#E07364] transition-colors">{cleanupCount}</span>
              <span className="text-[10px] font-semibold text-[#D95340]/70 group-hover:text-[#E07364] transition-colors">{t("app.tracksForEnrich")}</span>
            </button>
          ) : <span />}

          <div className="flex items-center gap-2.5">
            {!isTrialActivated() && (
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setShowTrialInfo(true)}
                  className="text-[9px] font-bold font-mono text-[#D95340] hover:text-[#E07364] tabular-nums transition-colors"
                  title={t("app.trialInfo", { days: daysRemaining() })}
                >
                  Trial · {daysRemaining()}d
                </button>
                <button
                  onClick={() => setShowTrialInfo(true)}
                  className="px-2 py-0.5 rounded text-[9px] font-bold bg-[#D95340] hover:bg-[#E07364] active:bg-[#B34435] text-white transition-colors"
                  title={t("app.buyLicense")}
                >
                  Upgrade
                </button>
              </div>
            )}
            {appVersion && (
              <span className="text-[9px] font-mono text-[#756D67]">v{appVersion}</span>
            )}
            {/* Column picker */}
            <div className="relative" ref={colPickerRef}>
              <button
                onClick={() => setShowColPicker((v) => !v)}
                title={t("app.manageCols")}
                className={`flex items-center justify-center w-5 h-5 rounded transition-colors ${
                  showColPicker
                    ? "bg-white/[0.08] text-[#D95340]"
                    : "text-[#605A55] hover:text-[#8F8883] hover:bg-white/[0.06]"
                }`}
              >
                <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
                  <rect x="1" y="1" width="3" height="3" rx="0.5"/>
                  <rect x="1" y="7" width="3" height="3" rx="0.5"/>
                  <rect x="7" y="1" width="3" height="3" rx="0.5"/>
                  <rect x="7" y="7" width="3" height="3" rx="0.5"/>
                </svg>
              </button>
              {showColPicker && (
                <div className="absolute right-0 top-full mt-1 bg-[#1c1715] border border-white/[0.08] rounded-lg shadow-2xl py-2 z-[200] min-w-[160px]">
                  <p className="px-3 pb-1.5 text-[9px] font-bold text-[#605A55] uppercase tracking-widest border-b border-white/[0.05]">
                    {t("settings.tabs.columns")}
                  </p>
                  <div className="py-1">
                    {HIDEABLE_COLS.map((col) => (
                      <label
                        key={col.id}
                        className="flex items-center gap-2.5 px-3 py-1.5 cursor-pointer hover:bg-white/[0.04] transition-colors"
                      >
                        <input
                          type="checkbox"
                          checked={isColVisible(col.id)}
                          onChange={() => setColumnVisibility({ ...columnVisibility, [col.id]: !isColVisible(col.id) })}
                          className="accent-[#D95340]"
                        />
                        <span className="text-[11px] text-[#C2BEBC]">{col.label}</span>
                      </label>
                    ))}
                  </div>
                  <div className="border-t border-white/[0.05] pt-1.5 px-3 mt-0.5 flex items-center gap-3">
                    <button
                      onClick={() => {
                        const reset: Record<string, boolean> = {};
                        HIDEABLE_COLS.forEach((c) => { reset[c.id] = true; });
                        setColumnVisibility(reset);
                      }}
                      className="text-[10px] text-[#605A55] hover:text-[#8F8883] transition-colors"
                    >
                      {t("settings.columns.showAll")}
                    </button>
                    <button
                      onClick={() => setColResetToken((n) => n + 1)}
                      className="text-[10px] text-[#605A55] hover:text-[#8F8883] transition-colors"
                    >
                      Restaurar larguras
                    </button>
                  </div>
                </div>
              )}
            </div>

            <button
              onClick={() => setShowSettings(true)}
              title={`${t("settings.title")} (${CMD},)`}
              className="flex items-center justify-center w-5 h-5 rounded text-[#D95340] hover:text-[#E07364] hover:bg-white/[0.06] transition-colors"
            >
              <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="5.5" cy="5.5" r="1.8"/>
                <path d="M5.5 1v1M5.5 9v1M1 5.5h1M9 5.5h1M2.1 2.1l.7.7M8.2 8.2l.7.7M8.9 2.1l-.7.7M2.8 8.2l-.7.7"/>
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden border-b border-white/[0.07]">
        {showSidebar && (
          <div className="shrink-0 flex relative" style={{ width: sidebarWidth }}>
            <Sidebar
                onFolderSelect={scanFolder}
                onBrowse={(path) => setBrowsePath(path)}
                onAnalyzeBpmFolder={(folderPath) => {
                  const folderTracks = allTracks.filter((t) => t.path.startsWith(folderPath + "/") || t.path.startsWith(folderPath + "\\"));
                  if (folderTracks.length === 0) { toast("Nenhuma faixa nesta pasta", "info"); return; }
                  batchAnalyzeBpm(folderTracks);
                }}
                onEnrichFolder={(folderPath) => {
                  const folderTracks = allTracks.filter((t) => t.path.startsWith(folderPath + "/") || t.path.startsWith(folderPath + "\\"));
                  if (folderTracks.length === 0) { toast("Nenhuma faixa nesta pasta", "info"); return; }
                  useAppStore.setState({ selectedIds: new Set(folderTracks.map((t) => t.id)) });
                  setTimeout(() => batchEnrich("all", folderPath), 50);
                }}
                onExportPlaylist={(pl) => setExportPlaylistTarget(pl)}
                onLoadAllFolders={loadAllFolders}
              />
            {/* Drag handle */}
            <div
              className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize z-10 hover:bg-[#D95340]/30 transition-colors"
              onMouseDown={(e) => {
                e.preventDefault();
                const startX = e.clientX;
                const startW = sidebarWidth;
                const onMove = (ev: MouseEvent) => {
                  setSidebarWidth(Math.max(160, Math.min(420, startW + ev.clientX - startX)));
                };
                const onUp = () => {
                  document.removeEventListener("mousemove", onMove);
                  document.removeEventListener("mouseup", onUp);
                };
                document.addEventListener("mousemove", onMove);
                document.addEventListener("mouseup", onUp);
              }}
            />
          </div>
        )}

        <div className="flex flex-col flex-1 overflow-hidden">
          {/* Folder Browser — substitui a tabela quando navegando */}
          {browsePath && (
            <FolderBrowser
              rootPath={browsePath}
              onLoadFolder={(path) => { setBrowsePath(null); scanFolder(path); }}
              onClose={() => setBrowsePath(null)}
            />
          )}
          {!browsePath && <>
          {/* Abas Áudio / Vídeo — faixa centralizada abaixo do toolbar */}
          {allTracks.length > 0 && (
            <div className="flex items-center justify-center py-1.5 border-b border-white/[0.04] shrink-0">
              <div className="flex items-center gap-px bg-white/[0.04] rounded-lg p-0.5 border border-white/[0.06]">
                {(["audio", "video"] as const).map((tab) => {
                  const isAudio = tab === "audio";
                  const count = isAudio ? allTracks.length - videoCount : videoCount;
                  const active = mediaTab === tab;
                  const disabled = tab === "video" && !hasVideos;
                  return (
                    <button
                      key={tab}
                      onClick={() => !disabled && setMediaTab(tab)}
                      disabled={disabled}
                      className={`flex items-center gap-1.5 px-4 py-1 rounded-md text-[11px] font-semibold transition-colors ${
                        active
                          ? "bg-[#D95340]/20 text-[#D95340] border border-[#D95340]/20"
                          : disabled
                          ? "text-[#373331] cursor-default"
                          : "text-[#605A55] hover:text-[#8F8883]"
                      }`}
                    >
                      {isAudio ? (
                        <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
                          <path d="M3 2h4l1 1v4l-1 1H3L2 7V3l1-1zm1.5 2v2l1.5-.75V4.75L4.5 4z"/>
                        </svg>
                      ) : (
                        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
                          <rect x="1" y="2.5" width="6" height="5" rx="0.8"/>
                          <path d="M7 4.5l2-1.5v4L7 5.5"/>
                        </svg>
                      )}
                      {isAudio ? t("app.audio") : t("app.video")}
                      {count > 0 && (
                        <span className={`text-[9px] font-mono ${active ? "text-[#D95340]/60" : "text-[#4C4743]"}`}>
                          {count}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Filename cleanup prompt */}
          {(filenameIssues.length > 0 || parenIssues.length > 0 || duplicateGroups.length > 0 || filenameMetaIssues.length > 0) && (
            <div className="pt-2 flex flex-col gap-0">
              {filenameMetaIssues.length > 0 && (
                <FilenameMetaPrompt
                  issues={filenameMetaIssues}
                  onDismiss={() => setFilenameMetaIssues([])}
                  onApplied={(path, artist, title) => {
                    const existing = useAppStore.getState().tracks.find((t) => t.path === path);
                    if (existing) {
                      useAppStore.getState().updateTrack({
                        ...existing,
                        artist: artist ?? existing.artist,
                        title: title ?? existing.title,
                      });
                    }
                    setFilenameMetaIssues((prev) => prev.filter((i) => i.path !== path));
                  }}
                />
              )}
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
            {/* Conteúdo principal */}
            <div className="flex flex-col flex-1 overflow-hidden">
              {newTrackIds.size > 0 && (() => {
                const newTracks = tracks.filter((t) => newTrackIds.has(t.id));
                if (newTracks.length === 0) return null;
                return (
                  <>
                    {/* Seção de novas faixas com fundo tintado */}
                    <div className="flex flex-col shrink-0" style={{ maxHeight: "42%", background: "linear-gradient(180deg, rgba(217,83,64,0.07) 0%, rgba(217,83,64,0.03) 100%)" }}>
                      {/* Header proeminente */}
                      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-[#D95340]/20 shrink-0">
                        <div className="relative shrink-0">
                          <span className="block w-2 h-2 rounded-full bg-[#D95340]" />
                          <span className="absolute inset-0 rounded-full bg-[#D95340] animate-ping opacity-50" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <span className="text-[11px] font-bold text-[#E0796A] uppercase tracking-widest">
                            {t("app.recentlyAdded")}
                          </span>
                          <span className="text-[10px] text-[#605A55] ml-2">
                            {t("app.newTracksSubtitle", { count: newTracks.length })}
                          </span>
                        </div>
                        <button
                          onClick={() => setNewTrackIds(new Set())}
                          className="flex items-center gap-1 text-[10px] text-[#4C4743] hover:text-[#8F8883] transition-colors shrink-0 px-2 py-1 rounded-md hover:bg-white/[0.05]"
                        >
                          <svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                            <line x1="1" y1="1" x2="7" y2="7"/><line x1="7" y1="1" x2="1" y2="7"/>
                          </svg>
                          {t("app.dismissNew")}
                        </button>
                      </div>
                      <div className="overflow-auto">
                        <TrackTable tracks={newTracks} compact={compact} hasFolder={true} />
                      </div>
                    </div>

                    {/* Divisor rotulado entre as duas seções */}
                    <div className="flex items-center gap-3 px-4 py-1.5 shrink-0 border-y border-white/[0.05]" style={{ background: "#0E0D0C" }}>
                      <div className="flex-1 h-px bg-white/[0.05]" />
                      <span className="text-[9px] font-bold text-[#373331] uppercase tracking-widest">{t("app.library")}</span>
                      <div className="flex-1 h-px bg-white/[0.05]" />
                    </div>
                  </>
                );
              })()}
              <TrackTable
                tracks={tracksForMedia.filter((t) => !newTrackIds.has(t.id))}
                compact={compact}
                hasFolder={!!lastFolder}
                onVideoPlay={mediaTab === "video" ? (t) => setVideoTrack(t) : undefined}
                enrichingIds={new Set([...enrichingIds, ...analyzingBpmIds])}
                enrichDoneIds={new Set([...enrichDoneIds, ...bpmDoneIds])}
                onOpenFolder={pickFolder}
                onEnrich={(trackId) => batchEnrich("all", undefined, trackId)}
                resetColToken={colResetToken}
              />
            </div>
            {showRightPanel && allTracks.length > 0 && (() => {
              const panel = (
                <div className="w-64 shrink-0 flex flex-col border-l border-white/[0.05] bg-[#0E0D0C]">
                  {/* Tab bar */}
                  <div className="flex items-center border-b border-white/[0.05] px-3 pt-2 gap-0">
                    <button
                      onClick={() => setRightPanelTab("selected")}
                      disabled={selectedIds.size === 0}
                      className={`flex items-center gap-1.5 px-2 pb-2 text-[10px] font-semibold transition-colors border-b-2 -mb-px ${
                        rightPanelTab === "selected" && selectedIds.size > 0
                          ? "text-[#F5F5F4] border-[#D95340]"
                          : "text-[#605A55] border-transparent hover:text-[#8F8883] disabled:opacity-30 disabled:cursor-not-allowed"
                      }`}
                    >
                      {t("app.selectedTab")}
                      {selectedIds.size > 0 && (
                        <span className={`text-[9px] font-mono px-1 py-px rounded-sm ${
                          rightPanelTab === "selected"
                            ? "bg-[#D95340]/20 text-[#D95340]"
                            : "bg-white/[0.05] text-[#605A55]"
                        }`}>
                          {selectedIds.size}
                        </span>
                      )}
                    </button>
                    <button
                      onClick={() => setRightPanelTab("library")}
                      className={`flex items-center px-2 pb-2 text-[10px] font-semibold transition-colors border-b-2 -mb-px ${
                        rightPanelTab === "library"
                          ? "text-[#F5F5F4] border-[#D95340]"
                          : "text-[#605A55] border-transparent hover:text-[#8F8883]"
                      }`}
                    >
                      {t("app.libraryTab")}
                    </button>
                    <div className="flex-1" />
                    <button
                      onClick={() => { useAppStore.getState().clearSelection(); setShowRightPanel(false); }}
                      title="Fechar"
                      className="w-4 h-4 mb-2 flex items-center justify-center text-[#605A55] hover:text-[#8F8883] transition-colors"
                    >
                      <svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                        <line x1="1" y1="1" x2="7" y2="7"/>
                        <line x1="7" y1="1" x2="1" y2="7"/>
                      </svg>
                    </button>
                  </div>

                  {/* Content */}
                  {rightPanelTab === "selected" && selectedIds.size > 0
                    ? <Inspector embedded onBatchEnrich={() => batchEnrich("all")} enrichProgress={enrichProgress} />
                    : <LibraryStats embedded />
                  }
                </div>
              );

              return inspectorOverlay && rightPanelTab === "selected" && selectedIds.size > 0
                ? <div className="absolute inset-y-0 right-0 w-64 z-30 shadow-2xl flex flex-col animate-[fade-in-right_0.15s_ease-out]">{panel}</div>
                : panel;
            })()}
          </div>
          </>}
        </div>
      </div>

      {/* Barra de progresso global — scan e enrichment */}
      {(isScanning || enriching) && (
        <div className="shrink-0 relative overflow-hidden" style={{ height: 2, background: "rgba(255,255,255,0.04)" }}>
          {isScanning && scanTotal && scanTotal > 0 ? (
            <div
              className="absolute inset-y-0 left-0 transition-all duration-200"
              style={{ width: `${Math.round((scanDone / scanTotal) * 100)}%`, background: "#D95340" }}
            />
          ) : enriching && enrichProgress ? (
            <div
              className="absolute inset-y-0 left-0 transition-all duration-200"
              style={{ width: `${Math.round((enrichProgress.done / enrichProgress.total) * 100)}%`, background: "#C97B40" }}
            />
          ) : (
            <div className="absolute inset-y-0 left-0" style={{ background: "#D95340", animation: "progress-indeterminate 1.4s ease-in-out infinite" }} />
          )}
        </div>
      )}

      {(selectedIds.size > 0 || !!playerTrackId || tourPlayerVisible) && (
        <div data-tour="player" style={{ animation: 'slide-up-player 0.18s ease-out' }}>
          <MiniPlayer displayTracks={tracks} />
        </div>
      )}

      {deleteTargets.length > 0 && (
        <DeleteConfirmDialog
          tracks={deleteTargets}
          onClose={() => setDeleteTargets([])}
        />
      )}

      {/* Modal de vídeo — abre ao dar double-click em faixa de vídeo */}
      {videoTrack && (
        <VideoPlayerModal track={videoTrack} onClose={() => setVideoTrack(null)} />
      )}

      {/* Diálogo: pastas que não existem mais no disco */}
      {ghostFolders.length > 0 && (
        <div className="fixed inset-0 z-[600] flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-[#1c1715] border border-white/[0.08] rounded-2xl shadow-2xl w-[400px] max-w-[90vw] p-6 flex flex-col gap-5">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 shrink-0 w-9 h-9 rounded-full bg-yellow-500/10 flex items-center justify-center">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#EAB308" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
                  <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
                </svg>
              </div>
              <div>
                <p className="text-[#F5F5F4] font-semibold text-[13px] leading-snug">
                  {ghostFolders.length === 1
                    ? t("app.ghostFolder.title")
                    : t("app.ghostFolder.titlePlural", { count: ghostFolders.length })}
                </p>
                <p className="text-[#8F8883] text-[12px] mt-1 leading-relaxed">
                  {ghostFolders.length === 1
                    ? t("app.ghostFolder.msg")
                    : t("app.ghostFolder.msgPlural")}
                </p>
              </div>
            </div>
            <ul className="flex flex-col gap-1 max-h-40 overflow-y-auto no-scrollbar">
              {ghostFolders.map((f) => (
                <li key={f} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/[0.03] border border-white/[0.05]">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#605A55" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>
                  </svg>
                  <span className="text-[#8F8883] text-[11px] font-mono truncate">{f.split(/[\\/]/).filter(Boolean).pop() ?? f}</span>
                </li>
              ))}
            </ul>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setGhostFolders([])}
                className="px-4 py-2 rounded-lg text-[12px] font-medium text-[#8F8883] hover:text-[#C2BEBC] hover:bg-white/[0.04] transition-colors"
              >
                {t("app.ghostFolder.notNow")}
              </button>
              <button
                onClick={() => {
                  const s = useAppStore.getState();
                  for (const folder of ghostFolders) {
                    s.removeRecentFolder(folder);
                    if (folder === s.lastFolder) useAppStore.setState({ lastFolder: null });
                  }
                  setGhostFolders([]);
                }}
                className="px-4 py-2 rounded-lg text-[12px] font-semibold bg-[#D95340]/15 text-[#D95340] border border-[#D95340]/20 hover:bg-[#D95340]/25 transition-colors"
              >
                {t("app.ghostFolder.remove")}
              </button>
            </div>
          </div>
        </div>
      )}

      <FirstLaunchModal />
      <TrialExpiredModal />
      {showTrialInfo && !isTrialActivated() && (
        <TrialInfoModal onClose={() => setShowTrialInfo(false)} />
      )}
      {showOnboarding && <Onboarding onComplete={() => { setShowOnboarding(false); setShowTour(shouldShowTour()); }} />}
      {!showOnboarding && showTour && (
        <ProductTour
          onDone={() => { setShowTour(false); setTourPlayerVisible(false); }}
          onStepChange={(s) => setTourPlayerVisible(s === 4)}
        />
      )}
      {showSettings && <Settings onClose={() => setShowSettings(false)} />}
      {showOfflineBanner && <OfflineBanner onClose={() => setShowOfflineBanner(false)} />}
      {enrichResultModal && (
        <EnrichResultModal
          total={enrichResultModal.total}
          enriched={enrichResultModal.enriched}
          covers={enrichResultModal.covers}
          folderName={enrichResultModal.folderName}
          onClose={() => setEnrichResultModal(null)}
          onUndo={enrichUndoSnapshot ? () => { undoEnrich(); setEnrichResultModal(null); } : undefined}
        />
      )}
      <ToastContainer />
      <AIAssistant />

      {/* Overlay bloqueante durante scan — impede interação e crash em pastas grandes */}
      {isScanning && (
        <div className="fixed inset-0 z-[500] flex items-center justify-center select-none bg-black/60 backdrop-blur-sm">
          <div className="bg-[#1c1715] border border-white/[0.08] rounded-xl shadow-2xl p-6 flex flex-col items-center gap-4" style={{ minWidth: 300 }}>
            <div className="w-11 h-11 rounded-xl bg-[#D95340]/10 border border-[#D95340]/20 flex items-center justify-center">
              <svg className="animate-spin" width="20" height="20" viewBox="0 0 20 20" fill="none">
                <circle cx="10" cy="10" r="8" stroke="rgba(217,83,64,0.2)" strokeWidth="2"/>
                <path d="M10 2a8 8 0 0 1 8 8" stroke="#D95340" strokeWidth="2" strokeLinecap="round"/>
              </svg>
            </div>
            <div className="flex flex-col items-center gap-1 text-center">
              <p className="text-[13px] font-semibold text-[#F5F5F4]">Carregando arquivos…</p>
              <p className="text-[11px] text-[#8F8883]">
                {scanTotal !== null && scanTotal > 0 ? `${scanDone} de ${scanTotal} arquivos` : "Lendo pasta…"}
              </p>
            </div>
            <div className="w-full rounded-full overflow-hidden" style={{ height: 3, background: "rgba(255,255,255,0.06)" }}>
              <div
                className="h-full rounded-full transition-all duration-150"
                style={{
                  width: scanTotal && scanTotal > 0 ? `${Math.round((scanDone / scanTotal) * 100)}%` : "0%",
                  background: "linear-gradient(90deg, #B34435, #D95340)"
                }}
              />
            </div>
          </div>
        </div>
      )}

      {showUpdateModal && appVersion && (
        <UpdateModal currentVersion={appVersion} onClose={() => setShowUpdateModal(false)} />
      )}

      {/* Modal de novas faixas detectadas */}
      {newTracksModal && (
        <NewTracksModal
          tracks={newTracksModal}
          onAddAndEnrich={(tracks) => handleAddNewTracks(tracks, true)}
          onAddOnly={(tracks) => handleAddNewTracks(tracks, false)}
          onDefer={handleDeferNewTracks}
        />
      )}

      {/* Oferta de playlist pós-adição */}
      {playlistOffer && !createPlaylistTracks && (
        <NewTracksPlaylistOffer
          tracks={playlistOffer}
          onCreatePlaylist={(tracks) => { setPlaylistOffer(null); setCreatePlaylistTracks(tracks); }}
          onDismiss={() => setPlaylistOffer(null)}
        />
      )}

      {/* CreatePlaylistModal disparado pelo fluxo de novas faixas */}
      {createPlaylistTracks && (
        <CreatePlaylistModal
          tracks={createPlaylistTracks}
          onClose={() => setCreatePlaylistTracks(null)}
        />
      )}

      {/* Exportar playlist existente via context menu da sidebar */}
      {exportPlaylistTarget && (() => {
        const plTracks = allTracks.filter((t) => exportPlaylistTarget.trackPaths.includes(t.path));
        return (
          <CreatePlaylistModal
            tracks={plTracks}
            exportOnly={{ playlistId: exportPlaylistTarget.id, playlistName: exportPlaylistTarget.name }}
            onClose={() => setExportPlaylistTarget(null)}
          />
        );
      })()}

      {/* Drag & drop overlay */}
      {isDragOver && (
        <div className="fixed inset-0 z-[500] bg-[#0E0D0C]/80 flex items-center justify-center pointer-events-none">
          <div className="flex flex-col items-center gap-3 border-2 border-dashed border-[#D95340]/60 rounded-2xl px-16 py-12 bg-[#D95340]/[0.04]">
            <svg width="40" height="40" viewBox="0 0 40 40" fill="none" stroke="#D95340" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="opacity-80">
              <path d="M6 14C6 11.24 8.24 9 11 9H16L19 12H29C31.76 12 34 14.24 34 17V28C34 30.76 31.76 33 29 33H11C8.24 33 6 30.76 6 28V14Z"/>
              <path d="M20 18v8M17 23l3 3 3-3"/>
            </svg>
            <span className="text-[#D95340] text-sm font-semibold uppercase tracking-widest">{t("app.dragDrop")}</span>
          </div>
        </div>
      )}

      {missingMeta && (
        <MissingMetaPrompt
          totalTracks={allTracks.length}
          folderName={lastFolder ? lastFolder.split(/[\\/]/).filter(Boolean).pop() ?? lastFolder : undefined}
          missingGenre={missingMeta.missingGenre}
          missingYear={missingMeta.missingYear}
          missingAlbum={missingMeta.missingAlbum}
          bitrateHigh={missingMeta.bitrateHigh}
          bitrateMid={missingMeta.bitrateMid}
          bitrateLow={missingMeta.bitrateLow}
          onDismiss={() => {
            setMissingMeta(null);
            // "Deixar para depois" também marca a pasta — evita o modal repetindo
            const folder = useAppStore.getState().lastFolder;
            if (folder) markFolderEnriched(folder);
          }}
          onEnrich={() => {
            setMissingMeta(null);
            const folder = useAppStore.getState().lastFolder;
            if (folder) markFolderEnriched(folder);
            batchEnrich("all");
          }}
        />
      )}

      {/* Loading overlay — abertura e fechamento */}
      {appLoading && (
        <div className="fixed inset-0 z-[1000] bg-[#0E0D0C] flex flex-col items-center justify-center gap-5 pointer-events-none">
          <div className="relative" style={{ width: 80, height: 80 }}>
            {/* Spinner: anel fino com cauda girando ao redor do disco */}
            <svg
              className="animate-[spin_1.6s_linear_infinite]"
              viewBox="0 0 100 100" width="80" height="80"
              style={{ position: 'absolute', inset: 0 }}
            >
              {/* Cauda longa e suave */}
              <circle cx="50" cy="50" r="49" fill="none" stroke="#D95340" strokeWidth="1.5"
                strokeLinecap="round" strokeDasharray="100 209" opacity="0.22"/>
              {/* Arco principal brilhante */}
              <circle cx="50" cy="50" r="49" fill="none" stroke="#D95340" strokeWidth="2"
                strokeLinecap="round" strokeDasharray="48 261" opacity="0.9"/>
            </svg>
            {/* Disco estático — logo original */}
            <svg viewBox="0 0 100 100" width="72" height="72"
              style={{ position: 'absolute', top: 4, left: 4 }}>
              <circle cx="50" cy="50" r="46" fill="#D95340"/>
              <circle cx="50" cy="50" r="43.5" fill="none" stroke="#B84030" strokeWidth="0.6" opacity="0.7"/>
              <circle cx="50" cy="50" r="41"   fill="none" stroke="#B84030" strokeWidth="0.6" opacity="0.65"/>
              <circle cx="50" cy="50" r="38.5" fill="none" stroke="#B84030" strokeWidth="0.6" opacity="0.6"/>
              <circle cx="50" cy="50" r="36"   fill="none" stroke="#B84030" strokeWidth="0.6" opacity="0.55"/>
              <circle cx="50" cy="50" r="33.5" fill="none" stroke="#B84030" strokeWidth="0.6" opacity="0.5"/>
              <circle cx="50" cy="50" r="31"   fill="none" stroke="#B84030" strokeWidth="0.6" opacity="0.4"/>
              {/* Buraco central */}
              <circle cx="50" cy="50" r="27" fill="#0E0D0C"/>
            </svg>
          </div>
          <span className="text-[11px] font-mono tracking-widest uppercase" style={{ color: '#605A55' }}>
            {loadingLabel(appLoading)}
          </span>
        </div>
      )}
    </div>
  );
}
