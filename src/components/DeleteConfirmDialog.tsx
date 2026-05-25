import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { useAppStore, type Track } from "../store";

interface Props {
  tracks: Track[];
  onClose: () => void;
}

export default function DeleteConfirmDialog({ tracks, onClose }: Props) {
  const { t } = useTranslation();
  const { setTracks, clearSelection, recentFolders, removeRecentFolder, lastFolder, setLastFolder } = useAppStore();
  const allTracks = useAppStore((s) => s.tracks);

  const title =
    tracks.length === 1
      ? t("table.deleteTitle", { name: tracks[0].title || tracks[0].filename })
      : t("table.deleteTitleCount", { count: tracks.length });

  const subtitle =
    tracks.length === 1
      ? t("table.deleteMsg")
      : t("table.deleteMsgCount", { count: tracks.length });

  async function handleTrash() {
    for (const t of tracks) {
      await invoke("trash_file", { path: t.path }).catch(() => {});
    }
    removeFromState();
  }

  function removeFromState() {
    const ids = new Set(tracks.map((t) => t.id));
    const remaining = allTracks.filter((t) => !ids.has(t.id));
    setTracks(remaining);
    clearSelection();

    // Se uma pasta ficou sem nenhuma faixa, remove-a dos recentes
    for (const folder of recentFolders) {
      const hasTrack = remaining.some((t) => t.path.startsWith(folder));
      if (!hasTrack) {
        removeRecentFolder(folder);
        if (lastFolder === folder) setLastFolder(null);
      }
    }

    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-[#23201E] border border-white/[0.07] rounded-xl shadow-2xl w-96 overflow-hidden">

        {/* Header */}
        <div className="px-5 pt-5 pb-4 border-b border-white/[0.05]">
          <div className="flex items-center gap-2 mb-1">
            <span className="w-1.5 h-1.5 rounded-full bg-[#D95340] shrink-0" />
            <h2 className="text-[13px] font-semibold text-[#F5F5F4]">{title}</h2>
          </div>
          <p className="text-xs text-[#605A55] leading-relaxed pl-3.5">{subtitle}</p>
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-2 p-4">
          <button
            onClick={handleTrash}
            className="w-full py-2.5 rounded-lg bg-[#D95340] hover:bg-[#E07364] active:bg-[#B34435] text-white text-[13px] font-semibold transition-colors uppercase tracking-wide"
          >
            {t("sidebar.moveToTrash")}
          </button>
          <button
            onClick={removeFromState}
            className="w-full py-2.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.07] text-[#C2BEBC] text-[13px] font-medium transition-colors border border-white/[0.07]"
          >
            {t("sidebar.removeFromList")}
          </button>
          <button
            onClick={onClose}
            className="w-full py-2 text-[#373331] hover:text-[#605A55] text-[12px] transition-colors"
          >
            {t("common.cancel")}
          </button>
        </div>
      </div>
    </div>
  );
}
