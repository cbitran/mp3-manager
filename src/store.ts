import { create } from "zustand";

export interface CuePoint {
  index: number;
  position_ms: number;
  label: string;
  color: string;  // "#RRGGBB"
}

export interface Track {
  id: string;
  path: string;
  filename: string;
  title?: string;
  artist?: string;
  album?: string;
  genre?: string;
  year?: number;
  track_number?: number;
  bpm?: string;
  key?: string;
  rating?: number;
  duration_secs?: number;
  file_size_bytes: number;
  has_cover: boolean;
  cover_version: number;
  issues: string[];
  format: string;
  bitrate_kbps?: number;
  sample_rate_hz?: number;
  modified_at?: number;
  comment?: string;
  total_tracks?: number;
  cue_points: CuePoint[];
  beat_phase_ms?: number | null;
  beat_anchors?: { beat_index: number; position_ms: number }[] | null;
}

export type FilterTab = "all" | "favorites" | "problems" | "ok" | "recent";

export interface PlaylistGlobalProperties {
  enabled: boolean;
  activeFields: ('cover' | 'album' | 'genre' | 'comment')[];
  cover?: string;
  album?: string;
  genre?: string;
  comment?: string;
}

export interface Playlist {
  id: string;
  name: string;
  trackPaths: string[];
  createdAt: number;
  updatedAt: number;
  lastExportedTo?: string[];
  globalProperties?: PlaylistGlobalProperties;
  pendingRulesApply?: boolean;
}

export interface DragState {
  isDragging: boolean;
  draggedTrackIds: string[];
  hoveredPlaylistId: string | null;
  hoveringNewPlaylist: boolean;
}

export interface UndoEntry {
  description: string;
  playlistId: string;
  addedPaths: string[];
  metadataSnapshot: { path: string; album?: string; genre?: string; comment?: string }[];
}

const LAST_FOLDER_KEY    = "mp3mgr_lastFolder";
const FAVORITES_KEY      = "mp3mgr_favorites";
const FAV_TRACKS_KEY     = "mp3mgr_favTracks";
const RECENT_KEY         = "mp3mgr_recentFolders";

const PLAYLISTS_KEY      = "tagwave_playlists";
const PENDING_NEW_KEY    = "tagwave_pendingNewTracks";
const WATCHED_FOLDERS_KEY = "tagwave_watchedFolders";

export interface PendingNewTrack {
  path: string;
  folderPath: string;
  detectedAt: number;
  shownSession: boolean; // true = usuário clicou "Depois" uma vez; próxima abertura integra automaticamente
}

const TRIAL_DAYS         = 14;
const TRIAL_START_KEY    = "tagwave_trialStartDate";
const TRACKS_ANALYZED_KEY= "tagwave_tracksAnalyzed";
const TAGS_ENRICHED_KEY  = "tagwave_tagsEnriched";
const LICENSE_KEY_STORE   = "tagwave_licenseKey";
const LICENSE_EMAIL_STORE = "tagwave_licenseEmail";

export const CURRENT_PRIVACY_VERSION = "1.0";
const PRIVACY_VERSION_KEY  = "tw_privacy_v";
const ENRICHMENT_OPT_IN_KEY = "tw_enrichment_optin";

function initTrialStart(): Date {
  const stored = localStorage.getItem(TRIAL_START_KEY);
  if (stored) return new Date(stored);
  const now = new Date();
  localStorage.setItem(TRIAL_START_KEY, now.toISOString());
  return now;
}

interface AppState {
  tracks: Track[];
  selectedIds: Set<string>;
  filterTab: FilterTab;
  searchQuery: string;
  genreFilter: string | null;
  isScanning: boolean;
  lastFolder: string | null;
  favoriteFolders: string[];
  recentFolders: string[];
  favoriteTrackPaths: Set<string>;

  // Trial / Licença
  trialStartDate: Date;
  tracksAnalyzed: number;
  tagsEnriched: number;
  licenseKey:   string;
  licenseEmail: string;

