import type { WaveBar } from "./waveformAnalyzer";
import { generateRGBWaveform } from "./waveformAnalyzer";

const BARS = 2400;
const cache = new Map<string, WaveBar[]>();
const pending = new Map<string, Promise<WaveBar[] | null>>();

export { BARS as WAVEFORM_BARS };

export function getCachedWaveform(path: string): WaveBar[] | null {
  return cache.get(path) ?? null;
}

export function setCachedWaveform(path: string, bars: WaveBar[]): void {
  cache.set(path, bars);
}

export async function loadWaveform(path: string): Promise<WaveBar[] | null> {
  const hit = cache.get(path);
  if (hit) return hit;

  // Deduplicate concurrent requests for the same path
  const inFlight = pending.get(path);
  if (inFlight) return inFlight;

  const promise = generateRGBWaveform(path, BARS)
    .then((bars) => {
      if (bars) cache.set(path, bars);
      pending.delete(path);
      return bars;
    })
    .catch(() => { pending.delete(path); return null; });

  pending.set(path, promise);
  return promise;
}

export function preload(path: string): void {
  if (!cache.has(path) && !pending.has(path)) {
    loadWaveform(path).catch(() => {});
  }
}
