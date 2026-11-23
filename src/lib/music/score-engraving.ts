import { beamSeparators } from "./staff-beaming.ts";
// Correctness path kept in the lazy editor to preserve the pinned first-screen bundle.
import { engraveAbc as legacyEngraveAbc } from "./notation.ts";
import { abcRhythm, exactRhythm, rhythmPieces } from "./rhythm-spelling.ts";
import { voiceList, voiceClef, isGrandStaff } from "./voices.ts";
import { nextBar, nextChange, stateAt } from "./score-timeline.ts";
import { closingHairpin, gracePitchOf } from "./expression.ts";
import { cleanLyric, scoreHasLyrics, type LyricAtom } from "./lyrics.ts";
import { type ChordSymbol } from "./chord-symbol.ts";
import {
  type KeyName,
  type Mode,
  type Score,
  type ScoreNote,
  spellMidi,
  scaleAccidentals,
  transposeKey,
  transposeScore,
} from "./theory.ts";

const STANDARD = [48, 36, 24, 18, 12, 9, 6, 3];
const STANDARD_SET = new Set(STANDARD);
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
  return abcAcc(spelled.acc, Number.NaN) + abcPitch(spelled.letter, spelled.octave);
}

/** One instance per voice; only generated pitches enter this state. */
class AccidentalState {
  private values = new Map<string, number>();
  reset() { this.values.clear(); }
  pitch(midi: number, key: KeyName, mode: Mode, continuation = false): string {
    const spelled = spellMidi(midi, key, mode);
    const name = abcPitch(spelled.letter, spelled.octave);
    // A tie carries its pitch across a bar but does not alter the new bar's defaults.
    if (continuation) return name;
    const previous = this.values.get(name) ?? scaleAccidentals(key, mode)[spelled.letter] ?? 0;
    this.values.set(name, spelled.acc);
    return abcAcc(spelled.acc, previous) + name;
  }
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

function expand(notes: ScoreNote[], barU: number): Chunk[] {
  const chunks: Chunk[] = [];
  let i = 0;
  let elapsed = 0;
  while (i < notes.length) {
    const units = exactRhythm(notes[i].dur) * 12;
    const next = i + 2 < notes.length ? exactRhythm(notes[i + 1].dur) * 12 : -1;
    const third = i + 2 < notes.length ? exactRhythm(notes[i + 2].dur) * 12 : -1;
    if (
      next === units &&
      third === units &&
      !STANDARD_SET.has(units) &&
      (elapsed % barU) + units * 3 <= barU + 1e-8
    ) {
      const written = (units * 3) / 2;
      if (Number.isInteger(written) && STANDARD_SET.has(written) &&
          !(written === 48 && notes.slice(i, i + 3).some(n => !n.pitches.length))) {
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
        elapsed += units * 3;
        i += 3;
        continue;
      }
    }
    const parts = rhythmPieces(units / 12).map((d) => d * 12);
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
    elapsed += units;
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
  accidentals?: AccidentalState,
  continuation = false,
): string {
  const rhythm = abcRhythm(units);
  if (!pitches.length) {
    // abcjs interprets a whole rest as the current meter, even in a source cadenza.
    if (rhythm.length === "48") return `${rhythm.prefix.replace(/:1$/, ":2")}z24 z24`;
    return `${rhythm.prefix}z${rhythm.length}`;
  }
  const heads = [...pitches]
    .sort((a, b) => a - b)
    .map(
      (midi) => `${abcFingerPrefix(note, midi, includeFingering)}${accidentals ? accidentals.pitch(midi, key, mode, continuation) : abcNoteName(midi, key, mode)}`,
    );
  const body = heads.length === 1 ? heads[0] : `[${heads.join("")}]`;
  return `${rhythm.prefix}${body}${rhythm.length}${tie ? "-" : ""}`;
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
  accidentals: AccidentalState,
): string {
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
      const token = accidentals.pitch(Math.round(grace), key, mode);
      prefix += note.ornament === "appoggiatura" ? `{${token}}` : `{/${token}}`;
    }
  }
  if (head && note?.slurStart) prefix += "(";
  if (head && note?.articulations?.includes("staccato") && pitches.length) prefix += ".";
  const body = renderPitch(pitches, units, key, mode, false, note, accidentals, !head);
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
  const accidentals = new AccidentalState();
  const source = expand(notes, barU);
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
        accidentals.reset();
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
            accidentals,
          ),
          index,
          atom: lyricAtom(notes[index], place),
          units: chunk.units / 3,
        });
      });
      fill += chunk.units;
      if (fill >= barU - 1e-8) {
        bars.push([]);
        accidentals.reset();
        fill = 0;
      }
      return;
    }
    const noteEnds = source[chunkIndex + 1]?.index !== chunk.index;
    let left = chunk.units;
    while (left > 1e-8) {
      const room = barU - fill;
      if (room <= 1e-8) {
        bars.push([]);
        accidentals.reset();
        fill = 0;
        continue;
      }
      const take = rhythmPieces(Math.min(left, room) / 12)[0] * 12;
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
          accidentals,
        ),
        index: chunk.index,
        atom: lyricAtom(notes[chunk.index], place),
        units: take,
      });
      left -= take;
      fill += take;
      if (fill >= barU - 1e-8) {
        bars.push([]);
        accidentals.reset();
        fill = 0;
      }
    }
  });
  while (bars.length && bars[bars.length - 1].length === 0) bars.pop();
  if (!bars.length) bars.push([{ text: `z${barU}`, index: null, atom: null, units: barU }]);
  return stampTokenTimes(bars);
}

