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

import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore, type Track } from "../store";
import { setAutoPlayOnLoad } from "../store";
import WaveformCell from "./WaveformCell";

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
  const sat = isMinor ? 68 : 52;
  const bri = isMinor ? 40 : 48;
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
  return isNaN(n) ? bpm : n.toFixed(2);
}

// ---------------------------------------------------------------------------

function CoverCell({ path, hasCover }: { path: string; hasCover: boolean }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!hasCover) { setSrc(null); return; }
    invoke<string | null>("read_cover_base64", { path })
      .then((b64) => setSrc(b64 ? `data:image/jpeg;base64,${b64}` : null))
      .catch(() => setSrc(null));
  }, [path, hasCover]);
  if (!src) return (
    <div className="w-7 h-7 rounded-sm bg-white/[0.04] border border-white/[0.05] flex items-center justify-center">
      <svg width="9" height="9" viewBox="0 0 11 11" fill="currentColor" className="text-[#373331]"><path d="M1 2.5A1.5 1.5 0 012.5 1h6A1.5 1.5 0 0110 2.5v6A1.5 1.5 0 018.5 10h-6A1.5 1.5 0 011 8.5v-6zM4 4a1 1 0 100-2 1 1 0 000 2zm-2 4l2-2 1 1 2-3 2 4H2z"/></svg>
    </div>
  );
  return <img src={src} alt="" className="w-7 h-7 rounded-sm object-cover shrink-0" />;
}

