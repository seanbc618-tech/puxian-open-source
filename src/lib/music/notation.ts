import { beamSeparators } from "./staff-beaming.ts";
import { voiceList, voiceClef, isGrandStaff } from "./voices.ts";
import { nextBar, nextChange, stateAt } from "./score-timeline.ts";
import { lowerVoiceClef } from "./voices.ts";
import { closingHairpin, gracePitchOf } from "./expression.ts";
import { cleanLyric, formatAbcLyrics, scoreHasLyrics, type LyricAtom } from "./lyrics.ts";
import { abcChordToken, transposeChordSymbols, type ChordSymbol } from "./chord-symbol.ts";
import { abcFingerPrefix } from "./fingering.ts";
import {
  type KeyName,
  type Mode,
  type Score,
  type ScoreNote,
  CHORD_TONE_LIMIT,
  KEY_NAMES,
  barUnitCount,
  beatUnitCount,
  degreeMidi,
  degreeToken,
  keyLabel,
  keyTitle,
  scaleAccidentals,
  spellMidi,
  tonicMidi,
  transposeKey,
  transposeScore,
} from "./theory.ts";

const STANDARD = [48, 36, 24, 18, 12, 9, 6, 3];
const STANDARD_SET = new Set(STANDARD);

export type ParseResult = { notes: ScoreNote[]; error: string | null };

type Part = {
  rest: boolean;
  degree: number;
  acc: number;
  oct: number;
  dotted: boolean;
  extend: number;
  explicit: number | null;
};

function fail(token: string, index: number, reason?: string): ParseResult {
  const where = `第 ${index + 1} 个记号「${token}」`;
  return { notes: [], error: reason ? `${where}${reason}` : `${where}看不懂` };
}

function scanParts(source: string): Part[] | null {
  const parts: Part[] = [];
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (ch === " " || ch === "\t") {
      i += 1;
      continue;
    }
    if (ch === "-" || ch === "—" || ch === "－") {
      if (!parts.length) return null;
      parts[parts.length - 1].extend += 1;
      i += 1;
      continue;
    }
    let acc = 0;
    if (ch === "#" || ch === "♯") {
      acc = 1;
      i += 1;
    } else if (ch === "b" || ch === "♭") {
      acc = -1;
      i += 1;
    }
    const degreeChar = source[i];
    if (!degreeChar || !/[0-7]/.test(degreeChar)) return null;
    i += 1;
    if ((source[i] === "#" || source[i] === "♯") && acc === 0) {
      acc = 1;
      i += 1;
    } else if ((source[i] === "b" || source[i] === "♭") && acc === 0) {
      acc = -1;
      i += 1;
    }
    let oct = 0;
    while (source[i] === "'" || source[i] === "’" || source[i] === "′") {
      oct += 1;
      i += 1;
    }
    while (source[i] === "," || source[i] === "，") {
      oct -= 1;
      i += 1;
    }
    let dotted = false;
    if (source[i] === "." || source[i] === "·" || source[i] === "．") {
      dotted = true;
      i += 1;
    }
    let explicit: number | null = null;
    if (source[i] === "*") {
      i += 1;
      const start = i;
      while (i < source.length && /[0-9./]/.test(source[i])) i += 1;
      const spec = source.slice(start, i);
      if (!spec) return null;
      explicit = spec.includes("/")
        ? Number(spec.split("/")[0]) / Number(spec.split("/")[1])
        : Number(spec);
      if (!Number.isFinite(explicit) || explicit <= 0) return null;
    }
    parts.push({
      rest: degreeChar === "0",
      degree: Number(degreeChar),
      acc,
      oct,
      dotted,
      extend: 0,
      explicit,
    });
  }
  return parts.length ? parts : null;
}

function noteFrom(
  part: Part,
  units: number,
  ctx: Pick<Score, "key" | "mode" | "tonicOctave">,
): ScoreNote {
  if (part.rest || part.degree === 0) return { pitches: [], dur: units / 12 };
  return {
    pitches: [degreeMidi(part.degree, part.acc, part.oct, ctx.key, ctx.mode, ctx.tonicOctave)],
    dur: units / 12,
  };
}

function normalizeScoreText(text: string): string {
  return text
    .replace(/\u3000/g, " ")
    .replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xff10 + 0x30));
}

/** Longer denominators first so `3/16` is not read as `3/1`. */
const METER_RE = /^\s*(\d{1,2})\s*\/\s*(16|8|4|2|1)(?!\d)\s*/;
const METER_LOOKS_RE = /^\s*(\d{1,2}\s*\/\s*\d+)/;

export type JianpuSplit =
  | {
      ok: true;
      key: KeyName | null;
      beats: number | null;
      beatUnit: number | null;
      body: string;
    }
  | { ok: false; error: string };

/**
 * One grammar for the leading `1 = 调名` / meter and for the note body.
 * An unknown key or an illegal meter is an error; the caller must not apply a partial header.
 */
