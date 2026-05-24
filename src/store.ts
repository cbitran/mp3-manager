import { create } from "zustand";

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
}

export type FilterTab = "all" | "favorites" | "problems" | "ok" | "recent";

const LAST_FOLDER_KEY    = "mp3mgr_lastFolder";
const FAVORITES_KEY      = "mp3mgr_favorites";
const FAV_TRACKS_KEY     = "mp3mgr_favTracks";
const RECENT_KEY         = "mp3mgr_recentFolders";

const TRIAL_DAYS         = 14;
const TRIAL_START_KEY    = "tagwave_trialStartDate";
const TRACKS_ANALYZED_KEY= "tagwave_tracksAnalyzed";
const TAGS_ENRICHED_KEY  = "tagwave_tagsEnriched";
const LICENSE_KEY_STORE  = "tagwave_licenseKey";

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

  // Trial
  trialStartDate: Date;
  tracksAnalyzed: number;
  tagsEnriched: number;
  licenseKey: string;

  setTracks: (tracks: Track[]) => void;
  updateTrack: (track: Track) => void;
  removeTracks: (ids: string[]) => void;
  setScanning: (v: boolean) => void;
  toggleSelect: (id: string) => void;
  selectOnly: (id: string) => void;
  selectAll: (ids: string[]) => void;
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
  theme: "auto" | "light" | "dark";
  setTheme: (theme: "auto" | "light" | "dark") => void;
  djPrimary: string;
  djAutoImport: boolean;
  djShowAll: boolean;
  setDjPrefs: (primary: string, autoImport: boolean, showAll: boolean) => void;

  // Player
  playerTrackId: string | null;
  setPlayerTrack: (id: string | null) => void;
  isPlayingGlobal: boolean;
  setIsPlayingGlobal: (playing: boolean) => void;

  isTrialActivated: () => boolean;
  isTrialExpired: () => boolean;
  daysElapsed: () => number;
  daysRemaining: () => number;
  estimatedTimeSaved: () => string;
  recordScan: (count: number) => void;
  recordEnrichment: (count: number) => void;
  activateLicense: (key: string) => void;
  extendForBeta: () => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  tracks: [],
  selectedIds: new Set(),
  playerTrackId: null,
  setPlayerTrack: (id) => set({ playerTrackId: id }),
  isPlayingGlobal: false,
  setIsPlayingGlobal: (isPlayingGlobal) => set({ isPlayingGlobal }),
  filterTab: "all",
  genreFilter: null,
  searchQuery: "",
  isScanning: false,
  lastFolder: localStorage.getItem(LAST_FOLDER_KEY),
  favoriteFolders: JSON.parse(localStorage.getItem(FAVORITES_KEY) ?? "[]"),
  recentFolders: JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]"),
  favoriteTrackPaths: new Set(JSON.parse(localStorage.getItem(FAV_TRACKS_KEY) ?? "[]")),

  // Trial state
  trialStartDate: initTrialStart(),
  tracksAnalyzed: parseInt(localStorage.getItem(TRACKS_ANALYZED_KEY) ?? "0", 10),
  tagsEnriched:   parseInt(localStorage.getItem(TAGS_ENRICHED_KEY)   ?? "0", 10),
  licenseKey:     localStorage.getItem(LICENSE_KEY_STORE) ?? "",

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
  theme: (localStorage.getItem("tagwave_theme") as "auto" | "light" | "dark") ?? "auto",
  setTheme: (theme) => {
    localStorage.setItem("tagwave_theme", theme);
    set({ theme });
  },
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
  activateLicense: (key) => {
    localStorage.setItem(LICENSE_KEY_STORE, key);
    set({ licenseKey: key });
  },
  extendForBeta: () => {
    const yesterday = new Date(Date.now() - 86_400_000);
    localStorage.setItem(TRIAL_START_KEY, yesterday.toISOString());
    set({ trialStartDate: yesterday });
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
