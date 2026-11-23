// Tempo, beat and meter for 多音 dictation of a real performance.
//
// A played recording rarely holds one tempo, so a single BPM turns into drift of
// several beats by the end (rubato, ritardando). This module follows the pulse
// instead: an onset-strength curve from the note events, its autocorrelation for
// the main period (with a gentle prior toward a walking pace, so a run of
// sixteenths is not read as the beat), dynamic-programming beat tracking
// (Ellis 2007, "Beat Tracking by Dynamic Programming"), and bass/harmony accents
// for the bar length and where bar 1 starts. Everything is local and pure.
import type { PolyNoteEvent } from "./basic-pitch/notes.ts";

const RATE = 100; // envelope frames per second
const MIN_PERIOD = 60 / 220;
const MAX_PERIOD = 60 / 30;
/** Center of the tempo prior, in beats per minute, and its width in octaves. */
const PRIOR_BPM = 72;
const PRIOR_OCTAVES = 0.9;

export type Meter = { beats: number; beatUnit: 4 | 8 };

export type PulseGrid = {
  /** Seconds of each tracked beat, ascending, covering the notes. */
  beatTimes: number[];
  /** Quarter notes per tracked beat (1, or 0.5 when the beat is an eighth). */
  beatQuarters: number;
  /** Tracked beat index that is the first downbeat (bar 1, after any pickup). */
  downbeat: number;
  meter: Meter;
  /** Steady tempo for playback, quarter notes per minute. */
  bpm: number;
  /** 0–1: how clearly the meter stood out (for the UI to suggest checking). */
  meterConfidence: number;
};

type Attack = { time: number; weight: number; bass: number; pcs: number[] };

function attacksOf(notes: readonly PolyNoteEvent[]): Attack[] {
  const sorted = [...notes].filter((n) => Number.isFinite(n.start) && n.dur > 0).sort((a, b) => a.start - b.start);
  const out: Attack[] = [];
  for (const n of sorted) {
    const last = out.at(-1);
    const w = Math.max(0.05, n.amplitude) * (n.midi < 55 ? 1.6 : 1);
    if (last && n.start - last.time < 0.05) {
      last.weight += w;
      last.bass = Math.min(last.bass, n.midi);
      last.pcs.push(n.midi % 12);
      continue;
    }
    out.push({ time: n.start, weight: w, bass: n.midi, pcs: [n.midi % 12] });
  }
  return out;
}

function envelope(attacks: readonly Attack[], seconds: number, sigma: number): Float32Array {
  const n = Math.max(1, Math.ceil(seconds * RATE) + 1);
  const env = new Float32Array(n);
  const radius = Math.ceil(sigma * 3 * RATE);
  for (const a of attacks) {
    const c = a.time * RATE;
    const lo = Math.max(0, Math.floor(c - radius));
    const hi = Math.min(n - 1, Math.ceil(c + radius));
    for (let i = lo; i <= hi; i++) {
      const d = (i - c) / (sigma * RATE);
      env[i] += a.weight * Math.exp(-0.5 * d * d);
    }
  }
  return env;
}

function autocorrelation(env: Float32Array, maxLag: number): Float32Array {
  const n = env.length;
  let mean = 0;
  for (const v of env) mean += v;
  mean /= n || 1;
  const x = env.map((v) => v - mean);
  const out = new Float32Array(maxLag + 1);
  for (let lag = 0; lag <= maxLag && lag < n; lag++) {
    let s = 0;
    for (let i = lag; i < n; i++) s += x[i] * x[i - lag];
    out[lag] = s / (n - lag);
  }
  return out;
}

function lagValue(ac: Float32Array, lag: number): number {
  const i = Math.floor(lag);
  if (i + 1 >= ac.length) return ac[Math.min(i, ac.length - 1)] ?? 0;
  const f = lag - i;
  return ac[i] * (1 - f) + ac[i + 1] * f;
}

