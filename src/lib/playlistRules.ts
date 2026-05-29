import { invoke } from "@tauri-apps/api/core";
import { useAppStore, type PlaylistGlobalProperties, type Track } from "../store";

/**
 * Aplica as regras globais de uma playlist nas faixas indicadas.
 * Salva tags e capa no disco, depois re-escaneia para sincronizar o store
 * com o estado real dos arquivos (garante que o UI reflita o disco).
 */
export async function applyPlaylistRules(
  props: PlaylistGlobalProperties,
  paths: string[]
): Promise<void> {
  if (!props.enabled || props.activeFields.length === 0 || paths.length === 0) return;

  useAppStore.getState().setGlobalLoading("aplicando regras…");

  const hasTagFields = props.activeFields.some((f) => f !== "cover");
  const hasCoverField = props.activeFields.includes("cover") && !!props.cover;

  try {
    // Garante que todas as faixas estão no store antes de processar.
    const missingPaths = paths.filter(
      (p) => !useAppStore.getState().tracks.find((t) => t.path === p)
    );
    if (missingPaths.length > 0) {
      const scanned = await invoke<Track[]>("scan_specific_files", { paths: missingPaths });
      if (scanned.length > 0) {
        const current = useAppStore.getState().tracks;
        const existingSet = new Set(current.map((t) => t.path));
        const fresh = scanned.filter((t) => !existingSet.has(t.path));
        if (fresh.length > 0) useAppStore.getState().setTracks([...current, ...fresh]);
      }
    }

    // Aplica saves no disco para todas as faixas
    for (const path of paths) {
      const tr = useAppStore.getState().tracks.find((t) => t.path === path);

      if (hasTagFields) {
        await invoke("save_tags", {
          path,
          title:       tr?.title        ?? null,
          artist:      tr?.artist       ?? null,
          year:        tr?.year         ?? null,
          trackNumber: tr?.track_number ?? null,
          totalTracks: tr?.total_tracks ?? null,
          bpm:         tr?.bpm          ?? null,
          key:         tr?.key          ?? null,
          rating:      tr?.rating       ?? null,
          album:   props.activeFields.includes("album")   ? props.album   ?? null : tr?.album   ?? null,
          genre:   props.activeFields.includes("genre")   ? props.genre   ?? null : tr?.genre   ?? null,
          comment: props.activeFields.includes("comment") ? props.comment ?? null : tr?.comment ?? null,
        }).catch(() => null);
      }

      if (hasCoverField) {
        await invoke("save_cover_from_file", { path, imagePath: props.cover })
          .catch(() => null);
      }
    }

    // Re-escaneia todas as faixas para sincronizar o store com o disco.
    // cover_version retorna sempre 0 do Rust; ao comparar com o valor anterior,
    // a mudança garante que CoverCell invalida o cache e re-busca a imagem.
    const refreshed = await invoke<Track[]>("scan_specific_files", { paths });
    for (const fresh of refreshed) {
      const existing = useAppStore.getState().tracks.find((t) => t.path === fresh.path);
      useAppStore.getState().updateTrack({
        ...fresh,
        // Preserva campos que não vêm do scan (CUE, beat grid, etc.)
        cue_points:    existing?.cue_points    ?? fresh.cue_points,
        beat_phase_ms: existing?.beat_phase_ms ?? fresh.beat_phase_ms,
        beat_anchors:  existing?.beat_anchors  ?? fresh.beat_anchors,
        // Bump cover_version para invalidar cache do CoverCell quando capa foi aplicada
        cover_version: hasCoverField
          ? (existing?.cover_version ?? 0) + 1
          : existing?.cover_version ?? fresh.cover_version,
      });
    }
  } finally {
    useAppStore.getState().setGlobalLoading(null);
  }
}
