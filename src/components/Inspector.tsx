import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "../store";
import { enrichTrack, type SpotifyFeatures } from "../services/SpotifyService";

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
  const { selectedIds, tracks, setTracks } = useAppStore();
  const selectedArr = [...selectedIds];
  const isBatch = selectedArr.length > 1;
  const first = tracks.find((t) => t.id === selectedArr[0]);

  const [title, setTitle] = useState(first?.title ?? "");
  const [artist, setArtist] = useState(first?.artist ?? "");
  const [album, setAlbum] = useState(first?.album ?? "");
  const [genre, setGenre] = useState(first?.genre ?? "");
  const [year, setYear] = useState(first?.year?.toString() ?? "");
  const [trackNumber, setTrackNumber] = useState(first?.track_number?.toString() ?? "");
  const [bpm, setBpm] = useState(first?.bpm ?? "");
  const [key, setKey] = useState(first?.key ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const [spotifyLoading, setSpotifyLoading] = useState(false);
  const [spotifyResult, setSpotifyResult] = useState<SpotifyFeatures | null>(null);
  const [spotifyError, setSpotifyError] = useState(false);

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
    setSpotifyResult(null);
    setSpotifyError(false);
  }, [first?.id]);

  async function fetchSpotify() {
    if (!first) return;
    setSpotifyLoading(true);
    setSpotifyError(false);
    try {
      const f = await enrichTrack(title || first.filename, artist);
      if (f) {
        setBpm(f.bpm);
        setKey(f.key);
        setSpotifyResult(f);
      } else {
        setSpotifyError(true);
      }
    } catch {
      setSpotifyError(true);
    } finally {
      setSpotifyLoading(false);
    }
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
      }
      setTracks(
        tracks.map((t) => {
          if (!selectedIds.has(t.id)) return t;
          const updated = {
            ...t,
            title: title || undefined,
            artist: artist || undefined,
            album: album || undefined,
            genre: genre || undefined,
            year: year ? parseInt(year) : undefined,
            track_number: trackNumber ? parseInt(trackNumber) : undefined,
            bpm: bpm || undefined,
            key: key || undefined,
          };
          const issues: string[] = [];
          if (!updated.title) issues.push("sem título");
          if (!updated.artist) issues.push("sem artista");
          if (!updated.genre) issues.push("sem gênero");
          if (!updated.has_cover) issues.push("sem capa");
          if (!updated.bpm) issues.push("sem BPM");
          return { ...updated, issues };
        })
      );
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
          <p className="text-xs text-gray-500 mt-1 truncate leading-tight">
            {first.filename}
          </p>
        )}
      </div>

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

        {/* BPM + Tom */}
        <div className="grid grid-cols-2 gap-2">
          <Field label="BPM" value={bpm} onChange={setBpm} mono />
          <Field label="Tom" value={key} onChange={setKey} mono />
        </div>

        {/* Spotify */}
        {!isBatch && (
          <div>
            <button
              onClick={fetchSpotify}
              disabled={spotifyLoading}
              className="w-full py-1.5 rounded-md text-xs font-semibold bg-[#1DB954]/20 hover:bg-[#1DB954]/30 text-[#1DB954] border border-[#1DB954]/30 transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
            >
              {spotifyLoading ? (
                <><span className="animate-spin text-sm">⟳</span> Buscando…</>
              ) : (
                <>♫ Enriquecer com Spotify</>
              )}
            </button>
            {spotifyResult && (
              <p className="mt-1.5 text-[10px] text-emerald-400 text-center">
                ✓ BPM {spotifyResult.bpm} · {spotifyResult.key} · E:{(spotifyResult.energy * 100).toFixed(0)}%
              </p>
            )}
            {spotifyError && (
              <p className="mt-1.5 text-[10px] text-red-400 text-center">
                Não encontrado no Spotify
              </p>
            )}
          </div>
        )}
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