export function splitJianpuHeader(text: string): JianpuSplit {
  const lines = normalizeScoreText(text).replace(/\r\n/g, "\n").split("\n");
  let key: KeyName | null = null;
  let beats: number | null = null;
  let beatUnit: number | null = null;
  let headerOpen = true;
  const body: string[] = [];
  for (const line of lines) {
    if (!headerOpen) {
      body.push(line);
      continue;
    }
    let rest = line;
    const keyMatch = rest.match(/^\s*1\s*[=＝:：]\s*(\S+)\s*/);
    if (keyMatch) {
      const parsed = keyFromLabel(keyMatch[1]);
      if (!parsed) return { ok: false, error: `调名「${keyMatch[1]}」看不懂` };
      key = parsed;
      rest = rest.slice(keyMatch[0].length);
    }
    const meterMatch = rest.match(METER_RE);
    if (meterMatch) {
      const nextBeats = Number(meterMatch[1]);
      if (nextBeats < 1 || nextBeats > 16) {
        return { ok: false, error: `拍号「${meterMatch[1]}/${meterMatch[2]}」看不懂` };
      }
      beats = nextBeats;
      beatUnit = Number(meterMatch[2]);
      rest = rest.slice(meterMatch[0].length);
    } else {
      const badMeter = rest.match(METER_LOOKS_RE);
      if (badMeter) return { ok: false, error: `拍号「${badMeter[1].replace(/\s+/g, "")}」看不懂` };
    }
    if (rest.trim()) {
      headerOpen = false;
      body.push(rest);
    }
  }
  return { ok: true, key, beats, beatUnit, body: body.join("\n") };
}

export function parseJianpu(
  text: string,
  ctx: Pick<Score, "key" | "mode" | "tonicOctave" | "beats" | "beatUnit">,
): ParseResult {
  const trimmed = text.trim();
  if (!trimmed) return { notes: [], error: null };
  const split = splitJianpuHeader(text);
  if (!split.ok) return { notes: [], error: split.error };
  const beatU = beatUnitCount(ctx.beatUnit);
  const raw = split.body
    .replace(/[|｜]/g, " ")
    .replace(/[，、]/g, " ")
    .replace(/（/g, "(")
    .replace(/）/g, ")");
  const tokens: string[] = [];
  const re = /\([^)]*\)|\S+/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(raw))) tokens.push(match[0]);

  const notes: ScoreNote[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (/^[-\u2014\uff0d]+$/.test(token)) {
      if (!notes.length)
        return fail(token, index, "\u524d\u9762\u6ca1\u6709\u97f3\u53ef\u5ef6\u957f");
      notes[notes.length - 1].dur += (token.length * beatU) / 12;
      continue;
    }
    const chord = readChordToken(token, beatU);
    if (chord) {
      if (!chord.ok) return fail(token, index, chord.error);
      const pitches = chordPitches(chord.parts, ctx);
      if (!pitches.ok) return fail(token, index, pitches.error);
      notes.push({ pitches: pitches.pitches, dur: chord.units / 12 });
      continue;
    }
    const grouped = token.startsWith("(");
    const source = grouped ? token.slice(1, token.endsWith(")") ? -1 : undefined) : token;
    const parts = scanParts(source);
    if (!parts) return fail(token, index);
    if (
      parts.length === 2 &&
      parts[0].dotted &&
      !parts[1].dotted &&
      parts[0].explicit == null &&
      parts[1].explicit == null
    ) {
      notes.push(noteFrom(parts[0], Math.round(beatU * 1.5), ctx));
      notes.push(noteFrom(parts[1], Math.round(beatU * 0.5), ctx));
      continue;
    }
    if (parts.length === 1) {
      const part = parts[0];
      let units = beatU;
      if (part.explicit != null) units = Math.round(part.explicit * beatU);
      else if (part.dotted) units = Math.round(beatU * 1.5);
      units += part.extend * beatU;
      if (units <= 0) return fail(token, index);
      notes.push(noteFrom(part, units, ctx));
      continue;
    }
    const each = beatU / parts.length;
    for (const part of parts) notes.push(noteFrom(part, each, ctx));
  }
  return { notes, error: null };
}

function tokenOf(note: ScoreNote, ctx: Pick<Score, "key" | "mode" | "tonicOctave">): string {
  if (!note.pitches.length) return "0";
  const tokens = [...note.pitches]
    .sort((a, b) => a - b)
    .map((midi) => degreeToken(midi, ctx.key, ctx.mode, ctx.tonicOctave));
  if (tokens.length === 1) return tokens[0];
  // A low-octave comma would glue to the separator comma, so those chords use +.
  const joiner = tokens.some((token) => token.includes(",") || token.includes("，")) ? "+" : ",";
  return `[${tokens.join(joiner)}]`;
}

type ChordRead = { ok: true; parts: Part[]; units: number } | { ok: false; error: string };

