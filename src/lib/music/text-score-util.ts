/** Shared helpers for the 123 and 番茄 text importers (independent implementation;
 * behavior follows Dolce 6b1d3fc format docs, MIT, Copyright (c) 2026 lodebar2026). */
import { KEY_NAMES, MAJOR_STEPS, type KeyName, type ScoreNote } from "./theory.ts";

const LETTER_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** `1=X` spelling → KeyName and the MIDI pitch of an unmarked `1`.
 * Unmarked 1 sits in octave 4; only tonics spelled with letter B drop to octave 3. */
export function doKey(letter: string, alter: number): { key: KeyName; doMidi: number } {
  const L = letter.toUpperCase();
  if (!(L in LETTER_PC) || !Number.isInteger(alter) || Math.abs(alter) > 2)
    throw new Error(`调号「${letter}」认不出。`);
  const doMidi = 12 * ((L === "B" ? 3 : 4) + 1) + LETTER_PC[L] + alter;
  return { key: KEY_NAMES[((doMidi % 12) + 12) % 12], doMidi };
}

/** Per-bar accidental carry by scale degree, jianpu convention (`#4 4` keeps the sharp). */
export class DegreeCarry {
  private offsets = new Map<number, number>();
  reset() {
    this.offsets.clear();
  }
  /** `acc` is the written offset (null when unmarked; 0 for natural). */
  midi(doMidi: number, degree: number, acc: number | null, octave: number): number {
    if (acc !== null) {
      if (acc === 0) this.offsets.delete(degree);
      else this.offsets.set(degree, acc);
    }
    const midi = doMidi + MAJOR_STEPS[degree - 1] + (this.offsets.get(degree) ?? 0) + 12 * octave;
    if (midi < 0 || midi > 127) throw new Error("音高超出 MIDI 范围。");
    return midi;
  }
}

export const CLOSING_PUNCT = "，。！？；：、,.!?;:”’」』》〉】）)…—\"";
export const OPENING_PUNCT = "“‘「『《〈【（(";

export function isCjk(ch: string): boolean {
  const c = ch.codePointAt(0) ?? 0;
  return (c >= 0x3400 && c <= 0x9fff) || (c >= 0xf900 && c <= 0xfaff) || (c >= 0x3040 && c <= 0x30ff) || (c >= 0x20000 && c <= 0x2ffff);
}

/** One lyric slot: a syllable, an explicit skip, or a melisma hold. */
export type LyricItem = { kind: "text"; text: string; syllabic?: "single" | "begin" | "middle" | "end" } | { kind: "skip" } | { kind: "hold" } | { kind: "bar" };

/** A note event that may take a lyric. `note === null` marks slots the Score cannot hold a syllable on. */
export type LyricSlot = { note: ScoreNote; pitched: boolean; bar: number };

/** Writes items onto slots; returns overflow/limitation flags for the loss list. */
export function alignLyrics(slots: LyricSlot[], from: number, items: LyricItem[]) {
  let i = from;
  const out = { overflow: 0, onRest: 0, overwrite: 0 };
  for (const item of items) {
    if (item.kind === "bar") {
      const bar = slots[i]?.bar ?? slots[i - 1]?.bar;
      if (bar === undefined) continue;
      // `|` advances to the first slot of the next bar (no-op when already there).
      if (i > from && slots[i - 1]?.bar === bar) while (i < slots.length && slots[i].bar === bar) i++;
      continue;
    }
    const slot = slots[i++];
    if (!slot) {
      if (item.kind === "text") out.overflow++;
      continue;
    }
    if (item.kind === "skip") continue;
    if (!slot.pitched) {
      if (item.kind === "text") out.onRest++;
      continue;
    }
    if (slot.note.lyric) {
      out.overwrite++;
      continue;
    }
    slot.note.lyric = item.kind === "hold" ? { text: "", syllabic: "single", extend: true } : { text: item.text, syllabic: item.syllabic ?? "single" };
  }
  return out;
}

/** Appends trailing punctuation to the previous text item, or prefixes opening marks to the next. */
export function pushPunct(items: LyricItem[], ch: string, pendingOpen: { v: string }) {
  if (OPENING_PUNCT.includes(ch)) {
    pendingOpen.v += ch;
    return;
  }
  for (let k = items.length - 1; k >= 0; k--) {
    const it = items[k];
    if (it.kind === "text") {
      it.text += ch;
      return;
    }
    if (it.kind !== "bar") break;
  }
  pendingOpen.v += ch;
}

/** A short first bar (弱起) is padded with a leading rest so later barlines line up;
 * the Score has no pickup-measure concept. Returns the pad in quarter notes (0 when none). */
export function padPickup(
  firstBarAt: number | undefined,
  barQ: number,
  voices: ScoreNote[][],
  changes: { at: number }[],
): number {
  if (firstBarAt === undefined || firstBarAt <= 1e-9 || firstBarAt >= barQ - 1e-9) return 0;
  const pad = barQ - firstBarAt;
  for (const v of voices) v.unshift({ pitches: [], dur: pad });
  for (const c of changes) c.at += pad;
  return pad;
}
