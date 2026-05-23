import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useAppStore } from "../store";
import { enrichTrackFull } from "../services/SpotifyService";
import { searchTrack as iTunesSearch } from "../services/iTunesService";

interface FieldProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  placeholder?: string;
  mono?: boolean;
  multiline?: boolean;
}

function Field({ label, value, onChange, disabled, placeholder, mono, multiline }: FieldProps) {
  return (
    <div>
      <label className="text-[10px] font-semibold text-[#8F8883] uppercase tracking-widest block mb-1">
        {label}
      </label>
      {multiline ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          placeholder={placeholder ?? ""}
          rows={2}
          className={`w-full px-2.5 py-1.5 rounded-md bg-white/5 border border-white/10 text-xs text-[#C2BEBC] placeholder-[#373331] focus:outline-none focus:border-[#D95340] focus:bg-white/8 disabled:opacity-30 transition-colors resize-none ${mono ? "font-mono" : ""}`}
        />
      ) : (
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          placeholder={placeholder ?? ""}
          className={`w-full px-2.5 py-1.5 rounded-md bg-white/5 border border-white/10 text-xs text-[#C2BEBC] placeholder-[#373331] focus:outline-none focus:border-[#D95340] focus:bg-white/8 disabled:opacity-30 transition-colors ${mono ? "font-mono" : ""}`}
        />
      )}
    </div>
  );
}

