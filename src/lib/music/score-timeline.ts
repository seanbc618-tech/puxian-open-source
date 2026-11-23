import type { Score, ScoreChange } from './theory.ts';

/** Mid-score change ranges; match MIDI import normalization so every importer and storage agree. */
export const CHANGE_BPM_MIN = 40;
export const CHANGE_BPM_MAX = 220;
export const CHANGE_BEATS_MAX = 12;
export const CHANGE_BEAT_UNITS: readonly number[] = [2, 4, 8, 16];
export const clampChangeBpm = (bpm: number) => Math.min(CHANGE_BPM_MAX, Math.max(CHANGE_BPM_MIN, Math.round(bpm)));
export const clampChangeBeats = (beats: number) => Math.min(CHANGE_BEATS_MAX, Math.max(1, Math.round(beats)));
export const changeBeatUnit = (unit: number) => (CHANGE_BEAT_UNITS.includes(unit) ? unit : 4);

export type Timeline = Pick<Score, 'bpm' | 'beats' | 'beatUnit' | 'key' | 'mode' | 'changes'>;
export function stateAt(score: Timeline, at: number) {
  const state = { bpm: score.bpm, beats: score.beats, beatUnit: score.beatUnit, key: score.key, mode: score.mode };
  for (const change of score.changes ?? []) {
    if (change.at > at + 1e-8) break;
    if (change.bpm !== undefined) state.bpm = change.bpm;
    if (change.beats !== undefined) {
      state.beats = change.beats;
      state.beatUnit = change.beatUnit!;
    }
    if (change.key !== undefined) {
      state.key = change.key;
      state.mode = change.mode!;
    }
  }
  return state;
}
export function meterAt(score: Pick<Score, 'beats' | 'beatUnit' | 'changes'>, at: number) {
  const state = { beats: score.beats, beatUnit: score.beatUnit };
  for (const change of score.changes ?? []) {
    if (change.at > at + 1e-8) break;
    if (change.beats !== undefined) {
      state.beats = change.beats;
      state.beatUnit = change.beatUnit!;
    }
  }
  return state;
}
/** Meter changes end the current (possibly short) measure and reset beat one. */
export function nextBar(score: Pick<Score, 'beats' | 'beatUnit' | 'changes' | 'measureEnds'>, at: number): number {
  const sourceEnd = score.measureEnds?.find(end => end > at + 1e-8);
  if (sourceEnd !== undefined) return sourceEnd;
  let origin = score.measureEnds?.at(-1) ?? 0, beats = score.beats, unit = score.beatUnit;
  let next = Infinity;
  for (const c of score.changes ?? []) {
    if (c.beats === undefined) continue;
    if (c.at > at + 1e-8) { next = c.at; break; }
    origin = Math.max(origin, c.at); beats = c.beats; unit = c.beatUnit!;
  }
  const length = beats * 4 / unit;
  return Math.min(next, origin + (Math.floor((at - origin + 1e-8) / length) + 1) * length);
}
export function nextChange(score: Pick<Score, 'changes'>, at: number): number {
  return score.changes?.find(c => c.at > at + 1e-8)?.at ?? Infinity;
}
/** Stable first-wins per property at a position; first event becomes the opening value. */
export function canonicalChanges(events: ScoreChange[]): ScoreChange[] {
  const seen = new Set<string>();
  const opened = new Set<string>();
  const result = new Map<number, ScoreChange>();
  for (const e of [...events].sort((a,b) => a.at - b.at)) {
    for (const fields of [['bpm'], ['beats','beatUnit'], ['key','mode']] as const) {
      if (e[fields[0]] === undefined || seen.has(`${e.at}:${fields[0]}`)) continue;
      seen.add(`${e.at}:${fields[0]}`);
      const at = opened.has(fields[0]) ? e.at : 0;
      opened.add(fields[0]);
      const dest = result.get(at) ?? { at };
      for (const field of fields) Object.assign(dest, { [field]: e[field] });
      result.set(at, dest);
    }
  }
  return [...result.values()].sort((a,b) => a.at-b.at);
}

const nearly = (a: number, b: number) => Math.abs(a - b) < 1e-8;
function durationOf(notes: { dur: number }[]): number {
  return notes.reduce((sum, note) => sum + (Number.isFinite(note.dur) && note.dur > 0 ? note.dur : 0), 0);
}

/**
 * Remap a score-level change map after one voice's notes are rewritten.
 * Common prefix/suffix (by duration) stay put; events inside the replaced span are dropped;
 * events at or after the old suffix are shifted by the span's duration delta.
 * Events that would land at or before 0 are dropped.
 * Callers should skip this when the other voice still has written time, because
 * changes are shared across voices.
 */
export function remapChangesForNotes(
  changes: ScoreChange[] | undefined,
  oldNotes: { dur: number }[],
  newNotes: { dur: number }[],
): ScoreChange[] | undefined {
  if (!changes?.length) return changes;
  let prefix = 0;
  while (
    prefix < oldNotes.length &&
    prefix < newNotes.length &&
    nearly(oldNotes[prefix].dur, newNotes[prefix].dur)
  ) {
    prefix += 1;
  }
  let suffix = 0;
  const oldRemain = oldNotes.length - prefix;
  const newRemain = newNotes.length - prefix;
  while (
    suffix < oldRemain &&
    suffix < newRemain &&
    nearly(oldNotes[oldNotes.length - 1 - suffix].dur, newNotes[newNotes.length - 1 - suffix].dur)
  ) {
    suffix += 1;
  }
  const midStart = durationOf(oldNotes.slice(0, prefix));
  const oldMidEnd = durationOf(oldNotes) - durationOf(suffix ? oldNotes.slice(-suffix) : []);
  const newMidEnd = durationOf(newNotes) - durationOf(suffix ? newNotes.slice(-suffix) : []);
  const shift = newMidEnd - oldMidEnd;
  const next: ScoreChange[] = [];
  for (const change of changes) {
    if (change.at < midStart - 1e-8) {
      next.push(change);
      continue;
    }
    if (change.at < oldMidEnd - 1e-8) continue;
    const at = change.at + shift;
    if (at > 1e-8) next.push({ ...change, at });
  }
  return next.length ? next : undefined;
}
