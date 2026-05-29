import { invoke } from "@tauri-apps/api/core";
import { useAppStore, type PlaylistGlobalProperties, type Track } from "../store";

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
    // Garante que todas as faixas estão no store antes de processar.
    // Tracks de outras pastas podem não estar carregadas — escaneamos e mergeamos.
    const missingPaths = paths.filter((p) => !useAppStore.getState().tracks.find((t) => t.path === p));
    if (missingPaths.length > 0) {
      const scanned = await invoke<Track[]>("scan_specific_files", { paths: missingPaths });
      if (scanned.length > 0) {
        const current = useAppStore.getState().tracks;
        const existingSet = new Set(current.map((t) => t.path));
        const fresh = scanned.filter((t) => !existingSet.has(t.path));
        if (fresh.length > 0) useAppStore.getState().setTracks([...current, ...fresh]);
      }
    }

    for (const path of paths) {
      const tr = useAppStore.getState().tracks.find((t) => t.path === path);

      let tagsSaved = false;
      if (hasTagFields) {
        tagsSaved = await invoke("save_tags", {
          path,
          title:        tr?.title        ?? null,
          artist:       tr?.artist       ?? null,
          year:         tr?.year         ?? null,
          trackNumber:  tr?.track_number ?? null,
          totalTracks:  tr?.total_tracks ?? null,
          bpm:          tr?.bpm          ?? null,
          key:          tr?.key          ?? null,
          rating:       tr?.rating       ?? null,
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
      useAppStore.getState().updateTrack({
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