/** `[1,3,5]`, `[135]`, `[1+3+5]`, `[5,+1]`, with the same dot, dash, and `*` durations as one note. */
function readChordToken(token: string, beatU: number): ChordRead | null {
  if (!token.startsWith("[")) return null;
  const match = token.match(/^\[([^[\]]+)\]([.\u00b7\uff0e]?)([-\u2014\uff0d]*)(?:\*([0-9./]+))?$/);
  if (!match) return { ok: false, error: "看不懂" };
  const body = match[1];
  const dotted = Boolean(match[2]);
  const dashes = match[3] ?? "";
  const spec = match[4];
  const pieces = body
    .split(/[+＋]/)
    .flatMap((piece) => piece.split(/[,，](?=[#b♯♭0-7])/))
    .filter(Boolean);
  if (pieces.length < 1) return { ok: false, error: "看不懂" };
  const parts: Part[] = [];
  for (const piece of pieces) {
    const scanned = scanParts(piece);
    if (!scanned) return { ok: false, error: "看不懂" };
    for (const part of scanned) {
      if (part.rest || part.degree === 0) return { ok: false, error: "里不能有休止" };
      if (part.dotted || part.extend || part.explicit != null) {
        return { ok: false, error: "的时值看不懂" };
      }
      parts.push(part);
    }
  }
  if (parts.length < 2) return { ok: false, error: "至少要两个音" };
  let units = beatU;
  if (spec) {
    const explicit = spec.includes("/")
      ? Number(spec.split("/")[0]) / Number(spec.split("/")[1])
      : Number(spec);
    if (!Number.isFinite(explicit) || explicit <= 0) return { ok: false, error: "的时值看不懂" };
    units = Math.round(explicit * beatU);
  } else if (dotted) {
    units = Math.round(beatU * 1.5);
  }
  units += dashes.length * beatU;
  if (units <= 0) return { ok: false, error: "的时值看不懂" };
  return { ok: true, parts, units };
}

const CHORD_LIMIT_WORDS = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];

/** Same unique-pitch cap as the keyboard and MusicXML import. */
function chordOverLimit(count: number): string | null {
  if (count <= CHORD_TONE_LIMIT) return null;
  const word = CHORD_LIMIT_WORDS[CHORD_TONE_LIMIT] ?? String(CHORD_TONE_LIMIT);
  return `最多${word}个音`;
}

function chordPitches(
  parts: Part[],
  ctx: Pick<Score, "key" | "mode" | "tonicOctave">,
): { ok: true; pitches: number[] } | { ok: false; error: string } {
  const seen = new Set<number>();
  const pitches: number[] = [];
  for (const part of parts) {
    const midi = degreeMidi(part.degree, part.acc, part.oct, ctx.key, ctx.mode, ctx.tonicOctave);
    if (seen.has(midi)) continue;
    seen.add(midi);
    pitches.push(midi);
  }
  pitches.sort((a, b) => a - b);
  const over = chordOverLimit(pitches.length);
  if (over) return { ok: false, error: over };
  return { ok: true, pitches };
}

function formatBeatSuffix(beats: number): string {
  const n = Math.round(beats * 1000) / 1000;
  const denoms = [2, 4, 8, 16, 3, 6, 12];
  for (const d of denoms) {
    const num = Math.round(n * d);
    if (num > 0 && Math.abs(num / d - n) < 1e-6) {
      if (d === 1) return String(num);
      return `${num}/${d}`;
    }
  }
  return String(n);
}

export function formatJianpu(score: Score): string {
  const beatU = beatUnitCount(score.beatUnit);
  const barU = barUnitCount(score.beats, score.beatUnit);
  const out: string[] = [];
  let pos = 0;
  let i = 0;
  const notes = score.notes;
  while (i < notes.length) {
    if (pos > 0 && pos % barU === 0) out.push("|");
    const units = Math.max(1, Math.round(notes[i].dur * 12));
    const nextUnits = i + 1 < notes.length ? Math.max(1, Math.round(notes[i + 1].dur * 12)) : 0;
    if (
      Math.abs(units - beatU * 1.5) <= 1 &&
      Math.abs(nextUnits - beatU * 0.5) <= 1 &&
      pos % beatU === 0 &&
      notes[i].pitches.length <= 1 &&
      notes[i + 1].pitches.length <= 1
    ) {
      out.push(`(${tokenOf(notes[i], score)}.${tokenOf(notes[i + 1], score)})`);
      pos += units + nextUnits;
      i += 2;
      continue;
    }
    if (units >= beatU && units % beatU === 0) {
      const beats = units / beatU;
      out.push(tokenOf(notes[i], score));
      for (let extra = 1; extra < beats; extra += 1) out.push("-");
      pos += units;
      i += 1;
      continue;
    }
    if (units < beatU && pos % beatU === 0) {
      const group = [notes[i]];
      let acc = units;
      let j = i + 1;
      while (j < notes.length && acc < beatU - 1) {
        const u = Math.max(1, Math.round(notes[j].dur * 12));
        if (acc + u > beatU + 1) break;
        group.push(notes[j]);
        acc += u;
        j += 1;
        if (Math.abs(acc - beatU) <= 1) break;
      }
      if (
        Math.abs(acc - beatU) <= 1 &&
        group.length > 1 &&
        group.every((note) => note.pitches.length <= 1)
      ) {
        out.push(group.map((note) => tokenOf(note, score)).join(""));
        pos += acc;
        i = j;
        continue;
      }
    }
    const beats = Math.round((units / beatU) * 1000) / 1000;
    out.push(`${tokenOf(notes[i], score)}*${formatBeatSuffix(beats)}`);
    pos += units;
    i += 1;
  }
  return out.join(" ");
}

const DUR_UNITS: Record<string, number> = {
  w: 48,
  h: 24,
  q: 12,
  e: 6,
  s: 3,
  dh: 36,
  dq: 18,
  de: 9,
  "1": 48,
  "2": 24,
  "4": 12,
  "8": 6,
  "16": 3,
};

function unitsFromSpec(spec: string): number | null {
  if (!spec) return 12;
  if (spec.startsWith("*")) {
    const units = Number(spec.slice(1));
    if (!Number.isInteger(units) || units <= 0 || units > 192) return null;
    return units;
  }
  const dotted = spec.endsWith(".");
  const core = dotted ? spec.slice(0, -1) : spec;
  if (!(core in DUR_UNITS)) return null;
  const units = DUR_UNITS[core];
  return dotted ? Math.round(units * 1.5) : units;
}

const LETTER_PC: Record<string, number> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
};

function pitchFromToken(body: string, carry: { oct: number }): number | null {
  const match = body.match(/^([A-Ga-g])([#b]{0,2})(\d)?$/);
  if (!match) return null;
  const marks = match[2];
  if (marks.includes("#") && marks.includes("b")) return null;
  const letter = match[1].toUpperCase();
  const acc = marks.includes("#") ? marks.length : marks.includes("b") ? -marks.length : 0;
  const oct = match[3] ? Number(match[3]) : carry.oct;
  carry.oct = oct;
  return (oct + 1) * 12 + LETTER_PC[letter] + acc;
}

export function parseLetters(text: string): ParseResult {
  const trimmed = text.trim();
  if (!trimmed) return { notes: [], error: null };
  const tokens = normalizeScoreText(text)
    .replace(/[|｜]/g, " ")
    .replace(/[，、]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const carry = { oct: 4 };
  const notes: ScoreNote[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (/^[-\u2014\uff0d]+$/.test(token)) {
      if (!notes.length)
        return fail(token, index, "\u524d\u9762\u6ca1\u6709\u97f3\u53ef\u5ef6\u957f");
      notes[notes.length - 1].dur += token.length;
      continue;
    }
    const slash = token.indexOf("/");
    const body = slash >= 0 ? token.slice(0, slash) : token;
    const spec = slash >= 0 ? token.slice(slash + 1) : "";
    const units = unitsFromSpec(spec);
    if (units == null) return fail(token, index, "\u7684\u65f6\u503c\u770b\u4e0d\u61c2");
    if (body === "z" || body === "Z" || body === "0" || body === "r") {
      notes.push({ pitches: [], dur: units / 12 });
      continue;
    }
    if (body.startsWith("[")) {
      const inner = body.replace(/^\[/, "").replace(/\]$/, "");
      const pieces = inner.split(/[,+]/).filter(Boolean);
      if (!pieces.length) return fail(token, index);
      const pitches: number[] = [];
      for (const piece of pieces) {
        const pitch = pitchFromToken(piece, carry);
        if (pitch == null) return fail(token, index);
        if (!pitches.includes(pitch)) pitches.push(pitch);
      }
      const over = chordOverLimit(pitches.length);
      if (over) return fail(token, index, over);
      notes.push({ pitches, dur: units / 12 });
      continue;
    }
    const pitch = pitchFromToken(body, carry);
    if (pitch == null) return fail(token, index);
    notes.push({ pitches: [pitch], dur: units / 12 });
  }
  return { notes, error: null };
}

const UNIT_SPEC: Record<number, string> = {
  48: "/w",
  36: "/dh",
  24: "/h",
  18: "/dq",
  9: "/de",
  6: "/e",
  3: "/s",
};

function letterName(midi: number, key: KeyName, mode: Mode): string {
  const spelled = spellMidi(midi, key, mode);
  const marks =
    spelled.acc > 0 ? "#".repeat(spelled.acc) : spelled.acc < 0 ? "b".repeat(-spelled.acc) : "";
  return `${spelled.letter}${marks}${spelled.octave}`;
}

function formatLetterNote(note: ScoreNote, key: KeyName, mode: Mode): string {
  const units = Math.max(1, Math.round(note.dur * 12));
  const suffix = units === 12 ? "" : (UNIT_SPEC[units] ?? `/*${units}`);
  if (!note.pitches.length) return `z${suffix}`;
  const pitches = [...note.pitches]
    .sort((a, b) => a - b)
    .map((midi) => letterName(midi, key, mode));
  const body = pitches.length === 1 ? pitches[0] : `[${pitches.join(",")}]`;
  return `${body}${suffix}`;
}

export function formatLetters(score: Score): string {
  const barU = barUnitCount(score.beats, score.beatUnit);
  const out: string[] = [];
  let pos = 0;
  for (const note of score.notes) {
    if (pos > 0 && pos % barU === 0) out.push("|");
    out.push(formatLetterNote(note, score.key, score.mode));
    pos += Math.max(1, Math.round(note.dur * 12));
  }
  return out.join(" ");
}

/**
 * Jianpu plus a `1 =` line and a meter.
 * The header names the written key (`shift` semitones above concert; 0 means concert).
 * Mode and the tonic octave are not in the text: paste keeps the score's current mode
 * and concert tonic octave, then places degree 1 in that register.
 */
export function jianpuShareText(score: Score, shift = 0): string {
  const written = shift === 0 ? score : transposeScore(score, shift);
  return `1 = ${keyLabel(written.key)}\n${written.beats}/${written.beatUnit}\n${formatJianpu(written)}`;
}

const KEY_FROM_LABEL: Record<string, KeyName> = {};
for (const key of KEY_NAMES) {
  KEY_FROM_LABEL[key] = key;
  KEY_FROM_LABEL[key.toLowerCase()] = key;
  KEY_FROM_LABEL[keyLabel(key)] = key;
}
Object.assign(KEY_FROM_LABEL, {
  "C#": "Db",
  升C: "Db",
  "D#": "Eb",
  升D: "Eb",
  Gb: "F#",
  降G: "F#",
  "G#": "Ab",
  升G: "Ab",
  "A#": "Bb",
  升A: "Bb",
} satisfies Record<string, KeyName>);

export function keyFromLabel(label: string): KeyName | null {
  const token = label.trim().replace(/[（(].*$/, "");
  return KEY_FROM_LABEL[token] ?? null;
}

export type JianpuHeader = {
  /** Written key when an instrument shift is in use; concert key when shift is 0. */
  key: KeyName | null;
  beats: number | null;
  beatUnit: number | null;
  error: string | null;
};

/** Read a leading `1 = 调名` and/or meter. Same rules as `splitJianpuHeader`. */
export function readJianpuHeader(text: string): JianpuHeader {
  const split = splitJianpuHeader(text);
  if (!split.ok) return { key: null, beats: null, beatUnit: null, error: split.error };
  return { key: split.key, beats: split.beats, beatUnit: split.beatUnit, error: null };
}

export type ImportedJianpu = {
  key: KeyName;
  beats: number;
  beatUnit: number;
  tonicOctave: number;
  notes: ScoreNote[];
  error: string | null;
};

/**
 * Parse a Jianpu box. A leading `1 =` names the written key (concert key when
 * `instrumentShift` is 0). Sounding pitches are that written part minus the shift.
 * Without a header, degrees stay in the current concert key.
 * On a header error the returned key, meter, and tonic octave are the current
 * score's — callers must ignore `notes` when `error` is set and leave state unchanged.
 * Mode is never taken from the text.
 */
export function importJianpu(
  text: string,
  current: Pick<Score, "key" | "mode" | "tonicOctave" | "beats" | "beatUnit">,
  instrumentShift = 0,
): ImportedJianpu {
  const split = splitJianpuHeader(text);
  if (!split.ok) {
    return {
      key: current.key,
      beats: current.beats,
      beatUnit: current.beatUnit,
      tonicOctave: current.tonicOctave,
      notes: [],
      error: split.error,
    };
  }
  const beats = split.beats ?? current.beats;
  const beatUnit = split.beatUnit ?? current.beatUnit;
  if (!split.key) {
    const parsed = parseJianpu(split.body, { ...current, beats, beatUnit });
    return {
      key: current.key,
      beats,
      beatUnit,
      tonicOctave: current.tonicOctave,
      notes: parsed.notes,
      error: parsed.error,
    };
  }
  const concertKey = transposeKey(split.key, -instrumentShift);
  const writtenOctave =
    Math.floor((tonicMidi(concertKey, current.tonicOctave) + instrumentShift) / 12) - 1;
  const parsed = parseJianpu(split.body, {
    key: split.key,
    mode: current.mode,
    tonicOctave: writtenOctave,
    beats,
    beatUnit,
  });
  const notes =
    instrumentShift === 0
      ? parsed.notes
      : parsed.notes.map((note) => ({
          ...note,
          pitches: note.pitches.map((pitch) => pitch - instrumentShift),
        }));
  return {
    key: concertKey,
    beats,
    beatUnit,
    tonicOctave: current.tonicOctave,
    notes,
    error: parsed.error,
  };
}

/** One line under the title: written key when an instrument is selected, plus the sounding key. */
export function staffCaption(score: Score, shift = 0): string {
  const writtenKey = transposeKey(score.key, shift);
  const meter = `${score.beats}/${score.beatUnit} · ${score.bpm}`;
  const written = `${keyTitle(writtenKey, score.mode)} · 1 = ${keyLabel(writtenKey)} · ${meter}`;
  if (shift === 0) return written;
  return `记谱 ${written} · 实际 ${keyTitle(score.key, score.mode)}`;
}

function abcAcc(noteAcc: number, keyAcc: number): string {
  if (noteAcc === keyAcc) return "";
  if (noteAcc === 0) return "=";
  if (noteAcc === 1) return "^";
  if (noteAcc === -1) return "_";
  if (noteAcc === 2) return "^^";
  if (noteAcc === -2) return "__";
  return "";
}

function abcPitch(letter: string, octave: number): string {
  if (octave >= 5) return letter.toLowerCase() + "'".repeat(octave - 5);
  return letter.toUpperCase() + ",".repeat(Math.max(0, 4 - octave));
}

/** ABC notehead name for one written MIDI pitch, with the same accidentals the staff prints. */
export function abcNoteName(midi: number, key: KeyName, mode: Mode): string {
  const spelled = spellMidi(midi, key, mode);
  const signature = scaleAccidentals(key, mode);
  return (
    abcAcc(spelled.acc, signature[spelled.letter] ?? 0) + abcPitch(spelled.letter, spelled.octave)
  );
}

function decompose(units: number): number[] {
  let left = Math.max(3, Math.round(units / 3) * 3);
  const parts: number[] = [];
  while (left > 0) {
    const take = STANDARD.find((value) => value <= left) ?? 3;
    parts.push(take);
    left -= take;
  }
  return parts;
}

type Chunk = {
  units: number;
  pitches: number[];
  tieEnd: boolean;
  tuplet: boolean;
  written: number;
  chords: number[][];
  index: number;
  indices: number[];
};

function expand(notes: ScoreNote[]): Chunk[] {
  const chunks: Chunk[] = [];
  let i = 0;
  while (i < notes.length) {
    const units = Math.max(1, Math.round(notes[i].dur * 12));
    const next = i + 2 < notes.length ? Math.round(notes[i + 1].dur * 12) : -1;
    const third = i + 2 < notes.length ? Math.round(notes[i + 2].dur * 12) : -1;
    if (next === units && third === units && !STANDARD_SET.has(units)) {
      const written = (units * 3) / 2;
      if (Number.isInteger(written) && STANDARD_SET.has(written)) {
        chunks.push({
          units: units * 3,
          pitches: [],
          tieEnd: false,
          tuplet: true,
          written,
          chords: [notes[i].pitches, notes[i + 1].pitches, notes[i + 2].pitches],
          index: i,
          indices: [i, i + 1, i + 2],
        });
        i += 3;
        continue;
      }
    }
    const parts = STANDARD_SET.has(units) ? [units] : decompose(units);
    parts.forEach((part, index) => {
      chunks.push({
        units: part,
        pitches: notes[i].pitches,
        tieEnd: index < parts.length - 1,
        tuplet: false,
        written: part,
        chords: [],
        index: i,
        indices: [],
      });
    });
    i += 1;
  }
  return chunks;
}

let includeFingering = false;

function renderPitch(
  pitches: number[],
  units: number,
  key: KeyName,
  mode: Mode,
  tie: boolean,
  note?: ScoreNote,
): string {
  if (!pitches.length) return `z${units}${tie ? "-" : ""}`;
  const heads = [...pitches].sort((a, b) => a - b).map((midi) => `${abcFingerPrefix(note, midi, includeFingering)}${abcNoteName(midi, key, mode)}`);
  const body = heads.length === 1 ? heads[0] : `[${heads.join("")}]`;
  return `${body}${units}${tie ? "-" : ""}`;
}

type Place = "both" | "head" | "tail" | "mid";

type Token = { text: string; index: number | null; atom: LyricAtom | null };

function lyricAtom(note: ScoreNote | undefined, place: Place): LyricAtom | null {
  if (!note?.pitches.length) return null;
  if (place !== "both" && place !== "head") return { kind: "skip" };
  const lyric = cleanLyric(note.lyric);
  const followed = Array.isArray(lyric?.fragments)
    ? lyric.fragments.length > 0
    : Boolean(lyric?.extendEnd || lyric?.extendEndBare);
  if (!lyric || (!lyric.text && !lyric.extend && !followed)) return { kind: "skip" };
  if (!lyric.text && (lyric.extend || followed)) return { kind: "hold" };
  if (lyric.text && !lyric.extend && followed) {
    return { kind: "syllable", lyric: { ...lyric, extend: true } };
  }
  return { kind: "syllable", lyric };
}

export type StaffHit = {
  index: number;
  start: number;
  end: number;
  /** 0 is voice 1. Hits engraved before voice ids existed are voice 1. */
  voice?: number;
};

function graceToken(midi: number, key: KeyName, mode: Mode): string {
  const spelled = spellMidi(Math.round(midi), key, mode);
  const signature = scaleAccidentals(key, mode);
  return (
    abcAcc(spelled.acc, signature[spelled.letter] ?? 0) + abcPitch(spelled.letter, spelled.octave)
  );
}

/**
 * abcjs reads decorations, then a slur, then a staccato dot, then the note.
 * The dot has to follow the slur parenthesis or it becomes a dotted slur.
 */
function markedToken(
  pitches: number[],
  units: number,
  key: KeyName,
  mode: Mode,
  tie: boolean,
  note: ScoreNote | undefined,
  place: Place,
  notes: ScoreNote[],
  index: number,
  leadTuplet: boolean,
): string {
  const body = renderPitch(pitches, units, key, mode, false, note);
  const head = place === "head" || place === "both";
  const tail = place === "tail" || place === "both";
  let prefix = leadTuplet ? "(3" : "";
  // The wedge stops at the attack of the end note, not after a tied continuation.
  if (head && note) {
    const closing = closingHairpin(notes, index);
    if (closing === "cresc") prefix += "!<)!";
    if (closing === "dim") prefix += "!>)!";
  }
  if (head && note?.dynamic) prefix += `!${note.dynamic}!`;
  if (head && note?.hairpin === "cresc") prefix += "!<(!";
  if (head && note?.hairpin === "dim") prefix += "!>(!";
  if (head && note?.articulations?.includes("accent")) prefix += "!accent!";
  if (head && note?.articulations?.includes("tenuto")) prefix += "!tenuto!";
  if (head && note?.ornament === "trill" && pitches.length) prefix += "!trill!";
  if (head && note?.ornament === "arpeggio" && pitches.length > 1) prefix += "!arpeggio!";
  if (head && note && pitches.length) {
    const grace = gracePitchOf(note, key, mode);
    if (grace != null) {
      const token = graceToken(grace, key, mode);
      prefix += note.ornament === "appoggiatura" ? `{${token}}` : `{/${token}}`;
    }
  }
  if (head && note?.slurStart) prefix += "(";
  if (head && note?.articulations?.includes("staccato") && pitches.length) prefix += ".";
  const suffix = `${tie ? "-" : ""}${tail && note?.slurEnd ? ")" : ""}`;
  return `${prefix}${body}${suffix}`;
}

function shiftNote(note: ScoreNote, shift: number): ScoreNote {
  if (!shift) return note;
  const next: ScoreNote = { ...note, pitches: note.pitches.map((pitch) => pitch + shift) };
  if (note.articulations) next.articulations = note.articulations.slice();
  if (typeof note.gracePitch === "number") next.gracePitch = note.gracePitch + shift;
  return next;
}

function bestHit(hits: StaffHit[], start: number, end: number): StaffHit | null {
  let best: StaffHit | null = null;
  for (const hit of hits) {
    const overlaps = start < hit.end && end > hit.start;
    const near = start >= hit.start - 1 && start < hit.end;
    if (!overlaps && !near) continue;
    if (!best || hit.start > best.start) best = hit;
  }
  return best;
}

/** Map a click on the engraved ABC back to a voice and a note in that voice. */
export function staffTargetAt(
  hits: StaffHit[],
  start: number,
  end: number,
): { voice: number; index: number } | null {
  const hit = bestHit(hits, start, end);
  if (!hit) return null;
  return { voice: hit.voice ?? 0, index: hit.index };
}

/** Map a click back to a note index. Voice 1 and voice 2 can share an index. */
export function noteIndexAt(hits: StaffHit[], start: number, end: number): number | null {
  return staffTargetAt(hits, start, end)?.index ?? null;
}

type TimedToken = Token & { units: number; at?: number };

function stampTokenTimes(bars: TimedToken[][]): TimedToken[][] {
  let at = 0;
  for (const bar of bars) {
    for (const token of bar) {
      token.at = at;
      at += (token.units || 0) / 12;
    }
  }
  return bars;
}

function layoutBars(notes: ScoreNote[], key: KeyName, mode: Mode, barU: number): TimedToken[][] {
  const source = expand(notes);
  const bars: TimedToken[][] = [[]];
  let fill = 0;
  const atQ = 0;
  const seen = new Set<number>();
  const placeFor = (index: number, atEnd: boolean): Place => {
    const atStart = !seen.has(index);
    seen.add(index);
    if (atStart && atEnd) return "both";
    if (atStart) return "head";
    if (atEnd) return "tail";
    return "mid";
  };
  source.forEach((chunk, chunkIndex) => {
    if (chunk.tuplet) {
      if (fill > 0 && fill + chunk.units > barU) {
        bars.push([]);
        fill = 0;
      }
      chunk.chords.forEach((pitches, chordIndex) => {
        const index = chunk.indices[chordIndex] ?? chunk.index;
        const place = placeFor(index, true);
        bars[bars.length - 1].push({
          text: markedToken(
            pitches,
            chunk.written,
            key,
            mode,
            false,
            notes[index],
            place,
            notes,
            index,
            chordIndex === 0,
          ),
          index,
          atom: lyricAtom(notes[index], place),
          units: chunk.units / 3,
        });
      });
      fill += chunk.units;
      if (fill >= barU - 0.1) {
        bars.push([]);
        fill = 0;
      }
      return;
    }
    const noteEnds = source[chunkIndex + 1]?.index !== chunk.index;
    let left = chunk.units;
    while (left > 0) {
      const room = barU - fill;
      if (room <= 0) {
        bars.push([]);
        fill = 0;
        continue;
      }
      const take = STANDARD.find((value) => value <= Math.min(left, room)) ?? Math.min(left, room);
      const last = take === left;
      const place = placeFor(chunk.index, last && noteEnds);
      bars[bars.length - 1].push({
        text: markedToken(
          chunk.pitches,
          take,
          key,
          mode,
          !last || chunk.tieEnd,
          notes[chunk.index],
          place,
          notes,
          chunk.index,
          false,
        ),
        index: chunk.index,
        atom: lyricAtom(notes[chunk.index], place),
        units: take,
      });
      left -= take;
      fill += take;
      if (fill >= barU - 0.1) {
        bars.push([]);
        fill = 0;
      }
    }
  });
  while (bars.length && bars[bars.length - 1].length === 0) bars.pop();
  if (!bars.length) bars.push([{ text: `z${barU}`, index: null, atom: null, units: barU }]);
  return stampTokenTimes(bars);
}

function timelineBars(notes: ScoreNote[], score: Score, shift: number, target: number): TimedToken[][] {
  const bars: TimedToken[][] = [[]];
  let at = 0;
  const append = (note: ScoreNote, index: number | null) => {
    let left = note.dur, first = true;
    while (left > 1e-8) {
      const active = stateAt(score, at);
      const c = score.changes?.find(c => Math.abs(c.at-at)<1e-8);
      if (c) bars.at(-1)!.push({ text: [c.beats !== undefined ? `[M:${c.beats}/${c.beatUnit}]` : '', c.key !== undefined ? `[K:${transposeKey(c.key, shift)}${c.mode === 'minor' ? 'min' : ''}]` : '', c.bpm !== undefined ? `[Q:1/4=${c.bpm}]` : ''].join(''), index: null, atom: null, units: 0 });
      const boundary = nextBar(score, at);
      const available = Math.min(left, boundary-at, nextChange(score, at)-at);
      const units = STANDARD.find(u => u <= available*12+1e-8) ?? available*12;
      const take = units/12;
      const last = left-take < 1e-8;
      const place = first ? (last ? 'both' : 'head') : (last ? 'tail' : 'mid');
      bars.at(-1)!.push({ text: markedToken(note.pitches, units, transposeKey(active.key,shift), active.mode, !last, note, place, notes, index ?? 0, false), index, atom: lyricAtom(note,place), units });
      first = false; left -= take; at += take;
      if (Math.abs(at-boundary)<1e-8) bars.push([]);
    }
  };
  notes.forEach((n,i) => append(n,i));
  if (at < target-1e-8) append({ pitches: [], dur: target-at }, null);
  while (bars.length > 1 && !bars.at(-1)!.length) bars.pop();
  return stampTokenTimes(bars);
}

function restTokens(units: number): TimedToken[] {
  const tokens: TimedToken[] = [];
  let left = Math.max(0, Math.round(units));
  while (left > 0) {
    const take = STANDARD.find((value) => value <= left) ?? left;
    tokens.push({ text: `z${take}`, index: null, atom: null, units: take });
    left -= take;
  }
  return tokens;
}

/** Pad engraving only. The score's own notes are not given these rests. */
function alignBars(bars: TimedToken[][], barU: number, target: number): TimedToken[][] {
  const next = bars.map((bar) => bar.slice());
  if (!next.length) next.push([]);
  const last = next[next.length - 1];
  const used = last.reduce((sum, token) => sum + token.units, 0);
  if (used + 0.1 < barU) last.push(...restTokens(barU - used));
  while (next.length < target) next.push(restTokens(barU));
  return stampTokenTimes(next);
}

/** Bar line text between bar `closing` and bar `opening` (null at a line edge); repeats.ts supplies it. */
export type AbcBarText = (closing: number | null, opening: number | null, voice: number) => string;

function writeVoice(
  bars: TimedToken[][],
  notes: ScoreNote[],
  voice: number,
  into: { body: string; hits: StaffHit[] },
  symbols?: readonly ChordSymbol[],
  barText?: AbcBarText,
  score?: Score,
) {
  const hasLyrics = scoreHasLyrics(notes);
  const add = (text: string, index: number | null) => {
    const start = into.body.length;
    into.body += text;
    if (index != null && text.length) {
      into.hits.push({ voice, index, start, end: into.body.length });
    }
  };
  for (let i = 0; i < bars.length; i += 4) {
    if (i > 0) add("\n", null);
    const lineAtoms: LyricAtom[] = [];
    const group = bars.slice(i, i + 4);
    group.forEach((bar, barIndex) => {
      if (barIndex > 0 || barText) add(barText ? barText(barIndex ? i + barIndex - 1 : null, i + barIndex, voice) : " | ", null);
      const separators = score ? beamSeparators(bar, score) : [];
      bar.forEach((token, tokenIndex) => {
        if (tokenIndex > 0) add(separators[tokenIndex] ?? " ", null);
        if (token.atom) lineAtoms.push(token.atom);
        const chord = voice === 0 && token.at != null
          ? symbols?.find((item) => Math.abs(item.at - token.at!) < 1e-7)
          : undefined;
        const tokenText = chord && abcChordToken(chord.symbol)
          ? `"${abcChordToken(chord.symbol)}"${token.text}`
          : token.text;
        add(tokenText, token.index);
      });
    });
    add(barText ? barText(i + group.length - 1, null, voice) : " |", null);
    if (hasLyrics) {
      const lyricLine = formatAbcLyrics(lineAtoms);
      if (lyricLine) add(`\n${lyricLine}`, null);
    }
  }
}

export function engraveAbc(score: Score, instrumentShift = 0, options?: { leadSheet?: boolean; fingering?: boolean; bars?: AbcBarText }): { abc: string; hits: StaffHit[] } {
  includeFingering = Boolean(options?.fingering);
  const key = transposeKey(score.key, instrumentShift);
  const mode: Mode = score.mode;
  const barU = barUnitCount(score.beats, score.beatUnit);
  const voices = (options?.leadSheet ? [score.notes] : voiceList(score)).map(v => v.map(note => shiftNote(note, instrumentShift)));
  const layouts = voices.map(v => layoutBars(v, key, mode, barU));
  if (voices.length > 1) {
    const target = Math.max(...layouts.map(v => v.length), 1);
    layouts.forEach((v,i) => { layouts[i] = alignBars(v, barU, target); });
  }

  if (score.changes?.length) {
    const target = Math.max(...voices.map(v => v.reduce((n,x) => n+x.dur,0)));
    voices.forEach((v,i) => { layouts[i] = timelineBars(v, score, instrumentShift, target); });
  }
  const writtenSymbols = instrumentShift
    ? transposeChordSymbols(score.chordSymbols, instrumentShift, key, mode).symbols
    : score.chordSymbols;
  const into: { body: string; hits: StaffHit[] } = { body: "", hits: [] };
  layouts.forEach((bars, index) => {
    if (layouts.length > 1) {
      if (into.body) into.body += "\n";
      const name = index === 0 ? "声部一" : index === 1 ? "声部二" : `声部${index + 1}`;
      const clefForVoice = voiceClef(score, index);
      into.body += `V:${index + 1} ${isGrandStaff(score) ? "" : `name="${name}" `}clef=${clefForVoice}\n`;
    }
    writeVoice(bars, voices[index] ?? [], index, into, writtenSymbols, options?.bars, score);
  });

  const hasLyrics = voices.some((notes) => scoreHasLyrics(notes));
  const clef = score.clef === "bass" ? " clef=bass" : "";
  const keyField = mode === "minor" ? `${key}min` : key;
  const headLines = [
    "X:1",
    `M:${score.beats}/${score.beatUnit}`,
    "L:1/48",
    `Q:1/4=${Math.round(score.bpm)}`,
  ];
  if (layouts.length > 1) headLines.push("%%score {1 | 2}");
  if (hasLyrics) headLines.push('%%vocalfont "WenQuanYi Micro Hei" 15');
  headLines.push(`K:${keyField}${clef}`, "");
  const head = headLines.join("\n");
  return {
    abc: head + into.body,
    hits: into.hits.map((hit) => ({
      voice: hit.voice,
      index: hit.index,
      start: hit.start + head.length,
      end: hit.end + head.length,
    })),
  };
}

export function toAbc(score: Score, instrumentShift = 0): string {
  return engraveAbc(score, instrumentShift).abc;
}
