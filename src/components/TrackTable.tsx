import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  createColumnHelper,
  type SortingState,
  type VisibilityState,
  type ColumnSizingState,
  type ColumnOrderState,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";

import { useState, useCallback, useMemo, useEffect, useLayoutEffect, useRef, memo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import i18n from "../i18n";
import { useShallow } from "zustand/react/shallow";
import { useAppStore, type Track } from "../store";


// ── Mini waveform ─────────────────────────────────────────────────────────────
const MINI_BARS   = 80;
const MINI_BAR_W  = 1;
const MINI_STEP   = 1.4;   // gap = 0.4px
const MINI_VB_W   = MINI_BARS * MINI_STEP;
const MINI_VB_H   = 13;

interface WaveBarMini { amp: number; bass: number; treble: number; }
const miniWaveCache = new Map<string, WaveBarMini[]>();


const WaveformCell = memo(function WaveformCell({ path, trackId }: { path: string; trackId: string }) {
  const [bars, setBars] = useState<WaveBarMini[] | null>(miniWaveCache.get(path) ?? null);
  const playerProgress = useAppStore((s) => s.playerProgress);
  const playerDuration = useAppStore((s) => s.playerDuration);
  const playerTrackId  = useAppStore((s) => s.playerTrackId);
  const isCurrentTrack = trackId === playerTrackId;

  useEffect(() => {
    if (miniWaveCache.has(path)) { setBars(miniWaveCache.get(path)!); return; }
    let cancelled = false;
    queuedInvoke<number[]>(() => invoke("generate_waveform_rgb", { path, bars: MINI_BARS }))
      .then((flat) => {
        if (cancelled || !flat || flat.length !== MINI_BARS * 3) return;
        const parsed: WaveBarMini[] = Array.from({ length: MINI_BARS }, (_, i) => ({
          amp:    flat[i * 3],
          bass:   flat[i * 3 + 1],
          treble: flat[i * 3 + 2],
        }));
        miniWaveCache.set(path, parsed);
        setBars(parsed);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [path]);

  const pct = isCurrentTrack && playerDuration > 0 ? playerProgress / playerDuration : 0;

  return (
    <div className="w-full flex items-center justify-center" style={{ pointerEvents: "none" }}>
      {bars ? (
        <svg width="100%" height="15" viewBox={`0 0 ${MINI_VB_W} ${MINI_VB_H}`} preserveAspectRatio="none" className="overflow-visible">
          {bars.map((bar, i) => {
            const barH   = Math.max(0.8, bar.amp * (MINI_VB_H - 2));
            const y      = (MINI_VB_H - barH) / 2;
            const barPct = i / MINI_BARS;
            const played = isCurrentTrack && pct > 0 && barPct < pct;
            return (
              <rect
                key={i}
                x={i * MINI_STEP}
                y={y}
                width={MINI_BAR_W}
                height={barH}
                rx={0.3}
                fill={played ? "#D95340" : "#A8A3A0"}
                opacity={played ? 1 : isCurrentTrack ? 0.45 + bar.amp * 0.45 : 0.28 + bar.amp * 0.45}
              />
            );
          })}
          {/* Playhead */}
          {isCurrentTrack && pct > 0 && (
            <rect x={pct * MINI_VB_W - 0.5} y={0} width={1} height={MINI_VB_H} fill="rgba(255,255,255,0.85)" rx={0.5} />
          )}
        </svg>
      ) : (
        <svg width="100%" height="15" viewBox={`0 0 ${MINI_VB_W} ${MINI_VB_H}`} preserveAspectRatio="none">
          {Array.from({ length: MINI_BARS }, (_, i) => {
            const amp = 0.15 + 0.12 * Math.abs(Math.sin(i * 0.7));
            const barH = Math.max(0.8, amp * (MINI_VB_H - 2));
            return (
              <rect key={i} x={i * MINI_STEP} y={(MINI_VB_H - barH) / 2} width={MINI_BAR_W} height={barH}
                fill="#A8A3A0" opacity={0.15} rx={0.3} />
            );
          })}
        </svg>
      )}
    </div>
  );
});
import { openPath } from "@tauri-apps/plugin-opener";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import CreatePlaylistModal from "./CreatePlaylistModal";
import { queuedInvoke } from "../lib/ipcQueue";
import { toast } from "./Toast";
import { applyPlaylistRules } from "../lib/playlistRules";

const col = createColumnHelper<Track>();

// -- Camelot Wheel -----------------------------------------------------------

const CAMELOT_MAP: Record<string, [number, boolean]> = {
  "Abm": [1, true],  "G#m": [1, true],  "B":   [1, false],
  "Ebm": [2, true],  "D#m": [2, true],  "Gb":  [2, false], "F#": [2, false],
  "Bbm": [3, true],  "A#m": [3, true],  "Db":  [3, false], "C#": [3, false],
  "Fm":  [4, true],                     "Ab":  [4, false], "G#": [4, false],
  "Cm":  [5, true],                     "Eb":  [5, false], "D#": [5, false],
  "Gm":  [6, true],                     "Bb":  [6, false], "A#": [6, false],
  "Dm":  [7, true],                     "F":   [7, false],
  "Am":  [8, true],                     "C":   [8, false],
  "Em":  [9, true],                     "G":   [9, false],
  "Bm":  [10, true],                    "D":   [10, false],
  "F#m": [11, true], "Gbm": [11, true], "A":   [11, false],
  "Dbm": [12, true], "C#m": [12, true], "E":   [12, false],
};

function camelotHue(position: number, isMinor: boolean): string {
  const hue = ((position - 1) % 12) * 30;
  const sat = isMinor ? 72 : 65;
  const bri = isMinor ? 38 : 44;
  return `hsl(${hue}, ${sat}%, ${bri}%)`;
}

function camelotColor(key: string): string {
  const k = key.trim();
  const m = k.match(/^(\d{1,2})([ABab])$/);
  if (m) return camelotHue(parseInt(m[1]), m[2].toLowerCase() === "a");
  if (CAMELOT_MAP[k]) return camelotHue(...CAMELOT_MAP[k]);
  const noM = k.endsWith("m") ? k.slice(0, -1) : k;
  if (CAMELOT_MAP[noM + "m"]) return camelotHue(...CAMELOT_MAP[noM + "m"]);
  return "hsl(0,0%,25%)";
}

function formatBPM(bpm: string): string {
  const n = parseFloat(bpm);
  return isNaN(n) ? "—" : n.toFixed(2);
}

// ── Inline-edit request bus ──────────────────────────────────────────────────
// Permite que o context menu dispare edição sem prop drilling
const inlineEditBus = new Map<string, (field: "title" | "artist") => void>();
export function requestInlineEdit(trackId: string, field: "title" | "artist") {
  inlineEditBus.get(trackId)?.(field);
}

// ── TitleArtistCell ───────────────────────────────────────────────────────────
const IS_WIN_TABLE = navigator.platform.toLowerCase().startsWith("win") ||
  navigator.userAgent.toLowerCase().includes("windows");

const TitleArtistCell = memo(function TitleArtistCell({ track }: { track: Track }) {
  const { title, filename, issues } = track;
  const hasIssues = issues.length > 0;
  const updateTrack = useAppStore((s) => s.updateTrack);

  const [editing, setEditing] = useState<"title" | "artist" | null>(null);
  const [editValue, setEditValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inlineEditBus.set(track.id, (field) => {
      setEditing(field);
      setEditValue(field === "title" ? (track.title ?? track.filename) : (track.artist ?? ""));
    });
    return () => { inlineEditBus.delete(track.id); };
  }, [track]);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  async function commitEdit() {
    if (!editing) return;
    const trimmed = editValue.trim();
    setEditing(null);
    if (!trimmed) return;
    try {
      await invoke("save_tags", {
        path: track.path,
        title: editing === "title" ? trimmed : (track.title ?? null),
        artist: editing === "artist" ? trimmed : (track.artist ?? null),
        album: track.album ?? null, genre: track.genre ?? null,
        year: track.year ?? null, trackNumber: track.track_number ?? null,
        totalTracks: track.total_tracks ?? null,
        bpm: track.bpm ?? null, key: track.key ?? null,
        rating: (track.rating ?? 0) > 0 ? (track.rating ?? null) : null,
        comment: track.comment ?? null,
      });
      updateTrack({ ...track, [editing]: trimmed });
    } catch (err) { console.error("[inline-edit]", err); }
  }

  return (
    <div className="min-w-0 w-full flex items-start gap-2">
      <div className="min-w-0 flex-1">
        {editing === "title" ? (
          <input
            ref={inputRef}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); commitEdit(); }
              if (e.key === "Escape") setEditing(null);
              e.stopPropagation();
            }}
            onBlur={commitEdit}
            onClick={(e) => e.stopPropagation()}
            className="w-full bg-[#1c1715] border border-[#D95340]/50 rounded px-1.5 py-px text-[13px] text-[#F5F5F4] focus:outline-none focus:border-[#D95340]"
          />
        ) : (
          <span
            className={`leading-snug [overflow-wrap:anywhere] ${
              title ? "text-[13px] font-medium text-[#F5F5F4]" : "text-xs italic text-[#756D67]"
            }`}
            onDoubleClick={(e) => {
              if (IS_WIN_TABLE || !e.metaKey) return; // Windows: dbl toca; macOS: só Cmd+dbl edita
              e.stopPropagation();
              setEditing("title");
              setEditValue(title ?? filename);
            }}
            title={IS_WIN_TABLE ? i18n.t("table.dblClickEdit") : i18n.t("table.cmdDblClickEdit")}
          >
            {title ?? filename}
          </span>
        )}
      </div>
      {(!title || hasIssues) && (
        <div className="flex flex-col items-end gap-px shrink-0 mt-px">
          {!title && (
            <span
              title={i18n.t("table.noTitleTooltip")}
              className="px-1 py-px rounded text-[8px] font-semibold uppercase tracking-wider leading-tight cursor-default select-none"
              style={{ background: "rgba(255,255,255,0.07)", color: "#756D67", border: "1px solid rgba(255,255,255,0.10)" }}
            >
              {i18n.t("table.badgeArchive")}
            </span>
          )}
          {hasIssues && (
            <span className="px-1.5 py-px rounded-sm text-[9px] font-bold uppercase tracking-widest bg-[#D95340]/20 text-[#D95340] leading-tight">
              {i18n.t("table.badgeEnrich")}
            </span>
          )}
        </div>
      )}
    </div>
  );
});

