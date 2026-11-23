import { voiceList } from "./voices.ts";
import { barStarts } from "./practice.ts";
import type { Timeline } from "./score-timeline.ts";
import { type Score, type ScoreNote } from "./theory.ts";
import { scoreQuarters } from "./voices.ts";

/** One sounding (or written) pitch as a time × MIDI rectangle. A chord is several rects. */
export type PianoRollRect = {
  start: number;
  dur: number;
  midi: number;
  voice: number;
  note: number;
};

export type PianoRollPitch = "sounding" | "written";

export type PianoRollScore = Pick<Score, "notes" | "voice2" | "extraVoices"> & Timeline;

export type PianoRollModel = {
  rects: PianoRollRect[];
  /** Written length of the longer voice, in quarter notes. */
  quarters: number;
  midiLow: number;
  midiHigh: number;
  /** Barline positions in quarter notes, including 0 and the written end. */
  bars: number[];
};

const DEFAULT_LOW = 48;
const DEFAULT_HIGH = 72;
const RANGE_PAD = 2;

function displayMidi(midi: number, shift: number, pitch: PianoRollPitch): number {
  return pitch === "written" ? midi + shift : midi;
}

function collectVoice(notes: readonly ScoreNote[], voice: number, shift: number, pitch: PianoRollPitch): PianoRollRect[] {
  const rects: PianoRollRect[] = [];
  let at = 0;
  notes.forEach((note, index) => {
    const dur = note.dur;
    if (!Number.isFinite(dur) || dur <= 0) return;
    for (const midi of note.pitches) {
      if (!Number.isFinite(midi)) continue;
      rects.push({
        start: at,
        dur,
        midi: displayMidi(midi, shift, pitch),
        voice,
        note: index,
      });
    }
    at += dur;
  });
  return rects;
}

/**
 * Project a score into a read-only piano-roll model.
 * Time is written quarter notes, so a mid-song tempo change does not squash the picture.
 * `shift` is the transposing-instrument written offset (concert + shift); it only
 * applies when `pitch` is `"written"`. Default is sounding pitch, matching MIDI export.
 */
export function pianoRollOf(
  score: PianoRollScore,
  options?: { shift?: number; pitch?: PianoRollPitch },
): PianoRollModel {
  const shift = options?.shift ?? 0;
  const pitch = options?.pitch ?? "sounding";
  const rects = [
    ...voiceList(score).flatMap((v,i) => collectVoice(v, i, shift, pitch)),
  ];
  const quarters = scoreQuarters(score);
  let midiLow = DEFAULT_LOW;
  let midiHigh = DEFAULT_HIGH;
  if (rects.length) {
    let lo = Infinity;
    let hi = -Infinity;
    for (const rect of rects) {
      lo = Math.min(lo, rect.midi);
      hi = Math.max(hi, rect.midi);
    }
    midiLow = lo - RANGE_PAD;
    midiHigh = hi + RANGE_PAD;
    if (midiHigh < midiLow) {
      midiLow = DEFAULT_LOW;
      midiHigh = DEFAULT_HIGH;
    }
  }
  const bars = barStarts(score);
  if (quarters > 0 && (bars.length === 0 || bars[bars.length - 1] < quarters - 1e-9)) bars.push(quarters);
  return { rects, quarters: Math.max(0, quarters), midiLow, midiHigh, bars };
}

export type PianoRollLayout = {
  width: number;
  height: number;
  keyboardWidth: number;
  axisHeight: number;
  pxPerQuarter: number;
  rowHeight: number;
  xOf: (start: number) => number;
  yOf: (midi: number) => number;
  wOf: (dur: number) => number;
};

const MIN_PX_PER_QUARTER = 28;
const MAX_PX_PER_QUARTER = 56;
const KEYBOARD_WIDTH = 36;
const AXIS_HEIGHT = 18;
const ROW_HEIGHT = 10;

/** Pixel layout for a model inside an available CSS width. Long scores scroll horizontally. */
export function layoutPianoRoll(
  model: PianoRollModel,
  width: number,
  options?: { rowHeight?: number; minPlotHeight?: number },
): PianoRollLayout {
  const keyboardWidth = KEYBOARD_WIDTH;
  const axisHeight = AXIS_HEIGHT;
  const rows = Math.max(1, model.midiHigh - model.midiLow + 1);
  const autoRow = options?.minPlotHeight && options.minPlotHeight > 0
    ? Math.max(8, Math.min(28, options.minPlotHeight / rows))
    : ROW_HEIGHT;
  const rowHeight = options?.rowHeight ?? autoRow;
  const available = Math.max(120, (Number.isFinite(width) && width > 0 ? width : 0) - keyboardWidth);
  const fitted = model.quarters > 0 ? available / model.quarters : MIN_PX_PER_QUARTER;
  const pxPerQuarter = Math.max(MIN_PX_PER_QUARTER, Math.min(MAX_PX_PER_QUARTER, fitted));
  const plotWidth = Math.max(available, pxPerQuarter * Math.max(model.quarters, 1));
  return {
    width: keyboardWidth + plotWidth,
    height: axisHeight + rows * rowHeight,
    keyboardWidth,
    axisHeight,
    pxPerQuarter,
    rowHeight,
    xOf: (start) => keyboardWidth + start * pxPerQuarter,
    yOf: (midi) => axisHeight + (model.midiHigh - midi) * rowHeight,
    wOf: (dur) => Math.max(2, dur * pxPerQuarter),
  };
}

/** White-key pitch classes (C major). */
export function isWhiteKey(midi: number): boolean {
  const pc = ((Math.round(midi) % 12) + 12) % 12;
  return pc === 0 || pc === 2 || pc === 4 || pc === 5 || pc === 7 || pc === 9 || pc === 11;
}

export function midiOctaveName(midi: number): string | null {
  const rounded = Math.round(midi);
  if (((rounded % 12) + 12) % 12 !== 0) return null;
  return `C${Math.floor(rounded / 12) - 1}`;
}
