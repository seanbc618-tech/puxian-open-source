/**
 * 选段编辑 (Sibelius-style): repeat the selected run right after itself (R), move it a scale
 * step (↑/↓) or an octave (Ctrl+↑/↓), or turn it into rests that keep the rhythm.
 * Pure functions on one voice; the editor commits the result with undo.
 */
import { shiftFermatasForInsert } from "./fermata.ts";
import { meterAt } from "./score-timeline.ts";
import { PC, canTranspose, stepsFor, type KeyName, type Mode, type Score, type ScoreNote } from "./theory.ts";
import { replaceVoiceAndRemap, voiceList, voiceNotes, type VoiceId } from "./voices.ts";

const EPS = 1e-6;

/** First and last index when the selection is one unbroken run, else null. */
export function selectionRun(indexes: readonly number[]): { from: number; to: number } | null {
  if (!indexes.length) return null;
  const sorted = [...indexes].sort((a, b) => a - b);
  for (let i = 1; i < sorted.length; i += 1) if (sorted[i] !== sorted[i - 1] + 1) return null;
  return { from: sorted[0], to: sorted[sorted.length - 1] };
}

const sum = (notes: readonly ScoreNote[]) => notes.reduce((total, note) => total + (Number.isFinite(note.dur) ? note.dur : 0), 0);

/** Drops slur and hairpin ends that lost their partner, so every mark still pairs up. */
export function pairMarks(notes: ScoreNote[]): ScoreNote[] {
  const out = notes.map((note) => ({ ...note }));
  const fix = (startKey: "slurStart" | "hairpin", endKey: "slurEnd" | "hairpinEnd") => {
    let open = -1;
    out.forEach((note, i) => {
      // A note can close one mark and open the next.
      if (note[endKey]) {
        if (open >= 0) open = -1;
        else delete note[endKey];
      }
      if (note[startKey]) {
        if (open >= 0) delete out[open][startKey];
        open = i;
      }
    });
    if (open >= 0) delete out[open][startKey];
  };
  fix("slurStart", "slurEnd");
  fix("hairpin", "hairpinEnd");
  return out;
}

export type RepeatResult = { score: Score; selected: number[]; quarters: number } | { error: string };

/**
 * 重复一遍: a copy of the run goes right after it and becomes the new selection. Lyrics are
 * not copied (the next pass usually has new words). In a one-voice score, chord symbols in
 * the run are copied too and later chord symbols, repeat signs and jump marks move along.
 */
export function repeatSelection(score: Score, voice: VoiceId, indexes: readonly number[]): RepeatResult {
  const run = selectionRun(indexes);
  if (!run) return { error: "先选一段连续的音（「选一段」），再重复。" };
  const notes = voiceNotes(score, voice);
  if (run.to >= notes.length) return { error: "选中的音已经不在这个声部了。" };
  const copy = pairMarks(notes.slice(run.from, run.to + 1).map(({ lyric: _lyric, ...note }) => note));
  const start = sum(notes.slice(0, run.from));
  const length = sum(notes.slice(run.from, run.to + 1));
  const end = start + length;
  const next = [...notes.slice(0, run.to + 1), ...copy, ...notes.slice(run.to + 1)];
  const selected = copy.map((_, i) => run.to + 1 + i);
  const shared = !voiceList(score).some((v, i) => i !== voice && sum(v) > EPS);
  let out = replaceVoiceAndRemap(score, voice, next);
  const fermatas = shiftFermatasForInsert(score.fermatas, voice, start, end, length);
  if (fermatas) out = { ...out, fermatas };
  else {
    out = { ...out };
    delete out.fermatas;
  }
  if (!shared) return { score: out, selected, quarters: length };
  // A mark that opens music (|:, 1st ending, Segno, Coda) at the run's end belongs to what follows
  // and moves; one that closes music (:|, Fine, To Coda, D.C., D.S.) there stays with the run.
  const moves = (at: number, opens: boolean) => (opens ? at > end - EPS : at > end + EPS);
  const marks: [number | undefined, boolean][] = [
    ...(score.repeats ?? []).flatMap((r): [number | undefined, boolean][] => [[r.from, true], [r.to, false], [r.ending, true], [r.endingEnd, false]]),
    ...Object.entries(score.jumps ?? {}).map(([k, at]): [number | undefined, boolean] => [at, k === "segno" || k === "coda"]),
  ];
  if (marks.some(([at, opens]) => typeof at === "number" && moves(at, opens))) {
    const meter = meterAt(score, end);
    const bar = (meter.beats * 4) / meter.beatUnit;
    const bars = length / bar;
    if (Math.abs(bars - Math.round(bars)) > EPS) return { error: "后面有反复或跳转记号，这段不是整小节，重复后会错位。请选整小节再重复。" };
  }
  const shift = (at: number, opens: boolean) => (moves(at, opens) ? at + length : at);
  if (score.chordSymbols?.length) {
    const copied = score.chordSymbols.filter((c) => c.at >= start - EPS && c.at < end - EPS).map((c) => ({ ...c, at: c.at + length }));
    const kept = score.chordSymbols.map((c) => (c.at >= end - EPS ? { ...c, at: c.at + length } : c));
    out = { ...out, chordSymbols: [...kept, ...copied].sort((a, b) => a.at - b.at) };
  }
  if (score.rehearsals?.length) {
    const copied = score.rehearsals.filter((c) => c.at >= start - EPS && c.at < end - EPS).map((c) => ({ ...c, at: c.at + length }));
    const kept = score.rehearsals.map((c) => (c.at >= end - EPS ? { ...c, at: c.at + length } : c));
    out = { ...out, rehearsals: [...kept, ...copied].sort((a, b) => a.at - b.at) };
  }
  if (score.repeats?.length) {
    out = { ...out, repeats: score.repeats.map((r) => ({
      ...r, from: shift(r.from, true), to: shift(r.to, false),
      ...(r.ending != null ? { ending: shift(r.ending, true) } : {}),
      ...(r.endingEnd != null ? { endingEnd: shift(r.endingEnd, false) } : {}),
    })) };
  }
  if (score.jumps) {
    out = { ...out, jumps: Object.fromEntries(Object.entries(score.jumps).map(([k, at]) => [k, typeof at === "number" ? shift(at, k === "segno" || k === "coda") : at])) };
  }
  return { score: out, selected, quarters: length };
}

