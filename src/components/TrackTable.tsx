import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  createColumnHelper,
  type SortingState,
} from "@tanstack/react-table";
import { useState, useCallback } from "react";
import { useAppStore, type Track } from "../store";

const col = createColumnHelper<Track>();

const columns = [
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
  col.accessor("issues", {
    header: "Status",
    cell: (i) => {
      const issues = i.getValue();
      if (issues.length === 0)
        return (
          <span className="inline-flex items-center gap-1 text-emerald-500 text-xs font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
            OK
          </span>
        );
      return (
        <span
          className="inline-flex items-center gap-1 text-amber-400 text-xs"
          title={issues.join(", ")}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block" />
          {issues.length} problema{issues.length > 1 ? "s" : ""}
        </span>
      );
    },
    size: 110,
  }),
  col.accessor("bpm", {
    header: "BPM",
    cell: (i) =>
      i.getValue() ? (
        <span className="text-purple-400 text-xs font-mono">{i.getValue()}</span>
      ) : (
        <span className="text-gray-700 text-xs">—</span>
      ),
    size: 60,
  }),
  col.accessor("key", {
    header: "Tom",
    cell: (i) =>
      i.getValue() ? (
        <span className="inline-block px-1.5 py-0.5 rounded text-[10px] bg-purple-500/10 text-purple-300 font-mono">
          {i.getValue()}
        </span>
      ) : (
        <span className="text-gray-700 text-xs">—</span>
      ),
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
];

export default function TrackTable({ tracks }: { tracks: Track[] }) {
  const { selectedIds, toggleSelect, clearSelection } = useAppStore();
  const [sorting, setSorting] = useState<SortingState>([]);

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
                    className="px-3 py-2 truncate max-w-0 overflow-hidden"
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
