import { useState } from "react";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { useAppStore, type Playlist, type PlaylistGlobalProperties } from "../store";
import { toast } from "./Toast";

type FieldKey = 'cover' | 'album' | 'genre' | 'comment';

interface Props {
  playlist: Playlist;
  onClose: () => void;
}

export default function PlaylistSettingsModal({ playlist, onClose }: Props) {
  const updatePlaylist = useAppStore((s) => s.updatePlaylist);
  const globalPropertyPresets = useAppStore((s) => s.globalPropertyPresets);
  const saveGlobalPropertyPreset = useAppStore((s) => s.saveGlobalPropertyPreset);

  const [name, setName] = useState(playlist.name);
  const [props, setProps] = useState<PlaylistGlobalProperties>(() =>
    playlist.globalProperties ?? { enabled: false, activeFields: [] }
  );
  const [applying, setApplying] = useState(false);
  const [presetNameInput, setPresetNameInput] = useState("");

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
      const b64 = await invoke<string | null>("read_file_base64", { path }).catch(() => null);
      const isPng = path.toLowerCase().endsWith(".png");
      setProps((p) => ({
        ...p,
        cover: path,
        coverB64: b64 ?? undefined,
        coverIsPng: isPng,
        activeFields: p.activeFields.includes("cover") ? p.activeFields : [...p.activeFields, "cover"],
      }));
    }
  };

  const handleSave = () => {
    const prevFields = playlist.globalProperties?.activeFields ?? [];
    const prevEnabled = playlist.globalProperties?.enabled ?? false;
    const nextEnabled = props.activeFields.length > 0;
    const finalProps = { ...props, enabled: nextEnabled };
    const rulesChanged =
      (nextEnabled && !prevEnabled) ||
      (nextEnabled &&
        JSON.stringify([...props.activeFields].sort()) !==
          JSON.stringify([...prevFields].sort()));

    updatePlaylist(playlist.id, {
      name,
      globalProperties: finalProps,
      pendingRulesApply:
        rulesChanged && playlist.trackPaths.length > 0
          ? true
          : playlist.pendingRulesApply,
    });
    onClose();
  };

  const handleApplyToAll = async () => {
    if (playlist.trackPaths.length === 0 || props.activeFields.length === 0) return;
    setApplying(true);
    const { applyPlaylistRules } = await import("../lib/playlistRules");
    const finalProps = { ...props, enabled: true };
    await applyPlaylistRules(finalProps, playlist.trackPaths);
    setApplying(false);
    updatePlaylist(playlist.id, { globalProperties: finalProps, pendingRulesApply: false });
    onClose();
    const count = playlist.trackPaths.length;
    toast(
      count > 0
        ? `Propriedades aplicadas em ${count} faixa${count > 1 ? "s" : ""}`
        : "Nenhuma faixa atualizada",
      count > 0 ? "success" : "info"
    );
  };

  const coverSrc = props.cover ? convertFileSrc(props.cover) : null;

  return (
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="bg-[#1c1715] border border-white/10 rounded-xl w-[400px] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-2.5 px-5 py-4 border-b border-white/[0.06]">
          <svg width="13" height="13" viewBox="0 0 12 12" fill="none" stroke="#8F8883" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="6" cy="6" r="1.8"/>
            <path d="M6 1v1.2M6 9.8V11M1 6h1.2M9.8 6H11M2.5 2.5l.85.85M8.65 8.65l.85.85M9.5 2.5l-.85.85M3.35 8.65l-.85.85"/>
          </svg>
          <h2 className="text-sm font-semibold text-[#E8E4E1]">Configurações da playlist</h2>
        </div>

        <div className="px-5 py-4 flex flex-col gap-4 max-h-[70vh] overflow-y-auto no-scrollbar">
          {/* Identidade */}
          <section>
            <p className="text-[10px] font-bold uppercase tracking-widest text-[#4C4743] mb-2">Identidade</p>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Nome da playlist"
              className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-[#E8E4E1] placeholder-[#4C4743] focus:outline-none focus:border-[#D95340]/50"
            />
          </section>

          {/* Propriedades Globais — sempre visível */}
          <section>
            <div className="flex items-center mb-3">
              <p className="text-[10px] font-bold uppercase tracking-widest text-[#4C4743]">
                Propriedades Globais
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <FieldRow
                active={props.activeFields.includes("cover")}
                onToggle={() => toggleField("cover")}
                label="Capa"
              >
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  {coverSrc ? (
                    <img
                      src={coverSrc}
                      alt="Capa"
                      className="w-8 h-8 rounded object-cover shrink-0"
                      style={{ border: "1px solid var(--radio-border)" }}
                    />
                  ) : (
                    <span className="text-[12px] text-[#605A55]">Nenhuma imagem</span>
                  )}
                  <button
                    onClick={handlePickCover}
                    className="ml-auto text-[11px] px-2.5 py-1 rounded-lg transition-colors whitespace-nowrap flex-shrink-0 text-[#D95340] font-medium"
                    style={{ background: "rgba(217,83,64,0.12)" }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(217,83,64,0.20)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(217,83,64,0.12)"; }}
                  >
                    {coverSrc ? "Trocar…" : "Escolher…"}
                  </button>
                </div>
              </FieldRow>

              <FieldRow
                active={props.activeFields.includes("album")}
                onToggle={() => toggleField("album")}
                label="Álbum"
              >
                <input
                  type="text"
                  value={props.album ?? ""}
                  onChange={(e) => setProps((p) => ({ ...p, album: e.target.value }))}
                  placeholder="Nome do álbum"
                  className="flex-1 w-full bg-transparent text-[12px] text-[#C2BEBC] placeholder-[#605A55] focus:outline-none"
                />
              </FieldRow>

              <FieldRow
                active={props.activeFields.includes("genre")}
                onToggle={() => toggleField("genre")}
                label="Gênero"
              >
                <input
                  type="text"
                  value={props.genre ?? ""}
                  onChange={(e) => setProps((p) => ({ ...p, genre: e.target.value }))}
                  placeholder="Ex: House, Techno"
                  className="flex-1 w-full bg-transparent text-[12px] text-[#C2BEBC] placeholder-[#605A55] focus:outline-none"
                />
              </FieldRow>

              <FieldRow
                active={props.activeFields.includes("comment")}
                onToggle={() => toggleField("comment")}
                label="Comentário"
              >
                <input
                  type="text"
                  value={props.comment ?? ""}
                  onChange={(e) => setProps((p) => ({ ...p, comment: e.target.value }))}
                  placeholder="Comentário"
                  className="flex-1 w-full bg-transparent text-[12px] text-[#C2BEBC] placeholder-[#605A55] focus:outline-none"
                />
              </FieldRow>

              <p className="text-[10px] text-[#4C4743] mt-0.5 pl-1">
                Marque os campos que devem ser aplicados automaticamente às faixas desta playlist.
              </p>

              {/* Presets — sempre visível */}
              <div className="border-t border-white/[0.06] pt-3 mt-1 flex flex-col gap-2">
                {/* Dropdown de presets existentes */}
                {globalPropertyPresets.length > 0 && (
                  <select
                    defaultValue=""
                    onChange={(e) => {
                      const p = globalPropertyPresets.find((x) => x.id === e.target.value);
                      if (p) setProps({ ...p.properties, enabled: true });
                      e.target.value = "";
                    }}
                    className="w-full rounded-lg px-2.5 py-1.5 text-[12px] focus:outline-none"
                    style={{ background: "var(--field-bg)", border: "1px solid var(--field-border)", color: "var(--col-on)" }}
                  >
                    <option value="" disabled>Carregar preset…</option>
                    {globalPropertyPresets.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                )}

                {/* Input de nome + botão salvar — sempre visível */}
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    value={presetNameInput}
                    onChange={(e) => setPresetNameInput(e.target.value)}
                    placeholder="Nome do preset…"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && presetNameInput.trim()) {
                        saveGlobalPropertyPreset(presetNameInput.trim(), props);
                        toast("Preset salvo", "success");
                        setPresetNameInput("");
                      }
                    }}
                    className="flex-1 rounded-lg px-3 py-1.5 text-[12px] focus:outline-none"
                    style={{ background: "var(--field-bg)", border: "1px solid var(--field-border)", color: "var(--col-on)" }}
                  />
                  <button
                    onClick={() => {
                      if (presetNameInput.trim()) {
                        saveGlobalPropertyPreset(presetNameInput.trim(), props);
                        toast("Preset salvo", "success");
                        setPresetNameInput("");
                      }
                    }}
                    disabled={!presetNameInput.trim()}
                    className="px-3 py-1.5 text-[11px] font-semibold rounded-lg transition-colors disabled:opacity-35 whitespace-nowrap"
                    style={{ background: "rgba(217,83,64,0.15)", color: "#D95340", border: "1px solid rgba(217,83,64,0.25)" }}
                  >
                    Salvar
                  </button>
                </div>
              </div>
            </div>
          </section>

          {/* Aplicar a faixas existentes */}
          {props.activeFields.length > 0 && playlist.trackPaths.length > 0 && (
            <section className="border-t border-white/[0.06] pt-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[11px] text-[#C2BEBC] font-medium">Faixas existentes</p>
                  <p className="text-[10px] text-[#4C4743]">
                    {playlist.trackPaths.length} faixa{playlist.trackPaths.length > 1 ? "s" : ""} na playlist
                  </p>
                </div>
                <button
                  onClick={handleApplyToAll}
                  disabled={applying}
                  className="text-[11px] px-3 py-1.5 rounded-lg bg-[#D95340]/20 hover:bg-[#D95340]/30 text-[#D95340] font-medium transition-colors disabled:opacity-50 flex-shrink-0"
                >
                  {applying ? "Aplicando…" : "Aplicar a todas →"}
                </button>
              </div>
              <p className="mt-1.5 text-[9px] text-[#373331]">⚠ Sobrescreve os metadados no disco</p>
            </section>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-white/[0.06]">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-[12px] text-[#756D67] hover:text-[#C2BEBC] transition-colors rounded-lg hover:bg-white/[0.04]"
          >
            Cancelar
          </button>
          <button
            onClick={handleSave}
            className="px-4 py-1.5 text-[12px] font-medium bg-[#D95340] hover:bg-[#E07364] text-white rounded-lg transition-colors"
          >
            Salvar
          </button>
        </div>
      </div>
    </div>
  );
}

function FieldRow({
  active,
  onToggle,
  label,
  children,
}: {
  active: boolean;
  onToggle: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 transition-all cursor-pointer ${
        active ? "bg-[#D95340]/[0.07]" : "bg-white/[0.02]"
      }`}
      style={{
        border: active ? "1px solid rgba(217,83,64,0.20)" : "1px solid var(--surface-row-border, rgba(255,255,255,0.05))",
      }}
      onClick={onToggle}
    >
      {/* Checkbox */}
      <div
        className={`w-4 h-4 rounded-[4px] flex-shrink-0 flex items-center justify-center transition-colors ${active ? "" : "tw-border-inactive"}`}
        style={{
          background: active ? "#D95340" : "transparent",
          border: active ? "1.5px solid #D95340" : undefined,
        }}
        onClick={(e) => { e.stopPropagation(); onToggle(); }}
      >
        {active && (
          <svg width="8" height="6" viewBox="0 0 8 6" fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M1 3l2 2 4-4" />
          </svg>
        )}
      </div>

      {/* Label */}
      <span
        className="text-[12px] w-16 shrink-0 font-medium"
        style={{ color: active ? "var(--ctx-text)" : "var(--c-t5)" }}
      >
        {label}
      </span>

      {/* Conteúdo */}
      <div
        className="flex-1 min-w-0"
        style={{ opacity: active ? 1 : 0.45, pointerEvents: active ? "auto" : "none" }}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