export default function TrackTable({
  tracks,
  compact = false,
  hasFolder = false,
}: {
  tracks: Track[];
  compact?: boolean;
  hasFolder?: boolean;
}) {
  const {
    selectedIds,
    toggleSelect,
    selectAll,
    clearSelection,
    tracks: allTracks,
    toggleTrackFavorite,
    favoriteTrackPaths,
    setPlayerTrack,
    playerTrackId,
    columnVisibility,
    setColumnVisibility,
  } = useAppStore();

  const anchorIdRef = useRef<string | null>(null);
  const sortedRowsRef = useRef<Array<{id: string}>>([]);

  const [sorting, setSorting] = useState<SortingState>(() => {
    try {
      const saved = localStorage.getItem("tagwave_sort");
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });

  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>(() => {
    try { return JSON.parse(localStorage.getItem("tagwave_col_sizes") ?? "{}"); }
    catch { return {}; }
  });

  const [columnOrder, setColumnOrder] = useState<ColumnOrderState>(() => {
    try {
      const saved = localStorage.getItem("tagwave_col_order");
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  const dragColIdRef = useRef<string | null>(null);
  const [dragOverColId, setDragOverColId] = useState<string | null>(null);

  const DEFAULT_VISIBILITY: VisibilityState = {
    tipo: false,
    adicionada: false,
    comment: false,
  };

  const mergedVisibility: VisibilityState = { ...DEFAULT_VISIBILITY, ...columnVisibility };

  const [showColPicker, setShowColPicker] = useState(false);
  const colPickerRef = useRef<HTMLDivElement>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; track: Track } | null>(null);
  const contextRef = useRef<HTMLDivElement>(null);

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
        enableHiding: false,
        header: () => null,
        cell: ({ row }) => (
          <button
            onClick={(e) => { e.stopPropagation(); toggleTrackFavorite(row.original.path); }}
            className={`leading-none transition-colors ${
              favoriteTrackPaths.has(row.original.path)
                ? "text-[#D95340]"
                : "text-[#4C4743] hover:text-[#8F8883]"
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
            checked={table.getIsAllRowsSelected()}
            onChange={table.getToggleAllRowsSelectedHandler()}
          />
        ),
        cell: ({ row }) => (
          <input
            type="checkbox"
            checked={row.getIsSelected()}
            onChange={row.getToggleSelectedHandler()}
            onClick={(e) => e.stopPropagation()}
          />
        ),
        size: 32,
      }),

      // CAPA
      col.display({
        id: "capa",
        header: () => <span className="text-[9px] font-bold text-[#8F8883] uppercase tracking-widest">Capa</span>,
        cell: ({ row }) => <CoverCell path={row.original.path} hasCover={row.original.has_cover} />,
        size: 44,
        enableResizing: false,
      }),

      // TÍTULO / ARTISTA (stacked com cleanup badge inline)
      col.accessor("title", {
        id: "title_artist",
        enableHiding: false,
        header: "TÍTULO / ARTISTA",
        cell: ({ getValue, row }) => {
          const title = getValue();
          const { artist, filename, issues } = row.original;
          const hasIssues = issues.length > 0;
          return (
            <div className="min-w-0">
              <div className="flex items-start gap-2 min-w-0">
                <span className={`leading-snug [overflow-wrap:anywhere] ${
                  title
                    ? "text-[13px] font-medium text-[#F5F5F4]"
                    : "text-xs italic text-[#4C4743]"
                }`}>
                  {title ?? filename}
                </span>
                {hasIssues && (
                  <span className="shrink-0 mt-px px-1.5 py-px rounded-sm text-[9px] font-bold uppercase tracking-widest bg-[#D95340]/20 text-[#D95340] leading-tight">
                    limpar
                  </span>
                )}
              </div>
              {artist && (
                <div className="text-[11px] text-[#8F8883] mt-px leading-snug [overflow-wrap:anywhere]">
                  {artist}
                </div>
              )}
            </div>
          );
        },
        size: 280,
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
      }),

      // GÊNERO
      col.accessor("genre", {
        header: "Gênero",
        cell: (i) =>
          i.getValue() ? (
            <span className="inline-block px-1.5 py-px rounded-sm text-[10px] uppercase tracking-wide bg-white/[0.06] text-[#a09890]">
              {i.getValue()}
            </span>
          ) : (
            <span className="text-[#605A55] text-xs">—</span>
          ),
        size: 110,
      }),

      // ARTISTA standalone
      col.accessor("artist", {
        id: "artist",
        header: "Artista",
        cell: (i) =>
          i.getValue() ? (
            <span className="text-[11px] text-[#8F8883] truncate">{i.getValue()}</span>
          ) : (
            <span className="text-[#605A55] text-xs">—</span>
          ),
        size: 140,
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
        size: 56,
      }),

      // STATUS ●
      col.accessor("issues", {
        id: "status",
        header: "●",
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
        size: 36,
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
        size: 56,
      }),

      // WAVE
      col.display({
        id: "waveform",
        header: "Onda",
        cell: ({ row }) => <WaveformCell path={row.original.path} />,
        size: 110,
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
        size: 60,
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
              className={`text-[12px] font-mono tabular-nums flex items-center gap-1 ${
                compat ? "text-[#5BA055] font-bold" : "text-[#c9bfb8]"
              }`}
            >
              {compat && (
                <span className="w-1 h-1 rounded-full bg-[#5BA055] inline-block shrink-0" />
              )}
              {formatBPM(val)}
            </span>
          );
        },
        size: 72,
      }),

      // RATING
      col.accessor("rating", {
        header: "★",
        cell: (i) => {
          const r = i.getValue();
          if (!r || r === 0) return <span className="text-[#605A55] text-[10px]">—</span>;
          return (
            <span className="flex gap-px">
              {Array.from({ length: 5 }).map((_, idx) => (
                <svg key={idx} width="8" height="8" viewBox="0 0 12 12" fill={idx < r ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" className={idx < r ? "text-[#D95340]" : "text-[#4C4743]"}>
                  <polygon points="6,1.2 7.5,4.5 11,4.9 8.5,7.3 9.2,10.8 6,9 2.8,10.8 3.5,7.3 1,4.9 4.5,4.5"/>
                </svg>
              ))}
            </span>
          );
        },
        size: 60,
      }),

      // DURAÇÃO
      col.accessor("duration_secs", {
        header: "Duração",
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
        size: 60,
      }),

      // TIPO (formato do arquivo)
      col.accessor("format", {
        id: "tipo",
        header: "Tipo",
        cell: (i) => i.getValue()
          ? <span className="px-1 py-px rounded-sm text-[9px] font-bold uppercase tracking-widest bg-white/[0.04] text-[#605A55]">{i.getValue()}</span>
          : <span className="text-[#605A55] text-xs">—</span>,
        size: 56,
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
        size: 90,
      }),

      // COMENTÁRIO
      col.accessor("comment", {
        id: "comment",
        header: "Comentário",
        cell: (i) =>
          i.getValue() ? (
            <span className="text-[11px] text-[#8F8883] truncate">{i.getValue()}</span>
          ) : (
            <span className="text-[#605A55] text-xs">—</span>
          ),
        size: 160,
      }),
    ],
    [bpmCompatIds, keyCompatIds, favoriteTrackPaths, toggleTrackFavorite]
  );

  const rowSelection = Object.fromEntries([...selectedIds].map((id) => [id, true]));

  const table = useReactTable({
    data: tracks,
    columns,
    state: { sorting, rowSelection, columnVisibility: mergedVisibility, columnSizing, columnOrder },
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
    onRowSelectionChange: (updater) => {
      const next = typeof updater === "function" ? updater(rowSelection) : updater;
      const added = Object.keys(next).filter((id) => next[id] && !rowSelection[id]);
      const removed = Object.keys(rowSelection).filter((id) => !next[id]);
      added.forEach(toggleSelect);
      removed.forEach(toggleSelect);
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

      const rows = sortedRowsRef.current;

      if (e.shiftKey && anchorIdRef.current !== null) {
        const anchorIdx = rows.findIndex((r) => r.id === anchorIdRef.current);
        const from = anchorIdx >= 0 ? anchorIdx : idx;
        const lo = Math.min(from, idx);
        const hi = Math.max(from, idx);
        const rangeIds = rows.slice(lo, hi + 1).map((r) => r.id);
        if (!e.metaKey) clearSelection();
        selectAll(rangeIds);
      } else if (e.metaKey) {
        toggleSelect(id);
        anchorIdRef.current = id;
      } else {
        clearSelection();
        toggleSelect(id);
        anchorIdRef.current = id;
      }
    },
    [toggleSelect, selectAll, clearSelection]
  );

  const handleRowDoubleClick = useCallback(
    (id: string) => {
      setAutoPlayOnLoad();
      setPlayerTrack(id);
    },
    [setPlayerTrack]
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

  if (tracks.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center">
        <img src="/tagwave-icon.png" alt="TagWave" className="w-14 h-14 opacity-10" />
        <p className="text-xs text-[#605A55] uppercase tracking-widest">
          {hasFolder ? "Nenhuma faixa encontrada" : "Abra uma pasta para escanear"}
        </p>
      </div>
    );
  }

  const rowH = compact ? "py-1" : "py-2.5";

  const hideableColumns = table.getAllColumns().filter((c) => c.getCanHide());

  return (
    <>
    <div className="flex-1 overflow-auto select-none">
      <table className="w-full text-sm border-collapse">
        <thead className="sticky top-0 z-10 bg-[#0E0D0C]">
          <tr>
            {/* Row number header */}
            <th className="w-10 px-3 py-2.5 text-right border-b border-white/[0.05]">
              <span className="text-[10px] font-bold text-[#8F8883] uppercase tracking-wider">#</span>
            </th>
            {table.getHeaderGroups()[0]?.headers.map((header) => (
              <th
                key={header.id}
                draggable
                style={{ width: header.getSize(), position: 'relative' }}
                className={`px-3 py-2.5 text-left text-[10px] font-bold text-[#8F8883] uppercase tracking-wider border-b border-white/[0.05] cursor-pointer select-none whitespace-nowrap transition-colors ${
                  dragOverColId === header.id ? 'border-l-2 border-l-[#D95340] bg-white/[0.02]' : ''
                }`}
                onClick={header.column.getToggleSortingHandler()}
                onDragStart={(e) => {
                  dragColIdRef.current = header.id;
                  e.dataTransfer.effectAllowed = "move";
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  if (dragOverColId !== header.id) setDragOverColId(header.id);
                }}
                onDragLeave={() => setDragOverColId(null)}
                onDragEnd={() => { setDragOverColId(null); dragColIdRef.current = null; }}
                onDrop={(e) => {
                  e.preventDefault();
                  const from = dragColIdRef.current;
                  const to = header.id;
                  setDragOverColId(null);
                  dragColIdRef.current = null;
                  if (!from || from === to) return;
                  const allIds = table.getAllLeafColumns().map((c) => c.id);
                  const current = columnOrder.length > 0 ? columnOrder : allIds;
                  const fi = current.indexOf(from);
                  const ti = current.indexOf(to);
                  if (fi < 0 || ti < 0) return;
                  const next = [...current];
                  next.splice(fi, 1);
                  next.splice(ti, 0, from);
                  setColumnOrder(next);
                  localStorage.setItem("tagwave_col_order", JSON.stringify(next));
                }}
              >
                <span className="flex items-center gap-1">
                  {flexRender(header.column.columnDef.header, header.getContext())}
                  {header.column.getIsSorted() === "asc" && (
                    <span className="text-[#D95340]">↑</span>
                  )}
                  {header.column.getIsSorted() === "desc" && (
                    <span className="text-[#D95340]">↓</span>
                  )}
                </span>
                {header.column.getCanResize() && (
                  <div
                    onMouseDown={header.getResizeHandler()}
                    onTouchStart={header.getResizeHandler()}
                    className={`absolute top-0 right-0 h-full w-[3px] cursor-col-resize select-none touch-none transition-colors ${
                      header.column.getIsResizing() ? 'bg-[#D95340]' : 'hover:bg-white/[0.15]'
                    }`}
                  />
                )}
              </th>
            ))}
            {/* Column picker button */}
            <th className="border-b border-white/[0.05] pr-2 text-right w-8">
              <div className="relative inline-block" ref={colPickerRef}>
                <button
                  onClick={() => setShowColPicker((v) => !v)}
                  title="Gerenciar colunas"
                  className={`w-6 h-6 flex items-center justify-center rounded transition-colors ${
                    showColPicker
                      ? "bg-white/[0.08] text-[#D95340]"
                      : "text-[#8F8883] hover:text-[#C2BEBC] hover:bg-white/[0.04]"
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
                      {hideableColumns.map((col) => (
                        <label
                          key={col.id}
                          className="flex items-center gap-2.5 px-3 py-1.5 cursor-pointer hover:bg-white/[0.04] transition-colors"
                        >
                          <input
                            type="checkbox"
                            checked={col.getIsVisible()}
                            onChange={col.getToggleVisibilityHandler()}
                            className="accent-[#D95340]"
                          />
                          <span className="text-[11px] text-[#C2BEBC] capitalize">
                            {col.id === "title_artist" ? "Título / Artista"
                              : col.id === "duration_secs" ? "Duração"
                              : col.id === "waveform" ? "Onda"
                              : col.id === "key" ? "Tom"
                              : col.id === "genre" ? "Gênero"
                              : col.id === "album" ? "Álbum"
                              : col.id === "rating" ? "Rating"
                              : col.id === "artist" ? "Artista"
                              : col.id === "year_col" ? "Ano"
                              : col.id === "status" ? "Status"
                              : col.id === "file_size" ? "Tamanho"
                              : col.id === "capa" ? "Capa"
                              : col.id === "tipo" ? "Tipo"
                              : col.id === "adicionada" ? "Adicionada"
                              : col.id === "comment" ? "Comentário"
                              : col.id}
                          </span>
                        </label>
                      ))}
                    </div>
                    <div className="border-t border-white/[0.05] pt-1.5 px-3 mt-0.5">
                      <button
                        onClick={() => {
                          const reset: VisibilityState = {};
                          hideableColumns.forEach((c) => { reset[c.id] = true; });
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
            </th>
          </tr>
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row, i) => {
            const selected = selectedIds.has(row.id);
            const isPlaying = playerTrackId === row.id;
            return (
              <tr
                key={row.id}
                onClick={(e) => handleRowClick(row.id, i, e)}
                onDoubleClick={() => handleRowDoubleClick(row.id)}
                onContextMenu={(e) => handleContextMenu(e, row.original)}
                className={`border-b cursor-pointer transition-all duration-100 ${
                  isPlaying
                    ? "bg-[#D95340]/[0.05] border-[#D95340]/[0.08]"
                    : selected
                    ? "bg-white/[0.035] border-white/[0.04]"
                    : "border-white/[0.03] hover:bg-white/[0.015]"
                }`}
              >
                {/* Row number / playing indicator */}
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
                {row.getVisibleCells().map((cell) => (
                  <td
                    key={cell.id}
                    className={`px-3 ${rowH} max-w-0 overflow-hidden align-top`}
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>

    {/* Context menu */}
    {contextMenu && (
      <div
        ref={contextRef}
        className="fixed z-[200] bg-[#1c1715] border border-white/[0.08] rounded-lg shadow-2xl py-1 min-w-[180px]"
        style={{ left: contextMenu.x, top: contextMenu.y }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          className="w-full px-3 py-1.5 text-left text-[12px] text-[#C2BEBC] hover:bg-white/[0.06] flex items-center gap-2"
          onClick={() => { setPlayerTrack(contextMenu.track.id); setContextMenu(null); }}
        >
          <svg width="11" height="11" viewBox="0 0 11 11" fill="currentColor" className="opacity-60"><path d="M2 1.5l8 4-8 4V1.5z"/></svg>
          Tocar
        </button>
        <button
          className="w-full px-3 py-1.5 text-left text-[12px] text-[#C2BEBC] hover:bg-white/[0.06] flex items-center gap-2"
          onClick={() => {
            invoke("reveal_in_finder", { path: contextMenu.track.path }).catch(() => {});
            setContextMenu(null);
          }}
        >
          <svg width="11" height="11" viewBox="0 0 11 11" fill="currentColor" className="opacity-60"><path d="M1 2h9v7H1V2zm2 2v3h5V4H3z"/></svg>
          Revelar no Finder
        </button>
        <button
          className="w-full px-3 py-1.5 text-left text-[12px] text-[#C2BEBC] hover:bg-white/[0.06] flex items-center gap-2"
          onClick={() => {
            navigator.clipboard.writeText(contextMenu.track.path).catch(() => {});
            setContextMenu(null);
          }}
        >
          <svg width="11" height="11" viewBox="0 0 11 11" fill="currentColor" className="opacity-60"><rect x="3" y="1" width="7" height="8" rx="1"/><rect x="1" y="3" width="7" height="8" rx="1" fill="none" stroke="currentColor" strokeWidth="1"/></svg>
          Copiar Caminho
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
          {favoriteTrackPaths.has(contextMenu.track.path) ? "Remover dos favoritos" : "Adicionar aos favoritos"}
        </button>
      </div>
    )}
    </>
  );
}
