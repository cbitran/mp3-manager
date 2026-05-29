import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "../Toast";
import type { Track } from "../../store";

interface RawTag { key: string; value: string; }
interface Props { track: Track; onClose: () => void; }

const KNOWN: Record<string, string> = {
  TIT2: "Title", TPE1: "Artist", TALB: "Album", TYER: "Year", TCON: "Genre",
  TBPM: "BPM", TKEY: "Key", COMM: "Comment", TRCK: "Track #", TPOS: "Disc #",
  TPE2: "Album Artist", TCOM: "Composer", TCOP: "Copyright",
  TENC: "Encoded by", TSSE: "Software", TDRC: "Recording Date",
  POPM: "Popularity", APIC: "Cover (binary)", GEOB: "General Object (binary)",
};

export default function ExtendedTagsModal({ track, onClose }: Props) {
  const { t } = useTranslation();
  const [tags, setTags] = useState<RawTag[]>([]);
  const [loading, setLoading] = useState(true);
  const [editKey, setEditKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [filter, setFilter] = useState("");

  const reload = () => {
    setLoading(true);
    invoke<RawTag[]>("read_all_tags", { path: track.path })
      .then(setTags).finally(() => setLoading(false));
  };

  useEffect(() => { reload(); }, [track.path]);

  const handleSave = async (key: string) => {
    setSaving(true);
    try {
      await invoke("save_raw_tag", { path: track.path, key, value: editValue });
      setTags((prev) => prev.map((tg) => tg.key === key ? { ...tg, value: editValue } : tg));
      setEditKey(null);
      toast(t("pro.extendedTags.savedToast"), "success");
    } catch (e) {
      toast(t("pro.extendedTags.errorToast", { error: e }), "error");
    } finally { setSaving(false); }
  };

  const handleDelete = async (key: string) => {
    try {
      await invoke("delete_raw_tag", { path: track.path, key });
      setTags((prev) => prev.filter((tg) => tg.key !== key));
      toast(t("pro.extendedTags.deletedToast"), "success");
    } catch (e) {
      toast(t("pro.extendedTags.errorToast", { error: e }), "error");
    }
  };

  const handleAddNew = async () => {
    if (!newKey.trim() || !newValue.trim()) return;
    setSaving(true);
    try {
      await invoke("save_raw_tag", { path: track.path, key: newKey.trim(), value: newValue.trim() });
      reload();
      setNewKey(""); setNewValue(""); setShowNew(false);
      toast(t("pro.extendedTags.addedToast"), "success");
    } catch (e) {
      toast(t("pro.extendedTags.errorToast", { error: e }), "error");
    } finally { setSaving(false); }
  };

  const visible = tags.filter((tg) =>
    !filter || tg.key.toLowerCase().includes(filter.toLowerCase()) ||
    tg.value.toLowerCase().includes(filter.toLowerCase())
  );

  return (
    <div className="fixed inset-0 z-[500] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-[#1c1715] border border-white/[0.08] rounded-2xl w-[580px] max-h-[88vh] flex flex-col shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-white/[0.06] flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-[#D95340]/15 flex items-center justify-center shrink-0">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="#D95340" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="1" y="1" width="12" height="12" rx="1.5"/>
              <line x1="4" y1="5" x2="10" y2="5"/><line x1="4" y1="7.5" x2="10" y2="7.5"/><line x1="4" y1="10" x2="7" y2="10"/>
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-[13px] font-bold text-[#F5F5F4]">{t("pro.extendedTags.title")}</h2>
            <p className="text-[10px] text-[#605A55] truncate">{track.filename}</p>
          </div>
          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-[#D95340]/20 text-[#D95340] shrink-0">{t("pro.badge")}</span>
        </div>

        <div className="px-5 pt-3 pb-2">
          <input type="text" value={filter} onChange={(e) => setFilter(e.target.value)}
            placeholder={t("pro.extendedTags.filterPlaceholder")}
            className="w-full px-3 py-1.5 rounded-lg text-[12px] focus:outline-none focus:border-[#D95340]/50"
            style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", color: "#C2BEBC" }}
          />
        </div>

        <div className="flex-1 overflow-y-auto no-scrollbar px-5 pb-3 space-y-1">
          {loading ? (
            <div className="py-8 text-center text-[12px] text-[#4C4743]">{t("pro.extendedTags.loading")}</div>
          ) : visible.length === 0 ? (
            <div className="py-8 text-center text-[12px] text-[#4C4743]">{t("pro.extendedTags.empty")}</div>
          ) : visible.map((tg) => {
            const isBinary = tg.value === "(binary)";
            const label = KNOWN[tg.key];
            const isEditing = editKey === tg.key;
            return (
              <div key={tg.key}
                className={`group flex items-start gap-2.5 px-3 py-2 rounded-lg transition-colors ${isEditing ? "bg-[#D95340]/[0.06]" : "hover:bg-white/[0.02]"}`}
                style={{ border: isEditing ? "1px solid rgba(217,83,64,0.20)" : "1px solid transparent" }}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span className="text-[10px] font-mono font-bold text-[#D95340]">{tg.key}</span>
                    {label && <span className="text-[9px] text-[#4C4743]">— {label}</span>}
                  </div>
                  {isEditing ? (
                    <div className="flex items-center gap-1.5 mt-1">
                      <input autoFocus value={editValue} onChange={(e) => setEditValue(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") handleSave(tg.key); if (e.key === "Escape") setEditKey(null); }}
                        className="flex-1 px-2 py-1 rounded text-[11px] focus:outline-none"
                        style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(217,83,64,0.40)", color: "#E8E4E1" }}
                      />
                      <button onClick={() => handleSave(tg.key)} disabled={saving}
                        className="px-2.5 py-1 text-[10px] font-bold rounded bg-[#D95340] text-white disabled:opacity-40">
                        {saving ? "…" : t("common.save")}
                      </button>
                      <button onClick={() => setEditKey(null)} className="px-2 py-1 text-[10px] text-[#605A55] hover:text-[#C2BEBC]">✕</button>
                    </div>
                  ) : (
                    <p className={`text-[11px] truncate ${isBinary ? "text-[#4C4743] italic" : "text-[#C2BEBC]"}`}>
                      {isBinary ? t("pro.extendedTags.binary") : tg.value}
                    </p>
                  )}
                </div>
                {!isEditing && !isBinary && (
                  <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 mt-0.5">
                    <button onClick={() => { setEditKey(tg.key); setEditValue(tg.value); }}
                      className="p-1 rounded hover:bg-white/[0.08] text-[#605A55] hover:text-[#C2BEBC] transition-colors">
                      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M7 1.5l1.5 1.5L3 8.5H1.5V7L7 1.5z"/>
                      </svg>
                    </button>
                    <button onClick={() => handleDelete(tg.key)}
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

        {showNew && (
          <div className="px-5 py-3 border-t border-white/[0.05]">
            <div className="flex items-center gap-2">
              <input value={newKey} onChange={(e) => setNewKey(e.target.value.toUpperCase())}
                placeholder={t("pro.extendedTags.newFieldKey")} maxLength={4}
                className="w-28 px-2 py-1.5 rounded text-[11px] font-mono focus:outline-none"
                style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.10)", color: "#E8E4E1" }}
              />
              <input value={newValue} onChange={(e) => setNewValue(e.target.value)}
                placeholder={t("pro.extendedTags.newFieldValue")}
                onKeyDown={(e) => e.key === "Enter" && handleAddNew()}
                className="flex-1 px-2 py-1.5 rounded text-[11px] focus:outline-none"
                style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.10)", color: "#E8E4E1" }}
              />
              <button onClick={handleAddNew} disabled={saving || !newKey || !newValue}
                className="px-3 py-1.5 text-[11px] font-bold rounded-lg bg-[#D95340] text-white disabled:opacity-40">
                {t("pro.extendedTags.addBtn")}
              </button>
              <button onClick={() => setShowNew(false)} className="p-1.5 text-[#605A55] hover:text-[#C2BEBC]">✕</button>
            </div>
          </div>
        )}

        <div className="px-5 py-3 border-t border-white/[0.06] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-[#4C4743]">{t("pro.extendedTags.fieldCount", { count: visible.length })}</span>
            {!showNew && (
              <button onClick={() => setShowNew(true)} className="text-[10px] text-[#605A55] hover:text-[#C2BEBC] transition-colors">
                {t("pro.extendedTags.newField")}
              </button>
            )}
          </div>
          <button onClick={onClose} className="px-4 py-1.5 text-[12px] text-[#756D67] hover:text-[#C2BEBC] transition-colors rounded-lg hover:bg-white/[0.04]">
            {t("common.close")}
          </button>
        </div>
      </div>
    </div>
  );
}
