import { invoke } from "@tauri-apps/api/core";
import { enrichTrackFull } from "./services/SpotifyService";
import { searchTrack as iTunesSearch } from "./services/iTunesService";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open, save } from "@tauri-apps/plugin-dialog";
import { getVersion } from "@tauri-apps/api/app";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAppStore, type Track } from "./store";
import TrackTable from "./components/TrackTable";
import Inspector from "./components/Inspector";
import Sidebar from "./components/Sidebar";
import MiniPlayer from "./components/MiniPlayer";
import DeleteConfirmDialog from "./components/DeleteConfirmDialog";
import MissingMetaPrompt from "./components/MissingMetaPrompt";
import TrialExpiredModal from "./components/TrialExpiredModal";
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
import OfflineBanner, { useIsOnline } from "./components/OfflineBanner";
import VideoPlayerModal from "./components/VideoPlayerModal";
import EnrichResultModal from "./components/EnrichResultModal";

function loadingLabel(mode: "startup" | "closing"): string {
  const lang = navigator.language.toLowerCase();
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
    theme,
  } = useAppStore();

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
        try {
          const sysTheme = await getCurrentWindow().theme();
          document.documentElement.setAttribute("data-theme", sysTheme === "light" ? "light" : "dark");
        } catch {
          const isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
          document.documentElement.setAttribute("data-theme", isDark ? "dark" : "light");
        }
        // Escuta mudanças de tema do SO em tempo real
        unlisten = await getCurrentWindow().onThemeChanged(({ payload }) => {
          document.documentElement.setAttribute("data-theme", payload === "light" ? "light" : "dark");
        });
      }
    }

    apply();
    return () => { unlisten?.(); };
  }, [theme]);

  // Bloqueia o menu de contexto nativo do WebView (Reload / Inspect Element)
  useEffect(() => {
    const block = (e: MouseEvent) => e.preventDefault();
    document.addEventListener("contextmenu", block);
    return () => document.removeEventListener("contextmenu", block);
  }, []);

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

  const { columnVisibility, setColumnVisibility } = useAppStore();

  const HIDEABLE_COLS = [
    { id: "capa",         label: "Capa" },
    { id: "album",        label: "Álbum" },
    { id: "genre",        label: "Gênero" },
    { id: "artist",       label: "Artista" },
    { id: "year_col",     label: "Ano" },
    { id: "status",       label: "Status" },
    { id: "file_size",    label: "Tamanho" },
    { id: "key",          label: "Tom" },
    { id: "bpm",          label: "BPM" },
    { id: "rating",       label: "Nota" },
    { id: "duration_secs",label: "Duração" },
    { id: "bitrate",      label: "Bitrate" },
    { id: "tipo",         label: "Tipo" },
    { id: "adicionada",   label: "Adicionada" },
    { id: "comment",      label: "Comentário" },
  ];
  const DEFAULT_HIDDEN_COLS = new Set(["tipo", "adicionada", "comment"]);
  const isColVisible = (id: string) =>
    id in columnVisibility ? columnVisibility[id] : !DEFAULT_HIDDEN_COLS.has(id);

  const [showColPicker, setShowColPicker] = useState(false);
  const colPickerRef = useRef<HTMLDivElement>(null);

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

  const [sidebarWidth, setSidebarWidth]     = useState(208);
  const [rightPanelTab, setRightPanelTab]   = useState<"selected" | "library">("library");
  const [mediaTab, setMediaTab]             = useState<"audio" | "video">("audio");

  const VIDEO_FORMATS = new Set(["mp4", "mkv", "avi", "mov", "wmv", "webm", "m4v"]);
  const isVideo = (t: { format?: string | null }) =>
    VIDEO_FORMATS.has((t.format ?? "").toLowerCase());

  const videoCount = allTracks.filter(isVideo).length;
  const hasVideos  = videoCount > 0;

  // Filtra por aba de mídia (Áudio / Vídeo)
  const tracksForMedia = useMemo(() =>
    mediaTab === "video" ? tracks.filter(isVideo) : tracks.filter((t) => !isVideo(t)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tracks, mediaTab]
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
  const [tourPlayerVisible, setTourPlayerVisible] = useState(false);
  const [searchExpanded, setSearchExpanded] = useState(false);
  const [showOfflineBanner, setShowOfflineBanner] = useState(false);
  const isOnline = useIsOnline();
  // Fecha o banner automaticamente quando a conexão voltar
  useEffect(() => { if (isOnline) setShowOfflineBanner(false); }, [isOnline]);
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

  async function exportCsv() {
    if (allTracks.length === 0) return;
    const outPath = await save({
      defaultPath: "TagWave_Export.csv",
      filters: [{ name: "CSV", extensions: ["csv"] }],
    });
    if (!outPath) return;
    setExporting(true);
    try {
      const count = await invoke<number>("export_csv", { tracks: allTracks, outputPath: outPath });
      toast(`CSV exportado · ${count} faixas`);
    } finally {
      setExporting(false);
    }
  }

  async function exportTraktorNml() {
    if (allTracks.length === 0) return;
    const outPath = await save({
      defaultPath: "TagWave_Traktor.nml",
      filters: [{ name: "Traktor NML", extensions: ["nml"] }],
    });
    if (!outPath) return;
    setExporting(true);
    try {
      const count = await invoke<number>("export_traktor_nml", { tracks: allTracks, outputPath: outPath });
      toast(`Traktor NML exportado · ${count} faixas`);
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
      toast("Nenhuma faixa com padrão 'Artista - Título' no nome", "info");
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
          trackNumber: null, bpm: null, key: null, rating: null,
        }).catch(() => {});
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
      toast(`${restored} faixa${restored !== 1 ? "s" : ""} restaurada${restored !== 1 ? "s" : ""} a partir dos nomes`, "success");
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
          trackNumber: orig.track_number ?? null, bpm: orig.bpm ?? null,
          key: orig.key ?? null, rating: orig.rating ?? null,
        }).catch(() => {});
        useAppStore.getState().updateTrack(orig);
      }
      toast(`${snapshot.length} faixa${snapshot.length !== 1 ? "s" : ""} restaurada${snapshot.length !== 1 ? "s" : ""}`, "success");
    } finally {
      setEnriching(false);
    }
  }

  async function batchEnrich(source: "all" | "itunes" | "spotify" = "all", folderPath?: string) {
    if (!navigator.onLine) {
      setShowOfflineBanner(true);
      setTimeout(() => setShowOfflineBanner(false), 4000);
      return;
    }

    const selected = allTracks.filter((t) => selectedIds.has(t.id));
    const isExplicitSelection = selected.length > 0;
    const targets = isExplicitSelection
      ? selected
      : allTracks.filter((t) => !t.genre || !t.album || !t.year);
    if (targets.length === 0) { toast("Todas as faixas já têm metadados completos", "info"); return; }

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
                  await invoke("save_tags", { path: updated.path, title: updated.title ?? null, artist: updated.artist ?? null, album: updated.album ?? null, genre: updated.genre ?? null, year: updated.year ?? null, trackNumber: updated.track_number ?? null, bpm: updated.bpm ?? null, key: updated.key ?? null, rating: updated.rating ?? null }).catch(() => {});
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
            useAppStore.setState((s) => ({ selectedIds: new Set([...s.selectedIds].filter((id) => id !== track.id)) }));
          }, 700);
          setEnrichProgress({ done: i + 1, total: targets.length });
          if (i < targets.length - 1) await new Promise<void>((res) => setTimeout(res, 250));
        }
        toast(
          found > 0
            ? `iTunes: ${found}/${targets.length} encontradas · ${enriched} enriquecidas`
            : `iTunes: 0/${targets.length} encontradas — tente Spotify`,
          found > 0 ? "success" : "info",
          found > 0 ? { label: "Desfazer", fn: undoEnrich } : undefined,
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
                  await invoke("save_tags", { path: updated.path, title: updated.title ?? null, artist: updated.artist ?? null, album: updated.album ?? null, genre: updated.genre ?? null, year: updated.year ?? null, trackNumber: updated.track_number ?? null, bpm: updated.bpm ?? null, key: updated.key ?? null, rating: updated.rating ?? null }).catch(() => {});
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
            useAppStore.setState((s) => ({ selectedIds: new Set([...s.selectedIds].filter((id) => id !== track.id)) }));
          }, 700);
          setEnrichProgress({ done: i + 1, total: targets.length });
          if (i < targets.length - 1) await new Promise<void>((res) => setTimeout(res, 350));
        }
        toast(
          found > 0
            ? `Spotify: ${found}/${targets.length} encontradas · ${enriched} enriquecidas`
            : `Spotify: 0/${targets.length} encontradas — tente iTunes`,
          found > 0 ? "success" : "info",
          found > 0 ? { label: "Desfazer", fn: undoEnrich } : undefined,
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
              bpm: updated.bpm ?? null, key: updated.key ?? null,
              rating: updated.rating ?? null,
            }).catch(() => {});
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
          useAppStore.setState((s) => ({ selectedIds: new Set([...s.selectedIds].filter((id) => id !== track.id)) }));
        }, 700);
        setEnrichProgress({ done: i + 1, total: targets.length });
        if (i < targets.length - 1) await new Promise<void>((res) => setTimeout(res, 400));
      }

      // Aguarda capas (disparadas em background durante o loop de metadados)
      await Promise.allSettled(coverPromises);

      const parts: string[] = [];
      if (found > 0)            parts.push(`${found}/${targets.length} encontradas`);
      if (enriched > 0)         parts.push(`${enriched} enriquecidas`);
      if (coverStats.count > 0) parts.push(`${coverStats.count} capas`);

      if (enriched > 0) useAppStore.getState().recordEnrichment(enriched);

      // Encadear análise de BPM para faixas que ainda não têm BPM após enriquecimento
      const stillNoBpm = targets.filter((t) => {
        const fresh = useAppStore.getState().tracks.find((s) => s.path === t.path);
        return !fresh?.bpm;
      });
      if (stillNoBpm.length > 0) {
        parts.push(`${stillNoBpm.length} aguardando BPM`);
        setTimeout(() => batchAnalyzeBpm(stillNoBpm), 800);
      }

      if (folderPath) {
        // Modo pasta: exibe modal de resultado em vez de toast
        const folderName = folderPath.split(/[\\/]/).filter(Boolean).pop() ?? folderPath;
        setEnrichResultModal({ total: targets.length, enriched, covers: coverStats.count, folderName });
      } else {
        toast(
          parts.length > 0
            ? `iTunes+Spotify: ${parts.join(" · ")}`
            : "Nenhuma informação nova encontrada",
          enriched > 0 ? "success" : "info",
          enriched > 0 ? { label: "Desfazer", fn: undoEnrich } : undefined,
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
      toast("Nenhuma faixa de áudio para analisar", "info");
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
            await invoke("save_tags", {
              path: track.path,
              title: track.title ?? null, artist: track.artist ?? null,
              album: track.album ?? null, genre: track.genre ?? null,
              year: track.year ?? null, trackNumber: track.track_number ?? null,
              bpm: bpmStr, key: track.key ?? null, rating: track.rating ?? null,
            }).catch(() => {});
            useAppStore.getState().updateTrack({ ...track, bpm: bpmStr });
            analyzed++;
          }
        } catch { /* pula faixas com erro */ }

        setAnalyzingBpmIds(new Set());
        setBpmDoneIds((prev) => new Set([...prev, track.id]));
        setTimeout(() => {
          setBpmDoneIds((prev) => { const n = new Set(prev); n.delete(track.id); return n; });
          useAppStore.setState((s) => ({
            selectedIds: new Set([...s.selectedIds].filter((id) => id !== track.id)),
          }));
        }, 700);

        setBpmProgress({ done: i + 1, total: targets.length });
      }
      toast(
        analyzed > 0
          ? `BPM analisado em ${analyzed} faixa${analyzed !== 1 ? "s" : ""}`
          : "Nenhum BPM detectado",
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
    setScanning(true);
    setScanTotal(null);
    setScanDone(0);
    setFilenameIssues([]);
    setFilenameMetaIssues([]);
    setParenIssues([]);
    setDuplicateGroups([]);
    setGenreFilter(null);

    const unlistenSkipped = await listen<{ count: number }>("scan_skipped", ({ payload }) => {
      const n = payload.count;
      toast(
        `${n} arquivo${n !== 1 ? "s" : ""} ignorado${n !== 1 ? "s" : ""} — formato não suportado (não é áudio nem vídeo)`,
        "info",
      );
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

  const [appLoading, setAppLoading] = useState<"startup" | "closing" | null>("startup");
  const [appVersion, setAppVersion] = useState("");
  const [showTrialInfo, setShowTrialInfo] = useState(false);
  const isSavingRef = useRef(false);

  useEffect(() => { getVersion().then(setAppVersion).catch(() => {}); }, []);

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

          // Detecta arquivos novos adicionados desde a última sessão
          try {
            const knownPaths = activeTracks.map((t) => t.path);
            const newPaths = await invoke<string[]>("find_new_files", {
              folder: lastF,
              knownPaths,
            });
            if (newPaths.length > 0) {
              const newTracks = await invoke<Track[]>("scan_specific_files", { paths: newPaths });
              if (newTracks.length > 0) {
                const ids = new Set(newTracks.map((t) => t.id));
                useAppStore.getState().setTracks([...newTracks, ...activeTracks]);
                setNewTrackIds(ids);
                checkMissingMeta(newTracks);
              }
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
        onDoubleClick={(e) => {
          // Duplo clique em área vazia da toolbar → maximizar/restaurar (comportamento macOS)
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
          title="Abrir Pasta (⌘O)"
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
              title="Restaurar Artista, Título e Ano a partir do nome do arquivo (padrão: Artista - Título [Ano].mp3)"
            >
              <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 5.5A3.5 3.5 0 108.5 2.5L7 4"/><path d="M2 2.5v3h3"/>
              </svg>
              {restoringFromName
                ? "Restaurando…"
                : selectedIds.size > 0
                  ? `Restaurar ${selectedIds.size}`
                  : "Restaurar de Nomes"}
            </button>
          )}
          {/* Botão Desfazer — aparece após enriquecimento enquanto snapshot está disponível */}
          {enrichUndoSnapshot && (
            <button
              onClick={undoEnrich}
              disabled={enriching}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-semibold text-[#EAB308] hover:text-[#F59E0B] hover:bg-yellow-500/[0.08] border border-yellow-500/20 disabled:opacity-40 transition-colors whitespace-nowrap shrink-0"
              title="Desfazer último enriquecimento"
            >
              <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 5.5A3.5 3.5 0 108.5 2.5L7 4"/>
                <path d="M2 2.5v3h3"/>
              </svg>
              Desfazer
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
              title="Analisar BPM em lote de todas as faixas selecionadas"
            >
              <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
                <path d="M1 8l2-4 2 2.5 2-5 2 3 1-2"/>
              </svg>
              {analyzingBpm && bpmProgress
                ? `BPM ${bpmProgress.done}/${bpmProgress.total}`
                : selectedIds.size > 0
                  ? `BPM (${selectedIds.size})`
                  : "Analisar BPM"}
            </button>
          )}
          {allTracks.length > 0 && (
            <div className="relative group" data-tour="enrich">
              <button
                onClick={() => batchEnrich("all")}
                disabled={enriching || isScanning}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-semibold text-[#605A55] hover:text-[#756D67] hover:bg-white/[0.04] disabled:opacity-40 transition-colors whitespace-nowrap shrink-0"
                title="Enriquecer metadados faltantes via iTunes + Spotify"
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
              <div className="absolute top-full left-0 pt-1 hidden group-hover:block z-50 min-w-[160px]">
                <div className="py-1 bg-[#1c1917] border border-white/[0.07] rounded-md shadow-xl">
                  <button onClick={() => batchEnrich("all")} disabled={enriching} className="w-full px-3 py-1.5 text-left text-[11px] text-[#C2BEBC] hover:bg-white/[0.05] transition-colors disabled:opacity-40">
                    Todos os serviços
                  </button>
                  <button onClick={() => batchEnrich("itunes")} disabled={enriching} className="w-full px-3 py-1.5 text-left text-[11px] text-[#C2BEBC] hover:bg-white/[0.05] transition-colors disabled:opacity-40">
                    Só iTunes
                  </button>
                  <button onClick={() => batchEnrich("spotify")} disabled={enriching} className="w-full px-3 py-1.5 text-left text-[11px] text-[#C2BEBC] hover:bg-white/[0.05] transition-colors disabled:opacity-40">
                    Só Spotify
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
              {/* pt-1: padding transparente que cobre o gap e mantém o hover contínuo */}
              <div className="absolute top-full left-0 pt-1 hidden group-hover:block z-50 min-w-[180px]">
                <div className="py-1 bg-[#1c1917] border border-white/[0.07] rounded-md shadow-xl">
                  <button
                    onClick={exportRekordbox}
                    className="w-full px-3 py-1.5 text-left text-[11px] text-[#C2BEBC] hover:bg-white/[0.05] transition-colors"
                  >
                    Rekordbox XML
                  </button>
                  <button
                    onClick={exportTraktorNml}
                    className="w-full px-3 py-1.5 text-left text-[11px] text-[#C2BEBC] hover:bg-white/[0.05] transition-colors"
                  >
                    Traktor NML
                  </button>
                  <button
                    onClick={exportM3U}
                    className="w-full px-3 py-1.5 text-left text-[11px] text-[#C2BEBC] hover:bg-white/[0.05] transition-colors"
                  >
                    M3U
                  </button>
                  <button
                    onClick={exportM3U}
                    className="w-full px-3 py-1.5 text-left text-[11px] text-[#C2BEBC] hover:bg-white/[0.05] transition-colors"
                  >
                    Serato DJ
                  </button>
                  <button
                    onClick={exportM3U}
                    className="w-full px-3 py-1.5 text-left text-[11px] text-[#C2BEBC] hover:bg-white/[0.05] transition-colors"
                  >
                    djay Pro
                  </button>
                  <button
                    onClick={exportM3U}
                    className="w-full px-3 py-1.5 text-left text-[11px] text-[#C2BEBC] hover:bg-white/[0.05] transition-colors"
                  >
                    Virtual DJ
                  </button>
                  <button
                    onClick={exportCsv}
                    className="w-full px-3 py-1.5 text-left text-[11px] text-[#C2BEBC] hover:bg-white/[0.05] transition-colors"
                  >
                    CSV Universal
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Stats */}
        {allTracks.length > 0 && (
          <span className="text-[11px] text-[#605A55] font-mono ml-1 whitespace-nowrap shrink-0">
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
                  placeholder="buscar…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onBlur={() => { if (!searchQuery) setSearchExpanded(false); }}
                />
              </>
            ) : (
              <button
                onClick={() => setSearchExpanded(true)}
                title="Buscar (clique para expandir)"
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
        {!/^Mac/.test(navigator.platform) && (
          <div className="flex items-center shrink-0 ml-1">
            <button
              onClick={() => getCurrentWindow().minimize()}
              className="w-9 h-7 flex items-center justify-center text-[#605A55] hover:text-[#C2BEBC] hover:bg-white/[0.06] transition-colors rounded"
              title="Minimizar"
            >
              <svg width="10" height="2" viewBox="0 0 10 2" fill="currentColor"><rect width="10" height="1.5" rx="0.5"/></svg>
            </button>
            <button
              onClick={async () => {
                const w = getCurrentWindow();
                if (await w.isMaximized()) w.unmaximize(); else w.maximize();
              }}
              className="w-9 h-7 flex items-center justify-center text-[#605A55] hover:text-[#C2BEBC] hover:bg-white/[0.06] transition-colors rounded"
              title="Maximizar"
            >
              <svg width="9" height="9" viewBox="0 0 9 9" fill="none" stroke="currentColor" strokeWidth="1.4"><rect x="0.7" y="0.7" width="7.6" height="7.6" rx="1"/></svg>
            </button>
            <button
              onClick={() => getCurrentWindow().close()}
              className="w-9 h-7 flex items-center justify-center text-[#605A55] hover:text-white hover:bg-[#D95340] transition-colors rounded"
              title="Fechar"
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
              <span className="text-[10px] font-semibold text-[#D95340]/70 group-hover:text-[#E07364] transition-colors">faixas para enriquecer</span>
            </button>
          ) : <span />}

          <div className="flex items-center gap-2.5">
            {!isTrialActivated() && (
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setShowTrialInfo(true)}
                  className="text-[9px] font-bold font-mono text-[#D95340] hover:text-[#E07364] tabular-nums transition-colors"
                  title={`Trial: ${daysRemaining()} dias restantes — clique para detalhes`}
                >
                  Trial · {daysRemaining()}d
                </button>
                <button
                  onClick={() => setShowTrialInfo(true)}
                  className="px-2 py-0.5 rounded text-[9px] font-bold bg-[#D95340] hover:bg-[#E07364] active:bg-[#B34435] text-white transition-colors"
                  title="Comprar licença completa"
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
                title="Gerenciar colunas"
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
                    Colunas
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
                  <div className="border-t border-white/[0.05] pt-1.5 px-3 mt-0.5">
                    <button
                      onClick={() => {
                        const reset: Record<string, boolean> = {};
                        HIDEABLE_COLS.forEach((c) => { reset[c.id] = true; });
                        setColumnVisibility(reset);
                      }}
                      className="text-[10px] text-[#605A55] hover:text-[#8F8883] transition-colors"
                    >
                      Mostrar todas
                    </button>
                  </div>
                </div>
              )}
            </div>

            <button
              onClick={() => setShowSettings(true)}
              title="Configurações (⌘,)"
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
      <div className="flex flex-1 overflow-hidden">
        {showSidebar && (
          <div className="shrink-0 flex relative" style={{ width: sidebarWidth }}>
            <Sidebar
                onFolderSelect={scanFolder}
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
                      {isAudio ? "Áudio" : "Vídeo"}
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
            {/* Conteúdo principal — split view quando há músicas novas */}
            <div className="flex flex-col flex-1 overflow-hidden">
              {newTrackIds.size > 0 && (() => {
                const newTracks = tracks.filter((t) => newTrackIds.has(t.id));
                if (newTracks.length === 0) return null;
                return (
                  <div className="flex flex-col border-b-2 border-[#D95340]/25" style={{ maxHeight: "42%" }}>
                    <div className="flex items-center gap-2 px-4 py-2 bg-[#1a0f0e] border-b border-[#D95340]/20 shrink-0">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#D95340] shrink-0" style={{ animation: "pulse 2s ease-in-out infinite" }} />
                      <span className="text-[9px] font-bold text-[#D95340] uppercase tracking-widest">
                        {newTracks.length} {newTracks.length === 1 ? "música nova" : "músicas novas"}
                      </span>
                      <span className="text-[9px] text-[#605A55]">adicionadas desde a última sessão</span>
                    </div>
                    <TrackTable tracks={newTracks} compact={compact} hasFolder={true} />
                  </div>
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
                onEnrich={() => batchEnrich("all")}
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
                      Selecionado
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
                      Biblioteca
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
        </div>
      </div>

      {(selectedIds.size > 0 || !!playerTrackId || tourPlayerVisible) && (
        <div data-tour="player" style={{ animation: 'slide-up-player 0.18s ease-out' }}>
          <MiniPlayer />
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
                    ? "Pasta não encontrada"
                    : `${ghostFolders.length} pastas não encontradas`}
                </p>
                <p className="text-[#8F8883] text-[12px] mt-1 leading-relaxed">
                  {ghostFolders.length === 1
                    ? "Esta pasta não existe mais no disco. Deseja removê-la da lista?"
                    : "Estas pastas não existem mais no disco. Deseja removê-las da lista?"}
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
                Agora não
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
                Sim, remover
              </button>
            </div>
          </div>
        </div>
      )}

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
          folderName={lastFolder ? lastFolder.split(/[\\/]/).filter(Boolean).pop() ?? lastFolder : undefined}
          missingGenre={missingMeta.missingGenre}
          missingYear={missingMeta.missingYear}
          missingAlbum={missingMeta.missingAlbum}
          bitrateHigh={missingMeta.bitrateHigh}
          bitrateMid={missingMeta.bitrateMid}
          bitrateLow={missingMeta.bitrateLow}
          onDismiss={() => setMissingMeta(null)}
          onEnrich={() => {
            setMissingMeta(null);
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