  setTracks: (tracks: Track[]) => void;
  appendTracks: (tracks: Track[]) => void;
  updateTrack: (track: Track) => void;
  removeTracks: (ids: string[]) => void;
  setScanning: (v: boolean) => void;
  toggleSelect: (id: string) => void;
  selectOnly: (id: string) => void;
  selectAll: (ids: string[]) => void;
  replaceSelection: (ids: string[]) => void;
  clearSelection: () => void;
  setFilterTab: (tab: FilterTab) => void;
  setSearchQuery: (q: string) => void;
  setGenreFilter: (genre: string | null) => void;
  setLastFolder: (path: string | null) => void;
  toggleFavorite: (path: string) => void;
  removeRecentFolder: (path: string) => void;
  toggleTrackFavorite: (path: string) => void;
  isTrackFavorite: (path: string) => boolean;
  filteredTracks: () => Track[];

  // Column visibility (persisted)
  columnVisibility: Record<string, boolean>;
  setColumnVisibility: (v: Record<string, boolean>) => void;

  // API keys
  lastFmApiKey: string;
  setLastFmApiKey: (key: string) => void;
  spotifyClientId: string;
  spotifyClientSecret: string;
  setSpotifyCredentials: (id: string, secret: string) => void;
  discogsToken: string;
  setDiscogsToken: (token: string) => void;
  acoustidKey: string;
  setAcoustidKey: (key: string) => void;
  claudeApiKey: string;
  setClaudeApiKey: (key: string) => void;
  shortcutOverrides: Record<string, string>;
  setShortcutOverride: (id: string, key: string) => void;
  resetSingleShortcut: (id: string) => void;
  resetShortcutOverrides: () => void;
  theme: "auto" | "light" | "dark";
  setTheme: (theme: "auto" | "light" | "dark") => void;
  fontScale: "100" | "115" | "130" | "150";
  setFontScale: (scale: "100" | "115" | "130" | "150") => void;
  colorMode: "default" | "deuteranopia" | "high-contrast";
  setColorMode: (mode: "default" | "deuteranopia" | "high-contrast") => void;
  helpMarkersEnabled: boolean;
  setHelpMarkersEnabled: (v: boolean) => void;
  globalLoading: string | null;
  setGlobalLoading: (msg: string | null) => void;
  fileSessionName: string | null;
  setFileSessionName: (name: string | null) => void;
  djPrimary: string;
  djAutoImport: boolean;
  djShowAll: boolean;
  setDjPrefs: (primary: string, autoImport: boolean, showAll: boolean) => void;

  // Pastas onde enriquecimento já foi tentado — modal não reaparece
  enrichedFolders: string[];
  markFolderEnriched: (path: string) => void;

  // Pastas monitoradas para detecção de novos arquivos
  watchedFolders: string[];
  addWatchedFolder: (path: string) => void;
  removeWatchedFolder: (path: string) => void;

  // Faixas novas pendentes (detectadas mas ainda não integradas)
  pendingNewTracks: PendingNewTrack[];
  setPendingNewTracks: (tracks: PendingNewTrack[]) => void;
  promotePendingTracks: (paths: string[]) => void;
  dismissPendingTracks: () => void;

  // Playlists
  playlists: Playlist[];
  activePlaylistId: string | null;
  createPlaylist: (name: string, trackPaths: string[]) => string;
  updatePlaylist: (id: string, updates: Partial<Omit<Playlist, "id" | "createdAt">>) => void;
  deletePlaylist: (id: string) => void;
  addTracksToPlaylist: (id: string, trackPaths: string[]) => void;
  removeTrackFromPlaylist: (id: string, trackPath: string) => void;
  setActivePlaylistId: (id: string | null) => void;

  // Drag state (não persiste — apenas memória)
  dragState: DragState;
  setDragState: (partial: Partial<DragState>) => void;
  clearDragState: () => void;