// ── Artist edit cell ─────────────────────────────────────────────────────────

const ArtistEditCell = memo(function ArtistEditCell({ track }: { track: Track }) {
  const updateTrack = useAppStore((s) => s.updateTrack);
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (editing) inputRef.current?.select(); }, [editing]);

  function open(e: React.MouseEvent) {
    if (IS_WIN_TABLE) return; // Windows: dbl toca; edição via context menu
    e.stopPropagation();
    setVal(track.artist ?? "");
    setEditing(true);
  }

  async function commit() {
    const trimmed = val.trim();
    setEditing(false);
    if (trimmed === (track.artist ?? "")) return;
    const fresh = useAppStore.getState().tracks.find((t) => t.id === track.id) ?? track;
    try {
      await invoke("save_tags", {
        path: fresh.path,
        title: fresh.title ?? null, artist: trimmed || null,
        album: fresh.album ?? null, genre: fresh.genre ?? null,
        year: fresh.year ?? null, trackNumber: fresh.track_number ?? null,
        totalTracks: fresh.total_tracks ?? null,
        bpm: fresh.bpm ?? null, key: fresh.key ?? null,
        rating: fresh.rating ?? null, comment: fresh.comment ?? null,
      });
      updateTrack({ ...fresh, artist: trimmed || undefined });
    } catch { /* ignore */ }
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEditing(false); }}
        onClick={(e) => e.stopPropagation()}
        className="w-full bg-[#1c1715] text-[#F5F5F4] text-[11px] px-1 py-0.5 rounded border border-[#D95340]/50 outline-none"
      />
    );
  }

  return (
    <span
      className="text-[11px] text-[#8F8883] truncate cursor-text select-none"
      onDoubleClick={open}
      title="Duplo clique para editar"
    >
      {track.artist ?? <span className="text-[#605A55] not-italic">—</span>}
    </span>
  );
});

// ── Rating cell ──────────────────────────────────────────────────────────────

const RatingCell = memo(function RatingCell({ track }: { track: Track }) {
  const [hover, setHover] = useState<number>(0);
  const updateTrack = useAppStore((s) => s.updateTrack);
  const current = track.rating ?? 0;

  const setRating = async (value: number) => {
    const next = current === value ? 0 : value; // click same star = reset
    try {
      await invoke("save_tags", {
        path: track.path,
        title: track.title ?? null, artist: track.artist ?? null,
        album: track.album ?? null, genre: track.genre ?? null,
        year: track.year ?? null, trackNumber: track.track_number ?? null,
        totalTracks: track.total_tracks ?? null,
        bpm: track.bpm ?? null, key: track.key ?? null,
        rating: next > 0 ? next : null,
        comment: track.comment ?? null,
      });
      updateTrack({ ...track, rating: next > 0 ? next : undefined });
    } catch (err) { console.error("[rating] save_tags error:", err); }
  };

  const displayed = hover > 0 ? hover : current;

  return (
    <div
      className="flex gap-px justify-center cursor-pointer"
      onMouseLeave={() => setHover(0)}
      title={current > 0 ? i18n.t("table.ratingSet", { rating: current }) : i18n.t("table.ratingHint")}
    >
      {Array.from({ length: 5 }, (_, idx) => {
        const filled = idx < displayed;
        return (
          <svg
            key={idx}
            width="9" height="9" viewBox="0 0 12 12"
            fill={filled ? "currentColor" : "none"}
            stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"
            className={`transition-colors ${filled ? "text-[#D95340]" : hover > 0 ? "text-[#D95340]/30" : "text-[#3D3733]"}`}
            onMouseEnter={() => setHover(idx + 1)}
            onClick={(e) => { e.stopPropagation(); setRating(idx + 1); }}
          >
            <polygon points="6,1.2 7.5,4.5 11,4.9 8.5,7.3 9.2,10.8 6,9 2.8,10.8 3.5,7.3 1,4.9 4.5,4.5"/>
          </svg>
        );
      })}
    </div>
  );
});

// ---------------------------------------------------------------------------

import { coverCache, setCoverCache } from "../lib/coverCache";