/** Main beat period in seconds, or null when there are too few attacks to say. */
export function estimateBeatPeriod(notes: readonly PolyNoteEvent[]): number | null {
  const attacks = attacksOf(notes);
  if (attacks.length < 6) return null;
  const seconds = attacks.at(-1)!.time + 1;
  const env = envelope(attacks, seconds, 0.035);
  const maxLag = Math.ceil(MAX_PERIOD * RATE * 4);
  const ac = autocorrelation(env, maxLag);
  if (!(ac[0] > 0)) return null;
  let best = 0;
  let bestScore = -Infinity;
  for (let lag = Math.floor(MIN_PERIOD * RATE); lag <= MAX_PERIOD * RATE; lag += 0.5) {
    // Comb: a real beat repeats at 2, 3 and 4 periods too.
    let s = 0;
    for (let k = 1; k <= 4; k++) s += Math.max(0, lagValue(ac, lag * k)) / k;
    const bpm = (60 * RATE) / lag;
    const octaves = Math.log2(bpm / PRIOR_BPM) / PRIOR_OCTAVES;
    const score = s * Math.exp(-0.5 * octaves * octaves);
    if (score > bestScore) {
      bestScore = score;
      best = lag;
    }
  }
  return best > 0 ? best / RATE : null;
}

/**
 * Shortest strong repeating gap (the running sixteenths or eighths), in seconds,
 * or null when there is none: the first autocorrelation peak under half a second
 * that is at least half as strong as any peak up to 1.5 s.
 */
export function estimateTatum(notes: readonly PolyNoteEvent[]): number | null {
  const attacks = attacksOf(notes);
  if (attacks.length < 12) return null;
  const env = envelope(attacks, attacks.at(-1)!.time + 1, 0.03);
  const ac = autocorrelation(env, Math.ceil(1.5 * RATE) + 1);
  const peaks: { lag: number; v: number }[] = [];
  for (let lag = Math.floor(0.1 * RATE); lag < ac.length - 1; lag++) {
    if (ac[lag] > ac[lag - 1] && ac[lag] >= ac[lag + 1] && ac[lag] > 0) peaks.push({ lag, v: ac[lag] });
  }
  if (!peaks.length) return null;
  const strongest = Math.max(...peaks.map((p) => p.v));
  const first = peaks.find((p) => p.lag <= 0.5 * RATE && p.v >= strongest * 0.5);
  if (!first) return null;
  // Parabolic refinement of the peak lag.
  const a = ac[first.lag - 1];
  const b = ac[first.lag];
  const c = ac[first.lag + 1];
  const shift = a - 2 * b + c !== 0 ? (0.5 * (a - c)) / (a - 2 * b + c) : 0;
  return (first.lag + Math.max(-0.5, Math.min(0.5, shift))) / RATE;
}

/** Cosine distance between pitch-class profiles of consecutive spans. */
function chromaChanges(notes: readonly PolyNoteEvent[], bounds: readonly number[]): number[] {
  const chroma = bounds.slice(0, -1).map(() => new Float32Array(12));
  for (const n of notes) {
    for (let i = 0; i + 1 < bounds.length; i++) {
      const lo = Math.max(bounds[i], n.start);
      const hi = Math.min(bounds[i + 1], n.start + n.dur);
      if (hi > lo) chroma[i][n.midi % 12] += (hi - lo) * Math.max(0.05, n.amplitude) * (n.midi < 55 ? 1.5 : 1);
    }
  }
  const out = [0];
  for (let i = 1; i < chroma.length; i++) {
    const p = chroma[i - 1];
    const q = chroma[i];
    let dot = 0;
    let np = 0;
    let nq = 0;
    for (let k = 0; k < 12; k++) {
      dot += p[k] * q[k];
      np += p[k] * p[k];
      nq += q[k] * q[k];
    }
    out.push(np > 0 && nq > 0 ? 1 - dot / Math.sqrt(np * nq) : 0);
  }
  return out;
}

