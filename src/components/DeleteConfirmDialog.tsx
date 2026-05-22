import { invoke } from "@tauri-apps/api/core";
import { useAppStore, type Track } from "../store";

interface Props {
  tracks: Track[];
  onClose: () => void;
}

export default function DeleteConfirmDialog({ tracks, onClose }: Props) {
  const { setTracks, clearSelection } = useAppStore();
  const allTracks = useAppStore((s) => s.tracks);

  const title =
    tracks.length === 1
      ? `Excluir "${tracks[0].title || tracks[0].filename}"?`
      : `Excluir ${tracks.length} faixas?`;

  const subtitle =
    tracks.length === 1
      ? "Escolha se quer apagar o arquivo do disco ou apenas removê-lo desta lista."
      : `Escolha se quer apagar os ${tracks.length} arquivos do disco ou apenas removê-los desta lista.`;

  async function handleTrash() {
    for (const t of tracks) {
      await invoke("trash_file", { path: t.path }).catch(() => {});
    }
    removeFromState();
  }

  function removeFromState() {
    const ids = new Set(tracks.map((t) => t.id));
    setTracks(allTracks.filter((t) => !ids.has(t.id)));
    clearSelection();
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: "rgba(0,0,0,0.6)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-[#2a2a32] border border-white/10 rounded-xl shadow-2xl w-96 p-6 flex flex-col gap-4">
        <div>
          <h2 className="text-sm font-semibold text-white">{title}</h2>
          <p className="text-xs text-gray-500 mt-1">{subtitle}</p>
        </div>

        <div className="flex flex-col gap-2">
          <button
            onClick={handleTrash}
            className="w-full py-2.5 rounded-lg bg-red-600/90 hover:bg-red-500 text-white text-sm font-semibold transition-colors"
          >
            🗑 Mover para a Lixeira
          </button>
          <button
            onClick={removeFromState}
            className="w-full py-2.5 rounded-lg bg-white/8 hover:bg-white/12 text-gray-200 text-sm font-medium transition-colors border border-white/10"
          >
            Remover da Lista
          </button>
          <button
            onClick={onClose}
            className="w-full py-2 text-gray-500 hover:text-gray-300 text-sm transition-colors"
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}
