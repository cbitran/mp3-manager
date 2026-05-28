import { useState, useEffect, useMemo, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { useTranslation } from "react-i18next";
import i18n from "i18next";
import { changeLanguage } from "../i18n";
import { useAppStore } from "../store";
import { type VisibilityState } from "@tanstack/react-table";
import { DEFAULT_SHORTCUTS, formatShortcut, captureKey } from "../shortcuts";

interface DjSoftwareInfo { id: string; name: string; installed: boolean; }

type Tab = "appearance" | "services" | "columns" | "license" | "shortcuts" | "language" | "accessibility" | "privacy";

const DJ_OPTION_IDS = ["serato", "rekordbox", "traktor", "vdj", "djay", "engine_dj", "none"] as const;

export default function Settings({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();

  const {
    columnVisibility, setColumnVisibility,
    theme, setTheme,
    fontScale, setFontScale,
    colorMode, setColorMode,
    djPrimary, djAutoImport, djShowAll, setDjPrefs,
    activateLicense, isTrialActivated,
    daysElapsed, daysRemaining, tracksAnalyzed, tagsEnriched, estimatedTimeSaved,
    shortcutOverrides, setShortcutOverride, resetSingleShortcut, resetShortcutOverrides,
    enrichmentOptIn, setEnrichmentOptIn, privacyAcceptedVersion,
    helpMarkersEnabled, setHelpMarkersEnabled,
  } = useAppStore();

  const COLUMN_ORDER: { id: string; label: string }[] = [
    { id: "title_artist",  label: t("settings.columns.colTitle")    },
    { id: "album",         label: t("settings.columns.colAlbum")    },
    { id: "genre",         label: t("settings.columns.colGenre")    },
    { id: "year_col",      label: t("settings.columns.colYear")     },
    { id: "waveform",      label: t("settings.columns.colWave")     },
    { id: "status",        label: t("settings.columns.colStatus")   },
    { id: "key",           label: t("settings.columns.colKey")      },
    { id: "bpm",           label: t("settings.columns.colBpm")      },
    { id: "rating",        label: t("settings.columns.colRating")   },
    { id: "cue_points",    label: t("settings.columns.colCue")      },
    { id: "duration_secs", label: t("settings.columns.colDuration") },
    { id: "file_size",     label: t("settings.columns.colSize")     },
    { id: "bitrate",       label: t("settings.columns.colBitrate")  },
    { id: "comment",       label: t("settings.columns.colComment")  },
  ];

  const DJ_OPTIONS = DJ_OPTION_IDS.map((id) => ({
    id,
    label: t(`dj.${id}`),
  }));

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

  const sortedDjOptions = useMemo(() => {
    const installed = DJ_OPTIONS.filter(
      (o) => o.id !== "none" && (detectedDj.find((d) => d.id === o.id)?.installed ?? false)
    );
    const notInstalled = DJ_OPTIONS.filter(
      (o) => o.id !== "none" && !(detectedDj.find((d) => d.id === o.id)?.installed ?? false)
    );
    const none = DJ_OPTIONS.find((o) => o.id === "none")!;
    return [...installed, ...notInstalled, none];
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detectedDj, t]);

  const [licenseInput, setLicenseInput] = useState("");
  const [showLicenseForm, setShowLicenseForm] = useState(false);
  const [recordingId, setRecordingId] = useState<string | null>(null);
  const recordingRef = useRef<string | null>(null);

  const mergedVisibility: VisibilityState = { ...columnVisibility };

  function toggleColumn(id: string) {
    const current = mergedVisibility[id] !== false;
    setColumnVisibility({ ...mergedVisibility, [id]: !current });
  }

  function showSaved(label: string) {
    setSaved(label);
    setTimeout(() => setSaved(null), 2000);
  }

  useEffect(() => {
    if (!recordingId) return;
    recordingRef.current = recordingId;
    const handler = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") { setRecordingId(null); return; }
      const key = captureKey(e);
      if (key && recordingRef.current) {
        setShortcutOverride(recordingRef.current, key);
        setRecordingId(null);
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [recordingId, setShortcutOverride]);

  const TABS: { id: Tab; label: string }[] = [
    { id: "appearance",   label: t("settings.tabs.appearance")   },
    { id: "services",     label: t("settings.tabs.services")     },
    { id: "columns",      label: t("settings.tabs.columns")      },
    { id: "shortcuts",    label: t("settings.tabs.shortcuts")    },
    { id: "language",     label: t("settings.tabs.language")     },
    { id: "accessibility",label: t("settings.tabs.accessibility")},
    { id: "license",      label: t("settings.tabs.license")      },
    { id: "privacy",      label: "Privacidade"                   },
  ];

  const LANG_OPTIONS = [
    { code: "pt-BR", flag: "🇧🇷", label: t("settings.language.ptBR") },
    { code: "en",    flag: "🇺🇸", label: t("settings.language.en")   },
    { code: "es",    flag: "🇪🇸", label: t("settings.language.es")   },
  ];

  const currentLang = i18n.language?.startsWith("pt") ? "pt-BR"
    : i18n.language?.startsWith("es") ? "es"
    : "en";

  return (
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="relative flex flex-col rounded-xl shadow-2xl overflow-hidden bg-[#1c1715] border border-white/[0.08]"
        style={{ width: 640, maxHeight: "82vh" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06]">
          <span className="text-[13px] font-semibold uppercase tracking-widest text-[#8F8883]">
            {t("settings.title")}
          </span>
          <button
            onClick={onClose}
            className="flex items-center justify-center w-6 h-6 rounded-md text-[#605A55] hover:bg-white/[0.06] transition-colors"
            title={t("common.close")}
          >
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
              <line x1="1" y1="1" x2="10" y2="10"/><line x1="10" y1="1" x2="1" y2="10"/>
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex px-4 border-b border-white/[0.06] overflow-x-auto">
          {TABS.map((tb) => (
            <button
              key={tb.id}
              onClick={() => setTab(tb.id)}
              className={`px-2.5 pt-3 pb-[14px] text-[11px] font-semibold transition-colors border-b-2 -mb-px whitespace-nowrap ${
                tab === tb.id
                  ? "text-[#D95340] border-[#D95340]"
                  : "text-[#605A55] border-transparent hover:text-[#8F8883]"
              }`}
            >{tb.label}</button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">

          {/* ── APARÊNCIA ── */}
          {tab === "appearance" && (
            <div className="space-y-5">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest mb-3 text-[#8F8883]">
                  {t("settings.appearance.theme")}
                </p>
                <div className="flex gap-2">
                  {([
                    { id: "auto",  label: t("settings.appearance.auto"),  desc: /^Mac/.test(navigator.platform) ? t("settings.appearance.followsMac") : t("settings.appearance.followsWin") },
                    { id: "light", label: t("settings.appearance.light"), desc: t("settings.appearance.whiteBackground") },
                    { id: "dark",  label: t("settings.appearance.skin"),  desc: t("settings.appearance.tagwaveVisual") },
                  ] as const).map((opt) => (
                    <button
                      key={opt.id}
                      onClick={() => setTheme(opt.id)}
                      className={`flex-1 py-2.5 px-3 rounded-lg text-left transition-colors flex flex-col gap-0.5 ${
                        theme === opt.id
                          ? "bg-[#D95340]/[0.12] border border-[#D95340]/[0.30]"
                          : "bg-white/[0.03] border border-white/[0.06] hover:bg-white/[0.05]"
                      }`}
                    >
                      <span className={`text-[12px] font-semibold ${theme === opt.id ? "text-[#D95340]" : "text-[#C2BEBC]"}`}>
                        {opt.label}
                      </span>
                      <span className={`text-[10px] ${theme === opt.id ? "text-[#D95340]/60" : "text-[#4C4743]"}`}>
                        {opt.desc}
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
                <p className="text-[10px] font-bold uppercase tracking-widest mb-2 text-[#8F8883]">
                  {t("settings.services.enrichment")}
                </p>
                <div className="rounded-lg px-4 py-3 space-y-2 bg-white/[0.03] border border-white/[0.06]">
                  {[
                    { icon: "♪", label: "iTunes / Apple Music", desc: t("settings.services.itunesDesc") },
                    { icon: "▷", label: "Spotify",              desc: t("settings.services.spotifyDesc") },
                    { icon: "◎", label: "MusicBrainz",          desc: t("settings.services.musicbrainzDesc") },
                    { icon: "≋", label: t("settings.services.localAnalysis"), desc: t("settings.services.localAnalysisDesc") },
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
                  {t("settings.services.noApiNeeded")}
                </p>
              </section>

              {/* DJ Software */}
              <section>
                <p className="text-[10px] font-bold uppercase tracking-widest mb-1 text-[#8F8883]">
                  {t("settings.services.djSoftware")}
                </p>
                <p className="text-[11px] mb-3 text-[#605A55]">
                  {t("settings.services.djPrimaryDesc")}
                </p>
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
                            {isInstalled ? t("settings.services.installed") : t("settings.services.notFound")}
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
                      <p className="text-[13px] text-[#C2BEBC]">{t("settings.services.autoImport")}</p>
                      <p className="text-[10px] text-[#605A55]">{t("settings.services.autoImportDesc")}</p>
                    </div>
                  </label>
                  <label className="flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer hover:bg-white/[0.03] border border-white/[0.04]">
                    <input type="checkbox" checked={djS} onChange={(e) => setDjS(e.target.checked)} className="accent-[#D95340] w-3.5 h-3.5" />
                    <div>
                      <p className="text-[13px] text-[#C2BEBC]">{t("settings.services.showAll")}</p>
                      <p className="text-[10px] text-[#605A55]">{t("settings.services.showAllDesc")}</p>
                    </div>
                  </label>
                </div>
                <button
                  onClick={() => { setDjPrefs(djP, djA, djS); showSaved("DJ"); }}
                  className="px-4 py-1.5 rounded-md text-[12px] font-bold uppercase tracking-wide text-white transition-colors"
                  style={{ backgroundColor: saved === "DJ" ? "#5BA055" : "#D95340" }}
                >
                  {saved === "DJ" ? t("settings.services.saved") : t("settings.services.savePrefs")}
                </button>
              </section>
            </div>
          )}

          {/* ── COLUNAS ── */}
          {tab === "columns" && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest mb-3 text-[#8F8883]">
                {t("settings.columns.visibility")}
              </p>
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
                >
                  {t("settings.columns.showAll")}
                </button>
                <button
                  onClick={() => setColumnVisibility({})}
                  className="text-[11px] transition-colors px-3 py-1.5 rounded-md text-[#605A55] bg-white/[0.02] border border-white/[0.04] hover:bg-white/[0.04]"
                >
                  {t("settings.columns.resetDefault")}
                </button>
              </div>
            </div>
          )}

          {/* ── IDIOMA ── */}
          {tab === "language" && (
            <div className="space-y-4">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest mb-1 text-[#8F8883]">
                  {t("settings.language.title")}
                </p>
                <p className="text-[11px] text-[#605A55] mb-4">
                  {t("settings.language.desc")}
                </p>
                <div className="space-y-2">
                  {LANG_OPTIONS.map((lang) => (
                    <button
                      key={lang.code}
                      onClick={() => changeLanguage(lang.code)}
                      className={`w-full flex items-center gap-4 px-4 py-3 rounded-lg text-left transition-colors border ${
                        currentLang === lang.code
                          ? "bg-[#D95340]/[0.12] border-[#D95340]/[0.30]"
                          : "bg-white/[0.03] border-white/[0.06] hover:bg-white/[0.05]"
                      }`}
                    >
                      <span className="text-2xl leading-none">{lang.flag}</span>
                      <span className={`text-[13px] font-semibold ${currentLang === lang.code ? "text-[#D95340]" : "text-[#C2BEBC]"}`}>
                        {lang.label}
                      </span>
                      {currentLang === lang.code && (
                        <span className="ml-auto text-[10px] font-semibold text-[#D95340]/70 uppercase tracking-wider">✓</span>
                      )}
                    </button>
                  ))}
                </div>
                <p className="text-[10px] mt-3 text-[#4C4743]">
                  {t("settings.language.restartHint")}
                </p>
              </div>
            </div>
          )}

          {/* ── ATALHOS ── */}
          {tab === "shortcuts" && (
            <div className="space-y-1">
              <div className="flex items-center justify-between mb-4">
                <p className="text-[10px] font-bold uppercase tracking-widest text-[#8F8883]">
                  {t("settings.shortcuts.clickToCustomize")}
                </p>
                {Object.keys(shortcutOverrides).length > 0 && (
                  <button
                    onClick={resetShortcutOverrides}
                    className="text-[10px] text-[#605A55] hover:text-[#8F8883] transition-colors"
                  >
                    {t("settings.shortcuts.resetDefaults")}
                  </button>
                )}
              </div>

              {Array.from(new Set(DEFAULT_SHORTCUTS.map((s) => s.category))).map((cat) => (
                <div key={cat} className="mb-4">
                  <p className="text-[9px] font-bold uppercase tracking-widest text-[#4C4743] mb-1.5 px-1">
                    {cat}
                  </p>
                  <div className="rounded-lg border border-white/[0.06] overflow-hidden">
                    {DEFAULT_SHORTCUTS.filter((s) => s.category === cat).map((shortcut, idx, arr) => {
                      const currentKey = shortcutOverrides[shortcut.id] ?? shortcut.defaultKey;
                      const isCustom = !!shortcutOverrides[shortcut.id];
                      const isRecording = recordingId === shortcut.id;
                      return (
                        <div
                          key={shortcut.id}
                          className={`flex items-center gap-3 px-3 py-2.5 ${
                            idx < arr.length - 1 ? "border-b border-white/[0.04]" : ""
                          } ${isRecording ? "bg-[#D95340]/[0.07]" : "hover:bg-white/[0.02]"} transition-colors`}
                        >
                          <div className="flex-1 min-w-0">
                            <p className="text-[12px] text-[#C2BEBC]">{shortcut.label}</p>
                            <p className="text-[10px] text-[#4C4743] truncate">{shortcut.description}</p>
                          </div>

                          {isCustom && !isRecording && (
                            <button
                              onClick={() => resetSingleShortcut(shortcut.id)}
                              title={t("settings.columns.resetDefault")}
                              className="text-[10px] text-[#4C4743] hover:text-[#605A55] transition-colors shrink-0"
                            >
                              ↺
                            </button>
                          )}

                          <button
                            onClick={() => setRecordingId(isRecording ? null : shortcut.id)}
                            className={`shrink-0 px-2.5 py-1 rounded-md text-[11px] font-mono font-semibold border transition-all ${
                              isRecording
                                ? "bg-[#D95340]/20 border-[#D95340]/50 text-[#E07364] animate-pulse"
                                : isCustom
                                ? "bg-[#C97B40]/10 border-[#C97B40]/30 text-[#C97B40] hover:border-[#C97B40]/60"
                                : "bg-white/[0.04] border-white/[0.10] text-[#8F8883] hover:border-white/[0.20] hover:text-[#C2BEBC]"
                            }`}
                          >
                            {isRecording ? "…" : formatShortcut(currentKey)}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ── LICENÇA ── */}
          {tab === "license" && (
            <div className="space-y-5">
              <div className="rounded-lg px-4 py-4 flex flex-col gap-3 bg-white/[0.03] border border-white/[0.06]">
                <p className="text-[10px] font-bold uppercase tracking-widest text-[#8F8883]">
                  {t("settings.license.trialStatus")}
                </p>
                <div className="grid grid-cols-2 gap-y-3">
                  {[
                    { label: t("settings.license.daysElapsed"),    value: `${daysElapsed()} dias` },
                    { label: t("settings.license.daysRemaining"),  value: `${daysRemaining()} dias` },
                    { label: t("settings.license.tracksAnalyzed"), value: `${tracksAnalyzed}` },
                    { label: t("settings.license.tagsEnriched"),   value: `${tagsEnriched}` },
                    { label: t("settings.license.timeSaved"),      value: estimatedTimeSaved() },
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
                  <span className="text-[13px] font-semibold text-[#5BA055]">{t("settings.license.licenseActive")}</span>
                </div>
              ) : showLicenseForm ? (
                <div className="flex flex-col gap-3">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-[#8F8883]">
                    {t("settings.license.insertKey")}
                  </p>
                  <div className="flex gap-2">
                    <input
                      autoFocus
                      type="text"
                      value={licenseInput}
                      onChange={(e) => setLicenseInput(e.target.value)}
                      placeholder={t("settings.license.placeholder")}
                      className="flex-1 px-3 py-2 rounded-lg text-[12px] font-mono outline-none transition-all bg-white/[0.05] border border-white/[0.08] text-[#F5F5F4] placeholder-[#373331] focus:border-[#D95340]/50"
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && licenseInput.trim()) {
                          activateLicense(licenseInput.trim());
                          setLicenseInput("");
                        }
                        if (e.key === "Escape") {
                          setShowLicenseForm(false);
                          setLicenseInput("");
                        }
                      }}
                    />
                    <button
                      onClick={() => { if (licenseInput.trim()) { activateLicense(licenseInput.trim()); setLicenseInput(""); }}}
                      disabled={!licenseInput.trim()}
                      className="px-4 py-2 rounded-lg text-[12px] font-bold uppercase tracking-wide text-white disabled:opacity-40 bg-[#D95340] hover:bg-[#E07364] transition-colors"
                    >
                      {t("settings.license.activate")}
                    </button>
                  </div>
                  <button
                    onClick={() => { setShowLicenseForm(false); setLicenseInput(""); }}
                    className="text-[11px] text-[#4C4743] hover:text-[#605A55] transition-colors text-left"
                  >
                    {t("settings.license.back")}
                  </button>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-3 py-2">
                  <button
                    onClick={() => window.open("https://tagwave.app", "_blank")}
                    className="w-full py-3 rounded-xl text-[13px] font-bold text-white bg-[#D95340] hover:bg-[#E07364] transition-colors shadow-lg shadow-[#D95340]/20"
                  >
                    {t("settings.license.getLicense")}
                  </button>
                  <button
                    onClick={() => setShowLicenseForm(true)}
                    className="text-[11px] text-[#C97B40] hover:text-[#D98B50] transition-colors"
                  >
                    {t("settings.license.haveLicense")}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ── ACESSIBILIDADE ── */}
          {tab === "accessibility" && (
            <div className="space-y-6">

              {/* Font size */}
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest mb-1 text-[#8F8883]">
                  {t("settings.accessibility.fontSize")}
                </p>
                <p className="text-[11px] text-[#4C4743] mb-3">
                  {t("settings.accessibility.fontSizeDesc")}
                </p>
                <div className="flex gap-2">
                  {([
                    { id: "100", label: t("settings.accessibility.fontSmall"),  pct: "100%" },
                    { id: "115", label: t("settings.accessibility.fontMedium"), pct: "115%" },
                    { id: "130", label: t("settings.accessibility.fontLarge"),  pct: "130%" },
                    { id: "150", label: t("settings.accessibility.fontXL"),     pct: "150%" },
                  ] as const).map((opt) => (
                    <button
                      key={opt.id}
                      onClick={() => setFontScale(opt.id)}
                      className={`flex-1 py-3 px-2 rounded-lg flex flex-col items-center gap-1 transition-colors border ${
                        fontScale === opt.id
                          ? "bg-[#D95340]/[0.12] border-[#D95340]/[0.30]"
                          : "bg-white/[0.03] border-white/[0.06] hover:bg-white/[0.05]"
                      }`}
                    >
                      <span style={{ fontSize: `calc(14px * ${parseInt(opt.id) / 100})` }}
                        className={`font-bold leading-none ${fontScale === opt.id ? "text-[#D95340]" : "text-[#C2BEBC]"}`}>
                        Aa
                      </span>
                      <span className={`text-[10px] ${fontScale === opt.id ? "text-[#D95340]/70" : "text-[#605A55]"}`}>
                        {opt.pct}
                      </span>
                      <span className={`text-[10px] font-semibold ${fontScale === opt.id ? "text-[#D95340]" : "text-[#8F8883]"}`}>
                        {opt.label}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Color mode */}
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest mb-1 text-[#8F8883]">
                  {t("settings.accessibility.colorMode")}
                </p>
                <p className="text-[11px] text-[#4C4743] mb-3">
                  {t("settings.accessibility.colorModeDesc")}
                </p>
                <div className="space-y-2">
                  {([
                    { id: "default",       label: t("settings.accessibility.colorDefault"),      dot: "#D95340", desc: "" },
                    { id: "deuteranopia",  label: t("settings.accessibility.colorDeutanopia"),   dot: "#2563EB", desc: "" },
                    { id: "high-contrast", label: t("settings.accessibility.colorHighContrast"), dot: "#F5F5F4", desc: "" },
                  ] as const).map((opt) => (
                    <button
                      key={opt.id}
                      onClick={() => setColorMode(opt.id)}
                      className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors border ${
                        colorMode === opt.id
                          ? "bg-[#D95340]/[0.08] border-[#D95340]/[0.25]"
                          : "bg-white/[0.03] border-white/[0.06] hover:bg-white/[0.05]"
                      }`}
                    >
                      <span className="w-3.5 h-3.5 rounded-full shrink-0" style={{ background: opt.dot }} />
                      <span className={`text-[12px] font-semibold ${colorMode === opt.id ? "text-[#D95340]" : "text-[#C2BEBC]"}`}>
                        {opt.label}
                      </span>
                      {colorMode === opt.id && (
                        <svg className="ml-auto shrink-0" width="11" height="9" viewBox="0 0 11 9" fill="none" stroke="#D95340" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="1 4.5 4 7.5 10 1.5"/>
                        </svg>
                      )}
                    </button>
                  ))}
                </div>
              </div>

              {/* Toolchips */}
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest mb-1 text-[#8F8883]">
                  Toolchips — Ajuda Visual
                </p>
                <p className="text-[11px] text-[#4C4743] mb-3">
                  Exibe marcadores "?" sobre as principais funcionalidades. Clique em qualquer marcador para ver descrição e atalhos.
                </p>
                <label
                  className="flex items-center justify-between px-4 py-3 rounded-lg border cursor-pointer transition-colors hover:bg-white/[0.02]"
                  style={{ borderColor: "rgba(255,255,255,0.06)" }}
                >
                  <div>
                    <p className="text-[12px] font-semibold text-[#C2BEBC]">Mostrar marcadores de ajuda</p>
                    <p className="text-[11px] text-[#4C4743] mt-0.5">Badges "?" sobrepostos na interface</p>
                  </div>
                  <div
                    onClick={() => setHelpMarkersEnabled(!helpMarkersEnabled)}
                    className="shrink-0 rounded-full transition-colors relative cursor-pointer"
                    style={{
                      width: 32, height: 18,
                      background: helpMarkersEnabled ? "#D95340" : "rgba(255,255,255,0.10)",
                    }}
                  >
                    <span
                      className="absolute top-0.5 left-0.5 rounded-full bg-white shadow transition-transform"
                      style={{
                        width: 14, height: 14,
                        transform: helpMarkersEnabled ? "translateX(14px)" : "translateX(0)",
                      }}
                    />
                  </div>
                </label>
              </div>

            </div>
          )}

          {/* ── PRIVACIDADE ── */}
          {tab === "privacy" && (
            <div className="space-y-6">

              {/* Enriquecimento */}
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest mb-1 text-[#8F8883]">
                  Enriquecimento de Metadados
                </p>
                <p className="text-[11px] text-[#4C4743] mb-3">
                  Quando ativado, o TagWave envia título e artista para Spotify e iTunes
                  para buscar BPM, tom e capas de álbum.
                </p>
                <label className="flex items-center justify-between px-4 py-3 rounded-lg border cursor-pointer transition-colors hover:bg-white/[0.02]"
                  style={{ borderColor: "rgba(255,255,255,0.06)" }}>
                  <div>
                    <p className="text-[12px] font-semibold text-[#C2BEBC]">
                      Permitir envio de metadados externos
                    </p>
                    <p className="text-[11px] text-[#4C4743] mt-0.5">
                      Spotify Web API, Apple iTunes Search API, Last.fm
                    </p>
                  </div>
                  <div
                    onClick={() => setEnrichmentOptIn(!enrichmentOptIn)}
                    className="shrink-0 rounded-full transition-colors relative cursor-pointer"
                    style={{
                      width: 32, height: 18,
                      background: enrichmentOptIn ? "#D95340" : "rgba(255,255,255,0.10)",
                    }}
                  >
                    <span
                      className="absolute top-0.5 left-0.5 rounded-full bg-white shadow transition-transform"
                      style={{
                        width: 14, height: 14,
                        transform: enrichmentOptIn ? "translateX(14px)" : "translateX(0)",
                      }}
                    />
                  </div>
                </label>
              </div>

              {/* Dados enviados */}
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest mb-3 text-[#8F8883]">
                  Dados Enviados para Serviços Externos
                </p>
                <div className="space-y-2">
                  {[
                    { name: "Spotify Web API",          data: "Título, artista → BPM, tom, capa" },
                    { name: "Apple iTunes Search API",  data: "Título, artista → metadados, capa" },
                    { name: "Last.fm API",               data: "Artista → informações complementares" },
                    { name: "LemonSqueezy",              data: "Chave de licença + ID anônimo da máquina" },
                  ].map((row) => (
                    <div key={row.name}
                      className="flex items-start gap-3 px-3 py-2.5 rounded-lg"
                      style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)" }}>
                      <div className="w-1.5 h-1.5 rounded-full bg-[#605A55] mt-1.5 shrink-0" />
                      <div>
                        <p className="text-[11px] font-semibold text-[#8F8883]">{row.name}</p>
                        <p className="text-[10px] text-[#4C4743]">{row.data}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* O que não é coletado */}
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest mb-3 text-[#8F8883]">
                  O Que Nunca Sai do Seu Computador
                </p>
                <div className="space-y-1.5">
                  {[
                    "Arquivos de áudio (nunca enviados)",
                    "Histórico de reprodução",
                    "Arquivos pessoais ou de trabalho",
                    "Telemetria ou analytics de uso",
                  ].map((item) => (
                    <div key={item} className="flex items-center gap-2.5">
                      <svg width="11" height="9" viewBox="0 0 11 9" fill="none" stroke="#5BA055" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="1 4.5 4 7.5 10 1.5"/>
                      </svg>
                      <span className="text-[11px] text-[#605A55]">{item}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Aceite e contato */}
              <div className="px-4 py-3 rounded-lg" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)" }}>
                <p className="text-[11px] text-[#4C4743]">
                  <span className="text-[#605A55] font-semibold">Aceite registrado:</span>{" "}
                  {privacyAcceptedVersion
                    ? `Versão ${privacyAcceptedVersion} · LGPD — Lei 13.709/2018`
                    : "Pendente"}
                </p>
                <p className="text-[11px] text-[#4C4743] mt-1">
                  <span className="text-[#605A55] font-semibold">Contato / exclusão de dados:</span>{" "}
                  celio.bitran@gmail.com
                </p>
              </div>

            </div>
          )}

        </div>

        {/* Footer */}
        <div className="px-5 py-3 flex justify-end border-t border-white/[0.04]">
          <span className="text-[10px] font-mono text-[#4C4743]">
            {t("settings.license.version", { version: appVersion })}
          </span>
        </div>

      </div>
    </div>
  );
}