export default function Inspector() {
  const { selectedIds, tracks, updateTrack, setPlayerTrack, playerTrackId, isPlayingGlobal } = useAppStore();
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
  }, [first?.id]);

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

    try {
      // 1. Spotify: BPM + Tom + Álbum + Ano
      const spInfo = await enrichTrackFull(title || first.filename, artist);
      if (spInfo) {
        if (spInfo.features) {
          setBpm(spInfo.features.bpm);
          setKey(spInfo.features.key);
          gained.push(`BPM ${spInfo.features.bpm} · ${spInfo.features.key}`);
        }
        if (!album && spInfo.album) { setAlbum(spInfo.album); gained.push("Álbum"); }
        if (!year && spInfo.year)   setYear(spInfo.year);
      }

      // 2. iTunes: Gênero + Álbum + Ano + Capa
      const iTResult = await iTunesSearch(title || first.filename, artist);
      if (iTResult) {
        if (!genre && iTResult.genre)  { setGenre(iTResult.genre); gained.push("Gênero"); }
        if (!year  && iTResult.year)   setYear(iTResult.year);
        if (!album && iTResult.album)  { setAlbum(iTResult.album); gained.push("Álbum"); }

        // Baixar e salvar capa se ausente
        if (!first.has_cover && iTResult.artworkUrl) {
          try {
            await invoke("save_cover", { path: first.path, coverUrl: iTResult.artworkUrl });
            const newIssues = first.issues.filter((i) => i !== "sem capa");
            updateTrack({
              ...first,
              has_cover: true,
              cover_version: (first.cover_version ?? 0) + 1,
              issues: newIssues,
            });
            gained.push("Capa");
          } catch { /* silent */ }
        }
      }
    } catch { /* silent */ }

    setEnriching(false);
    setEnrichSummary(
      gained.length > 0 ? `✓ ${gained.join(" · ")}` : "Nenhum dado novo encontrado"
    );
  }

  async function handleSave() {
    setSaving(true);
    try {
      const targets = isBatch ? tracks.filter((t) => selectedIds.has(t.id)) : [first!];
      for (const track of targets) {
        await invoke("save_tags", {
          path: track.path,
          title: title || null,
          artist: artist || null,
          album: album || null,
          genre: genre || null,
          year: year ? parseInt(year) : null,
          trackNumber: trackNumber ? parseInt(trackNumber) : null,
          totalTracks: totalTracks ? parseInt(totalTracks) : null,
          bpm: bpm || null,
          key: key || null,
          rating: rating > 0 ? rating : null,
          comment: comment || null,
        });
        const newIssues: string[] = [];
        if (!title)  newIssues.push("sem título");
        if (!artist) newIssues.push("sem artista");
        if (!genre)  newIssues.push("sem gênero");
        if (!track.has_cover) newIssues.push("sem capa");
        if (!bpm)    newIssues.push("sem BPM");
        updateTrack({
          ...track,
          title: title || undefined,
          artist: artist || undefined,
          album: album || undefined,
          genre: genre || undefined,
          year: year ? parseInt(year) : undefined,
          track_number: trackNumber ? parseInt(trackNumber) : undefined,
          total_tracks: totalTracks ? parseInt(totalTracks) : undefined,
          bpm: bpm || undefined,
          key: key || undefined,
          comment: comment || undefined,
          issues: newIssues,
        });
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  }

  if (!first) return null;

  return (
    <div className="w-64 shrink-0 flex flex-col border-l border-white/[0.05] bg-[#0E0D0C] overflow-y-auto">

      {/* NOW SELECTED header */}
      <div className="px-4 pt-4 pb-3 border-b border-white/[0.05]">
        <p className="text-[9px] font-bold text-[#8F8883] uppercase tracking-[0.25em] mb-2">
          {isBatch ? `${selectedArr.length} selecionadas` : "Selecionado"}
        </p>
        {!isBatch && (
          <>
            <p className="text-sm font-semibold text-[#F5F5F4] leading-snug truncate">
              {first.title ?? first.filename}
            </p>
            {first.artist && (
              <p className="text-[11px] text-[#8F8883] mt-0.5 truncate">{first.artist}</p>
            )}
          </>
        )}
      </div>

      {/* Disco de vinil */}
      {!isBatch && (
        <div
          className="mx-3 mt-3 relative group"
          style={{ aspectRatio: "1/1" }}
        >
          {/* Disco — gira apenas quando tocando */}
          <div
            className="absolute inset-0 rounded-full overflow-hidden"
            style={{
              background: "#100e0d",
              animation: isVinylPlaying ? "vinyl-spin 4s linear infinite" : undefined,
            }}
          >
            {/* Ranhuras SVG — alta visibilidade */}
            <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 100">
              {/* Groove tracks: 20 rings de r=47.5 até r=29, passo ~1px */}
              {Array.from({ length: 20 }, (_, i) => {
                const r = 47.5 - i * 0.95;
                return (
                  <g key={i}>
                    <circle cx="50" cy="50" r={r} fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="0.42" />
                    <circle cx="50" cy="50" r={r - 0.38} fill="none" stroke="rgba(0,0,0,0.55)" strokeWidth="0.3" />
                  </g>
                );
              })}
              {/* Anel separador do label — destaque visual */}
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

            {/* Buraco central — sobre o label */}
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

          {/* Reflexo estático (não gira) — dá profundidade 3D */}
          <div
            className="absolute inset-0 rounded-full pointer-events-none"
            style={{
              background: "radial-gradient(ellipse at 32% 28%, rgba(255,255,255,0.07) 0%, transparent 52%)",
            }}
          />

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

          {/* Pulso quando tocando */}
          {isVinylPlaying && (
            <div
              className="absolute inset-0 rounded-full pointer-events-none"
              style={{ animation: "vinyl-pulse 2s ease-in-out infinite" }}
            />
          )}

          {/* Botão alterar capa */}
          <button
            onClick={async () => {
              const file = await open({ filters: [{ name: "Imagens", extensions: ["jpg", "jpeg", "png"] }], multiple: false });
              if (!file || typeof file !== "string") return;
              try {
                await invoke("save_cover_from_file", { path: first.path, imagePath: file });
                updateTrack({ ...first, has_cover: true, cover_version: (first.cover_version ?? 0) + 1, issues: first.issues.filter((i) => i !== "sem capa") });
              } catch { /* silent */ }
            }}
            className="absolute bottom-2 right-2 px-2 py-1 rounded text-[10px] font-semibold bg-black/70 text-white hover:bg-black/90 transition-colors opacity-0 group-hover:opacity-100 z-20"
          >
            {coverDataUrl ? "Alterar Capa" : "+ Capa"}
          </button>
        </div>
      )}

      {/* Player controls inline */}
      {!isBatch && (
        <div className="mx-3 mt-2 flex items-center gap-2 px-3 py-2 rounded-md bg-white/[0.02] border border-white/[0.04]">
          <button
            onClick={() => setPlayerTrack(playerTrackId === first.id ? null : first.id)}
            className="w-6 h-6 rounded-full flex items-center justify-center transition-colors bg-[#D95340] hover:bg-[#E07364] shrink-0"
          >
            {isVinylPlaying ? (
              <svg width="8" height="8" viewBox="0 0 8 8" fill="white"><rect x="1" y="1" width="2" height="6" rx="0.5"/><rect x="5" y="1" width="2" height="6" rx="0.5"/></svg>
            ) : (
              <svg width="8" height="8" viewBox="0 0 8 8" fill="white"><path d="M2 1.5l5 2.5-5 2.5V1.5z"/></svg>
            )}
          </button>
          <div className="flex-1 text-[10px] font-mono text-[#605A55]">
            {isVinylPlaying ? "tocando…" : first.duration_secs
              ? `${Math.floor(first.duration_secs / 60)}:${String(Math.floor(first.duration_secs % 60)).padStart(2, "0")}`
              : "—"
            }
          </div>
          {first.rating != null && first.rating > 0 && (
            <span className="text-[10px] font-mono text-[#605A55]">{first.rating}/5</span>
          )}
        </div>
      )}

      {/* BPM + Tom destacados */}
      {!isBatch && (first.bpm || first.key) && (
        <div className="mx-3 mt-3 flex items-center gap-3 px-3 py-2.5 rounded-md bg-white/[0.02] border border-white/[0.04]">
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

      {/* Formato / Bitrate */}
      {!isBatch && (
        <div className="mx-3 mt-2 flex items-center gap-2 flex-wrap">
          {first.format && (
            <span className="px-1.5 py-px rounded-sm text-[9px] font-bold uppercase tracking-widest bg-white/[0.04] text-[#605A55]">
              {first.format}
            </span>
          )}
          {first.bitrate_kbps && (
            <span className="text-[10px] font-mono text-[#8F8883]">
              {first.bitrate_kbps} kbps
            </span>
          )}
          {first.sample_rate_hz && (
            <span className="text-[10px] font-mono text-[#8F8883]">
              {(first.sample_rate_hz / 1000).toFixed(1)} kHz
            </span>
          )}
          {first.file_size_bytes > 0 && (
            <span className="text-[10px] font-mono text-[#8F8883]">
              {(first.file_size_bytes / (1024 * 1024)).toFixed(1)} MB
            </span>
          )}
        </div>
      )}

      {/* Arquivo */}
      {!isBatch && (
        <div className="mx-3 mt-2 px-3 py-2 rounded-md bg-white/[0.02] border border-white/[0.04]">
          <p className="text-[9px] font-bold text-[#8F8883] uppercase tracking-widest mb-1">Arquivo</p>
          <p className="text-[11px] text-[#C2BEBC] leading-tight break-all">{first.filename}</p>
          <p className="text-[10px] text-[#605A55] mt-0.5 leading-tight break-all font-mono">{first.path.replace(first.filename, "")}</p>
        </div>
      )}

      {/* Issues */}
      {!isBatch && first.issues.length > 0 && (
        <div className="mx-3 mt-3 px-3 py-2 rounded-md border border-[#D95340]/20 bg-[#D95340]/8">
          <p className="text-[9px] font-bold text-[#D95340] uppercase tracking-widest mb-1.5">
            Precisa de atenção
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
          <span className="text-[9px] font-bold text-[#8F8883] uppercase tracking-widest w-10">Rating</span>
          <div className="flex gap-0.5">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                onClick={() => setRating(rating === n ? 0 : n)}
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
        <p className="text-[9px] font-bold text-[#8F8883] uppercase tracking-widest">Tags ID3</p>
      </div>

      {/* Fields */}
      <div className="flex flex-col gap-2.5 px-3 py-3">
        <Field label="Título" value={title} onChange={setTitle} disabled={isBatch} placeholder={isBatch ? "(múltiplos)" : ""} />
        <Field label="Artista" value={artist} onChange={setArtist} />
        <Field label="Álbum" value={album} onChange={setAlbum} />
        <Field label="Gênero" value={genre} onChange={setGenre} />
        <div className="grid grid-cols-2 gap-2">
          <Field label="Ano" value={year} onChange={setYear} />
          <div>
            <label className="text-[10px] font-semibold text-[#8F8883] uppercase tracking-widest block mb-1">
              Faixa #
            </label>
            <div className="flex items-center gap-1">
              <input
                value={trackNumber}
                onChange={(e) => setTrackNumber(e.target.value)}
                placeholder="—"
                className="w-full px-2.5 py-1.5 rounded-md bg-white/5 border border-white/10 text-xs text-[#C2BEBC] placeholder-[#373331] focus:outline-none focus:border-[#D95340] focus:bg-white/8 transition-colors font-mono"
              />
              <span className="text-[#4C4743] text-xs">/</span>
              <input
                value={totalTracks}
                onChange={(e) => setTotalTracks(e.target.value)}
                placeholder="—"
                title="Total de faixas"
                className="w-full px-2.5 py-1.5 rounded-md bg-white/5 border border-white/10 text-xs text-[#C2BEBC] placeholder-[#373331] focus:outline-none focus:border-[#D95340] focus:bg-white/8 transition-colors font-mono"
              />
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field label="BPM" value={bpm} onChange={setBpm} mono />
          <Field label="Tom" value={key} onChange={setKey} mono />
        </div>
        <Field label="Comentário" value={comment} onChange={setComment} placeholder="—" multiline />

        {/* Enriquecer */}
        <button
          onClick={enrichAll}
          disabled={enriching}
          className="w-full rounded-lg disabled:opacity-60 overflow-hidden mt-1"
          style={{
            background: enriching
              ? "rgba(220,85,71,0.15)"
              : enrichSummary
              ? "rgba(220,85,71,0.12)"
              : "linear-gradient(135deg, #8B3E38, #D95340)",
          }}
        >
          <div className="flex items-center gap-2.5 px-3.5 py-2.5">
            {enriching ? (
              <>
                <span className="animate-spin text-white text-base">⟳</span>
                <span className="text-white text-xs font-semibold">Buscando…</span>
              </>
            ) : enrichSummary ? (
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
                  <p className="text-white text-xs font-bold leading-none">Enriquecer Metadados</p>
                  <p className="text-white/55 text-[10px] mt-0.5">Spotify · iTunes</p>
                </div>
                <span className="text-white/40 text-xs">›</span>
              </>
            )}
          </div>
        </button>
      </div>

      {/* Save */}
      <div className="px-3 pb-4 mt-auto">
        <button
          onClick={handleSave}
          disabled={saving}
          className={`w-full py-2 rounded-md text-xs font-bold uppercase tracking-wider transition-colors ${
            saved
              ? "bg-[#2B4C28]/90 text-white"
              : "bg-[#D95340] hover:bg-[#E07364] active:bg-[#B34435] text-white"
          } disabled:opacity-50`}
        >
          {saving ? "Salvando…" : saved ? "✓ Salvo" : "Salvar Tags"}
        </button>
      </div>
    </div>
  );
}
