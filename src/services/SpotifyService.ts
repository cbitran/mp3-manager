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

export interface SpotifyFeatures {
  bpm: string;
  key: string;
  camelot: string;
  energy: number;
  danceability: number;
}

const CAMELOT_MAJOR = ["8B","3B","10B","5B","12B","7B","2B","9B","4B","11B","6B","1B"];
const CAMELOT_MINOR = ["5A","12A","7A","2A","9A","4A","11A","6A","1A","8A","3A","10A"];

export async function enrichTrack(title: string, artist: string): Promise<SpotifyFeatures | null> {
  try {
    const token = await getToken();
    const clean = title.replace(/\.(mp3|flac|wav|aiff?)$/i, "").trim();
    const q = artist ? `${clean} artist:${artist}` : clean;
    const searchRes = await tFetch(
      `https://api.spotify.com/v1/search?q=${encodeURIComponent(q)}&type=track&limit=1`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const searchData = await searchRes.json();
    const trackId: string | undefined = searchData.tracks?.items?.[0]?.id;
    if (!trackId) return null;

    const featRes = await tFetch(`https://api.spotify.com/v1/audio-features/${trackId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const f = await featRes.json();
    if (typeof f.key !== "number" || f.key < 0) return null;

    return {
      bpm: String(Math.round(f.tempo)),
      key: f.mode === 1 ? NOTES[f.key] : `${NOTES[f.key]}m`,
      camelot: f.mode === 1 ? CAMELOT_MAJOR[f.key] : CAMELOT_MINOR[f.key],
      energy: f.energy,
      danceability: f.danceability,
    };
  } catch {
    return null;
  }
}
