/**
 * Mid-score key changes (途中转调): set a new 1=X from the bar that
 * holds a selected note or rest. Playback, MIDI, range spelling and
 * transpose already follow Score.changes; this module is the editor API.
 * Idea from MuseScore "Key signatures" (a new key from a chosen note);
 * no upstream code, brand, copy, or assets. See docs/key-mark.md.
 */
import { writtenJianpuKey } from "./jianpu-key.ts";
import { nextBar } from "./score-timeline.ts";
import {
  KEY_NAMES,
  isKeyName,
  type KeyName,
  type Mode,
  type Score,
  type ScoreChange,
} from "./theory.ts";

const EPS = 1e-6;

export { KEY_NAMES, isKeyName };

/** Local copy so theory.modeName is not added to the score-core export list. */
export function modeName(mode: Mode): string {
  return mode === "major" ? "大调" : "小调";
}

export function keyMarkLabel(key: KeyName): string {
  return `1=${writtenJianpuKey(key)}`;
}

function almost(a: number, b: number) {
  return Math.abs(a - b) <= EPS;
}

function roundedAt(at: number) {
  return Math.round(Math.max(0, at) * 1e6) / 1e6;
}

function isEmptyChange(change: ScoreChange) {
  return change.bpm === undefined && change.beats === undefined && change.key === undefined;
}

function withChanges(score: Score, changes: ScoreChange[]): Score {
  const next = changes
    .filter((change) => change.at > EPS && !isEmptyChange(change))
    .sort((a, b) => a.at - b.at);
  const out: Score = { ...score };
  if (next.length) out.changes = next;
  else delete out.changes;
  return out;
}

/** Start of the bar that contains `at`, following mid-score meter changes. */
export function barStartAt(score: Pick<Score, "beats" | "beatUnit" | "changes">, at: number): number {
  if (!(at > EPS)) return 0;
  let t = 0;
  for (let n = 0; n < 400; n += 1) {
    const nxt = nextBar(score, t);
    if (!Number.isFinite(nxt) || nxt <= t + EPS) return t;
    if (at < nxt - EPS) return t;
    t = nxt;
  }
  return t;
}

/** Bar number (1-based) of a quarter-note position, following mid-score meter changes. */
export function barNumberAt(score: Pick<Score, "beats" | "beatUnit" | "changes">, at: number): number {
  if (!(at > EPS)) return 1;
  let t = 0;
  let n = 1;
  while (n < 400) {
    const nxt = nextBar(score, t);
    if (!Number.isFinite(nxt) || nxt <= t + EPS) break;
    if (at < nxt - EPS) return n;
    t = nxt;
    n += 1;
  }
  return n;
}

/** Key inherited from strictly before `at` (a mark at `at` itself is ignored). */
export function keyBefore(score: Pick<Score, "key" | "mode" | "changes">, at: number): { key: KeyName; mode: Mode } {
  let key = score.key;
  let mode = score.mode;
  for (const change of score.changes ?? []) {
    if (change.at > at - EPS) break;
    if (change.key !== undefined) {
      key = change.key;
      mode = change.mode!;
    }
  }
  return { key, mode };
}

/** Running key at a written position, including a mark that sits exactly here. */
export function keyAt(score: Pick<Score, "key" | "mode" | "changes">, at: number): { key: KeyName; mode: Mode } {
  let key = score.key;
  let mode = score.mode;
  for (const change of score.changes ?? []) {
    if (change.at > at + EPS) break;
    if (change.key !== undefined) {
      key = change.key;
      mode = change.mode!;
    }
  }
  return { key, mode };
}

/** True when a written change with a key sits exactly at this onset (not merely inherited). */
export function hasKeyMark(score: Pick<Score, "changes">, at: number): boolean {
  return (score.changes ?? []).some((change) => change.key !== undefined && almost(change.at, at));
}

export function keyMarks(score: Pick<Score, "changes">): { at: number; key: KeyName; mode: Mode }[] {
  return (score.changes ?? [])
    .filter((change): change is ScoreChange & { key: KeyName; mode: Mode } => change.key !== undefined)
    .map((change) => ({ at: change.at, key: change.key, mode: change.mode! }));
}

export function keyMarkSummary(score: Score): string {
  return keyMarks(score)
    .map((mark) => `第 ${barNumberAt(score, mark.at)} 小节 ${keyMarkLabel(mark.key)}（${modeName(mark.mode)}）`)
    .join("、");
}

/**
 * Set a key signature on the bar that contains `at`.
 * A mark at the very start updates the opening key (changes must stay at > 0).
 * Merges with an existing tempo or meter change at the same position.
 * If the new key matches the key already in force just before this bar,
 * any key written here is cleared instead of restating it.
 */
export function setKeyChange(score: Score, at: number, key: KeyName, mode: Mode): Score {
  const when = barStartAt(score, roundedAt(at));
  const value = { key: isKeyName(key) ? key : "C", mode: mode === "minor" ? "minor" : "major" } as const;
  if (when <= EPS) return { ...score, key: value.key, mode: value.mode };
  const prev = keyBefore(score, when);
  if (prev.key === value.key && prev.mode === value.mode) {
    return clearKeyChange(score, when);
  }
  const changes = [...(score.changes ?? [])];
  const index = changes.findIndex((change) => almost(change.at, when));
  if (index >= 0) changes[index] = { ...changes[index], key: value.key, mode: value.mode };
  else changes.push({ at: when, key: value.key, mode: value.mode });
  return withChanges(score, changes);
}

/**
 * Remove only the key of a mid-score change at `at`.
 * Tempo or meter at the same position is kept. The opening key is left alone.
 */
export function clearKeyChange(score: Score, at: number): Score {
  const when = barStartAt(score, roundedAt(at));
  if (when <= EPS) return score;
  const changes = (score.changes ?? []).map((change) => {
    if (!almost(change.at, when)) return change;
    const next = { ...change };
    delete next.key;
    delete next.mode;
    return next;
  });
  return withChanges(score, changes);
}
