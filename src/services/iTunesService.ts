import { fetch as tFetch } from "@tauri-apps/plugin-http";

const FETCH_TIMEOUT_MS = 8000;

export interface iTunesResult {
  genre: string;
  year: string;
  album: string;
  artworkUrl: string;
  artistName: string;
  trackName: string;
  matchPhase?: "exact" | "fuzzy";
}

const VERSION_PATTERN = /\s*[\[(](extended|radio|club|original|dub|instrumental|remix|mix|edit|version|vocal|acapella|live|acoustic|reprise|remaster\w*|feat\.?|ft\.?)(\s+[^\])]*)?[\])]\s*$/gi;
const VERSION_DASH    = /\s+-\s+(extended|radio|club|original|dub|instrumental|remix|mix|edit|version|vocal|live|acoustic)\s*$/gi;

function stripVersionInfo(title: string): string {
  return title.replace(VERSION_PATTERN, "").replace(VERSION_DASH, "").trim();
}

function fetchWithTimeout(url: string, ms = FETCH_TIMEOUT_MS) {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), ms);
  return tFetch(url, { signal: abort.signal }).finally(() => clearTimeout(timer));
}

async function queryiTunes(title: string, artist: string): Promise<iTunesResult | null> {
  const term = artist ? `${artist} ${title}` : title;
  try {
    const res = await fetchWithTimeout(
      `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=song&media=music&limit=5`
    );
    const data = await res.json();
    const results: any[] = data.results ?? [];
    if (!results.length) return null;

    const norm = (s: string) =>
      s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    const tNorm = norm(title);
    const aNorm = norm(artist);

    const best =
      results.find(
        (r: any) =>
          norm(r.trackName ?? "").includes(tNorm) &&
          (!aNorm || norm(r.artistName ?? "").includes(aNorm))
      ) ?? results[0];

    const artworkUrl = (best.artworkUrl100 ?? "")
      .replace("100x100bb", "600x600bb")
      .replace("/100x100", "/600x600");

    return {
      genre: best.primaryGenreName ?? "",
      year: (best.releaseDate ?? "").slice(0, 4),
      album: best.collectionName ?? "",
      artworkUrl,
      artistName: best.artistName ?? "",
      trackName: best.trackName ?? "",
    };
  } catch {
    return null;
  }
}

export async function searchTrack(title: string, artist: string): Promise<iTunesResult | null> {
  // Fase 1 — nome completo (com versão)
  const hit1 = await queryiTunes(title, artist);
  if (hit1) return { ...hit1, matchPhase: "exact" };

  // Fase 2 — sem info de versão
  const stripped = stripVersionInfo(title);
  if (stripped && stripped !== title) {
    const hit2 = await queryiTunes(stripped, artist);
    if (hit2) return { ...hit2, matchPhase: "fuzzy" };
  }

  return null;
}
