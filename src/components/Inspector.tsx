import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../store";
import { enrichTrackFull } from "../services/SpotifyService";
import { searchTrack as iTunesSearch } from "../services/iTunesService";

interface FieldProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
  onKeyDown?: (e: React.KeyboardEvent) => void;
  disabled?: boolean;
  placeholder?: string;
  mono?: boolean;
  multiline?: boolean;
}

function Field({ label, value, onChange, onBlur, onKeyDown, disabled, placeholder, mono, multiline }: FieldProps) {
  return (
    <div>
      <label className="text-[10px] font-semibold text-[#8F8883] uppercase tracking-widest block mb-1">
        {label}
      </label>
      {multiline ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          disabled={disabled}
          placeholder={placeholder ?? ""}
          rows={2}
          className={`w-full px-2.5 py-1.5 rounded-md bg-white/5 border border-white/10 text-xs text-[#C2BEBC] placeholder-[#373331] focus:outline-none focus:border-[#D95340] focus:bg-white/8 disabled:opacity-30 transition-colors resize-none ${mono ? "font-mono" : ""}`}
        />
      ) : (
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          onKeyDown={onKeyDown}
          disabled={disabled}
          placeholder={placeholder ?? ""}
          className={`w-full px-2.5 py-1.5 rounded-md bg-white/5 border border-white/10 text-xs text-[#C2BEBC] placeholder-[#373331] focus:outline-none focus:border-[#D95340] focus:bg-white/8 disabled:opacity-30 transition-colors ${mono ? "font-mono" : ""}`}
        />
      )}
    </div>
  );
}

