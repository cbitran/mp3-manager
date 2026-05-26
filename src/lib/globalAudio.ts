// Ref global para o elemento de áudio — MiniPlayer preenche, CuePointsModal lê diretamente
export const globalAudio: { el: HTMLAudioElement | null; isPlaying: boolean } = {
  el: null,
  isPlaying: false,
};
