/**
 * Scale-quality identification for 听音练耳 (Teoria-style idea).
 * Hear an ascending (or up-and-down) scale, answer by type.
 * Independent of degree, interval, chord and progression drills.
 */
import type { EarEvent } from "./ear-training.ts";

export type ScaleId =
  | "maj"
  | "natMin"
  | "harMin"
  | "melMin"
  | "dorian"
  | "phrygian"
  | "lydian"
  | "mixolydian"
  | "locrian"
  | "majPent"
  | "minPent"
  | "blues"
  | "whole";

export type ScaleDirection = "up" | "updown";

type ScaleDef = {
  id: ScaleId;
  up: readonly number[];
  down?: readonly number[];
  label: string;
  name: string;
};

export const SCALES: readonly ScaleDef[] = [
  { id: "maj", up: [0, 2, 4, 5, 7, 9, 11, 12], label: "大调", name: "大调音阶" },
  { id: "natMin", up: [0, 2, 3, 5, 7, 8, 10, 12], label: "自然小", name: "自然小调音阶" },
  { id: "harMin", up: [0, 2, 3, 5, 7, 8, 11, 12], label: "和声小", name: "和声小调音阶" },
  { id: "melMin", up: [0, 2, 3, 5, 7, 9, 11, 12], down: [12, 10, 8, 7, 5, 3, 2, 0], label: "旋律小", name: "旋律小调音阶" },
  { id: "dorian", up: [0, 2, 3, 5, 7, 9, 10, 12], label: "多利亚", name: "多利亚调式" },
  { id: "phrygian", up: [0, 1, 3, 5, 7, 8, 10, 12], label: "弗里吉亚", name: "弗里吉亚调式" },
  { id: "lydian", up: [0, 2, 4, 6, 7, 9, 11, 12], label: "利底亚", name: "利底亚调式" },
  { id: "mixolydian", up: [0, 2, 4, 5, 7, 9, 10, 12], label: "混合利", name: "混合利底亚调式" },
  { id: "locrian", up: [0, 1, 3, 5, 6, 8, 10, 12], label: "洛克里亚", name: "洛克里亚调式" },
  { id: "majPent", up: [0, 2, 4, 7, 9, 12], label: "大五声", name: "大调五声音阶" },
  { id: "minPent", up: [0, 3, 5, 7, 10, 12], label: "小五声", name: "小调五声音阶" },
  { id: "blues", up: [0, 3, 5, 6, 7, 10, 12], label: "布鲁斯", name: "布鲁斯音阶" },
  { id: "whole", up: [0, 2, 4, 6, 8, 10, 12], label: "全音", name: "全音阶" },
];

export const SCALE_LEVELS = [
  { id: "basic", label: "基础", ids: ["maj", "natMin", "harMin", "melMin"] },
  { id: "common", label: "常见", ids: ["maj", "natMin", "harMin", "melMin", "dorian", "phrygian", "lydian", "mixolydian"] },
  { id: "all", label: "全部", ids: SCALES.map((item) => item.id) },
] as const satisfies readonly { id: string; label: string; ids: readonly ScaleId[] }[];

export type ScaleLevelId = (typeof SCALE_LEVELS)[number]["id"];

export const SCALE_STORE_KEY = "puxian-ear-scale-v1";

/** Mid-range roots so the octave top stays at or below G5. */
export const SCALE_ROOT_LOW = 60;
export const SCALE_ROOT_ROOM = 8;

export function isScaleId(value: string | null | undefined): value is ScaleId {
  return SCALES.some((item) => item.id === value);
}

export function scaleOf(id: string) {
  return SCALES.find((item) => item.id === id) ?? SCALES[0];
}

export function scaleLevelOf(id: string) {
  return SCALE_LEVELS.find((level) => level.id === id) ?? SCALE_LEVELS[0];
}

export function pickScale(levelId: string, previous: ScaleId | null, random: () => number = Math.random): ScaleId {
  const pool = scaleLevelOf(levelId).ids;
  const choices = pool.length > 1 && previous != null ? pool.filter((id) => id !== previous) : pool;
  const index = Math.min(choices.length - 1, Math.floor(Math.max(0, random()) * choices.length));
  return choices[index];
}

export function pickScaleRoot(random: () => number = Math.random): number {
  return SCALE_ROOT_LOW + Math.min(SCALE_ROOT_ROOM - 1, Math.floor(Math.max(0, random()) * SCALE_ROOT_ROOM));
}

export function scalePitches(id: string, root: number, direction: ScaleDirection): number[] {
  const scale = scaleOf(id);
  const up = scale.up.map((step) => root + step);
  if (direction === "up") return up;
  const downSteps = scale.down ?? [...scale.up].reverse();
  const down = downSteps.map((step) => root + step);
  return [...up, ...down.slice(1)];
}

export function scaleQuestionEvents(pitches: readonly number[]): EarEvent[] {
  return pitches.map((midi, index) => ({ midi, when: index * 0.28, dur: 0.38, gain: 0.26 }));
}

export type ScaleStats = Partial<Record<ScaleId, { right: number; total: number }>>;

export function cleanScaleStats(value: unknown): ScaleStats {
  const stats: ScaleStats = {};
  if (!value || typeof value !== "object") return stats;
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (!isScaleId(key) || !entry || typeof entry !== "object") continue;
    const { right, total } = entry as Record<string, unknown>;
    if (typeof right !== "number" || typeof total !== "number" || !Number.isInteger(right) || !Number.isInteger(total)) continue;
    if (total < 1 || right < 0 || right > total) continue;
    stats[key] = { right, total };
  }
  return stats;
}

export function recordScaleAnswer(stats: ScaleStats, id: ScaleId, firstTryRight: boolean): ScaleStats {
  const before = stats[id] ?? { right: 0, total: 0 };
  return { ...stats, [id]: { right: before.right + (firstTryRight ? 1 : 0), total: before.total + 1 } };
}

export function scaleSummary(stats: ScaleStats): string {
  const entries = (Object.entries(stats) as [ScaleId, { right: number; total: number }][])
    .map(([id, s]) => ({ id, name: scaleOf(id).name, ...s }));
  const total = entries.reduce((n, e) => n + e.total, 0);
  if (!total) return "还没有音阶记录。";
  const right = entries.reduce((n, e) => n + e.right, 0);
  const head = `音阶累计 ${total} 题，一次答对 ${Math.round((right / total) * 100)}%`;
  const weakest = entries
    .filter((e) => e.right < e.total)
    .sort((a, b) => a.right / a.total - b.right / b.total || b.total - a.total || a.name.localeCompare(b.name, "zh"))[0];
  return weakest ? `${head}；最常错的是 ${weakest.name}（${weakest.right}/${weakest.total}）。` : `${head}。`;
}

type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;

export function readScaleStats(storage: Storage): ScaleStats {
  try {
    const raw = storage.getItem(SCALE_STORE_KEY);
    return raw ? cleanScaleStats(JSON.parse(raw)) : {};
  } catch {
    return {};
  }
}

export function writeScaleStats(storage: Storage, stats: ScaleStats): boolean {
  try {
    storage.setItem(SCALE_STORE_KEY, JSON.stringify(stats));
    return true;
  } catch {
    return false;
  }
}