function timelineBars(
  notes: ScoreNote[],
  score: Score,
  shift: number,
  target: number,
): TimedToken[][] {
  const bars: TimedToken[][] = [[]];
  let at = 0;
  const accidentals = new AccidentalState();
  const append = (note: ScoreNote, index: number | null) => {
    let left = exactRhythm(note.dur),
      first = true;
    while (left > 1e-8) {
      const active = stateAt(score, at);
      const c = score.changes?.find((c) => Math.abs(c.at - at) < 1e-8);
      if (c?.key !== undefined) accidentals.reset();
      if (c)
        bars.at(-1)!.push({
          text: [
            c.beats !== undefined ? `[M:${c.beats}/${c.beatUnit}]` : "",
            c.key !== undefined
              ? `[K:${transposeKey(c.key, shift)}${c.mode === "minor" ? "min" : ""}]`
              : "",
            c.bpm !== undefined ? `[Q:1/4=${c.bpm}]` : "",
          ].join(""),
          index: null,
          atom: null,
          units: 0,
        });
      const boundary = nextBar(score, at);
      const available = Math.min(left, boundary - at, nextChange(score, at) - at);
      const units = rhythmPieces(available)[0] * 12;
      const take = units / 12;
      const last = left - take < 1e-8;
      const place = first ? (last ? "both" : "head") : last ? "tail" : "mid";
      bars.at(-1)!.push({
        text: markedToken(
          note.pitches,
          units,
          transposeKey(active.key, shift),
          active.mode,
          !last,
          note,
          place,
          notes,
          index ?? 0,
          false,
          accidentals,
        ),
        index,
        atom: lyricAtom(note, place),
        units,
      });
      first = false;
      left -= take;
      at += take;
      if (Math.abs(at - boundary) < 1e-8) {
        bars.push([]);
        accidentals.reset();
      }
    }
  };
  notes.forEach((n, i) => append(n, i));
  if (at < target - 1e-8) append({ pitches: [], dur: target - at }, null);
  while (bars.length > 1 && !bars.at(-1)!.length) bars.pop();
  return stampTokenTimes(bars);
}

