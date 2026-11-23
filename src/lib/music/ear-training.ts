/**
 * 听音练耳（功能性练耳）：先奏 I–IV–V–I 定调，再奏一个音，按简谱级数作答；
 * 答对后从这个音一级一级走回最近的主音，帮耳朵记住每个级数「想去哪儿」。
 * Pure helpers only; the panel schedules the events on a local AudioContext.
 */
import { PC, type KeyName, type Mode } from "./theory.ts";

export const EAR_STORE_KEY = "puxian-ear-v1";
/** 听音练耳 counts as practice until this long after the last listen or answer. */
export const EAR_IDLE_MS = 60_000;

/** 1–7 are the scale degrees, 8 is the upper tonic (简谱 1̇). */
export type Degree = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export const EAR_LEVELS = [
  { id: "low", label: "1 2 3 4", degrees: [1, 2, 3, 4] },
  { id: "high", label: "5 6 7 1̇", degrees: [5, 6, 7, 8] },
  { id: "scale", label: "1–7 全部", degrees: [1, 2, 3, 4, 5, 6, 7] },
] as const satisfies readonly { id: string; label: string; degrees: readonly Degree[] }[];
export type EarLevelId = (typeof EAR_LEVELS)[number]["id"];

const MAJOR = [0, 2, 4, 5, 7, 9, 11, 12];
const MINOR = [0, 2, 3, 5, 7, 8, 10, 12];

export function degreeLabel(degree: Degree): string {
  return degree === 8 ? "1̇" : String(degree);
}

/** Tonic in the octave starting at C4 (60–71), so every level sits in a comfortable range. */
export function earTonic(key: KeyName): number {
  return 60 + PC[key];
}

export function degreePitch(tonic: number, mode: Mode, degree: Degree): number {
  return tonic + (mode === "minor" ? MINOR : MAJOR)[degree - 1];
}

/** I–IV–V–I (minor: i–iv–V–i with the raised leading tone), each with the tonic's bass under I. */
export function cadenceChords(tonic: number, mode: Mode): number[][] {
  const third = mode === "minor" ? 3 : 4;
  const sixth = mode === "minor" ? 8 : 9;
  const bass = tonic - 12;
  return [
    [bass, tonic, tonic + third, tonic + 7],
    [bass + 5, tonic, tonic + 5, tonic + sixth],
    [bass + 7, tonic - 1, tonic + 2, tonic + 7],
    [bass, tonic, tonic + third, tonic + 7],
  ];
}

/** Steps back to the nearest tonic: 2→1, 4→3→2→1, 5→6→7→1̇, 7→1̇. */
export function resolution(degree: Degree): Degree[] {
  if (degree === 1 || degree === 8) return [degree];
  if (degree <= 4) return Array.from({ length: degree }, (_, i) => (degree - i) as Degree);
  return Array.from({ length: 9 - degree }, (_, i) => (degree + i) as Degree);
}

export function levelOf(id: string) {
  return EAR_LEVELS.find((level) => level.id === id) ?? EAR_LEVELS[0];
}

/** A random degree from the level, never the same as the last question twice in a row. */
export function pickDegree(levelId: string, previous: Degree | null, random: () => number = Math.random): Degree {
  const pool: readonly Degree[] = levelOf(levelId).degrees;
  const choices = pool.length > 1 && previous != null ? pool.filter((d) => d !== previous) : pool;
  const index = Math.min(choices.length - 1, Math.floor(Math.max(0, random()) * choices.length));
  return choices[index];
}

export type EarEvent = { midi: number; when: number; dur: number; gain: number };

/** The question: cadence chords (0.6 s each), a breath, then the target note. */
export function questionEvents(tonic: number, mode: Mode, degree: Degree, withCadence = true): EarEvent[] {
  const events: EarEvent[] = [];
  let at = 0;
  if (withCadence) {
    for (const chord of cadenceChords(tonic, mode)) {
      for (const midi of chord) events.push({ midi, when: at, dur: 0.55, gain: 0.12 });
      at += 0.6;
    }
    at += 0.5;
  }
  events.push({ midi: degreePitch(tonic, mode, degree), when: at, dur: 0.9, gain: 0.3 });
  return events;
}

/** After a right answer: the note walking home to the tonic, the last one held. */
export function resolutionEvents(tonic: number, mode: Mode, degree: Degree): EarEvent[] {
  const steps = resolution(degree);
  return steps.map((step, i) => ({
    midi: degreePitch(tonic, mode, step),
    when: i * 0.38,
    dur: i === steps.length - 1 ? 0.8 : 0.34,
    gain: 0.28,
  }));
}

export function eventsLength(events: readonly EarEvent[]): number {
  return events.reduce((end, e) => Math.max(end, e.when + e.dur), 0);
}

/** Per-degree first-try results, kept on this device. */
export type EarStats = Partial<Record<Degree, { right: number; total: number }>>;

export function cleanEarStats(value: unknown): EarStats {
  const stats: EarStats = {};
  if (!value || typeof value !== "object") return stats;
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    const degree = Number(key);
    if (!Number.isInteger(degree) || degree < 1 || degree > 8 || !entry || typeof entry !== "object") continue;
    const { right, total } = entry as Record<string, unknown>;
    if (typeof right !== "number" || typeof total !== "number" || !Number.isInteger(right) || !Number.isInteger(total)) continue;
    if (total < 1 || right < 0 || right > total) continue;
    stats[degree as Degree] = { right, total };
  }
  return stats;
}

export function recordAnswer(stats: EarStats, degree: Degree, firstTryRight: boolean): EarStats {
  const before = stats[degree] ?? { right: 0, total: 0 };
  return { ...stats, [degree]: { right: before.right + (firstTryRight ? 1 : 0), total: before.total + 1 } };
}

/** "累计 36 题，一次答对 78%；最常错的是 4（2/5）。" */
export function earSummary(stats: EarStats): string {
  const entries = (Object.entries(stats) as [string, { right: number; total: number }][])
    .map(([d, s]) => ({ degree: Number(d) as Degree, ...s }));
  const total = entries.reduce((n, e) => n + e.total, 0);
  if (!total) return "还没有练耳记录。";
  const right = entries.reduce((n, e) => n + e.right, 0);
  const head = `累计 ${total} 题，一次答对 ${Math.round((right / total) * 100)}%`;
  const weakest = entries
    .filter((e) => e.right < e.total)
    .sort((a, b) => a.right / a.total - b.right / b.total || b.total - a.total || a.degree - b.degree)[0];
  return weakest ? `${head}；最常错的是 ${degreeLabel(weakest.degree)}（${weakest.right}/${weakest.total}）。` : `${head}。`;
}

type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;

export function readEarStats(storage: Storage): EarStats {
  try {
    const raw = storage.getItem(EAR_STORE_KEY);
    return raw ? cleanEarStats(JSON.parse(raw)) : {};
  } catch {
    return {};
  }
}

export function writeEarStats(storage: Storage, stats: EarStats): boolean {
  try {
    storage.setItem(EAR_STORE_KEY, JSON.stringify(stats));
    return true;
  } catch {
    return false;
  }
}
