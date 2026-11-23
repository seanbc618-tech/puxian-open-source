/**
 * Mid-score time signatures (途中拍号): set a new meter from the bar that
 * holds a selected note or rest. Playback already follows Score.changes;
 * this module is the editor API.
 * Idea from MuseScore "Time signatures" (a new meter from a chosen note);
 * no upstream code, brand, copy, or assets. See docs/meter-mark.md.
 */
import type { Score, ScoreChange } from "./theory.ts";
import {
  CHANGE_BEATS_MAX,
  CHANGE_BEAT_UNITS,
  clampChangeBeats,
  changeBeatUnit,
  meterAt,
  nextBar,
} from "./score-timeline.ts";

const EPS = 1e-6;

export { CHANGE_BEATS_MAX, CHANGE_BEAT_UNITS, clampChangeBeats, changeBeatUnit, meterAt };

/** Common meters offered in the editor; any in-range imported meter stays selectable. */
export const METER_CHOICES = ["2/4", "3/4", "4/4", "5/4", "3/8", "6/8", "9/8", "12/8", "2/2"] as const;

export function meterLabel(beats: number, beatUnit: number): string {
  return `${beats}/${beatUnit}`;
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

/** Meter inherited from strictly before `at` (a mark at `at` itself is ignored). */
export function meterBefore(score: Pick<Score, "beats" | "beatUnit" | "changes">, at: number): { beats: number; beatUnit: number } {
  let beats = score.beats;
  let beatUnit = score.beatUnit;
  for (const change of score.changes ?? []) {
    if (change.at > at - EPS) break;
    if (change.beats !== undefined) {
      beats = change.beats;
      beatUnit = change.beatUnit!;
    }
  }
  return { beats, beatUnit };
}

/** True when a written change with a meter sits exactly at this onset (not merely inherited). */
export function hasMeterMark(score: Pick<Score, "changes">, at: number): boolean {
  return (score.changes ?? []).some((change) => change.beats !== undefined && almost(change.at, at));
}

export function meterMarks(score: Pick<Score, "changes">): { at: number; beats: number; beatUnit: number }[] {
  return (score.changes ?? [])
    .filter((change): change is ScoreChange & { beats: number; beatUnit: number } => change.beats !== undefined)
    .map((change) => ({ at: change.at, beats: change.beats, beatUnit: change.beatUnit! }));
}

export function meterMarkSummary(score: Score): string {
  return meterMarks(score)
    .map((mark) => `第 ${barNumberAt(score, mark.at)} 小节 ${meterLabel(mark.beats, mark.beatUnit)}`)
    .join("、");
}

/**
 * Set a time signature on the bar that contains `at`.
 * A mark at the very start updates the opening meter (changes must stay at > 0).
 * Merges with an existing tempo or key change at the same position.
 * If the new meter matches the meter already in force just before this bar,
 * any meter written here is cleared instead of restating it.
 */
export function setMeterChange(score: Score, at: number, beats: number, beatUnit: number): Score {
  const when = barStartAt(score, roundedAt(at));
  const value = { beats: clampChangeBeats(beats), beatUnit: changeBeatUnit(beatUnit) };
  if (when <= EPS) return { ...score, beats: value.beats, beatUnit: value.beatUnit };
  const prev = meterBefore(score, when);
  if (prev.beats === value.beats && prev.beatUnit === value.beatUnit) {
    return clearMeterChange(score, when);
  }
  const changes = [...(score.changes ?? [])];
  const index = changes.findIndex((change) => almost(change.at, when));
  if (index >= 0) changes[index] = { ...changes[index], beats: value.beats, beatUnit: value.beatUnit };
  else changes.push({ at: when, beats: value.beats, beatUnit: value.beatUnit });
  return withChanges(score, changes);
}

/**
 * Remove only the meter of a mid-score change at `at`.
 * Tempo or key at the same position is kept. The opening meter is left alone.
 */
export function clearMeterChange(score: Score, at: number): Score {
  const when = barStartAt(score, roundedAt(at));
  if (when <= EPS) return score;
  const changes = (score.changes ?? []).map((change) => {
    if (!almost(change.at, when)) return change;
    const next = { ...change };
    delete next.beats;
    delete next.beatUnit;
    return next;
  });
  return withChanges(score, changes);
}