/** Ellis-style dynamic-programming beat tracker on the onset envelope. */
export function trackBeats(notes: readonly PolyNoteEvent[], period: number): number[] {
  const attacks = attacksOf(notes);
  const end = Math.max(...notes.map((n) => n.start + n.dur), attacks.at(-1)?.time ?? 0);
  const first = attacks[0]?.time ?? 0;
  const env = envelope(attacks, end + period, 0.02);
  let peak = 0;
  for (const v of env) peak = Math.max(peak, v);
  const o = env.map((v) => (peak > 0 ? v / peak : 0));
  const P = period * RATE;
  const n = o.length;
  const score = new Float32Array(n);
  const back = new Int32Array(n).fill(-1);
  const tightness = 6;
  for (let t = 0; t < n; t++) {
    let best = 0;
    let arg = -1;
    const lo = Math.max(0, Math.round(t - 2 * P));
    const hi = Math.round(t - P / 2);
    for (let tau = lo; tau <= hi; tau++) {
      const r = Math.log((t - tau) / P);
      const v = score[tau] - tightness * r * r;
      if (arg < 0 || v > best) {
        best = v;
        arg = tau;
      }
    }
    score[t] = o[t] + (arg >= 0 ? Math.max(0, best) : 0);
    back[t] = arg >= 0 && best > 0 ? arg : -1;
  }
  // Best end point within the last period.
  let t = n - 1;
  let bestEnd = -Infinity;
  for (let i = Math.max(0, Math.floor(n - 1 - P)); i < n; i++) {
    if (score[i] > bestEnd) {
      bestEnd = score[i];
      t = i;
    }
  }
  const beats: number[] = [];
  while (t >= 0) {
    beats.push(t / RATE);
    t = back[t];
  }
  beats.reverse();
  // Extend with the local period so every note (and the first one) is covered.
  while (beats.length >= 2 && beats[0] > first + 0.06) {
    const step = Math.max(MIN_PERIOD, beats[1] - beats[0]);
    beats.unshift(beats[0] - step);
  }
  if (!beats.length) beats.push(first);
  while (beats.at(-1)! < end) {
    const step = beats.length >= 2 ? beats.at(-1)! - beats.at(-2)! : period;
    beats.push(beats.at(-1)! + Math.max(MIN_PERIOD, step));
  }
  return beats;
}

/** Beat position (fractional beat index) of a time, linear between tracked beats. */
export function beatPosition(beatTimes: readonly number[], time: number): number {
  const n = beatTimes.length;
  if (n === 0) return 0;
  if (n === 1) return time - beatTimes[0];
  if (time <= beatTimes[0]) return (time - beatTimes[0]) / (beatTimes[1] - beatTimes[0]);
  if (time >= beatTimes[n - 1]) return n - 1 + (time - beatTimes[n - 1]) / (beatTimes[n - 1] - beatTimes[n - 2]);
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (beatTimes[mid] <= time) lo = mid;
    else hi = mid;
  }
  return lo + (time - beatTimes[lo]) / (beatTimes[hi] - beatTimes[lo]);
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
}

type BeatAccent = { bass: number; change: number; weight: number };

