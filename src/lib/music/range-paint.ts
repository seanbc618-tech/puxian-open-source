import { staffTargetAt, type StaffHit } from "./notation.ts";
import type { FollowSlot } from "./playback-clock.ts";
import { outOfRangeHeadNames, type RangeHit } from "./range.ts";
import { stateAt } from "./score-timeline.ts";
import type { InstrumentId, KeyName, Mode, Score, ScoreNote } from "./theory.ts";
import type { VoiceId } from "./voices.ts";

export type EngravedHead = {
  /** Glyph id, such as "noteheads.quarter". */
  c?: string;
  /** ABC spelling abcjs stored for this chord or melody head, including accidentals. */
  name?: string;
  graphelem?: Element | null;
};

export type EngravedNote = {
  el_type?: string;
  startChar?: number;
  endChar?: number;
  abselem?: { elemset?: Element[]; heads?: EngravedHead[] };
};

export type EngravedTune = {
  lines?: Array<{ staff?: Array<{ voices?: EngravedNote[][] }> }>;
};

export type RangePaint = {
  hits: readonly RangeHit[];
  mark: boolean;
  /** Voice 1, used when `voices` is omitted. */
  notes: readonly ScoreNote[];
  /** Both staves. When set, voice 2 range checks use `voices[1]`. */
  voices?: readonly (readonly ScoreNote[])[];
  instrument: InstrumentId;
  key: KeyName;
  mode: Mode;
  /** Mid-score key changes; when absent, every note uses `key` / `mode`. */
  changes?: Score["changes"];
};

function noteheadNodes(node: Element): Element[] {
  if (node.classList.contains("abcjs-notehead")) return [node];
  return [...node.querySelectorAll(".abcjs-notehead")];
}

function isChordHead(head: EngravedHead): boolean {
  return typeof head.c === "string" && head.c.includes("notehead") && Boolean(head.graphelem);
}

/**
 * Color only the chord or melody noteheads whose ABC name is out of range.
 * `abselem.heads` is that list, in the order abcjs engraved the pitches.
 * Grace heads sit in the same SVG group but are not in `heads`, so a shared
 * spelling must not drag the other chord tones into the mark.
 * Returns true when a wanted spelling had no chord head to mark.
 */
function rangeKey(voice: VoiceId, index: number): string {
  return `${voice}:${index}`;
}

function paintedNote(range: RangePaint, voice: VoiceId, index: number): ScoreNote | undefined {
  if (range.voices) return range.voices[voice]?.[index];
  return voice === 0 ? range.notes[index] : undefined;
}

function noteOnset(notes: readonly ScoreNote[] | undefined, index: number): number {
  if (!notes) return 0;
  let at = 0;
  for (let i = 0; i < index; i += 1) at += notes[i]?.dur ?? 0;
  return at;
}

function keyModeAt(range: RangePaint, voice: VoiceId, index: number): { key: KeyName; mode: Mode } {
  const notes = range.voices?.[voice] ?? (voice === 0 ? range.notes : undefined);
  const at = noteOnset(notes, index);
  const state = stateAt(
    { bpm: 120, beats: 4, beatUnit: 4, key: range.key, mode: range.mode, changes: range.changes },
    at,
  );
  return { key: state.key, mode: state.mode };
}

/**
 * Color the engraved note that belongs to `voice` and `index`.
 * `selected` is the active voice only. `slots` are the notes actually sounding.
 * When `slots` is omitted, `sounding` fills the active voice, which keeps older callers working.
 */
export function paintNotes(
  tunes: EngravedTune[],
  hits: StaffHit[],
  selected: readonly number[],
  sounding: number | null,
  range: RangePaint,
  activeVoice: VoiceId = 0,
  slots?: readonly FollowSlot[],
): boolean {
  const byIndex = new Map(
    range.hits.map((hit) => [rangeKey((hit.voice ?? 0) as VoiceId, hit.index), hit]),
  );
  let missed = false;
  for (const tune of tunes) {
    for (const line of tune.lines ?? []) {
      for (const staff of line.staff ?? []) {
        for (const voice of staff.voices ?? []) {
          for (const elem of voice) {
            if (elem.el_type !== "note" || elem.startChar == null || elem.endChar == null) continue;
            const target = staffTargetAt(hits, elem.startChar, elem.endChar);
            const index = target?.index ?? null;
            const voiceId: VoiceId = target?.voice ?? 0;
            const chosen = index != null && voiceId === activeVoice && selected.includes(index);
            const soundingNow =
              index != null &&
              (slots
                ? slots.some((slot) => slot.voice === voiceId && slot.note === index)
                : voiceId === activeVoice && sounding === index);
            const marks = { chosen, sounding: soundingNow };
            const hit = index == null ? undefined : byIndex.get(rangeKey(voiceId, index));
            const note = index == null ? undefined : paintedNote(range, voiceId, index);
            const km = index != null && range.mark && hit && note ? keyModeAt(range, voiceId, index) : null;
            const wanted =
              km && note && hit
                ? new Set(
                    outOfRangeHeadNames(
                      note,
                      hit.pitchIndexes,
                      range.instrument,
                      km.key,
                      km.mode,
                    ),
                  )
                : new Set<string>();
            const flagged = new Set<Element>();
            const seen = new Set<string>();
            for (const head of elem.abselem?.heads ?? []) {
              if (!isChordHead(head) || !head.graphelem || !head.name) continue;
              if (wanted.has(head.name)) {
                flagged.add(head.graphelem);
                seen.add(head.name);
              }
            }
            for (const name of wanted) {
              if (!seen.has(name)) missed = true;
            }
            for (const node of elem.abselem?.elemset ?? []) {
              if (node.classList.contains("abcjs-lyric")) continue;
              node.classList.toggle("is-chosen", marks.chosen);
              node.classList.toggle("is-sounding", marks.sounding);
              for (const notehead of noteheadNodes(node)) {
                notehead.classList.toggle("is-out-of-range", flagged.has(notehead));
              }
            }
          }
        }
      }
    }
  }
  return missed;
}
