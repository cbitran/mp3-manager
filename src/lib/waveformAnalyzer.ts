import { invoke } from "@tauri-apps/api/core";
import { queuedInvoke } from "./ipcQueue";

export interface WaveBar {
  amp: number;    // amplitude normalizada [0, 1]
  bass: number;   // energia de baixas freq [0, 1]
  treble: number; // energia de altas freq [0, 1]
}

export function generateRGBWaveform(path: string, bars: number): Promise<WaveBar[] | null> {
  return queuedInvoke<WaveBar[] | null>(async () => {
    try {
      const flat = await invoke<number[]>("generate_waveform_rgb", { path, bars });
      if (!flat || flat.length !== bars * 3) return null;
      return Array.from({ length: bars }, (_, i) => ({
        amp:    flat[i * 3],
        bass:   flat[i * 3 + 1],
        treble: flat[i * 3 + 2],
      }));
    } catch {
      return null;
    }
  });
}
