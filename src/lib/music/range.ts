import { abcNoteName } from "./notation.ts";
import {
  instrumentOf,
  transposeKey,
  type InstrumentId,
  type KeyName,
  type Mode,
} from "./theory.ts";

/**
 * Practical written ranges for the instrument buttons.
 * Inclusive MIDI. These are usual student ranges, not professional extremes.
 *
 * Assumption: school-band method books (the territory of Essential Elements and
 * Standard of Excellence) plus the "practical" column of orchestration charts.
 * Altissimo, pedal tones, and lead notes above the usual top are left out.
 *
 * - 降B单簧管 / A调单簧管: written E3–C6 (52–84). Low E is the bottom key.
 *   Altissimo starts at C#6. A clarinet uses the same written compass.
 * - 小号: written F#3–C6 (54–84). F#3 is the practical bottom; high C is the
 *   usual top. Pedal tones and notes above high C are omitted.
 * - 中音萨克斯: written Bb3–F6 (58–89). Bb3 is the bottom key. F#6 and above
 *   is altissimo.
 * - 圆号: written G3–C6 (55–84). Below G3 is possible but unreliable for
 *   students. Above C6 is advanced.
 * - 原调 is concert pitch and not one horn, so it has no range.
 *
 * The check uses written pitch: sounding MIDI plus the preset's shift.
 * Playback stays on the sounding pitches.
 */
const WRITTEN_RANGES: Record<Exclude<InstrumentId, "concert">, WrittenRange> = {
  bb: { low: 52, high: 84, label: "E3–C6" },
  trumpet: { low: 54, high: 84, label: "F#3–C6" },
  eb: { low: 58, high: 89, label: "Bb3–F6" },
  f: { low: 55, high: 84, label: "G3–C6" },
  a: { low: 52, high: 84, label: "E3–C6" },
};

export type WrittenRange = {
  /** Inclusive written MIDI. */
  low: number;
  high: number;
  /** Scientific names for the notice, such as "E3–C6". */
  label: string;
};

export type RangeHit = {
  index: number;
  /** Indexes into that note's `pitches` that fall outside the written range. */
  pitchIndexes: number[];
  /** Absent means voice 1, so older hit lists stay the same. */
  voice?: number;
};

export function writtenRangeOf(id: InstrumentId): WrittenRange | null {
  if (id === "concert") return null;
  return WRITTEN_RANGES[id];
}

export function outOfRangePitches(
  notes: readonly { pitches: readonly number[] }[],
  instrumentId: InstrumentId,
  voice?: number,
): RangeHit[] {
  const range = writtenRangeOf(instrumentId);
  if (!range) return [];
  const shift = instrumentOf(instrumentId).shift;
  const hits: RangeHit[] = [];
  notes.forEach((note, index) => {
    const pitchIndexes = note.pitches.flatMap((pitch, pitchIndex) => {
      const written = pitch + shift;
      return written < range.low || written > range.high ? [pitchIndex] : [];
    });
    if (!pitchIndexes.length) return;
    const hit: RangeHit = { index, pitchIndexes };
    if (voice !== undefined && voice > 0) hit.voice = voice;
    hits.push(hit);
  });
  return hits;
}

/** ABC notehead names for the out-of-range tones, spelled in the written key. */
export function outOfRangeHeadNames(
  note: { pitches: readonly number[] },
  pitchIndexes: readonly number[],
  instrumentId: InstrumentId,
  key: KeyName,
  mode: Mode,
): string[] {
  const shift = instrumentOf(instrumentId).shift;
  const writtenKey = transposeKey(key, shift);
  return pitchIndexes.map((index) => abcNoteName(note.pitches[index] + shift, writtenKey, mode));
}

export function rangeNotice(count: number, instrument: string, span: string): string | null {
  if (!count) return null;
  return `有 ${count} 个音超出${instrument}的常用音域（记谱 ${span}）。`;
}

export function rangePitchCount(hits: readonly RangeHit[]): number {
  return hits.reduce((total, hit) => total + hit.pitchIndexes.length, 0);
}
