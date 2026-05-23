import { useState } from "react";
import { useAppStore } from "../store";
import { type VisibilityState } from "@tanstack/react-table";

type Tab = "columns" | "apis" | "license";

const COLUMN_ORDER: { id: string; label: string }[] = [
  { id: "artist",        label: "Artista"  },
  { id: "album",         label: "Álbum"    },
  { id: "genre",         label: "Gênero"   },
  { id: "year_col",      label: "Ano"      },
  { id: "waveform",      label: "Onda"     },
  { id: "status",        label: "Status"   },
  { id: "key",           label: "Tom"      },
  { id: "bpm",           label: "BPM"      },
  { id: "rating",        label: "Rating"   },
  { id: "duration_secs", label: "Duração"  },
  { id: "file_size",     label: "Tamanho"  },
];

const DEFAULT_VISIBILITY: VisibilityState = {
  artist:        false,
  year_col:      false,
  status:        false,
  file_size:     false,
};

export default function Settings({ onClose }: { onClose: () => void }) {
  const {
    columnVisibility,
    setColumnVisibility,
    lastFmApiKey,
    setLastFmApiKey,
    activateLicense,
    isTrialActivated,
    daysElapsed,
    daysRemaining,
    tracksAnalyzed,
    tagsEnriched,
    estimatedTimeSaved,
  } = useAppStore();

  const [tab, setTab] = useState<Tab>("columns");
  const [apiKeyDraft, setApiKeyDraft] = useState(lastFmApiKey);
  const [licenseInput, setLicenseInput] = useState("");

  const mergedVisibility: VisibilityState = { ...DEFAULT_VISIBILITY, ...columnVisibility };

  function toggleColumn(id: string) {
    const current = mergedVisibility[id] !== false;
    setColumnVisibility({ ...mergedVisibility, [id]: !current });
  }

  function handleSaveApiKey() {
    setLastFmApiKey(apiKeyDraft.trim());
  }

  function handleActivateLicense() {
    const key = licenseInput.trim();
    if (key.length > 0) {
      activateLicense(key);
      setLicenseInput("");
    }
  }

  return (
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center"
      style={{ backgroundColor: "rgba(0,0,0,0.6)" }}
      onClick={onClose}
    >
      <div
        className="relative flex flex-col rounded-xl shadow-2xl overflow-hidden"
        style={{
          width: 560,
          maxHeight: "80vh",
          backgroundColor: "#1c1715",
          border: "1px solid rgba(255,255,255,0.08)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4"
          style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}
        >
          <span
            className="text-[13px] font-semibold uppercase tracking-widest"
            style={{ color: "#8F8883" }}
          >
            Configurações
          </span>
          <button
            onClick={onClose}
            className="flex items-center justify-center w-6 h-6 rounded-md transition-colors hover:bg-white/[0.06]"
            style={{ color: "#605A55" }}
            title="Fechar"
          >
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
              <line x1="1" y1="1" x2="10" y2="10"/>
              <line x1="10" y1="1" x2="1" y2="10"/>
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div
          className="flex gap-0 px-5"
          style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}
        >
          {(
            [
              { id: "columns" as Tab, label: "Colunas" },
              { id: "apis"    as Tab, label: "APIs"    },
              { id: "license" as Tab, label: "Licença" },
            ]
          ).map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className="px-4 py-3 text-[12px] font-semibold transition-colors relative"
              style={{
                color: tab === t.id ? "#D95340" : "#605A55",
                borderBottom: tab === t.id ? "2px solid #D95340" : "2px solid transparent",
                marginBottom: -1,
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-5">

          {/* ── ABA: COLUNAS ── */}
          {tab === "columns" && (
            <div className="flex flex-col gap-1">
              <p
                className="text-[10px] font-bold uppercase tracking-widest mb-3"
                style={{ color: "#8F8883" }}
              >
                Visibilidade das colunas
              </p>
              {COLUMN_ORDER.map(({ id, label }) => {
                const isVisible = mergedVisibility[id] !== false;
                return (
                  <label
                    key={id}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors hover:bg-white/[0.03]"
                    style={{ border: "1px solid rgba(255,255,255,0.04)" }}
                  >
                    <input
                      type="checkbox"
                      checked={isVisible}
                      onChange={() => toggleColumn(id)}
                      className="accent-[#D95340] w-3.5 h-3.5"
                    />
                    <span className="text-[13px]" style={{ color: "#C2BEBC" }}>{label}</span>
                  </label>
                );
              })}
              <button
                onClick={() => {
                  const all: VisibilityState = {};
                  COLUMN_ORDER.forEach(({ id }) => { all[id] = true; });
                  setColumnVisibility(all);
                }}
                className="mt-3 text-[11px] transition-colors self-start"
                style={{ color: "#605A55" }}
                onMouseEnter={(e) => { (e.target as HTMLElement).style.color = "#8F8883"; }}
                onMouseLeave={(e) => { (e.target as HTMLElement).style.color = "#605A55"; }}
              >
                Mostrar todas
              </button>
            </div>
          )}

          {/* ── ABA: APIs ── */}
          {tab === "apis" && (
            <div className="flex flex-col gap-5">
              <div className="flex flex-col gap-3">
                <p
                  className="text-[10px] font-bold uppercase tracking-widest"
                  style={{ color: "#8F8883" }}
                >
                  Last.fm
                </p>
                <label className="flex flex-col gap-1.5">
                  <span className="text-[12px]" style={{ color: "#8F8883" }}>API Key</span>
                  <input
                    type="text"
                    value={apiKeyDraft}
                    onChange={(e) => setApiKeyDraft(e.target.value)}
                    placeholder="Sua chave Last.fm aqui…"
                    className="w-full px-3 py-2 rounded-lg text-[12px] font-mono outline-none transition-colors"
                    style={{
                      backgroundColor: "rgba(255,255,255,0.05)",
                      border: "1px solid rgba(255,255,255,0.08)",
                      color: "#F5F5F4",
                    }}
                    onFocus={(e) => {
                      e.target.style.border = "1px solid rgba(217,83,64,0.5)";
                    }}
                    onBlur={(e) => {
                      e.target.style.border = "1px solid rgba(255,255,255,0.08)";
                    }}
                  />
                  <p className="text-[11px]" style={{ color: "#605A55" }}>
                    Necessário para enriquecimento de gênero via Last.fm.{" "}
                    <a
                      href="https://www.last.fm/api"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline"
                      style={{ color: "#8F8883" }}
                    >
                      Obtenha sua chave em last.fm/api
                    </a>
                    .
                  </p>
                </label>
                <button
                  onClick={handleSaveApiKey}
                  className="self-start px-4 py-1.5 rounded-md text-[12px] font-bold uppercase tracking-wide text-white transition-colors"
                  style={{ backgroundColor: "#D95340" }}
                  onMouseEnter={(e) => { (e.target as HTMLElement).style.backgroundColor = "#E07364"; }}
                  onMouseLeave={(e) => { (e.target as HTMLElement).style.backgroundColor = "#D95340"; }}
                >
                  Salvar
                </button>
              </div>
            </div>
          )}

          {/* ── ABA: LICENÇA ── */}
          {tab === "license" && (
            <div className="flex flex-col gap-5">
              {/* Trial status */}
              <div
                className="rounded-lg px-4 py-4 flex flex-col gap-3"
                style={{ backgroundColor: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}
              >
                <p
                  className="text-[10px] font-bold uppercase tracking-widest"
                  style={{ color: "#8F8883" }}
                >
                  Status do Trial
                </p>
                <div className="grid grid-cols-2 gap-y-3">
                  {[
                    { label: "Dias decorridos",   value: `${daysElapsed()} dias`      },
                    { label: "Dias restantes",     value: `${daysRemaining()} dias`    },
                    { label: "Faixas analisadas",  value: `${tracksAnalyzed}`          },
                    { label: "Tags enriquecidas",  value: `${tagsEnriched}`            },
                    { label: "Tempo economizado",  value: estimatedTimeSaved()         },
                  ].map(({ label, value }) => (
                    <div key={label} className="flex flex-col gap-0.5">
                      <span className="text-[10px] uppercase tracking-wide" style={{ color: "#605A55" }}>{label}</span>
                      <span className="text-[13px] font-mono" style={{ color: "#C2BEBC" }}>{value}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* License activation */}
              {isTrialActivated() ? (
                <div
                  className="flex items-center gap-2.5 px-4 py-3 rounded-lg"
                  style={{ backgroundColor: "rgba(91,160,85,0.1)", border: "1px solid rgba(91,160,85,0.2)" }}
                >
                  <span style={{ color: "#5BA055", fontSize: 14 }}>✓</span>
                  <span className="text-[13px] font-semibold" style={{ color: "#5BA055" }}>Licença ativa</span>
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  <p
                    className="text-[10px] font-bold uppercase tracking-widest"
                    style={{ color: "#8F8883" }}
                  >
                    Ativar Licença
                  </p>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={licenseInput}
                      onChange={(e) => setLicenseInput(e.target.value)}
                      placeholder="TAGW-XXXX-XXXX-XXXX"
                      className="flex-1 px-3 py-2 rounded-lg text-[12px] font-mono outline-none transition-colors"
                      style={{
                        backgroundColor: "rgba(255,255,255,0.05)",
                        border: "1px solid rgba(255,255,255,0.08)",
                        color: "#F5F5F4",
                      }}
                      onFocus={(e) => {
                        e.target.style.border = "1px solid rgba(217,83,64,0.5)";
                      }}
                      onBlur={(e) => {
                        e.target.style.border = "1px solid rgba(255,255,255,0.08)";
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleActivateLicense();
                      }}
                    />
                    <button
                      onClick={handleActivateLicense}
                      disabled={licenseInput.trim().length === 0}
                      className="px-4 py-2 rounded-lg text-[12px] font-bold uppercase tracking-wide text-white transition-colors disabled:opacity-40"
                      style={{ backgroundColor: "#D95340" }}
                      onMouseEnter={(e) => { if (licenseInput.trim().length > 0) (e.target as HTMLElement).style.backgroundColor = "#E07364"; }}
                      onMouseLeave={(e) => { (e.target as HTMLElement).style.backgroundColor = "#D95340"; }}
                    >
                      Ativar
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