/** Per tracked beat: a low note starting near it, how much the harmony changed there, attack weight. */
function beatAccents(notes: readonly PolyNoteEvent[], beatTimes: readonly number[]): BeatAccent[] {
  const attacks = attacksOf(notes);
  const accents: BeatAccent[] = beatTimes.map(() => ({ bass: 0, change: 0, weight: 0 }));
  const lows = attacks.map((a) => a.bass).sort((a, b) => a - b);
  const lowLine = lows.length ? lows[Math.floor(lows.length * 0.3)] : 60;
  const chroma = beatTimes.map(() => new Float32Array(12));
  for (const n of notes) {
    const from = Math.floor(beatPosition(beatTimes, n.start) + 0.25);
    const to = Math.ceil(beatPosition(beatTimes, n.start + n.dur) - 0.25);
    for (let b = Math.max(0, from); b < Math.min(beatTimes.length, Math.max(from + 1, to)); b++) {
      chroma[b][n.midi % 12] += n.amplitude;
    }
  }
  for (const a of attacks) {
    const pos = beatPosition(beatTimes, a.time);
    const b = Math.round(pos);
    if (b < 0 || b >= beatTimes.length || Math.abs(pos - b) > 0.25) continue;
    accents[b].weight += a.weight;
    if (a.bass <= lowLine + 2) accents[b].bass += 1 + (lowLine + 2 - a.bass) / 12;
  }
  for (let b = 1; b < beatTimes.length; b++) {
    const p = chroma[b - 1];
    const q = chroma[b];
    let dot = 0;
    let np = 0;
    let nq = 0;
    for (let i = 0; i < 12; i++) {
      dot += p[i] * q[i];
      np += p[i] * p[i];
      nq += q[i] * q[i];
    }
    accents[b].change = np > 0 && nq > 0 ? 1 - dot / Math.sqrt(np * nq) : 0;
  }
  return accents;
}

function meterScore(accents: readonly BeatAccent[], group: number): { score: number; phase: number } {
  let best = { score: -Infinity, phase: 0 };
  const n = accents.length;
  if (n < group * 2) return best;
  const norm = (pick: (a: BeatAccent) => number) => {
    const values = accents.map(pick);
    const m = values.reduce((s, v) => s + v, 0) / n;
    const sd = Math.sqrt(values.reduce((s, v) => s + (v - m) ** 2, 0) / n) || 1;
    return values.map((v) => (v - m) / sd);
  };
  const bass = norm((a) => a.bass);
  const change = norm((a) => a.change);
  const weight = norm((a) => a.weight);
  for (let phase = 0; phase < group; phase++) {
    let on = 0;
    let onN = 0;
    let off = 0;
    let offN = 0;
    for (let b = 0; b < n; b++) {
      const v = bass[b] * 1.0 + change[b] * 1.2 + weight[b] * 0.4;
      if ((b - phase) % group === 0) {
        on += v;
        onN++;
      } else {
        off += v;
        offN++;
      }
    }
    const score = on / (onN || 1) - off / (offN || 1);
    if (score > best.score) best = { score, phase };
  }
  return best;
}

/**
 * Bar length and where bar 1 starts, from bass notes and harmony changes on the
 * tracked beats. A fast tracked beat (an eighth) in threes becomes 3/8; a fast
 * beat in twos is folded into quarter beats.
 */
