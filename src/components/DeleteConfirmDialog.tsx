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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-[#1c1715] border border-white/10 rounded-xl w-[360px] shadow-2xl">

        {/* Header */}
        <div className="px-5 py-4 border-b border-white/[0.06] flex items-center gap-2.5">
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="#D95340" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6.5 1.5L11.5 10.5H1.5L6.5 1.5z"/><path d="M6.5 5v2.5M6.5 9.5v.1"/>
          </svg>
          <h2 className="text-sm font-semibold text-[#E8E4E1]">{title}</h2>
        </div>

        {/* Body */}
        <div className="px-5 py-4">
          <p className="text-[12px] text-[#8F8883] leading-relaxed">{subtitle}</p>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-white/[0.06]">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-[12px] text-[#756D67] hover:text-[#C2BEBC] transition-colors rounded-lg hover:bg-white/[0.04]"
          >
            {t("common.cancel")}
          </button>
          <button
            onClick={removeFromState}
            className="px-4 py-1.5 text-[12px] text-[#756D67] hover:text-[#C2BEBC] transition-colors rounded-lg hover:bg-white/[0.04]"
          >
            {t("sidebar.removeFromList")}
          </button>
          <button
            onClick={handleTrash}
            className="px-4 py-1.5 text-[12px] font-medium bg-[#D95340] hover:bg-[#E07364] text-white rounded-lg transition-colors"
          >
            {t("sidebar.moveToTrash")}
          </button>
        </div>
      </div>
    </div>
  );
}
