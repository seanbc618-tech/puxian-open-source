import { writtenQuarters } from "./playback-clock.ts";
import { remapChangesForNotes } from "./score-timeline.ts";
import type { Score, ScoreNote } from "./theory.ts";

export type VoiceId = number;
export const MAX_VOICES = 16;
type Voices = Pick<Score, "notes" | "voice2" | "extraVoices">;
export function isVoiceId(value: unknown): value is VoiceId {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value < MAX_VOICES;
}
export function voiceList(score: Voices): ScoreNote[][] {
  return [score.notes, ...(score.voice2 != null || score.extraVoices?.length ? [score.voice2 ?? []] : []), ...(score.extraVoices ?? [])];
}
export function voiceLabel(voice: VoiceId): string {
  return `声部${["一", "二", "三", "四", "五", "六", "七", "八", "九", "十", "十一", "十二", "十三", "十四", "十五", "十六"][voice] ?? voice + 1}`;
}
export function hasSecondVoice(score: Pick<Score, "voice2">): boolean { return score.voice2 != null; }
export function voiceNotes(score: Voices, voice: VoiceId): ScoreNote[] { return voiceList(score)[voice] ?? []; }
export function replaceVoice<T extends Score>(score: T, voice: VoiceId, notes: ScoreNote[]): T {
  if (!isVoiceId(voice)) throw new Error("声部编号无效");
  if (voice === 0) return { ...score, notes };
  if (voice === 1) return { ...score, voice2: notes };
  const extraVoices = [...(score.extraVoices ?? [])];
  while (extraVoices.length <= voice - 2) extraVoices.push([]);
  extraVoices[voice - 2] = notes;
  return { ...score, voice2: score.voice2 ?? [], extraVoices };
}
export function addVoice<T extends Score>(score: T): T {
  const count = voiceList(score).length;
  if (count >= MAX_VOICES) return score;
  return replaceVoice(score, count, []);
}
export function addSecondVoice<T extends Score>(score: T): T { return score.voice2 ? score : { ...score, voice2: [] }; }
export function removeVoice<T extends Score>(score: T, voice: VoiceId): T {
  if (!isVoiceId(voice) || voice <= 0 || voice >= voiceList(score).length) return score;
  const voices = voiceList(score).filter((_, i) => i !== voice);
  const next = { ...score, notes: voices[0] };
  delete next.voice2; delete next.extraVoices;
  if (voices.length > 1) next.voice2 = voices[1];
  if (voices.length > 2) next.extraVoices = voices.slice(2);
  return next;
}
export function removeSecondVoice<T extends Score>(score: T): T { return removeVoice(score, 1); }
export function allVoiceNotes(score: Voices): ScoreNote[] { return voiceList(score).flat(); }
export function scoreQuarters(score: Voices): number { return Math.max(...voiceList(score).map(writtenQuarters)); }
export function voiceView<T extends Score>(score: T, voice: VoiceId): T { return voice === 0 ? score : { ...score, notes: voiceNotes(score, voice) }; }
export function replaceVoiceAndRemap<T extends Score>(score: T, voice: VoiceId, notes: ScoreNote[]): T {
  const next = replaceVoice(score, voice, notes);
  if (voiceList(score).some((v,i) => i !== voice && v.some(n => Number.isFinite(n.dur) && n.dur > 0))) return next;
  return { ...next, changes: remapChangesForNotes(score.changes, voiceNotes(score, voice), notes) };
}
export function lowerVoiceClef(score: Pick<Score, "clef" | "voice2">): "treble" | "bass" {
  if (score.clef === "bass") return "bass";
  const pitches = (score.voice2 ?? []).flatMap(n => n.pitches).sort((a,b) => a-b);
  return pitches.length && pitches[Math.floor(pitches.length / 2)]! < 57 ? "bass" : "treble";
}
export function voiceClef(score: Score, voice: VoiceId): "treble" | "bass" {
  return voice === 0 ? score.clef : lowerVoiceClef({ clef: score.clef, voice2: voiceNotes(score, voice) });
}

/** Imported piano hands may carry no instrument metadata; use the actual clef pair. */
export function isGrandStaff(score: Score): boolean {
  return score.staffInstrument === "piano" || (voiceList(score).length === 2 && voiceClef(score, 0) === "treble" && voiceClef(score, 1) === "bass");
}
