import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  createColumnHelper,
  type SortingState,
} from "@tanstack/react-table";
import { useState, useCallback, useMemo } from "react";
import { useAppStore, type Track } from "../store";

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
  return "hsl(0,0%,35%)";
}

// -- BPM helpers -------------------------------------------------------------

function formatBPM(bpm: string): string {
  const n = parseFloat(bpm);
  return isNaN(n) ? bpm : String(Math.round(n));
}

// ---------------------------------------------------------------------------

export default function TrackTable({
  tracks,
  compact = false,
}: {
  tracks: Track[];
  compact?: boolean;
}) {
  const {
    selectedIds,
    toggleSelect,
    clearSelection,
    tracks: allTracks,
    toggleTrackFavorite,
    favoriteTrackPaths,
  } = useAppStore();

  const [sorting, setSorting] = useState<SortingState>([]);

  // BPM compat: ±6%, half-speed, double-speed
  const bpmCompatIds = useMemo(() => {
    if (selectedIds.size !== 1) return new Set<string>();
    const selId = [...selectedIds][0];
    const sel = allTracks.find((t) => t.id === selId);
    if (!sel?.bpm) return new Set<string>();
    const b = parseFloat(sel.bpm);
    if (isNaN(b) || b <= 0) return new Set<string>();
    const lo = b * 0.94, hi = b * 1.06;
    const hLo = b * 0.47, hHi = b * 0.53;
    const dLo = b * 1.94, dHi = b * 2.06;
    return new Set(
      allTracks
        .filter((t) => t.id !== selId && t.bpm)
        .filter((t) => {
          const v = parseFloat(t.bpm!);
          return (v >= lo && v <= hi) || (v >= hLo && v <= hHi) || (v >= dLo && v <= dHi);
        })
        .map((t) => t.id)
    );
  }, [selectedIds, allTracks]);

  const columns = useMemo(
    () => [
      // ★ Favorito
      col.display({
        id: "favorite",
        header: () => <span className="text-gray-700 text-xs">★</span>,
        cell: ({ row }) => (
          <button
            onClick={(e) => {
              e.stopPropagation();
              toggleTrackFavorite(row.original.path);
            }}
            className={`text-xs leading-none transition-colors ${
              favoriteTrackPaths.has(row.original.path)
                ? "text-yellow-400"
                : "text-gray-700 hover:text-gray-500"
            }`}
          >
            ★
          </button>
        ),
        size: 28,
      }),

      // Checkbox
      col.display({
        id: "select",
        header: ({ table }) => (
          <input
            type="checkbox"
            checked={table.getIsAllRowsSelected()}
            onChange={table.getToggleAllRowsSelectedHandler()}
            className="accent-blue-500"
          />
        ),
        cell: ({ row }) => (
          <input
            type="checkbox"
            checked={row.getIsSelected()}
            onChange={row.getToggleSelectedHandler()}
            className="accent-blue-500"
            onClick={(e) => e.stopPropagation()}
          />
        ),
        size: 36,
      }),

      col.accessor("title", {
        header: "Título",
        cell: (i) =>
          i.getValue() ? (
            <span className="text-gray-100">{i.getValue()}</span>
          ) : (
            <span className="text-gray-700 italic text-xs">sem título</span>
          ),
        size: 240,
      }),

      col.accessor("artist", {
        header: "Artista",
        cell: (i) =>
          i.getValue() ? (
            <span className="text-gray-300">{i.getValue()}</span>
          ) : (
            <span className="text-gray-700 italic text-xs">—</span>
          ),
        size: 180,
      }),

      col.accessor("album", {
        header: "Álbum",
        cell: (i) =>
          i.getValue() ? (
            <span className="text-gray-400">{i.getValue()}</span>
          ) : (
            <span className="text-gray-700 italic text-xs">—</span>
          ),
        size: 160,
      }),

      col.accessor("genre", {
        header: "Gênero",
        cell: (i) =>
          i.getValue() ? (
            <span className="inline-block px-1.5 py-0.5 rounded text-[10px] bg-white/5 text-gray-400">
              {i.getValue()}
            </span>
          ) : (
            <span className="text-gray-700 italic text-xs">—</span>
          ),
        size: 110,
      }),

      col.accessor("year", {
        header: "Ano",
        cell: (i) => (
          <span className="text-gray-500 text-xs">{i.getValue() ?? "—"}</span>
        ),
        size: 60,
      }),

      // Status dot
      col.accessor("issues", {
        header: "●",
        cell: (i) => {
          const n = i.getValue().length;
          return (
            <span
              className={`w-2 h-2 rounded-full inline-block ${
                n === 0 ? "bg-emerald-500" : n > 2 ? "bg-red-500" : "bg-amber-400"
              }`}
              title={n === 0 ? "OK" : i.getValue().join(", ")}
            />
          );
        },
        size: 36,
      }),

      // BPM com compat indicator
      col.accessor("bpm", {
        header: "BPM",
        cell: ({ getValue, row }) => {
          const val = getValue();
          const compat = bpmCompatIds.has(row.id);
          if (!val) return <span className="text-gray-700 text-xs">—</span>;
          return (
            <span
              className={`text-xs font-mono flex items-center gap-1 ${
                compat ? "text-emerald-400 font-semibold" : "text-purple-400"
              }`}
            >
              {compat && (
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block shrink-0" />
              )}
              {formatBPM(val)}
            </span>
          );
        },
        size: 64,
      }),

      // Tom com Camelot Wheel color
      col.accessor("key", {
        header: "Tom",
        cell: (i) => {
          const val = i.getValue();
          if (!val) return <span className="text-gray-700 text-xs">—</span>;
          return (
            <span
              className="inline-block px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold text-white"
              style={{ backgroundColor: camelotColor(val) }}
            >
              {val}
            </span>
          );
        },
        size: 60,
      }),

      col.accessor("duration_secs", {
        header: "Duração",
        cell: (i) => {
          const s = i.getValue();
          if (!s) return <span className="text-gray-700 text-xs">—</span>;
          const m = Math.floor(s / 60);
          const sec = Math.floor(s % 60);
          return (
            <span className="text-gray-500 text-xs font-mono">
              {m}:{sec.toString().padStart(2, "0")}
            </span>
          );
        },
        size: 70,
      }),

      col.accessor("file_size_bytes", {
        header: "MB",
        cell: (i) => (
          <span className="text-gray-600 text-xs">
            {(i.getValue() / 1024 / 1024).toFixed(1)}
          </span>
        ),
        size: 70,
      }),
    ],
    [bpmCompatIds, favoriteTrackPaths, toggleTrackFavorite]
  );

  const rowSelection = Object.fromEntries([...selectedIds].map((id) => [id, true]));

  const table = useReactTable({
    data: tracks,
    columns,
    state: { sorting, rowSelection },
    getRowId: (row) => row.id,
    onSortingChange: setSorting,
    onRowSelectionChange: (updater) => {
      const next = typeof updater === "function" ? updater(rowSelection) : updater;
      const added = Object.keys(next).filter((id) => next[id] && !rowSelection[id]);
      const removed = Object.keys(rowSelection).filter((id) => !next[id]);
      added.forEach(toggleSelect);
      removed.forEach(toggleSelect);
    },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const handleRowClick = useCallback(
    (id: string, e: React.MouseEvent) => {
      if ((e.target as HTMLElement).tagName === "INPUT") return;
      if ((e.target as HTMLElement).tagName === "BUTTON") return;
      if (!e.metaKey && !e.shiftKey) clearSelection();
      toggleSelect(id);
    },
    [toggleSelect, clearSelection]
  );

  if (tracks.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center">
        <div className="text-5xl opacity-20">🎵</div>
        <p className="text-sm text-gray-600">Abra uma pasta para escanear faixas MP3</p>
      </div>
    );
  }

  const rowPad = compact ? "py-0.5" : "py-2";

  return (
    <div className="flex-1 overflow-auto">
      <table className="w-full text-sm border-collapse">
        <thead className="sticky top-0 z-10">
          <tr className="bg-[#1a1a1f]">
            {table.getHeaderGroups()[0]?.headers.map((header) => (
              <th
                key={header.id}
                style={{ width: header.getSize() }}
                className="px-3 py-2 text-left text-[11px] font-semibold text-gray-600 uppercase tracking-wider border-b border-white/[0.06] cursor-pointer select-none whitespace-nowrap"
                onClick={header.column.getToggleSortingHandler()}
              >
                {flexRender(header.column.columnDef.header, header.getContext())}
                {header.column.getIsSorted() === "asc" && (
                  <span className="ml-1 text-blue-400">↑</span>
                )}
                {header.column.getIsSorted() === "desc" && (
                  <span className="ml-1 text-blue-400">↓</span>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row, i) => {
            const selected = selectedIds.has(row.id);
            return (
              <tr
                key={row.id}
                onClick={(e) => handleRowClick(row.id, e)}
                className={`border-b cursor-pointer transition-colors ${
                  selected
                    ? "bg-blue-600/20 border-blue-500/20"
                    : i % 2 === 0
                    ? "border-white/[0.03] hover:bg-white/[0.03]"
                    : "bg-white/[0.015] border-white/[0.03] hover:bg-white/[0.04]"
                }`}
              >
                {row.getVisibleCells().map((cell) => (
                  <td
                    key={cell.id}
                    className={`px-3 ${rowPad} truncate max-w-0 overflow-hidden`}
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
  );
}
