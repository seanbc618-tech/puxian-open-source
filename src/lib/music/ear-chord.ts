/**
 * Chord-quality identification for 听音练耳 (Teoria-style idea).
 * Hear a block or broken chord, answer by quality. Independent of degree and interval drills.
 */
import type { EarEvent } from "./ear-training.ts";

export type ChordId = "maj" | "min" | "dim" | "aug" | "dom7" | "m7" | "maj7" | "m7b5" | "dim7";

export type ChordStyle = "block" | "arpeggio";

export const CHORDS = [
  { id: "maj", intervals: [0, 4, 7], label: "大三", name: "大三和弦" },
  { id: "min", intervals: [0, 3, 7], label: "小三", name: "小三和弦" },
  { id: "dim", intervals: [0, 3, 6], label: "减三", name: "减三和弦" },
  { id: "aug", intervals: [0, 4, 8], label: "增三", name: "增三和弦" },
  { id: "dom7", intervals: [0, 4, 7, 10], label: "属七", name: "属七和弦" },
  { id: "m7", intervals: [0, 3, 7, 10], label: "小七", name: "小七和弦" },
  { id: "maj7", intervals: [0, 4, 7, 11], label: "大七", name: "大七和弦" },
  { id: "m7b5", intervals: [0, 3, 6, 10], label: "半减", name: "半减七和弦" },
  { id: "dim7", intervals: [0, 3, 6, 9], label: "减七", name: "减七和弦" },
] as const satisfies readonly { id: ChordId; intervals: readonly number[]; label: string; name: string }[];

export const CHORD_LEVELS = [
  { id: "triads", label: "三和弦", ids: ["maj", "min", "dim", "aug"] },
  { id: "common", label: "常见", ids: ["maj", "min", "dim", "aug", "dom7", "m7", "maj7"] },
  { id: "all", label: "全部", ids: CHORDS.map((item) => item.id) },
] as const satisfies readonly { id: string; label: string; ids: readonly ChordId[] }[];

export type ChordLevelId = (typeof CHORD_LEVELS)[number]["id"];

export const CHORD_STORE_KEY = "puxian-ear-chord-v1";

/** Mid-range roots so the top note of a major seventh stays at or below F#5. */
export const CHORD_ROOT_LOW = 60;
export const CHORD_ROOT_ROOM = 8;

export function isChordId(value: string | null | undefined): value is ChordId {
  return CHORDS.some((item) => item.id === value);
}

export function chordOf(id: string) {
  return CHORDS.find((item) => item.id === id) ?? CHORDS[0];
}

export function chordLevelOf(id: string) {
  return CHORD_LEVELS.find((level) => level.id === id) ?? CHORD_LEVELS[0];
}

export function pickChord(levelId: string, previous: ChordId | null, random: () => number = Math.random): ChordId {
  const pool = chordLevelOf(levelId).ids;
  const choices = pool.length > 1 && previous != null ? pool.filter((id) => id !== previous) : pool;
  const index = Math.min(choices.length - 1, Math.floor(Math.max(0, random()) * choices.length));
  return choices[index];
}

export function pickChordRoot(id: string, random: () => number = Math.random): number {
  const span = chordOf(id).intervals[chordOf(id).intervals.length - 1] ?? 0;
  const room = Math.max(1, CHORD_ROOT_ROOM - Math.max(0, span - 11));
  return CHORD_ROOT_LOW + Math.min(room - 1, Math.floor(Math.max(0, random()) * room));
}

export function chordPitches(id: string, root: number): number[] {
  return chordOf(id).intervals.map((step) => root + step);
}

export function chordQuestionEvents(pitches: readonly number[], style: ChordStyle): EarEvent[] {
  const gain = pitches.length > 3 ? 0.16 : 0.2;
  if (style === "block") {
    return pitches.map((midi) => ({ midi, when: 0, dur: 1.1, gain }));
  }
  return pitches.map((midi, index) => ({ midi, when: index * 0.4, dur: 0.5, gain: 0.28 }));
}

export type ChordStats = Partial<Record<ChordId, { right: number; total: number }>>;

export function cleanChordStats(value: unknown): ChordStats {
  const stats: ChordStats = {};
  if (!value || typeof value !== "object") return stats;
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (!isChordId(key) || !entry || typeof entry !== "object") continue;
    const { right, total } = entry as Record<string, unknown>;
    if (typeof right !== "number" || typeof total !== "number" || !Number.isInteger(right) || !Number.isInteger(total)) continue;
    if (total < 1 || right < 0 || right > total) continue;
    stats[key] = { right, total };
  }
  return stats;
}

export function recordChordAnswer(stats: ChordStats, id: ChordId, firstTryRight: boolean): ChordStats {
  const before = stats[id] ?? { right: 0, total: 0 };
  return { ...stats, [id]: { right: before.right + (firstTryRight ? 1 : 0), total: before.total + 1 } };
}

export function chordSummary(stats: ChordStats): string {
  const entries = (Object.entries(stats) as [ChordId, { right: number; total: number }][])
    .map(([id, s]) => ({ id, name: chordOf(id).name, ...s }));
  const total = entries.reduce((n, e) => n + e.total, 0);
  if (!total) return "还没有和弦记录。";
  const right = entries.reduce((n, e) => n + e.right, 0);
  const head = `和弦累计 ${total} 题，一次答对 ${Math.round((right / total) * 100)}%`;
  const weakest = entries
    .filter((e) => e.right < e.total)
    .sort((a, b) => a.right / a.total - b.right / b.total || b.total - a.total || a.name.localeCompare(b.name, "zh"))[0];
  return weakest ? `${head}；最常错的是 ${weakest.name}（${weakest.right}/${weakest.total}）。` : `${head}。`;
}

type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;

export function readChordStats(storage: Storage): ChordStats {
  try {
    const raw = storage.getItem(CHORD_STORE_KEY);
    return raw ? cleanChordStats(JSON.parse(raw)) : {};
  } catch {
    return {};
  }
}

export function writeChordStats(storage: Storage, stats: ChordStats): boolean {
  try {
    storage.setItem(CHORD_STORE_KEY, JSON.stringify(stats));
    return true;
  } catch {
    return false;
  }
}
