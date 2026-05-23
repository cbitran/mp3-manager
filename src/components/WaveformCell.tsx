import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

const cache = new Map<string, number[]>();
const BARS = 52;

// Gera seed numérico a partir de string para fallback variado
function strHash(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h) ^ s.charCodeAt(i);
  return Math.abs(h);
}

function makeFallback(path: string): number[] {
  const seed = strHash(path);
  return Array.from({ length: BARS }, (_, i) => {
    const t = i / BARS;
    const a = 0.3 + 0.4 * Math.abs(Math.sin((seed % 100) * 0.07 + t * 6.28));
    const b = 0.1 + 0.3 * Math.abs(Math.sin((seed % 77) * 0.13 + t * 12.1));
    const c = 0.05 * Math.abs(Math.sin(t * 31 + seed % 17));
    return Math.min(1, a + b + c);
  });
}

export default function WaveformCell({ path }: { path: string }) {
  const [bars, setBars] = useState<number[] | null>(cache.get(path) ?? null);

  useEffect(() => {
    if (bars !== null) return;
    let cancelled = false;
    invoke<number[]>("generate_waveform", { path, bars: BARS })
      .then((data) => {
        if (cancelled) return;
        cache.set(path, data);
        setBars(data);
      })
      .catch(() => {
        if (cancelled) return;
        const fallback = makeFallback(path);
        cache.set(path, fallback);
        setBars(fallback);
      });
    return () => { cancelled = true; };
  }, [path]);

  const H = 18;
  const W = BARS * 2.2;

  if (!bars) {
    return (
      <div style={{ width: "100%", height: H, overflow: "hidden" }}>
        <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
          {Array.from({ length: BARS }).map((_, i) => {
            const amp = 0.2 + 0.15 * Math.abs(Math.sin(i * 0.5));
            const barH = Math.max(1, amp * H);
            return (
              <rect key={i} x={i * 2.2} y={(H - barH) / 2}
                width={1.4} height={barH} fill="#D95340" opacity={0.1} rx={0.5} />
            );
          })}
        </svg>
      </div>
    );
  }

  return (
    <div style={{ width: "100%", height: H, overflow: "hidden" }}>
      <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        {bars.map((amp, i) => {
          const barH = Math.max(1.5, amp * H);
          const y = (H - barH) / 2;
          return (
            <rect
              key={i}
              x={i * 2.2}
              y={y}
              width={1.4}
              height={barH}
              fill="#D95340"
              opacity={0.2 + amp * 0.8}
              rx={0.5}
            />
          );
        })}
      </svg>
    </div>
  );
}
