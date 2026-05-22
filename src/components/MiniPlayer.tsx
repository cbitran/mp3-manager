import { useState, useRef, useEffect } from "react";
import { useAppStore } from "../store";

export default function MiniPlayer() {
  const { tracks, selectedIds } = useAppStore();
  const [currentTrack] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.8);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const track = tracks.find((t) => t.id === currentTrack) ?? tracks.find((t) => selectedIds.has(t.id));

  useEffect(() => {
    if (!track) return;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = track.path;
      audioRef.current.volume = volume;
      if (isPlaying) audioRef.current.play().catch(() => {});
    }
  }, [track?.id]);

  useEffect(() => {
    if (!audioRef.current) return;
    const audio = audioRef.current;
    const onTime = () => setProgress(audio.currentTime);
    const onDuration = () => setDuration(audio.duration || 0);
    const onEnded = () => setIsPlaying(false);
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("loadedmetadata", onDuration);
    audio.addEventListener("ended", onEnded);
    return () => {
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("loadedmetadata", onDuration);
      audio.removeEventListener("ended", onEnded);
    };
  }, []);

  function togglePlay() {
    if (!audioRef.current || !track) return;
    if (audioRef.current.src !== track.path) {
      audioRef.current.src = track.path;
    }
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play().catch(() => {});
    }
    setIsPlaying(!isPlaying);
  }

  function handleSeek(e: React.ChangeEvent<HTMLInputElement>) {
    const val = parseFloat(e.target.value);
    setProgress(val);
    if (audioRef.current) audioRef.current.currentTime = val;
  }

  function handleVolume(e: React.ChangeEvent<HTMLInputElement>) {
    const val = parseFloat(e.target.value);
    setVolume(val);
    if (audioRef.current) audioRef.current.volume = val;
  }

  function fmt(s: number) {
    if (!isFinite(s)) return "0:00";
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60).toString().padStart(2, "0");
    return `${m}:${sec}`;
  }

  return (
    <div className="border-t border-white/[0.06] bg-[#1f1f26] px-4 py-2.5 flex items-center gap-4">
      <audio ref={audioRef} />

      {/* Info */}
      <div className="w-48 shrink-0">
        {track ? (
          <>
            <p className="text-xs font-semibold text-gray-200 truncate">
              {track.title ?? track.filename}
            </p>
            <p className="text-[11px] text-gray-500 truncate">{track.artist ?? "—"}</p>
          </>
        ) : (
          <p className="text-xs text-gray-700 italic">Nenhuma faixa selecionada</p>
        )}
      </div>

      {/* Controls */}
      <div className="flex flex-col items-center flex-1 gap-1">
        <div className="flex items-center gap-4">
          <button className="text-gray-500 hover:text-gray-300 text-sm transition-colors">⏮</button>
          <button
            onClick={togglePlay}
            disabled={!track}
            className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 disabled:opacity-30 flex items-center justify-center text-sm transition-colors"
          >
            {isPlaying ? "⏸" : "▶"}
          </button>
          <button className="text-gray-500 hover:text-gray-300 text-sm transition-colors">⏭</button>
        </div>
        <div className="flex items-center gap-2 w-full max-w-md">
          <span className="text-[10px] text-gray-600 w-8 text-right">{fmt(progress)}</span>
          <input
            type="range"
            min={0}
            max={duration || 1}
            value={progress}
            onChange={handleSeek}
            className="flex-1 h-1 accent-blue-500 cursor-pointer"
          />
          <span className="text-[10px] text-gray-600 w-8">{fmt(duration)}</span>
        </div>
      </div>

      {/* Volume */}
      <div className="flex items-center gap-2 w-28 shrink-0 justify-end">
        <span className="text-xs text-gray-600">🔈</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={volume}
          onChange={handleVolume}
          className="w-20 h-1 accent-blue-500 cursor-pointer"
        />
      </div>
    </div>
  );
}
