// Key and chord names for a 多音 dictation draft. Pure, local, deterministic.
import type { PolyNoteEvent } from "./basic-pitch/notes.ts";
import { formatChordSymbol, spellPitchClass, type ChordQuality, type ChordSymbol, type ParsedChord } from "./chord-symbol.ts";
import { KEY_NAMES, type KeyName, type Mode, type ScoreNote } from "./theory.ts";

const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

function correlate(chroma: readonly number[], profile: readonly number[], tonic: number): number {
  const n = 12;
  const mx = chroma.reduce((s, v) => s + v, 0) / n;
  const my = profile.reduce((s, v) => s + v, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const x = chroma[(tonic + i) % 12] - mx;
    const y = profile[i] - my;
    sxy += x * y;
    sxx += x * x;
    syy += y * y;
  }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : 0;
}

/**
 * Key from sounding notes. The key signature comes from a Krumhansl–Schmuckler
 * profile (major and relative minor summed, since they share it); major versus
 * relative minor is then settled by the bass: which tonic the low notes, the
 * first and the last bass note sit on, and whether the minor's raised leading
 * tone is heard. A profile alone often names the relative key (D major heard as
 * B minor) on slow, pedalled piano.
 */
export function estimateKey(notes: readonly PolyNoteEvent[]): { key: KeyName; mode: Mode; scores: { major: number; minor: number } } {
  const chroma = new Array<number>(12).fill(0);
  const bass = new Array<number>(12).fill(0);
  const sorted = [...notes].sort((a, b) => a.start - b.start);
  const lows = sorted.map((n) => n.midi).sort((a, b) => a - b);
  const lowLine = lows.length ? lows[Math.floor(lows.length * 0.25)] : 48;
  for (const n of sorted) {
    const w = Math.min(n.dur, 2) * Math.max(0.05, n.amplitude);
    chroma[n.midi % 12] += w;
    if (n.midi <= lowLine + 2) bass[n.midi % 12] += w;
  }
  let bestMajor = 0;
  let bestScore = -Infinity;
  for (let tonic = 0; tonic < 12; tonic++) {
    const s = correlate(chroma, MAJOR, tonic) + correlate(chroma, MINOR, (tonic + 9) % 12);
    if (s > bestScore) {
      bestScore = s;
      bestMajor = tonic;
    }
  }
  const minorTonic = (bestMajor + 9) % 12;
  const total = chroma.reduce((s, v) => s + v, 0) || 1;
  const bassTotal = bass.reduce((s, v) => s + v, 0) || 1;
  const lowest = (from: PolyNoteEvent[]) => {
    if (!from.length) return -1;
    const t0 = from[0].start;
    const group = from.filter((n) => Math.abs(n.start - t0) < 0.3);
    return Math.min(...group.map((n) => n.midi)) % 12;
  };
  const firstBass = lowest(sorted);
  const lastStart = sorted.at(-1)?.start ?? 0;
  const lastBass = lowest(sorted.filter((n) => n.start >= lastStart - 0.3));
  const evidence = (tonic: number, leading: number) =>
    (bass[tonic] / bassTotal) * 2 +
    (bass[(tonic + 7) % 12] / bassTotal) * 0.7 +
    (chroma[tonic] / total) * 1.5 +
    (firstBass === tonic ? 0.25 : 0) +
    (lastBass === tonic ? 0.35 : 0) +
    (leading >= 0 ? (chroma[leading] / total) * 2.5 : 0);
  const major = evidence(bestMajor, -1);
  // G♯ in A minor: the raised seventh only the minor uses.
  const minor = evidence(minorTonic, (minorTonic + 11) % 12);
  const mode: Mode = minor > major ? "minor" : "major";
  const tonic = mode === "major" ? bestMajor : minorTonic;
  return { key: KEY_NAMES[tonic]!, mode, scores: { major, minor } };
}

const CHORD_TEMPLATES: Array<{ quality: ChordQuality; pcs: number[]; bias: number }> = [
  { quality: "major", pcs: [0, 4, 7], bias: 0.04 },
  { quality: "minor", pcs: [0, 3, 7], bias: 0.04 },
  { quality: "dominant", pcs: [0, 4, 7, 10], bias: 0 },
  { quality: "major-seventh", pcs: [0, 4, 7, 11], bias: 0 },
  { quality: "minor-seventh", pcs: [0, 3, 7, 10], bias: 0 },
  { quality: "diminished", pcs: [0, 3, 6], bias: -0.02 },
  { quality: "diminished-seventh", pcs: [0, 3, 6, 9], bias: -0.04 },
];

type Span = { from: number; to: number };

