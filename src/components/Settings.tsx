import { useState } from "react";
import { useAppStore } from "../store";
import { type VisibilityState } from "@tanstack/react-table";

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
  { id: "none",      label: "Nenhum" },
  { id: "serato",    label: "Serato DJ Pro" },
  { id: "rekordbox", label: "rekordbox" },
  { id: "traktor",   label: "Traktor Pro" },
  { id: "vdj",       label: "Virtual DJ" },
];

export default function Settings({ onClose }: { onClose: () => void }) {
  const {
    columnVisibility, setColumnVisibility,
    theme, setTheme,
    spotifyClientId, spotifyClientSecret, setSpotifyCredentials,
    lastFmApiKey, setLastFmApiKey,
    discogsToken, setDiscogsToken,
    acoustidKey, setAcoustidKey,
    djPrimary, djAutoImport, djShowAll, setDjPrefs,
    activateLicense, isTrialActivated,
    daysElapsed, daysRemaining, tracksAnalyzed, tagsEnriched, estimatedTimeSaved,
  } = useAppStore();

  const [tab, setTab] = useState<Tab>("appearance");

  // Serviços drafts
  const [spotifyId,     setSpotifyId]     = useState(spotifyClientId);
  const [spotifySecret, setSpotifySecret] = useState(spotifyClientSecret);
  const [lastfmKey,     setLastfmKey]     = useState(lastFmApiKey);
  const [discogs,       setDiscogs]       = useState(discogsToken);
  const [acoustid,      setAcoustid]      = useState(acoustidKey);
  const [saved,         setSaved]         = useState<string | null>(null);

  // DJ drafts
  const [djP, setDjP] = useState(djPrimary);
  const [djA, setDjA] = useState(djAutoImport);
  const [djS, setDjS] = useState(djShowAll);

  // License
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

  // Shared input style
  const inputCls = "w-full px-3 py-2 rounded-lg text-[12px] font-mono outline-none transition-all";
  const inputStyle = {
    backgroundColor: "rgba(255,255,255,0.05)",
    border: "1px solid rgba(255,255,255,0.08)",
    color: "#F5F5F4",
  };

  return (
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center"
      style={{ backgroundColor: "rgba(0,0,0,0.6)" }}
      onClick={onClose}
    >
      <div
        className="relative flex flex-col rounded-xl shadow-2xl overflow-hidden"
        style={{ width: 580, maxHeight: "82vh", backgroundColor: "#1c1715", border: "1px solid rgba(255,255,255,0.08)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
          <span className="text-[13px] font-semibold uppercase tracking-widest" style={{ color: "#8F8883" }}>
            Configurações
          </span>
          <button onClick={onClose} className="flex items-center justify-center w-6 h-6 rounded-md hover:bg-white/[0.06] transition-colors" style={{ color: "#605A55" }} title="Fechar">
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
              <line x1="1" y1="1" x2="10" y2="10"/><line x1="10" y1="1" x2="1" y2="10"/>
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex px-5" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
          {TABS.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className="px-4 py-3 text-[12px] font-semibold transition-colors relative"
              style={{
                color: tab === t.id ? "#D95340" : "#605A55",
                borderBottom: tab === t.id ? "2px solid #D95340" : "2px solid transparent",
                marginBottom: -1,
              }}
            >{t.label}</button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">

          {/* ── APARÊNCIA ── */}
          {tab === "appearance" && (
            <div className="space-y-5">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest mb-3" style={{ color: "#8F8883" }}>Tema</p>
                <p className="text-[12px] mb-3" style={{ color: "#605A55" }}>Escolha entre tema escuro, claro ou siga o sistema.</p>
                <div className="flex gap-2">
                  {(["auto", "light", "dark"] as const).map((t) => (
                    <button
                      key={t}
                      onClick={() => setTheme(t)}
                      className="flex-1 py-2 rounded-lg text-[12px] font-semibold transition-colors"
                      style={{
                        backgroundColor: theme === t ? "rgba(217,83,64,0.15)" : "rgba(255,255,255,0.04)",
                        border: theme === t ? "1px solid rgba(217,83,64,0.3)" : "1px solid rgba(255,255,255,0.06)",
                        color: theme === t ? "#D95340" : "#8F8883",
                      }}
                    >
                      {t === "auto" ? "Automático" : t === "light" ? "Claro" : "Escuro"}
                    </button>
                  ))}
                </div>
                {theme !== "dark" && (
                  <p className="text-[10px] mt-2" style={{ color: "#605A55" }}>
                    Nota: o TagWave está otimizado para tema escuro. Suporte completo a tema claro em breve.
                  </p>
                )}
              </div>
            </div>
          )}

          {/* ── SERVIÇOS ── */}
          {tab === "services" && (
            <div className="space-y-6">
              {/* Spotify */}
              <section>
                <p className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: "#8F8883" }}>Spotify</p>
                <p className="text-[11px] mb-3" style={{ color: "#605A55" }}>
                  Usado para BPM, Tom, Álbum e Ano. Crie um app em{" "}
                  <a href="https://developer.spotify.com/dashboard" target="_blank" rel="noopener noreferrer" className="underline" style={{ color: "#8F8883" }}>developer.spotify.com</a>.
                </p>
                <div className="space-y-2">
                  <div>
                    <p className="text-[10px] mb-1" style={{ color: "#605A55" }}>Client ID</p>
                    <input type="text" value={spotifyId} onChange={(e) => setSpotifyId(e.target.value)}
                      placeholder="Cole o Client ID aqui" className={inputCls} style={inputStyle}
                      onFocus={(e) => { e.target.style.border = "1px solid rgba(217,83,64,0.5)"; }}
                      onBlur={(e) => { e.target.style.border = "1px solid rgba(255,255,255,0.08)"; }}
                    />
                  </div>
                  <div>
                    <p className="text-[10px] mb-1" style={{ color: "#605A55" }}>Client Secret</p>
                    <input type="password" value={spotifySecret} onChange={(e) => setSpotifySecret(e.target.value)}
                      placeholder="Cole o Client Secret aqui" className={inputCls} style={inputStyle}
                      onFocus={(e) => { e.target.style.border = "1px solid rgba(217,83,64,0.5)"; }}
                      onBlur={(e) => { e.target.style.border = "1px solid rgba(255,255,255,0.08)"; }}
                    />
                  </div>
                  <button
                    onClick={() => { setSpotifyCredentials(spotifyId.trim(), spotifySecret.trim()); showSaved("Spotify"); }}
                    className="px-4 py-1.5 rounded-md text-[12px] font-bold uppercase tracking-wide text-white transition-colors"
                    style={{ backgroundColor: saved === "Spotify" ? "#5BA055" : "#D95340" }}
                  >{saved === "Spotify" ? "✓ Salvo" : "Salvar"}</button>
                </div>
              </section>

              {/* Last.fm */}
              <section>
                <p className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: "#8F8883" }}>Last.fm</p>
                <p className="text-[11px] mb-3" style={{ color: "#605A55" }}>
                  Usado para gênero e popularidade. Chave gratuita em{" "}
                  <a href="https://www.last.fm/api/account/create" target="_blank" rel="noopener noreferrer" className="underline" style={{ color: "#8F8883" }}>last.fm/api</a>.
                </p>
                <div className="space-y-2">
                  <input type="text" value={lastfmKey} onChange={(e) => setLastfmKey(e.target.value)}
                    placeholder="API Key" className={inputCls} style={inputStyle}
                    onFocus={(e) => { e.target.style.border = "1px solid rgba(217,83,64,0.5)"; }}
                    onBlur={(e) => { e.target.style.border = "1px solid rgba(255,255,255,0.08)"; }}
                  />
                  <button
                    onClick={() => { setLastFmApiKey(lastfmKey.trim()); showSaved("LastFM"); }}
                    className="px-4 py-1.5 rounded-md text-[12px] font-bold uppercase tracking-wide text-white transition-colors"
                    style={{ backgroundColor: saved === "LastFM" ? "#5BA055" : "#D95340" }}
                  >{saved === "LastFM" ? "✓ Salvo" : "Salvar"}</button>
                </div>
              </section>

              {/* Discogs */}
              <section>
                <p className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: "#8F8883" }}>Discogs</p>
                <p className="text-[11px] mb-3" style={{ color: "#605A55" }}>
                  Token pessoal: discogs.com → Configurações → Desenvolvedores.
                </p>
                <div className="space-y-2">
                  <input type="password" value={discogs} onChange={(e) => setDiscogs(e.target.value)}
                    placeholder="Personal Token" className={inputCls} style={inputStyle}
                    onFocus={(e) => { e.target.style.border = "1px solid rgba(217,83,64,0.5)"; }}
                    onBlur={(e) => { e.target.style.border = "1px solid rgba(255,255,255,0.08)"; }}
                  />
                  <button
                    onClick={() => { setDiscogsToken(discogs.trim()); showSaved("Discogs"); }}
                    className="px-4 py-1.5 rounded-md text-[12px] font-bold uppercase tracking-wide text-white transition-colors"
                    style={{ backgroundColor: saved === "Discogs" ? "#5BA055" : "#D95340" }}
                  >{saved === "Discogs" ? "✓ Salvo" : "Salvar"}</button>
                </div>
              </section>

              {/* AcoustID */}
              <section>
                <p className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: "#8F8883" }}>AcoustID</p>
                <p className="text-[11px] mb-3" style={{ color: "#605A55" }}>
                  Fingerprint de áudio para identificação de faixas. Registre em{" "}
                  <a href="https://acoustid.org/login" target="_blank" rel="noopener noreferrer" className="underline" style={{ color: "#8F8883" }}>acoustid.org</a>.
                </p>
                <div className="space-y-2">
                  <input type="password" value={acoustid} onChange={(e) => setAcoustid(e.target.value)}
                    placeholder="Client Key" className={inputCls} style={inputStyle}
                    onFocus={(e) => { e.target.style.border = "1px solid rgba(217,83,64,0.5)"; }}
                    onBlur={(e) => { e.target.style.border = "1px solid rgba(255,255,255,0.08)"; }}
                  />
                  <button
                    onClick={() => { setAcoustidKey(acoustid.trim()); showSaved("AcoustID"); }}
                    className="px-4 py-1.5 rounded-md text-[12px] font-bold uppercase tracking-wide text-white transition-colors"
                    style={{ backgroundColor: saved === "AcoustID" ? "#5BA055" : "#D95340" }}
                  >{saved === "AcoustID" ? "✓ Salvo" : "Salvar"}</button>
                </div>
              </section>

              {/* DJ Software */}
              <section>
                <p className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: "#8F8883" }}>Software DJ</p>
                <p className="text-[11px] mb-3" style={{ color: "#605A55" }}>Software principal para importação de BPM, Key e Cue Points.</p>
                <div className="space-y-1.5 mb-3">
                  {DJ_OPTIONS.map((opt) => (
                    <label key={opt.id} className="flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-colors hover:bg-white/[0.03]"
                      style={{ border: "1px solid rgba(255,255,255,0.04)" }}>
                      <input type="radio" name="djprimary" value={opt.id} checked={djP === opt.id}
                        onChange={() => setDjP(opt.id)} className="accent-[#D95340]" />
                      <span className="text-[13px]" style={{ color: "#C2BEBC" }}>{opt.label}</span>
                    </label>
                  ))}
                </div>
                <div className="space-y-2 mb-3">
                  <label className="flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer hover:bg-white/[0.03]"
                    style={{ border: "1px solid rgba(255,255,255,0.04)" }}>
                    <input type="checkbox" checked={djA} onChange={(e) => setDjA(e.target.checked)} className="accent-[#D95340] w-3.5 h-3.5" />
                    <div>
                      <p className="text-[13px]" style={{ color: "#C2BEBC" }}>Auto-importar dados ao selecionar faixa</p>
                      <p className="text-[10px]" style={{ color: "#605A55" }}>Carrega BPM e Key automaticamente ao clicar numa música</p>
                    </div>
                  </label>
                  <label className="flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer hover:bg-white/[0.03]"
                    style={{ border: "1px solid rgba(255,255,255,0.04)" }}>
                    <input type="checkbox" checked={djS} onChange={(e) => setDjS(e.target.checked)} className="accent-[#D95340] w-3.5 h-3.5" />
                    <div>
                      <p className="text-[13px]" style={{ color: "#C2BEBC" }}>Mostrar análises de todas as fontes</p>
                      <p className="text-[10px]" style={{ color: "#605A55" }}>Exibe valores de Serato e Rekordbox lado a lado no Inspector</p>
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
              <p className="text-[10px] font-bold uppercase tracking-widest mb-3" style={{ color: "#8F8883" }}>Visibilidade das colunas</p>
              <div className="space-y-1">
                {COLUMN_ORDER.map(({ id, label }) => {
                  const isVisible = mergedVisibility[id] !== false;
                  return (
                    <label key={id} className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors hover:bg-white/[0.03]"
                      style={{ border: "1px solid rgba(255,255,255,0.04)" }}>
                      <input type="checkbox" checked={isVisible} onChange={() => toggleColumn(id)} className="accent-[#D95340] w-3.5 h-3.5" />
                      <span className="text-[13px]" style={{ color: "#C2BEBC" }}>{label}</span>
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
                  className="text-[11px] transition-colors px-3 py-1.5 rounded-md"
                  style={{ color: "#8F8883", backgroundColor: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}
                >Mostrar todas</button>
                <button
                  onClick={() => setColumnVisibility({})}
                  className="text-[11px] transition-colors px-3 py-1.5 rounded-md"
                  style={{ color: "#605A55", backgroundColor: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)" }}
                >Restaurar padrão</button>
              </div>
            </div>
          )}

          {/* ── LICENÇA ── */}
          {tab === "license" && (
            <div className="space-y-5">
              <div className="rounded-lg px-4 py-4 flex flex-col gap-3"
                style={{ backgroundColor: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
                <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "#8F8883" }}>Status do Trial</p>
                <div className="grid grid-cols-2 gap-y-3">
                  {[
                    { label: "Dias decorridos",  value: `${daysElapsed()} dias` },
                    { label: "Dias restantes",    value: `${daysRemaining()} dias` },
                    { label: "Faixas analisadas", value: `${tracksAnalyzed}` },
                    { label: "Tags enriquecidas", value: `${tagsEnriched}` },
                    { label: "Tempo economizado", value: estimatedTimeSaved() },
                  ].map(({ label, value }) => (
                    <div key={label} className="flex flex-col gap-0.5">
                      <span className="text-[10px] uppercase tracking-wide" style={{ color: "#605A55" }}>{label}</span>
                      <span className="text-[13px] font-mono" style={{ color: "#C2BEBC" }}>{value}</span>
                    </div>
                  ))}
                </div>
              </div>
              {isTrialActivated() ? (
                <div className="flex items-center gap-2.5 px-4 py-3 rounded-lg"
                  style={{ backgroundColor: "rgba(91,160,85,0.1)", border: "1px solid rgba(91,160,85,0.2)" }}>
                  <span style={{ color: "#5BA055", fontSize: 14 }}>✓</span>
                  <span className="text-[13px] font-semibold" style={{ color: "#5BA055" }}>Licença ativa</span>
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "#8F8883" }}>Ativar Licença</p>
                  <div className="flex gap-2">
                    <input type="text" value={licenseInput} onChange={(e) => setLicenseInput(e.target.value)}
                      placeholder="TAGW-XXXX-XXXX-XXXX" className={`flex-1 ${inputCls}`} style={inputStyle}
                      onFocus={(e) => { e.target.style.border = "1px solid rgba(217,83,64,0.5)"; }}
                      onBlur={(e) => { e.target.style.border = "1px solid rgba(255,255,255,0.08)"; }}
                      onKeyDown={(e) => { if (e.key === "Enter" && licenseInput.trim()) { activateLicense(licenseInput.trim()); setLicenseInput(""); }}}
                    />
                    <button onClick={() => { if (licenseInput.trim()) { activateLicense(licenseInput.trim()); setLicenseInput(""); }}}
                      disabled={!licenseInput.trim()}
                      className="px-4 py-2 rounded-lg text-[12px] font-bold uppercase tracking-wide text-white disabled:opacity-40"
                      style={{ backgroundColor: "#D95340" }}
                    >Ativar</button>
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
