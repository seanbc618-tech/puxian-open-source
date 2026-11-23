/**
 * Mid-score tempo marks (途中速度): set a new ♩= from a selected note or rest.
 * Playback already follows Score.changes; this module is the editor API.
 * Idea from MuseScore "Tempo markings" (metronome marks that change pace);
 * no upstream code, brand, copy, or assets. See docs/tempo-mark.md.
 */
import type { Score, ScoreChange } from "./theory.ts";
import { CHANGE_BPM_MAX, CHANGE_BPM_MIN, clampChangeBpm, nextBar } from "./score-timeline.ts";

const EPS = 1e-6;

export { CHANGE_BPM_MAX, CHANGE_BPM_MIN, clampChangeBpm };

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

/** Running tempo at a written position, including the opening value. */
export function tempoAt(score: Pick<Score, "bpm" | "changes">, at: number): number {
  let bpm = score.bpm;
  for (const change of score.changes ?? []) {
    if (change.at > at + EPS) break;
    if (change.bpm !== undefined) bpm = change.bpm;
  }
  return bpm;
}

/** True when a written change with a bpm sits exactly at this onset (not merely inherited). */
export function hasTempoMark(score: Pick<Score, "changes">, at: number): boolean {
  return (score.changes ?? []).some((change) => change.bpm !== undefined && almost(change.at, at));
}

export function tempoMarks(score: Pick<Score, "changes">): { at: number; bpm: number }[] {
  return (score.changes ?? [])
    .filter((change): change is ScoreChange & { bpm: number } => change.bpm !== undefined)
    .map((change) => ({ at: change.at, bpm: change.bpm }));
}

export function tempoMarkSummary(score: Score): string {
  return tempoMarks(score)
    .map((mark) => `第 ${barNumberAt(score, mark.at)} 小节 ♩=${mark.bpm}`)
    .join("、");
}

/**
 * Set a metronome mark at `at` quarter notes.
 * A mark at the very start updates the opening `score.bpm` (changes must stay at > 0).
 * Merges with an existing key or meter change at the same position.
 */
export function setTempoChange(score: Score, at: number, bpm: number): Score {
  const when = roundedAt(at);
  const value = clampChangeBpm(bpm);
  if (when <= EPS) return { ...score, bpm: value };
  const changes = [...(score.changes ?? [])];
  const index = changes.findIndex((change) => almost(change.at, when));
  if (index >= 0) changes[index] = { ...changes[index], bpm: value };
  else changes.push({ at: when, bpm: value });
  return withChanges(score, changes);
}

/**
 * Remove only the tempo of a mid-score change at `at`.
 * Key or meter at the same position is kept. The opening tempo is left alone.
 */
export function clearTempoChange(score: Score, at: number): Score {
  const when = roundedAt(at);
  if (when <= EPS) return score;
  const changes = (score.changes ?? []).map((change) => {
    if (!almost(change.at, when)) return change;
    const next = { ...change };
    delete next.bpm;
    return next;
  });
  return withChanges(score, changes);
}