function spanChroma(voices: readonly (readonly ScoreNote[])[], span: Span) {
  const chroma = new Array<number>(12).fill(0);
  let bassMidi = Infinity;
  let bassWeight = new Array<number>(12).fill(0);
  for (const notes of voices) {
    let at = 0;
    for (const note of notes) {
      const lo = Math.max(at, span.from);
      const hi = Math.min(at + note.dur, span.to);
      if (hi > lo && note.pitches.length) {
        const low = Math.min(...note.pitches);
        for (const p of note.pitches) chroma[p % 12] += hi - lo;
        if (low < bassMidi - 4) {
          bassMidi = low;
          bassWeight = new Array<number>(12).fill(0);
        }
        if (low <= bassMidi + 4) bassWeight[low % 12] += hi - lo;
      }
      at += note.dur;
    }
  }
  const bassPc = bassWeight.some((v) => v > 0) ? bassWeight.indexOf(Math.max(...bassWeight)) : -1;
  return { chroma, bassPc };
}

function bestChord(chroma: readonly number[], bassPc: number): { root: number; quality: ChordQuality; score: number } | null {
  const total = chroma.reduce((s, v) => s + v, 0);
  if (!(total > 0)) return null;
  let best: { root: number; quality: ChordQuality; score: number } | null = null;
  for (let root = 0; root < 12; root++) {
    for (const t of CHORD_TEMPLATES) {
      const set = new Set(t.pcs.map((s) => (root + s) % 12));
      let inside = 0;
      let outside = 0;
      for (let pc = 0; pc < 12; pc++) {
        if (set.has(pc)) inside += chroma[pc];
        else outside += chroma[pc];
      }
      // Every chord tone should be present; a missing one costs.
      const missing = t.pcs.filter((s) => chroma[(root + s) % 12] < total * 0.04).length;
      // The seventh must be clearly heard to be named.
      const seventhWeak = t.pcs.length === 4 && chroma[(root + t.pcs[3]) % 12] < total * 0.1;
      let score = (inside - 0.7 * outside) / total - missing * 0.18 - (seventhWeak ? 0.3 : 0) + t.bias;
      if (bassPc === root) score += 0.12;
      if (!best || score > best.score) best = { root, quality: t.quality, score };
    }
  }
  return best && best.score > 0.25 ? best : null;
}

export type BarChord = { at: number; symbol: string };

/**
 * One chord name per bar from the written draft (both voices). A bar of four
 * beats is split in half when the two halves clearly name different chords.
 * Slash bass when the lowest note is not the root. Consecutive repeats are kept
 * per bar in `bars` (for the preview) and dropped in `symbols` (for the score).
 */
export function inferChordSymbols(
  voices: readonly (readonly ScoreNote[])[],
  barStarts: readonly number[],
  end: number,
  key: KeyName,
  mode: Mode,
  beatQuarters: number,
): { symbols: ChordSymbol[]; bars: (string | null)[] } {
  const name = (c: { root: number; quality: ChordQuality }, bassPc: number) => {
    const parsed: ParsedChord = { root: spellPitchClass(c.root, key, mode), quality: c.quality };
    if (bassPc >= 0 && bassPc !== c.root) parsed.bass = spellPitchClass(bassPc, key, mode);
    return formatChordSymbol(parsed, key, mode);
  };
  const symbols: ChordSymbol[] = [];
  const bars: (string | null)[] = [];
  const push = (at: number, symbol: string) => {
    if (symbols.at(-1)?.symbol === symbol) return;
    symbols.push({ at, symbol });
  };
  for (let i = 0; i < barStarts.length; i++) {
    const from = barStarts[i]!;
    const to = Math.min(barStarts[i + 1] ?? end, end);
    if (!(to > from)) continue;
    const whole = spanChroma(voices, { from, to });
    const chord = bestChord(whole.chroma, whole.bassPc);
    const length = to - from;
    // Split 4/4-sized bars in half when both halves are strong and different.
    if (length >= 4 * beatQuarters - 1e-6 && length >= 2) {
      const mid = from + length / 2;
      const a = spanChroma(voices, { from, to: mid });
      const b = spanChroma(voices, { from: mid, to });
      const ca = bestChord(a.chroma, a.bassPc);
      const cb = bestChord(b.chroma, b.bassPc);
      if (ca && cb && (ca.root !== cb.root || ca.quality !== cb.quality) && ca.score + cb.score > 2 * (chord?.score ?? 0) + 0.2) {
        const sa = name(ca, a.bassPc);
        const sb = name(cb, b.bassPc);
        bars.push(`${sa} ${sb}`);
        push(from, sa);
        push(mid, sb);
        continue;
      }
    }
    if (!chord) {
      bars.push(null);
      continue;
    }
    const symbol = name(chord, whole.bassPc);
    bars.push(symbol);
    push(from, symbol);
  }
  return { symbols, bars };
}

/** Chord line for the preview, e.g. "| Am | E | Am |". Empty bars show as "–". */
export function chordLine(bars: readonly (string | null)[], limit = 16): string {
  if (!bars.length) return "";
  const shown = bars.slice(0, limit).map((b) => b ?? "–");
  return `| ${shown.join(" | ")} |${bars.length > limit ? " …" : ""}`;
}
