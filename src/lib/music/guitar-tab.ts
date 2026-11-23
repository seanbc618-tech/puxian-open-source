import { voiceList } from "./voices.ts";
import { barStarts } from "./practice.ts";
import type { Timeline } from "./score-timeline.ts";
import { type Score, type ScoreNote } from "./theory.ts";
import { scoreQuarters } from "./voices.ts";

/** One sounding pitch placed on a string/fret, or left unplaceable. */
export type TabPlace = {
  start: number;
  dur: number;
  midi: number;
  voice: number;
  note: number;
  /** MusicXML string number: 1 is the highest-pitched string. */
  string: number;
  fret: number;
};

export type TabMiss = {
  start: number;
  dur: number;
  midi: number;
  voice: number;
  note: number;
  reason: "low" | "high" | "no-string";
};

export type TabString = {
  /** MusicXML string number (1 = highest). */
  string: number;
  midi: number;
  name: string;
};

export type TabTuningId = "guitar-standard" | "bass-standard";

export type TabTuning = {
  id: TabTuningId;
  label: string;
  /** High string first (drawn at the top of the tab). */
  strings: readonly TabString[];
  maxFret: number;
};

export const GUITAR_STANDARD: TabTuning = {
  id: "guitar-standard",
  label: "吉他标准调弦",
  strings: [
    { string: 1, midi: 64, name: "e" }, // E4
    { string: 2, midi: 59, name: "B" }, // B3
    { string: 3, midi: 55, name: "G" }, // G3
    { string: 4, midi: 50, name: "D" }, // D3
    { string: 5, midi: 45, name: "A" }, // A2
    { string: 6, midi: 40, name: "E" }, // E2
  ],
  maxFret: 24,
};

export const BASS_STANDARD: TabTuning = {
  id: "bass-standard",
  label: "贝斯标准四弦",
  strings: [
    { string: 1, midi: 43, name: "G" }, // G2
    { string: 2, midi: 38, name: "D" }, // D2
    { string: 3, midi: 33, name: "A" }, // A1
    { string: 4, midi: 28, name: "E" }, // E1
  ],
  maxFret: 24,
};

export const TAB_TUNINGS: Record<TabTuningId, TabTuning> = {
  "guitar-standard": GUITAR_STANDARD,
  "bass-standard": BASS_STANDARD,
};

export function tuningOf(id: TabTuningId | TabTuning): TabTuning {
  return typeof id === "string" ? TAB_TUNINGS[id] : id;
}

/** A fret-window (“把位”) to prefer when placing notes. `auto` stays in a low position. */
export type TabPositionId = "auto" | "I" | "III" | "V" | "VII" | "IX" | "XII";

export type TabPosition = {
  id: TabPositionId;
  label: string;
  /** Inclusive preferred window; both null means automatic low-position fingering. */
  from: number | null;
  to: number | null;
};

export const TAB_POSITIONS: readonly TabPosition[] = [
  { id: "auto", label: "低把位（自动）", from: null, to: null },
  { id: "I", label: "I 把（0–4 品）", from: 0, to: 4 },
  { id: "III", label: "III 把（3–7 品）", from: 3, to: 7 },
  { id: "V", label: "V 把（5–9 品）", from: 5, to: 9 },
  { id: "VII", label: "VII 把（7–11 品）", from: 7, to: 11 },
  { id: "IX", label: "IX 把（9–13 品）", from: 9, to: 13 },
  { id: "XII", label: "XII 把（12–16 品）", from: 12, to: 16 },
];

const POSITION_BY_ID = Object.fromEntries(TAB_POSITIONS.map((item) => [item.id, item])) as Record<
  TabPositionId,
  TabPosition
>;

export function positionOf(id: TabPositionId | TabPosition = "auto"): TabPosition {
  return typeof id === "string" ? POSITION_BY_ID[id] ?? POSITION_BY_ID.auto : id;
}

export type TabScore = Pick<Score, "notes" | "voice2" | "extraVoices" | "chordSymbols"> & Timeline;

export type TabChordMark = { at: number; symbol: string };

export type TabModel = {
  tuning: TabTuning;
  places: TabPlace[];
  misses: TabMiss[];
  quarters: number;
  bars: number[];
  position: TabPosition;
  chordMarks: TabChordMark[];
};

type EventNote = {
  start: number;
  dur: number;
  midi: number;
  voice: number;
  note: number;
};