export default function Inspector({ onClose, embedded, onBatchEnrich, enrichProgress }: { onClose?: () => void; embedded?: boolean; onBatchEnrich?: () => void; enrichProgress?: { done: number; total: number } | null } = {}) {
  const { t } = useTranslation();
  const { selectedIds, tracks, updateTrack, playerTrackId, isPlayingGlobal, clearSelection } = useAppStore();
  const selectedArr = [...selectedIds];
  const isBatch = selectedArr.length > 1;
  const first = tracks.find((t) => t.id === selectedArr[0]);

  const [title, setTitle]               = useState(first?.title ?? "");
  const [artist, setArtist]             = useState(first?.artist ?? "");
  const [album, setAlbum]               = useState(first?.album ?? "");
  const [genre, setGenre]               = useState(first?.genre ?? "");
  const [year, setYear]                 = useState(first?.year?.toString() ?? "");
  const [trackNumber, setTrackNumber]   = useState(first?.track_number?.toString() ?? "");
  const [totalTracks, setTotalTracks]   = useState(first?.total_tracks?.toString() ?? "");
  const [bpm, setBpm]                   = useState(first?.bpm ?? "");
  const [key, setKey]                   = useState(first?.key ?? "");
  const [rating, setRating]             = useState(first?.rating ?? 0);
  const [comment, setComment]           = useState(first?.comment ?? "");
  const [saving, setSaving]             = useState(false);
  const [saved, setSaved]               = useState(false);
  const [enriching, setEnriching]       = useState(false);
  const [enrichSummary, setEnrichSummary] = useState<string | null>(null);
  const [coverDataUrl, setCoverDataUrl]   = useState<string | null>(null);

  const isVinylPlaying = playerTrackId === first?.id && isPlayingGlobal;
  const bastaoRef   = useRef<HTMLDivElement>(null);
  const discTimeRef = useRef<HTMLDivElement>(null);
  const bastaoRafRef = useRef<number>(0);

  // Bastão + info overlay — rAF com interpolação de tempo real (60fps suave)
  useEffect(() => {
    cancelAnimationFrame(bastaoRafRef.current);
    let lastPP = useAppStore.getState().playerProgress;
    let lastPPTime = performance.now();

    function fmtDec(s: number) {
      return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}.${Math.floor((s % 1) * 10)}`;
    }
    function fmt(s: number) {
      return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
    }

    function tick(now: DOMHighResTimeStamp) {
      const { playerProgress: pp, playerDuration: pd, isPlayingGlobal: playing } = useAppStore.getState();
      if (pp !== lastPP) { lastPP = pp; lastPPTime = now; }
      const interpolated = playing ? lastPP + (now - lastPPTime) / 1000 : lastPP;

      if (bastaoRef.current) {
        const angle = (interpolated / (60 / 33.33) * 360) % 360;
        bastaoRef.current.style.transform = `rotate(${angle}deg)`;
      }
      if (discTimeRef.current && pd > 0) {
        const remain = Math.max(0, pd - interpolated);
        const els = discTimeRef.current.children;
        if (els[0]) els[0].textContent = fmtDec(interpolated);
        if (els[1]) els[1].textContent = `-${fmt(remain)}`;
      }
      bastaoRafRef.current = requestAnimationFrame(tick);
    }

    tick(performance.now());
    return () => cancelAnimationFrame(bastaoRafRef.current);
  }, [isVinylPlaying]);

  useEffect(() => {
    if (!first) return;
    setTitle(first.title ?? "");
    setArtist(first.artist ?? "");
    setAlbum(first.album ?? "");
    setGenre(first.genre ?? "");
    setYear(first.year?.toString() ?? "");
    setTrackNumber(first.track_number?.toString() ?? "");
    setTotalTracks(first.total_tracks?.toString() ?? "");
    setBpm(first.bpm ?? "");
    setKey(first.key ?? "");
    setRating(first.rating ?? 0);
    setComment(first.comment ?? "");
    setSaved(false);
    setEnrichSummary(null);
  }, [first?.id, first?.rating]);

  // Reload cover when cover_version changes
  useEffect(() => {
    if (!first?.has_cover) { setCoverDataUrl(null); return; }
    invoke<string | null>("read_cover_base64", { path: first.path })
      .then((b64) => {
        setCoverDataUrl(b64 ? `data:image/jpeg;base64,${b64}` : null);
      })
      .catch(() => setCoverDataUrl(null));
  }, [first?.id, first?.cover_version]);

  async function enrichAll() {
    if (!first) return;
    setEnriching(true);
    setEnrichSummary(null);
    const gained: string[] = [];

    // Variáveis locais para capturar novos valores (setters React são assíncronos)
    let newGenre = genre;
    let newAlbum = album;
    let newYear = year;
    let newBpm = bpm;
    let newKey = key;
    let newHasCover = first.has_cover;
    let newCoverVersion = first.cover_version ?? 0;

    try {
      // 1. Spotify: BPM + Tom + Álbum + Ano
      const spInfo = await enrichTrackFull(title || first.filename, artist);
      if (spInfo) {
        if (spInfo.features) {
          newBpm = spInfo.features.bpm;
          newKey = spInfo.features.key;
          setBpm(spInfo.features.bpm);
          setKey(spInfo.features.key);
          gained.push(`BPM ${spInfo.features.bpm} · ${spInfo.features.key}`);
        }
        if (!newAlbum && spInfo.album) { newAlbum = spInfo.album; setAlbum(spInfo.album); gained.push("Álbum"); }
        if (!newYear && spInfo.year)   { newYear = spInfo.year; setYear(spInfo.year); }
      }

      // 2. iTunes: Gênero + Álbum + Ano + Capa
      const iTResult = await iTunesSearch(title || first.filename, artist);
      if (iTResult) {
        if (!newGenre && iTResult.genre) { newGenre = iTResult.genre; setGenre(iTResult.genre); gained.push("Gênero"); }
        if (!newYear  && iTResult.year)  { newYear = iTResult.year; setYear(iTResult.year); }
        if (!newAlbum && iTResult.album) { newAlbum = iTResult.album; setAlbum(iTResult.album); gained.push("Álbum"); }

        if (!newHasCover && iTResult.artworkUrl) {
          try {
            await invoke("save_cover", { path: first.path, coverUrl: iTResult.artworkUrl });
            newHasCover = true;
            newCoverVersion += 1;
            gained.push("Capa");
          } catch { /* silent */ }
        }
      }
    } catch { /* silent */ }

    setEnriching(false);

    if (gained.length > 0) {
      try {
        await invoke("save_tags", {
          path: first.path,
          title: title || null,
          artist: artist || null,
          album: newAlbum || null,
          genre: newGenre || null,
          year: newYear ? parseInt(newYear) : null,
          trackNumber: trackNumber ? parseInt(trackNumber) : null,
          totalTracks: totalTracks ? parseInt(totalTracks) : null,
          bpm: newBpm || null,
          key: newKey || null,
          rating: rating > 0 ? rating : null,
          comment: comment || null,
        });
        const newIssues: string[] = [];
        if (!title)       newIssues.push("sem título");
        if (!artist)      newIssues.push("sem artista");
        if (!newGenre)    newIssues.push("sem gênero");
        if (!newHasCover) newIssues.push("sem capa");
        if (!newBpm)      newIssues.push("sem BPM");
        updateTrack({
          ...first,
          album: newAlbum || first.album,
          genre: newGenre || first.genre,
          year: newYear ? parseInt(newYear) : first.year,
          bpm: newBpm || first.bpm,
          key: newKey || first.key,
          has_cover: newHasCover,
          cover_version: newCoverVersion,
          issues: newIssues,
        });
        useAppStore.getState().recordEnrichment(gained.length);
      } catch { /* silent */ }
    }

    setEnrichSummary(
      gained.length > 0 ? `✓ ${gained.join(" · ")}` : "Nenhum dado novo encontrado"
    );
  }

  async function handleSave() {
    setSaving(true);
    try {
      const targets = isBatch ? tracks.filter((t) => selectedIds.has(t.id)) : [first!];
      for (const track of targets) {
        // Em batch, preservar title/artist de cada faixa individualmente
        const effectiveTitle  = isBatch ? (track.title  || null) : (title  || null);
        const effectiveArtist = isBatch ? (track.artist || null) : (artist || null);
        await invoke("save_tags", {
          path: track.path,
          title:       effectiveTitle,
          artist:      effectiveArtist,
          album:       album || null,
          genre:       genre || null,
          year:        year ? parseInt(year) : null,
          trackNumber: trackNumber ? parseInt(trackNumber) : null,
          totalTracks: totalTracks ? parseInt(totalTracks) : null,
          bpm:         bpm || null,
          key:         key || null,
          rating:      rating > 0 ? rating : null,
          comment:     comment || null,
        });
        const newIssues: string[] = [];
        if (!effectiveTitle)  newIssues.push("sem título");
        if (!effectiveArtist) newIssues.push("sem artista");
        if (!genre)           newIssues.push("sem gênero");
        if (!track.has_cover) newIssues.push("sem capa");
        if (!bpm)             newIssues.push("sem BPM");
        updateTrack({
          ...track,
          title:        isBatch ? track.title  : (title  || undefined),
          artist:       isBatch ? track.artist : (artist || undefined),
          album:        album        || undefined,
          genre:        genre        || undefined,
          year:         year         ? parseInt(year) : undefined,
          track_number: trackNumber  ? parseInt(trackNumber) : undefined,
          total_tracks: totalTracks  ? parseInt(totalTracks) : undefined,
          bpm:          bpm          || undefined,
          key:          key          || undefined,
          comment:      comment      || undefined,
          issues:       newIssues,
        });
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveRating(n: number) {
    if (!first) return;
    const next = rating === n ? 0 : n;
    setRating(next);
    try {
      await invoke("save_tags", {
        path: first.path,
        title: title || null,
        artist: artist || null,
        album: album || null,
        genre: genre || null,
        year: year ? parseInt(year) : null,
        trackNumber: trackNumber ? parseInt(trackNumber) : null,
        totalTracks: totalTracks ? parseInt(totalTracks) : null,
        bpm: bpm || null,
        key: key || null,
        rating: next > 0 ? next : null,
        comment: comment || null,
      });
      updateTrack({ ...first, rating: next > 0 ? next : undefined });
    } catch (err) {
      console.error("[Inspector] save_tags rating error:", err);
    }
  }

  if (!first) return null;

  return (
    <div className={`${embedded ? "flex-1 flex flex-col overflow-hidden" : "w-64 shrink-0 flex flex-col border-l border-white/[0.05] bg-[#0E0D0C]"}`}>
      {/* Área scrollável */}
      <div className="flex-1 overflow-y-auto no-scrollbar">

      {/* Header — só quando não embedded */}
      {!embedded && (
        <div className="px-4 pt-4 pb-3 border-b border-white/[0.05]">
          {isBatch ? (
            <div className="flex items-center gap-2.5">
              {coverDataUrl ? (
                <img src={coverDataUrl} alt="" className="w-9 h-9 rounded object-cover shrink-0 opacity-80" />
              ) : (
                <div className="w-9 h-9 rounded bg-white/[0.06] flex items-center justify-center shrink-0">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="#4C4743"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-[12px] font-semibold text-[#C2BEBC] leading-tight">{t("inspector.selectedMany", { count: selectedArr.length })}</p>
                <p className="text-[10px] text-[#605A55] mt-0.5">Edição em lote</p>
              </div>
              <button
                onClick={() => { clearSelection(); onClose?.(); }}
                title={t("common.close")}
                className="w-4 h-4 flex items-center justify-center text-[#605A55] hover:text-[#8F8883] transition-colors shrink-0"
              >
                <svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                  <line x1="1" y1="1" x2="7" y2="7"/>
                  <line x1="7" y1="1" x2="1" y2="7"/>
                </svg>
              </button>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between mb-2">
                <p className="text-[9px] font-bold text-[#8F8883] uppercase tracking-[0.25em]">
                  {t("inspector.selectedOne")}
                </p>
                <button
                  onClick={() => { clearSelection(); onClose?.(); }}
                  title={t("common.close")}
                  className="w-4 h-4 flex items-center justify-center text-[#605A55] hover:text-[#8F8883] transition-colors"
                >
                  <svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                    <line x1="1" y1="1" x2="7" y2="7"/>
                    <line x1="7" y1="1" x2="1" y2="7"/>
                  </svg>
                </button>
              </div>
              <p className="text-sm font-semibold text-[#F5F5F4] leading-snug truncate">
                {first.title ?? first.filename}
              </p>
              {first.artist && (
                <p className="text-[11px] text-[#8F8883] mt-0.5 truncate">{first.artist}</p>
              )}
            </>
          )}
        </div>
      )}

      {/* Track info quando embedded */}
      {embedded && !isBatch && (
        <div className="px-4 pt-3 pb-2 border-b border-white/[0.05]">
          <p className="text-sm font-semibold text-[#F5F5F4] leading-snug truncate">
            {first.title ?? first.filename}
          </p>
          {first.artist && (
            <p className="text-[11px] text-[#8F8883] mt-0.5 truncate">{first.artist}</p>
          )}
        </div>
      )}
      {embedded && isBatch && (
        <div className="px-4 pt-3 pb-2 border-b border-white/[0.05]">
          <div className="flex items-center gap-2.5">
            {coverDataUrl ? (
              <img src={coverDataUrl} alt="" className="w-9 h-9 rounded object-cover shrink-0 opacity-80" />
            ) : (
              <div className="w-9 h-9 rounded bg-white/[0.06] flex items-center justify-center shrink-0">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="#4C4743"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>
              </div>
            )}
            <div>
              <p className="text-[12px] font-semibold text-[#C2BEBC] leading-tight">{t("inspector.selectedMany", { count: selectedArr.length })}</p>
              <p className="text-[10px] text-[#605A55] mt-0.5">Edição em lote</p>
            </div>
          </div>
        </div>
      )}

      {/* Capa compacta — quando não está tocando */}
      {!isBatch && !isVinylPlaying && (
        <div className="mx-3 mt-3">
          <button
            onClick={async () => {
              const file = await open({ filters: [{ name: "Imagens", extensions: ["jpg", "jpeg", "png"] }], multiple: false });
              if (!file || typeof file !== "string") return;
              try {
                await invoke("save_cover_from_file", { path: first.path, imagePath: file });
                updateTrack({ ...first, has_cover: true, cover_version: (first.cover_version ?? 0) + 1, issues: first.issues.filter((i) => i !== "sem capa") });
              } catch { /* silent */ }
            }}
            className="w-full flex items-center gap-2.5 p-2 rounded-lg group transition-colors"
            style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.06)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.03)"; }}
          >
            <div className="w-12 h-12 rounded-md overflow-hidden shrink-0 relative"
              style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
              {coverDataUrl ? (
                <img src={coverDataUrl} alt="Cover" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="#4C4743">
                    <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
                  </svg>
                </div>
              )}
            </div>
            <span className="text-[11px] text-[#605A55] group-hover:text-[#8F8883] transition-colors">
              {coverDataUrl ? t("inspector.changeCover") : t("inspector.addCover")}
            </span>
          </button>
        </div>
      )}

      {/* Disco de vinil — só quando tocando */}
      {!isBatch && isVinylPlaying && (
        <div>
          <div
            className="mx-8 mt-3 relative group"
            style={{ aspectRatio: "1/1" }}
          >
            {/* Wrapper com folga para o disco não cortar nas bordas */}
            <div className="absolute" style={{ inset: "6px" }}>
              {/* Disco — gira apenas quando tocando */}
              <div
                className="absolute inset-0 rounded-full overflow-hidden"
                style={{
                  background: "#100e0d",
                  animation: isVinylPlaying ? "vinyl-spin 1.8s linear infinite" : undefined,
                }}
              >
                {/* Ranhuras SVG — alta visibilidade */}
                <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 100">
                  {Array.from({ length: 20 }, (_, i) => {
                    const r = 47.5 - i * 0.95;
                    return (
                      <g key={i}>
                        <circle cx="50" cy="50" r={r} fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="0.42" />
                        <circle cx="50" cy="50" r={r - 0.38} fill="none" stroke="rgba(0,0,0,0.55)" strokeWidth="0.3" />
                      </g>
                    );
                  })}
                  <circle cx="50" cy="50" r="28.5" fill="none" stroke="rgba(255,255,255,0.28)" strokeWidth="0.7" />
                  <circle cx="50" cy="50" r="27.5" fill="none" stroke="rgba(0,0,0,0.6)" strokeWidth="0.5" />
                </svg>

                {/* Label central com a capa */}
                <div
                  className="absolute rounded-full overflow-hidden"
                  style={{ width: "53%", height: "53%", top: "23.5%", left: "23.5%" }}
                >
                  {coverDataUrl ? (
                    <img src={coverDataUrl} alt="Cover" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center" style={{ background: "#1c1714" }}>
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="#4C4743">
                        <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
                      </svg>
                    </div>
                  )}
                </div>

                {/* Buraco central */}
                <div
                  className="absolute rounded-full"
                  style={{
                    width: "7%", height: "7%",
                    top: "46.5%", left: "46.5%",
                    background: "#080706",
                    boxShadow: "inset 0 1px 3px rgba(0,0,0,1)",
                    zIndex: 10,
                  }}
                />
              </div>

              {/* Bastão Serato/Rekordbox — rotação 60fps via rAF, sem re-render React */}
              <div
                ref={bastaoRef}
                className="absolute inset-0 pointer-events-none"
                style={{
                  transformOrigin: "50% 50%",
                  opacity: isVinylPlaying ? 1 : 0.3,
                  transition: "opacity 0.4s ease",
                }}
              >
                <div
                  style={{
                    position: "absolute",
                    top: "3.5%",
                    left: "calc(50% - 2.5%)",
                    width: "5%",
                    height: "10%",
                    background: "linear-gradient(180deg, #F5A868 0%, #C97B40 100%)",
                    borderRadius: "99px",
                    boxShadow: "0 0 10px rgba(233,146,76,0.7)",
                  }}
                />
              </div>

              {/* Reflexo estático */}
              <div
                className="absolute inset-0 rounded-full pointer-events-none"
                style={{
                  background: "radial-gradient(ellipse at 32% 28%, rgba(255,255,255,0.07) 0%, transparent 52%)",
                }}
              />

              {/* Jog-wheel info overlay — BPM estático React, tempo via rAF ref */}
              {isVinylPlaying && (
                <div className="absolute inset-0 rounded-full pointer-events-none flex flex-col items-center justify-center gap-0"
                  style={{ background: "radial-gradient(circle at center, rgba(0,0,0,0.55) 0%, transparent 72%)" }}>
                  {first?.bpm && (
                    <span className="font-mono font-bold tabular-nums"
                      style={{ fontSize: "20px", color: "#FFFFFF", lineHeight: 1, textShadow: "0 0 8px rgba(0,0,0,0.9)" }}>
                      {parseFloat(first.bpm).toFixed(1)}
                    </span>
                  )}
                  {/* Tempo — atualizado pelo rAF, não pelo React state */}
                  <div ref={discTimeRef} className="flex flex-col items-center mt-1">
                    <span className="font-mono tabular-nums"
                      style={{ fontSize: "13px", color: "rgba(255,255,255,0.75)", textShadow: "0 0 6px rgba(0,0,0,0.9)" }}>
                      0:00.0
                    </span>
                    <span className="font-mono tabular-nums"
                      style={{ fontSize: "11px", color: "rgba(255,255,255,0.4)", textShadow: "0 0 6px rgba(0,0,0,0.9)" }}>
                      -0:00
                    </span>
                  </div>
                </div>
              )}

              {/* Sombra e brilho coral quando tocando */}
              <div
                className="absolute inset-0 rounded-full pointer-events-none"
                style={{
                  boxShadow: isVinylPlaying
                    ? "0 0 30px rgba(217,83,64,0.22), 0 6px 24px rgba(0,0,0,0.7)"
                    : "0 5px 20px rgba(0,0,0,0.6)",
                  transition: "box-shadow 0.5s ease",
                }}
              />

              {isVinylPlaying && (
                <div
                  className="absolute inset-0 rounded-full pointer-events-none"
                  style={{ animation: "vinyl-pulse 2s ease-in-out infinite" }}
                />
              )}
            </div>
          </div>

          {/* Botão de capa — abaixo do disco */}
          <button
            onClick={async () => {
              const file = await open({ filters: [{ name: "Imagens", extensions: ["jpg", "jpeg", "png"] }], multiple: false });
              if (!file || typeof file !== "string") return;
              try {
                await invoke("save_cover_from_file", { path: first.path, imagePath: file });
                updateTrack({ ...first, has_cover: true, cover_version: (first.cover_version ?? 0) + 1, issues: first.issues.filter((i) => i !== "sem capa") });
              } catch { /* silent */ }
            }}
            className="mx-3 mt-2.5 w-[calc(100%-24px)] py-1.5 rounded-lg text-[11px] font-semibold bg-[#D95340] hover:bg-[#E07364] active:bg-[#B34435] text-white transition-colors flex items-center justify-center gap-1.5"
          >
            {coverDataUrl ? t("inspector.changeCover") : t("inspector.addCover")}
          </button>
        </div>
      )}

      {/* BPM + Tom + info de arquivo (box unificado) */}
      {!isBatch && (first.bpm || first.key || first.format || first.bitrate_kbps || first.sample_rate_hz || first.file_size_bytes > 0) && (
        <div className="mx-3 mt-3 rounded-md bg-white/[0.02] border border-white/[0.04] overflow-hidden">
          {/* Linha superior: BPM e Tom */}
          {(first.bpm || first.key) && (
            <div className="flex items-center gap-3 px-3 py-2.5">
              {first.bpm && (
                <div className="flex-1">
                  <p className="text-[9px] font-bold text-[#8F8883] uppercase tracking-widest mb-0.5">BPM</p>
                  <p className="text-base font-mono font-bold text-[#F5F5F4] tabular-nums leading-none">
                    {parseFloat(first.bpm).toFixed(2)}
                  </p>
                </div>
              )}
              {first.key && (
                <div>
                  <p className="text-[9px] font-bold text-[#8F8883] uppercase tracking-widest mb-0.5">TOM</p>
                  <span
                    className="inline-block px-2 py-0.5 rounded-sm text-sm font-mono font-bold text-white"
                    style={{ backgroundColor: `hsl(${((["Abm","G#m","B","Ebm","D#m","Gb","F#","Bbm","A#m","Db","C#","Fm","Ab","G#","Cm","Eb","D#","Gm","Bb","A#","Dm","F","Am","C","Em","G","Bm","D","F#m","Gbm","A","Dbm","C#m","E"].indexOf(first.key)+1)%12)*30}, 60%, 44%)` }}
                  >
                    {first.key}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Separador laranja + linha de info de arquivo */}
          {(first.format || first.bitrate_kbps || first.sample_rate_hz || first.file_size_bytes > 0) && (
            <>
              <div className="h-px bg-[#C97B40]/30" />
              <div className="flex items-center gap-2 px-3 py-1.5 flex-wrap">
                {first.format && (
                  <span className="text-[9px] font-bold uppercase tracking-widest text-[#C97B40]/80">
                    {first.format}
                  </span>
                )}
                {(first.format && (first.bitrate_kbps || first.sample_rate_hz || first.file_size_bytes > 0)) && (
                  <span className="text-[#373331] text-[9px]">·</span>
                )}
                {first.bitrate_kbps && (
                  <span className="text-[10px] font-mono text-[#605A55]">
                    {first.bitrate_kbps} kbps
                  </span>
                )}
                {first.sample_rate_hz && (
                  <span className="text-[10px] font-mono text-[#605A55]">
                    {(first.sample_rate_hz / 1000).toFixed(1)} kHz
                  </span>
                )}
                {first.file_size_bytes > 0 && (
                  <span className="text-[10px] font-mono text-[#605A55]">
                    {(first.file_size_bytes / (1024 * 1024)).toFixed(1)} MB
                  </span>
                )}
              </div>
            </>
          )}
        </div>
      )}


      {/* Issues */}
      {!isBatch && first.issues.length > 0 && (
        <div className="mx-3 mt-3 px-3 py-2 rounded-md border border-[#D95340]/20 bg-[#D95340]/8">
          <p className="text-[9px] font-bold text-[#D95340] uppercase tracking-widest mb-1.5">
            {t("inspector.needsAttention")}
          </p>
          {first.issues.map((issue) => (
            <p key={issue} className="text-[11px] text-[#C99BA6] leading-tight">
              · {issue}
            </p>
          ))}
        </div>
      )}

      {/* Rating */}
      {!isBatch && (
        <div className="mx-3 mt-2 flex items-center gap-1.5">
          <span className="text-[9px] font-bold text-[#8F8883] uppercase tracking-widest shrink-0 max-w-[72px] truncate">{t("inspector.rating")}</span>
          <div className="flex gap-0.5">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                onClick={() => handleSaveRating(n)}
                className={`text-base transition-colors leading-none ${
                  n <= rating ? "text-[#D95340]" : "text-[#4C4743] hover:text-[#8F8883]"
                }`}
              >
                ★
              </button>
            ))}
          </div>
          {rating > 0 && (
            <span className="text-[10px] font-mono text-[#605A55] ml-0.5">({rating}/5)</span>
          )}
        </div>
      )}

      {/* Tags ID3 header */}
      <div className="px-3 pt-3 pb-0">
        <p className="text-[9px] font-bold text-[#8F8883] uppercase tracking-widest">{t("inspector.tagsId3")}</p>
      </div>

      {/* Fields */}
      <div className="flex flex-col gap-2.5 px-3 py-3" data-help="inspector-fields">
        {!isBatch && <Field label={t("inspector.title")} value={title} onChange={setTitle} onBlur={handleSave} onKeyDown={(e) => e.key === "Enter" && handleSave()} />}
        {!isBatch && <Field label={t("inspector.artist")} value={artist} onChange={setArtist} onBlur={handleSave} onKeyDown={(e) => e.key === "Enter" && handleSave()} />}
        <Field label={t("inspector.album")} value={album} onChange={setAlbum} onBlur={handleSave} onKeyDown={(e) => e.key === "Enter" && handleSave()} />
        <Field label={t("inspector.genre")} value={genre} onChange={setGenre} onBlur={handleSave} onKeyDown={(e) => e.key === "Enter" && handleSave()} />
        <div className="grid grid-cols-2 gap-2">
          <Field label={t("inspector.year")} value={year} onChange={setYear} onBlur={handleSave} onKeyDown={(e) => e.key === "Enter" && handleSave()} />
          <div>
            <label className="text-[10px] font-semibold text-[#8F8883] uppercase tracking-widest block mb-1">
              {t("inspector.track")}
            </label>
            <div className="flex items-center gap-1">
              <input
                value={trackNumber}
                onChange={(e) => setTrackNumber(e.target.value)}
                onBlur={handleSave}
                onKeyDown={(e) => e.key === "Enter" && handleSave()}
                placeholder="—"
                className="w-full px-2.5 py-1.5 rounded-md bg-white/5 border border-white/10 text-xs text-[#C2BEBC] placeholder-[#373331] focus:outline-none focus:border-[#D95340] focus:bg-white/8 transition-colors font-mono"
              />
              <span className="text-[#4C4743] text-xs">/</span>
              <input
                value={totalTracks}
                onChange={(e) => setTotalTracks(e.target.value)}
                onBlur={handleSave}
                onKeyDown={(e) => e.key === "Enter" && handleSave()}
                placeholder="—"
                title="Total de faixas"
                className="w-full px-2.5 py-1.5 rounded-md bg-white/5 border border-white/10 text-xs text-[#C2BEBC] placeholder-[#373331] focus:outline-none focus:border-[#D95340] focus:bg-white/8 transition-colors font-mono"
              />
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field label={t("inspector.bpm")} value={bpm} onChange={setBpm} onBlur={handleSave} onKeyDown={(e) => e.key === "Enter" && handleSave()} mono />
          <Field label={t("inspector.key")} value={key} onChange={setKey} onBlur={handleSave} onKeyDown={(e) => e.key === "Enter" && handleSave()} mono />
        </div>
        <Field label={t("inspector.comment")} value={comment} onChange={setComment} onBlur={handleSave} placeholder="—" multiline={!isBatch} />
      </div>

      </div>{/* fim área scrollável */}

      {/* Footer fixo — Enriquecer */}
      <div className="shrink-0 border-t border-white/[0.05] px-3 pt-3 pb-4 flex flex-col gap-2">
        {/* Enriquecer */}
        <button
          data-tour="enrich-inspector"
          data-help="enrich-inspector"
          onClick={isBatch && onBatchEnrich ? onBatchEnrich : enrichAll}
          disabled={enriching || !!enrichProgress}
          className="w-full rounded-lg disabled:opacity-90 overflow-hidden"
          style={{
            background: enriching && !enrichProgress
              ? "rgba(220,85,71,0.15)"
              : enrichSummary && !enrichProgress
              ? "rgba(220,85,71,0.12)"
              : "linear-gradient(135deg, #8B3E38, #D95340)",
          }}
        >
          {/* Linha principal */}
          <div className="flex items-center gap-2.5 px-3.5 pt-2.5 pb-2">
            {enriching && !enrichProgress ? (
              <>
                <span className="animate-spin text-white text-base">⟳</span>
                <span className="text-white text-xs font-semibold">{t("inspector.searching")}</span>
              </>
            ) : enrichSummary && !enrichProgress ? (
              <>
                <span className="text-white text-sm">{enrichSummary.startsWith("✓") ? "✓" : "✗"}</span>
                <span className="text-white/90 text-[11px] font-medium flex-1 text-left leading-tight">
                  {enrichSummary.replace(/^[✓✗]\s*/, "")}
                </span>
                <span className="text-white/50 text-xs">↺</span>
              </>
            ) : (
              <>
                <span className="text-white text-sm">✦</span>
                <div className="flex-1 text-left">
                  <p className="text-white text-xs font-bold leading-none">
                    {isBatch ? t("inspector.enrichCount", { count: selectedArr.length }) : t("inspector.enrichMeta")}
                  </p>
                  <p className="text-white/55 text-[10px] mt-0.5">{t("inspector.sources")}</p>
                </div>
                {enrichProgress ? (
                  <span className="text-white/70 text-[10px] font-semibold tabular-nums">
                    {enrichProgress.done} / {enrichProgress.total}
                  </span>
                ) : (
                  <span className="text-white/40 text-xs">›</span>
                )}
              </>
            )}
          </div>

          {/* Barra de progresso integrada ao botão */}
          {enrichProgress && (
            <div className="h-[3px] w-full" style={{ background: "rgba(0,0,0,0.25)" }}>
              <div
                className="h-full transition-all duration-300"
                style={{
                  width: `${Math.round((enrichProgress.done / enrichProgress.total) * 100)}%`,
                  background: "rgba(255,255,255,0.55)",
                }}
              />
            </div>
          )}
        </button>

        {/* Botão Salvar */}
        <button
          data-help="save-tags-btn"
          onClick={handleSave}
          disabled={saving}
          className="w-full py-2 rounded-lg text-xs font-semibold transition-all disabled:opacity-60 flex items-center justify-center gap-1.5"
          style={{
            background: saved ? "rgba(91,160,85,0.18)" : "rgba(255,255,255,0.06)",
            color: saved ? "#5BA055" : "#C2BEBC",
            border: saved ? "1px solid rgba(91,160,85,0.3)" : "1px solid rgba(255,255,255,0.08)",
          }}
        >
          {saving ? (
            <><span className="animate-spin text-sm">⟳</span>{t("common.saving")}</>
          ) : saved ? (
            <>
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="#5BA055" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="2 5 4 7 8 3"/>
              </svg>
              {t("inspector.tagsSaved")}
            </>
          ) : (
            <>
              <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M8.5 9.5H2.5a1 1 0 0 1-1-1V2.5l2-1.5h5l2 1.5V8.5a1 1 0 0 1-1 1z"/>
                <rect x="3.5" y="6" width="4" height="3.5"/>
                <rect x="3.5" y="1" width="3" height="2.5"/>
              </svg>
              {t("common.save")}
            </>
          )}
        </button>
      </div>
    </div>
  );
}
