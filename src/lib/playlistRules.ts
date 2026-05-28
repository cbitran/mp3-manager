import { invoke } from "@tauri-apps/api/core";
import { useAppStore, type PlaylistGlobalProperties } from "../store";

/**
 * Aplica as regras globais de uma playlist nas faixas indicadas.
 * Salva tags e capa no disco e atualiza o store em memória.
 */
export async function applyPlaylistRules(
  props: PlaylistGlobalProperties,
  paths: string[]
): Promise<void> {
  if (!props.enabled || props.activeFields.length === 0 || paths.length === 0) return;

  const st = useAppStore.getState();

  const hasTagFields = props.activeFields.some((f) => f !== "cover");

  for (const path of paths) {
    // Só chama save_tags se há campos de metadados para atualizar (não só capa)
    if (hasTagFields) {
      await invoke("save_tags", {
        path,
        title: null, artist: null, year: null, trackNumber: null,
        totalTracks: null, bpm: null, key: null, rating: null,
        album:   props.activeFields.includes("album")   ? props.album   ?? null : null,
        genre:   props.activeFields.includes("genre")   ? props.genre   ?? null : null,
        comment: props.activeFields.includes("comment") ? props.comment ?? null : null,
      }).catch(() => {});
    }

    if (props.activeFields.includes("cover") && props.cover) {
      await invoke("save_cover_from_file", { path, imagePath: props.cover }).catch(() => {});
    }

    const tr = useAppStore.getState().tracks.find((t) => t.path === path);
    if (!tr) continue;
    st.updateTrack({
      ...tr,
      album:  props.activeFields.includes("album")  ? props.album  ?? tr.album  : tr.album,
      genre:  props.activeFields.includes("genre")  ? props.genre  ?? tr.genre  : tr.genre,
      comment: props.activeFields.includes("comment") ? props.comment ?? tr.comment : tr.comment,
      has_cover: props.activeFields.includes("cover") && !!props.cover ? true : tr.has_cover,
      cover_version:
        props.activeFields.includes("cover") && !!props.cover
          ? (tr.cover_version ?? 0) + 1
          : tr.cover_version,
    });
  }
}