const CoverCell = memo(function CoverCell({ path, hasCover, coverVersion }: { path: string; hasCover: boolean; coverVersion?: number }) {
  const cacheKey = `${path}::${coverVersion ?? 0}`;
  const [src, setSrc] = useState<string | null>(coverCache.get(cacheKey) ?? null);

  useEffect(() => {
    if (!hasCover) { setSrc(null); return; }
    const cached = coverCache.get(cacheKey);
    if (cached) { setSrc(cached); return; }
    let cancelled = false;
    queuedInvoke<string | null>(() => invoke("read_cover_base64", { path }))
      .then((b64) => {
        if (cancelled) return;
        if (b64) {
          const dataUrl = `data:image/jpeg;base64,${b64}`;
          setCoverCache(cacheKey, dataUrl);
          setSrc(dataUrl);
        } else {
          setSrc(null);
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [path, hasCover, cacheKey]);

  if (!src) return (
    <div className="w-7 h-7 rounded-sm bg-white/[0.04] border border-white/[0.05] flex items-center justify-center mx-auto">
      <svg width="9" height="9" viewBox="0 0 11 11" fill="currentColor" className="text-[#373331]"><path d="M1 2.5A1.5 1.5 0 012.5 1h6A1.5 1.5 0 0110 2.5v6A1.5 1.5 0 018.5 10h-6A1.5 1.5 0 011 8.5v-6zM4 4a1 1 0 100-2 1 1 0 000 2zm-2 4l2-2 1 1 2-3 2 4H2z"/></svg>
    </div>
  );
  return <img src={src} alt="" className="w-7 h-7 rounded-sm object-cover mx-auto block" />;
});

const LEFT_COLS = new Set(["title_artist", "album", "artist", "comment"]);

export default function TrackTable({
  tracks,
  compact = false,
  hasFolder = false,
  onVideoPlay,
  enrichingIds,
  enrichDoneIds,
  onOpenFolder,
  onEnrich,
  resetColToken,
  onTrackDragStart,
}: {
  tracks: Track[];
  compact?: boolean;
  hasFolder?: boolean;
  onVideoPlay?: (track: Track) => void;
  enrichingIds?: Set<string>;
  enrichDoneIds?: Set<string>;
  onOpenFolder?: () => void;
  onEnrich?: (trackId?: string) => void;
  resetColToken?: number;
  onTrackDragStart?: (trackIds: string[], startX: number, startY: number) => void;
}) {
  // Dados estáveis (funções + raramente alterados) — shallow evita re-render quando refs não mudam
  const {
    toggleSelect,
    selectAll,
    replaceSelection,
    clearSelection,
    tracks: allTracks,
    toggleTrackFavorite,
    favoriteTrackPaths,
    requestPlay,
    columnVisibility,
    setColumnVisibility,
    removeTracks,
    playlists,
    addTracksToPlaylist,
    activePlaylistId,
    removeTrackFromPlaylist,
  } = useAppStore(useShallow((s) => ({
    toggleSelect: s.toggleSelect,
    selectAll: s.selectAll,
    replaceSelection: s.replaceSelection,
    clearSelection: s.clearSelection,
    tracks: s.tracks,
    toggleTrackFavorite: s.toggleTrackFavorite,
    favoriteTrackPaths: s.favoriteTrackPaths,
    requestPlay: s.requestPlay,
    columnVisibility: s.columnVisibility,
    setColumnVisibility: s.setColumnVisibility,
    removeTracks: s.removeTracks,
    playlists: s.playlists,
    addTracksToPlaylist: s.addTracksToPlaylist,
    activePlaylistId: s.activePlaylistId,
    removeTrackFromPlaylist: s.removeTrackFromPlaylist,
  })));

  // Subscriptions granulares para dados que mudam frequentemente
  const selectedIds = useAppStore((s) => s.selectedIds);
  const playerTrackId = useAppStore((s) => s.playerTrackId);

  const { t } = useTranslation();
  const [analyzingBpmId, setAnalyzingBpmId] = useState<string | null>(null);


  const anchorIdRef = useRef<string | null>(null);
  const sortedRowsRef = useRef<Array<{id: string}>>([]);
  const selectedIdsRef = useRef(selectedIds);
  selectedIdsRef.current = selectedIds;

  const [sorting, setSorting] = useState<SortingState>(() => {
    try {
      const saved = localStorage.getItem("tagwave_sort");
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });

  const COL_MIN_SIZES: Record<string, number> = {
    title_artist: 200, album: 140, genre: 90, artist: 100,
    year_col: 52, status: 36, file_size: 52, key: 56, bpm: 64,
    rating: 56, duration_secs: 60, bitrate: 56, tipo: 50,
    adicionada: 80, comment: 100, favorite: 28, select: 32, capa: 52,
  };

  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("tagwave_col_sizes") ?? "{}") as ColumnSizingState;
      // Reseta tamanhos abaixo do mínimo permitido
      const validated: ColumnSizingState = {};
      let changed = false;
      for (const [id, size] of Object.entries(saved)) {
        const min = COL_MIN_SIZES[id] ?? 40;
        if (size >= min) { validated[id] = size; }
        else { changed = true; }
      }
      if (changed) localStorage.setItem("tagwave_col_sizes", JSON.stringify(validated));
      return validated;
    } catch { return {}; }
  });

  const [columnOrder, setColumnOrder] = useState<ColumnOrderState>(() => {
    try {
      const saved = localStorage.getItem("tagwave_col_order");
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });

  useEffect(() => {
    if (!resetColToken) return;
    localStorage.removeItem("tagwave_col_sizes");
    localStorage.removeItem("tagwave_col_order");
    setColumnSizing({});
    setColumnOrder([]);
  }, [resetColToken]);

  const lastClickRef = useRef<{ id: string; time: number }>({ id: "", time: 0 });
  const dragColIdRef = useRef<string | null>(null);
  const [dragOverColId, setDragOverColId] = useState<string | null>(null);
  const [draggingColId, setDraggingColId] = useState<string | null>(null);
  const [dragGhost, setDragGhost] = useState<{ x: number; y: number; label: string } | null>(null);
  const [colCtxMenu, setColCtxMenu] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!colCtxMenu) return;
    const close = () => setColCtxMenu(null);
    document.addEventListener("mousedown", close, { once: true });
    return () => document.removeEventListener("mousedown", close);
  }, [colCtxMenu]);

  const DEFAULT_VISIBILITY: VisibilityState = {
    num: true,
    favorite: true,
    tipo: false,
    adicionada: false,
    comment: false,
    onda: true,
  };

  const mergedVisibility: VisibilityState = { ...DEFAULT_VISIBILITY, ...columnVisibility };

  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; track: Track } | null>(null);
  const contextRef = useRef<HTMLDivElement>(null);
  const [playlistTracks, setPlaylistTracks] = useState<Track[] | null>(null);
  const [removeDialog, setRemoveDialog] = useState<{ targets: Track[] } | null>(null);

  const compatIds = useMemo(() => {
    if (selectedIds.size !== 1) return { bpm: new Set<string>(), key: new Set<string>() };
    const selId = [...selectedIds][0];
    const sel = allTracks.find((t) => t.id === selId);

    // BPM compatibility
    const bpmSet = new Set<string>();
    if (sel?.bpm) {
      const b = parseFloat(sel.bpm);
      if (!isNaN(b) && b > 0) {
        const lo = b * 0.94, hi = b * 1.06;
        const hLo = b * 0.47, hHi = b * 0.53;
        const dLo = b * 1.94, dHi = b * 2.06;
        allTracks
          .filter((t) => t.id !== selId && t.bpm)
          .forEach((t) => {
            const v = parseFloat(t.bpm!);
            if ((v >= lo && v <= hi) || (v >= hLo && v <= hHi) || (v >= dLo && v <= dHi))
              bpmSet.add(t.id);
          });
      }
    }

    // Key (Camelot Wheel) compatibility: same, ±1 position, A↔B swap, +7
    const keySet = new Set<string>();
    if (sel?.key) {
      const selEntry = CAMELOT_MAP[sel.key.trim()];
      if (selEntry) {
        const [pos, minor] = selEntry;
        const compatPositions = new Set([
          pos,
          ((pos - 2 + 12) % 12) + 1,
          (pos % 12) + 1,
          ((pos + 5) % 12) + 1,  // +7 semitones (energy boost)
        ]);
        allTracks
          .filter((t) => t.id !== selId && t.key)
          .forEach((t) => {
            const entry = CAMELOT_MAP[t.key!.trim()];
            if (!entry) return;
            const [p, m] = entry;
            if (compatPositions.has(p) && m === minor) keySet.add(t.id);
            if (p === pos && m !== minor) keySet.add(t.id); // A↔B same position
          });
      }
    }

    return { bpm: bpmSet, key: keySet };
  }, [selectedIds, allTracks]);

  const bpmCompatIds = compatIds.bpm;
  const keyCompatIds = compatIds.key;

  const columns = useMemo(
    () => [
      // ★ Favorito
      col.display({
        id: "favorite",
        header: () => (
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" className="text-[#8F8883] mx-auto">
            <polygon points="6,1.2 7.5,4.5 11,4.9 8.5,7.3 9.2,10.8 6,9 2.8,10.8 3.5,7.3 1,4.9 4.5,4.5"/>
          </svg>
        ),
        cell: ({ row }) => (
          <button
            onClick={(e) => { e.stopPropagation(); toggleTrackFavorite(row.original.path); }}
            className={`leading-none transition-colors ${
              favoriteTrackPaths.has(row.original.path)
                ? "text-[#D95340]"
                : "text-[#9E9893] hover:text-[#C2BEBC]"
            }`}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill={favoriteTrackPaths.has(row.original.path) ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round">
              <polygon points="6,1.2 7.5,4.5 11,4.9 8.5,7.3 9.2,10.8 6,9 2.8,10.8 3.5,7.3 1,4.9 4.5,4.5"/>
            </svg>
          </button>
        ),
        size: 28,
      }),

      // Checkbox
      col.display({
        id: "select",
        enableHiding: false,
        header: ({ table }) => (
          <input
            type="checkbox"
            checked={selectedIdsRef.current.size > 0 && selectedIdsRef.current.size === table.getRowCount()}
            onChange={(e) => {
              if (e.target.checked) selectAll(table.getRowModel().rows.map((r) => r.id));
              else clearSelection();
            }}
          />
        ),
        cell: ({ row }) => (
          <input
            type="checkbox"
            checked={selectedIdsRef.current.has(row.id)}
            onChange={() => useAppStore.getState().toggleSelect(row.id)}
            onClick={(e) => e.stopPropagation()}
          />
        ),
        size: 32,
      }),

      // ONDA (mini waveform sincronizado com player)
      col.display({
        id: "onda",
        header: () => <span className="text-[9px] font-bold uppercase tracking-widest text-[#4C4743]">Onda</span>,
        cell: ({ row }) => (
          <WaveformCell
            path={row.original.path}
            trackId={row.original.id}
          />
        ),
        size: 90, minSize: 70,
      }),

      // CAPA
      col.accessor("has_cover", {
        id: "capa",
        enableSorting: true,
        sortingFn: (rowA, rowB) => {
          const a = rowA.original.has_cover ? 1 : 0;
          const b = rowB.original.has_cover ? 1 : 0;
          return a - b;
        },
        header: ({ column }) => {
          const sorted = column.getIsSorted();
          return (
            <button
              onClick={() => {
                if (!sorted)               column.toggleSorting(false); // asc = sem capa primeiro
                else if (sorted === "asc") column.toggleSorting(true);  // desc = com capa primeiro
                else                       column.clearSorting();
              }}
              className="w-full flex items-center justify-center gap-1.5"
              title={
                sorted === "asc"  ? i18n.t("table.sortCoverFirst")
                : sorted === "desc" ? i18n.t("table.sortCoverAsc")
                : i18n.t("table.sortCoverNone")
              }
            >
              <span className="text-[9px] font-bold uppercase tracking-widest transition-colors duration-200"
                style={{ color: sorted ? "var(--c-t2)" : "var(--c-t4)" }}>
                {i18n.t("settings.columns.colCover")}
              </span>
              {sorted && (
                <span
                  className="w-1.5 h-1.5 rounded-full shrink-0"
                  style={{ backgroundColor: sorted === "desc" ? "#5BA055" : "#D95340" }}
                />
              )}
            </button>
          );
        },
        cell: ({ row }) => <CoverCell path={row.original.path} hasCover={row.original.has_cover} coverVersion={row.original.cover_version} />,
        size: 60, minSize: 52,
      }),

      // TÍTULO / ARTISTA — edição inline disponível (duplo clique ou menu de contexto)
      col.accessor("title", {
        id: "title_artist",
        enableHiding: false,
        header: "TÍTULO",
        cell: ({ row }) => <TitleArtistCell track={row.original} />,
        size: 280, minSize: 200,
      }),

      // ÁLBUM
      col.accessor("album", {
        header: "Álbum",
        cell: (i) =>
          i.getValue() ? (
            <span className="text-[11px] text-[#8F8883] truncate">{i.getValue()}</span>
          ) : (
            <span className="text-[#605A55] text-xs">—</span>
          ),
        size: 160,
        minSize: 140,
      }),

      // GÊNERO
      col.accessor("genre", {
        header: i18n.t("settings.columns.colGenre"),
        cell: (i) =>
          i.getValue() ? (
            <span className="inline-block px-1.5 py-px rounded-sm text-[10px] uppercase tracking-wide bg-white/[0.06] text-[#a09890] whitespace-nowrap truncate max-w-full">
              {i.getValue()}
            </span>
          ) : (
            <span className="text-[#605A55] text-xs">—</span>
          ),
        size: 110, minSize: 90,
      }),

      // ARTISTA standalone
      col.accessor("artist", {
        id: "artist",
        header: "Artista",
        cell: ({ row }) => <ArtistEditCell track={row.original} />,
        size: 140, minSize: 100,
      }),

      // ANO
      col.accessor("year", {
        id: "year_col",
        header: "Ano",
        cell: (i) =>
          i.getValue() ? (
            <span className="text-[11px] font-mono text-[#8F8883] tabular-nums">{i.getValue()}</span>
          ) : (
            <span className="text-[#605A55] text-xs">—</span>
          ),
        size: 60, minSize: 52,
      }),

      // STATUS ●
      col.accessor("issues", {
        id: "status",
        enableSorting: true,
        sortingFn: (rowA, rowB) => rowA.original.issues.length - rowB.original.issues.length,
        header: ({ column }) => {
          const sorted = column.getIsSorted();
          return (
            <button
              onClick={() => {
                if (!sorted)          column.toggleSorting(true);  // desc = problemáticas primeiro
                else if (sorted === "desc") column.toggleSorting(false); // asc = OK primeiro
                else                  column.clearSorting();
              }}
              className="w-full flex items-center justify-center"
              title={
                sorted === "desc" ? i18n.t("table.sortStatusFirst")
                : sorted === "asc"  ? i18n.t("table.sortStatusAsc")
                : i18n.t("table.sortStatusNone")
              }
            >
              <span
                className="w-2.5 h-2.5 rounded-full inline-block transition-all duration-200"
                style={{
                  backgroundColor: sorted === "asc" ? "#5BA055" : "#D95340",
                  opacity: sorted ? 1 : 0.45,
                  boxShadow: sorted ? `0 0 5px ${sorted === "asc" ? "#5BA05566" : "#D9534066"}` : "none",
                }}
              />
            </button>
          );
        },
        cell: (i) => {
          const n = i.getValue().length;
          const color = n === 0 ? "#5BA055" : n > 2 ? "#D95340" : "#E07364";
          return (
            <span
              className="w-2 h-2 rounded-full inline-block"
              style={{ backgroundColor: color }}
              title={n === 0 ? "OK" : i.getValue().join(", ")}
            />
          );
        },
        size: 40, minSize: 36,
      }),

      // TAMANHO (MB)
      col.accessor("file_size_bytes", {
        id: "file_size",
        header: "MB",
        cell: (i) => {
          const mb = i.getValue() / (1024 * 1024);
          return (
            <span className="text-[11px] font-mono tabular-nums text-[#8F8883]">
              {mb.toFixed(1)}
            </span>
          );
        },
        size: 64, minSize: 52,
      }),

      // TOM (Camelot)
      col.accessor("key", {
        header: "Tom",
        cell: ({ getValue, row }) => {
          const val = getValue();
          if (!val) return <span className="text-[#605A55] text-xs">—</span>;
          const compat = keyCompatIds.has(row.id);
          return (
            <span
              className={`inline-block px-2 py-0.5 rounded-sm text-[11px] font-mono font-bold text-white ${
                compat ? "ring-1 ring-[#5BA055]/50" : ""
              }`}
              style={{ backgroundColor: camelotColor(val) }}
            >
              {val}
            </span>
          );
        },
        size: 68, minSize: 56,
      }),

      // BPM
      col.accessor("bpm", {
        header: "BPM",
        cell: ({ getValue, row }) => {
          const val = getValue();
          const compat = bpmCompatIds.has(row.id);
          if (!val) return <span className="text-[#605A55] text-xs">—</span>;
          return (
            <span
              className={`text-[12px] font-mono tabular-nums font-semibold flex items-center justify-center gap-1 ${
                compat ? "text-[#5BA055]" : "text-[#C97B40]"
              }`}
            >
              {compat && (
                <span className="w-1 h-1 rounded-full bg-[#5BA055] inline-block shrink-0" />
              )}
              {formatBPM(val)}
            </span>
          );
        },
        size: 80, minSize: 64,
      }),

      // RATING
      col.accessor("rating", {
        header: "Nota",
        cell: (i) => <RatingCell track={i.row.original} />,
        size: 80, minSize: 70,
      }),

      // CUE POINTS
      col.accessor("cue_points", {
        id: "cue_points",
        header: () => <span className="text-[9px] font-bold uppercase tracking-widest text-[#4C4743]">CUE</span>,
        cell: ({ getValue }) => {
          const cues = getValue() ?? [];
          const count = cues.length;
          return (
            <div className="w-full flex items-center justify-center gap-1">
              {count > 0 ? (
                <div className="flex items-center gap-1">
                  {cues.slice(0, 4).map((c: import("../store").CuePoint, i: number) => (
                    <span
                      key={i}
                      className="w-3 h-3 rounded-sm flex items-center justify-center text-white font-bold"
                      style={{ background: c.color, fontSize: 7 }}
                    >
                      {i + 1}
                    </span>
                  ))}
                  {count > 4 && (
                    <span className="text-[9px] font-mono" style={{ color: "var(--c-t6)" }}>+{count - 4}</span>
                  )}
                </div>
              ) : (
                <span className="text-[11px]" style={{ color: "var(--c-t7)" }}>—</span>
              )}
            </div>
          );
        },
        size: 80, minSize: 64,
        enableSorting: false,
      }),

      // DURAÇÃO
      col.accessor("duration_secs", {
        header: i18n.t("settings.columns.colDuration"),
        cell: (i) => {
          const s = i.getValue();
          if (!s) return <span className="text-[#605A55] text-xs">—</span>;
          const m = Math.floor(s / 60);
          const sec = Math.floor(s % 60);
          return (
            <span className="text-[11px] font-mono tabular-nums text-[#8F8883]">
              {m}:{sec.toString().padStart(2, "0")}
            </span>
          );
        },
        size: 72, minSize: 60,
      }),

      // BITRATE (kbps)
      col.accessor("bitrate_kbps", {
        id: "bitrate",
        header: "kbps",
        cell: (i) => {
          const v = i.getValue();
          if (!v) return <span className="text-[#605A55] text-xs">—</span>;
          const color = v >= 320 ? "#5BA055" : v >= 192 ? "#C9A84C" : "#D95340";
          return (
            <span
              className="text-[11px] font-mono tabular-nums font-semibold"
              style={{ color }}
            >
              {v}
            </span>
          );
        },
        size: 68, minSize: 56,
      }),

      // TIPO (formato do arquivo)
      col.accessor("format", {
        id: "tipo",
        header: "Tipo",
        cell: (i) => i.getValue()
          ? <span className="px-1 py-px rounded-sm text-[9px] font-bold uppercase tracking-widest bg-white/[0.04] text-[#605A55]">{i.getValue()}</span>
          : <span className="text-[#605A55] text-xs">—</span>,
        size: 60, minSize: 50,
      }),

      // ADICIONADA (data de modificação)
      col.accessor("modified_at", {
        id: "adicionada",
        header: "Adicionada",
        cell: (i) => {
          const ts = i.getValue();
          if (!ts) return <span className="text-[#605A55] text-xs">—</span>;
          const d = new Date(ts * 1000);
          return <span className="text-[11px] font-mono text-[#8F8883]">{d.toLocaleDateString("pt-BR")}</span>;
        },
        size: 96, minSize: 80,
      }),

      // COMENTÁRIO
      col.accessor("comment", {
        id: "comment",
        header: i18n.t("settings.columns.colComment"),
        cell: (i) =>
          i.getValue() ? (
            <span className="text-[11px] text-[#8F8883] truncate">{i.getValue()}</span>
          ) : (
            <span className="text-[#605A55] text-xs">—</span>
          ),
        size: 160,
      }),

      // PLAYLISTS
      col.display({
        id: "playlists",
        header: () => <span className="text-[9px] font-bold uppercase tracking-widest text-[#4C4743]">Playlists</span>,
        cell: ({ row }) => {
          const trackPlaylists = playlists.filter((pl) => pl.trackPaths.includes(row.original.path));
          if (trackPlaylists.length === 0) return <span className="text-[#605A55] text-xs">—</span>;
          return (
            <div className="flex flex-wrap gap-0.5 justify-center">
              {trackPlaylists.slice(0, 2).map((pl) => (
                <span
                  key={pl.id}
                  className="px-1.5 py-px rounded-sm text-[8px] truncate max-w-[72px]"
                  style={{ background: "rgba(217,83,64,0.12)", color: "#C97B40", border: "1px solid rgba(201,123,64,0.25)" }}
                  title={pl.name}
                >
                  {pl.name}
                </span>
              ))}
              {trackPlaylists.length > 2 && (
                <span className="text-[8px] font-mono" style={{ color: "var(--c-t7)" }}>+{trackPlaylists.length - 2}</span>
              )}
            </div>
          );
        },
        size: 130, minSize: 80,
      }),
    ],
    [bpmCompatIds, keyCompatIds, favoriteTrackPaths, toggleTrackFavorite, playlists]
  );

  const table = useReactTable({
    data: tracks,
    columns,
    state: { sorting, columnVisibility: mergedVisibility, columnSizing, columnOrder },
    getRowId: (row) => row.id,
    columnResizeMode: 'onChange' as const,
    enableColumnResizing: true,
    onColumnSizingChange: (updater) => {
      const next = typeof updater === 'function' ? updater(columnSizing) : updater;
      setColumnSizing(next);
      localStorage.setItem("tagwave_col_sizes", JSON.stringify(next));
    },
    onSortingChange: (updater) => {
      const next = typeof updater === "function" ? updater(sorting) : updater;
      setSorting(next);
      localStorage.setItem("tagwave_sort", JSON.stringify(next));
    },
    onColumnVisibilityChange: (updater) => {
      const next = typeof updater === "function" ? updater(mergedVisibility) : updater;
      setColumnVisibility(next);
    },
    onColumnOrderChange: (updater) => {
      const next = typeof updater === 'function' ? updater(columnOrder) : updater;
      setColumnOrder(next);
      localStorage.setItem("tagwave_col_order", JSON.stringify(next));
    },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  sortedRowsRef.current = table.getRowModel().rows;

  const handleRowClick = useCallback(
    (id: string, idx: number, e: React.MouseEvent) => {
      if ((e.target as HTMLElement).tagName === "INPUT") return;
      if ((e.target as HTMLElement).tagName === "BUTTON") return;
      // Detecção manual de duplo clique (fallback para VMs e WebView2 com timing irregular)
      const now = Date.now();
      if (lastClickRef.current.id === id && now - lastClickRef.current.time < 400) {
        lastClickRef.current = { id: "", time: 0 };
        requestPlay(id);
        return;
      }
      lastClickRef.current = { id, time: now };

      const rows = sortedRowsRef.current;

      if (e.shiftKey && anchorIdRef.current !== null) {
        const anchorIdx = rows.findIndex((r) => r.id === anchorIdRef.current);
        const from = anchorIdx >= 0 ? anchorIdx : idx;
        const lo = Math.min(from, idx);
        const hi = Math.max(from, idx);
        const rangeIds = rows.slice(lo, hi + 1).map((r) => r.id);
        // replaceSelection = clearSelection + selectAll em 1 único update do store
        if (e.metaKey) selectAll(rangeIds);
        else replaceSelection(rangeIds);
      } else if (e.metaKey) {
        toggleSelect(id);
        anchorIdRef.current = id;
      } else {
        clearSelection();
        toggleSelect(id);
        anchorIdRef.current = id;
      }
    },
    [toggleSelect, selectAll, replaceSelection, clearSelection, requestPlay]
  );

  const VIDEO_EXTS = new Set(["mp4", "mkv", "avi", "mov", "wmv", "webm", "m4v"]);

  const handleRowDoubleClick = useCallback(
    (id: string) => {
      const track = allTracks.find((t) => t.id === id);
      if (track && VIDEO_EXTS.has((track.format ?? "").toLowerCase())) {
        if (onVideoPlay) { onVideoPlay(track); return; }
        openPath(track.path).catch(() => {});
        return;
      }
      requestPlay(id);
    },
    [requestPlay, allTracks, onVideoPlay]
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, track: Track) => {
      e.preventDefault();
      setContextMenu({ x: e.clientX, y: e.clientY, track });
    },
    []
  );

  useEffect(() => {
    if (!contextMenu) return;
    const handler = () => setContextMenu(null);
    window.addEventListener("click", handler, { once: true });
    window.addEventListener("keydown", handler, { once: true });
    return () => {
      window.removeEventListener("click", handler);
      window.removeEventListener("keydown", handler);
    };
  }, [contextMenu]);

  // Reposiciona o menu de contexto se sair da tela (ex: última faixa da lista)
  useLayoutEffect(() => {
    if (!contextMenu || !contextRef.current) return;
    const menu = contextRef.current;
    const rect = menu.getBoundingClientRect();
    const GAP = 8;
    let top  = contextMenu.y;
    let left = contextMenu.x;
    if (top  + rect.height > window.innerHeight - GAP) top  = Math.max(GAP, top  - rect.height);
    if (left + rect.width  > window.innerWidth  - GAP) left = Math.max(GAP, window.innerWidth - rect.width - GAP);
    menu.style.top  = `${top}px`;
    menu.style.left = `${left}px`;
  }, [contextMenu]);

  // Hooks must be called unconditionally (before any early return)
  const tableContainerRef = useRef<HTMLDivElement>(null);
  const allRows = table.getRowModel().rows;
  const rowVirtualizer = useVirtualizer({
    count: allRows.length,
    getScrollElement: () => tableContainerRef.current,
    estimateSize: () => 44,
    overscan: 30,
  });

  const [containerWidth, setContainerWidth] = useState(0);
  useEffect(() => {
    const el = tableContainerRef.current;
    if (!el) return;
    const obs = new ResizeObserver(([entry]) => setContainerWidth(entry.contentRect.width));
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  const ROW_NUM_W = 40;
  const colScaleFactor = containerWidth > 0 && containerWidth > table.getTotalSize() + ROW_NUM_W
    ? (containerWidth - ROW_NUM_W) / table.getTotalSize()
    : 1;

  if (tracks.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-8">
        {/* Donut logo em laranja original */}
        <svg width="56" height="56" viewBox="0 0 56 56" fill="none" className="mb-1 opacity-70">
          <circle cx="28" cy="28" r="27" fill="#D95340"/>
          <circle cx="28" cy="28" r="15" fill="#0E0D0C"/>
        </svg>
        {hasFolder ? (
          <>
            <p className="text-xs text-[#605A55] uppercase tracking-widest">Nenhuma faixa encontrada</p>
            <p className="text-[11px] text-[#8F8883] leading-relaxed max-w-[260px]">
              Tente ajustar o filtro ou selecione outra pasta na barra lateral.
            </p>
            {onOpenFolder && (
              <button
                onClick={onOpenFolder}
                className="mt-2 flex items-center gap-2 px-4 py-2 rounded-lg text-[#8F8883] text-xs font-medium border border-white/[0.08] hover:border-white/[0.14] hover:text-[#C2BEBC] transition-colors"
              >
                <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M2 5.5C2 4.67 2.67 4 3.5 4H6L7 5H12.5C13.33 5 14 5.67 14 6.5V11.5C14 12.33 13.33 13 12.5 13H3.5C2.67 13 2 12.33 2 11.5V5.5Z"/>
                </svg>
                Abrir outra pasta
              </button>
            )}
          </>
        ) : (
          <>
            <p className="text-xs text-[#605A55] uppercase tracking-widest">Nenhuma faixa carregada</p>
            <p className="text-[12px] text-[#ABA5A0] leading-relaxed max-w-[280px] text-center">
              Selecione uma pasta na barra lateral esquerda<br/>ou adicione uma nova pasta com suas músicas.
            </p>
            {onOpenFolder && (
              <button
                onClick={onOpenFolder}
                className="mt-2 flex items-center gap-2 px-5 py-2.5 rounded-lg text-white text-xs font-semibold transition-colors"
                style={{ background: "#D95340" }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "#E07364"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "#D95340"; }}
              >
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M2 5.5C2 4.67 2.67 4 3.5 4H6L7 5H12.5C13.33 5 14 5.67 14 6.5V11.5C14 12.33 13.33 13 12.5 13H3.5C2.67 13 2 12.33 2 11.5V5.5Z"/>
                  <line x1="8" y1="7.5" x2="8" y2="11"/>
                  <line x1="6.25" y1="9.25" x2="9.75" y2="9.25"/>
                </svg>
                Abrir Pasta de Músicas
              </button>
            )}
          </>
        )}
      </div>
    );
  }

  const rowH = compact ? "py-1" : "py-3.5";

  const virtualItems = rowVirtualizer.getVirtualItems();
  const totalSize = rowVirtualizer.getTotalSize();
  const paddingTop = virtualItems.length > 0 ? virtualItems[0].start : 0;
  const paddingBottom = virtualItems.length > 0 ? totalSize - virtualItems[virtualItems.length - 1].end : 0;

  return (
    <>
    <div ref={tableContainerRef} className="flex-1 overflow-auto select-none">
      <table className="text-sm border-collapse table-fixed" style={{ width: "100%", minWidth: colScaleFactor > 1 ? undefined : table.getTotalSize() + 40 }}>
        <thead className="sticky top-0 z-10 bg-[#0E0D0C]">
          <tr>
            {/* Row number header */}
            {mergedVisibility.num !== false && (
              <th className="w-10 px-3 py-2.5 text-center border-b border-white/[0.05]"
                style={{ boxShadow: 'inset -1px 0 0 rgba(255,255,255,0.07)' }}
                onContextMenu={(e) => { e.preventDefault(); setColCtxMenu({ x: e.clientX, y: e.clientY }); }}>
                <span className="text-[10px] font-bold text-[#8F8883] uppercase tracking-wider">#</span>
              </th>
            )}
            {table.getHeaderGroups()[0]?.headers.map((header) => (
              <th
                key={header.id}
                data-col-id={header.id}
                style={{
                  width: Math.round(header.getSize() * colScaleFactor),
                  position: 'relative',
                  opacity: draggingColId === header.id ? 0.2 : 1,
                  transition: 'opacity 0.12s, transform 0.12s',
                  transform: dragOverColId === header.id ? 'translateX(4px)' : 'translateX(0)',
                  boxShadow: 'inset -1px 0 0 rgba(255,255,255,0.07)',
                }}
                className={`px-3 py-2.5 text-[10px] font-bold text-[#8F8883] uppercase tracking-wider border-b border-white/[0.05] select-none whitespace-nowrap ${
                  LEFT_COLS.has(header.id) ? 'text-left' : 'text-center'
                } ${
                  dragOverColId === header.id
                    ? 'border-l-2 border-l-[#D95340] bg-[#D95340]/[0.10]'
                    : 'border-l border-l-transparent'
                }`}
                onClick={header.column.getToggleSortingHandler()}
                onContextMenu={(e) => { e.preventDefault(); setColCtxMenu({ x: e.clientX, y: e.clientY }); }}
                onMouseDown={(e) => {
                  if (e.button !== 0) return;
                  if ((e.target as HTMLElement).closest('[data-resize]')) return;

                  const startX = e.clientX;
                  const startY = e.clientY;
                  let dragging = false;

                  const colLabel = typeof header.column.columnDef.header === "string"
                    ? header.column.columnDef.header
                    : header.id;

                  const onMove = (mv: MouseEvent) => {
                    if (!dragging) {
                      if (Math.abs(mv.clientX - startX) > 6 || Math.abs(mv.clientY - startY) > 6) {
                        dragging = true;
                        dragColIdRef.current = header.id;
                        setDraggingColId(header.id);
                        document.body.style.cursor = 'grabbing';
                      }
                    }
                    if (!dragging) return;
                    setDragGhost({ x: mv.clientX, y: mv.clientY, label: colLabel });
                    const el = document.elementFromPoint(mv.clientX, mv.clientY);
                    const th = el?.closest('th[data-col-id]');
                    const over = th?.getAttribute('data-col-id') ?? null;
                    setDragOverColId(over !== header.id ? over : null);
                  };

                  const onUp = (up: MouseEvent) => {
                    document.removeEventListener('mousemove', onMove);
                    document.removeEventListener('mouseup', onUp);
                    document.body.style.cursor = '';
                    setDraggingColId(null);
                    setDragGhost(null);
                    if (!dragging) { dragColIdRef.current = null; return; }
                    document.addEventListener('click', (ce) => ce.stopPropagation(), { once: true, capture: true });
                    const el = document.elementFromPoint(up.clientX, up.clientY);
                    const th = el?.closest('th[data-col-id]');
                    const to = th?.getAttribute('data-col-id');
                    const from = dragColIdRef.current;
                    setDragOverColId(null);
                    dragColIdRef.current = null;
                    if (!from || !to || from === to) return;
                    const allIds = table.getAllLeafColumns().map((c) => c.id);
                    const base = columnOrder.length > 0 ? columnOrder : allIds;
                    // Merge saved order with any new columns not yet in it
                    const current = [...base.filter(id => allIds.includes(id)), ...allIds.filter(id => !base.includes(id))];
                    const fi = current.indexOf(from);
                    const ti = current.indexOf(to);
                    if (fi < 0 || ti < 0) return;
                    const next = [...current];
                    next.splice(fi, 1);
                    next.splice(ti, 0, from);
                    setColumnOrder(next);
                    localStorage.setItem("tagwave_col_order", JSON.stringify(next));
                  };

                  document.addEventListener('mousemove', onMove);
                  document.addEventListener('mouseup', onUp);
                }}
              >
                <span className={`flex items-center gap-1.5 cursor-grab group ${LEFT_COLS.has(header.id) ? 'justify-start' : 'justify-center'}`}>
                  {/* Handle de drag — visível no hover */}
                  <span className="opacity-0 group-hover:opacity-40 transition-opacity text-[#8F8883] text-[9px] leading-none select-none" style={{ letterSpacing: '-1px' }}>
                    ⠿
                  </span>
                  <span
                    className="flex items-center gap-1 cursor-pointer"
                    onClick={(e) => { e.stopPropagation(); header.column.getToggleSortingHandler()?.(e); }}
                  >
                    {flexRender(header.column.columnDef.header, header.getContext())}
                    {header.column.getIsSorted() === "asc" && (
                      <span className="text-[#D95340]">↑</span>
                    )}
                    {header.column.getIsSorted() === "desc" && (
                      <span className="text-[#D95340]">↓</span>
                    )}
                  </span>
                </span>
                {header.column.getCanResize() && (
                  <div
                    data-resize
                    onMouseDown={header.getResizeHandler()}
                    onTouchStart={header.getResizeHandler()}
                    className={`absolute top-0 right-0 h-full w-[3px] cursor-col-resize select-none touch-none transition-colors ${
                      header.column.getIsResizing() ? 'bg-[#D95340]' : 'hover:bg-white/[0.15]'
                    }`}
                  />
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {paddingTop > 0 && (
            <tr><td colSpan={999} style={{ height: paddingTop, padding: 0, border: 0 }} /></tr>
          )}
          {virtualItems.map((virtualRow) => {
            const row = allRows[virtualRow.index];
            const i = virtualRow.index;
            const selected = selectedIds.has(row.id);
            const isPlaying = playerTrackId === row.id;
            const isEnriching = enrichingIds?.has(row.id) ?? false;
            const isEnrichDone = enrichDoneIds?.has(row.id) ?? false;
            return (
              <tr
                key={row.id}
                onClick={(e) => handleRowClick(row.id, i, e)}
                onDoubleClick={() => handleRowDoubleClick(row.id)}
                onContextMenu={(e) => handleContextMenu(e, row.original)}
                onMouseDown={(e) => {
                  if (e.button !== 0) return;
                  if ((e.target as HTMLElement).closest('button, input, [data-no-drag]')) return;
                  const startX = e.clientX;
                  const startY = e.clientY;
                  let fired = false;
                  const dragIds = selectedIds.size > 1 && selectedIds.has(row.id)
                    ? [...selectedIds]
                    : [row.id];
                  const onMove = (mv: MouseEvent) => {
                    if (!fired && (Math.abs(mv.clientX - startX) > 6 || Math.abs(mv.clientY - startY) > 6)) {
                      fired = true;
                      onTrackDragStart?.(dragIds, mv.clientX, mv.clientY);
                    }
                  };
                  const onUp = () => {
                    document.removeEventListener('mousemove', onMove);
                    document.removeEventListener('mouseup', onUp);
                  };
                  document.addEventListener('mousemove', onMove);
                  document.addEventListener('mouseup', onUp);
                }}
                className={`cursor-pointer transition-all duration-150 border-b ${
                  isEnriching
                    ? "bg-[#D95340]/[0.07] border-[#D95340]/[0.10]"
                    : isEnrichDone
                    ? "bg-[#D95340]/[0.13] border-[#D95340]/[0.15]"
                    : isPlaying
                    ? "bg-[#D95340]/[0.05] border-[#D95340]/[0.08]"
                    : selected
                    ? "track-row-selected border-white/[0.04]"
                    : "border-white/[0.03] hover:bg-white/[0.015]"
                }`}
              >
                {/* Row number / playing indicator */}
                {mergedVisibility.num !== false && (
                  <td className={`px-3 ${rowH} w-10 text-right`}>
                    {isPlaying ? (
                      <span className="inline-flex items-center justify-end gap-px">
                        {[1, 1.5, 0.8].map((h, k) => (
                          <span
                            key={k}
                            className="w-[2px] bg-[#D95340] rounded-full inline-block"
                            style={{
                              height: `${h * 8}px`,
                              animation: `eq-bar 0.8s ease-in-out ${k * 0.15}s infinite alternate`,
                            }}
                          />
                        ))}
                      </span>
                    ) : (
                      <span className={`text-[11px] font-mono tabular-nums ${selected ? "text-[#D95340]" : "text-[#8F8883]"}`}>
                        {String(i + 1).padStart(2, "0")}
                      </span>
                    )}
                  </td>
                )}
                {row.getVisibleCells().map((cell) => (
                  <td
                    key={cell.id}
                    className={`px-2 ${rowH} overflow-hidden align-middle`}
                  >
                    <div className={`flex items-center min-w-0 w-full ${LEFT_COLS.has(cell.column.id) ? 'justify-start' : 'justify-center'}`}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </div>
                  </td>
                ))}
              </tr>
            );
          })}
          {paddingBottom > 0 && (
            <tr><td colSpan={999} style={{ height: paddingBottom, padding: 0, border: 0 }} /></tr>
          )}
        </tbody>
      </table>
    </div>

    {/* Context menu */}
    {contextMenu && (
      <div
        ref={contextRef}
        className="fixed z-[200] rounded-lg shadow-2xl py-1 min-w-[180px]"
        style={{ left: contextMenu.x, top: contextMenu.y, background: "#1c1715", border: "1px solid rgba(255,255,255,0.08)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          className="w-full px-3 py-1.5 text-left text-[12px] hover:bg-white/[0.06] flex items-center gap-2" style={{ color: "#E8E4E1" }}
          onClick={() => {
            const isVideo = VIDEO_EXTS.has((contextMenu.track.format ?? "").toLowerCase());
            if (isVideo) {
              if (onVideoPlay) { onVideoPlay(contextMenu.track); }
              else { openPath(contextMenu.track.path).catch(() => {}); }
            } else {
              requestPlay(contextMenu.track.id);
            }
            setContextMenu(null);
          }}
        >
          <svg width="11" height="11" viewBox="0 0 11 11" fill="currentColor" className="opacity-60"><path d="M2 1.5l8 4-8 4V1.5z"/></svg>
          {VIDEO_EXTS.has((contextMenu.track.format ?? "").toLowerCase()) ? t("table.playVideo") : t("table.play")}
        </button>
        {/* Enriquecer metadados */}
        {onEnrich && (
          <button
            className="w-full px-3 py-1.5 text-left text-[12px] hover:bg-white/[0.06] flex items-center gap-2" style={{ color: "#E8E4E1" }}
            onClick={() => {
              const trackId = contextMenu.track.id;
              // Se há múltiplas faixas selecionadas e essa é uma delas, enriquece a seleção.
              // Caso contrário, enriquece só esta faixa (passa o ID explicitamente).
              const passId = selectedIds.size > 1 && selectedIds.has(trackId) ? undefined : trackId;
              setContextMenu(null);
              onEnrich(passId);
            }}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="opacity-70">
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
            </svg>
            {selectedIds.size > 1 && selectedIds.has(contextMenu.track.id)
              ? t("table.enrichCount", { count: selectedIds.size })
              : t("table.enrichMeta")}
          </button>
        )}
        {/* Analisar BPM — apenas para faixas de áudio com duração conhecida */}
        {!VIDEO_EXTS.has((contextMenu.track.format ?? "").toLowerCase()) && (
          <button
            className="w-full px-3 py-1.5 text-left text-[12px] hover:bg-white/[0.06] flex items-center gap-2 disabled:opacity-40" style={{ color: "#E8E4E1" }}
            disabled={analyzingBpmId === contextMenu.track.id}
            onClick={async () => {
              const track = contextMenu.track;
              setContextMenu(null);
              setAnalyzingBpmId(track.id);
              try {
                const bpm = await invoke<number | null>("analyze_bpm", {
                  path: track.path,
                  durationSecs: track.duration_secs ?? 0,
                });
                if (bpm !== null) {
                  const bpmStr = bpm.toFixed(1).replace(".0", "");
                  const fresh = useAppStore.getState().tracks.find((t2) => t2.path === track.path) ?? track;
                  await invoke("save_tags", {
                    path: fresh.path, title: fresh.title ?? null, artist: fresh.artist ?? null,
                    album: fresh.album ?? null, genre: fresh.genre ?? null, year: fresh.year ?? null,
                    trackNumber: fresh.track_number ?? null, totalTracks: fresh.total_tracks ?? null,
                    bpm: bpmStr, key: fresh.key ?? null, rating: fresh.rating ?? null,
                    comment: fresh.comment ?? null,
                  });
                  useAppStore.getState().updateTrack({ ...fresh, bpm: bpmStr });
                }
              } catch { /* silencioso */ }
              finally { setAnalyzingBpmId(null); }
            }}
          >
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" className="opacity-70">
              <path d="M1 8l2-4 2 2.5 2-5 2 3 1-2"/>
            </svg>
            {analyzingBpmId === contextMenu.track.id ? t("table.analyzing") : t("table.analyzeBpm")}
          </button>
        )}
        {/* Edição inline */}
        <div className="h-px bg-white/[0.06] my-1" />
        <button
          className="w-full px-3 py-1.5 text-left text-[12px] hover:bg-white/[0.06] flex items-center gap-2" style={{ color: "#E8E4E1" }}
          onClick={() => {
            requestInlineEdit(contextMenu.track.id, "title");
            setContextMenu(null);
          }}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" className="opacity-60">
            <path d="M1 9h8M6.5 1.5l2 2-5 5H1.5v-2l5-5z"/>
          </svg>
          {t("table.editTitle")}
        </button>
        <button
          className="w-full px-3 py-1.5 text-left text-[12px] hover:bg-white/[0.06] flex items-center gap-2" style={{ color: "#E8E4E1" }}
          onClick={() => {
            requestInlineEdit(contextMenu.track.id, "artist");
            setContextMenu(null);
          }}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" className="opacity-60">
            <path d="M1 9h8M6.5 1.5l2 2-5 5H1.5v-2l5-5z"/>
          </svg>
          {t("table.editArtist")}
        </button>
        {/* Renomear pelo metadado */}
        <button
          className="w-full px-3 py-1.5 text-left text-[12px] hover:bg-white/[0.06] flex items-center gap-2" style={{ color: "#E8E4E1" }}
          onClick={async () => {
            const isBatch = selectedIds.size > 1 && selectedIds.has(contextMenu.track.id);
            const paths = isBatch
              ? tracks.filter((t) => selectedIds.has(t.id)).map((t) => t.path)
              : [contextMenu.track.path];
            setContextMenu(null);
            interface RenameResult { old_path: string; new_path: string; }
            const results = await invoke<RenameResult[]>("rename_from_tags", { paths });
            if (results.length === 0) {
              toast("Nenhum arquivo renomeado — metadados insuficientes ou nome já correto.", "info");
              return;
            }
            results.forEach(({ old_path, new_path }) => {
              const track = tracks.find((t) => t.path === old_path);
              if (track) {
                const newFilename = new_path.split(/[\\/]/).pop() ?? new_path;
                useAppStore.getState().updateTrack({ ...track, path: new_path, filename: newFilename });
              }
            });
            toast(
              results.length === 1
                ? `Arquivo renomeado para "${results[0].new_path.split(/[\\/]/).pop()}"`
                : `${results.length} arquivos renomeados pelo metadado`,
              "success"
            );
          }}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" className="opacity-60">
            <path d="M1 5h8M5 1l4 4-4 4"/>
          </svg>
          {selectedIds.size > 1 && selectedIds.has(contextMenu.track.id)
            ? `Renomear ${selectedIds.size} arquivos pelo metadado`
            : "Renomear arquivo pelo metadado"}
        </button>
        {/* Trocar capa em lote */}
        <button
          className="w-full px-3 py-1.5 text-left text-[12px] hover:bg-white/[0.06] flex items-center gap-2" style={{ color: "#E8E4E1" }}
          onClick={async () => {
            const isBatch = selectedIds.size > 1 && selectedIds.has(contextMenu.track.id);
            const paths = isBatch
              ? tracks.filter((t) => selectedIds.has(t.id)).map((t) => t.path)
              : [contextMenu.track.path];
            setContextMenu(null);
            const imagePath = await openFileDialog({
              filters: [{ name: "Imagens", extensions: ["jpg", "jpeg", "png"] }],
              multiple: false,
            });
            if (!imagePath || typeof imagePath !== "string") return;
            const ok = await invoke<number>("save_cover_batch_from_file", {
              paths,
              imagePath,
            }).catch(() => 0);
            if (ok === 0) {
              toast("Nenhuma capa aplicada — verifique os arquivos.", "error");
              return;
            }
            paths.forEach((p) => {
              const track = tracks.find((t) => t.path === p);
              if (track) useAppStore.getState().updateTrack({
                ...track,
                has_cover: true,
                cover_version: (track.cover_version ?? 0) + 1,
                issues: track.issues.filter((i) => i !== "sem capa"),
              });
            });
            toast(
              ok === 1 ? "Capa aplicada com sucesso." : `Capa aplicada em ${ok} faixas.`,
              "success"
            );
          }}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" className="opacity-60">
            <rect x="1" y="1" width="8" height="8" rx="1"/>
            <circle cx="3.5" cy="3.5" r="1"/>
            <path d="M1 7l2.5-2.5 2 2 1.5-1.5 2 2"/>
          </svg>
          {selectedIds.size > 1 && selectedIds.has(contextMenu.track.id)
            ? `Trocar capa de ${selectedIds.size} faixas`
            : "Trocar capa"}
        </button>
        <div className="h-px bg-white/[0.06] my-1" />
        <button
          className="w-full px-3 py-1.5 text-left text-[12px] hover:bg-white/[0.06] flex items-center gap-2" style={{ color: "#E8E4E1" }}
          onClick={() => {
            invoke("reveal_in_finder", { path: contextMenu.track.path }).catch(() => {});
            setContextMenu(null);
          }}
        >
          <svg width="11" height="11" viewBox="0 0 11 11" fill="currentColor" className="opacity-60"><path d="M1 2h9v7H1V2zm2 2v3h5V4H3z"/></svg>
          {IS_WIN_TABLE ? t("table.revealExplorer") : t("table.revealFinder")}
        </button>
        <button
          className="w-full px-3 py-1.5 text-left text-[12px] hover:bg-white/[0.06] flex items-center gap-2" style={{ color: "#E8E4E1" }}
          onClick={() => {
            navigator.clipboard.writeText(contextMenu.track.path).catch(() => {});
            setContextMenu(null);
          }}
        >
          <svg width="11" height="11" viewBox="0 0 11 11" fill="currentColor" className="opacity-60"><rect x="3" y="1" width="7" height="8" rx="1"/><rect x="1" y="3" width="7" height="8" rx="1" fill="none" stroke="currentColor" strokeWidth="1"/></svg>
          {t("table.copyPath")}
        </button>
        <button
          className="w-full px-3 py-1.5 text-left text-[12px] hover:bg-white/[0.06] flex items-center gap-2" style={{ color: "#E8E4E1" }}
          onClick={() => {
            const shareTracks = selectedIds.size > 1
              ? tracks.filter((t) => selectedIds.has(t.id))
              : [contextMenu.track];
            const lines = shareTracks.map((t) => {
              const parts: string[] = [];
              if (t.title) parts.push(t.title);
              if (t.artist) parts.push(t.artist);
              if (t.bpm) parts.push(`${parseFloat(t.bpm).toFixed(0)} BPM`);
              if (t.key) parts.push(t.key);
              return parts.length > 0 ? parts.join(" — ") : t.filename;
            });
            navigator.clipboard.writeText(lines.join("\n")).catch(() => {});
            toast(`${shareTracks.length} faixa${shareTracks.length > 1 ? "s" : ""} copiada${shareTracks.length > 1 ? "s" : ""} para a área de transferência`, "success");
            setContextMenu(null);
          }}
        >
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" className="opacity-60">
            <circle cx="8.5" cy="2" r="1.2"/><circle cx="2" cy="5.5" r="1.2"/><circle cx="8.5" cy="9" r="1.2"/>
            <path d="M3.2 4.8l4.1-2M3.2 6.2l4.1 2"/>
          </svg>
          {selectedIds.size > 1 ? `Compartilhar (${selectedIds.size})` : "Compartilhar"}
        </button>
        <div className="h-px bg-white/[0.06] my-1" />
        <button
          className="w-full px-3 py-1.5 text-left text-[12px] text-[#D95340]/70 hover:bg-white/[0.06] flex items-center gap-2"
          onClick={() => {
            toggleTrackFavorite(contextMenu.track.path);
            setContextMenu(null);
          }}
        >
          <svg width="11" height="11" viewBox="0 0 12 12" fill={favoriteTrackPaths.has(contextMenu.track.path) ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" className="text-[#D95340] opacity-80">
            <polygon points="6,1.2 7.5,4.5 11,4.9 8.5,7.3 9.2,10.8 6,9 2.8,10.8 3.5,7.3 1,4.9 4.5,4.5"/>
          </svg>
          {favoriteTrackPaths.has(contextMenu.track.path) ? t("table.removeFromFavs") : t("table.addToFavs")}
        </button>
        <div className="h-px bg-white/[0.06] my-1" />
        <button
          className="w-full px-3 py-1.5 text-left text-[12px] hover:bg-white/[0.06] flex items-center gap-2" style={{ color: "#E8E4E1" }}
          onClick={() => {
            const exportTracks = selectedIds.size > 1
              ? tracks.filter((t) => selectedIds.has(t.id))
              : [contextMenu.track];
            setPlaylistTracks(exportTracks);
            setContextMenu(null);
          }}
        >
          <svg width="11" height="11" viewBox="0 0 11 11" fill="currentColor" className="opacity-60">
            <rect x="1" y="1" width="9" height="2" rx="0.5"/>
            <rect x="1" y="4.5" width="7" height="2" rx="0.5"/>
            <rect x="1" y="8" width="5" height="2" rx="0.5"/>
          </svg>
          {selectedIds.size > 1 ? t("table.createPlaylistCount", { count: selectedIds.size }) : t("table.createPlaylist")}
        </button>
        {/* Adicionar a playlist existente */}
        {playlists.length > 0 && (
          <div className="relative group/submenu">
            <button className="w-full px-3 py-1.5 text-left text-[12px] hover:bg-white/[0.06] flex items-center justify-between gap-2" style={{ color: "#E8E4E1" }}>
              <span className="flex items-center gap-2">
                <svg width="11" height="11" viewBox="0 0 11 11" fill="currentColor" className="opacity-60">
                  <rect x="1" y="1" width="9" height="2" rx="0.5"/>
                  <rect x="1" y="4.5" width="5" height="2" rx="0.5"/>
                  <path d="M8 6v3M6.5 7.5h3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                </svg>
                {t("table.addToPlaylist")}
              </span>
              <svg width="6" height="6" viewBox="0 0 6 6" fill="currentColor" className="opacity-40"><path d="M1 0l4 3-4 3V0z"/></svg>
            </button>
            <div className="absolute left-full top-0 ml-1 hidden group-hover/submenu:block z-50 min-w-[160px]">
              <div className="py-1 rounded-lg shadow-xl" style={{ background: "#1c1715", border: "1px solid rgba(255,255,255,0.08)" }}>
                {playlists.map((pl) => (
                  <button
                    key={pl.id}
                    className="w-full px-3 py-1.5 text-left text-[11px] hover:bg-white/[0.06] truncate" style={{ color: "#E8E4E1" }}
                    onClick={async () => {
                      const paths = selectedIds.size > 1
                        ? tracks.filter((t) => selectedIds.has(t.id)).map((t) => t.path)
                        : [contextMenu.track.path];
                      addTracksToPlaylist(pl.id, paths);
                      setContextMenu(null);
                      const gp = pl.globalProperties;
                      if (gp?.enabled && gp.activeFields.length > 0) {
                        await applyPlaylistRules(gp, paths);
                      }
                    }}
                  >
                    {pl.name}
                    <span className="ml-1 text-[#4C4743] text-[9px]">({pl.trackPaths.length})</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
        {/* Aplicar regras da playlist ativa */}
        {(() => {
          const activePl = activePlaylistId ? playlists.find((p) => p.id === activePlaylistId) : null;
          const gp = activePl?.globalProperties;
          if (!gp?.enabled || !gp.activeFields.length) return null;
          const paths = selectedIds.size > 1 && selectedIds.has(contextMenu.track.id)
            ? tracks.filter((t) => selectedIds.has(t.id)).map((t) => t.path)
            : [contextMenu.track.path];
          return (
            <button
              className="w-full px-3 py-1.5 text-left text-[12px] hover:bg-white/[0.06] flex items-center gap-2"
              style={{ color: "#E8E4E1" }}
              onClick={async () => {
                setContextMenu(null);
                await applyPlaylistRules(gp, paths);
                const count = paths.length;
                toast(count > 1 ? `Regras aplicadas em ${count} faixas` : "Regras aplicadas", "success");
              }}
            >
              <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" className="opacity-60">
                <circle cx="5.5" cy="5.5" r="1.4"/>
                <path d="M5.5 1v1M5.5 9v1M1 5.5h1M9 5.5h1M2.4 2.4l.7.7M8.5 8.5l-.7-.7M8.5 2.4l-.7.7M2.4 8.5l.7-.7"/>
              </svg>
              {paths.length > 1 ? `Aplicar regras em ${paths.length} faixas` : "Aplicar regras da playlist"}
            </button>
          );
        })()}
        <div className="h-px bg-white/[0.06] my-1" />
        <button
          className="w-full px-3 py-1.5 text-left text-[12px] text-[#D95340]/80 hover:bg-white/[0.06] flex items-center gap-2"
          onClick={() => {
            const targets = selectedIds.size > 1
              ? tracks.filter((t) => selectedIds.has(t.id))
              : [contextMenu.track];
            setRemoveDialog({ targets });
            setContextMenu(null);
          }}
        >
          <svg width="11" height="11" viewBox="0 0 11 11" fill="currentColor" className="opacity-70">
            <path d="M4 1h3a1 1 0 011 1v.5H2.5V2A1 1 0 014 1zM1 3h9l-.8 6.5A1 1 0 018.2 10H2.8a1 1 0 01-.997-.9L1 3z"/>
          </svg>
          {selectedIds.size > 1 ? t("table.removeCount", { count: selectedIds.size }) : t("table.remove")}
        </button>
      </div>
    )}

    {playlistTracks && (
      <CreatePlaylistModal
        tracks={playlistTracks}
        onClose={() => setPlaylistTracks(null)}
      />
    )}

    {/* Diálogo de remoção de faixas */}
    {removeDialog && (() => {
      const isPlaylist = !!activePlaylistId;
      const pl = isPlaylist ? playlists.find((p) => p.id === activePlaylistId) : null;
      return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-[#1c1715] border border-white/10 rounded-xl p-6 w-80 shadow-2xl">
            <h3 className="text-sm font-semibold text-[#F5F5F4] mb-1">
              {removeDialog.targets.length === 1
                ? t("table.removeDialogSingle", { name: removeDialog.targets[0].title ?? removeDialog.targets[0].filename })
                : t("table.removeDialogTitle")}
            </h3>
            <p className="text-xs text-[#8F8883] mb-1">
              {isPlaylist && pl
                ? removeDialog.targets.length === 1
                  ? `Remover da playlist "${pl.name}"?`
                  : `Remover ${removeDialog.targets.length} faixas da playlist "${pl.name}"?`
                : t("table.removeDialogMsg", { count: removeDialog.targets.length })}
            </p>
            {isPlaylist && (
              <p className="text-[10px] text-[#4C4743] mb-4">As faixas permanecem na biblioteca.</p>
            )}
            <div className="flex justify-end gap-2 mt-2">
              <button
                className="px-4 py-1.5 text-[12px] text-[#756D67] hover:text-[#C2BEBC] transition-colors rounded-lg hover:bg-white/[0.04]"
                onClick={() => setRemoveDialog(null)}
              >
                {t("common.cancel")}
              </button>
              <button
                className="px-4 py-1.5 text-[12px] font-medium bg-[#D95340] hover:bg-[#E07364] text-white rounded-lg transition-colors"
                onClick={() => {
                  if (isPlaylist && activePlaylistId) {
                    for (const tr of removeDialog.targets) {
                      removeTrackFromPlaylist(activePlaylistId, tr.path);
                    }
                  } else {
                    removeTracks(removeDialog.targets.map((tr) => tr.id));
                  }
                  setRemoveDialog(null);
                }}
              >
                {isPlaylist ? "Remover da playlist" : t("sidebar.removeFromList")}
              </button>
            </div>
          </div>
        </div>
      );
    })()}
    {/* Column drag ghost */}
    {dragGhost && (
      <div
        className="fixed z-[999] pointer-events-none select-none"
        style={{
          left: dragGhost.x + 12,
          top: dragGhost.y - 16,
          transform: "rotate(-2deg)",
        }}
      >
        <div
          className="px-3 py-1.5 rounded-md text-[10px] font-bold uppercase tracking-widest"
          style={{
            background: "#D95340",
            color: "white",
            boxShadow: "0 8px 24px rgba(217,83,64,0.5), 0 2px 8px rgba(0,0,0,0.5)",
            opacity: 0.92,
            letterSpacing: "0.08em",
          }}
        >
          {dragGhost.label}
        </div>
      </div>
    )}

    {/* Column picker context menu */}
    {colCtxMenu && (
      <div
        className="fixed z-[500] rounded-lg shadow-2xl py-1.5 min-w-[160px]"
        style={{
          left: Math.min(colCtxMenu.x, window.innerWidth - 180),
          top: Math.min(colCtxMenu.y, window.innerHeight - 320),
          background: "#1c1715",
          border: "1px solid rgba(255,255,255,0.08)",
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <p className="px-3 py-1 text-[9px] font-bold uppercase tracking-widest text-[#4C4743] mb-0.5">
          Colunas visíveis
        </p>
        {([
          { id: "num",           label: t("settings.columns.colNum")      },
          { id: "favorite",      label: t("settings.columns.colFav")      },
          { id: "onda",          label: t("settings.columns.colWave")     },
          { id: "capa",          label: t("settings.columns.colCover")    },
          { id: "album",         label: t("settings.columns.colAlbum")    },
          { id: "genre",         label: t("settings.columns.colGenre")    },
          { id: "artist",        label: t("settings.columns.colArtist")   },
          { id: "year_col",      label: t("settings.columns.colYear")     },
          { id: "status",        label: t("settings.columns.colStatus")   },
          { id: "key",           label: t("settings.columns.colKey")      },
          { id: "bpm",           label: t("settings.columns.colBpm")      },
          { id: "rating",        label: t("settings.columns.colRating")   },
          { id: "cue_points",    label: t("settings.columns.colCue")      },
          { id: "duration_secs", label: t("settings.columns.colDuration") },
          { id: "file_size",     label: t("settings.columns.colSize")     },
          { id: "bitrate",       label: t("settings.columns.colBitrate")  },
          { id: "tipo",          label: t("settings.columns.colType")     },
          { id: "adicionada",    label: t("settings.columns.colAdded")    },
          { id: "comment",       label: t("settings.columns.colComment")  },
        ] as const).map(({ id, label }) => {
          const visible = mergedVisibility[id] !== false;
          return (
            <button
              key={id}
              onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); }}
              onClick={() => {
                const next = { ...mergedVisibility, [id]: !visible };
                setColumnVisibility(next);
              }}
              className="w-full flex items-center gap-2.5 px-3 py-1.5 text-left text-[12px] transition-colors hover:bg-white/[0.06]"
              style={{ color: visible ? "#C2BEBC" : "#605A55" }}
            >
              <span
                className="w-3.5 h-3.5 rounded shrink-0 flex items-center justify-center"
                style={{
                  background: visible ? "#D95340" : "transparent",
                  border: visible ? "1px solid #D95340" : "1px solid rgba(255,255,255,0.15)",
                }}
              >
                {visible && (
                  <svg width="8" height="6" viewBox="0 0 8 6" fill="none" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1 3l2 2 4-4"/>
                  </svg>
                )}
              </span>
              {label}
            </button>
          );
        })}
      </div>
    )}
    </>
  );
}
