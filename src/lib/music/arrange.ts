import { voiceList, voiceNotes as getVoiceNotes, replaceVoice as setVoiceNotes } from "./voices.ts";
import { withoutSpans } from "./expression.ts";
import { remapChangesForNotes } from "./score-timeline.ts";
import {
  PC,
  PLAYABLE_HIGH,
  PLAYABLE_LOW,
  stepsFor,
  type KeyName,
  type Mode,
  type Score,
  type ScoreNote,
} from "./theory.ts";

export const ARRANGE_STYLES = [
  { id: "lively", label: "活泼", detail: "邻音和经过音" },
  { id: "playful", label: "俏皮", detail: "空拍和邻音" },
  { id: "lyrical", label: "抒情", detail: "跳进前的经过音" },
] as const;

export type ArrangeStyle = (typeof ARRANGE_STYLES)[number]["id"];

/** Shown next to the style controls. Arrangement never rebuilds the harmony. */
export const ARRANGE_LIMIT = "这是轻改编：只加经过音、邻音或切分，不重新配和声。";

const EPS = 1e-6;

function mod12(value: number): number {
  return ((value % 12) + 12) % 12;
}

function inScale(midi: number, key: KeyName, mode: Mode): boolean {
  return stepsFor(mode).includes(mod12(midi - PC[key]));
}

/** Step `delta` scale degrees. Positive is up. Null when the step leaves the piano. */
function moveScale(midi: number, delta: number, key: KeyName, mode: Mode): number | null {
  if (!Number.isFinite(midi) || !inScale(midi, key, mode)) return null;
  if (delta === 0) return midi;
  const steps = stepsFor(mode);
  const tonic = PC[key];
  const dir = Math.sign(delta);
  let left = Math.abs(delta);
  let cursor = midi;
  while (left > 0) {
    cursor += dir;
    if (cursor < PLAYABLE_LOW || cursor > PLAYABLE_HIGH) return null;
    if (steps.includes(mod12(cursor - tonic))) left -= 1;
  }
  return cursor;
}

/** Signed scale-step distance. Null when either pitch is chromatic. */
function scaleDistance(from: number, to: number, key: KeyName, mode: Mode): number | null {
  if (!inScale(from, key, mode) || !inScale(to, key, mode)) return null;
  if (from === to) return 0;
  const dir = Math.sign(to - from);
  const steps = stepsFor(mode);
  const tonic = PC[key];
  let cursor = from;
  let dist = 0;
  while (cursor !== to && dist <= 24) {
    cursor += dir;
    if (steps.includes(mod12(cursor - tonic))) dist += 1;
  }
  if (cursor !== to) return null;
  return dist * dir;
}

function ornamentNeighbor(midi: number, key: KeyName, mode: Mode): number | null {
  return moveScale(midi, 1, key, mode) ?? moveScale(midi, -1, key, mode);
}

function passingTone(midi: number, dist: number | null, key: KeyName, mode: Mode): number | null {
  if (dist == null || Math.abs(dist) < 2) return null;
  return moveScale(midi, Math.sign(dist), key, mode);
}

function make(pitches: number[], dur: number): ScoreNote {
  return { pitches, dur: Math.round(dur * 12) / 12 };
}

function beatLength(score: Score): number {
  return 4 / score.beatUnit;
}

/** True when half a beat is a whole number of 1/48 notes, so Jianpu can spell the split. */
function canSplitBeat(beatLen: number): boolean {
  if (!Number.isFinite(beatLen) || beatLen <= 0) return false;
  const units = (beatLen / 2) * 12;
  return units >= 1 - EPS && Math.abs(units - Math.round(units)) < EPS;
}

function onBeat(pos: number, beatLen: number): boolean {
  const mod = ((pos % beatLen) + beatLen) % beatLen;
  return mod < EPS || beatLen - mod < EPS;
}

function wholeBeats(dur: number, beatLen: number): number | null {
  if (!Number.isFinite(dur) || dur <= 0) return null;
  const count = dur / beatLen;
  const rounded = Math.round(count);
  if (rounded < 1 || Math.abs(count - rounded) > EPS) return null;
  return rounded;
}

function withLastBeat(pitch: number, beats: number, beatLen: number, second: number): ScoreNote[] {
  const half = beatLen / 2;
  const head = beats - 1;
  const pair = [make([pitch], half), make([second], half)];
  if (head === 0) return pair;
  return [make([pitch], head * beatLen), ...pair];
}

function withFirstBeat(
  pitch: number,
  beats: number,
  beatLen: number,
  first: number | null,
  second: number,
): ScoreNote[] {
  const half = beatLen / 2;
  const tail = beats - 1;
  const pair = [make(first == null ? [] : [first], half), make([second], half)];
  if (tail === 0) return pair;
  return [...pair, make([pitch], tail * beatLen)];
}

