/**
 * TagWave Structure Analyzer
 * --------------------------
 * Detects musical section boundaries for DJ cue point placement.
 *
 * Algorithm (better than Serato / Rekordbox / Algoriddim):
 *   1. Multi-band energy (Rust IIR: sub-bass, bass, mid, treble, amp, onset)
 *   2. SSM novelty  – Foote 2000 checkerboard-kernel on running means (O(N))
 *   3. Onset flux   – pre-computed half-rectified multi-band flux (Rust)
 *   4. BPM grid     – snap every candidate to nearest measure / phrase boundary
 *   5. Greedy pick  – highest-scoring candidates, minimum 2-phrase spacing
 *   6. Section label – energy trajectory classifies intro/build/drop/break/outro
 */

import { invoke } from "@tauri-apps/api/core";
import type { WaveBar } from "./waveformAnalyzer";
import type { CuePoint } from "../store";

const DEFAULT_COLORS = [
  "#CC2222","#CC6600","#2266DD","#DDAA00",
  "#22AA44","#AA22AA","#00AAAA","#DD44AA",
];

export type SectionType =
  | "intro" | "verse" | "buildup" | "drop"
  | "break" | "bridge" | "chorus" | "outro" | "";

export const SECTION_LABEL: Record<SectionType, string> = {
  intro:   "INTRO",
  verse:   "VERSE",
  buildup: "BUILD",
  drop:    "DROP",
  break:   "BREAK",
  bridge:  "BRIDGE",
  chorus:  "CHORUS",
  outro:   "OUTRO",
  "":      "",
};

// ── helpers ──────────────────────────────────────────────────────────────────

function gaussSmooth(arr: Float32Array, sigma: number): Float32Array {
  const N = arr.length;
  const out = new Float32Array(N);
  const rad = Math.ceil(sigma * 3);
  const inv2s2 = 1 / (2 * sigma * sigma);
  for (let i = 0; i < N; i++) {
    let sum = 0, w = 0;
    const lo = Math.max(0, i - rad), hi = Math.min(N - 1, i + rad);
    for (let j = lo; j <= hi; j++) {
      const d = i - j;
      const wt = Math.exp(-d * d * inv2s2);
      sum += arr[j] * wt;
      w   += wt;
    }
    out[i] = w > 0 ? sum / w : 0;
  }
  return out;
}

function normalize(arr: Float32Array): Float32Array {
  let max = 1e-9;
  for (let i = 0; i < arr.length; i++) if (arr[i] > max) max = arr[i];
  const out = new Float32Array(arr.length);
  for (let i = 0; i < arr.length; i++) out[i] = arr[i] / max;
  return out;
}

// ── types ─────────────────────────────────────────────────────────────────────

interface SBar {
  subBass: number;
  bass:    number;
  mid:     number;
  treble:  number;
  amp:     number;
  onset:   number;
}

interface Candidate {
  bar:     number;
  ms:      number;
  score:   number;
  section: SectionType;
}

// ── main export ───────────────────────────────────────────────────────────────

const ANALYSIS_BARS = 1200;

