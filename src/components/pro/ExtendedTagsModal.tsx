import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "../Toast";
import type { Track } from "../../store";

interface RawTag { key: string; value: string; }
interface Props { track: Track; onClose: () => void; }

const KNOWN: Record<string, string> = {
  TIT2: "Título", TPE1: "Artista", TALB: "Álbum", TYER: "Ano", TCON: "Gênero",
  TBPM: "BPM", TKEY: "Tom", COMM: "Comentário", TRCK: "Faixa", TPOS: "Disco",
  TPE2: "Artista do álbum", TCOM: "Compositor", TCOP: "Copyright",
  TENC: "Codificado por", TSSE: "Software", TDRC: "Data de gravação",
  POPM: "Popularidade", APIC: "Capa (binário)", GEOB: "Objeto geral (binário)",
};

export default function ExtendedTagsModal({ track, onClose }: Props) {
  const [tags, setTags] = useState<RawTag[]>([]);
  const [loading, setLoading] = useState(true);
  const [editKey, setEditKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    invoke<RawTag[]>("read_all_tags", { path: track.path })
      .then(setTags)
      .catch(() => toast("Erro ao ler tags", "error"))
      .finally(() => setLoading(false));
  }, [track.path]);

  const reload = () => {
    setLoading(true);
    invoke<RawTag[]>("read_all_tags", { path: track.path })
      .then(setTags).finally(() => setLoading(false));
  };

  const handleSave = async (key: string) => {
    setSaving(true);
    try {
      await invoke("save_raw_tag", { path: track.path, key, value: editValue });
      setTags((prev) => prev.map((t) => t.key === key ? { ...t, value: editValue } : t));
      setEditKey(null);
      toast("Tag salva", "success");
    } catch (e) {
      toast(`Erro: ${e}`, "error");
    } finally { setSaving(false); }
  };

  const handleDelete = async (key: string) => {
    try {
      await invoke("delete_raw_tag", { path: track.path, key });
      setTags((prev) => prev.filter((t) => t.key !== key));
      toast("Tag removida", "success");
    } catch (e) {
      toast(`Erro: ${e}`, "error");
    }
  };

  const handleAddNew = async () => {
    if (!newKey.trim() || !newValue.trim()) return;
    setSaving(true);
    try {
      await invoke("save_raw_tag", { path: track.path, key: newKey.trim(), value: newValue.trim() });
      reload();
      setNewKey(""); setNewValue(""); setShowNew(false);
      toast("Campo adicionado", "success");
    } catch (e) {
      toast(`Erro: ${e}`, "error");
    } finally { setSaving(false); }
  };

  const visible = tags.filter((t) =>
    !filter || t.key.toLowerCase().includes(filter.toLowerCase()) ||
    t.value.toLowerCase().includes(filter.toLowerCase())
  );

  return (
    <div className="fixed inset-0 z-[500] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-[#1c1715] border border-white/[0.08] rounded-2xl w-[580px] max-h-[88vh] flex flex-col shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="px-5 py-4 border-b border-white/[0.06] flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-[#D95340]/15 flex items-center justify-center shrink-0">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="#D95340" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="1" y="1" width="12" height="12" rx="1.5"/>
              <line x1="4" y1="5" x2="10" y2="5"/><line x1="4" y1="7.5" x2="10" y2="7.5"/><line x1="4" y1="10" x2="7" y2="10"/>
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-[13px] font-bold text-[#F5F5F4]">Tags Avançadas</h2>
            <p className="text-[10px] text-[#605A55] truncate">{track.filename}</p>
          </div>
          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-[#D95340]/20 text-[#D95340] shrink-0">PRO</span>
        </div>

        {/* Filter */}
        <div className="px-5 pt-3 pb-2">
          <input
            type="text" value={filter} onChange={(e) => setFilter(e.target.value)}
            placeholder="Filtrar campos…"
            className="w-full px-3 py-1.5 rounded-lg text-[12px] focus:outline-none focus:border-[#D95340]/50"
            style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", color: "#C2BEBC" }}
          />
        </div>

        {/* Tag list */}
        <div className="flex-1 overflow-y-auto no-scrollbar px-5 pb-3 space-y-1">
          {loading ? (
            <div className="py-8 text-center text-[12px] text-[#4C4743]">Lendo tags…</div>
          ) : visible.length === 0 ? (
            <div className="py-8 text-center text-[12px] text-[#4C4743]">Nenhum campo encontrado</div>
          ) : visible.map((tag) => {
            const isBinary = tag.value === "(binary)";
            const label = KNOWN[tag.key];
            const isEditing = editKey === tag.key;
            return (
              <div key={tag.key} className={`flex items-start gap-2.5 px-3 py-2 rounded-lg transition-colors ${isEditing ? "bg-[#D95340]/[0.06] border border-[#D95340]/20" : "hover:bg-white/[0.02]"}`}
                style={{ border: isEditing ? undefined : "1px solid transparent" }}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span className="text-[10px] font-mono font-bold text-[#D95340]">{tag.key}</span>
                    {label && <span className="text-[9px] text-[#4C4743]">— {label}</span>}
                  </div>
                  {isEditing ? (
                    <div className="flex items-center gap-1.5 mt-1">
                      <input autoFocus value={editValue} onChange={(e) => setEditValue(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") handleSave(tag.key); if (e.key === "Escape") setEditKey(null); }}
                        className="flex-1 px-2 py-1 rounded text-[11px] focus:outline-none"
                        style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(217,83,64,0.40)", color: "#E8E4E1" }}
                      />
                      <button onClick={() => handleSave(tag.key)} disabled={saving}
                        className="px-2.5 py-1 text-[10px] font-bold rounded bg-[#D95340] text-white disabled:opacity-40">
                        {saving ? "…" : "Salvar"}
                      </button>
                      <button onClick={() => setEditKey(null)} className="px-2 py-1 text-[10px] text-[#605A55] hover:text-[#C2BEBC]">✕</button>
                    </div>
                  ) : (
                    <p className={`text-[11px] truncate ${isBinary ? "text-[#4C4743] italic" : "text-[#C2BEBC]"}`}>{tag.value}</p>
                  )}
                </div>
                {!isEditing && !isBinary && (
                  <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 mt-0.5">
                    <button onClick={() => { setEditKey(tag.key); setEditValue(tag.value); }}
                      className="p-1 rounded hover:bg-white/[0.08] text-[#605A55] hover:text-[#C2BEBC] transition-colors">
                      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M7 1.5l1.5 1.5L3 8.5H1.5V7L7 1.5z"/>
                      </svg>
                    </button>
                    <button onClick={() => handleDelete(tag.key)}
                      className="p-1 rounded hover:bg-[#D95340]/10 text-[#605A55] hover:text-[#D95340] transition-colors">
                      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
                        <line x1="1" y1="1" x2="9" y2="9"/><line x1="9" y1="1" x2="1" y2="9"/>
                      </svg>
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Add new tag */}
        {showNew && (
          <div className="px-5 py-3 border-t border-white/[0.05]">
            <div className="flex items-center gap-2">
              <input value={newKey} onChange={(e) => setNewKey(e.target.value.toUpperCase())}
                placeholder="CAMPO (ex: TXXX)" maxLength={4}
                className="w-24 px-2 py-1.5 rounded text-[11px] font-mono focus:outline-none"
                style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.10)", color: "#E8E4E1" }}
              />
              <input value={newValue} onChange={(e) => setNewValue(e.target.value)}
                placeholder="Valor" onKeyDown={(e) => e.key === "Enter" && handleAddNew()}
                className="flex-1 px-2 py-1.5 rounded text-[11px] focus:outline-none"
                style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.10)", color: "#E8E4E1" }}
              />
              <button onClick={handleAddNew} disabled={saving || !newKey || !newValue}
                className="px-3 py-1.5 text-[11px] font-bold rounded-lg bg-[#D95340] text-white disabled:opacity-40">
                Adicionar
              </button>
              <button onClick={() => setShowNew(false)} className="p-1.5 text-[#605A55] hover:text-[#C2BEBC]">✕</button>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="px-5 py-3 border-t border-white/[0.06] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-[#4C4743]">{visible.length} campo{visible.length !== 1 ? "s" : ""}</span>
            {!showNew && (
              <button onClick={() => setShowNew(true)}
                className="flex items-center gap-1 text-[10px] text-[#605A55] hover:text-[#C2BEBC] transition-colors">
                <svg width="9" height="9" viewBox="0 0 9 9" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
                  <line x1="4.5" y1="1" x2="4.5" y2="8"/><line x1="1" y1="4.5" x2="8" y2="4.5"/>
                </svg>
                Novo campo
              </button>
            )}
          </div>
          <button onClick={onClose} className="px-4 py-1.5 text-[12px] text-[#756D67] hover:text-[#C2BEBC] transition-colors rounded-lg hover:bg-white/[0.04]">
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}
