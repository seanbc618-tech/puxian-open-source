/**
 * Chord-progression identification for 听音练耳 (Teoria-style idea).
 * Hear a short diatonic progression, answer by Roman numerals in order.
 * Independent of degree, interval, and chord-quality drills.
 */
import type { Mode } from "./theory.ts";
import type { EarEvent } from "./ear-training.ts";

export type ProgChordId =
  | "I" | "ii" | "iii" | "IV" | "V" | "vi" | "vii°"
  | "i" | "ii°" | "III" | "iv" | "VI" | "VII";

export type ProgStyle = "block" | "arpeggio";

export const PROG_CHORDS = [
  { id: "I", steps: 0, intervals: [0, 4, 7], label: "I", name: "I 级" },
  { id: "ii", steps: 2, intervals: [0, 3, 7], label: "ii", name: "ii 级" },
  { id: "iii", steps: 4, intervals: [0, 3, 7], label: "iii", name: "iii 级" },
  { id: "IV", steps: 5, intervals: [0, 4, 7], label: "IV", name: "IV 级" },
  { id: "V", steps: 7, intervals: [0, 4, 7], label: "V", name: "V 级" },
  { id: "vi", steps: 9, intervals: [0, 3, 7], label: "vi", name: "vi 级" },
  { id: "vii°", steps: 11, intervals: [0, 3, 6], label: "vii°", name: "vii° 级" },
  { id: "i", steps: 0, intervals: [0, 3, 7], label: "i", name: "i 级" },
  { id: "ii°", steps: 2, intervals: [0, 3, 6], label: "ii°", name: "ii° 级" },
  { id: "III", steps: 3, intervals: [0, 4, 7], label: "III", name: "III 级" },
  { id: "iv", steps: 5, intervals: [0, 3, 7], label: "iv", name: "iv 级" },
  { id: "VI", steps: 8, intervals: [0, 4, 7], label: "VI", name: "VI 级" },
  { id: "VII", steps: 10, intervals: [0, 4, 7], label: "VII", name: "VII 级" },
] as const satisfies readonly { id: ProgChordId; steps: number; intervals: readonly number[]; label: string; name: string }[];

export const MAJOR_ANSWERS = ["I", "ii", "iii", "IV", "V", "vi", "vii°"] as const satisfies readonly ProgChordId[];
export const MINOR_ANSWERS = ["i", "ii°", "III", "iv", "V", "VI", "VII", "vii°"] as const satisfies readonly ProgChordId[];

type ProgLevelTag = "basic" | "common" | "all";

export const EAR_PROGRESSIONS = [
  { id: "I-V-I", chords: ["I", "V", "I"], mode: "major", level: "basic" },
  { id: "I-IV-I", chords: ["I", "IV", "I"], mode: "major", level: "basic" },
  { id: "I-IV-V-I", chords: ["I", "IV", "V", "I"], mode: "major", level: "basic" },
  { id: "IV-V-I", chords: ["IV", "V", "I"], mode: "major", level: "basic" },
  { id: "I-V-vi-IV", chords: ["I", "V", "vi", "IV"], mode: "major", level: "common" },
  { id: "I-vi-IV-V", chords: ["I", "vi", "IV", "V"], mode: "major", level: "common" },
  { id: "ii-V-I", chords: ["ii", "V", "I"], mode: "major", level: "common" },
  { id: "I-vi-ii-V", chords: ["I", "vi", "ii", "V"], mode: "major", level: "common" },
  { id: "vi-IV-I-V", chords: ["vi", "IV", "I", "V"], mode: "major", level: "common" },
  { id: "I-ii-V-I", chords: ["I", "ii", "V", "I"], mode: "major", level: "all" },
  { id: "I-iii-vi-IV", chords: ["I", "iii", "vi", "IV"], mode: "major", level: "all" },
  { id: "I-V-IV-I", chords: ["I", "V", "IV", "I"], mode: "major", level: "all" },
  { id: "iii-vi-ii-V", chords: ["iii", "vi", "ii", "V"], mode: "major", level: "all" },
  { id: "I-vi-V-I", chords: ["I", "vi", "V", "I"], mode: "major", level: "all" },
  { id: "i-V-i", chords: ["i", "V", "i"], mode: "minor", level: "basic" },
  { id: "i-iv-i", chords: ["i", "iv", "i"], mode: "minor", level: "basic" },
  { id: "i-iv-V-i", chords: ["i", "iv", "V", "i"], mode: "minor", level: "basic" },
  { id: "iv-V-i", chords: ["iv", "V", "i"], mode: "minor", level: "basic" },
  { id: "i-VI-III-VII", chords: ["i", "VI", "III", "VII"], mode: "minor", level: "common" },
  { id: "i-iv-VII-III", chords: ["i", "iv", "VII", "III"], mode: "minor", level: "common" },
  { id: "i-VI-iv-V", chords: ["i", "VI", "iv", "V"], mode: "minor", level: "common" },
  { id: "i-V-VI", chords: ["i", "V", "VI"], mode: "minor", level: "common" },
  { id: "i-ii°-V-i", chords: ["i", "ii°", "V", "i"], mode: "minor", level: "all" },
  { id: "i-VII-VI-V", chords: ["i", "VII", "VI", "V"], mode: "minor", level: "all" },
  { id: "i-iv-i-V", chords: ["i", "iv", "i", "V"], mode: "minor", level: "all" },
  { id: "VI-VII-i", chords: ["VI", "VII", "i"], mode: "minor", level: "all" },
] as const satisfies readonly {
  id: string;
  chords: readonly ProgChordId[];
  mode: Mode;
  level: ProgLevelTag;
}[];

export type ProgressionId = (typeof EAR_PROGRESSIONS)[number]["id"];