function collectVoice(notes: readonly ScoreNote[], voice: number): EventNote[] {
  const events: EventNote[] = [];
  let at = 0;
  notes.forEach((note, index) => {
    const dur = note.dur;
    if (!Number.isFinite(dur) || dur <= 0) return;
    for (const midi of note.pitches) {
      if (!Number.isFinite(midi)) continue;
      events.push({ start: at, dur, midi, voice, note: index });
    }
    at += dur;
  });
  return events;
}

export function candidatesFor(midi: number, tuning: TabTuning): { string: number; fret: number }[] {
  const out: { string: number; fret: number }[] = [];
  for (const str of tuning.strings) {
    const fret = midi - str.midi;
    if (fret >= 0 && fret <= tuning.maxFret) out.push({ string: str.string, fret });
  }
  return out;
}

function missReason(midi: number, tuning: TabTuning): TabMiss["reason"] {
  const lowest = tuning.strings[tuning.strings.length - 1]!.midi;
  const highest = tuning.strings[0]!.midi + tuning.maxFret;
  if (midi < lowest) return "low";
  if (midi > highest) return "high";
  return "no-string";
}

function fretCost(fret: number, position: TabPosition): number {
  if (position.from == null || position.to == null) {
    if (fret === 0) return -2;
    if (fret <= 4) return fret * 0.2;
    if (fret <= 7) return 2 + (fret - 4) * 1.2;
    return 6 + (fret - 7) * 2.5;
  }
  if (fret >= position.from && fret <= position.to) return Math.abs(fret - position.from) * 0.2;
  // Open strings remain handy in a low position, but not when the window is high.
  if (fret === 0 && position.from <= 3) return 0.4;
  const dist = fret < position.from ? position.from - fret : fret - position.to;
  return 8 + dist * 3;
}

function assignmentCost(
  places: readonly { fret: number }[],
  prevCenter: number | null,
  position: TabPosition,
): number {
  const fretted = places.filter((item) => item.fret > 0).map((item) => item.fret);
  const span = fretted.length ? Math.max(...fretted) - Math.min(...fretted) : 0;
  const avg = fretted.length ? fretted.reduce((sum, fret) => sum + fret, 0) / fretted.length : 0;
  let cost = 0;
  for (const item of places) cost += fretCost(item.fret, position);
  cost += span > 4 ? (span - 4) * 8 : span * 0.4;
  if (prevCenter != null && fretted.length) cost += Math.abs(avg - prevCenter) * (position.from == null ? 0.8 : 1.1);
  return cost;
}

function sortCandidates(
  cands: { string: number; fret: number }[],
  position: TabPosition,
): { string: number; fret: number }[] {
  return cands.slice().sort((a, b) => fretCost(a.fret, position) - fretCost(b.fret, position) || a.string - b.string);
}

function placeGroup(
  group: EventNote[],
  tuning: TabTuning,
  prevCenter: number | null,
  position: TabPosition,
): {
  places: TabPlace[];
  misses: TabMiss[];
} {
  const options = group.map((item) => ({ item, cands: sortCandidates(candidatesFor(item.midi, tuning), position) }));
  const misses: TabMiss[] = [];
  const placeable = options.filter((entry) => {
    if (entry.cands.length) return true;
    misses.push({ ...entry.item, reason: missReason(entry.item.midi, tuning) });
    return false;
  });
  if (!placeable.length) return { places: [], misses };

  let best: TabPlace[] = [];
  let bestCost = Infinity;
  const acc: TabPlace[] = [];
  const used = new Set<number>();

  const search = (index: number) => {
    if (index === placeable.length) {
      const cost = assignmentCost(acc, prevCenter, position);
      if (cost < bestCost) {
        bestCost = cost;
        best = acc.slice();
      }
      return;
    }
    const entry = placeable[index]!;
    let fitted = false;
    for (const cand of entry.cands) {
      if (used.has(cand.string)) continue;
      fitted = true;
      used.add(cand.string);
      acc.push({ ...entry.item, string: cand.string, fret: cand.fret });
      search(index + 1);
      acc.pop();
      used.delete(cand.string);
    }
    if (!fitted) search(index + 1);
  };
  search(0);

  const placed = best;
  const taken = new Set(placed.map((item) => `${item.voice}:${item.note}:${item.midi}`));
  for (const entry of placeable) {
    const key = `${entry.item.voice}:${entry.item.note}:${entry.item.midi}`;
    if (!taken.has(key)) misses.push({ ...entry.item, reason: "no-string" });
  }
  return { places: placed, misses };
}