  // Undo stack (não persiste — apenas memória)
  undoStack: UndoEntry[];
  pushUndoEntry: (entry: UndoEntry) => void;
  popUndoEntry: () => UndoEntry | null;

  // Player
  playerTrackId: string | null;
  playerTrackNonce: number;          // incrementa em cada setPlayerTrack p/ forçar re-render
  setPlayerTrack: (id: string | null) => void;
  isPlayingGlobal: boolean;
  setIsPlayingGlobal: (playing: boolean) => void;
  playerProgress: number;   // segundos atuais
  playerDuration: number;   // duração total
  setPlayerPlayback: (progress: number, duration: number) => void;
  seekRequest: { ms: number; ts: number } | null;
  requestSeek: (ms: number) => void;
  oneShotRequest: { ms: number; ts: number } | null;
  requestOneShot: (ms: number) => void;
  scrubSeekRequest: { ms: number; ts: number } | null;
  requestScrubSeek: (ms: number) => void;
  playRequest: { trackId: string; ts: number } | null;
  requestPlay: (trackId: string) => void;

  cueEditorTrack: Track | null;
  setCueEditorTrack: (track: Track | null) => void;

  quantizeEnabled: boolean;
  setQuantizeEnabled: (v: boolean) => void;
  quantizeResolution: number;
  setQuantizeResolution: (v: number) => void;

  isTrialActivated: () => boolean;
  isTrialExpired: () => boolean;
  daysElapsed: () => number;
  daysRemaining: () => number;
  estimatedTimeSaved: () => string;
  recordScan: (count: number) => void;
  recordEnrichment: (count: number) => void;
  activateLicense: (key: string, email?: string) => void;
  extendForBeta: () => void;

