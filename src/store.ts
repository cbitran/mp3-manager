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
  cover_version: number;   // incrementado após salvar capa — força reload no Inspector
  issues: string[];
}

export type FilterTab = "all" | "favorites" | "problems" | "ok";

const LAST_FOLDER_KEY = "mp3mgr_lastFolder";
const FAVORITES_KEY   = "mp3mgr_favorites";
const FAV_TRACKS_KEY  = "mp3mgr_favTracks";

interface AppState {
  tracks: Track[];
  selectedIds: Set<string>;
  filterTab: FilterTab;
  searchQuery: string;
  isScanning: boolean;
  lastFolder: string | null;
  favoriteFolders: string[];
  favoriteTrackPaths: Set<string>;

  setTracks: (tracks: Track[]) => void;
  updateTrack: (track: Track) => void;
  setScanning: (v: boolean) => void;
  toggleSelect: (id: string) => void;
  selectOnly: (id: string) => void;
  clearSelection: () => void;
  setFilterTab: (tab: FilterTab) => void;
  setSearchQuery: (q: string) => void;
  setLastFolder: (path: string) => void;
  toggleFavorite: (path: string) => void;
  toggleTrackFavorite: (path: string) => void;
  isTrackFavorite: (path: string) => boolean;

  filteredTracks: () => Track[];
}

export const useAppStore = create<AppState>((set, get) => ({
  tracks: [],
  selectedIds: new Set(),
  filterTab: "all",
  searchQuery: "",
  isScanning: false,
  lastFolder: localStorage.getItem(LAST_FOLDER_KEY),
  favoriteFolders: JSON.parse(localStorage.getItem(FAVORITES_KEY) ?? "[]"),
  favoriteTrackPaths: new Set(JSON.parse(localStorage.getItem(FAV_TRACKS_KEY) ?? "[]")),

  setTracks: (tracks) =>
    set({ tracks: tracks.map((t) => ({ ...t, cover_version: 0 })), selectedIds: new Set() }),

  updateTrack: (track) =>
    set((s) => ({ tracks: s.tracks.map((t) => (t.id === track.id ? track : t)) })),

  setScanning: (isScanning) => set({ isScanning }),

  toggleSelect: (id) => {
    const next = new Set(get().selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    set({ selectedIds: next });
  },

  selectOnly: (id) => set({ selectedIds: new Set([id]) }),

  clearSelection: () => set({ selectedIds: new Set() }),

  setFilterTab: (filterTab) => set({ filterTab }),

  setSearchQuery: (searchQuery) => set({ searchQuery }),

  setLastFolder: (path) => {
    localStorage.setItem(LAST_FOLDER_KEY, path);
    set({ lastFolder: path });
  },

  toggleFavorite: (path) => {
    const favs = get().favoriteFolders;
    const next = favs.includes(path) ? favs.filter((f) => f !== path) : [path, ...favs];
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(next));
    set({ favoriteFolders: next });
  },

  toggleTrackFavorite: (path) => {
    const next = new Set(get().favoriteTrackPaths);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    localStorage.setItem(FAV_TRACKS_KEY, JSON.stringify([...next]));
    set({ favoriteTrackPaths: next });
  },

  isTrackFavorite: (path) => get().favoriteTrackPaths.has(path),

  filteredTracks: () => {
    const { tracks, filterTab, searchQuery, favoriteTrackPaths } = get();
    let result = tracks;
    if (filterTab === "problems")
      result = result.filter((t) => t.issues.length > 0);
    else if (filterTab === "ok")
      result = result.filter((t) => t.issues.length === 0);
    else if (filterTab === "favorites")
      result = result.filter((t) => favoriteTrackPaths.has(t.path));
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
