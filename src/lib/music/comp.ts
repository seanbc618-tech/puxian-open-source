/**
 * Simple play-along backing from written chord symbols (iReal Pro-style idea).
 * The score is left untouched; only playback schedules extra bass + block chords.
 */
import { parseChordSymbol, pitchClassOf, type ChordQuality } from "./chord-symbol.ts";
import { meterAt, nextBar, nextChange } from "./score-timeline.ts";
import type { Score } from "./theory.ts";
import { scoreQuarters } from "./voices.ts";

export type CompEvent = {
  midi: number;
  start: number;
  dur: number;
  gain: number;
  timbre: "bass" | "piano";
};

const QUALITY_PCS: Record<ChordQuality, readonly number[]> = {
  major: [0, 4, 7],
  minor: [0, 3, 7],
  diminished: [0, 3, 6],
  augmented: [0, 4, 8],
  dominant: [0, 4, 7, 10],
  "major-seventh": [0, 4, 7, 11],
  "minor-seventh": [0, 3, 7, 10],
  "half-diminished": [0, 3, 6, 10],
  "diminished-seventh": [0, 3, 6, 9],
  "suspended-second": [0, 2, 7],
  "suspended-fourth": [0, 5, 7],
  power: [0, 7],
};

/** N.C. / 无 — no accompaniment until the next mark. */
export function isNoChord(symbol: string): boolean {
  const text = symbol.trim();
  return /^(N\.?\s*C\.?|NC|n\.?\s*c\.?|无)$/i.test(text);
}

function midiInRange(pc: number, low: number, high: number, prefer: number): number {
  const base = ((Math.round(pc) % 12) + 12) % 12;
  let best = base;
  let dist = Infinity;
  for (let midi = base; midi <= high + 12; midi += 12) {
    if (midi < low || midi > high) continue;
    const d = Math.abs(midi - prefer);
    if (d < dist) {
      dist = d;
      best = midi;
    }
  }
  return best;
}

function beatLength(score: Score, at: number): number {
  const unit = meterAt(score, at).beatUnit;
  return 4 / (Number.isFinite(unit) && unit > 0 ? unit : 4);
}

function barStartAt(score: Score, at: number): number {
  let t = 0;
  let last = 0;
  for (let i = 0; i < 100_000; i += 1) {
    const next = nextBar(score, t);
    if (!Number.isFinite(next) || next <= t + 1e-12 || next > at + 1e-9) return last;
    last = next;
    t = next;
  }
  return last;
}

function beatIndex(score: Score, at: number): number {
  const len = beatLength(score, at);
  const start = barStartAt(score, at);
  const beats = Math.max(1, Math.round(meterAt(score, at).beats));
  const raw = Math.round((at - start) / len);
  return ((raw % beats) + beats) % beats;
}

/** Beat onsets in [from, to), plus `from` when a chord starts mid-beat. */
export function beatAttacks(score: Score, from: number, to: number): number[] {
  const out: number[] = [];
  let t = 0;
  const end = Math.max(from, to);
  for (let i = 0; i < 100_000 && t < end - 1e-9; i += 1) {
    if (t >= from - 1e-9) out.push(t);
    const len = beatLength(score, t);
    const change = nextChange(score, t);
    const bar = nextBar(score, t);
    const next = Math.min(t + len, Number.isFinite(change) ? change : Infinity, Number.isFinite(bar) ? bar : Infinity);
    if (!Number.isFinite(next) || next <= t + 1e-12) break;
    t = next;
  }
  if (from < end - 1e-9 && (out[0] == null || out[0] > from + 1e-9)) out.unshift(from);
  return out;
}

type Voicing = { bass: number; fifth: number; chord: number[] };

function voicingOf(symbol: string): Voicing | null {
  if (isNoChord(symbol)) return null;
  const parsed = parseChordSymbol(symbol);
  if (!parsed) return null;
  const root = pitchClassOf(parsed.root);
  const bassPc = parsed.bass ? pitchClassOf(parsed.bass) : root;
  const intervals = QUALITY_PCS[parsed.quality] ?? QUALITY_PCS.major;
  const fifthPc = (root + (intervals.includes(7) ? 7 : intervals[intervals.length - 1] ?? 7)) % 12;
  return {
    bass: midiInRange(bassPc, 36, 50, 40),
    fifth: midiInRange(parsed.bass ? bassPc : fifthPc, 36, 50, 40),
    chord: intervals.map((step) => midiInRange((root + step) % 12, 55, 72, 60)),
  };
}

function shouldBass(score: Score, at: number): { play: boolean; fifth: boolean } {
  const beats = Math.max(1, Math.round(meterAt(score, at).beats));
  const beat = beatIndex(score, at);
  if (beats % 2 === 0) {
    if (beat % 2 !== 0) return { play: false, fifth: false };
    return { play: true, fifth: beat !== 0 };
  }
  if (beat !== 0 && beat !== beats - 1) return { play: false, fifth: false };
  return { play: true, fifth: beat !== 0 };
}

/**
 * Bass on beats 1 and 3 (or 1 and last in odd meters), plus a quiet block chord
 * at each chord change and every later downbeat. N.C. is silent.
 */
export function accompanimentEvents(score: Score, from = 0, to = scoreQuarters(score)): CompEvent[] {
  const start = Math.max(0, from);
  const end = Math.max(start, to);
  const marks = [...(score.chordSymbols ?? [])].sort((a, b) => a.at - b.at);
  const events: CompEvent[] = [];
  const push = (midi: number, at: number, dur: number, gain: number, timbre: "bass" | "piano") => {
    const length = Math.min(dur, end - at);
    if (length <= 1e-9 || at >= end - 1e-9 || at + 1e-9 < start) return;
    events.push({ midi, start: at, dur: length, gain, timbre });
  };

  for (let i = 0; i < marks.length; i += 1) {
    const mark = marks[i];
    const nextAt = i + 1 < marks.length ? marks[i + 1].at : end;
    const a = Math.max(mark.at, start);
    const b = Math.min(nextAt, end);
    if (b <= a + 1e-9) continue;
    const voice = voicingOf(mark.symbol);
    if (!voice) continue;
    const attacks = beatAttacks(score, a, b);
    for (let j = 0; j < attacks.length; j += 1) {
      const at = attacks[j];
      const until = Math.min(j + 1 < attacks.length ? attacks[j + 1] : b, b);
      const bass = shouldBass(score, at);
      const onset = Math.abs(at - a) < 1e-9;
      const downbeat = beatIndex(score, at) === 0;
      if (bass.play) {
        const note = bass.fifth ? voice.fifth : voice.bass;
        push(note, at, (until - at) * 0.9, 0.55, "bass");
      }
      if (onset || downbeat) {
        const chordDur = Math.min(beatLength(score, at) * 0.6, until - at);
        for (const midi of voice.chord) push(midi, at, chordDur, 0.22, "piano");
      }
    }
  }
  return events;
}