function nextCenter(places: readonly TabPlace[], prev: number | null): number | null {
  const fretted = places.filter((item) => item.fret > 0).map((item) => item.fret);
  if (!fretted.length) return prev;
  return fretted.reduce((sum, fret) => sum + fret, 0) / fretted.length;
}

/**
 * Map sounding pitches onto a standard-tuning tab.
 * Time is written quarter notes (tempo changes do not squash the picture).
 * Does not mutate the score; views must not write history.
 */
export function guitarTabOf(
  score: TabScore,
  tuning: TabTuningId | TabTuning = GUITAR_STANDARD,
  position: TabPositionId | TabPosition = "auto",
): TabModel {
  const resolved = tuningOf(tuning);
  const resolvedPosition = positionOf(position);
  const events = [
    ...voiceList(score).flatMap((v,i) => collectVoice(v, i)),
  ].sort((a, b) => a.start - b.start || a.voice - b.voice || a.midi - b.midi);

  const groups: EventNote[][] = [];
  for (const event of events) {
    const last = groups[groups.length - 1];
    if (last && Math.abs(last[0]!.start - event.start) < 1e-9) last.push(event);
    else groups.push([event]);
  }

  const places: TabPlace[] = [];
  const misses: TabMiss[] = [];
  let center: number | null = null;
  for (const group of groups) {
    const result = placeGroup(group, resolved, center, resolvedPosition);
    places.push(...result.places);
    misses.push(...result.misses);
    center = nextCenter(result.places, center);
  }

  const quarters = scoreQuarters(score);
  const bars = barStarts(score);
  if (quarters > 0 && (bars.length === 0 || bars[bars.length - 1]! < quarters - 1e-9)) bars.push(quarters);
  const end = Math.max(0, quarters);
  const chordMarks = (score.chordSymbols ?? []).filter((item) => item.at >= -1e-9 && item.at < end - 1e-9)
    .map((item) => ({ at: item.at, symbol: item.symbol }));
  return {
    tuning: resolved,
    places,
    misses,
    quarters: end,
    bars,
    position: resolvedPosition,
    chordMarks,
  };
}

export type TabLayout = {
  width: number;
  height: number;
  labelWidth: number;
  axisHeight: number;
  pxPerQuarter: number;
  stringGap: number;
  xOf: (start: number) => number;
  yOf: (stringNumber: number) => number;
  wOf: (dur: number) => number;
};

const MIN_PX_PER_QUARTER = 28;
const MAX_PX_PER_QUARTER = 56;
const LABEL_WIDTH = 28;
const AXIS_HEIGHT = 18;
const CHORD_AXIS_EXTRA = 16;
const STRING_GAP = 16;

/** Pixel layout for a model inside an available CSS width. Long scores scroll horizontally. */
export function layoutGuitarTab(model: TabModel, width: number): TabLayout {
  const labelWidth = LABEL_WIDTH;
  const axisHeight = AXIS_HEIGHT + (model.chordMarks.length ? CHORD_AXIS_EXTRA : 0);
  const stringGap = STRING_GAP;
  const strings = model.tuning.strings.length;
  const available = Math.max(120, (Number.isFinite(width) && width > 0 ? width : 0) - labelWidth);
  const fitted = model.quarters > 0 ? available / model.quarters : MIN_PX_PER_QUARTER;
  const pxPerQuarter = Math.max(MIN_PX_PER_QUARTER, Math.min(MAX_PX_PER_QUARTER, fitted));
  const plotWidth = Math.max(available, pxPerQuarter * Math.max(model.quarters, 1));
  return {
    width: labelWidth + plotWidth,
    height: axisHeight + Math.max(1, strings - 1) * stringGap + 16,
    labelWidth,
    axisHeight,
    pxPerQuarter,
    stringGap,
    xOf: (start) => labelWidth + start * pxPerQuarter,
    yOf: (stringNumber) => axisHeight + (stringNumber - 1) * stringGap + 8,
    wOf: (dur) => Math.max(2, dur * pxPerQuarter),
  };
}

export function describeTabMisses(misses: readonly TabMiss[], tuning: TabTuning): string | null {
  if (!misses.length) return null;
  const low = misses.filter((item) => item.reason === "low").length;
  const high = misses.filter((item) => item.reason === "high").length;
  const other = misses.length - low - high;
  const parts: string[] = [];
  if (low) parts.push(`${low} 个低于最低弦`);
  if (high) parts.push(`${high} 个高于 ${tuning.maxFret} 品`);
  if (other) parts.push(`${other} 个无法分到空弦`);
  return `有 ${misses.length} 个音无法安全落品（${parts.join("，")}）。只支持${tuning.label}。`;
}
