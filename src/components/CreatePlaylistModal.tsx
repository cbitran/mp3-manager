import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { useTranslation } from "react-i18next";
import { useAppStore, type Track } from "../store";

interface DjSoftwareInfo {
  id: string;
  name: string;
  installed: boolean;
}

interface Props {
  tracks: Track[];
  onClose: () => void;
  exportOnly?: { playlistId: string; playlistName: string };
}

const DJ_LABELS: Record<string, string> = {
  serato:     "Serato DJ Pro",
  rekordbox:  "rekordbox",
  traktor:    "Traktor Pro 3",
  vdj:        "Virtual DJ",
  djay:       "djay Pro (Algoriddim)",
  engine_dj:  "Engine DJ",
  m3u:        "Arquivo M3U",
};

const DJ_ICONS: Record<string, string> = {
  serato:     "S",
  rekordbox:  "R",
  traktor:    "T",
  vdj:        "V",
  djay:       "D",
  engine_dj:  "E",
};

export default function CreatePlaylistModal({ tracks, onClose, exportOnly }: Props) {
  const { t } = useTranslation();
  const [name, setName] = useState(exportOnly?.playlistName ?? "Minha Playlist");
  const [djSoftware, setDjSoftware] = useState<DjSoftwareInfo[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saveToLibrary, setSaveToLibrary] = useState(!exportOnly);
  const [exporting, setExporting] = useState(false);
  const [results, setResults] = useState<Array<{ id: string; path?: string; error?: string }>>([]);
  const [done, setDone] = useState(false);
  const createPlaylist = useAppStore((s) => s.createPlaylist);
  const updatePlaylist  = useAppStore((s) => s.updatePlaylist);

  useEffect(() => {
    invoke<DjSoftwareInfo[]>("detect_dj_software").then((sw) => {
      // Sort: installed first, then not installed
      const sorted = [...sw].sort((a, b) => (b.installed ? 1 : 0) - (a.installed ? 1 : 0));
      setDjSoftware(sorted);
      setSelected(new Set());
    });
  }, []);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleExport = async () => {
    if (!name.trim() || (selected.size === 0 && !saveToLibrary)) return;
    setExporting(true);
    const exportResults: typeof results = [];

    // Save to TagWave library first (skip if exporting existing playlist)
    let playlistId: string | null = exportOnly?.playlistId ?? null;
    if (!exportOnly && saveToLibrary) {
      playlistId = createPlaylist(name.trim(), tracks.map((t) => t.path));
    }

    for (const id of selected) {
      if (id === "m3u") {
        try {
          const savePath = await save({
            defaultPath: `${name.trim()}.m3u`,
            filters: [{ name: "Playlist M3U", extensions: ["m3u"] }],
          });
          if (savePath) {
            await invoke("export_m3u", { tracks, outputPath: savePath });
            exportResults.push({ id, path: savePath });
          }
        } catch (e) {
          exportResults.push({ id, error: String(e) });
        }
        continue;
      }
      try {
        const path = await invoke<string>("export_playlist_to_dj", {
          playlistName: name.trim(),
          softwareId: id,
          tracks,
        });
        exportResults.push({ id, path });
      } catch (e) {
        exportResults.push({ id, error: String(e) });
      }
    }

    setResults(exportResults);
    setDone(true);
    setExporting(false);

    // Update playlist with export info
    if (playlistId && exportResults.length > 0) {
      const exportedTo = exportResults.filter((r) => !r.error).map((r) => r.id);
      if (exportedTo.length > 0) updatePlaylist(playlistId, { lastExportedTo: exportedTo });
    }

    // Auto-open DJ apps that exported successfully (skip m3u)
    for (const r of exportResults) {
      if (!r.error && r.id !== "m3u") {
        try {
          await invoke("open_dj_app", { softwareId: r.id });
        } catch { /* ignore */ }
      }
    }
  };

  // Count label for export button
  const djCount   = [...selected].filter((id) => id !== "m3u").length;
  const hasMpu    = selected.has("m3u");
  const btnLabel  = () => {
    if (exporting) return t("playlist.exporting");
    const parts: string[] = [];
    if (djCount > 0)  parts.push(`${djCount} software${djCount !== 1 ? "s" : ""}`);
    if (hasMpu)       parts.push("M3U");
    return parts.length ? `${t("playlist.exportTo")} ${parts.join(" + ")}` : t("common.apply");
  };

  const renderRow = (id: string, label: string, subtitle: string, isInstalled: boolean, isM3u = false) => {
    const isChecked = selected.has(id);
    return (
      <label
        key={id}
        className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors"
        style={{
          background: isChecked ? "rgba(217,83,64,0.08)" : "rgba(255,255,255,0.02)",
          border: isChecked ? "1px solid rgba(217,83,64,0.25)" : "1px solid rgba(255,255,255,0.05)",
          opacity: isInstalled ? 1 : 0.45,
        }}
      >
        <input
          type="checkbox"
          className="sr-only"
          checked={isChecked}
          onChange={() => toggle(id)}
          disabled={!isInstalled && !isM3u}
        />
        <div
          className="w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-all"
          style={{
            borderColor: isChecked ? "#D95340" : "rgba(255,255,255,0.12)",
            background: isChecked ? "#D95340" : "transparent",
          }}
        >
          {isChecked && (
            <svg width="9" height="7" viewBox="0 0 9 7" fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M1 3.5L3.5 6L8 1"/>
            </svg>
          )}
        </div>
        <div className="relative shrink-0">
          <div
            className="w-6 h-6 rounded flex items-center justify-center text-[10px] font-bold"
            style={{ background: "rgba(255,255,255,0.06)", color: "#8F8883" }}
          >
            {isM3u ? (
              <svg width="11" height="13" viewBox="0 0 11 13" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M1.5 1.5h5.5l2.5 2.5v8H1.5V1.5z"/>
                <path d="M7 1.5V4h2.5"/>
                <line x1="3" y1="7" x2="8" y2="7"/>
                <line x1="3" y1="9" x2="6" y2="9"/>
              </svg>
            ) : DJ_ICONS[id]}
          </div>
          {isInstalled && !isM3u && (
            <div
              className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2"
              style={{ background: "#5BA055", borderColor: "#1c1715" }}
            />
          )}
        </div>
        <div className="flex-1">
          <p className="text-[12px] font-medium" style={{ color: "#C2BEBC" }}>{label}</p>
          <p className="text-[10px]" style={{ color: isInstalled || isM3u ? "#5BA055" : "#605A55" }}>
            {subtitle}
          </p>
        </div>
      </label>
    );
  };

  return (
    <div
      className="fixed inset-0 z-[500] flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.65)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="rounded-xl shadow-2xl w-[420px] overflow-hidden"
        style={{ background: "#1c1715", border: "1px solid rgba(255,255,255,0.08)" }}
      >
        {/* Header */}
        <div className="px-5 pt-5 pb-4" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
          <h2 className="text-[14px] font-semibold" style={{ color: "#F5F5F4" }}>
            {exportOnly ? t("playlist.export") : t("playlist.create")}
          </h2>
          <p className="text-[11px] mt-0.5" style={{ color: "#605A55" }}>
            {t("playlist.tracksSelected", { count: tracks.length })}
          </p>
        </div>

        {done ? (
          /* Results screen */
          <div className="px-5 py-5 space-y-3">
            {results.map((r) => (
              <div key={r.id} className="flex items-start gap-3">
                <div
                  className="w-7 h-7 rounded-md flex items-center justify-center text-[11px] font-bold shrink-0"
                  style={{ background: r.error ? "rgba(217,83,64,0.15)" : "rgba(91,160,85,0.15)", color: r.error ? "#D95340" : "#5BA055" }}
                >
                  {r.error ? "!" : "✓"}
                </div>
                <div>
                  <p className="text-[12px] font-medium" style={{ color: "#C2BEBC" }}>
                    {DJ_LABELS[r.id] ?? r.id}
                  </p>
                  {r.path && (
                    <p className="text-[10px] mt-0.5 break-all" style={{ color: "#605A55" }}>{r.path}</p>
                  )}
                  {r.error && (
                    <p className="text-[10px] mt-0.5" style={{ color: "#D95340" }}>{r.error}</p>
                  )}
                </div>
              </div>
            ))}
            <div className="pt-2">
              <p className="text-[10px]" style={{ color: "#4C4743" }}>
                {results.some((r) => !r.error && r.id !== "m3u")
                  ? t("playlist.djOpenedAuto")
                  : t("playlist.exportDone")}
              </p>
            </div>
            <button
              onClick={onClose}
              className="w-full mt-2 py-2 rounded-lg text-[12px] font-semibold"
              style={{ background: "#D95340", color: "white" }}
            >
              {t("common.close")}
            </button>
          </div>
        ) : (
          /* Export form */
          <div className="px-5 py-4 space-y-4">
            {/* Playlist name */}
            <div>
              <label className="text-[10px] font-bold uppercase tracking-widest block mb-1.5" style={{ color: "#8F8883" }}>
                {t("playlist.nameLabel")}
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("playlist.namePlaceholder")}
                className="w-full px-3 py-2 rounded-lg text-[13px] outline-none"
                style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", color: "#F5F5F4" }}
                onFocus={(e) => { e.target.style.border = "1px solid rgba(217,83,64,0.5)"; }}
                onBlur={(e) => { e.target.style.border = "1px solid rgba(255,255,255,0.08)"; }}
              />
            </div>

            {/* Save to library toggle — hidden when exporting an existing playlist */}
            {!exportOnly && <label className="flex items-center gap-2.5 px-3 py-2 rounded-lg cursor-pointer transition-colors"
              style={{
                background: saveToLibrary ? "rgba(217,83,64,0.08)" : "rgba(255,255,255,0.02)",
                border: saveToLibrary ? "1px solid rgba(217,83,64,0.25)" : "1px solid rgba(255,255,255,0.05)",
              }}
            >
              <div
                className="w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-all"
                style={{
                  borderColor: saveToLibrary ? "#D95340" : "rgba(255,255,255,0.12)",
                  background: saveToLibrary ? "#D95340" : "transparent",
                }}
                onClick={() => setSaveToLibrary((v) => !v)}
              >
                {saveToLibrary && (
                  <svg width="9" height="7" viewBox="0 0 9 7" fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1 3.5L3.5 6L8 1"/>
                  </svg>
                )}
              </div>
              <div className="flex-1">
                <p className="text-[12px] font-medium" style={{ color: "#C2BEBC" }}>{t("playlist.saveToLibrary")}</p>
                <p className="text-[10px]" style={{ color: "#605A55" }}>{t("playlist.saveToLibraryDesc")}</p>
              </div>
            </label>}

            {/* Software list */}
            <div>
              <label className="text-[10px] font-bold uppercase tracking-widest block mb-2" style={{ color: "#8F8883" }}>
                {t("playlist.exportTo")}
              </label>
              <div className="space-y-1.5">
                {djSoftware.map((sw) => renderRow(sw.id, sw.name, sw.installed ? t("settings.services.installed") : t("settings.services.notFound"), sw.installed))}
                {/* Separador antes do M3U */}
                {djSoftware.length > 0 && (
                  <div className="h-px my-0.5" style={{ background: "rgba(255,255,255,0.05)" }} />
                )}
                {renderRow("m3u", "Arquivo M3U", t("playlist.m3uSubtitle"), true, true)}
              </div>
            </div>

            {/* Note */}
            <p className="text-[10px]" style={{ color: "#4C4743" }}>
              {[...selected].some((id) => id !== "m3u") ? t("playlist.djOpenNote") : t("playlist.chooseExport")}
            </p>

            {/* Actions */}
            <div className="flex gap-2 pt-1">
              <button
                onClick={onClose}
                className="flex-1 py-2 rounded-lg text-[12px] font-semibold transition-colors"
                style={{ background: "rgba(255,255,255,0.06)", color: "#8F8883" }}
              >
                {t("common.cancel")}
              </button>
              <button
                onClick={handleExport}
                disabled={exporting || !name.trim() || (exportOnly ? selected.size === 0 : (!saveToLibrary && selected.size === 0))}
                className="flex-1 py-2 rounded-lg text-[12px] font-semibold transition-colors disabled:opacity-40"
                style={{ background: "#D95340", color: "white" }}
              >
                {exporting ? t("playlist.exporting") : (!exportOnly && saveToLibrary && selected.size === 0) ? t("playlist.save") : btnLabel()}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
