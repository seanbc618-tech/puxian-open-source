import { remapChordSymbolsForNotes } from "./chord-symbol.ts";
import { remapRehearsalsForNotes } from "./rehearsals.ts";
import { remapFermatasForNotes } from "./fermata.ts";
import { retainMarks } from "./expression.ts";
import { lyricsDropped } from "./lyrics.ts";
import { importJianpu } from "./notation.ts";
import { carryLyrics, lyricCarryNotice } from "./text-edit-carry.ts";
import type { Score, ScoreNote } from "./theory.ts";
import { replaceVoiceAndRemap, voiceNotes, type VoiceId } from "./voices.ts";

export type VoiceRewrite = {
  score: Score;
  lyricsDropped: boolean;
  /** Plain-language notes on what moved or could not be kept. */
  lyricNotice?: string;
  chordNotice?: string;
};

/**
 * Replace one voice from a text box and carry what is attached to it.
 *
 * `base` is the score as it was when this text edit began. Lyrics and chord
 * marks are always carried from it, so a half-typed melody in between cannot
 * strip them for good: typing the rest of the line brings them back.
 */
export function rewriteVoice(
  base: Score,
  header: Partial<Pick<Score, "key" | "beats" | "beatUnit" | "tonicOctave">>,
  voice: VoiceId,
  parsed: ScoreNote[],
): VoiceRewrite {
  const previous = voiceNotes(base, voice);
  let nextNotes = retainMarks(previous, parsed);
  let lyricNotice: string | undefined;
  if (nextNotes === parsed) {
    const carry = carryLyrics(previous, parsed);
    nextNotes = carry.notes;
    lyricNotice = lyricCarryNotice(carry);
  }
  let next = replaceVoiceAndRemap({ ...base, ...header }, voice, nextNotes);
  let chordNotice: string | undefined;
  if (voice === 0 && base.chordSymbols?.length) {
    const remapped = remapChordSymbolsForNotes(base.chordSymbols, previous, nextNotes);
    if (remapped.symbols) next = { ...next, chordSymbols: remapped.symbols };
    else {
      next = { ...next };
      delete next.chordSymbols;
    }
    chordNotice = remapped.notice;
  }
  let rehearsalNotice: string | undefined;
  if (voice === 0 && base.rehearsals?.length) {
    const remapped = remapRehearsalsForNotes(base.rehearsals, previous, nextNotes);
    if (remapped.marks) next = { ...next, rehearsals: remapped.marks };
    else {
      next = { ...next };
      delete next.rehearsals;
    }
    rehearsalNotice = remapped.notice;
  }
  let fermataNotice: string | undefined;
  if (base.fermatas?.length) {
    const remapped = remapFermatasForNotes(base.fermatas, voice, previous, nextNotes);
    if (remapped.marks) next = { ...next, fermatas: remapped.marks };
    else {
      next = { ...next };
      delete next.fermatas;
    }
    fermataNotice = remapped.notice;
  }
  return { score: next, lyricsDropped: lyricsDropped(previous, nextNotes), lyricNotice, chordNotice: [chordNotice, rehearsalNotice, fermataNotice].filter(Boolean).join(" ") || undefined };
}

/** Same path as the 唱名 text box: parse, keep marks when the shape is unchanged, carry lyrics and chords. */
export function applyJianpuText(
  score: Score,
  text: string,
  voice: VoiceId,
  instrumentShift = 0,
  base: Score = score,
): VoiceRewrite & { error?: string } {
  const imported = importJianpu(text, score, instrumentShift);
  if (imported.error) {
    return { score, error: imported.error, lyricsDropped: false };
  }
  return rewriteVoice(
    base,
    { key: imported.key, beats: imported.beats, beatUnit: imported.beatUnit, tonicOctave: imported.tonicOctave },
    voice,
    imported.notes,
  );
}
