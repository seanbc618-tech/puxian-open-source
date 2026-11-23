import { voiceList, replaceVoice as setVoiceNotes } from "./voices.ts";
import type { Score, ScoreNote } from "./theory.ts";

export const SIMPLIFY_LEVELS = [
  { id: "beginner", label: "入门", detail: "只留旋律和低音，节奏更疏，跨度更小" },
  { id: "easy", label: "简易", detail: "保留简单和弦，限制跨度，合并过密的节奏" },
  { id: "medium", label: "适中", detail: "去掉装饰音，和弦最多三音，跨度不超过十度" },
] as const;

export type SimplifyLevel = (typeof SIMPLIFY_LEVELS)[number]["id"];

const LIMIT = {
  beginner: { tones: 1, span: 7, merge: 0.5 },
  easy: { tones: 2, span: 12, merge: 0.25 },
  medium: { tones: 3, span: 16, merge: 0 },
} as const;

function dropOrnaments(note: ScoreNote): ScoreNote {
  if (!note.ornament && note.gracePitch == null) return note;
  const next = { ...note };
  delete next.ornament;
  delete next.gracePitch;
  return next;
}

function thinPitches(pitches: readonly number[], keep: "high" | "low", tones: number, span: number): number[] {
  if (!pitches.length) return [];
  const unique = [...new Set(pitches)].sort((a, b) => a - b);
  if (tones <= 1) return [keep === "high" ? unique[unique.length - 1]! : unique[0]!];
  const picked: number[] = [];
  if (keep === "high") {
    picked.push(unique[unique.length - 1]!);
    for (let i = unique.length - 2; i >= 0 && picked.length < tones; i -= 1) {
      const candidate = unique[i]!;
      if (picked[0]! - candidate <= span) picked.push(candidate);
    }
    return picked.sort((a, b) => a - b);
  }
  picked.push(unique[0]!);
  for (let i = 1; i < unique.length && picked.length < tones; i += 1) {
    const candidate = unique[i]!;
    if (candidate - picked[0]! <= span) picked.push(candidate);
  }
  return picked;
}

function thinNote(note: ScoreNote, keep: "high" | "low", tones: number, span: number): ScoreNote {
  const next = dropOrnaments(note);
  const pitches = thinPitches(next.pitches, keep, tones, span);
  if (pitches.length === next.pitches.length && pitches.every((midi, i) => midi === next.pitches[i])) {
    return next;
  }
  const fingers = next.fingers
    ? pitches.map((midi) => {
        const at = next.pitches.indexOf(midi);
        return at >= 0 ? next.fingers![at] : undefined;
      })
    : undefined;
  const cleaned = { ...next, pitches };
  if (fingers && fingers.some((finger) => finger != null)) cleaned.fingers = fingers as ScoreNote["fingers"];
  else delete cleaned.fingers;
  if (cleaned.lyric && pitches.length === 0) delete cleaned.lyric;
  return cleaned;
}

function mergeDense(notes: ScoreNote[], unit: number): ScoreNote[] {
  if (unit <= 0 || notes.length < 2) return notes;
  const out: ScoreNote[] = [];
  for (const note of notes) {
    const prev = out[out.length - 1];
    const same =
      prev &&
      prev.dur + 1e-9 < unit &&
      note.dur + 1e-9 < unit &&
      prev.pitches.length === note.pitches.length &&
      prev.pitches.every((midi, i) => midi === note.pitches[i]);
    if (same && prev) {
      const merged = { ...prev, dur: prev.dur + note.dur };
      // Lyrics on the consumed note are dropped; the kept syllable stays on the start.
      out[out.length - 1] = merged;
    } else {
      out.push(note);
    }
  }
  return out;
}

function sameNotes(a: readonly ScoreNote[], b: readonly ScoreNote[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function simplifyVoice(
  notes: ScoreNote[],
  keep: "high" | "low",
  level: SimplifyLevel,
): ScoreNote[] {
  const limit = LIMIT[level];
  const thinned = notes.map((note) => thinNote(note, keep, limit.tones, limit.span));
  return mergeDense(thinned, limit.merge);
}

/**
 * Rule-based reduction: keep the melody (highest pitch of voice 1) and the
 * harmonic bass, drop inner tones, cap hand span, and optionally merge dense
 * equal pitches. Returns a new score, or the same object if nothing changed.
 */
export function simplifyScore(score: Score, level: SimplifyLevel): Score {
  const voices = voiceList(score).map((v,i) => simplifyVoice(v, i === 0 ? "high" : "low", level));
  if (voices.every((v,i) => sameNotes(v, voiceList(score)[i]!))) return score;
  let next = score;
  voices.forEach((v,i) => { next = setVoiceNotes(next,i,v); });
  return next;
}

export function describeSimplify(from: Score, to: Score): { from: number; to: number } {
  const count = (score: Score) =>
    voiceList(score).flat().reduce((sum, note) => sum + Math.max(1, note.pitches.length), 0);
  return { from: count(from), to: count(to) };
}