/** Next pitch of the key's scale above (dir 1) or below (dir −1); off-scale notes snap to the next scale tone. */
export function scaleStep(midi: number, key: KeyName, mode: Mode, dir: 1 | -1): number {
  const scale = new Set(stepsFor(mode).map((s) => (PC[key] + s) % 12));
  let next = midi + dir;
  while (!scale.has(((next % 12) + 12) % 12)) next += dir;
  return next;
}

export type ShiftKind = "step" | "octave";

/** 上移/下移一级 or 高/低八度 on the selected notes (and their grace notes); null when a note would leave the piano. */
export function shiftSelection(notes: ScoreNote[], indexes: readonly number[], key: KeyName, mode: Mode, kind: ShiftKind, dir: 1 | -1): ScoreNote[] | null {
  const picked = new Set(indexes.filter((i) => i >= 0 && i < notes.length));
  if (!picked.size || ![...picked].some((i) => notes[i].pitches.length)) return null;
  const move = (p: number) => (kind === "octave" ? p + 12 * dir : scaleStep(p, key, mode, dir));
  let fits = true;
  const out = notes.map((note, i) => {
    if (!picked.has(i) || !note.pitches.length) return note;
    const pitches = [...new Set(note.pitches.map(move))].sort((a, b) => a - b);
    const grace = typeof note.gracePitch === "number" ? move(note.gracePitch) : undefined;
    const moved: ScoreNote = { ...note, pitches, ...(grace != null ? { gracePitch: grace } : {}) };
    // Fingering follows the old chord shape, which a step can change.
    if (moved.fingers && pitches.length !== note.pitches.length) delete moved.fingers;
    if (![...pitches, ...(grace != null ? [grace] : [])].every(inPiano)) fits = false;
    return moved;
  });
  return fits ? out : null;
}

/** Inside the playable piano range (canTranspose's bounds; one semitone up from p − 1 is p). */
function inPiano(p: number): boolean {
  return canTranspose([{ pitches: [p - 1], dur: 1 }], 1);
}

/** 改成休止: the selected notes keep their length and lose pitch, marks, fingering and lyrics. */
export function restSelection(notes: ScoreNote[], indexes: readonly number[]): ScoreNote[] | null {
  const picked = new Set(indexes.filter((i) => i >= 0 && i < notes.length));
  if (![...picked].some((i) => notes[i].pitches.length)) return null;
  return pairMarks(notes.map((note, i) => (picked.has(i) ? { pitches: [], dur: note.dur } : note)));
}
