import { useState } from "react";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { useAppStore, type Playlist, type PlaylistGlobalProperties } from "../store";
import { toast } from "./Toast";

type FieldKey = 'cover' | 'album' | 'genre' | 'comment';

interface Props {
  playlist: Playlist;
  onClose: () => void;
}

export default function PlaylistSettingsModal({ playlist, onClose }: Props) {
  const updatePlaylist = useAppStore((s) => s.updatePlaylist);

  const [name, setName] = useState(playlist.name);
  const [props, setProps] = useState<PlaylistGlobalProperties>(() =>
    playlist.globalProperties ?? { enabled: false, activeFields: [] }
  );
  const [applying, setApplying] = useState(false);

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
      setProps((p) => ({ ...p, cover: path }));
      if (!props.activeFields.includes("cover")) {
        setProps((p) => ({ ...p, activeFields: [...p.activeFields, "cover"] }));
      }
    }
  };

  const handleSave = () => {
    const prevFields = playlist.globalProperties?.activeFields ?? [];
    const prevEnabled = playlist.globalProperties?.enabled ?? false;
    const rulesChanged =
      (props.enabled && !prevEnabled) ||
      (props.enabled &&
        JSON.stringify([...props.activeFields].sort()) !==
          JSON.stringify([...prevFields].sort()));

    updatePlaylist(playlist.id, {
      name,
      globalProperties: props,
      pendingRulesApply:
        rulesChanged && playlist.trackPaths.length > 0
          ? true
          : playlist.pendingRulesApply,
    });
    onClose();
  };

  const handleApplyToAll = async () => {
    if (playlist.trackPaths.length === 0 || !props.enabled || props.activeFields.length === 0) return;
    setApplying(true);
    const { applyPlaylistRules } = await import("../lib/playlistRules");
    await applyPlaylistRules(props, playlist.trackPaths);
    setApplying(false);
    updatePlaylist(playlist.id, { globalProperties: props, pendingRulesApply: false });
    onClose();
    const count = playlist.trackPaths.length;
    toast(
      count > 0
        ? `Propriedades aplicadas em ${count} faixa${count > 1 ? "s" : ""}`
        : "Nenhuma faixa atualizada",
      count > 0 ? "success" : "info"
    );
  };

  const coverName = props.cover ? props.cover.split(/[\\/]/).pop() : null;

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

          {/* Propriedades Globais */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <p className="text-[10px] font-bold uppercase tracking-widest text-[#4C4743]">
                Propriedades Globais
              </p>
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
                <FieldRow
                  active={props.activeFields.includes("cover")}
                  onToggle={() => toggleField("cover")}
                  label="Capa"
                >
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <span className="flex-1 text-[11px] text-[#8F8883] truncate">
                      {coverName ?? "Nenhuma imagem"}
                    </span>
                    <button
                      onClick={handlePickCover}
                      className="text-[10px] px-2 py-0.5 rounded bg-white/[0.06] hover:bg-white/[0.10] text-[#8F8883] transition-colors whitespace-nowrap flex-shrink-0"
                    >
                      Escolher…
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
                    className="flex-1 w-full bg-transparent border-b border-white/[0.08] pb-0.5 text-[12px] text-[#C2BEBC] placeholder-[#4C4743] focus:outline-none focus:border-[#D95340]/50"
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
                    className="flex-1 w-full bg-transparent border-b border-white/[0.08] pb-0.5 text-[12px] text-[#C2BEBC] placeholder-[#4C4743] focus:outline-none focus:border-[#D95340]/50"
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
                    className="flex-1 w-full bg-transparent border-b border-white/[0.08] pb-0.5 text-[12px] text-[#C2BEBC] placeholder-[#4C4743] focus:outline-none focus:border-[#D95340]/50"
                  />
                </FieldRow>

                <p className="text-[10px] text-[#4C4743] mt-0.5">
                  Faixas arrastadas para esta playlist recebem automaticamente os campos ativos.
                </p>
              </div>
            )}
          </section>

          {/* Faixas existentes */}
          {props.enabled && props.activeFields.length > 0 && playlist.trackPaths.length > 0 && (
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
    <div className="flex items-center gap-2.5">
      <button
        onClick={onToggle}
        className={`w-3.5 h-3.5 rounded-[3px] border flex-shrink-0 flex items-center justify-center transition-colors ${
          active ? "bg-[#D95340] border-[#D95340]" : "bg-transparent border-white/20"
        }`}
      >
        {active && (
          <svg width="8" height="6" viewBox="0 0 8 6" fill="none" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M1 3l2 2 4-4" />
          </svg>
        )}
      </button>
      <span className={`text-[11px] w-16 shrink-0 ${active ? "text-[#C2BEBC]" : "text-[#4C4743]"}`}>
        {label}
      </span>
      <div className={`flex-1 min-w-0 ${active ? "" : "opacity-40 pointer-events-none"}`}>
        {children}
      </div>
    </div>
  );
}
