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
  st.setGlobalLoading("aplicando regras…");

  const hasTagFields = props.activeFields.some((f) => f !== "cover");

  try {
  for (const path of paths) {
    const tr = useAppStore.getState().tracks.find((t) => t.path === path);

    // Só chama save_tags se há campos de metadados para atualizar (não só capa)
    let tagsSaved = false;
    if (hasTagFields) {
      tagsSaved = await invoke("save_tags", {
        path,
        // Sempre preservar title/artist/demais campos do track — nunca sobrescrever
        title:        tr?.title        ?? null,
        artist:       tr?.artist       ?? null,
        year:         tr?.year         ?? null,
        trackNumber:  tr?.track_number ?? null,
        totalTracks:  tr?.total_tracks ?? null,
        bpm:          tr?.bpm          ?? null,
        key:          tr?.key          ?? null,
        rating:       tr?.rating       ?? null,
        // Sobrescrever só os campos ativos nas regras da playlist
        album:   props.activeFields.includes("album")   ? props.album   ?? null : tr?.album   ?? null,
        genre:   props.activeFields.includes("genre")   ? props.genre   ?? null : tr?.genre   ?? null,
        comment: props.activeFields.includes("comment") ? props.comment ?? null : tr?.comment ?? null,
      }).then(() => true).catch(() => false);
    }

    let coverSaved = false;
    if (props.activeFields.includes("cover") && props.cover) {
      coverSaved = await invoke("save_cover_from_file", { path, imagePath: props.cover })
        .then(() => true).catch(() => false);
    }

    if (!tr) continue;
    st.updateTrack({
      ...tr,
      album:   props.activeFields.includes("album")   && tagsSaved ? props.album   ?? tr.album   : tr.album,
      genre:   props.activeFields.includes("genre")   && tagsSaved ? props.genre   ?? tr.genre   : tr.genre,
      comment: props.activeFields.includes("comment") && tagsSaved ? props.comment ?? tr.comment : tr.comment,
      has_cover: coverSaved ? true : tr.has_cover,
      cover_version: coverSaved ? (tr.cover_version ?? 0) + 1 : tr.cover_version,
    });
  }
  } finally {
    useAppStore.getState().setGlobalLoading(null);
  }
}
