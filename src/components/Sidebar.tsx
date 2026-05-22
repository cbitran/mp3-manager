import { useAppStore } from "../store";

const NAV_ITEMS = [
  { id: "library", label: "Biblioteca", icon: "🎵" },
  { id: "duplicates", label: "Duplicatas", icon: "⚡" },
  { id: "export", label: "Exportar", icon: "📤" },
];

interface SidebarProps {
  onFolderSelect: (folder: string) => void;
}

export default function Sidebar({ onFolderSelect }: SidebarProps) {
  const { tracks, favoriteFolders, lastFolder, toggleFavorite } = useAppStore();

  const currentFolderName = lastFolder?.split("/").pop() ?? null;
  const isFavorite = lastFolder ? favoriteFolders.includes(lastFolder) : false;

  return (
    <div className="w-52 shrink-0 flex flex-col border-r border-white/[0.06] bg-[#17171c] overflow-y-auto">
      {/* Pasta atual */}
      {lastFolder && (
        <div className="px-3 pt-3 pb-2">
          <p className="text-[10px] font-semibold text-gray-600 uppercase tracking-widest mb-1.5">
            Pasta atual
          </p>
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-gray-400 truncate flex-1" title={lastFolder}>
              📁 {currentFolderName}
            </span>
            <button
              onClick={() => toggleFavorite(lastFolder)}
              title={isFavorite ? "Remover dos favoritos" : "Adicionar aos favoritos"}
              className="shrink-0 text-sm hover:scale-110 transition-transform"
            >
              {isFavorite ? "★" : "☆"}
            </button>
          </div>
        </div>
      )}

      {lastFolder && <div className="h-px bg-white/[0.06] mx-3 my-1" />}

      {/* Seção Nav */}
      <div className="px-2 pt-2 pb-2">
        <p className="px-2 mb-1 text-[10px] font-semibold text-gray-600 uppercase tracking-widest">
          Navegação
        </p>
        {NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-sm text-gray-400 hover:text-gray-200 hover:bg-white/5 transition-colors text-left"
          >
            <span className="text-base">{item.icon}</span>
            {item.label}
          </button>
        ))}
      </div>

      <div className="h-px bg-white/[0.06] mx-3 my-1" />

      {/* Favoritos */}
      <div className="px-2 pt-2">
        <p className="px-2 mb-1 text-[10px] font-semibold text-gray-600 uppercase tracking-widest">
          Favoritos
        </p>
        {favoriteFolders.length === 0 ? (
          <p className="px-2 py-2 text-xs text-gray-700 italic">
            Nenhuma pasta favorita
          </p>
        ) : (
          favoriteFolders.map((f) => (
            <button
              key={f}
              onClick={() => onFolderSelect(f)}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs text-gray-500 hover:text-gray-300 hover:bg-white/5 transition-colors text-left truncate"
              title={f}
            >
              📁 {f.split("/").pop()}
            </button>
          ))
        )}
      </div>

      {/* Footer stats */}
      <div className="mt-auto px-4 py-3 border-t border-white/[0.06]">
        <p className="text-[11px] text-gray-600">
          {tracks.length.toLocaleString("pt-BR")} faixas
        </p>
        <p className="text-[11px] text-gray-700">
          {(tracks.reduce((s, t) => s + t.file_size_bytes, 0) / 1024 / 1024 / 1024).toFixed(2)} GB
        </p>
      </div>
    </div>
  );
}
