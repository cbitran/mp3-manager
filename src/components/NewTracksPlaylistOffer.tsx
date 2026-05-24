import type { Track } from "../store";

interface Props {
  tracks: Track[];
  onCreatePlaylist: (tracks: Track[]) => void;
  onDismiss: () => void;
}

export default function NewTracksPlaylistOffer({ tracks, onCreatePlaylist, onDismiss }: Props) {
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[260]">
      <div className="bg-[#1c1412] rounded-2xl w-[400px] mx-4 border border-white/[0.07] shadow-2xl overflow-hidden">
        <div className="h-px bg-[#D95340] opacity-40" />
        <div className="px-7 py-6 flex flex-col gap-4">

          <div>
            <p className="text-[10px] font-bold text-[#605A55] uppercase tracking-widest mb-1">
              Faixas adicionadas
            </p>
            <h2 className="text-[16px] font-bold text-[#F5F5F4]">
              Criar uma playlist com essas {tracks.length} faixas?
            </h2>
            <p className="text-[11px] text-[#605A55] mt-1 leading-relaxed">
              Você pode exportá-la para Serato, rekordbox ou Traktor em seguida.
            </p>
          </div>

          {/* Preview mini-lista */}
          <div className="rounded-xl bg-white/[0.02] border border-white/[0.04] px-3 py-2 max-h-32 overflow-y-auto">
            {tracks.slice(0, 8).map((t) => (
              <div key={t.path} className="flex items-center gap-2 py-0.5">
                <span className="w-1 h-1 rounded-full bg-[#D95340]/50 shrink-0" />
                <span className="text-[10px] text-[#8F8883] truncate">
                  {t.artist && t.title ? `${t.artist} — ${t.title}` : t.filename}
                </span>
              </div>
            ))}
            {tracks.length > 8 && (
              <p className="text-[9px] text-[#4C4743] mt-1">
                + {tracks.length - 8} mais…
              </p>
            )}
          </div>

          <div className="flex items-center gap-3 pt-1">
            <button
              onClick={() => onCreatePlaylist(tracks)}
              className="flex-1 py-2.5 rounded-xl text-[12px] font-bold bg-[#D95340] hover:bg-[#E07364] text-white transition-colors"
            >
              Criar playlist
            </button>
            <button
              onClick={onDismiss}
              className="px-4 py-2.5 rounded-xl text-[12px] text-[#605A55] hover:text-[#8F8883] hover:bg-white/[0.05] transition-colors"
            >
              Não, obrigado
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
