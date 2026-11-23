/**
 * Interval identification for 听音练耳 (Tenuto / musictheory.net idea).
 * Two tones, answer by interval name. Independent of the Functional Ear Trainer degree drill.
 */
import type { EarEvent } from "./ear-training.ts";

export type IntervalId =
  | "m2" | "M2" | "m3" | "M3" | "P4" | "TT" | "P5" | "m6" | "M6" | "m7" | "M7" | "P8";

export type IntervalStyle = "melodic" | "harmonic";

export const INTERVALS = [
  { id: "m2", semitones: 1, label: "小2", name: "小二度" },
  { id: "M2", semitones: 2, label: "大2", name: "大二度" },
  { id: "m3", semitones: 3, label: "小3", name: "小三度" },
  { id: "M3", semitones: 4, label: "大3", name: "大三度" },
  { id: "P4", semitones: 5, label: "纯4", name: "纯四度" },
  { id: "TT", semitones: 6, label: "增4", name: "增四度（三全音）" },
  { id: "P5", semitones: 7, label: "纯5", name: "纯五度" },
  { id: "m6", semitones: 8, label: "小6", name: "小六度" },
  { id: "M6", semitones: 9, label: "大6", name: "大六度" },
  { id: "m7", semitones: 10, label: "小7", name: "小七度" },
  { id: "M7", semitones: 11, label: "大7", name: "大七度" },
  { id: "P8", semitones: 12, label: "纯8", name: "纯八度" },
] as const satisfies readonly { id: IntervalId; semitones: number; label: string; name: string }[];

export const INTERVAL_LEVELS = [
  { id: "narrow", label: "二三度", ids: ["m2", "M2", "m3", "M3"] },
  { id: "common", label: "常见", ids: ["M2", "m3", "M3", "P4", "P5", "P8"] },
  { id: "all", label: "全部", ids: INTERVALS.map((item) => item.id) },
] as const satisfies readonly { id: string; label: string; ids: readonly IntervalId[] }[];

export type IntervalLevelId = (typeof INTERVAL_LEVELS)[number]["id"];

export const INTERVAL_STORE_KEY = "puxian-ear-interval-v1";

export function isIntervalId(value: string | null | undefined): value is IntervalId {
  return INTERVALS.some((item) => item.id === value);
}

export function intervalOf(id: string) {
  return INTERVALS.find((item) => item.id === id) ?? INTERVALS[0];
}

export function intervalLevelOf(id: string) {
  return INTERVAL_LEVELS.find((level) => level.id === id) ?? INTERVAL_LEVELS[0];
}

export function pickInterval(levelId: string, previous: IntervalId | null, random: () => number = Math.random): IntervalId {
  const pool = intervalLevelOf(levelId).ids;
  const choices = pool.length > 1 && previous != null ? pool.filter((id) => id !== previous) : pool;
  const index = Math.min(choices.length - 1, Math.floor(Math.max(0, random()) * choices.length));
  return choices[index];
}

/** Comfortable mid range (C4 up), so the upper note stays at or below C5 + a little. */
export function pickIntervalPair(semitones: number, random: () => number = Math.random): { low: number; high: number } {
  const span = Math.max(0, Math.round(semitones));
  const room = Math.max(1, 13 - span);
  const low = 60 + Math.min(room - 1, Math.floor(Math.max(0, random()) * room));
  return { low, high: low + span };
}

export function intervalQuestionEvents(low: number, high: number, style: IntervalStyle): EarEvent[] {
  if (style === "harmonic") {
    return [
      { midi: low, when: 0, dur: 1, gain: 0.24 },
      { midi: high, when: 0, dur: 1, gain: 0.24 },
    ];
  }
  return [
    { midi: low, when: 0, dur: 0.7, gain: 0.3 },
    { midi: high, when: 0.85, dur: 0.7, gain: 0.3 },
  ];
}

export type IntervalStats = Partial<Record<IntervalId, { right: number; total: number }>>;

export function cleanIntervalStats(value: unknown): IntervalStats {
  const stats: IntervalStats = {};
  if (!value || typeof value !== "object") return stats;
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (!isIntervalId(key) || !entry || typeof entry !== "object") continue;
    const { right, total } = entry as Record<string, unknown>;
    if (typeof right !== "number" || typeof total !== "number" || !Number.isInteger(right) || !Number.isInteger(total)) continue;
    if (total < 1 || right < 0 || right > total) continue;
    stats[key] = { right, total };
  }
  return stats;
}

export function recordIntervalAnswer(stats: IntervalStats, id: IntervalId, firstTryRight: boolean): IntervalStats {
  const before = stats[id] ?? { right: 0, total: 0 };
  return { ...stats, [id]: { right: before.right + (firstTryRight ? 1 : 0), total: before.total + 1 } };
}

export function intervalSummary(stats: IntervalStats): string {
  const entries = (Object.entries(stats) as [IntervalId, { right: number; total: number }][])
    .map(([id, s]) => ({ id, name: intervalOf(id).name, ...s }));
  const total = entries.reduce((n, e) => n + e.total, 0);
  if (!total) return "还没有音程记录。";
  const right = entries.reduce((n, e) => n + e.right, 0);
  const head = `音程累计 ${total} 题，一次答对 ${Math.round((right / total) * 100)}%`;
  const weakest = entries
    .filter((e) => e.right < e.total)
    .sort((a, b) => a.right / a.total - b.right / b.total || b.total - a.total || a.name.localeCompare(b.name, "zh"))[0];
  return weakest ? `${head}；最常错的是 ${weakest.name}（${weakest.right}/${weakest.total}）。` : `${head}。`;
}

type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;

export function readIntervalStats(storage: Storage): IntervalStats {
  try {
    const raw = storage.getItem(INTERVAL_STORE_KEY);
    return raw ? cleanIntervalStats(JSON.parse(raw)) : {};
  } catch {
    return {};
  }
}

export function writeIntervalStats(storage: Storage, stats: IntervalStats): boolean {
  try {
    storage.setItem(INTERVAL_STORE_KEY, JSON.stringify(stats));
    return true;
  } catch {
    return false;
  }
}
