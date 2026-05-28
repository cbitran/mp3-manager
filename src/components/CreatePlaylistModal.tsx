import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save, open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { useTranslation } from "react-i18next";
import { useAppStore, type Track, type PlaylistGlobalProperties } from "../store";

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

type FieldKey = "cover" | "album" | "genre" | "comment";

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

// ── Create mode ──────────────────────────────────────────────────────────────

function CreateMode({ tracks, onClose }: { tracks: Track[]; onClose: () => void }) {
  const { t } = useTranslation();
  const createPlaylist = useAppStore((s) => s.createPlaylist);
  const updatePlaylist = useAppStore((s) => s.updatePlaylist);
  const setActivePlaylistId = useAppStore((s) => s.setActivePlaylistId);

  const [name, setName] = useState("Minha Playlist");
  const [props, setProps] = useState<PlaylistGlobalProperties>({ enabled: false, activeFields: [] });

  const toggleField = (field: FieldKey) => {
    setProps((p) => ({
      ...p,
      activeFields: p.activeFields.includes(field)
        ? p.activeFields.filter((f) => f !== field)
        : [...p.activeFields, field],
    }));
  };

  const handlePickCover = async () => {
    const path = await openFileDialog({
      filters: [{ name: "Imagens", extensions: ["jpg", "jpeg", "png"] }],
      multiple: false,
    });
    if (path && typeof path === "string") {
      setProps((p) => ({
        ...p,
        cover: path,
        activeFields: p.activeFields.includes("cover") ? p.activeFields : [...p.activeFields, "cover"],
      }));
    }
  };

  const handleSave = () => {
    if (!name.trim()) return;
    const id = createPlaylist(name.trim(), tracks.map((t) => t.path));
    if (props.enabled && props.activeFields.length > 0) {
      updatePlaylist(id, { globalProperties: props });
    }
    setActivePlaylistId(id);
    onClose();
  };

  const coverName = props.cover ? props.cover.split(/[\\/]/).pop() : null;

  return (
    <>
      {/* Header */}
      <div className="px-5 pt-5 pb-4" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        <h2 className="text-[14px] font-semibold" style={{ color: "#F5F5F4" }}>
          {t("playlist.create")}
        </h2>
        {tracks.length > 0 && (
          <p className="text-[11px] mt-0.5" style={{ color: "#605A55" }}>
            {t("playlist.tracksSelected", { count: tracks.length })}
          </p>
        )}
      </div>

      <div className="px-5 py-4 space-y-4 max-h-[70vh] overflow-y-auto no-scrollbar">
        {/* Nome */}
        <div>
          <label className="text-[10px] font-bold uppercase tracking-widest block mb-1.5" style={{ color: "#8F8883" }}>
            {t("playlist.nameLabel")}
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("playlist.namePlaceholder")}
            autoFocus
            onKeyDown={(e) => e.key === "Enter" && handleSave()}
            className="w-full px-3 py-2 rounded-lg text-[13px] outline-none"
            style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", color: "#F5F5F4" }}
            onFocus={(e) => { e.target.style.border = "1px solid rgba(217,83,64,0.5)"; }}
            onBlur={(e) => { e.target.style.border = "1px solid rgba(255,255,255,0.08)"; }}
          />
        </div>

        {/* Propriedades Globais */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "#8F8883" }}>
                Propriedades Globais
              </p>
              <p className="text-[10px] mt-0.5" style={{ color: "#4C4743" }}>
                Faixas adicionadas recebem automaticamente os campos ativos
              </p>
            </div>
            <button
              onClick={() => setProps((p) => ({ ...p, enabled: !p.enabled }))}
              className={`relative inline-flex w-9 h-5 rounded-full transition-colors flex-shrink-0 ${
                props.enabled ? "bg-[#D95340]" : "bg-white/[0.12]"
              }`}
            >
              <span
                className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-all duration-150 ${
                  props.enabled ? "left-[18px]" : "left-0.5"
                }`}
              />
            </button>
          </div>

          {props.enabled && (
            <div className="flex flex-col gap-3">
              <FieldRow active={props.activeFields.includes("cover")} onToggle={() => toggleField("cover")} label="Capa">
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <span className="flex-1 text-[11px] truncate" style={{ color: "#8F8883" }}>
                    {coverName ?? "Nenhuma imagem"}
                  </span>
                  <button
                    onClick={handlePickCover}
                    className="text-[10px] px-2 py-0.5 rounded whitespace-nowrap flex-shrink-0 transition-colors"
                    style={{ background: "rgba(255,255,255,0.06)", color: "#8F8883" }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.10)")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.06)")}
                  >
                    Escolher…
                  </button>
                </div>
              </FieldRow>

              <FieldRow active={props.activeFields.includes("album")} onToggle={() => toggleField("album")} label="Álbum">
                <input
                  type="text"
                  value={props.album ?? ""}
                  onChange={(e) => setProps((p) => ({ ...p, album: e.target.value }))}
                  placeholder="Nome do álbum"
                  className="flex-1 w-full bg-transparent border-b pb-0.5 text-[12px] focus:outline-none"
                  style={{ borderColor: "rgba(255,255,255,0.08)", color: "#C2BEBC" }}
                  onFocus={(e) => (e.target.style.borderColor = "rgba(217,83,64,0.5)")}
                  onBlur={(e) => (e.target.style.borderColor = "rgba(255,255,255,0.08)")}
                />
              </FieldRow>

              <FieldRow active={props.activeFields.includes("genre")} onToggle={() => toggleField("genre")} label="Gênero">
                <input
                  type="text"
                  value={props.genre ?? ""}
                  onChange={(e) => setProps((p) => ({ ...p, genre: e.target.value }))}
                  placeholder="Ex: House, Techno"
                  className="flex-1 w-full bg-transparent border-b pb-0.5 text-[12px] focus:outline-none"
                  style={{ borderColor: "rgba(255,255,255,0.08)", color: "#C2BEBC" }}
                  onFocus={(e) => (e.target.style.borderColor = "rgba(217,83,64,0.5)")}
                  onBlur={(e) => (e.target.style.borderColor = "rgba(255,255,255,0.08)")}
                />
              </FieldRow>

              <FieldRow active={props.activeFields.includes("comment")} onToggle={() => toggleField("comment")} label="Comentário">
                <input
                  type="text"
                  value={props.comment ?? ""}
                  onChange={(e) => setProps((p) => ({ ...p, comment: e.target.value }))}
                  placeholder="Comentário"
                  className="flex-1 w-full bg-transparent border-b pb-0.5 text-[12px] focus:outline-none"
                  style={{ borderColor: "rgba(255,255,255,0.08)", color: "#C2BEBC" }}
                  onFocus={(e) => (e.target.style.borderColor = "rgba(217,83,64,0.5)")}
                  onBlur={(e) => (e.target.style.borderColor = "rgba(255,255,255,0.08)")}
                />
              </FieldRow>
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="flex gap-2 px-5 py-3.5" style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
        <button
          onClick={onClose}
          className="flex-1 py-2 rounded-lg text-[12px] font-semibold transition-colors"
          style={{ background: "rgba(255,255,255,0.06)", color: "#8F8883" }}
        >
          {t("common.cancel")}
        </button>
        <button
          onClick={handleSave}
          disabled={!name.trim()}
          className="flex-1 py-2 rounded-lg text-[12px] font-semibold transition-colors disabled:opacity-40"
          style={{ background: "#D95340", color: "white" }}
        >
          {t("playlist.save")}
        </button>
      </div>
    </>
  );
}

// ── Export mode ───────────────────────────────────────────────────────────────

function ExportMode({ tracks, onClose, exportOnly }: { tracks: Track[]; onClose: () => void; exportOnly: { playlistId: string; playlistName: string } }) {
  const { t } = useTranslation();
  const updatePlaylist = useAppStore((s) => s.updatePlaylist);

  const [name] = useState(exportOnly.playlistName);
  const [djSoftware, setDjSoftware] = useState<DjSoftwareInfo[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);
  const [results, setResults] = useState<Array<{ id: string; path?: string; error?: string }>>([]);
  const [done, setDone] = useState(false);

  useEffect(() => {
    invoke<DjSoftwareInfo[]>("detect_dj_software").then((sw) => {
      setDjSoftware([...sw].sort((a, b) => (b.installed ? 1 : 0) - (a.installed ? 1 : 0)));
    });
  }, []);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleExport = async () => {
    if (!selected.size) return;
    setExporting(true);
    const exportResults: typeof results = [];

    for (const id of selected) {
      if (id === "m3u") {
        try {
          const savePath = await save({
            defaultPath: `${name}.m3u`,
            filters: [{ name: "Playlist M3U", extensions: ["m3u"] }],
          });
          if (savePath) {
            await invoke("export_m3u", { tracks, outputPath: savePath });
            exportResults.push({ id, path: savePath });
          }
        } catch (e) { exportResults.push({ id, error: String(e) }); }
        continue;
      }
      try {
        const path = await invoke<string>("export_playlist_to_dj", { playlistName: name, softwareId: id, tracks });
        exportResults.push({ id, path });
      } catch (e) { exportResults.push({ id, error: String(e) }); }
    }

    setResults(exportResults);
    setDone(true);
    setExporting(false);

    const exportedTo = exportResults.filter((r) => !r.error).map((r) => r.id);
    if (exportedTo.length > 0) updatePlaylist(exportOnly.playlistId, { lastExportedTo: exportedTo });

    for (const r of exportResults) {
      if (!r.error && r.id !== "m3u") {
        try { await invoke("open_dj_app", { softwareId: r.id }); } catch { /* ignore */ }
      }
    }
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
          opacity: isInstalled || isM3u ? 1 : 0.45,
        }}
      >
        <input type="checkbox" className="sr-only" checked={isChecked} onChange={() => toggle(id)} disabled={!isInstalled && !isM3u} />
        <div
          className="w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-all"
          style={{ borderColor: isChecked ? "#D95340" : "rgba(255,255,255,0.12)", background: isChecked ? "#D95340" : "transparent" }}
        >
          {isChecked && (
            <svg width="9" height="7" viewBox="0 0 9 7" fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M1 3.5L3.5 6L8 1"/>
            </svg>
          )}
        </div>
        <div className="relative shrink-0">
          <div className="w-6 h-6 rounded flex items-center justify-center text-[10px] font-bold" style={{ background: "rgba(255,255,255,0.06)", color: "#8F8883" }}>
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
            <div className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2" style={{ background: "#5BA055", borderColor: "#1c1715" }} />
          )}
        </div>
        <div className="flex-1">
          <p className="text-[12px] font-medium" style={{ color: "#C2BEBC" }}>{label}</p>
          <p className="text-[10px]" style={{ color: isInstalled || isM3u ? "#5BA055" : "#605A55" }}>{subtitle}</p>
        </div>
      </label>
    );
  };

  if (done) {
    return (
      <>
        <div className="px-5 pt-5 pb-4" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
          <h2 className="text-[14px] font-semibold" style={{ color: "#F5F5F4" }}>{t("playlist.export")}</h2>
        </div>
        <div className="px-5 py-5 space-y-3">
          {results.map((r) => (
            <div key={r.id} className="flex items-start gap-3">
              <div className="w-7 h-7 rounded-md flex items-center justify-center text-[11px] font-bold shrink-0"
                style={{ background: r.error ? "rgba(217,83,64,0.15)" : "rgba(91,160,85,0.15)", color: r.error ? "#D95340" : "#5BA055" }}>
                {r.error ? "!" : "✓"}
              </div>
              <div>
                <p className="text-[12px] font-medium" style={{ color: "#C2BEBC" }}>{DJ_LABELS[r.id] ?? r.id}</p>
                {r.path && <p className="text-[10px] mt-0.5 break-all" style={{ color: "#605A55" }}>{r.path}</p>}
                {r.error && <p className="text-[10px] mt-0.5" style={{ color: "#D95340" }}>{r.error}</p>}
              </div>
            </div>
          ))}
          <p className="text-[10px] pt-2" style={{ color: "#4C4743" }}>
            {results.some((r) => !r.error && r.id !== "m3u") ? t("playlist.djOpenedAuto") : t("playlist.exportDone")}
          </p>
          <button onClick={onClose} className="w-full mt-2 py-2 rounded-lg text-[12px] font-semibold" style={{ background: "#D95340", color: "white" }}>
            {t("common.close")}
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="px-5 pt-5 pb-4" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        <h2 className="text-[14px] font-semibold" style={{ color: "#F5F5F4" }}>{t("playlist.export")}</h2>
        <p className="text-[11px] mt-0.5" style={{ color: "#605A55" }}>
          {t("playlist.tracksSelected", { count: tracks.length })} · <span style={{ color: "#8F8883" }}>{name}</span>
        </p>
      </div>
      <div className="px-5 py-4 space-y-4">
        <div>
          <label className="text-[10px] font-bold uppercase tracking-widest block mb-2" style={{ color: "#8F8883" }}>
            {t("playlist.exportTo")}
          </label>
          <div className="space-y-1.5">
            {djSoftware.map((sw) => renderRow(sw.id, sw.name, sw.installed ? t("settings.services.installed") : t("settings.services.notFound"), sw.installed))}
            {djSoftware.length > 0 && <div className="h-px my-0.5" style={{ background: "rgba(255,255,255,0.05)" }} />}
            {renderRow("m3u", "Arquivo M3U", t("playlist.m3uSubtitle"), true, true)}
          </div>
        </div>
        <p className="text-[10px]" style={{ color: "#4C4743" }}>
          {[...selected].some((id) => id !== "m3u") ? t("playlist.djOpenNote") : t("playlist.chooseExport")}
        </p>
        <div className="flex gap-2 pt-1">
          <button onClick={onClose} className="flex-1 py-2 rounded-lg text-[12px] font-semibold transition-colors" style={{ background: "rgba(255,255,255,0.06)", color: "#8F8883" }}>
            {t("common.cancel")}
          </button>
          <button
            onClick={handleExport}
            disabled={exporting || selected.size === 0}
            className="flex-1 py-2 rounded-lg text-[12px] font-semibold transition-colors disabled:opacity-40"
            style={{ background: "#D95340", color: "white" }}
          >
            {exporting ? t("playlist.exporting") : t("playlist.exportTo")}
          </button>
        </div>
      </div>
    </>
  );
}

// ── FieldRow ──────────────────────────────────────────────────────────────────

function FieldRow({ active, onToggle, label, children }: { active: boolean; onToggle: () => void; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2.5">
      <button
        onClick={onToggle}
        className="w-3.5 h-3.5 rounded-[3px] border flex-shrink-0 flex items-center justify-center transition-colors"
        style={{ background: active ? "#D95340" : "transparent", borderColor: active ? "#D95340" : "rgba(255,255,255,0.2)" }}
      >
        {active && (
          <svg width="8" height="6" viewBox="0 0 8 6" fill="none" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M1 3l2 2 4-4" />
          </svg>
        )}
      </button>
      <span className="text-[11px] w-16 shrink-0" style={{ color: active ? "#C2BEBC" : "#4C4743" }}>{label}</span>
      <div className="flex-1 min-w-0" style={{ opacity: active ? 1 : 0.4, pointerEvents: active ? "auto" : "none" }}>
        {children}
      </div>
    </div>
  );
}

// ── Root export ───────────────────────────────────────────────────────────────

export default function CreatePlaylistModal({ tracks, onClose, exportOnly }: Props) {
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
        {exportOnly
          ? <ExportMode tracks={tracks} onClose={onClose} exportOnly={exportOnly} />
          : <CreateMode tracks={tracks} onClose={onClose} />
        }
      </div>
    </div>
  );
}