/**
 * Strong beats inside one bar get the offbeat rest; the others get a neighbor.
 * The count restarts every bar (`beats` in the time signature), so bar 2 beat 1
 * matches bar 1 beat 1.
 *
 * - Compound eighth meters (3/8, 6/8, 9/8, 12/8): groups of three. The first
 *   eighth of each group is strong (6/8: eighths 1 and 4).
 * - Other odd meters (3/4, 5/4, 3/2): only the downbeat is strong.
 * - Even simple meters (2/4, 4/4, 2/2): beats 1, 3, 5… of the bar are strong.
 */
function playfulStrong(
  pos: number,
  beatLen: number,
  beatsPerBar: number,
  beatUnit: number,
): boolean {
  const perBar = Math.max(1, Math.round(beatsPerBar));
  const index = Math.round(pos / beatLen);
  const inBar = ((index % perBar) + perBar) % perBar;
  if (beatUnit === 8 && perBar % 3 === 0) return inBar % 3 === 0;
  if (perBar % 2 === 1) return inBar === 0;
  return inBar % 2 === 0;
}

function rewrite(
  style: ArrangeStyle,
  pitch: number,
  beats: number,
  beatLen: number,
  dist: number | null,
  strong: boolean,
  key: KeyName,
  mode: Mode,
): ScoreNote[] | null {
  if (style === "playful") {
    if (strong) return withFirstBeat(pitch, beats, beatLen, null, pitch);
    const neighbor = ornamentNeighbor(pitch, key, mode);
    if (neighbor == null) return null;
    return withFirstBeat(pitch, beats, beatLen, neighbor, pitch);
  }
  if (style === "lyrical") {
    const passing = passingTone(pitch, dist, key, mode);
    if (passing == null) return null;
    return withLastBeat(pitch, beats, beatLen, passing);
  }
  const second = passingTone(pitch, dist, key, mode) ?? ornamentNeighbor(pitch, key, mode);
  if (second == null) return null;
  return withLastBeat(pitch, beats, beatLen, second);
}

/**
 * Light monophonic arrangement of one voice.
 * `voice` defaults to voice 1. The other voice is copied through untouched.
 * Key, meter, tempo, clef, and that voice's total length stay put. Chords, rests,
 * chromatic notes, and notes that do not start on a beat are copied through.
 * Each edit splits one beat into two equal halves so Jianpu and ABC can round-trip it.
 * Returns the same score when nothing changes.
 */
export function arrangeScore(score: Score, style: ArrangeStyle, voice: number = 0): Score {
  const source = getVoiceNotes(score, voice);
  if (!source) return score;
  const beatLen = beatLength(score);
  if (!canSplitBeat(beatLen)) return score;

  const nextMelody: Array<number | null> = new Array(source.length).fill(null);
  let upcoming: number | null = null;
  for (let i = source.length - 1; i >= 0; i -= 1) {
    nextMelody[i] = upcoming;
    const note = source[i];
    if (note.pitches.length === 1 && inScale(note.pitches[0], score.key, score.mode)) upcoming = i;
  }

  const out: ScoreNote[] = [];
  let changed = false;
  let pos = 0;
  for (let i = 0; i < source.length; i += 1) {
    const note = source[i];
    const beats = wholeBeats(note.dur, beatLen);
    const pitch = note.pitches.length === 1 ? note.pitches[0] : null;
    const eligible =
      pitch != null &&
      inScale(pitch, score.key, score.mode) &&
      beats != null &&
      onBeat(pos, beatLen);
    if (!eligible || pitch == null || beats == null) {
      out.push(note);
      pos += note.dur;
      continue;
    }
    const nextIndex = nextMelody[i];
    const nextPitch = nextIndex == null ? null : source[nextIndex].pitches[0];
    const dist = nextPitch == null ? null : scaleDistance(pitch, nextPitch, score.key, score.mode);
    const rewritten = rewrite(
      style,
      pitch,
      beats,
      beatLen,
      dist,
      playfulStrong(pos, beatLen, score.beats, score.beatUnit),
      score.key,
      score.mode,
    );
    if (!rewritten) out.push(note);
    else {
      changed = true;
      out.push(...rewritten);
    }
    pos += note.dur;
  }
  if (!changed) return score;
  const written = out.map(withoutSpans);
  const other = voiceList(score).filter((_, i) => i !== voice).flat();
  const otherHasTime = (other ?? []).some((note) => Number.isFinite(note.dur) && note.dur > 0);
  const next = setVoiceNotes(score, voice, written);
  if (otherHasTime) return next;
  return { ...next, changes: remapChangesForNotes(score.changes, source, written) };
}
