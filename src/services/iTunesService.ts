import { fetch as tFetch } from "@tauri-apps/plugin-http";

export interface iTunesResult {
  genre: string;
  year: string;
  album: string;
  artworkUrl: string;
  artistName: string;
  trackName: string;
}

export async function searchTrack(title: string, artist: string): Promise<iTunesResult | null> {
  const term = artist ? `${artist} ${title}` : title;
  try {
    const res = await tFetch(
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