function restTokens(units: number): TimedToken[] {
  const tokens: TimedToken[] = [];
  let left = Math.max(0, units);
  while (left > 1e-8) {
    const take = rhythmPieces(left / 12)[0] * 12;
    const rhythm = abcRhythm(take);
    tokens.push({
      text: `${rhythm.prefix}z${rhythm.length}`,
      index: null,
      atom: null,
      units: take,
    });
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
  if (used + 1e-8 < barU) last.push(...restTokens(barU - used));
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
      if (barIndex > 0 || barText)
        add(
          barText ? barText(barIndex ? i + barIndex - 1 : null, i + barIndex, voice) : " | ",
          null,
        );
      const separators = score ? beamSeparators(bar, score) : [];
      bar.forEach((token, tokenIndex) => {
        if (tokenIndex > 0) add(separators[tokenIndex] ?? " ", null);
        if (token.atom) lineAtoms.push(token.atom);
        const chord =
          voice === 0 && token.at != null
            ? symbols?.find((item) => Math.abs(item.at - token.at!) < 1e-7)
            : undefined;
        const tokenText =
          chord && abcChordToken(chord.symbol)
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

function exactEngraveAbc(
  score: Score,
  instrumentShift = 0,
  options?: { leadSheet?: boolean; fingering?: boolean; bars?: AbcBarText },
): { abc: string; hits: StaffHit[] } {
  includeFingering = Boolean(options?.fingering);
  const key = transposeKey(score.key, instrumentShift);
  const mode: Mode = score.mode;
  const barU = score.beats * Math.round(48 / score.beatUnit);
  const voices = (options?.leadSheet ? [score.notes] : voiceList(score)).map((v) =>
    v.map((note) => shiftNote(note, instrumentShift)),
  );
  const layouts = voices.map((v) => layoutBars(v, key, mode, barU));
  if (voices.length > 1) {
    const target = Math.max(...layouts.map((v) => v.length), 1);
    layouts.forEach((v, i) => {
      layouts[i] = alignBars(v, barU, target);
    });
  }

  if (score.changes?.length || score.measureEnds?.length) {
    const target = Math.max(...voices.map((v) => v.reduce((n, x) => n + x.dur, 0)));
    voices.forEach((v, i) => {
      layouts[i] = timelineBars(v, score, instrumentShift, target);
    });
  }
  const writtenSymbols = instrumentShift
    ? transposeScore(score, instrumentShift).chordSymbols
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
  if (layouts.length > 1) headLines.push(`%%score {${layouts.map((_, i) => i + 1).join(" | ")}}`);
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

export function engraveAbc(
  score: Score,
  instrumentShift = 0,
  options?: Parameters<typeof legacyEngraveAbc>[2],
): ReturnType<typeof legacyEngraveAbc> {
  if (!score.notes.length && voiceList(score).length === 1 && !score.changes?.length)
    return legacyEngraveAbc(score, instrumentShift, options);
  return exactEngraveAbc(score, instrumentShift, options);
}

export function toAbc(score: Score, instrumentShift = 0): string {
  return engraveAbc(score, instrumentShift).abc;
}

// These small ABC adapters stay local: exporting new helpers from score-core would
// change its pinned bytes. The legacy implementation remains available for empty scores.
function abcChordToken(symbol: string): string {
  return symbol.replace(/["\\]/g, "").trim();
}
function abcFingerPrefix(note: ScoreNote | undefined, midi: number, enabled: boolean): string {
  const finger = enabled && note?.fingers?.[note.pitches.indexOf(midi)];
  return typeof finger === "number" && Number.isInteger(finger) && finger >= 1 && finger <= 5
    ? `"_${finger}"`
    : "";
}
function escapeLyric(text: string): string {
  return text
    .replace(/\\/g, "")
    .replace(/~/g, "～")
    .replace(/ /g, "~")
    .replace(/([*_|-])/g, "\\$1")
    .replace(/%/g, "\\%");
}

/** ABC `w:` body for one music line. Null when that line has nothing to print. */
function formatAbcLyrics(atoms: readonly LyricAtom[]): string | null {
  if (!atoms.some((atom) => atom.kind !== "skip")) return null;
  const parts: string[] = [];
  for (let i = 0; i < atoms.length; i += 1) {
    const atom = atoms[i];
    if (!atom || atom.kind === "skip") {
      parts.push("*");
      continue;
    }
    if (atom.kind === "hold") {
      parts.push("_");
      continue;
    }
    let token = escapeLyric(atom.lyric.text);
    if (!token) {
      parts.push("*");
      continue;
    }
    const hyphen = atom.lyric.syllabic === "begin" || atom.lyric.syllabic === "middle";
    const next = atoms[i + 1];
    // `_` both draws the extender and consumes one following note on this line.
    // Do not attach it when the next slot is a real syllable. Extra holds and
    // tie fragments in the span are further `_` skips. A trailing `_` with no
    // note left on this line still draws the glyph; the next system blanks its
    // own holds.
    if (atom.lyric.extend === true && (!next || next.kind !== "syllable")) {
      token += "_";
      if (next) i += 1;
      while (i + 1 < atoms.length && atoms[i + 1]?.kind !== "syllable") {
        parts.push(token);
        token = "_";
        i += 1;
      }
    } else if (hyphen) token += "-";
    parts.push(token);
  }
  return `w: ${parts.join(" ")}`;
}
