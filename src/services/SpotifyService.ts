import { fetch as tFetch } from "@tauri-apps/plugin-http";

const CLIENT_ID = "b1c574848d0b491eb75f94f515e9c7de";
const CLIENT_SECRET = "e5593f4ca9644a4c8ea03ec0b3178913";

let cachedToken: string | null = null;
let tokenExpiry = 0;

async function getToken(): Promise<string> {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken!;
  const creds = btoa(`${CLIENT_ID}:${CLIENT_SECRET}`);
  const res = await tFetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { Authorization: `Basic ${creds}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  const data = await res.json();
  cachedToken = data.access_token;
  tokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
  return cachedToken!;
}

const NOTES = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
const CAMELOT_MAJOR = ["8B","3B","10B","5B","12B","7B","2B","9B","4B","11B","6B","1B"];
const CAMELOT_MINOR = ["5A","12A","7A","2A","9A","4A","11A","6A","1A","8A","3A","10A"];

export interface SpotifyFeatures {
  bpm: string;
  key: string;
  camelot: string;
  energy: number;
  danceability: number;
}

export interface SpotifyInfo {
  album: string;
  year: string;
  coverUrl: string;
  features: SpotifyFeatures | null;
}

async function searchTrackId(title: string, artist: string, token: string): Promise<{ id: string; album: string; year: string; coverUrl: string } | null> {
  const clean = title.replace(/\.(mp3|flac|wav|aiff?)$/i, "").trim();
  const q = artist ? `${clean} artist:${artist}` : clean;
  const res = await tFetch(
    `https://api.spotify.com/v1/search?q=${encodeURIComponent(q)}&type=track&limit=1`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const data = await res.json();
  const item = data.tracks?.items?.[0];
  if (!item) return null;
  return {
    id: item.id,
    album: item.album?.name ?? "",
    year: (item.album?.release_date ?? "").slice(0, 4),
    coverUrl: item.album?.images?.[0]?.url ?? "",
  };
}

async function getAudioFeatures(trackId: string, token: string): Promise<SpotifyFeatures | null> {
  try {
    const res = await tFetch(`https://api.spotify.com/v1/audio-features/${trackId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 403) return null; // deprecated for apps created after Nov 2024
    const f = await res.json();
    if (typeof f.key !== "number" || f.key < 0) return null;
    return {
      bpm: String(Math.round(f.tempo)),
      key: f.mode === 1 ? NOTES[f.key] : `${NOTES[f.key]}m`,
      camelot: f.mode === 1 ? CAMELOT_MAJOR[f.key] : CAMELOT_MINOR[f.key],
      energy: f.energy ?? 0,
      danceability: f.danceability ?? 0,
    };
  } catch {
    return null;
  }
}

export async function enrichTrackFull(title: string, artist: string): Promise<SpotifyInfo | null> {
  try {
    const token = await getToken();
    const track = await searchTrackId(title, artist, token);
    if (!track) return null;
    const features = await getAudioFeatures(track.id, token);
    return { album: track.album, year: track.year, coverUrl: track.coverUrl, features };
  } catch {
    return null;
  }
}

// Legacy - kept for backwards compatibility
export async function enrichTrack(title: string, artist: string): Promise<SpotifyFeatures | null> {
  const info = await enrichTrackFull(title, artist);
  return info?.features ?? null;
}

export async function batchEnrich(
  tracks: Array<{ id: string; title: string; artist: string; bpm?: string }>,
  onProgress: (id: string, info: SpotifyInfo) => void
): Promise<void> {
  for (const t of tracks) {
    const info = await enrichTrackFull(t.title || t.artist, t.artist);
    if (info) onProgress(t.id, info);
  }
}