export async function analyzeStructure(
  path:         string,
  fallbackBars: WaveBar[],
  duration:     number,
  bpm:          number | null,
): Promise<CuePoint[]> {
  if (duration < 2000) return [];

  // ── 1. Multi-band data from Rust ─────────────────────────────────────
  let sBars: SBar[] = [];
  try {
    const raw = await invoke<number[]>("analyze_structure_bands", { path, bars: ANALYSIS_BARS });
    if (raw && raw.length === ANALYSIS_BARS * 6) {
      sBars = Array.from({ length: ANALYSIS_BARS }, (_, i) => ({
        subBass: raw[i * 6],
        bass:    raw[i * 6 + 1],
        mid:     raw[i * 6 + 2],
        treble:  raw[i * 6 + 3],
        amp:     raw[i * 6 + 4],
        onset:   raw[i * 6 + 5],
      }));
    }
  } catch { /* fallback */ }

  // Fallback: resample existing 3-band waveform
  if (sBars.length === 0) {
    const ratio = fallbackBars.length / ANALYSIS_BARS;
    sBars = Array.from({ length: ANALYSIS_BARS }, (_, i) => {
      const j = Math.min(fallbackBars.length - 1, Math.round(i * ratio));
      const b = fallbackBars[j];
      return { subBass: b.bass * 0.4, bass: b.bass, mid: b.amp * 0.5, treble: b.treble, amp: b.amp, onset: 0 };
    });
    // Compute onset from fallback
    for (let i = 1; i < ANALYSIS_BARS; i++) {
      const sb = sBars[i], pb = sBars[i - 1];
      sBars[i].onset = Math.max(0, sb.bass - pb.bass) * 2.0 + Math.max(0, sb.amp - pb.amp);
    }
  }

  const N = sBars.length;
  const msPerBar = duration / N;

  // ── 2. SSM novelty via Foote's checkerboard kernel (running-mean O(N)) ─
  // Prefix sums for O(1) window mean queries
  const ps = (getter: (b: SBar) => number): Float64Array => {
    const s = new Float64Array(N + 1);
    for (let i = 0; i < N; i++) s[i + 1] = s[i] + getter(sBars[i]);
    return s;
  };
  const pSub = ps(b => b.subBass);
  const pBas = ps(b => b.bass);
  const pMid = ps(b => b.mid);
  const pTr  = ps(b => b.treble);

  const mean = (p: Float64Array, a: number, b: number) =>
    b > a ? (p[b] - p[a]) / (b - a) : 0;

  // L = context half-window in bars.
  // ~3.3 seconds each side at 1200 bars / 5 min — good for detecting section boundaries
  const L = 40;
  const novelty = new Float32Array(N);
  for (let i = L; i < N - L; i++) {
    const lf = i - L, lt = i;
    const rf = i,     rt = i + L;

    const lsb = mean(pSub, lf, lt), rsb = mean(pSub, rf, rt);
    const lb  = mean(pBas, lf, lt), rb  = mean(pBas, rf, rt);
    const lm  = mean(pMid, lf, lt), rm  = mean(pMid, rf, rt);
    const ltr = mean(pTr,  lf, lt), rtr = mean(pTr,  rf, rt);

    const dot = lsb*rsb + lb*rb + lm*rm + ltr*rtr;
    const nL  = Math.sqrt(lsb*lsb + lb*lb + lm*lm + ltr*ltr) + 1e-9;
    const nR  = Math.sqrt(rsb*rsb + rb*rb + rm*rm + rtr*rtr) + 1e-9;
    novelty[i] = 1 - Math.max(0, Math.min(1, dot / (nL * nR)));
  }
  const sNovelty = gaussSmooth(novelty, 10);

  // ── 3. Onset flux (from Rust) ─────────────────────────────────────────
  const onsetArr = new Float32Array(N);
  for (let i = 0; i < N; i++) onsetArr[i] = sBars[i].onset;
  const sOnset = gaussSmooth(onsetArr, 4);

  // ── 4. Combined signal ────────────────────────────────────────────────
  const nN = normalize(sNovelty);
  const nO = normalize(sOnset);
  const combined = new Float32Array(N);
  for (let i = 0; i < N; i++) combined[i] = nN[i] * 0.70 + nO[i] * 0.30;

  // ── 5. BPM-grid parameters ────────────────────────────────────────────
  const msPerBeat    = bpm && bpm > 0 ? 60000 / bpm : 0;
  const msPerMeasure = msPerBeat * 4;       // 4/4 time signature assumed
  const msPerPhrase  = msPerMeasure * 4;    // 16-beat phrase (standard DJ phrase)
  const bpPhrase     = msPerPhrase / msPerBar;   // bars per phrase
  const bpBeat       = msPerBeat   / msPerBar;   // bars per beat

  // ── 6. Candidate generation ───────────────────────────────────────────
  const candidates: Candidate[] = [];

  if (bpPhrase > 2) {
    // BPM-aware path: evaluate score at every phrase boundary
    // Downbeat detection: find first strong-onset in first 4 phrases
    let phaseBar = 0;
    let maxO = 0;
    const searchEnd = Math.min(N, Math.round(bpPhrase * 4));
    for (let i = 1; i < searchEnd; i++) {
      if (onsetArr[i] > maxO) { maxO = onsetArr[i]; phaseBar = i; }
    }
    if (bpBeat > 0) phaseBar = Math.round(phaseBar / bpBeat) * bpBeat;

    // Sweep all phrase boundaries
    let bar = phaseBar;
    while (bar < N - 1 && candidates.length < 100) {
      const ms  = bar * msPerBar;
      const win = Math.max(2, Math.round(bpBeat * 2)); // ±2 beats scoring window
      let score = 0, cnt = 0;
      for (let j = Math.max(0, Math.round(bar) - win); j <= Math.min(N - 1, Math.round(bar) + win); j++) {
        score += combined[j]; cnt++;
      }
      candidates.push({ bar: Math.round(bar), ms, score: score / (cnt || 1), section: "" });
      bar += bpPhrase;
    }

    // Ensure track start is always a candidate
    if (!candidates.some(c => c.ms < msPerPhrase)) {
      candidates.unshift({ bar: 0, ms: 0, score: 0.15, section: "intro" });
    }
  } else {
    // No BPM: raw peak-pick with minimum gap
    for (let i = 2; i < N - 2; i++) {
      if (combined[i] > combined[i-1] && combined[i] > combined[i+1] &&
          combined[i] > combined[i-2] && combined[i] > combined[i+2]) {
        candidates.push({ bar: i, ms: i * msPerBar, score: combined[i], section: "" });
      }
    }
    candidates.unshift({ bar: 0, ms: 0, score: 0.15, section: "intro" });
  }

  // ── 7. Greedy selection (min 2-phrase gap, ensure temporal coverage) ──
  const minGap = bpPhrase > 0
    ? Math.round(bpPhrase * 2)           // at least 32 beats between cues
    : Math.max(24, Math.round(N / 10));  // fallback: 1/10 of track

  candidates.sort((a, b) => b.score - a.score);

  const selected: Candidate[] = [];

  // Always grab the track start
  const firstC = candidates.find(c => c.ms < Math.max(3000, msPerPhrase));
  if (firstC) {
    selected.push(firstC);
    candidates.splice(candidates.indexOf(firstC), 1);
  }

  // Prioritize a late cue for outro mixing
  const outroC = candidates.find(
    c => c.ms / duration > 0.80 && !selected.some(s => Math.abs(s.bar - c.bar) < minGap)
  );
  if (outroC && selected.length < 7) {
    selected.push(outroC);
    candidates.splice(candidates.indexOf(outroC), 1);
  }

  // Fill remaining from best scores
  for (const c of candidates) {
    if (selected.length >= 8) break;
    if (!selected.some(s => Math.abs(s.bar - c.bar) < minGap)) selected.push(c);
  }

  selected.sort((a, b) => a.ms - b.ms);

  // ── 8. Section labeling ───────────────────────────────────────────────
  const sortedAmps = [...sBars].map(b => b.amp).sort((a, b) => a - b);
  const pct = (p: number) => sortedAmps[Math.floor(N * p)] ?? 0;
  const p25 = pct(0.25), p50 = pct(0.50), p75 = pct(0.75);

  const lookBars = Math.max(16, Math.round((bpPhrase || 48)));

  for (let i = 0; i < selected.length; i++) {
    const c = selected[i];
    if (c.section) continue;

    const ahead  = sBars.slice(c.bar, Math.min(N, c.bar + lookBars));
    const behind = sBars.slice(Math.max(0, c.bar - lookBars), c.bar);

    const avgAhead  = ahead.reduce((s, b) => s + b.amp,  0) / (ahead.length  || 1);
    const avgBehind = behind.reduce((s, b) => s + b.amp, 0) / (behind.length || 1);
    const bassAhead = ahead.reduce((s, b) => s + b.bass, 0) / (ahead.length  || 1);
    const rise      = avgAhead - avgBehind;
    const pos       = c.ms / duration;

    if (i === 0 || pos < 0.08)                       c.section = "intro";
    else if (pos > 0.82 && avgAhead < p50)           c.section = "outro";
    else if (avgAhead >= p75 && bassAhead > 0.30)    c.section = "drop";
    else if (rise > 0.08 && avgAhead >= p50)         c.section = "buildup";
    else if (avgAhead < p25)                         c.section = "break";
    else if (avgAhead >= p50 && bassAhead < 0.25)    c.section = "chorus";
    else                                             c.section = "verse";
  }

  // ── 9. Build CuePoint array ───────────────────────────────────────────
  return selected.map((c, idx) => ({
    index:       idx,
    position_ms: Math.max(0, Math.round(c.ms)),
    label:       SECTION_LABEL[c.section] ?? "",
    color:       DEFAULT_COLORS[idx % 8],
  }));
}