  // Privacidade e consentimento (LGPD)
  privacyAcceptedVersion: string | null;
  enrichmentOptIn: boolean;
  acceptPrivacy: () => void;
  setEnrichmentOptIn: (v: boolean) => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  tracks: [],
  selectedIds: new Set(),
  playerTrackId: null,
  playerTrackNonce: 0,
  setPlayerTrack: (id) => set((s) => ({ playerTrackId: id, playerTrackNonce: s.playerTrackNonce + 1 })),
  isPlayingGlobal: false,
  setIsPlayingGlobal: (isPlayingGlobal) => set({ isPlayingGlobal }),
  playerProgress: 0,
  playerDuration: 0,
  setPlayerPlayback: (playerProgress, playerDuration) => set({ playerProgress, playerDuration }),
  seekRequest: null,
  requestSeek: (ms) => set({ seekRequest: { ms, ts: Date.now() } }),
  oneShotRequest: null,
  requestOneShot: (ms) => set({ oneShotRequest: { ms, ts: Date.now() } }),
  scrubSeekRequest: null,
  requestScrubSeek: (ms) => set({ scrubSeekRequest: { ms, ts: Date.now() } }),
  playRequest: null,
  requestPlay: (trackId) => set({ playRequest: { trackId, ts: Date.now() }, playerTrackId: trackId }),
  cueEditorTrack: null,
  setCueEditorTrack: (track) => set({ cueEditorTrack: track }),
  quantizeEnabled: localStorage.getItem("tagwave_quantize") === "true",
  setQuantizeEnabled: (v) => {
    localStorage.setItem("tagwave_quantize", String(v));
    set({ quantizeEnabled: v });
  },
  quantizeResolution: parseInt(localStorage.getItem("tagwave_quantize_res") ?? "4", 10),
  setQuantizeResolution: (v) => {
    localStorage.setItem("tagwave_quantize_res", String(v));
    set({ quantizeResolution: v });
  },
  filterTab: "all",
  genreFilter: null,
  searchQuery: "",
  isScanning: false,
  lastFolder: localStorage.getItem(LAST_FOLDER_KEY),
  favoriteFolders: JSON.parse(localStorage.getItem(FAVORITES_KEY) ?? "[]"),
  recentFolders: JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]"),
  favoriteTrackPaths: new Set(JSON.parse(localStorage.getItem(FAV_TRACKS_KEY) ?? "[]")),

  // Pastas onde enriquecimento já foi tentado
  enrichedFolders: JSON.parse(localStorage.getItem("tagwave_enriched_folders") ?? "[]") as string[],
  markFolderEnriched: (path) => {
    const next = [...new Set([path, ...get().enrichedFolders])];
    localStorage.setItem("tagwave_enriched_folders", JSON.stringify(next));
    set({ enrichedFolders: next });
  },

  // Pastas monitoradas
  watchedFolders: JSON.parse(localStorage.getItem(WATCHED_FOLDERS_KEY) ?? "[]") as string[],
  addWatchedFolder: (path) => {
    const next = [...new Set([path, ...get().watchedFolders])];
    localStorage.setItem(WATCHED_FOLDERS_KEY, JSON.stringify(next));
    set({ watchedFolders: next });
  },
  removeWatchedFolder: (path) => {
    const next = get().watchedFolders.filter((f) => f !== path);
    localStorage.setItem(WATCHED_FOLDERS_KEY, JSON.stringify(next));
    set({ watchedFolders: next });
  },

  // Faixas novas pendentes
  pendingNewTracks: JSON.parse(localStorage.getItem(PENDING_NEW_KEY) ?? "[]") as PendingNewTrack[],
  setPendingNewTracks: (tracks) => {
    localStorage.setItem(PENDING_NEW_KEY, JSON.stringify(tracks));
    set({ pendingNewTracks: tracks });
  },
  promotePendingTracks: (paths) => {
    const pathSet = new Set(paths);
    const remaining = get().pendingNewTracks.filter((p) => !pathSet.has(p.path));
    localStorage.setItem(PENDING_NEW_KEY, JSON.stringify(remaining));
    set({ pendingNewTracks: remaining });
  },
  dismissPendingTracks: () => {
    localStorage.setItem(PENDING_NEW_KEY, "[]");
    set({ pendingNewTracks: [] });
  },

  // Playlists
  playlists: JSON.parse(localStorage.getItem(PLAYLISTS_KEY) ?? "[]") as Playlist[],
  activePlaylistId: null,
  createPlaylist: (name, trackPaths) => {
    const pl: Playlist = {
      id: `pl_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      name, trackPaths,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const next = [pl, ...get().playlists];
    localStorage.setItem(PLAYLISTS_KEY, JSON.stringify(next));
    set({ playlists: next });
    return pl.id;
  },
  updatePlaylist: (id, updates) => {
    const next = get().playlists.map((p) =>
      p.id === id ? { ...p, ...updates, updatedAt: Date.now() } : p
    );
    localStorage.setItem(PLAYLISTS_KEY, JSON.stringify(next));
    set({ playlists: next });
  },
  deletePlaylist: (id) => {
    const next = get().playlists.filter((p) => p.id !== id);
    localStorage.setItem(PLAYLISTS_KEY, JSON.stringify(next));
    const active = get().activePlaylistId;
    set({ playlists: next, activePlaylistId: active === id ? null : active });
  },
  addTracksToPlaylist: (id, trackPaths) => {
    const next = get().playlists.map((p) => {
      if (p.id !== id) return p;
      const merged = [...new Set([...p.trackPaths, ...trackPaths])];
      return { ...p, trackPaths: merged, updatedAt: Date.now() };
    });
    localStorage.setItem(PLAYLISTS_KEY, JSON.stringify(next));
    set({ playlists: next });
  },
  removeTrackFromPlaylist: (id, trackPath) => {
    const next = get().playlists.map((p) =>
      p.id === id
        ? { ...p, trackPaths: p.trackPaths.filter((tp) => tp !== trackPath), updatedAt: Date.now() }
        : p
    );
    localStorage.setItem(PLAYLISTS_KEY, JSON.stringify(next));
    set({ playlists: next });
  },
  setActivePlaylistId: (activePlaylistId) => set({ activePlaylistId }),

  dragState: { isDragging: false, draggedTrackIds: [], hoveredPlaylistId: null, hoveringNewPlaylist: false },
  setDragState: (partial) => set((s) => ({ dragState: { ...s.dragState, ...partial } })),
  clearDragState: () => set({ dragState: { isDragging: false, draggedTrackIds: [], hoveredPlaylistId: null, hoveringNewPlaylist: false } }),

  undoStack: [],
  pushUndoEntry: (entry) => set((s) => ({ undoStack: [entry, ...s.undoStack].slice(0, 10) })),
  popUndoEntry: () => {
    const stack = get().undoStack;
    if (stack.length === 0) return null;
    set({ undoStack: stack.slice(1) });
    return stack[0];
  },

  // Trial state
  trialStartDate: initTrialStart(),
  tracksAnalyzed: parseInt(localStorage.getItem(TRACKS_ANALYZED_KEY) ?? "0", 10),
  tagsEnriched:   parseInt(localStorage.getItem(TAGS_ENRICHED_KEY)   ?? "0", 10),
  licenseKey:     localStorage.getItem(LICENSE_KEY_STORE)   ?? "",
  licenseEmail:   localStorage.getItem(LICENSE_EMAIL_STORE) ?? "",

  // Column visibility
  columnVisibility: JSON.parse(localStorage.getItem("tagwave_col_vis") ?? "{}"),
  setColumnVisibility: (v) => {
    localStorage.setItem("tagwave_col_vis", JSON.stringify(v));
    set({ columnVisibility: v });
  },

  // API keys
  lastFmApiKey: localStorage.getItem("tagwave_lastfm_key") ?? "",
  setLastFmApiKey: (key) => {
    localStorage.setItem("tagwave_lastfm_key", key);
    set({ lastFmApiKey: key });
  },
  spotifyClientId: localStorage.getItem("tagwave_spotify_id") ?? "",
  spotifyClientSecret: localStorage.getItem("tagwave_spotify_secret") ?? "",
  setSpotifyCredentials: (id, secret) => {
    localStorage.setItem("tagwave_spotify_id", id);
    localStorage.setItem("tagwave_spotify_secret", secret);
    set({ spotifyClientId: id, spotifyClientSecret: secret });
  },
  discogsToken: localStorage.getItem("tagwave_discogs_token") ?? "",
  setDiscogsToken: (token) => {
    localStorage.setItem("tagwave_discogs_token", token);
    set({ discogsToken: token });
  },
  acoustidKey: localStorage.getItem("tagwave_acoustid_key") ?? "",
  setAcoustidKey: (key) => {
    localStorage.setItem("tagwave_acoustid_key", key);
    set({ acoustidKey: key });
  },
  claudeApiKey: "",
  setClaudeApiKey: (_key) => {},
  shortcutOverrides: JSON.parse(localStorage.getItem("tagwave_shortcuts") ?? "{}"),
  setShortcutOverride: (id, key) => {
    const overrides = { ...useAppStore.getState().shortcutOverrides, [id]: key };
    localStorage.setItem("tagwave_shortcuts", JSON.stringify(overrides));
    set({ shortcutOverrides: overrides });
  },
  resetSingleShortcut: (id) => {
    const overrides = { ...useAppStore.getState().shortcutOverrides };
    delete overrides[id];
    localStorage.setItem("tagwave_shortcuts", JSON.stringify(overrides));
    set({ shortcutOverrides: overrides });
  },
  resetShortcutOverrides: () => {
    localStorage.removeItem("tagwave_shortcuts");
    set({ shortcutOverrides: {} });
  },
  theme: (localStorage.getItem("tagwave_theme") as "auto" | "light" | "dark") ?? "auto",
  setTheme: (theme) => {
    localStorage.setItem("tagwave_theme", theme);
    set({ theme });
  },
  fontScale: (localStorage.getItem("tagwave_font_scale") as "100" | "115" | "130" | "150") ?? "100",
  setFontScale: (fontScale) => {
    localStorage.setItem("tagwave_font_scale", fontScale);
    set({ fontScale });
  },
  colorMode: (localStorage.getItem("tagwave_color_mode") as "default" | "deuteranopia" | "high-contrast") ?? "default",
  setColorMode: (colorMode) => {
    localStorage.setItem("tagwave_color_mode", colorMode);
    set({ colorMode });
  },
  helpMarkersEnabled: localStorage.getItem("tagwave_help_markers") === "true",
  setHelpMarkersEnabled: (v) => {
    localStorage.setItem("tagwave_help_markers", v ? "true" : "false");
    set({ helpMarkersEnabled: v });
  },
  globalLoading: null,
  setGlobalLoading: (msg) => set({ globalLoading: msg }),
  fileSessionName: null,
  setFileSessionName: (name) => set({ fileSessionName: name }),
  djPrimary: localStorage.getItem("tagwave_dj_primary") ?? "none",
  djAutoImport: localStorage.getItem("tagwave_dj_autoimport") === "true",
  djShowAll: localStorage.getItem("tagwave_dj_showall") === "true",
  setDjPrefs: (primary, autoImport, showAll) => {
    localStorage.setItem("tagwave_dj_primary", primary);
    localStorage.setItem("tagwave_dj_autoimport", String(autoImport));
    localStorage.setItem("tagwave_dj_showall", String(showAll));
    set({ djPrimary: primary, djAutoImport: autoImport, djShowAll: showAll });
  },

  setTracks: (tracks) =>
    set({ tracks: tracks.map((t) => ({ ...t, cover_version: 0 })), selectedIds: new Set() }),

  appendTracks: (tracks) =>
    set((s) => ({ tracks: [...s.tracks, ...tracks.map((t) => ({ ...t, cover_version: 0 }))] })),

  updateTrack: (track) =>
    set((s) => ({ tracks: s.tracks.map((t) => (t.id === track.id ? track : t)) })),

  removeTracks: (ids) =>
    set((s) => ({
      tracks: s.tracks.filter((t) => !ids.includes(t.id)),
      selectedIds: new Set([...s.selectedIds].filter((id) => !ids.includes(id))),
    })),

  setScanning: (isScanning) => set({ isScanning }),

  toggleSelect: (id) => {
    const next = new Set(get().selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    set({ selectedIds: next });
  },

  selectOnly: (id) => set({ selectedIds: new Set([id]) }),

  selectAll: (ids) => set({ selectedIds: new Set(ids) }),

  replaceSelection: (ids) => set({ selectedIds: new Set(ids) }),

  clearSelection: () => set({ selectedIds: new Set() }),

  setFilterTab: (filterTab) => set({ filterTab }),

  setSearchQuery: (searchQuery) => set({ searchQuery }),

  setGenreFilter: (genreFilter) => set({ genreFilter }),

  setLastFolder: (path) => {
    if (path === null) {
      localStorage.removeItem(LAST_FOLDER_KEY);
      set({ lastFolder: null });
      return;
    }
    localStorage.setItem(LAST_FOLDER_KEY, path);
    const recents = get().recentFolders;
    // Mantém posição se já existe; adiciona ao topo apenas se for pasta nova
    const next = recents.includes(path)
      ? recents
      : [path, ...recents].slice(0, 10);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
    set({ lastFolder: path, recentFolders: next });
  },

  toggleFavorite: (path) => {
    const favs = get().favoriteFolders;
    const next = favs.includes(path) ? favs.filter((f) => f !== path) : [path, ...favs];
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(next));
    set({ favoriteFolders: next });
  },

  removeRecentFolder: (path) => {
    const next = get().recentFolders.filter((r) => r !== path);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
    set({ recentFolders: next });
  },

  toggleTrackFavorite: (path) => {
    const next = new Set(get().favoriteTrackPaths);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    localStorage.setItem(FAV_TRACKS_KEY, JSON.stringify([...next]));
    set({ favoriteTrackPaths: next });
  },

  isTrackFavorite: (path) => get().favoriteTrackPaths.has(path),

  // Trial computed
  isTrialActivated: () => get().licenseKey.length > 0,
  isTrialExpired: () => {
    const s = get();
    if (s.licenseKey.length > 0) return false;
    const ms = Date.now() - s.trialStartDate.getTime();
    return Math.floor(ms / 86_400_000) >= TRIAL_DAYS;
  },
  daysElapsed: () => {
    const ms = Date.now() - get().trialStartDate.getTime();
    return Math.max(0, Math.floor(ms / 86_400_000));
  },
  daysRemaining: () => {
    const ms = Date.now() - get().trialStartDate.getTime();
    return Math.max(0, TRIAL_DAYS - Math.floor(ms / 86_400_000));
  },
  estimatedTimeSaved: () => {
    const mins = get().tracksAnalyzed * 2;
    if (mins === 0) return "—";
    if (mins < 60) return `${mins} min`;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m === 0 ? `${h}h` : `${h}h ${m}min`;
  },
  recordScan: (count) => {
    if (count <= 0) return;
    const next = get().tracksAnalyzed + count;
    localStorage.setItem(TRACKS_ANALYZED_KEY, String(next));
    set({ tracksAnalyzed: next });
  },
  recordEnrichment: (count) => {
    if (count <= 0) return;
    const next = get().tagsEnriched + count;
    localStorage.setItem(TAGS_ENRICHED_KEY, String(next));
    set({ tagsEnriched: next });
  },
  activateLicense: (key, email = "") => {
    localStorage.setItem(LICENSE_KEY_STORE, key);
    if (email) localStorage.setItem(LICENSE_EMAIL_STORE, email);
    set({ licenseKey: key, licenseEmail: email });
  },
  extendForBeta: () => {
    const yesterday = new Date(Date.now() - 86_400_000);
    localStorage.setItem(TRIAL_START_KEY, yesterday.toISOString());
    set({ trialStartDate: yesterday });
  },

  // Privacidade
  privacyAcceptedVersion: localStorage.getItem(PRIVACY_VERSION_KEY),
  enrichmentOptIn: localStorage.getItem(ENRICHMENT_OPT_IN_KEY) !== "false",
  acceptPrivacy: () => {
    localStorage.setItem(PRIVACY_VERSION_KEY, CURRENT_PRIVACY_VERSION);
    set({ privacyAcceptedVersion: CURRENT_PRIVACY_VERSION });
  },
  setEnrichmentOptIn: (v) => {
    localStorage.setItem(ENRICHMENT_OPT_IN_KEY, String(v));
    set({ enrichmentOptIn: v });
  },

  filteredTracks: () => {
    const { tracks, filterTab, searchQuery, favoriteTrackPaths, genreFilter } = get();
    let result = tracks;
    if (genreFilter) result = result.filter((t) => t.genre === genreFilter);
    if (filterTab === "problems")
      result = result.filter((t) => t.issues.length > 0);
    else if (filterTab === "ok")
      result = result.filter((t) => t.issues.length === 0);
    else if (filterTab === "favorites")
      result = result.filter((t) => favoriteTrackPaths.has(t.path));
    else if (filterTab === "recent") {
      const cutoff = Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60;
      result = result.filter((t) => (t.modified_at ?? 0) >= cutoff);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (t) =>
          t.title?.toLowerCase().includes(q) ||
          t.artist?.toLowerCase().includes(q) ||
          t.album?.toLowerCase().includes(q) ||
          t.genre?.toLowerCase().includes(q) ||
          t.bpm?.includes(q) ||
          t.key?.toLowerCase().includes(q) ||
          t.filename.toLowerCase().includes(q)
      );
    }
    return result;
  },
}));

let _autoPlayOnLoad = false;
export function setAutoPlayOnLoad() { _autoPlayOnLoad = true; }
export function consumeAutoPlay() { const v = _autoPlayOnLoad; _autoPlayOnLoad = false; return v; }
