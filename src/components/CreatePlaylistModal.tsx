import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Track } from "../store";

interface DjSoftwareInfo {
  id: string;
  name: string;
  installed: boolean;
}

interface Props {
  tracks: Track[];
  onClose: () => void;
}

const DJ_LABELS: Record<string, string> = {
  serato:    "Serato DJ Pro",
  rekordbox: "rekordbox",
  traktor:   "Traktor Pro 3",
  vdj:       "Virtual DJ",
};

const DJ_ICONS: Record<string, string> = {
  serato:    "S",
  rekordbox: "R",
  traktor:   "T",
  vdj:       "V",
};

export default function CreatePlaylistModal({ tracks, onClose }: Props) {
  const [name, setName] = useState("Minha Playlist");
  const [djSoftware, setDjSoftware] = useState<DjSoftwareInfo[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);
  const [results, setResults] = useState<Array<{ id: string; path?: string; error?: string }>>([]);
  const [done, setDone] = useState(false);

  useEffect(() => {
    invoke<DjSoftwareInfo[]>("detect_dj_software").then((sw) => {
      setDjSoftware(sw);
      // Pre-select installed software
      const installed = new Set(sw.filter((s) => s.installed).map((s) => s.id));
      setSelected(installed);
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
    if (!name.trim() || selected.size === 0) return;
    setExporting(true);
    const exportResults: typeof results = [];

    for (const id of selected) {
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

    // Auto-open installed software that exported successfully
    for (const r of exportResults) {
      if (!r.error) {
        try {
          await invoke("open_dj_app", { softwareId: r.id });
        } catch {
          // ignore if app not found
        }
      }
    }
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
          <h2 className="text-[14px] font-semibold" style={{ color: "#F5F5F4" }}>Criar Playlist</h2>
          <p className="text-[11px] mt-0.5" style={{ color: "#605A55" }}>
            {tracks.length} {tracks.length === 1 ? "faixa" : "faixas"} selecionada{tracks.length !== 1 ? "s" : ""}
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
                O software DJ foi aberto automaticamente. A playlist aparecerá na biblioteca.
              </p>
            </div>
            <button
              onClick={onClose}
              className="w-full mt-2 py-2 rounded-lg text-[12px] font-semibold"
              style={{ background: "#D95340", color: "white" }}
            >
              Fechar
            </button>
          </div>
        ) : (
          /* Export form */
          <div className="px-5 py-4 space-y-4">
            {/* Playlist name */}
            <div>
              <label className="text-[10px] font-bold uppercase tracking-widest block mb-1.5" style={{ color: "#8F8883" }}>
                Nome da Playlist
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex: Set Techno 2025"
                className="w-full px-3 py-2 rounded-lg text-[13px] outline-none"
                style={{
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  color: "#F5F5F4",
                }}
                onFocus={(e) => { e.target.style.border = "1px solid rgba(217,83,64,0.5)"; }}
                onBlur={(e) => { e.target.style.border = "1px solid rgba(255,255,255,0.08)"; }}
              />
            </div>

            {/* DJ Software */}
            <div>
              <label className="text-[10px] font-bold uppercase tracking-widest block mb-2" style={{ color: "#8F8883" }}>
                Exportar para
              </label>
              <div className="space-y-1.5">
                {djSoftware.map((sw) => {
                  const isChecked = selected.has(sw.id);
                  return (
                    <label
                      key={sw.id}
                      className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors"
                      style={{
                        background: isChecked ? "rgba(217,83,64,0.08)" : "rgba(255,255,255,0.02)",
                        border: isChecked ? "1px solid rgba(217,83,64,0.25)" : "1px solid rgba(255,255,255,0.05)",
                        opacity: sw.installed ? 1 : 0.45,
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => toggle(sw.id)}
                        disabled={!sw.installed}
                      />
                      <div
                        className="w-6 h-6 rounded flex items-center justify-center text-[10px] font-bold shrink-0"
                        style={{ background: "rgba(255,255,255,0.06)", color: "#8F8883" }}
                      >
                        {DJ_ICONS[sw.id]}
                      </div>
                      <div className="flex-1">
                        <p className="text-[12px] font-medium" style={{ color: "#C2BEBC" }}>{sw.name}</p>
                        <p className="text-[10px]" style={{ color: sw.installed ? "#5BA055" : "#605A55" }}>
                          {sw.installed ? "Instalado" : "Não encontrado"}
                        </p>
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>

            {/* Note */}
            <p className="text-[10px]" style={{ color: "#4C4743" }}>
              O software será aberto automaticamente após a exportação.
            </p>

            {/* Actions */}
            <div className="flex gap-2 pt-1">
              <button
                onClick={onClose}
                className="flex-1 py-2 rounded-lg text-[12px] font-semibold transition-colors"
                style={{ background: "rgba(255,255,255,0.06)", color: "#8F8883" }}
              >
                Cancelar
              </button>
              <button
                onClick={handleExport}
                disabled={exporting || !name.trim() || selected.size === 0}
                className="flex-1 py-2 rounded-lg text-[12px] font-semibold transition-colors disabled:opacity-40"
                style={{ background: "#D95340", color: "white" }}
              >
                {exporting ? "Exportando…" : `Exportar para ${selected.size} software${selected.size !== 1 ? "s" : ""}`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