export function analyzePulse(notes: readonly PolyNoteEvent[], fallbackBpm = 92): PulseGrid {
  const period = estimateBeatPeriod(notes);
  const first = notes.length ? Math.min(...notes.map((n) => n.start)) : 0;
  const last = notes.length ? Math.max(...notes.map((n) => n.start + n.dur)) : 1;
  if (!period) {
    // Too few attacks (a few held chords): one beat per attack gap, clamped to a walking pace.
    const starts = [...new Set(attacksOf(notes).map((a) => Math.round(a.time * 100) / 100))].sort((a, b) => a - b);
    const gaps = starts.slice(1).map((s, i) => s - starts[i]).filter((g) => g > 0.1);
    let p = gaps.length ? median(gaps) : 60 / fallbackBpm;
    while (60 / p < 45) p /= 2;
    while (60 / p > 130) p *= 2;
    const beatTimes: number[] = [];
    for (let t = first; t < last + p; t += p) beatTimes.push(t);
    return { beatTimes, beatQuarters: 1, downbeat: 0, meter: { beats: 4, beatUnit: 4 }, bpm: Math.round(60 / p), meterConfidence: 0 };
  }
  // Track a fine beat: two tatums when the tatum is short (sixteenths → eighths),
  // otherwise the main period. The bar is read on it, then folded for notation.
  const tatum = estimateTatum(notes);
  let fine = period;
  if (tatum) {
    const k = tatum < 0.3 ? 2 : 1;
    fine = tatum * k;
    // A long main period that is not a multiple of the fine beat keeps the main period.
    if (fine < 0.3 && period >= 0.3) fine = period;
  }
  let beatTimes = trackBeats(notes, fine);
  let beatQuarters = 1;
  let accents = beatAccents(notes, beatTimes);
  const s2 = meterScore(accents, 2);
  const s3 = meterScore(accents, 3);
  const s4 = meterScore(accents, 4);
  const fast = fine < 0.45;
  let meter: Meter;
  let downbeat: number;
  let confidence: number;
  if (s3.score > Math.max(s4.score, s2.score) * 1.08) {
    meter = fast ? { beats: 3, beatUnit: 8 } : { beats: 3, beatUnit: 4 };
    downbeat = s3.phase;
    beatQuarters = fast ? 0.5 : 1;
    confidence = Math.min(1, (s3.score - Math.max(s4.score, s2.score)) / Math.max(0.2, s3.score));
  } else {
    if (fast) {
      // Fold pairs of eighth beats into quarters on the stronger phase, then re-read the bar.
      const phase = s2.phase;
      beatTimes = beatTimes.filter((_, i) => i >= phase && (i - phase) % 2 === 0);
      if (beatTimes.length >= 2 && beatTimes[0] > first + 0.05) beatTimes.unshift(beatTimes[0] - (beatTimes[1] - beatTimes[0]));
      accents = beatAccents(notes, beatTimes);
    }
    const q3 = meterScore(accents, 3);
    const q4 = meterScore(accents, 4);
    if (q3.score > q4.score * 1.15) {
      meter = { beats: 3, beatUnit: 4 };
      downbeat = q3.phase;
      confidence = Math.min(1, (q3.score - q4.score) / Math.max(0.2, q3.score));
    } else {
      meter = { beats: 4, beatUnit: 4 };
      downbeat = q4.phase;
      confidence = Math.min(1, Math.abs(q4.score - q3.score) / Math.max(0.2, q4.score));
    }
    // Harmony that changes only every other bar means the bar (and beat) is twice as long:
    // a figure repeated per half bar, as in the C-major prelude.
    const beatSec = median(beatTimes.slice(1).map((t, i) => t - beatTimes[i]));
    if (meter.beats === 4 && beatSec > 0 && 60 / beatSec >= 88) {
      const bars: number[] = [];
      for (let i = downbeat; i < beatTimes.length; i += 4) bars.push(beatTimes[i]);
      const change = chromaChanges(notes, bars);
      const even = change.filter((_, i) => i > 0 && i % 2 === 0);
      const odd = change.filter((_, i) => i % 2 === 1);
      const mean = (v: number[]) => (v.length ? v.reduce((s, x) => s + x, 0) / v.length : 0);
      const [hi, lo, phase] = mean(even) >= mean(odd) ? [mean(even), mean(odd), 0] : [mean(odd), mean(even), 1];
      if (bars.length >= 6 && hi > 0.2 && lo < hi * 0.5) {
        // New downbeat on the bar where the harmony moves (bar index with the larger change).
        const startBar = phase === 0 ? 0 : 1;
        const halved = scalePulse({ beatTimes, beatQuarters: 1, downbeat: downbeat + startBar * 4, meter, bpm: 0, meterConfidence: 0 }, 0.5);
        beatTimes = halved.beatTimes;
        downbeat = halved.downbeat % 4;
      }
    }
  }
  // The opposite slip: a slow 4/4 whose harmony moves at every half bar as much as at the
  // bar line is really twice as fast (eighths read as sixteenths).
  if (meter.beats === 4 && beatQuarters === 1) {
    const beatSec = median(beatTimes.slice(1).map((t, i) => t - beatTimes[i]));
    if (beatSec > 0 && 60 / beatSec <= 76) {
      const halves: number[] = [];
      for (let i = downbeat; i < beatTimes.length; i += 2) halves.push(beatTimes[i]);
      const change = chromaChanges(notes, halves);
      const atBar = change.filter((_, i) => i > 0 && i % 2 === 0);
      const atHalf = change.filter((_, i) => i % 2 === 1);
      const mean = (v: number[]) => (v.length ? v.reduce((s, x) => s + x, 0) / v.length : 0);
      if (halves.length >= 8 && mean(atBar) > 0.2 && mean(atHalf) >= mean(atBar) * 0.7) {
        const doubled = scalePulse({ beatTimes, beatQuarters, downbeat, meter, bpm: 0, meterConfidence: 0 }, 2);
        beatTimes = doubled.beatTimes;
        downbeat = doubled.downbeat % 4;
      }
    }
  }
  const intervals = beatTimes.slice(1).map((t, i) => t - beatTimes[i]);
  const beatSeconds = median(intervals) || period;
  const bpm = Math.round((60 * beatQuarters) / beatSeconds);
  return { beatTimes, beatQuarters, downbeat, meter, bpm: Math.max(30, Math.min(240, bpm)), meterConfidence: Math.max(0, confidence) };
}

