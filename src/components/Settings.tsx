import { useState, useEffect, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { useAppStore } from "../store";
import { type VisibilityState } from "@tanstack/react-table";

interface DjSoftwareInfo { id: string; name: string; installed: boolean; }

type Tab = "appearance" | "services" | "columns" | "license";

const COLUMN_ORDER: { id: string; label: string }[] = [
  { id: "album",         label: "Álbum"    },
  { id: "genre",         label: "Gênero"   },
  { id: "artist",        label: "Artista standalone" },
  { id: "year_col",      label: "Ano"      },
  { id: "waveform",      label: "Onda"     },
  { id: "status",        label: "Status ●" },
  { id: "key",           label: "Tom"      },
  { id: "bpm",           label: "BPM"      },
  { id: "rating",        label: "Rating"   },
  { id: "duration_secs", label: "Duração"  },
  { id: "file_size",     label: "Tamanho"  },
];

const DJ_OPTIONS = [
  { id: "serato",    label: "Serato DJ Pro" },
  { id: "rekordbox", label: "rekordbox" },
  { id: "traktor",   label: "Traktor Pro" },
  { id: "vdj",       label: "Virtual DJ" },
  { id: "djay",      label: "djay Pro" },
  { id: "none",      label: "Nenhum" },
];

export default function Settings({ onClose }: { onClose: () => void }) {
  const {
    columnVisibility, setColumnVisibility,
    theme, setTheme,
    djPrimary, djAutoImport, djShowAll, setDjPrefs,
    activateLicense, isTrialActivated,
    daysElapsed, daysRemaining, tracksAnalyzed, tagsEnriched, estimatedTimeSaved,
  } = useAppStore();

  const [tab, setTab] = useState<Tab>("appearance");
  const [saved, setSaved] = useState<string | null>(null);
  const [appVersion, setAppVersion] = useState<string>("");

  useEffect(() => {
    getVersion().then(setAppVersion).catch(() => {});
  }, []);

  const [djP, setDjP] = useState(djPrimary);
  const [djA, setDjA] = useState(djAutoImport);
  const [djS, setDjS] = useState(djShowAll);
  const [detectedDj, setDetectedDj] = useState<DjSoftwareInfo[]>([]);

  useEffect(() => {
    invoke<DjSoftwareInfo[]>("detect_dj_software").then(setDetectedDj).catch(() => {});
  }, []);

  // Instalados primeiro, "Nenhum" sempre por último
  const sortedDjOptions = useMemo(() => {
    const installed = DJ_OPTIONS.filter(
      (o) => o.id !== "none" && (detectedDj.find((d) => d.id === o.id)?.installed ?? false)
    );
    const notInstalled = DJ_OPTIONS.filter(
      (o) => o.id !== "none" && !(detectedDj.find((d) => d.id === o.id)?.installed ?? false)
    );
    const none = DJ_OPTIONS.find((o) => o.id === "none")!;
    return [...installed, ...notInstalled, none];
  }, [detectedDj]);

  const [licenseInput, setLicenseInput] = useState("");

  const mergedVisibility: VisibilityState = { ...columnVisibility };

  function toggleColumn(id: string) {
    const current = mergedVisibility[id] !== false;
    setColumnVisibility({ ...mergedVisibility, [id]: !current });
  }

  function showSaved(label: string) {
    setSaved(label);
    setTimeout(() => setSaved(null), 2000);
  }

  const TABS: { id: Tab; label: string }[] = [
    { id: "appearance", label: "Aparência" },
    { id: "services",   label: "Serviços"  },
    { id: "columns",    label: "Colunas"   },
    { id: "license",    label: "Licença"   },
  ];

  return (
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="relative flex flex-col rounded-xl shadow-2xl overflow-hidden bg-[#1c1715] border border-white/[0.08]"
        style={{ width: 580, maxHeight: "82vh" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06]">
          <span className="text-[13px] font-semibold uppercase tracking-widest text-[#8F8883]">
            Configurações
          </span>
          <button
            onClick={onClose}
            className="flex items-center justify-center w-6 h-6 rounded-md text-[#605A55] hover:bg-white/[0.06] transition-colors"
            title="Fechar"
          >
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
              <line x1="1" y1="1" x2="10" y2="10"/><line x1="10" y1="1" x2="1" y2="10"/>
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex px-5 border-b border-white/[0.06]">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-4 py-3 text-[12px] font-semibold transition-colors border-b-2 -mb-px ${
                tab === t.id
                  ? "text-[#D95340] border-[#D95340]"
                  : "text-[#605A55] border-transparent hover:text-[#8F8883]"
              }`}
            >{t.label}</button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">

          {/* ── APARÊNCIA ── */}
          {tab === "appearance" && (
            <div className="space-y-5">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest mb-3 text-[#8F8883]">Tema</p>
                <div className="flex gap-2">
                  {([
                    { id: "auto",  label: "Automático", desc: /^Mac/.test(navigator.platform) ? "Segue o macOS" : "Segue o Windows" },
                    { id: "light", label: "Claro",       desc: "Fundo branco" },
                    { id: "dark",  label: "Skin",        desc: "Visual TagWave" },
                  ] as const).map((t) => (
                    <button
                      key={t.id}
                      onClick={() => setTheme(t.id)}
                      className={`flex-1 py-2.5 px-3 rounded-lg text-left transition-colors flex flex-col gap-0.5 ${
                        theme === t.id
                          ? "bg-[#D95340]/[0.12] border border-[#D95340]/[0.30]"
                          : "bg-white/[0.03] border border-white/[0.06] hover:bg-white/[0.05]"
                      }`}
                    >
                      <span className={`text-[12px] font-semibold ${theme === t.id ? "text-[#D95340]" : "text-[#C2BEBC]"}`}>
                        {t.label}
                      </span>
                      <span className={`text-[10px] ${theme === t.id ? "text-[#D95340]/60" : "text-[#4C4743]"}`}>
                        {t.desc}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ── SERVIÇOS ── */}
          {tab === "services" && (
            <div className="space-y-6">
              <section>
                <p className="text-[10px] font-bold uppercase tracking-widest mb-2 text-[#8F8883]">Enriquecimento de Metadados</p>
                <div className="rounded-lg px-4 py-3 space-y-2 bg-white/[0.03] border border-white/[0.06]">
                  {[
                    { icon: "♪", label: "iTunes / Apple Music", desc: "Gênero, Álbum, Ano e Capa — automático, sem login" },
                    { icon: "▷", label: "Spotify", desc: "BPM, Tom (Camelot), Álbum, Ano e Capa — automático, sem login" },
                    { icon: "◎", label: "MusicBrainz", desc: "Identificação por fingerprint de áudio" },
                    { icon: "≋", label: "Análise local", desc: "BPM e Tom calculados diretamente no arquivo" },
                  ].map(({ icon, label, desc }) => (
                    <div key={label} className="flex items-start gap-3">
                      <span className="text-[14px] mt-0.5 w-5 text-center shrink-0 text-[#D95340]">{icon}</span>
                      <div>
                        <p className="text-[12px] font-semibold text-[#C2BEBC]">{label}</p>
                        <p className="text-[11px] text-[#605A55]">{desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
                <p className="text-[10px] mt-2 text-[#4C4743]">
                  Nenhuma conta ou chave de API é necessária. O TagWave cuida de tudo automaticamente.
                </p>
              </section>

              {/* DJ Software */}
              <section>
                <p className="text-[10px] font-bold uppercase tracking-widest mb-1 text-[#8F8883]">Software DJ</p>
                <p className="text-[11px] mb-3 text-[#605A55]">Software principal para importação de BPM, Key e Cue Points. Softwares instalados são detectados automaticamente.</p>
                <div className="space-y-1.5 mb-3">
                  {sortedDjOptions.map((opt) => {
                    const detected = detectedDj.find((d) => d.id === opt.id);
                    const isInstalled = detected?.installed ?? false;
                    return (
                      <label
                        key={opt.id}
                        className="flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-colors hover:bg-white/[0.03] border border-white/[0.04]"
                      >
                        <input type="radio" name="djprimary" value={opt.id} checked={djP === opt.id}
                          onChange={() => setDjP(opt.id)} className="accent-[#D95340]" />
                        <span className="text-[13px] flex-1 text-[#C2BEBC]">{opt.label}</span>
                        {opt.id !== "none" && (
                          <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded ${
                            isInstalled
                              ? "bg-[#5BA055]/[0.15] text-[#5BA055]"
                              : "bg-white/[0.04] text-[#4C4743]"
                          }`}>
                            {isInstalled ? "Instalado" : "Não encontrado"}
                          </span>
                        )}
                      </label>
                    );
                  })}
                </div>
                <div className="space-y-2 mb-3">
                  <label className="flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer hover:bg-white/[0.03] border border-white/[0.04]">
                    <input type="checkbox" checked={djA} onChange={(e) => setDjA(e.target.checked)} className="accent-[#D95340] w-3.5 h-3.5" />
                    <div>
                      <p className="text-[13px] text-[#C2BEBC]">Auto-importar dados ao selecionar faixa</p>
                      <p className="text-[10px] text-[#605A55]">Carrega BPM e Key automaticamente ao clicar numa música</p>
                    </div>
                  </label>
                  <label className="flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer hover:bg-white/[0.03] border border-white/[0.04]">
                    <input type="checkbox" checked={djS} onChange={(e) => setDjS(e.target.checked)} className="accent-[#D95340] w-3.5 h-3.5" />
                    <div>
                      <p className="text-[13px] text-[#C2BEBC]">Mostrar análises de todas as fontes</p>
                      <p className="text-[10px] text-[#605A55]">Exibe valores de Serato e Rekordbox lado a lado no Inspector</p>
                    </div>
                  </label>
                </div>
                <button
                  onClick={() => { setDjPrefs(djP, djA, djS); showSaved("DJ"); }}
                  className="px-4 py-1.5 rounded-md text-[12px] font-bold uppercase tracking-wide text-white transition-colors"
                  style={{ backgroundColor: saved === "DJ" ? "#5BA055" : "#D95340" }}
                >{saved === "DJ" ? "✓ Salvo" : "Salvar Preferências"}</button>
              </section>
            </div>
          )}

          {/* ── COLUNAS ── */}
          {tab === "columns" && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest mb-3 text-[#8F8883]">Visibilidade das colunas</p>
              <div className="space-y-1">
                {COLUMN_ORDER.map(({ id, label }) => {
                  const isVisible = mergedVisibility[id] !== false;
                  return (
                    <label
                      key={id}
                      className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors hover:bg-white/[0.03] border border-white/[0.04]"
                    >
                      <input type="checkbox" checked={isVisible} onChange={() => toggleColumn(id)} className="accent-[#D95340] w-3.5 h-3.5" />
                      <span className="text-[13px] text-[#C2BEBC]">{label}</span>
                    </label>
                  );
                })}
              </div>
              <div className="flex gap-3 mt-4">
                <button
                  onClick={() => {
                    const all: VisibilityState = {};
                    COLUMN_ORDER.forEach(({ id }) => { all[id] = true; });
                    setColumnVisibility(all);
                  }}
                  className="text-[11px] transition-colors px-3 py-1.5 rounded-md text-[#8F8883] bg-white/[0.04] border border-white/[0.06] hover:bg-white/[0.06]"
                >Mostrar todas</button>
                <button
                  onClick={() => setColumnVisibility({})}
                  className="text-[11px] transition-colors px-3 py-1.5 rounded-md text-[#605A55] bg-white/[0.02] border border-white/[0.04] hover:bg-white/[0.04]"
                >Restaurar padrão</button>
              </div>
            </div>
          )}

          {/* ── LICENÇA ── */}
          {tab === "license" && (
            <div className="space-y-5">
              <div className="rounded-lg px-4 py-4 flex flex-col gap-3 bg-white/[0.03] border border-white/[0.06]">
                <p className="text-[10px] font-bold uppercase tracking-widest text-[#8F8883]">Status do Trial</p>
                <div className="grid grid-cols-2 gap-y-3">
                  {[
                    { label: "Dias decorridos",  value: `${daysElapsed()} dias` },
                    { label: "Dias restantes",    value: `${daysRemaining()} dias` },
                    { label: "Faixas analisadas", value: `${tracksAnalyzed}` },
                    { label: "Tags enriquecidas", value: `${tagsEnriched}` },
                    { label: "Tempo economizado", value: estimatedTimeSaved() },
                  ].map(({ label, value }) => (
                    <div key={label} className="flex flex-col gap-0.5">
                      <span className="text-[10px] uppercase tracking-wide text-[#605A55]">{label}</span>
                      <span className="text-[13px] font-mono text-[#C2BEBC]">{value}</span>
                    </div>
                  ))}
                </div>
              </div>
              {isTrialActivated() ? (
                <div className="flex items-center gap-2.5 px-4 py-3 rounded-lg bg-[#5BA055]/[0.10] border border-[#5BA055]/20">
                  <span className="text-[#5BA055] text-sm">✓</span>
                  <span className="text-[13px] font-semibold text-[#5BA055]">Licença ativa</span>
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-[#8F8883]">Ativar Licença</p>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={licenseInput}
                      onChange={(e) => setLicenseInput(e.target.value)}
                      placeholder="TAGW-XXXX-XXXX-XXXX"
                      className="flex-1 px-3 py-2 rounded-lg text-[12px] font-mono outline-none transition-all bg-white/[0.05] border border-white/[0.08] text-[#F5F5F4] placeholder-[#373331] focus:border-[#D95340]/50"
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && licenseInput.trim()) {
                          activateLicense(licenseInput.trim());
                          setLicenseInput("");
                        }
                      }}
                    />
                    <button
                      onClick={() => { if (licenseInput.trim()) { activateLicense(licenseInput.trim()); setLicenseInput(""); }}}
                      disabled={!licenseInput.trim()}
                      className="px-4 py-2 rounded-lg text-[12px] font-bold uppercase tracking-wide text-white disabled:opacity-40 bg-[#D95340] hover:bg-[#E07364] transition-colors"
                    >Ativar</button>
                  </div>
                </div>
              )}
            </div>
          )}

        </div>

        {/* Footer */}
        <div className="px-5 py-3 flex justify-end border-t border-white/[0.04]">
          <span className="text-[10px] font-mono text-[#4C4743]">
            TagWave v{appVersion}
          </span>
        </div>

      </div>
    </div>
  );
}
