import { CHANGE_BEAT_UNITS, CHANGE_BEATS_MAX, CHANGE_BPM_MAX, CHANGE_BPM_MIN } from "./score-timeline.ts";
import "./chord-symbol.ts";
import { isKeyName, type Score, type ScoreNote } from "./theory.ts";

export const STORAGE_KEY = "puxian-score-v1";

export function createBlankScore(): Score {
  return {
    title: "未命名乐谱",
    bpm: 88,
    beats: 4,
    beatUnit: 4,
    key: "C",
    mode: "major",
    clef: "treble",
    tonicOctave: 4,
    notes: [],
  };
}

function isNoteList(value: unknown): value is ScoreNote[] {
  return (
    Array.isArray(value) &&
    value.every(
      (note) =>
        !!note &&
        typeof note === "object" &&
        Array.isArray((note as ScoreNote).pitches) &&
        (note as ScoreNote).pitches.every((pitch) => typeof pitch === "number") &&
        typeof (note as ScoreNote).dur === "number" &&
        ((note as ScoreNote).fingers == null ||
          (Array.isArray((note as ScoreNote).fingers) &&
            (note as ScoreNote).fingers!.every(
              (finger) => finger == null || (Number.isInteger(finger) && finger >= 0 && finger <= 5),
            ))),
    )
  );
}

export function isScore(value: unknown): value is Score {
  if (!value || typeof value !== "object") return false;
  const score = value as Score;
  if (score.staffInstrument !== undefined && score.staffInstrument !== "piano") return false;
  if (score.changes !== undefined && (!Array.isArray(score.changes) || !score.changes.every((c, i) =>
    c && Number.isFinite(c.at) && c.at > 0 && c.at <= 1_000_000 && (i === 0 || c.at > score.changes![i-1].at) &&
    (c.bpm !== undefined || c.beats !== undefined || c.key !== undefined) &&
    (c.bpm === undefined || (Number.isFinite(c.bpm) && c.bpm >= CHANGE_BPM_MIN && c.bpm <= CHANGE_BPM_MAX)) &&
    (c.beats === undefined ? c.beatUnit === undefined : Number.isInteger(c.beats) && c.beats >= 1 && c.beats <= CHANGE_BEATS_MAX && CHANGE_BEAT_UNITS.includes(c.beatUnit!)) &&
    (c.key === undefined ? c.mode === undefined : isKeyName(c.key) && (c.mode === 'major' || c.mode === 'minor'))
  ))) return false;
  // Shape only; bar-line placement is checked where repeats are used.
  if (score.repeats !== undefined && (!Array.isArray(score.repeats) || score.repeats.some(r => !(r?.to > r.from && Number.isFinite(r.from + r.to + (r.ending ?? 0) + (r.endingEnd ?? 0)))))) return false;
  if (score.jumps !== undefined && !(score.jumps && typeof score.jumps == "object" && Object.values(score.jumps).every(v => Number.isFinite(v) && v >= 0))) return false;
  if (score.voice2 != null && !isNoteList(score.voice2)) return false;
  if (score.extraVoices !== undefined && (!Array.isArray(score.extraVoices) || score.extraVoices.length > 14 || score.voice2 == null || !score.extraVoices.every(isNoteList))) return false;
  if (score.chordSymbols != null) {
    if (!Array.isArray(score.chordSymbols)) return false;
    if (!score.chordSymbols.every((item) =>
      item && Number.isFinite(item.at) && item.at >= 0 && item.at <= 1_000_000 &&
      typeof item.symbol === "string" && item.symbol.trim().length > 0 && item.symbol.length <= 40
    )) return false;
  }
  return (
    isNoteList(score.notes) &&
    typeof score.title === "string" &&
    typeof score.bpm === "number" &&
    typeof score.beats === "number" &&
    typeof score.beatUnit === "number" &&
    isKeyName(score.key) &&
    (score.mode === "major" || score.mode === "minor") &&
    (score.clef === "treble" || score.clef === "bass") &&
    typeof score.tonicOctave === "number"
  );
}