/** Halve or double the pulse (the classic double/half-tempo slip), keeping bar 1 in place. */
export function scalePulse(grid: PulseGrid, factor: 0.5 | 1 | 2): PulseGrid {
  if (factor === 1) return grid;
  if (factor === 2) {
    // Twice as fast: every tracked beat becomes two beats.
    const beatTimes: number[] = [];
    grid.beatTimes.forEach((t, i) => {
      beatTimes.push(t);
      const next = grid.beatTimes[i + 1];
      if (next != null) beatTimes.push((t + next) / 2);
    });
    return { ...grid, beatTimes, downbeat: grid.downbeat * 2, bpm: Math.min(240, grid.bpm * 2) };
  }
  const phase = grid.downbeat % 2;
  const beatTimes = grid.beatTimes.filter((_, i) => i >= phase && (i - phase) % 2 === 0);
  return { ...grid, beatTimes, downbeat: Math.floor((grid.downbeat - phase) / 2), bpm: Math.max(30, Math.round(grid.bpm / 2)) };
}

/** Quarter-note position of a time on the grid; bar 1 starts after `pickup` quarters. */
export function quarterAt(grid: PulseGrid, time: number): number {
  const barBeats = grid.meter.beats;
  const start = grid.downbeat > 0 ? grid.downbeat - barBeats : 0;
  return (beatPosition(grid.beatTimes, time) - start) * grid.beatQuarters;
}

export const METER_CHOICES: readonly Meter[] = [
  { beats: 2, beatUnit: 4 },
  { beats: 3, beatUnit: 4 },
  { beats: 4, beatUnit: 4 },
  { beats: 3, beatUnit: 8 },
  { beats: 6, beatUnit: 8 },
];

/**
 * Re-read the same tracked beats in a meter the user picked. Switching between
 * quarter and eighth beats splits or merges them; bar 1 is placed again from the
 * bass and harmony accents.
 */
export function regroupPulse(notes: readonly PolyNoteEvent[], grid: PulseGrid, meter: Meter): PulseGrid {
  let next = grid;
  const wantEighths = meter.beatUnit === 8;
  if (wantEighths && grid.beatQuarters === 1) next = { ...scalePulse(grid, 2), beatQuarters: 0.5, bpm: grid.bpm };
  if (!wantEighths && grid.beatQuarters === 0.5) next = { ...scalePulse(grid, 0.5), beatQuarters: 1, bpm: grid.bpm };
  const accents = beatAccents(notes, next.beatTimes);
  const { phase } = meterScore(accents, meter.beats);
  return { ...next, meter, downbeat: phase, meterConfidence: 1 };
}
