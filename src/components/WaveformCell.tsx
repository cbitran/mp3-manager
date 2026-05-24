import { useEffect, useRef, useState } from "react";
import { generateRGBWaveform, type WaveBar } from "../lib/waveformAnalyzer";

const cache = new Map<string, WaveBar[]>();
const BARS = 52;
const H = 18;
const W = BARS * 2.2;

// Seed determinístico para fallback visual variado por faixa
function strHash(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h) ^ s.charCodeAt(i);
  return Math.abs(h);
}

function makeFallback(path: string): WaveBar[] {
  const seed = strHash(path);
  return Array.from({ length: BARS }, (_, i) => {
    const t = i / BARS;
    const amp = 0.3 + 0.4 * Math.abs(Math.sin(seed * 0.0007 + t * 6.28))
              + 0.1 * Math.abs(Math.sin(seed * 0.0013 + t * 12.1));
    return {
      amp: Math.min(1, amp),
      bass: 0.5 + 0.5 * Math.abs(Math.sin(seed * 0.0011 + t * 3.14)),
      treble: 0.5 + 0.5 * Math.abs(Math.sin(seed * 0.0017 + t * 9.42)),
    };
  });
}

// Interpola cor entre três âncoras: coral (bass) → âmbar (mid) → verde (treble)
function barColor(bass: number, treble: number): string {
  // bass=1,treble=0 → #D95340 (coral)
  // bass≈treble      → #F5A94A (âmbar)
  // bass=0,treble=1 → #7AB275 (verde)
  const total = bass + treble + 1e-9;
  const t = treble / total; // 0 = bass, 1 = treble

  let r: number, g: number, b: number;
  if (t < 0.5) {
    const k = t * 2; // 0→1 de coral para âmbar
    r = Math.round(217 + k * (245 - 217)); // 217→245
    g = Math.round(83  + k * (169 - 83));  // 83→169
    b = Math.round(64  + k * (74  - 64));  // 64→74
  } else {
    const k = (t - 0.5) * 2; // 0→1 de âmbar para verde
    r = Math.round(245 + k * (122 - 245)); // 245→122
    g = Math.round(169 + k * (178 - 169)); // 169→178
    b = Math.round(74  + k * (117 - 74));  // 74→117
  }
  return `rgb(${r},${g},${b})`;
}

export default function WaveformCell({ path }: { path: string }) {
  const [bars, setBars] = useState<WaveBar[] | null>(cache.get(path) ?? null);
  const cancelRef = useRef(false);

  useEffect(() => {
    if (bars !== null) return;
    cancelRef.current = false;

    generateRGBWaveform(path, BARS).then((data) => {
      if (cancelRef.current) return;
      const result = data ?? makeFallback(path);
      cache.set(path, result);
      setBars(result);
    }).catch(() => {
      if (cancelRef.current) return;
      const fallback = makeFallback(path);
      cache.set(path, fallback);
      setBars(fallback);
    });

    return () => { cancelRef.current = true; };
  }, [path]);

  if (!bars) {
    // Skeleton enquanto carrega
    return (
      <div style={{ width: "100%", height: H, overflow: "hidden" }}>
        <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
          {Array.from({ length: BARS }).map((_, i) => {
            const amp = 0.15 + 0.1 * Math.abs(Math.sin(i * 0.5));
            const barH = Math.max(1, amp * H);
            return (
              <rect key={i} x={i * 2.2} y={(H - barH) / 2}
                width={1.4} height={barH} fill="#D95340" opacity={0.08} rx={0.5} />
            );
          })}
        </svg>
      </div>
    );
  }

  return (
    <div style={{ width: "100%", height: H, overflow: "hidden" }}>
      <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        {bars.map((bar, i) => {
          const barH = Math.max(1.5, bar.amp * H);
          const y = (H - barH) / 2;
          const color = barColor(bar.bass, bar.treble);
          const opacity = 0.25 + bar.amp * 0.75;
          return (
            <rect
              key={i}
              x={i * 2.2}
              y={y}
              width={1.4}
              height={barH}
              fill={color}
              opacity={opacity}
              rx={0.5}
            />
          );
        })}
      </svg>
    </div>
  );
}
