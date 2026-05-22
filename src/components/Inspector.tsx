import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
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
}

function Field({ label, value, onChange, disabled, placeholder, mono }: FieldProps) {
  return (
    <div>
      <label className="text-[10px] font-semibold text-gray-600 uppercase tracking-widest block mb-1">
        {label}
      </label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        placeholder={placeholder ?? ""}
        className={`w-full px-2.5 py-1.5 rounded-md bg-white/5 border border-white/10 text-xs text-gray-200 placeholder-gray-700 focus:outline-none focus:border-blue-500 focus:bg-white/8 disabled:opacity-30 transition-colors ${mono ? "font-mono" : ""}`}
      />
    </div>
  );
}

export default function Inspector() {
  const { selectedIds, tracks, updateTrack } = useAppStore();
  const selectedArr = [...selectedIds];
  const isBatch = selectedArr.length > 1;
  const first = tracks.find((t) => t.id === selectedArr[0]);

  const [title, setTitle]           = useState(first?.title ?? "");
  const [artist, setArtist]         = useState(first?.artist ?? "");
  const [album, setAlbum]           = useState(first?.album ?? "");
  const [genre, setGenre]           = useState(first?.genre ?? "");
  const [year, setYear]             = useState(first?.year?.toString() ?? "");
  const [trackNumber, setTrackNumber] = useState(first?.track_number?.toString() ?? "");
  const [bpm, setBpm]               = useState(first?.bpm ?? "");
  const [key, setKey]               = useState(first?.key ?? "");
  const [saving, setSaving]         = useState(false);
  const [saved, setSaved]           = useState(false);
  const [enriching, setEnriching]   = useState(false);
  const [enrichSummary, setEnrichSummary] = useState<string | null>(null);
  const [coverDataUrl, setCoverDataUrl]   = useState<string | null>(null);

  useEffect(() => {
    if (!first) return;
    setTitle(first.title ?? "");
    setArtist(first.artist ?? "");
    setAlbum(first.album ?? "");
    setGenre(first.genre ?? "");
    setYear(first.year?.toString() ?? "");
    setTrackNumber(first.track_number?.toString() ?? "");
    setBpm(first.bpm ?? "");
    setKey(first.key ?? "");
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
          bpm: bpm || null,
          key: key || null,
          rating: null,
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
          bpm: bpm || undefined,
          key: key || undefined,
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
    <div className="w-64 shrink-0 flex flex-col border-l border-white/[0.06] bg-[#17171c] overflow-y-auto">
      {/* Header */}
      <div className="px-4 py-3 border-b border-white/[0.06]">
        <p className="text-[10px] font-semibold text-gray-600 uppercase tracking-widest">
          {isBatch ? `${selectedArr.length} faixas selecionadas` : "Inspector"}
        </p>
        {!isBatch && (
          <p className="text-xs text-gray-500 mt-1 truncate leading-tight">{first.filename}</p>
        )}
      </div>

      {/* Cover art thumbnail */}
      {!isBatch && coverDataUrl && (
        <div className="mx-3 mt-3">
          <img
            src={coverDataUrl}
            alt="Cover"
            className="w-full rounded-lg object-cover"
            style={{ maxHeight: 180 }}
          />
        </div>
      )}

      {/* Cover placeholder */}
      {!isBatch && !coverDataUrl && (
        <div className="mx-3 mt-3 h-16 rounded-lg bg-white/[0.03] border border-white/[0.06] flex items-center justify-center">
          <span className="text-gray-700 text-xs">sem capa</span>
        </div>
      )}

      {/* Issues */}
      {!isBatch && first.issues.length > 0 && (
        <div className="mx-3 mt-3 p-2.5 rounded-md bg-amber-500/10 border border-amber-500/20">
          <p className="text-[10px] font-semibold text-amber-400 uppercase tracking-wide mb-1">
            Problemas
          </p>
          {first.issues.map((issue) => (
            <p key={issue} className="text-xs text-amber-300/80">
              • {issue}
            </p>
          ))}
        </div>
      )}

      {/* Fields */}
      <div className="flex flex-col gap-3 px-3 py-4">
        <Field
          label="Título"
          value={title}
          onChange={setTitle}
          disabled={isBatch}
          placeholder={isBatch ? "(múltiplos)" : ""}
        />
        <Field label="Artista" value={artist} onChange={setArtist} />
        <Field label="Álbum" value={album} onChange={setAlbum} />
        <Field label="Gênero" value={genre} onChange={setGenre} />
        <div className="grid grid-cols-2 gap-2">
          <Field label="Ano" value={year} onChange={setYear} />
          <Field label="Faixa #" value={trackNumber} onChange={setTrackNumber} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field label="BPM" value={bpm} onChange={setBpm} mono />
          <Field label="Tom" value={key} onChange={setKey} mono />
        </div>

        {/* Enriquecer Metadados */}
        <button
          onClick={enrichAll}
          disabled={enriching}
          className="w-full rounded-xl disabled:opacity-60 overflow-hidden"
          style={{
            background: enriching
              ? "rgba(99,102,241,0.3)"
              : enrichSummary
              ? "rgba(22,163,74,0.2)"
              : "linear-gradient(to right, #1e9e66, #2e6bd4)",
          }}
        >
          <div className="flex items-center gap-2.5 px-3.5 py-2.5">
            {enriching ? (
              <>
                <span className="animate-spin text-white text-base">⟳</span>
                <span className="text-white text-xs font-semibold">Buscando metadados…</span>
              </>
            ) : enrichSummary ? (
              <>
                <span className="text-white text-sm">
                  {enrichSummary.startsWith("✓") ? "✓" : "✗"}
                </span>
                <span className="text-white/90 text-[11px] font-medium flex-1 text-left leading-tight">
                  {enrichSummary.replace(/^[✓✗]\s*/, "")}
                </span>
                <span className="text-white/60 text-xs">↺</span>
              </>
            ) : (
              <>
                <span className="text-white text-base">✦</span>
                <div className="flex-1 text-left">
                  <p className="text-white text-xs font-bold leading-none">Enriquecer Metadados</p>
                  <p className="text-white/65 text-[10px] mt-0.5">Spotify · iTunes · Last.fm</p>
                </div>
                <span className="text-white/50 text-xs">›</span>
              </>
            )}
          </div>
        </button>
      </div>

      {/* Actions */}
      <div className="px-3 pb-4 mt-auto flex flex-col gap-2">
        <button
          onClick={handleSave}
          disabled={saving}
          className={`w-full py-2 rounded-md text-xs font-semibold transition-colors ${
            saved
              ? "bg-emerald-600 text-white"
              : "bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white"
          } disabled:opacity-50`}
        >
          {saving ? "Salvando…" : saved ? "✓ Salvo" : "Salvar Tags"}
        </button>
      </div>
    </div>
  );
}