export const PROG_LEVELS = [
  { id: "basic", label: "基础" },
  { id: "common", label: "常见" },
  { id: "all", label: "全部" },
] as const satisfies readonly { id: ProgLevelTag; label: string }[];

export type ProgLevelId = (typeof PROG_LEVELS)[number]["id"];

export const PROG_STORE_KEY = "puxian-ear-progression-v1";

const LEVEL_RANK: Record<ProgLevelTag, number> = { basic: 0, common: 1, all: 2 };

export function isProgChordId(value: string | null | undefined): value is ProgChordId {
  return PROG_CHORDS.some((item) => item.id === value);
}

export function isProgressionId(value: string | null | undefined): value is ProgressionId {
  return EAR_PROGRESSIONS.some((item) => item.id === value);
}

export function progChordOf(id: string) {
  return PROG_CHORDS.find((item) => item.id === id) ?? PROG_CHORDS[0];
}

export function progressionOf(id: string) {
  return EAR_PROGRESSIONS.find((item) => item.id === id) ?? EAR_PROGRESSIONS[0];
}

export function progLevelOf(id: string) {
  return PROG_LEVELS.find((level) => level.id === id) ?? PROG_LEVELS[0];
}

export function answerIds(mode: Mode): readonly ProgChordId[] {
  return mode === "minor" ? MINOR_ANSWERS : MAJOR_ANSWERS;
}

export function progressionLabel(id: string): string {
  return progressionOf(id).chords.join("–");
}

export function progressionUses(id: string, chord: string): boolean {
  return progressionOf(id).chords.some((item) => item === chord);
}


export function progressionsFor(levelId: string, mode: Mode): typeof EAR_PROGRESSIONS[number][] {
  const rank = LEVEL_RANK[progLevelOf(levelId).id];
  return EAR_PROGRESSIONS.filter((item) => item.mode === mode && LEVEL_RANK[item.level] <= rank);
}

export function pickProgression(
  levelId: string,
  mode: Mode,
  previous: ProgressionId | null,
  random: () => number = Math.random,
): ProgressionId {
  const pool = progressionsFor(levelId, mode).map((item) => item.id);
  const choices = pool.length > 1 && previous != null ? pool.filter((id) => id !== previous) : pool;
  const index = Math.min(choices.length - 1, Math.floor(Math.max(0, random()) * choices.length));
  return choices[index];
}

/** Root-position triad with the root doubled an octave below. */
export function progressionChordPitches(tonic: number, id: string): number[] {
  const chord = progChordOf(id);
  const root = tonic + chord.steps;
  return [root - 12, ...chord.intervals.map((step) => root + step)];
}

export function progressionPitches(tonic: number, chords: readonly string[]): number[][] {
  return chords.map((id) => progressionChordPitches(tonic, id));
}

export function progressionQuestionEvents(chords: readonly number[][], style: ProgStyle): EarEvent[] {
  const events: EarEvent[] = [];
  if (style === "block") {
    chords.forEach((pitches, index) => {
      const at = index * 0.8;
      for (const midi of pitches) events.push({ midi, when: at, dur: 0.7, gain: 0.14 });
    });
    return events;
  }
  let at = 0;
  for (const pitches of chords) {
    pitches.forEach((midi, index) => {
      events.push({ midi, when: at + index * 0.28, dur: 0.32, gain: 0.22 });
    });
    at += pitches.length * 0.28 + 0.16;
  }
  return events;
}

export function sameProgression(draft: readonly string[], expected: readonly string[]): boolean {
  return draft.length === expected.length && draft.every((id, index) => id === expected[index]);
}

export type ProgStats = Partial<Record<ProgressionId, { right: number; total: number }>>;

export function cleanProgStats(value: unknown): ProgStats {
  const stats: ProgStats = {};
  if (!value || typeof value !== "object") return stats;
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (!isProgressionId(key) || !entry || typeof entry !== "object") continue;
    const { right, total } = entry as Record<string, unknown>;
    if (typeof right !== "number" || typeof total !== "number" || !Number.isInteger(right) || !Number.isInteger(total)) continue;
    if (total < 1 || right < 0 || right > total) continue;
    stats[key] = { right, total };
  }
  return stats;
}

export function recordProgAnswer(stats: ProgStats, id: ProgressionId, firstTryRight: boolean): ProgStats {
  const before = stats[id] ?? { right: 0, total: 0 };
  return { ...stats, [id]: { right: before.right + (firstTryRight ? 1 : 0), total: before.total + 1 } };
}

export function progSummary(stats: ProgStats): string {
  const entries = (Object.entries(stats) as [ProgressionId, { right: number; total: number }][])
    .map(([id, s]) => ({ id, name: progressionLabel(id), ...s }));
  const total = entries.reduce((n, e) => n + e.total, 0);
  if (!total) return "还没有进行记录。";
  const right = entries.reduce((n, e) => n + e.right, 0);
  const head = `进行累计 ${total} 题，一次答对 ${Math.round((right / total) * 100)}%`;
  const weakest = entries
    .filter((e) => e.right < e.total)
    .sort((a, b) => a.right / a.total - b.right / b.total || b.total - a.total || a.name.localeCompare(b.name, "zh"))[0];
  return weakest ? `${head}；最常错的是 ${weakest.name}（${weakest.right}/${weakest.total}）。` : `${head}。`;
}

type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;

export function readProgStats(storage: Storage): ProgStats {
  try {
    const raw = storage.getItem(PROG_STORE_KEY);
    return raw ? cleanProgStats(JSON.parse(raw)) : {};
  } catch {
    return {};
  }
}

export function writeProgStats(storage: Storage, stats: ProgStats): boolean {
  try {
    storage.setItem(PROG_STORE_KEY, JSON.stringify(stats));
    return true;
  } catch {
    return false;
  }
}
