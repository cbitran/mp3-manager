import { invoke } from "@tauri-apps/api/core";
import { useAppStore, type PlaylistGlobalProperties, type Track } from "../store";
import { invalidateCoverCacheMany } from "./coverCache";

/**
 * Aplica as regras globais de uma playlist nas faixas indicadas.
 * - Tags: save_tags por faixa
 * - Capa: lê a imagem UMA vez via read_file_base64, depois aplica via save_cover_b64
 *   (separar leitura de imagem da escrita no áudio evita falhas de path no Windows)
 * - Re-scan pós-save: sincroniza store com disco (cover_version bump invalida cache UI)
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
    // Garante que todas as faixas estão no store
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

    // Usa b64 pré-carregado se disponível (Windows: evita problemas de path na releitura)
    // Fallback: lê do arquivo (compatibilidade com regras antigas sem coverB64)
    let coverB64: string | null = null;
    let coverIsPng = false;
    if (hasCoverField) {
      if (props.coverB64) {
        coverB64 = props.coverB64;
        coverIsPng = props.coverIsPng ?? false;
      } else if (props.cover) {
        coverIsPng = props.cover.toLowerCase().endsWith(".png");
        coverB64 = await invoke<string | null>("read_file_base64", { path: props.cover })
          .catch(() => null);
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

      if (hasCoverField && coverB64) {
        await invoke("save_cover_b64", { path, b64: coverB64, isPng: coverIsPng })
          .catch(() => null);
      }
    }

    // Invalida cache de capas ANTES de bumpar cover_version — garante re-fetch limpo no CoverCell
    if (hasCoverField && coverB64) invalidateCoverCacheMany(paths);

    // Re-scan para sincronizar store com estado real do disco
    const refreshed = await invoke<Track[]>("scan_specific_files", { paths });
    for (const fresh of refreshed) {
      const existing = useAppStore.getState().tracks.find((t) => t.path === fresh.path);
      useAppStore.getState().updateTrack({
        ...fresh,
        cue_points:    existing?.cue_points    ?? fresh.cue_points,
        beat_phase_ms: existing?.beat_phase_ms ?? fresh.beat_phase_ms,
        beat_anchors:  existing?.beat_anchors  ?? fresh.beat_anchors,
        // Bump cover_version para invalidar cache do CoverCell
        cover_version: hasCoverField && coverB64
          ? (existing?.cover_version ?? 0) + 1
          : existing?.cover_version ?? fresh.cover_version,
      });
    }
  } finally {
    useAppStore.getState().setGlobalLoading(null);
  }
}
