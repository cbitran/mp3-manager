import { useState, useRef, useEffect, useCallback } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { useAppStore } from "../store";

export default function MiniPlayer() {
  const { tracks, selectedIds, playerTrackId, setPlayerTrack } = useAppStore();
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress]   = useState(0);
  const [duration, setDuration]   = useState(0);
  const [volume, setVolume]       = useState(0.8);
  const [coverUrl, setCoverUrl]   = useState<string | null>(null);
  const audioRef   = useRef<HTMLAudioElement | null>(null);
  const loadedPath = useRef<string | null>(null);

  const selectedArr = [...selectedIds];
  const activeId    = playerTrackId ?? selectedArr[0] ?? null;
  const activeTrack = tracks.find((t) => t.id === activeId) ?? null;

  useEffect(() => {
    if (!activeTrack || !audioRef.current) return;
    if (loadedPath.current === activeTrack.path) return;
    loadedPath.current = activeTrack.path;
    const src = convertFileSrc(activeTrack.path);
    audioRef.current.src = src;
    audioRef.current.volume = volume;
    audioRef.current.load();
    setProgress(0);
    setDuration(0);
    if (isPlaying) audioRef.current.play().catch(console.error);
    if (activeTrack.has_cover) {
      invoke<string | null>("read_cover_base64", { path: activeTrack.path })
        .then((b64) => setCoverUrl(b64 ? `data:image/jpeg;base64,${b64}` : null))
        .catch(() => setCoverUrl(null));
    } else {
      setCoverUrl(null);
    }
  }, [activeTrack?.id]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onTime = () => setProgress(audio.currentTime);
    const onDur  = () => setDuration(isFinite(audio.duration) ? audio.duration : 0);
    const onEnd  = () => {
      setProgress(0);
      const { tracks: all, playerTrackId: cur } = useAppStore.getState();
      if (cur) {
        const idx = all.findIndex((t) => t.id === cur);
        const next = all[idx + 1];
        if (next) { useAppStore.getState().setPlayerTrack(next.id); return; }
      }
      setIsPlaying(false);
    };
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("loadedmetadata", onDur);
    audio.addEventListener("ended", onEnd);
    return () => {
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("loadedmetadata", onDur);
      audio.removeEventListener("ended", onEnd);
    };
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA") return;
      if (e.key === " ")               { e.preventDefault(); togglePlay(); }
      else if (e.key === "ArrowRight") { e.preventDefault(); skipTrack(1); }
      else if (e.key === "ArrowLeft")  { e.preventDefault(); skipTrack(-1); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeTrack, isPlaying]);

  function togglePlay() {
    if (!audioRef.current || !activeTrack) return;
    if (!playerTrackId && selectedArr[0]) setPlayerTrack(selectedArr[0]);
    if (isPlaying) { audioRef.current.pause(); setIsPlaying(false); }
    else           { audioRef.current.play().catch(console.error); setIsPlaying(true); }
  }

  function skipTrack(dir: 1 | -1) {
    if (!activeTrack) return;
    const idx = tracks.findIndex((t) => t.id === activeTrack.id);
    const next = tracks[idx + dir];
    if (next) { setPlayerTrack(next.id); setIsPlaying(true); }
  }

  const handleSeek = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!audioRef.current || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const t = ((e.clientX - rect.left) / rect.width) * duration;
    audioRef.current.currentTime = t;
    setProgress(t);
  }, [duration]);

  function handleVolume(e: React.MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const v = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    setVolume(v);
    if (audioRef.current) audioRef.current.volume = v;
  }

  function fmt(s: number) {
    if (!isFinite(s) || s < 0) return "0:00";
    return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  }

  const pct = duration > 0 ? (progress / duration) * 100 : 0;

  return (
    <div className="bg-[#0E0D0C] select-none">
      <audio ref={audioRef} />

      {/* ── Linha de progresso no topo — assinatura visual do DS ── */}
      <div className="h-px bg-[#23201E]">
        <div className="h-full bg-[#D95340] transition-none" style={{ width: `${pct}%` }} />
      </div>

      <div className="flex items-center h-14 px-5 gap-0">

        {/* ── ZONA 1: Capa + Info ───────────────────────────────── */}
        <div className="flex items-center gap-3 w-56 shrink-0 min-w-0 pr-5">
          {/* Indicador coral (● estilo do DS) */}
          <span className={`w-[5px] h-[5px] rounded-full shrink-0 transition-colors ${
            isPlaying ? "bg-[#D95340]" : "bg-[#373331]"
          }`} />

          {/* Capa miniatura */}
          <div className="shrink-0 w-7 h-7 rounded overflow-hidden bg-[#23201E] border border-white/[0.05] flex items-center justify-center">
            {coverUrl
              ? <img src={coverUrl} alt="" className="w-full h-full object-cover" />
              : <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="#373331" strokeWidth="1.1" strokeLinecap="round">
                  <circle cx="5" cy="4.5" r="2"/><path d="M1 9.5c0-2.21 1.79-4 4-4s4 1.79 4 4"/>
                </svg>
            }
          </div>

          {/* Título + Artista */}
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold text-[#DCDAD8] truncate leading-tight tracking-[-0.01em]">
              {activeTrack?.title ?? activeTrack?.filename ?? <span className="text-[#373331] font-normal italic">sem faixa</span>}
            </p>
            <p className="text-[9px] text-[#605A55] truncate leading-none mt-[3px] tracking-wide uppercase">
              {activeTrack?.artist ?? ""}
            </p>
          </div>
        </div>

        {/* Separador */}
        <div className="w-px h-6 bg-[#23201E] shrink-0" />

        {/* ── ZONA 2: Controles de transporte ──────────────────── */}
        <div className="flex items-center gap-3.5 px-5 shrink-0">
          {/* Anterior */}
          <button onClick={() => skipTrack(-1)} disabled={!activeTrack}
            className="text-[#4C4743] hover:text-[#756D67] disabled:opacity-25 transition-colors">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
              <rect x="1" y="1" width="1.5" height="10" rx="0.5"/>
              <path d="M10.5 1.5L4 6l6.5 4.5V1.5z"/>
            </svg>
          </button>

          {/* Play / Pause — botão principal com coral */}
          <button
            onClick={togglePlay}
            disabled={!activeTrack}
            className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 transition-all duration-150 disabled:opacity-25 ${
              isPlaying
                ? "bg-[#D95340] shadow-[0_0_12px_rgba(217,83,64,0.35)]"
                : "bg-transparent border border-[#D95340]/70 hover:border-[#D95340] hover:bg-[#D95340]/8"
            }`}
          >
            {isPlaying
              ? <svg width="8" height="9" viewBox="0 0 8 9" fill="white">
                  <rect x="0.5" y="0.5" width="2.5" height="8" rx="0.5"/>
                  <rect x="5" y="0.5" width="2.5" height="8" rx="0.5"/>
                </svg>
              : <svg width="8" height="9" viewBox="0 0 8 9" fill="#D95340" style={{ marginLeft: "1px" }}>
                  <path d="M1 0.5L7.5 4.5 1 8.5V0.5z"/>
                </svg>
            }
          </button>

          {/* Próximo */}
          <button onClick={() => skipTrack(1)} disabled={!activeTrack}
            className="text-[#4C4743] hover:text-[#756D67] disabled:opacity-25 transition-colors">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
              <rect x="9.5" y="1" width="1.5" height="10" rx="0.5"/>
              <path d="M1.5 1.5L8 6 1.5 10.5V1.5z"/>
            </svg>
          </button>
        </div>

        {/* Separador */}
        <div className="w-px h-6 bg-[#23201E] shrink-0" />

        {/* ── ZONA 3: Progresso — linha fina no estilo DS ──────── */}
        <div className="flex items-center gap-3 flex-1 min-w-0 px-5">
          <span className="text-[9px] text-[#4C4743] font-mono tabular-nums shrink-0 w-7 text-right">
            {fmt(progress)}
          </span>

          <div onClick={handleSeek}
            className="relative flex-1 h-5 flex items-center cursor-pointer group">
            {/* Trilha */}
            <div className="absolute inset-x-0 h-px bg-[#23201E] rounded-full" />
            {/* Progresso coral */}
            <div className="absolute left-0 h-px bg-[#D95340]/80 rounded-full"
              style={{ width: `${pct}%` }} />
            {/* Thumb — aparece no hover */}
            <div
              className="absolute w-[5px] h-[5px] rounded-full bg-[#D95340] -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity"
              style={{ left: `${pct}%` }}
            />
          </div>

          <span className="text-[9px] text-[#4C4743] font-mono tabular-nums shrink-0 w-7">
            {fmt(duration)}
          </span>
        </div>

        {/* Separador */}
        <div className="w-px h-6 bg-[#23201E] shrink-0" />

        {/* ── ZONA 4: Volume ───────────────────────────────────── */}
        <div className="flex items-center gap-2.5 pl-5 shrink-0">
          {/* Ícone de speaker */}
          <svg width="9" height="9" viewBox="0 0 9 9" fill="none">
            <path d="M1 3h1.6L5 1v7L2.6 6H1V3z" fill="#4C4743"/>
            <path d="M6.5 2.5a2.5 2.5 0 010 4" stroke="#4C4743" strokeWidth="0.8" strokeLinecap="round" fill="none"/>
          </svg>

          <div onClick={handleVolume}
            className="relative w-14 h-5 flex items-center cursor-pointer group">
            <div className="absolute inset-x-0 h-px bg-[#23201E] rounded-full" />
            <div className="absolute left-0 h-px bg-[#605A55] group-hover:bg-[#756D67] transition-colors rounded-full"
              style={{ width: `${volume * 100}%` }} />
            <div
              className="absolute w-[5px] h-[5px] rounded-full bg-[#4C4743] group-hover:bg-[#756D67] -translate-x-1/2 transition-colors"
              style={{ left: `${volume * 100}%` }}
            />
          </div>
        </div>

      </div>
    </div>
  );
}
