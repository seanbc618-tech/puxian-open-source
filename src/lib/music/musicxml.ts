import { voiceList, voiceClef } from "./voices.ts";
import { canonicalChanges, changeBeatUnit, clampChangeBeats, clampChangeBpm, nextBar, nextChange, stateAt } from "./score-timeline.ts";
import type { ScoreChange, ScoreJumps, ScoreRepeat } from "./theory.ts";
import { barLines, jumpMarks, jumpProblem, keepValidRepeats, repeatProblem } from "./repeats.ts";
import { closingHairpin, gracePitchOf } from "./expression.ts";
import { cleanLyric } from "./lyrics.ts";
import {
  CHORD_TONE_LIMIT,
  KEY_NAMES,
  guessKey,
  inferTonicOctave,
  scaleAccidentals,
  spellMidi,
  transposeKey,
  type Articulation,
  type Clef,
  type DynamicMark,
  type Hairpin,
  type KeyName,
  type Mode,
  type LyricExtendType,
  type LyricFragment,
  type NoteLyric,
  type Ornament,
  type Score,
  type ScoreNote,
} from "./theory.ts";
import {
  MUSICXML_KIND,
  canonicalChordSymbols,
  chordFromMusicXml,
  parseChordSymbol,
} from "./chord-symbol.ts";
import { canonicalRehearsals } from "./rehearsals.ts";
import { canonicalFermatas } from "./fermata.ts";
import type { GradualKind, GradualTempo, ScoreWithGradual } from "./gradual-tempo.ts";
import { cleanCredit } from "./score-credits.ts";

/**
 * MusicXML 3.1 partwise at concert (sounding) pitch.
 * Same notes MIDI export writes: instrument buttons do not change the file.
 * A part `<transpose>` is applied on import unless `<concert-score/>` is set,
 * using the `number` of the staff that was kept. A written clarinet part comes
 * back as sounding pitch. Cue notes keep their time as rests. A tie on only
 * one chord tone does not lengthen the whole chord.
 * Dynamics p/mp/mf/f, staccato, accent, tenuto, one slur layer, wedges,
 * trills, and a single grace note are kept. A slashed grace is an
 * acciaccatura; an unslashed grace stays an appoggiatura. A run of grace
 * notes is not. A direction is placed by its time, offset, voice, and staff,
 * so another voice cannot take it. A hairpin ends at the start of its end
 * note, including when that note is tied across a bar.
 * Lead-sheet chord symbols (`<harmony>`) are kept: common triads and sevenths
 * round-trip; an unrecognised mark is stored as text and mentioned in the
 * import notice, and the rest of the file is still read.
 * Mid-score tempo (`<sound tempo>` / metronome), time (`<time>`), and key (`<key>` fifths/mode) are kept in `Score.changes`. Fermatas round-trip. Gradual rit./accel. (`<words>` plus `<dashes>`, with a target `<sound tempo>` when there is no new metronome mark) are kept in `gradualTempos` and are not listed as lost text.
 * Verse 1 lyrics are kept: text, syllabic, and extend. A chord gets the
 * lyric on its first note. A rest lyric is skipped and does not move later
 * syllables. A tie keeps the first fragment's lyric. Other verses are not
 * flattened onto verse 1. An extender keeps start, continue, and stop.
 * A stop with no text still occupies that note.
 * The first part that contains a pitch is kept. Inside it, up to sixteen timelines
 * stay in file order. A timeline is one `<voice>` on one `<staff>`, rests included.
 * A later pitch does not move ahead of an earlier rest. Backup and forward set
 * onset, so two rhythms stay aligned and are not stacked into one chord.
 * A seventeenth timeline, or another pitched part, is reported and left out.
 * A rest-only part is not promoted into a voice.
 * Chord tones on a timeline are kept, up to eight.
 */

const DIV = 48;

export type MusicXmlImport = {
  score: Score;
  /** What was kept, and what was left out. */
  notice: string;
  /** Itemized "本次导入丢失了什么" list; empty when nothing was dropped or flattened. */
  losses: string[];
};

type Piece = { divs: number; tuplet: boolean; type: string; dots: number };

const ATOMS: Piece[] = [
  { divs: 288, tuplet: false, type: "whole", dots: 1 },
  { divs: 192, tuplet: false, type: "whole", dots: 0 },
  { divs: 144, tuplet: false, type: "half", dots: 1 },
  { divs: 128, tuplet: true, type: "whole", dots: 0 },
  { divs: 96, tuplet: false, type: "half", dots: 0 },
  { divs: 72, tuplet: false, type: "quarter", dots: 1 },
  { divs: 64, tuplet: true, type: "half", dots: 0 },
  { divs: 48, tuplet: false, type: "quarter", dots: 0 },
  { divs: 36, tuplet: false, type: "eighth", dots: 1 },
  { divs: 32, tuplet: true, type: "quarter", dots: 0 },
  { divs: 24, tuplet: false, type: "eighth", dots: 0 },
  { divs: 18, tuplet: false, type: "16th", dots: 1 },
  { divs: 16, tuplet: true, type: "eighth", dots: 0 },
  { divs: 12, tuplet: false, type: "16th", dots: 0 },
  { divs: 9, tuplet: false, type: "32nd", dots: 1 },
  { divs: 8, tuplet: true, type: "16th", dots: 0 },
  { divs: 6, tuplet: false, type: "32nd", dots: 0 },
  { divs: 4, tuplet: true, type: "32nd", dots: 0 },
  { divs: 3, tuplet: false, type: "64th", dots: 0 },
];

const UNIT_QUARTERS: Record<string, number> = {
  whole: 4,
  half: 2,
  quarter: 1,
  eighth: 0.5,
  "16th": 0.25,
  "32nd": 0.125,
  "64th": 0.0625,
};

const LETTER_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

const MAJOR_FIFTHS: Record<number, KeyName> = {
  [-7]: "B",
  [-6]: "F#",
  [-5]: "Db",
  [-4]: "Ab",
  [-3]: "Eb",
  [-2]: "Bb",
  [-1]: "F",
  [0]: "C",
  [1]: "G",
  [2]: "D",
  [3]: "A",
  [4]: "E",
  [5]: "B",
  [6]: "F#",
  [7]: "Db",
};

type XNode = {
  name: string;
  attrs: Record<string, string>;
  children: XNode[];
  text: string;
};

type PitchTie = { midi: number; start: boolean; stop: boolean };

type Ev = {
  start: number;
  dur: number;
  pitches: number[];
  /** One entry per pitch. A rest has none. Ties are not OR-ed across a chord. */
  pitchTies: PitchTie[];
  voice: string;
  staff: string;
  pitched: boolean;
  dynamic?: DynamicMark;
  hairpin?: Hairpin;
  hairpinEnd?: boolean;
  articulations?: Articulation[];
  ornament?: Ornament;
  gracePitch?: number;
  slurStart?: boolean;
  slurEnd?: boolean;
  lyric?: NoteLyric;
  fingers?: number[];
  fermata?: boolean;
};

type ClefMark = { number: string; sign: string };

type StaffSig = {
  fifths: number;
  mode: Mode;
  /** Chromatic transpose in force for this staff when the signature was first read. */
  keyShift: number;
  changed: boolean;
};

type RepeatMark = { at: number; side: "left" | "right"; repeat?: string; ending?: { number: string; type: string } };
type JumpKind = "segno" | "coda" | "fine" | "toCoda" | "dc" | "ds";
type Header = {
  measureEnds: number[];
  repeatMarks: RepeatMark[];
  jumpMarks: { kind: JumpKind; at: number }[];
  changes: (ScoreChange & { staff?: string })[];
  beats: number | null;
  beatUnit: number | null;
  bpm: number | null;
  clefs: ClefMark[];
  /** Meter changed, separate from a per-staff key change. */
  meterChanged: boolean;
  defaultShift: Shift;
  shiftByStaff: Map<string, Shift>;
  /** Frozen per-staff shifts captured with an unnumbered key. Not updated later. */
  keyShiftByStaff: Map<string, number>;
  defaultSig: StaffSig | null;
  sigByStaff: Map<string, StaffSig>;
  /** Unnumbered transpose changed after the opening key. */
  defaultDrift: boolean;
  /** Numbered transpose changed after that staff's opening key. */
  driftStaves: Set<string>;
  grace: boolean;
  cue: boolean;
  partialTie: boolean;
  overlapSlices: boolean;
  unpitched: boolean;
  trimmed: boolean;
  cClef: boolean;
  coarseDynamic: boolean;
  otherDynamic: boolean;
  otherOrnament: boolean;
  stackedSlur: boolean;
  /** A tied continuation carried a dynamic or hairpin, so the tie was not joined. */
  heldTieMark: boolean;
  extraVerse: boolean;
  lyricOnRest: boolean;
  lyricOnChord: boolean;
  lyricOnTie: boolean;
  unsupportedLyric: boolean;
  lyricTrimmed: boolean;
  harmonies: { at: number; symbol: string; unsupported: boolean }[];
  rehearsals: { at: number; label: string }[];
  gradualTempos: GradualTempo[];
  unusedWords: number;
};

function blankHeader(): Header {
  return {
    measureEnds: [],
    repeatMarks: [],
    jumpMarks: [],
    changes: [],
    beats: null,
    beatUnit: null,
    bpm: null,
    clefs: [],
    meterChanged: false,
    defaultShift: { chromatic: 0, octaveChange: 0 },
    shiftByStaff: new Map(),
    keyShiftByStaff: new Map(),
    defaultSig: null,
    sigByStaff: new Map(),
    defaultDrift: false,
    driftStaves: new Set(),
    grace: false,
    cue: false,
    partialTie: false,
    overlapSlices: false,
    unpitched: false,
    trimmed: false,
    cClef: false,
    coarseDynamic: false,
    otherDynamic: false,
    otherOrnament: false,
    stackedSlur: false,
    heldTieMark: false,
    extraVerse: false,
    lyricOnRest: false,
    lyricOnChord: false,
    lyricOnTie: false,
    unsupportedLyric: false,
    lyricTrimmed: false,
    harmonies: [],
    rehearsals: [],
    gradualTempos: [],
    unusedWords: 0,
  };
}

function esc(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function decode(text: string): string {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function localName(raw: string): string {
  const name = raw.trim();
  const colon = name.lastIndexOf(":");
  return colon >= 0 ? name.slice(colon + 1) : name;
}

function parseXml(input: string): XNode {
  const src = input.replace(/^\uFEFF/, "");
  let i = 0;
  const root: XNode = { name: "#root", attrs: {}, children: [], text: "" };

  const skipDoctype = () => {
    let quote: string | null = null;
    let bracket = 0;
    i += 2;
    while (i < src.length) {
      const ch = src[i];
      if (quote) {
        if (ch === quote) quote = null;
      } else if (ch === '"' || ch === "'") quote = ch;
      else if (ch === "[") bracket += 1;
      else if (ch === "]") bracket = Math.max(0, bracket - 1);
      else if (ch === ">" && bracket === 0) {
        i += 1;
        return;
      }
      i += 1;
    }
    throw new Error("这不是 MusicXML 文件");
  };

  const startNode = (head: string): XNode => {
    const match = head.match(/^([^\s/>]+)/);
    if (!match) throw new Error("这不是 MusicXML 文件");
    const attrs: Record<string, string> = {};
    const rest = head.slice(match[0].length);
    const re = /([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
    let found: RegExpExecArray | null;
    while ((found = re.exec(rest))) {
      attrs[localName(found[1])] = decode(found[3] ?? found[4] ?? "");
    }
    return { name: localName(match[1]), attrs, children: [], text: "" };
  };

  const parseInto = (parent: XNode) => {
    while (i < src.length) {
      if (src.startsWith("</", i)) return;
      if (src[i] !== "<") {
        const next = src.indexOf("<", i);
        parent.text += decode(src.slice(i, next === -1 ? src.length : next));
        i = next === -1 ? src.length : next;
        continue;
      }
      if (src.startsWith("<!--", i)) {
        const end = src.indexOf("-->", i + 4);
        if (end < 0) throw new Error("这不是 MusicXML 文件");
        i = end + 3;
        continue;
      }
      if (src.startsWith("<?", i)) {
        const end = src.indexOf("?>", i + 2);
        if (end < 0) throw new Error("这不是 MusicXML 文件");
        i = end + 2;
        continue;
      }
      if (src.startsWith("<!", i)) {
        if (src.startsWith("<![CDATA[", i)) {
          const end = src.indexOf("]]>", i + 9);
          if (end < 0) throw new Error("这不是 MusicXML 文件");
          parent.text += src.slice(i + 9, end);
          i = end + 3;
          continue;
        }
        skipDoctype();
        continue;
      }
      const close = src.indexOf(">", i);
      if (close < 0) throw new Error("这不是 MusicXML 文件");
      let head = src.slice(i + 1, close).trim();
      const self = head.endsWith("/");
      if (self) head = head.slice(0, -1).trim();
      i = close + 1;
      const node = startNode(head);
      parent.children.push(node);
      if (!self) {
        parseInto(node);
        if (src.startsWith("</", i)) {
          const end = src.indexOf(">", i);
          if (end < 0) throw new Error("这不是 MusicXML 文件");
          i = end + 1;
        }
      }
    }
  };

  parseInto(root);
  return root;
}

function kids(node: XNode, name: string): XNode[] {
  return node.children.filter((child) => child.name === name);
}

function first(node: XNode | null, name: string): XNode | null {
  if (!node) return null;
  return node.children.find((child) => child.name === name) ?? null;
}

function textOf(node: XNode | null, name: string): string | null {
  const child = first(node, name);
  if (!child) return null;
  const text = child.text.trim();
  return text || null;
}

function hasChild(node: XNode, name: string): boolean {
  return node.children.some((child) => child.name === name);
}

function hasName(node: XNode, name: string): boolean {
  if (node.name === name) return true;
  return node.children.some((child) => hasName(child, name));
}

function hasAny(node: XNode, names: readonly string[]): boolean {
  if (names.includes(node.name)) return true;
  return node.children.some((child) => hasAny(child, names));
}

function findScore(node: XNode): { kind: "partwise" | "timewise"; node: XNode } | null {
  if (node.name === "score-partwise") return { kind: "partwise", node };
  if (node.name === "score-timewise") return { kind: "timewise", node };
  for (const child of node.children) {
    const found = findScore(child);
    if (found) return found;
  }
  return null;
}

function num(text: string | null): number | null {
  if (text == null || text === "") return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

function readMode(text: string | null): Mode {
  return text && text.toLowerCase().includes("minor") ? "minor" : "major";
}

function signatureFifths(key: KeyName, mode: Mode): number {
  const acc = scaleAccidentals(key, mode);
  return Object.values(acc).reduce((sum, value) => sum + value, 0);
}

function keyFromFifths(fifths: number, mode: Mode): KeyName {
  const target = Math.round(fifths);
  const found = KEY_NAMES.find((key) => signatureFifths(key, mode) === target);
  if (found) return found;
  const major = MAJOR_FIFTHS[Math.max(-7, Math.min(7, target))] ?? "C";
  return mode === "minor" ? transposeKey(major, -3) : major;
}

function canMake(n: number): boolean {
  return n === 0 || n === 3 || n === 4 || n >= 6;
}

function choosePiece(limit: number, left: number, division = DIV): Piece {
  const cap = Math.min(limit, left);
  for (const base of ATOMS) {
    const atom = { ...base, divs: base.divs * division / DIV };
    if (atom.divs > cap) continue;
    if (!canMake((left - atom.divs) * DIV / division)) continue;
    return atom;
  }
  return { divs: Math.max(1, cap), tuplet: false, type: "quarter", dots: 0 };
}

function snap(dur: number): number {
  return Math.round(dur * 1e9) / 1e9;
}

function clampInt(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, Math.round(value)));
}

function samePitch(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((pitch, index) => pitch === b[index]);
}

const SOUND_DYNAMICS: Record<DynamicMark, number> = { p: 49, mp: 64, mf: 80, f: 96 };

type Place = "both" | "head" | "tail" | "mid";

function directionXml(inner: string, place?: { voice: string; staff: string }): string {
  const where = place
    ? [`        <voice>${place.voice}</voice>`, `        <staff>${place.staff}</staff>`]
    : [];
  return [
    '      <direction placement="below">',
    "        <direction-type>",
    inner,
    "        </direction-type>",
    ...where,
    "      </direction>",
  ].join("\n");
}

function pitchXml(midi: number, key: KeyName, mode: Mode, indent: string): string[] {
  const spelled = spellMidi(Math.round(midi), key, mode);
  const lines = [`${indent}<pitch>`, `${indent}  <step>${spelled.letter}</step>`];
  if (spelled.acc) lines.push(`${indent}  <alter>${spelled.acc}</alter>`);
  lines.push(`${indent}  <octave>${spelled.octave}</octave>`, `${indent}</pitch>`);
  return lines;
}

type SpanKind = "plain" | "open" | "mark" | "after";

type LyricSpan = { quarters: number; kind: SpanKind; fragment?: LyricFragment };

/** Continuations on this note. An empty list is authoritative; the old slot is used only when `fragments` is absent. */
function lyricFragments(lyric: NoteLyric | undefined): LyricFragment[] {
  if (!lyric) return [];
  if (Array.isArray(lyric.fragments)) {
    return lyric.fragments
      .filter((item) => item.dur > 1e-6 && item.at >= 0)
      .map((item) => ({
        at: item.at,
        dur: item.dur,
        ...(item.extendType ? { extendType: item.extendType } : {}),
      }));
  }
  if (typeof lyric.extendEndAt !== "number") return [];
  if (lyric.extendEnd) {
    return [{ at: lyric.extendEndAt, dur: lyric.extendEndDur ?? 0, extendType: lyric.extendEnd }];
  }
  if (lyric.extendEndBare) return [{ at: lyric.extendEndAt, dur: lyric.extendEndDur ?? 0 }];
  return [];
}

/**
 * Pieces of one note around each tied extender.
 * A fragment owns [at, at + dur). A bar split keeps the mark on the piece
 * that begins that span. Nothing after a stop or a bare extender is given a new one.
 */
function lyricSpans(note: ScoreNote): LyricSpan[] {
  const total = snap(Math.max(note.dur, 0));
  const marks = lyricFragments(note.lyric).filter((item) => item.at < total - 1e-9);
  if (!marks.length) return [{ quarters: total > 0 ? total : note.dur, kind: "plain" }];
  const spans: LyricSpan[] = [];
  let cursor = 0;
  for (const item of marks) {
    const at = snap(Math.min(Math.max(item.at, 0), total));
    if (at < cursor - 1e-6) continue;
    if (at > cursor + 1e-6) {
      spans.push({ quarters: snap(at - cursor), kind: spans.length ? "after" : "open" });
    }
    const raw = item.dur > 1e-6 ? item.dur : total - at;
    const dur = snap(Math.min(raw, total - at));
    if (dur <= 1e-6) continue;
    const fragment: LyricFragment = {
      at,
      dur,
      ...(item.extendType ? { extendType: item.extendType } : {}),
    };
    spans.push({ quarters: dur, kind: "mark", fragment });
    cursor = snap(at + dur);
  }
  if (total - cursor > 1e-6) spans.push({ quarters: snap(total - cursor), kind: "after" });
  return spans.length ? spans : [{ quarters: total > 0 ? total : note.dur, kind: "plain" }];
}

function markerLyric(type: LyricExtendType): NoteLyric {
  return { text: "", syllabic: "single", extend: true, extendType: type };
}

function bareMarker(): NoteLyric {
  return { text: "", syllabic: "single", extend: true };
}

/** Lyric for one piece of a span. `first` is the piece that begins that span. */
function fragmentLyric(
  note: ScoreNote,
  kind: SpanKind,
  spanPlace: Place,
  fragment?: LyricFragment,
): NoteLyric | undefined {
  const lyric = note.lyric;
  if (!lyric) return undefined;
  const first = spanPlace === "head" || spanPlace === "both";
  if (kind === "after") return undefined;
  if (kind === "plain") return first ? lyric : undefined;
  if (kind === "mark") {
    const type = fragment?.extendType;
    if (type === "stop") return first ? markerLyric("stop") : undefined;
    if (type) return markerLyric(type);
    if (fragment) return first ? bareMarker() : undefined;
    return undefined;
  }
  // The opening mark is this note's own extend/extendType. A later typed
  // fragment does not turn a bare `<extend/>` into start, and a textless
  // bare opening is still an extender.
  const bareOpening = lyric.extend === true && lyric.extendType == null;
  const hasOpening = Boolean(lyric.text) || lyric.extendType != null || bareOpening;
  if (!hasOpening) return undefined;
  if (!first) {
    if (lyric.extendType && lyric.extendType !== "stop") return markerLyric("continue");
    return undefined;
  }
  const kept: NoteLyric = { text: lyric.text, syllabic: lyric.syllabic };
  if (lyric.extendType) {
    kept.extend = true;
    kept.extendType = lyric.extendType;
  } else if (bareOpening) {
    kept.extend = true;
  }
  return kept;
}

function lyricXml(lyric: NoteLyric): string[] {
  const lines = ['        <lyric number="1">'];
  if (lyric.text || !lyric.extend) {
    lines.push(`          <syllabic>${lyric.syllabic}</syllabic>`);
    lines.push(`          <text>${esc(lyric.text)}</text>`);
  }
  if (lyric.extend) {
    lines.push(
      lyric.extendType ? `          <extend type="${lyric.extendType}"/>` : "          <extend/>",
    );
  }
  lines.push("        </lyric>");
  return lines;
}

function noteXml(
  pitches: number[],
  piece: Piece,
  tieStart: boolean,
  tieStop: boolean,
  note: ScoreNote,
  place: Place,
  spanKind: SpanKind,
  spanPlace: Place,
  spanFragment: LyricFragment | undefined,
  index: number,
  notes: ScoreNote[],
  key: KeyName,
  mode: Mode,
  voice = "1",
  staff: string | null = null,
  fermata = false,
): string {
  const head = place === "head" || place === "both";
  const tail = place === "tail" || place === "both";
  const lead: string[] = [];
  const located = staff ? { voice, staff } : undefined;
  if (head) {
    const closing = closingHairpin(notes, index);
    if (closing) lead.push(directionXml('          <wedge type="stop"/>', located));
  }
  if (head && note.dynamic) {
    const where = located
      ? [`        <voice>${located.voice}</voice>`, `        <staff>${located.staff}</staff>`]
      : [];
    lead.push(
      [
        '      <direction placement="below">',
        "        <direction-type>",
        "          <dynamics>",
        `            <${note.dynamic}/>`,
        "          </dynamics>",
        "        </direction-type>",
        ...where,
        `        <sound dynamics="${SOUND_DYNAMICS[note.dynamic]}"/>`,
        "      </direction>",
      ].join("\n"),
    );
  }
  if (head && note.hairpin) {
    const wedge = note.hairpin === "dim" ? "diminuendo" : "crescendo";
    lead.push(directionXml(`          <wedge type="${wedge}"/>`, located));
  }
  if (head && (note.ornament === "grace" || note.ornament === "appoggiatura") && pitches.length) {
    const midi = gracePitchOf(note, key, mode);
    if (midi != null) {
      const grace = note.ornament === "grace" ? '        <grace slash="yes"/>' : "        <grace/>";
      lead.push(
        [
          "      <note>",
          grace,
          ...pitchXml(midi, key, mode, "        "),
          `        <voice>${voice}</voice>`,
          "        <type>eighth</type>",
          ...(staff ? [`        <staff>${staff}</staff>`] : []),
          "      </note>",
        ].join("\n"),
      );
    }
  }
  const heads = pitches.length ? pitches : [null];
  const body = heads
    .map((midi, chordIndex) => {
      const lines = ["      <note>"];
      if (chordIndex > 0) lines.push("        <chord/>");
      if (midi == null) lines.push("        <rest/>");
      else lines.push(...pitchXml(midi, key, mode, "        "));
      lines.push(`        <duration>${piece.divs}</duration>`);
      if (midi != null && tieStop) lines.push('        <tie type="stop"/>');
      if (midi != null && tieStart) lines.push('        <tie type="start"/>');
      lines.push(`        <voice>${voice}</voice>`);
      lines.push(`        <type>${piece.type}</type>`);
      for (let dot = 0; dot < piece.dots; dot += 1) lines.push("        <dot/>");
      if (piece.tuplet) {
        lines.push("        <time-modification>");
        lines.push("          <actual-notes>3</actual-notes>");
        lines.push("          <normal-notes>2</normal-notes>");
        lines.push("        </time-modification>");
      }
      if (staff) lines.push(`        <staff>${staff}</staff>`);
      if (chordIndex > 0 && midi != null && head && note.ornament === "arpeggio") {
        // Every tone of a rolled chord carries <arpeggiate/> (MusicXML 3.1).
        lines.push("        <notations>", "          <arpeggiate/>", "        </notations>");
      }
      if (chordIndex === 0 && midi != null) {
        const notations: string[] = [];
        if (tieStop) notations.push('          <tied type="stop"/>');
        if (tieStart) notations.push('          <tied type="start"/>');
        if (tail && note.slurEnd) notations.push('          <slur type="stop" number="1"/>');
        if (head && note.slurStart) notations.push('          <slur type="start" number="1"/>');
        const arts = head ? (note.articulations ?? []) : [];
        if (arts.length) {
          notations.push("          <articulations>");
          for (const art of arts) notations.push(`            <${art}/>`);
          notations.push("          </articulations>");
        }
        if (head && note.ornament === "arpeggio" && pitches.length > 1) notations.push("          <arpeggiate/>");
        if (head && note.ornament === "trill") {
          notations.push("          <ornaments>");
          notations.push("            <trill-mark/>");
          notations.push("          </ornaments>");
        }
        const finger = head && midi != null ? note.fingers?.[chordIndex] : undefined;
        if (head && Number.isInteger(finger) && (finger as number) >= 1 && (finger as number) <= 5) {
          notations.push(
            "          <technical>",
            `            <fingering>${finger}</fingering>`,
            "          </technical>",
          );
        }
        if (head && fermata) notations.push("          <fermata/>");
        if (notations.length) {
          lines.push("        <notations>", ...notations, "        </notations>");
        }
        const lyric = fragmentLyric(note, spanKind, spanPlace, spanFragment);
        if (lyric) lines.push(...lyricXml(lyric));
      } else if (head && midi != null) {
        const finger = note.fingers?.[chordIndex];
        if (Number.isInteger(finger) && (finger as number) >= 1 && (finger as number) <= 5) {
          lines.push(
            "        <notations>",
            "          <technical>",
            `            <fingering>${finger}</fingering>`,
            "          </technical>",
            "        </notations>",
          );
        }
      } else if (head && fermata && chordIndex === 0) {
        lines.push("        <notations>", "          <fermata/>", "        </notations>");
      }
      lines.push("      </note>");
      return lines.join("\n");
    })
    .join("\n");
  return [...lead, body].filter((part) => part !== "").join("\n");
}

function findNamed(node: XNode, name: string, pred?: (item: XNode) => boolean): XNode | null {
  if (node.name === name && (!pred || pred(node))) return node;
  for (const child of node.children) {
    const found = findNamed(child, name, pred);
    if (found) return found;
  }
  return null;
}

function tempoFrom(node: XNode): number | null {
  const sound = findNamed(node, "sound", (item) => Boolean(item.attrs.tempo));
  const perQuarter = sound ? num(sound.attrs.tempo ?? null) : null;
  if (perQuarter && perQuarter > 0) return perQuarter;
  const metro = findNamed(node, "metronome");
  if (!metro) return null;
  const unit = textOf(metro, "beat-unit") ?? "quarter";
  const per = num(textOf(metro, "per-minute"));
  if (!per || per <= 0) return null;
  const dots = kids(metro, "beat-unit-dot").length;
  const base = UNIT_QUARTERS[unit] ?? 1;
  const quarters = dots >= 2 ? base * 1.75 : dots === 1 ? base * 1.5 : base;
  return per * quarters;
}

function gradualKindFromWords(text: string): GradualKind | null {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return null;
  if (/渐慢/.test(t) || /\brit(ard(ando)?)?\.?\b/i.test(t) || /\brall(entando)?\.?\b/i.test(t)) return "rit";
  if (/渐快/.test(t) || /\baccel(erando)?\.?\b/i.test(t) || /\bstringendo\b/i.test(t)) return "accel";
  return null;
}

function isJumpWord(text: string): boolean {
  const words = text.replace(/\s+/g, " ").trim();
  if (/to\s*coda/i.test(words)) return true;
  if (/^(d\.?\s*c\.?(\s|$)|da\s*capo)/i.test(words)) return true;
  if (/^(d\.?\s*s\.?(\s|$)|dal\s*segno)/i.test(words)) return true;
  if (/^fine$/i.test(words)) return true;
  return false;
}

function isConsumedWord(text: string): boolean {
  const t = text.replace(/\s+/g, " ").trim();
  return !t || Boolean(gradualKindFromWords(t)) || isJumpWord(t);
}

function dashNumber(node: XNode): number {
  const n = Number(node.attrs.number || "1");
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function directionWords(node: XNode): string[] {
  return kids(node, "direction-type").flatMap((t) => kids(t, "words")).map((w) => w.text);
}

function directionDashes(node: XNode): XNode[] {
  return kids(node, "direction-type").flatMap((t) => kids(t, "dashes"));
}


/** Local copy of the gradual helpers so musicxml does not share the gradual-tempo chunk into the first-screen map. */
function roundedGradualAt(at: number) {
  return Math.round(Math.max(0, at) * 1e6) / 1e6;
}

function cleanGradualTempos(list: readonly GradualTempo[] | unknown): GradualTempo[] | undefined {
  if (!Array.isArray(list)) return undefined;
  const cleaned: GradualTempo[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const from = roundedGradualAt(Number((item as GradualTempo).from));
    const to = roundedGradualAt(Number((item as GradualTempo).to));
    const kind = (item as GradualTempo).kind;
    if ((kind !== "rit" && kind !== "accel") || !(to > from + 1e-6)) continue;
    const next: GradualTempo = { from, to, kind };
    const toBpm = (item as GradualTempo).toBpm;
    const ratio = (item as GradualTempo).ratio;
    if (toBpm !== undefined && Number.isFinite(toBpm)) next.toBpm = clampChangeBpm(toBpm);
    if (ratio !== undefined && Number.isFinite(ratio) && ratio > 0) {
      next.ratio = Math.min(4, Math.max(0.25, Math.round(ratio * 1000) / 1000));
    }
    cleaned.push(next);
  }
  cleaned.sort((a, b) => a.from - b.from || a.to - b.to);
  const kept: GradualTempo[] = [];
  for (const span of cleaned) {
    const last = kept[kept.length - 1];
    if (last && span.from < last.to - 1e-6) continue;
    kept.push(span);
  }
  return kept.length ? kept : undefined;
}

function scoreGradualTempos(score: Score): GradualTempo[] {
  return cleanGradualTempos((score as ScoreWithGradual).gradualTempos) ?? [];
}

function gradualTargetBpm(score: Score, span: GradualTempo): number {
  const marks = (score.changes ?? []).filter((c) => c.bpm !== undefined).sort((a, b) => a.at - b.at);
  const start = marks.filter((c) => c.at <= span.from + 1e-6).at(-1)?.bpm ?? score.bpm;
  if (span.toBpm !== undefined) return clampChangeBpm(span.toBpm);
  if (span.ratio !== undefined) return clampChangeBpm(start * span.ratio);
  const mark = marks.find((c) => Math.abs(c.at - span.to) <= 1e-6);
  if (mark?.bpm !== undefined) return clampChangeBpm(mark.bpm);
  return clampChangeBpm(start * (span.kind === "rit" ? 0.75 : 4 / 3));
}

function gradualStartXml(kind: GradualKind, number: number): string {
  const words = kind === "rit" ? "rit." : "accel.";
  return [
    '      <direction placement="above">',
    "        <direction-type>",
    `          <words>${words}</words>`,
    "        </direction-type>",
    "        <direction-type>",
    `          <dashes type="start" number="${number}"/>`,
    "        </direction-type>",
    "      </direction>",
  ].join("\n");
}

function gradualStopXml(number: number, tempo?: number): string {
  const sound = tempo !== undefined ? `\n        <sound tempo="${tempo}"/>` : "";
  return [
    '      <direction placement="above">',
    "        <direction-type>",
    `          <dashes type="stop" number="${number}"/>`,
    `        </direction-type>${sound}`,
    "      </direction>",
  ].join("\n");
}

type GradualReadState = {
  open: Map<number, { from: number; kind: GradualKind }>;
  pending: { at: number; kind: GradualKind } | null;
  wordOnly: { from: number; kind: GradualKind }[];
};

function blankGradualState(): GradualReadState {
  return { open: new Map(), pending: null, wordOnly: [] };
}

function countDirectionWords(header: Header, node: XNode) {
  for (const word of directionWords(node)) {
    if (!isConsumedWord(word)) header.unusedWords += 1;
  }
}

/** Flush a words-only start that never got a same-time dashes mark. */
function flushPendingGradual(state: GradualReadState, at: number) {
  if (state.pending && state.pending.at < at - 1e-7) {
    state.wordOnly.push({ from: state.pending.at, kind: state.pending.kind });
    state.pending = null;
  }
}

/**
 * Read rit./accel. words and dashes on one direction.
 * Returns whether this direction is a gradual stop (possibly with a target sound).
 */
function readGradualDirection(header: Header, state: GradualReadState, node: XNode, at: number): { stop: boolean } {
  if (node.name !== "direction") return { stop: false };
  flushPendingGradual(state, at);
  countDirectionWords(header, node);
  const kinds = directionWords(node).map(gradualKindFromWords).filter((k): k is GradualKind => k !== null);
  const kind = kinds[0];
  const dashes = directionDashes(node);
  const startDash = dashes.find((d) => d.attrs.type === "start");
  const stopDash = dashes.find((d) => d.attrs.type === "stop");
  if (kind && startDash) {
    state.pending = null;
    state.open.set(dashNumber(startDash), { from: at, kind });
  } else if (kind && !stopDash) {
    state.pending = { at, kind };
  }
  if (startDash && state.pending && Math.abs(state.pending.at - at) <= 1e-7) {
    state.open.set(dashNumber(startDash), { from: state.pending.at, kind: state.pending.kind });
    state.pending = null;
  }
  if (stopDash) {
    const number = dashNumber(stopDash);
    const open = state.open.get(number);
    state.open.delete(number);
    const from = open?.from ?? at;
    const spanKind = open?.kind ?? kind ?? "rit";
    if (at > from + 1e-7) {
      const span: GradualTempo = { from, to: at, kind: spanKind };
      const tempo = tempoFrom(node);
      if (tempo) span.toBpm = clampChangeBpm(tempo);
      header.gradualTempos.push(span);
    }
    return { stop: true };
  }
  return { stop: false };
}

function closeOpenGraduals(header: Header, state: GradualReadState, scoreEnd: number) {
  flushPendingGradual(state, scoreEnd + 1);
  if (state.pending) {
    state.wordOnly.push({ from: state.pending.at, kind: state.pending.kind });
    state.pending = null;
  }
  for (const open of state.open.values()) {
    if (scoreEnd > open.from + 1e-7) header.gradualTempos.push({ from: open.from, to: scoreEnd, kind: open.kind });
  }
  state.open.clear();
  const bpmAt = header.changes
    .filter((c) => c.bpm !== undefined && c.at > 0)
    .map((c) => ({ at: c.at, bpm: c.bpm as number }))
    .sort((a, b) => a.at - b.at);
  const starts = state.wordOnly.map((item) => item.from);
  state.wordOnly.sort((a, b) => a.from - b.from);
  for (let i = 0; i < state.wordOnly.length; i++) {
    const item = state.wordOnly[i]!;
    const nextStart = starts.filter((t) => t > item.from + 1e-7).sort((a, b) => a - b)[0];
    const nextBpm = bpmAt.find((m) => m.at > item.from + 1e-7);
    let to = Math.min(item.from + 4, scoreEnd);
    if (nextBpm) to = nextBpm.at;
    if (nextStart !== undefined) to = Math.min(to, nextStart);
    if (scoreEnd > item.from) to = Math.min(to, scoreEnd);
    if (!(to > item.from + 1e-7)) continue;
    const span: GradualTempo = { from: item.from, to, kind: item.kind };
    const mark = bpmAt.find((m) => Math.abs(m.at - to) <= 1e-7);
    if (mark) span.toBpm = clampChangeBpm(mark.bpm);
    header.gradualTempos.push(span);
  }
}

/** `<barline>` for repeat signs and 1st/2nd endings around measure `index` (0-based). */
function repeatBarlines(score: Score, index: number): { left: string; right: string } {
  if (!score.repeats?.length || repeatProblem(score)) return { left: "", right: "" };
  const lines = barLines(score);
  const start = lines[index], end = lines[index + 1];
  const at = (a: number | undefined, b: number | undefined) => a !== undefined && b !== undefined && Math.abs(a - b) < 1e-6;
  const sides = { left: { endings: [] as string[], repeat: "" }, right: { endings: [] as string[], repeat: "" } };
  for (const r of score.repeats) {
    if (at(r.from, start)) sides.left.repeat = "forward";
    if (at(r.ending, start)) sides.left.endings.push('<ending number="1" type="start">1.</ending>');
    if (at(r.to, start) && r.endingEnd !== undefined) sides.left.endings.push('<ending number="2" type="start">2.</ending>');
    if (at(r.to, end) && r.ending !== undefined) sides.right.endings.push('<ending number="1" type="stop"/>');
    if (at(r.to, end)) sides.right.repeat = "backward";
    if (at(r.endingEnd, end)) sides.right.endings.push('<ending number="2" type="discontinue"/>');
  }
  const wrap = (where: "left" | "right") => {
    const side = sides[where];
    if (!side.endings.length && !side.repeat) return "";
    const style = side.repeat ? `<bar-style>${where === "left" ? "heavy-light" : "light-heavy"}</bar-style>` : "";
    const repeat = side.repeat ? `<repeat direction="${side.repeat}"/>` : "";
    return [`      <barline location="${where}">`, ...[style, ...side.endings, repeat].filter(Boolean).map((x) => `        ${x}`), "      </barline>"].join("\n");
  };
  return { left: wrap("left"), right: wrap("right") };
}


/** `<direction>` rehearsal labels at the start of measure `index`. */
function rehearsalDirections(score: Score, index: number): string {
  const marks = score.rehearsals ?? [];
  if (!marks.length) return "";
  const lines = barLines(score);
  const start = lines[index];
  if (start === undefined) return "";
  const out: string[] = [];
  for (const m of marks) {
    if (Math.abs(m.at - start) > 1e-6) continue;
    const label = esc(m.label);
    out.push(`      <direction placement="above">\n        <direction-type>\n          <rehearsal>${label}</rehearsal>\n        </direction-type>\n      </direction>`);
  }
  return out.join("\n");
}

/** `<direction>` + `<sound>` for Segno / Coda at measure `index`'s start and Fine / To Coda / D.C. / D.S. at its end. */
function jumpDirections(score: Score, index: number): { start: string; end: string } {
  const marks = jumpMarks(score);
  if (!marks.length) return { start: "", end: "" };
  const lines = barLines(score);
  const at = (q: number, line: number | undefined) => line !== undefined && Math.abs(q - line) < 1e-6;
  const playable = !jumpProblem(score);
  const j = score.jumps!;
  const dir = (type: string, sound: string) =>
    `      <direction placement="above">\n        <direction-type>\n          ${type}\n        </direction-type>\n${playable && sound ? `        <sound ${sound}/>\n` : ""}      </direction>`;
  const start: string[] = [], end: string[] = [];
  for (const m of marks) {
    if (m.side === "start" && at(m.at, lines[index])) start.push(m.kind === "segno" ? dir("<segno/>", 'segno="segno"') : dir("<coda/>", 'coda="coda"'));
    if (m.side === "end" && at(m.at, lines[index + 1])) {
      if (m.kind === "fine") end.push(dir("<words>Fine</words>", 'fine="yes"'));
      else if (m.kind === "toCoda") end.push(dir("<words>To Coda</words>", 'tocoda="coda"'));
      else end.push(dir(`<words>${m.text}</words>`, j.dc !== undefined ? 'dacapo="yes"' : 'dalsegno="segno"'));
    }
  }
  return { start: start.join("\n"), end: end.join("\n") };
}

export function scoreToMusicXml(score: Score): string {
  const beatUnit = [1, 2, 4, 8, 16, 32].includes(score.beatUnit) ? score.beatUnit : 4;
  const beats = clampInt(score.beats || 4, 1, 16);
  const bpm = clampInt(score.bpm || 96, 20, 400);
  const barDivs = Math.max(1, Math.round(beats * (4 / beatUnit) * DIV));
  const fifths = signatureFifths(score.key, score.mode);
  return writePartwise(score, barDivs, beats, beatUnit, bpm, fifths);
}

function writePartwise(
  score: Score,
  barDivs: number,
  beats: number,
  beatUnit: number,
  bpm: number,
  fifths: number,
): string {
  // Preserve MIDI tick fractions rather than rounding metadata to the engraving grid.
  const gcd = (a: number, b: number): number => b ? gcd(b, a % b) : a;
  let DIV = 48;
  const positions = new Set([...(score.changes ?? []).map(c => c.at), ...voiceList(score).flatMap(v => v.map(n => n.dur))]);
  for (const value of positions) {
    if (Math.abs(value * DIV - Math.round(value * DIV)) < 1e-6) continue;
    let denominator = 1;
    while (denominator <= 32768 && Math.abs(value * denominator - Math.round(value * denominator)) > 1e-6) denominator++;
    DIV = DIV / gcd(DIV, denominator) * denominator;
    if (DIV > 1e9) throw new Error('时间精度超出 MusicXML 导出范围，请先量化。');
  }
  type Item = {
    at: number;
    pitches: number[];
    piece: Piece;
    tieStart: boolean;
    tieStop: boolean;
    note: ScoreNote;
    place: Place;
    spanKind: SpanKind;
    spanPlace: Place;
    spanFragment?: LyricFragment;
    index: number;
  };
  function voiceBuckets(source: ScoreNote[]): Item[][] {
    const buckets: Item[][] = [[]];
    let at = 0;
    let room = nextBar(score, 0) * DIV;
    source.forEach((note, noteIndex) => {
      const group: Item[] = [];
      for (const span of lyricSpans(note)) {
        const spanItems: Item[] = [];
        let left = Math.max(1, Math.round(span.quarters * DIV));
        while (left > 0) {
          if (room <= 0) {
            buckets.push([]);
            room = Math.round((nextBar(score, at / DIV) - at / DIV) * DIV);
          }
          const piece = choosePiece(Math.min(room, Math.max(1, Math.round((nextChange(score, at / DIV) - at / DIV) * DIV))), left, DIV);
          const item: Item = {
            at: at / DIV,
            pitches: note.pitches,
            piece,
            tieStart: false,
            tieStop: false,
            note,
            place: "both",
            spanKind: span.kind,
            spanPlace: "both",
            spanFragment: span.fragment,
            index: noteIndex,
          };
          spanItems.push(item);
          group.push(item);
          buckets[buckets.length - 1].push(item);
          left -= piece.divs;
          room -= piece.divs;
          at += piece.divs;
        }
        spanItems.forEach((item, index) => {
          item.spanPlace =
            spanItems.length === 1
              ? "both"
              : index === 0
                ? "head"
                : index === spanItems.length - 1
                  ? "tail"
                  : "mid";
        });
      }
      group.forEach((item, index) => {
        if (note.pitches.length && group.length > 1) {
          item.tieStart = index < group.length - 1;
          item.tieStop = index > 0;
        }
        item.place =
          group.length === 1
            ? "both"
            : index === 0
              ? "head"
              : index === group.length - 1
                ? "tail"
                : "mid";
      });
    });
    return buckets;
  }

  const emitted = new Set<number>();
  const changeAtTime = (at: number): ScoreChange | undefined => {
    const matches = (score.changes ?? []).filter((c) => Math.abs(c.at - at) < 1e-7);
    if (!matches.length) return undefined;
    return Object.assign({ at }, ...matches);
  };
  const changeXml = (c: ScoreChange | undefined): string => {
    if (!c || emitted.has(c.at)) return "";
    emitted.add(c.at);
    return [
          c.key !== undefined || c.beats !== undefined ? `<attributes>${c.key !== undefined ? `<key><fifths>${signatureFifths(c.key, c.mode!)}</fifths><mode>${c.mode}</mode></key>` : ''}${c.beats !== undefined ? `<time><beats>${c.beats}</beats><beat-type>${c.beatUnit}</beat-type></time>` : ''}</attributes>` : '',
          c.bpm !== undefined ? `<direction><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${c.bpm}</per-minute></metronome></direction-type><sound tempo="${c.bpm}"/></direction>` : '',
        ].filter(Boolean).join('\n');
  };
  const gradualEmitted = new Set<string>();
  const gradualSpans = scoreGradualTempos(score).map((span, i) => ({ span, number: i + 1 }));
  const hasBpmChange = (at: number) =>
    (score.changes ?? []).some((c) => c.bpm !== undefined && Math.abs(c.at - at) < 1e-7);
  const gradualXmlAt = (at: number): string => {
    const parts: string[] = [];
    for (const { span, number } of gradualSpans) {
      if (Math.abs(span.from - at) < 1e-7 && !gradualEmitted.has(`${number}:start`)) {
        gradualEmitted.add(`${number}:start`);
        parts.push(gradualStartXml(span.kind, number));
      }
      if (Math.abs(span.to - at) < 1e-7 && !gradualEmitted.has(`${number}:stop`)) {
        gradualEmitted.add(`${number}:stop`);
        const tempo = hasBpmChange(span.to) ? undefined : gradualTargetBpm(score, span);
        parts.push(gradualStopXml(number, tempo));
      }
    }
    return parts.join("\n");
  };
  const markXmlAt = (at: number): string => [changeXml(changeAtTime(at)), gradualXmlAt(at)].filter(Boolean).join("\n");

  const emittedHarmony = new Set<string>();
  function harmonyXml(symbol: string): string {
    const parsed = parseChordSymbol(symbol);
    if (!parsed || parsed.unknown) {
      return [
        "      <harmony>",
        "        <root>",
        "          <root-step>C</root-step>",
        "        </root>",
        `        <kind text="${esc(symbol)}">other</kind>`,
        "      </harmony>",
      ].join("\n");
    }
    const rootAlter = parsed.root.acc
      ? `\n          <root-alter>${parsed.root.acc}</root-alter>`
      : "";
    const kind = MUSICXML_KIND[parsed.quality];
    let bass = "";
    if (parsed.bass) {
      const alter = parsed.bass.acc
        ? `\n          <bass-alter>${parsed.bass.acc}</bass-alter>`
        : "";
      bass = `\n        <bass>\n          <bass-step>${parsed.bass.letter}</bass-step>${alter}\n        </bass>`;
    }
    return [
      "      <harmony>",
      "        <root>",
      `          <root-step>${parsed.root.letter}</root-step>${rootAlter}`,
      "        </root>",
      `        <kind>${kind}</kind>${bass}`,
      "      </harmony>",
    ].join("\n");
  }
  function flushHarmony(at: number, voice: string): string {
    if (voice !== "1") return "";
    const marks = (score.chordSymbols ?? []).filter((item) => Math.abs(item.at - at) < 1e-7);
    const parts: string[] = [];
    for (const mark of marks) {
      const key = `${mark.at}:${mark.symbol}`;
      if (emittedHarmony.has(key)) continue;
      emittedHarmony.add(key);
      parts.push(harmonyXml(mark.symbol));
    }
    return parts.length ? parts.join("\n") + "\n" : "";
  }

  function renderVoice(
    items: Item[],
    source: ScoreNote[],
    voice: string,
    staff: string | null,
  ): string {
    return items
      .map((item) => {
        const mark = markXmlAt(item.at);
        const active = stateAt(score, item.at);
        return mark + flushHarmony(item.at, voice) + '\n' + noteXml(
          item.pitches,
          item.piece,
          item.tieStart,
          item.tieStop,
          item.note,
          item.place,
          item.spanKind,
          item.spanPlace,
          item.spanFragment,
          item.index,
          source,
          active.key,
          active.mode,
          voice,
          staff,
          (score.fermatas ?? []).some((m) => m.voice === Math.max(0, Number(voice) - 1) && Math.abs(m.at - item.at) < 1e-7),
        );
      })
      .join("\n");
  }

  const sources = voiceList(score);
  const buckets = sources.map(voiceBuckets);
  const upper = buckets[0]!;
  const clef = score.clef === "bass" ? { sign: "F", line: 4 } : { sign: "G", line: 2 };
  const measureCount = Math.max(...buckets.map(v => v.length));
  const body = Array.from({ length: measureCount }, (_, index) => {
    const clefXml = (number: string | null) => {
      const attr = number ? ` number="${number}"` : "";
      const mark = number !== null && voiceClef(score, Number(number) - 1) === "bass" ? { sign: "F", line: 4 } : clef;
      return [
        `        <clef${attr}>`,
        `          <sign>${mark.sign}</sign>`,
        `          <line>${mark.line}</line>`,
        "        </clef>",
      ];
    };
    const head =
      index === 0
        ? [
            "      <attributes>",
            `        <divisions>${DIV}</divisions>`,
            "        <key>",
            `          <fifths>${fifths}</fifths>`,
            `          <mode>${score.mode}</mode>`,
            "        </key>",
            "        <time>",
            `          <beats>${beats}</beats>`,
            `          <beat-type>${beatUnit}</beat-type>`,
            "        </time>",
            ...(sources.length > 1
              ? [`        <staves>${sources.length}</staves>`, ...sources.flatMap((_, i) => clefXml(String(i+1)))]
              : clefXml(null)),
            "      </attributes>",
            ...(score.tempoMarked === false
              ? []
              : [
                  '      <direction placement="above">',
                  "        <direction-type>",
                  "          <metronome>",
                  "            <beat-unit>quarter</beat-unit>",
                  `            <per-minute>${bpm}</per-minute>`,
                  "          </metronome>",
                  "        </direction-type>",
                  `        <sound tempo="${bpm}"/>`,
                  "      </direction>",
                ]),
          ].join("\n")
        : "";
    const upperItems = upper[index] ?? [];
    let writtenWidth = 0;
    let lastItems = upperItems;
    const chunks: string[] = [];
    sources.forEach((source, vi) => {
      const items = buckets[vi]![index] ?? [];
      const rendered = renderVoice(items, source, String(vi + 1), sources.length > 1 ? String(vi + 1) : null);
      if (!rendered) return;
      if (writtenWidth > 0) chunks.push(`      <backup>\n        <duration>${writtenWidth}</duration>\n      </backup>`);
      chunks.push(rendered);
      writtenWidth = items.reduce((sum, item) => sum + item.piece.divs, 0);
      lastItems = items;
    });
    let notes = chunks.join("\n");
    const measureStartAt = lastItems[0]?.at ?? (index === 0 ? 0 : nextBar(score, 0));
    const measureEndAt = lastItems.length
      ? lastItems.at(-1)!.at + lastItems.at(-1)!.piece.divs / DIV
      : measureStartAt;
    const windowStart = (() => {
      let at = 0;
      for (let i = 0; i < index; i++) at = nextBar(score, at);
      return index === 0 && (upper[0]?.[0]?.at ?? 0) === 0 ? 0 : at;
    })();
    const windowEnd = index === measureCount - 1 ? Infinity : nextBar(score, windowStart);
    const includeEnd = index === measureCount - 1;
    const pendingAts = new Set<number>();
    for (const c of score.changes ?? []) {
      if (emitted.has(c.at)) continue;
      if (c.at >= windowStart - 1e-7 && (includeEnd ? c.at <= windowEnd + 1e-7 : c.at < windowEnd - 1e-7)) pendingAts.add(c.at);
    }
    for (const { span, number } of gradualSpans) {
      for (const [at, tag] of [[span.from, "start"], [span.to, "stop"]] as const) {
        if (gradualEmitted.has(`${number}:${tag}`)) continue;
        if (at >= windowStart - 1e-7 && (includeEnd ? at <= windowEnd + 1e-7 : at < windowEnd - 1e-7)) pendingAts.add(at);
      }
    }
    let cursor = lastItems.length ? measureEndAt : windowStart;
    for (const at of [...pendingAts].sort((a, b) => a - b)) {
      const delta = Math.round((at - cursor) * DIV);
      if (delta) notes += `\n      <${delta > 0 ? "forward" : "backup"}>\n        <duration>${Math.abs(delta)}</duration>\n      </${delta > 0 ? "forward" : "backup"}>`;
      const xml = markXmlAt(at);
      if (xml) notes += "\n" + xml;
      cursor = at;
    }
    const marks = repeatBarlines(score, index);
    const jumps = jumpDirections(score, index);
    const rehearsals = rehearsalDirections(score, index);
    return [`    <measure number="${index + 1}"${score.changes?.length ? ' implicit="yes"' : ""}>`, marks.left, head, rehearsals, jumps.start, notes, jumps.end, marks.right, "    </measure>"]
      .filter((part) => part !== "")
      .join("\n");
  }).join("\n");

  const title = score.title.trim() || "未命名";
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<score-partwise version="3.1">`,
    `  <work>`,
    `    <work-title>${esc(title)}</work-title>`,
    `  </work>`,
    `  <identification>`,
    ...(score.composer ? [`    <creator type="composer">${esc(score.composer)}</creator>`] : []),
    ...(score.lyricist ? [`    <creator type="lyricist">${esc(score.lyricist)}</creator>`] : []),
    `    <encoding>`,
    `      <software>谱线</software>`,
    `    </encoding>`,
    ...(sources.length > 2 ? [`    <miscellaneous><miscellaneous-field name="puxian-independent-voices">${sources.length}</miscellaneous-field></miscellaneous>`] : []),
    `  </identification>`,
    `  <part-list>`,
    `    <score-part id="P1">`,
    `      <part-name>${score.staffInstrument === "piano" ? "钢琴" : "旋律"}</part-name>`,
    `    </score-part>`,
    `  </part-list>`,
    `  <part id="P1">`,
    body,
    `  </part>`,
    `</score-partwise>`,
    "",
  ].join("\n");
}

function tiesOf(note: XNode): { start: boolean; stop: boolean } {
  let start = false;
  let stop = false;
  const visit = (node: XNode) => {
    if ((node.name === "tie" || node.name === "tied") && node.attrs.type === "start") start = true;
    if ((node.name === "tie" || node.name === "tied") && node.attrs.type === "stop") stop = true;
    node.children.forEach(visit);
  };
  visit(note);
  return { start, stop };
}

function readAttributes(el: XNode) {
  const time = first(el, "time");
  return {
    divisions: num(textOf(el, "divisions")),
    keys: kids(el, "key").flatMap((key) => {
      const fifths = num(textOf(key, "fifths"));
      if (fifths == null) return [];
      return [{ number: key.attrs.number || "", fifths, mode: readMode(textOf(key, "mode")) }];
    }),
    beats: time ? num(textOf(time, "beats")) : null,
    beatUnit: time ? num(textOf(time, "beat-type")) : null,
    transposes: kids(el, "transpose").map((tr) => ({
      number: tr.attrs.number || "",
      chromatic: num(textOf(tr, "chromatic")) ?? 0,
      octaveChange: num(textOf(tr, "octave-change")) ?? 0,
    })),
    clefs: kids(el, "clef").map((clef) => ({
      number: clef.attrs.number || "1",
      sign: (textOf(clef, "sign") || "G").toUpperCase(),
    })),
  };
}

type Shift = { chromatic: number; octaveChange: number };

function tiesDisagree(ties: PitchTie[]): boolean {
  if (ties.length <= 1) return false;
  return ties.some((tie) => tie.start !== ties[0].start || tie.stop !== ties[0].stop);
}

/** Null when chord tones disagree, so a single tied pitch cannot lengthen the chord. */
function noteTie(event: Ev): { start: boolean; stop: boolean } | null {
  if (!event.pitchTies.length) return { start: false, stop: false };
  if (tiesDisagree(event.pitchTies)) return null;
  return { start: event.pitchTies[0].start, stop: event.pitchTies[0].stop };
}

const COARSE_DYNAMIC: Record<string, DynamicMark> = {
  pp: "p",
  ppp: "p",
  pppp: "p",
  ff: "f",
  fff: "f",
  ffff: "f",
};

const ART_ORDER: Articulation[] = ["staccato", "accent", "tenuto"];

function dynamicFromSound(value: number): { mark: DynamicMark; coarse: boolean } | null {
  if (!Number.isFinite(value) || value <= 0) return null;
  const velocity = value <= 100 ? (value / 100) * 127 : value;
  if (velocity < 42) return { mark: "p", coarse: true };
  if (velocity < 57) return { mark: "p", coarse: false };
  if (velocity < 72) return { mark: "mp", coarse: false };
  if (velocity < 88) return { mark: "mf", coarse: false };
  if (velocity <= 104) return { mark: "f", coarse: false };
  return { mark: "f", coarse: true };
}

function readDirectionMark(node: XNode): {
  dynamic?: DynamicMark;
  coarse: boolean;
  other: boolean;
  hairpin?: Hairpin;
  hairpinEnd: boolean;
} {
  const found: {
    dynamic?: DynamicMark;
    coarse: boolean;
    other: boolean;
    hairpin?: Hairpin;
    hairpinEnd: boolean;
  } = { coarse: false, other: false, hairpinEnd: false };
  let symbolic: DynamicMark | undefined;
  let numeric: DynamicMark | undefined;
  let numericCoarse = false;
  const visit = (current: XNode) => {
    if (current.name === "dynamics") {
      for (const child of current.children) {
        if (
          child.name === "p" ||
          child.name === "mp" ||
          child.name === "mf" ||
          child.name === "f"
        ) {
          symbolic = child.name;
        } else if (COARSE_DYNAMIC[child.name]) {
          symbolic = COARSE_DYNAMIC[child.name];
          found.coarse = true;
        } else if (child.name !== "#text") found.other = true;
      }
    }
    if (current.name === "wedge") {
      if (current.attrs.type === "crescendo") found.hairpin = "cresc";
      else if (current.attrs.type === "diminuendo") found.hairpin = "dim";
      else if (current.attrs.type === "stop") found.hairpinEnd = true;
    }
    if (current.name === "sound" && current.attrs.dynamics) {
      const mapped = dynamicFromSound(Number(current.attrs.dynamics));
      if (mapped) {
        numeric = mapped.mark;
        numericCoarse = mapped.coarse;
      }
    }
    for (const child of current.children) visit(child);
  };
  visit(node);
  if (symbolic) found.dynamic = symbolic;
  else if (numeric) {
    found.dynamic = numeric;
    if (numericCoarse) found.coarse = true;
  }
  return found;
}

function lyricText(node: XNode): string | null {
  const child = first(node, "text");
  if (!child) return null;
  let out = "";
  for (const char of child.text) {
    const code = char.codePointAt(0) ?? 0;
    if (code >= 32) out += char;
  }
  return out.trim();
}

function extendOf(node: XNode): { extend: boolean; extendType?: LyricExtendType } {
  let extend = false;
  let extendType: LyricExtendType | undefined;
  for (const item of kids(node, "extend")) {
    extend = true;
    const type = item.attrs.type;
    if (type === "start" || type === "continue" || type === "stop") extendType = type;
  }
  return extendType ? { extend: true, extendType } : { extend };
}

function lyricFromNode(node: XNode, header: Header): NoteLyric | undefined {
  const number = node.attrs.number || "1";
  if (number !== "1") {
    header.extraVerse = true;
    return undefined;
  }
  if (hasChild(node, "elision") || kids(node, "text").length > 1) header.unsupportedLyric = true;
  const raw = lyricText(node);
  const syllabicText = textOf(node, "syllabic");
  let syllabic = "single";
  if (syllabicText) {
    if (
      syllabicText === "single" ||
      syllabicText === "begin" ||
      syllabicText === "middle" ||
      syllabicText === "end"
    ) {
      syllabic = syllabicText;
    } else header.unsupportedLyric = true;
  }
  const ext = extendOf(node);
  if (raw == null && !syllabicText && !ext.extend) return undefined;
  let text = raw ?? "";
  if (text.length > 64) {
    text = text.slice(0, 64);
    header.lyricTrimmed = true;
  }
  const lyric = cleanLyric({ text, syllabic, extend: ext.extend, extendType: ext.extendType });
  return lyric;
}

function readLyric(note: XNode, header: Header): NoteLyric | undefined {
  let chosen: NoteLyric | undefined;
  for (const lyric of kids(note, "lyric")) {
    const parsed = lyricFromNode(lyric, header);
    if (!parsed) continue;
    if (chosen) {
      header.unsupportedLyric = true;
      continue;
    }
    chosen = parsed;
  }
  return chosen;
}

function adoptLyric(
  current: NoteLyric | undefined,
  extra: NoteLyric | undefined,
  header: Header,
): NoteLyric | undefined {
  if (!extra) return current;
  if (!current) return extra;
  if (extra.text && extra.text !== current.text) header.lyricOnChord = true;
  return current;
}

function sortArts(arts: Articulation[]): Articulation[] {
  return ART_ORDER.filter((item) => arts.includes(item));
}

function readFingering(note: XNode): number | undefined {
  let finger: number | undefined;
  const visit = (node: XNode) => {
    if (node.name === "fingering") {
      const raw = Number.parseInt(node.text.trim(), 10);
      if (raw >= 1 && raw <= 5) finger = raw;
    }
    for (const child of node.children) visit(child);
  };
  visit(note);
  return finger;
}

function readNoteMarks(
  note: XNode,
  header: Header,
): {
  articulations?: Articulation[];
  ornament?: Ornament;
  slurStart?: boolean;
  slurEnd?: boolean;
  fermata?: boolean;
} {
  const articulations: Articulation[] = [];
  let ornament: Ornament | undefined;
  let slurStart = false;
  let slurEnd = false;
  let fermata = false;
  const visit = (node: XNode) => {
    if (node.name === "strong-accent") {
      if (!articulations.includes("accent")) articulations.push("accent");
    } else if (node.name === "staccato" || node.name === "accent" || node.name === "tenuto") {
      if (!articulations.includes(node.name)) articulations.push(node.name);
    }
    if (node.name === "trill-mark") ornament = "trill";
    if (node.name === "arpeggiate" && !ornament) ornament = "arpeggio";
    if (node.name === "fermata") fermata = true;
    if (
      node.name === "mordent" ||
      node.name === "inverted-mordent" ||
      node.name === "turn" ||
      node.name === "inverted-turn" ||
      node.name === "shake" ||
      node.name === "wavy-line"
    ) {
      header.otherOrnament = true;
    }
    if (node.name === "slur") {
      if (node.attrs.type === "start") {
        if (slurStart) header.stackedSlur = true;
        else slurStart = true;
      }
      if (node.attrs.type === "stop") {
        if (slurEnd) header.stackedSlur = true;
        else slurEnd = true;
      }
    }
    for (const child of node.children) visit(child);
  };
  visit(note);
  return {
    articulations: articulations.length ? sortArts(articulations) : undefined,
    ornament,
    slurStart: slurStart || undefined,
    slurEnd: slurEnd || undefined,
    fermata: fermata || undefined,
  };
}

function midiOf(note: XNode, semis: number): number | null {
  const step = (textOf(first(note, "pitch"), "step") || "").toUpperCase();
  const alter = Math.round(num(textOf(first(note, "pitch"), "alter")) ?? 0);
  const octave = num(textOf(first(note, "pitch"), "octave"));
  const pc = LETTER_PC[step];
  if (pc == null || octave == null) return null;
  return Math.max(0, Math.min(127, (octave + 1) * 12 + pc + alter + semis));
}

function readPart(measures: XNode[], concertScore: boolean): { events: Ev[]; header: Header } {
  const header = blankHeader();
  const events: Ev[] = [];
  let divisions = 1;
  let barQ = 4;
  let measureStart = 0;
  let scoreEnd = 0;
  const gradualState = blankGradualState();

  const shiftFor = (staff: string): Shift => header.shiftByStaff.get(staff) ?? header.defaultShift;

  const openingShift = (staff: string): number | undefined => {
    const own = header.sigByStaff.get(staff);
    if (own) return own.keyShift;
    if (header.keyShiftByStaff.has(staff)) return header.keyShiftByStaff.get(staff);
    return header.defaultSig?.keyShift;
  };

  const freshSig = (fifths: number, mode: Mode, keyShift: number): StaffSig => ({
    fifths,
    mode,
    keyShift,
    changed: false,
  });

  const differs = (sig: StaffSig, fifths: number, mode: Mode) =>
    sig.fifths !== fifths || sig.mode !== mode;

  const applyKeys = (keys: Array<{ number: string; fifths: number; mode: Mode }>) => {
    let general: { fifths: number; mode: Mode } | null = null;
    const numbered = new Map<string, { fifths: number; mode: Mode }>();
    for (const key of keys) {
      if (key.number) numbered.set(key.number, key);
      else general = key;
    }
    const inheritedAlready = Boolean(header.defaultSig);
    if (general) {
      const changed = Boolean(
        header.defaultSig && differs(header.defaultSig, general.fifths, general.mode),
      );
      if (!header.defaultSig) {
        const keyShift = concertScore ? 0 : header.defaultShift.chromatic;
        header.defaultSig = freshSig(general.fifths, general.mode, keyShift);
        if (!concertScore) {
          for (const [id, shift] of header.shiftByStaff) {
            header.keyShiftByStaff.set(id, shift.chromatic);
          }
        }
        for (const sig of header.sigByStaff.values()) {
          if (differs(sig, general.fifths, general.mode)) sig.changed = true;
        }
      } else if (changed) {
        header.defaultSig.changed = true;
        for (const sig of header.sigByStaff.values()) {
          if (differs(sig, general.fifths, general.mode)) sig.changed = true;
        }
      }
    }
    for (const [staff, key] of numbered) {
      const own = header.sigByStaff.get(staff);
      if (own) {
        if (differs(own, key.fifths, key.mode)) own.changed = true;
        continue;
      }
      const inherited = header.defaultSig;
      if (inherited && inheritedAlready) {
        header.sigByStaff.set(staff, {
          fifths: inherited.fifths,
          mode: inherited.mode,
          keyShift: header.keyShiftByStaff.get(staff) ?? inherited.keyShift,
          changed: inherited.changed || differs(inherited, key.fifths, key.mode),
        });
        if (header.defaultDrift) header.driftStaves.add(staff);
        continue;
      }
      const keyShift = concertScore ? 0 : shiftFor(staff).chromatic;
      header.sigByStaff.set(staff, freshSig(key.fifths, key.mode, keyShift));
    }
  };

  const noteTranspose = (staff: string | null, nextChromatic: number) => {
    if (concertScore) return;
    if (staff) {
      const opening = openingShift(staff);
      if (opening !== undefined && opening !== nextChromatic) header.driftStaves.add(staff);
      return;
    }
    if (header.defaultSig && header.defaultSig.keyShift !== nextChromatic)
      header.defaultDrift = true;
    for (const [id, snap] of header.keyShiftByStaff) {
      if (snap !== nextChromatic) header.driftStaves.add(id);
    }
    for (const [id, sig] of header.sigByStaff) {
      if (sig.keyShift !== nextChromatic) header.driftStaves.add(id);
    }
  };

  type Placed = {
    time: number;
    voice: string | null;
    staff: string | null;
    dynamic?: DynamicMark;
    hairpin?: Hairpin;
    hairpinEnd?: boolean;
  };
  const placed: Placed[] = [];
  let graceWait: { midi: number; voice: string; staff: string; slash: boolean } | null = null;
  let graceCount = 0;
  const forgetGrace = () => {
    if (graceCount > 0) header.grace = true;
    graceWait = null;
    graceCount = 0;
  };

  measures.forEach((measure, index) => {
    let cursor = 0;
    let maxCursor = 0;
    const bump = (next: number) => {
      cursor = next;
      if (cursor > maxCursor) maxCursor = cursor;
    };
    for (const child of measure.children) {
      if (child.name === "attributes") {
        const attrs = readAttributes(child);
        if (attrs.divisions != null && attrs.divisions > 0) divisions = attrs.divisions;
        for (const tr of attrs.transposes) {
          const shift = { chromatic: tr.chromatic, octaveChange: tr.octaveChange };
          noteTranspose(tr.number || null, tr.chromatic);
          if (tr.number) header.shiftByStaff.set(tr.number, shift);
          else {
            header.defaultShift = shift;
            header.shiftByStaff.clear();
          }
        }
        if (attrs.beats != null && attrs.beatUnit != null && attrs.beatUnit > 0) {
          if (header.beats == null) {
            header.beats = attrs.beats;
            header.beatUnit = attrs.beatUnit;
          } else if (attrs.beats !== header.beats || attrs.beatUnit !== header.beatUnit) {
            header.meterChanged = true;
          }
          barQ = attrs.beats * (4 / attrs.beatUnit);
        }
        if (attrs.beats != null && attrs.beatUnit != null) header.changes.push({ at: measureStart + cursor, beats: clampChangeBeats(attrs.beats), beatUnit: changeBeatUnit(attrs.beatUnit) });
        for (const k of attrs.keys) header.changes.push({ at: measureStart + cursor, key: transposeKey(keyFromFifths(k.fifths, k.mode), concertScore ? 0 : shiftFor(k.number || '1').chromatic), mode: k.mode, staff: k.number || undefined });
        applyKeys(attrs.keys);
        for (const clef of attrs.clefs) {
          const at = header.clefs.findIndex((item) => item.number === clef.number);
          if (at >= 0) header.clefs[at] = clef;
          else header.clefs.push(clef);
          if (clef.sign === "C") header.cClef = true;
        }
        continue;
      }
      if (child.name === "direction" || child.name === "sound") {
        const offset = num(textOf(child, "offset")) ?? 0;
        const at = measureStart + cursor + offset / divisions;
        const gradual = readGradualDirection(header, gradualState, child, at);
        const tempo = tempoFrom(child);
        const hasMetronome = Boolean(findNamed(child, "metronome"));
        const onlyGradualTarget = gradual.stop && !hasMetronome;
        if (tempo && !onlyGradualTarget) {
          if (header.bpm == null && at <= 1e-8) header.bpm = tempo;
          header.changes.push({ at, bpm: clampChangeBpm(tempo) });
        }
        const mark = readDirectionMark(child);
        if (mark.coarse) header.coarseDynamic = true;
        if (mark.other) header.otherDynamic = true;
        if (mark.dynamic || mark.hairpin || mark.hairpinEnd) {
          const offset = num(textOf(child, "offset")) ?? 0;
          placed.push({
            time: measureStart + cursor + offset / divisions,
            voice: textOf(child, "voice"),
            staff: textOf(child, "staff"),
            dynamic: mark.dynamic,
            hairpin: mark.hairpin,
            hairpinEnd: mark.hairpinEnd || undefined,
          });
        }
        if (child.name === "direction") {
          const offset = num(textOf(child, "offset")) ?? 0;
          const at = measureStart + cursor + offset / divisions;
          for (const t of kids(child, "direction-type")) {
            for (const r of kids(t, "rehearsal")) {
              const label = r.text.replace(/\s+/g, " ").trim().slice(0, 12);
              if (label) header.rehearsals.push({ at, label });
            }
          }
        }
        continue;
      }
      if (child.name === "harmony") {
        const offset = num(textOf(child, "offset")) ?? 0;
        const at = measureStart + cursor + offset / divisions;
        const root = first(child, "root");
        const kindNode = first(child, "kind");
        const bass = first(child, "bass");
        const got = chordFromMusicXml({
          rootStep: textOf(root, "root-step") ?? "",
          rootAlter: num(textOf(root, "root-alter")) ?? undefined,
          kind: (kindNode?.text ?? "").trim(),
          kindText: kindNode?.attrs.text,
          bassStep: textOf(bass, "bass-step") ?? undefined,
          bassAlter: num(textOf(bass, "bass-alter")) ?? undefined,
        });
        if (got) header.harmonies.push({ at, symbol: got.symbol, unsupported: got.unsupported });
        else header.harmonies.push({ at, symbol: "", unsupported: true });
        continue;
      }
      if (child.name === "backup" || child.name === "forward") {
        const raw = num(textOf(child, "duration")) ?? 0;
        const delta = raw / divisions;
        const next = child.name === "forward" ? cursor + delta : cursor - delta;
        bump(next < 0 ? 0 : next);
        forgetGrace();
        continue;
      }
      if (child.name !== "note") continue;
      if (hasChild(child, "grace")) {
        const graceVoice = textOf(child, "voice") ?? "1";
        const graceStaff = textOf(child, "staff") ?? "1";
        const graceShift = concertScore ? { chromatic: 0, octaveChange: 0 } : shiftFor(graceStaff);
        const graceMidi = midiOf(child, graceShift.chromatic + graceShift.octaveChange * 12);
        const slash = first(child, "grace")?.attrs.slash === "yes";
        graceCount += 1;
        if (graceCount === 1 && graceMidi != null) {
          graceWait = { midi: graceMidi, voice: graceVoice, staff: graceStaff, slash };
        } else {
          header.grace = true;
          graceWait = null;
        }
        continue;
      }
      const raw = num(textOf(child, "duration"));
      if (raw == null || raw <= 0) continue;
      const dur = raw / divisions;
      const voice = textOf(child, "voice") ?? "1";
      const staff = textOf(child, "staff") ?? "1";
      if (hasChild(child, "cue")) {
        header.cue = true;
        if (!hasChild(child, "chord")) {
          const cue: Ev = {
            start: measureStart + cursor,
            dur,
            pitches: [],
            pitchTies: [],
            voice,
            staff,
            pitched: false,
          };
          events.push(cue);
          bump(cursor + dur);
        }
        continue;
      }
      const rest = hasChild(child, "rest");
      if (hasChild(child, "unpitched")) header.unpitched = true;
      const ties = tiesOf(child);
      const marks = readNoteMarks(child, header);
      const lyric = readLyric(child, header);
      if (rest && lyric) header.lyricOnRest = true;
      const active = concertScore ? { chromatic: 0, octaveChange: 0 } : shiftFor(staff);
      const semis = active.chromatic + active.octaveChange * 12;
      let midi: number | null = null;
      if (!rest && !hasChild(child, "unpitched")) {
        midi = midiOf(child, semis);
        if (midi == null) continue;
      }
      if (hasChild(child, "chord") && events.length) {
        const prev = events[events.length - 1];
        if (prev.voice === voice && prev.staff === staff && midi != null) {
          if (Math.abs(prev.dur - dur) > 1e-8) {
            events.push({ ...prev, dur, pitches: [midi], pitchTies: [{ midi, start: ties.start, stop: ties.stop }] });
            maxCursor = Math.max(maxCursor, prev.start - measureStart + dur);
            continue;
          }
          if (prev.pitches.length >= CHORD_TONE_LIMIT) header.trimmed = true;
          else if (!prev.pitches.includes(midi)) {
            prev.pitches.push(midi);
            prev.pitchTies.push({ midi, start: ties.start, stop: ties.stop });
            if (tiesDisagree(prev.pitchTies)) header.partialTie = true;
            const finger = readFingering(child);
            if (finger) {
              const fingers = prev.fingers ? prev.fingers.slice() : prev.pitches.slice(0, -1).map(() => 0);
              fingers.push(finger);
              prev.fingers = fingers;
            }
          }
          if (marks.articulations) {
            const merged = sortArts([...(prev.articulations ?? []), ...marks.articulations]);
            if (merged.length) prev.articulations = merged;
          }
          if (!prev.ornament && marks.ornament) prev.ornament = marks.ornament;
          if (marks.slurStart) prev.slurStart = true;
          if (marks.slurEnd) prev.slurEnd = true;
          if (marks.fermata) prev.fermata = true;
          prev.lyric = adoptLyric(prev.lyric, lyric, header);
          prev.pitched = true;
        }
        continue;
      }
      const event: Ev = {
        start: measureStart + cursor,
        dur,
        pitches: midi == null ? [] : [midi],
        pitchTies: midi == null ? [] : [{ midi, start: ties.start, stop: ties.stop }],
        voice,
        staff,
        pitched: midi != null,
        ...marks,
        lyric: rest ? undefined : lyric,
        ...(readFingering(child) && midi != null ? { fingers: [readFingering(child)!] } : {}),
      };
      if (graceCount > 1 || (graceCount === 1 && !graceWait)) header.grace = true;
      else if (
        graceWait &&
        graceWait.voice === voice &&
        graceWait.staff === staff &&
        !event.ornament
      ) {
        event.ornament = graceWait.slash ? "grace" : "appoggiatura";
        event.gracePitch = graceWait.midi;
      } else if (graceWait) header.grace = true;
      graceWait = null;
      graceCount = 0;
      events.push(event);
      bump(cursor + dur);
    }
    const last = index === measures.length - 1;
    let span = maxCursor;
    if (span <= 1e-8) span = barQ;
    header.measureEnds.push(measureStart + span);
    for (const bar of kids(measure, "barline")) {
      const side = bar.attrs.location === "left" ? "left" : "right";
      const repeat = first(bar, "repeat")?.attrs.direction;
      const ending = first(bar, "ending");
      header.repeatMarks.push({
        at: side === "left" ? measureStart : measureStart + span,
        side,
        ...(repeat ? { repeat } : {}),
        ...(ending ? { ending: { number: (ending.attrs.number || "").trim(), type: ending.attrs.type || "" } } : {}),
      });
    }
    header.jumpMarks.push(...measureJumps(measure, measureStart, measureStart + span));
    scoreEnd = measureStart + span;
    if (!last) measureStart += span;
  });

  closeOpenGraduals(header, gradualState, scoreEnd);
  const pickup = header.measureEnds[0] ?? 0;
  const openingBar = (header.beats ?? 4) * 4 / (header.beatUnit ?? 4);
  const completeFollowing = header.measureEnds.some((end, i, ends) => i > 0 && end - ends[i-1] >= openingBar - 1e-8);
  const padding = measures.length > 1 && completeFollowing && pickup > 0 && pickup < openingBar - 1e-8 ? openingBar - pickup : 0;
  if (padding) {
    for (const event of events) event.start += padding;
    for (const mark of placed) mark.time += padding;
    for (const list of [header.repeatMarks, header.jumpMarks, header.changes, header.harmonies, header.rehearsals])
      for (const mark of list) if (mark.at > 0 || list !== header.changes) mark.at += padding;
    for (const gradual of header.gradualTempos) { gradual.from += padding; gradual.to += padding; }
    header.measureEnds = header.measureEnds.map(end => end + padding);
  }
  placeDirections(events, placed);
  return { events, header };
}

/** Segno / Coda / Fine / To Coda / D.C. / D.S. in one measure, from `<sound>` first, then the printed words. */
function measureJumps(measure: XNode, start: number, end: number): { kind: JumpKind; at: number }[] {
  const out: { kind: JumpKind; at: number }[] = [];
  const add = (kind: JumpKind) => {
    if (!out.some((m) => m.kind === kind)) out.push({ kind, at: kind === "segno" || kind === "coda" ? start : end });
  };
  for (const child of measure.children) {
    if (child.name !== "direction" && child.name !== "sound") continue;
    const sound = child.name === "sound" ? child : first(child, "sound");
    const a = sound?.attrs ?? {};
    const types = child.name === "direction" ? kids(child, "direction-type") : [];
    const words = types.flatMap((t) => kids(t, "words")).map((w) => w.text.trim()).join(" ");
    const toCoda = a.tocoda !== undefined || /to\s*coda/i.test(words);
    if (a.dacapo === "yes" || /^d\.?\s*c\.?(\s|$)|da\s*capo/i.test(words)) add("dc");
    else if (a.dalsegno !== undefined || /^d\.?\s*s\.?(\s|$)|dal\s*segno/i.test(words)) add("ds");
    if (a.fine !== undefined || /^fine$/i.test(words)) add("fine");
    if (toCoda) add("toCoda");
    if (a.segno !== undefined || types.some((t) => first(t, "segno"))) add("segno");
    if (!toCoda && (a.coda !== undefined || types.some((t) => first(t, "coda")))) add("coda");
  }
  return out;
}

/** A direction sticks to the next onset at or after its time, in its own voice and staff. */
function placeDirections(
  events: Ev[],
  placed: Array<{
    time: number;
    voice: string | null;
    staff: string | null;
    dynamic?: DynamicMark;
    hairpin?: Hairpin;
    hairpinEnd?: boolean;
  }>,
) {
  const eps = 1e-6;
  for (const mark of placed) {
    let best = Infinity;
    for (const event of events) {
      if (mark.voice && mark.voice !== event.voice) continue;
      if (mark.staff && mark.staff !== event.staff) continue;
      if (event.start + eps < mark.time) continue;
      if (event.start < best) best = event.start;
    }
    if (!Number.isFinite(best)) continue;
    for (const event of events) {
      if (mark.voice && mark.voice !== event.voice) continue;
      if (mark.staff && mark.staff !== event.staff) continue;
      if (Math.abs(event.start - best) > eps) continue;
      if (mark.dynamic) event.dynamic = mark.dynamic;
      if (mark.hairpin) event.hairpin = mark.hairpin;
      if (mark.hairpinEnd) event.hairpinEnd = true;
    }
  }
}

function pickClef(clefs: ClefMark[], staff: string, notes: ScoreNote[]): Clef {
  const mark =
    clefs.find((clef) => clef.number === staff) ??
    clefs.find((clef) => clef.number === "1") ??
    clefs[0];
  if (mark?.sign === "F") return "bass";
  if (mark?.sign === "G" || mark?.sign === "C") return "treble";
  const midis = notes.flatMap((note) => note.pitches);
  if (midis.length && Math.max(...midis) < 55) return "bass";
  return "treble";
}

type SeqNote = {
  pitches: number[];
  dur: number;
  tieForward: boolean;
  dynamic?: DynamicMark;
  hairpin?: Hairpin;
  hairpinEnd?: boolean;
  articulations?: Articulation[];
  ornament?: Ornament;
  gracePitch?: number;
  slurStart?: boolean;
  slurEnd?: boolean;
  lyric?: NoteLyric;
  fingers?: number[];
};

function markWouldMove(prev: SeqNote, event: Ev): boolean {
  if (event.dynamic && event.dynamic !== prev.dynamic) return true;
  if (event.hairpin && event.hairpin !== prev.hairpin) return true;
  // The continuation is a later time. Its wedge stop closes a different span
  // from any stop already on the first tied piece.
  if (event.hairpinEnd) return true;
  return false;
}

function absorbMarks(prev: SeqNote, event: Ev) {
  if (event.slurStart) prev.slurStart = true;
  if (event.slurEnd) prev.slurEnd = true;
  if (!prev.ornament && event.ornament) {
    prev.ornament = event.ornament;
    if (event.gracePitch != null) prev.gracePitch = event.gracePitch;
  }
  if (event.articulations?.length) {
    prev.articulations = sortArts([...(prev.articulations ?? []), ...event.articulations]);
  }
}

function marksFrom(event: Ev): Omit<SeqNote, "pitches" | "dur" | "tieForward"> {
  return {
    dynamic: event.dynamic,
    hairpin: event.hairpin,
    hairpinEnd: event.hairpinEnd,
    articulations: event.articulations,
    ornament: event.ornament,
    gracePitch: event.gracePitch,
    slurStart: event.slurStart,
    slurEnd: event.slurEnd,
    fingers: event.fingers,
  };
}

function sameTiedPitch(
  prev: SeqNote | undefined,
  event: Ev,
  tie: { start: boolean; stop: boolean } | null,
): boolean {
  return Boolean(
    tie?.stop &&
    prev?.tieForward &&
    prev.pitches.length > 0 &&
    samePitch(prev.pitches, event.pitches),
  );
}

/** Drop a repeated tie-chain word. Keep a stop, continue, or bare extender on this onset. */
function withoutRepeatedWord(lyric: NoteLyric): NoteLyric | undefined {
  if (!hasExtendMark(lyric)) return undefined;
  const kept: NoteLyric = { text: "", syllabic: "single", extend: true };
  if (lyric.extendType) kept.extendType = lyric.extendType;
  return kept;
}

/** True when this lyric is an extender, typed or a bare `<extend/>`. */
function hasExtendMark(lyric: NoteLyric | undefined): boolean {
  return Boolean(lyric && (lyric.extend || lyric.extendType));
}

/** Keep every continuation extender. One fragment still mirrors the legacy slot. */
function placeMergedMark(prev: SeqNote, extra: NoteLyric, endAt: number, dur: number) {
  if (!hasExtendMark(extra)) return;
  const marked: NoteLyric = prev.lyric ?? { text: "", syllabic: "single" };
  const marks = lyricFragments(marked).filter((item) => item.dur > 1e-6);
  const incoming: LyricFragment = { at: endAt, dur };
  if (extra.extendType) incoming.extendType = extra.extendType;
  const index = marks.findIndex((item) => Math.abs(item.at - endAt) < 1e-6);
  if (index >= 0) marks[index] = incoming;
  else marks.push(incoming);
  marks.sort((a, b) => a.at - b.at);
  const next: NoteLyric = { ...marked, fragments: marks.map((item) => ({ ...item })) };
  delete next.extendEnd;
  delete next.extendEndBare;
  delete next.extendEndAt;
  delete next.extendEndDur;
  if (marked.extendType) next.extendType = marked.extendType;
  else delete next.extendType;
  if (marked.extend || marked.extendType) next.extend = true;
  else delete next.extend;
  if (marks.length === 1) {
    const only = marks[0];
    if (only.extendType) next.extendEnd = only.extendType;
    else next.extendEndBare = true;
    next.extendEndAt = only.at;
    next.extendEndDur = only.dur;
  }
  prev.lyric = next;
}

function linearize(events: Ev[], header: Header): ScoreNote[] {
  // A sequential voice cannot hold overlapping events. Slice their sounding union
  // at every onset/release rather than dropping a later event wholesale.
  let latestEnd = 0;
  const overlaps = events.some(e => {
    const overlap = latestEnd > e.start + 1e-7;
    latestEnd = Math.max(latestEnd, e.start + e.dur);
    return overlap;
  });
  if (overlaps) {
    header.overlapSlices = true;
    const cuts = [...new Set(events.flatMap(e => [e.start, e.start + e.dur]))].sort((a,b) => a-b);
    const slices: ScoreNote[] = [];
    let next = 0;
    let active: Ev[] = [];
    for (let i = 0; i + 1 < cuts.length; i++) {
      const at = cuts[i], end = cuts[i+1];
      if (end - at < 1e-8) continue;
      active = active.filter(e => e.start + e.dur > at + 1e-8);
      while (next < events.length && events[next].start <= at + 1e-8) {
        const event = events[next++];
        if (event.start + event.dur > at + 1e-8) active.push(event);
      }
      const onset = active.find(e => Math.abs(e.start - at) < 1e-8);
      slices.push({ ...(onset ? { ...marksFrom(onset), lyric: onset.lyric } : {}), pitches: [...new Set(active.flatMap(e => e.pitches))].sort((a,b)=>a-b), dur: end-at });
    }
    if (cuts[0] > 1e-8) slices.unshift({ pitches: [], dur: cuts[0] });
    return slices;
  }
  const seq: SeqNote[] = [];
  let cursor = 0;
  /** Syllable of the current adjacent same-pitch tie, even after its text was suppressed. */
  let tiedWord: string | undefined;
  for (const event of events) {
    const tie = noteTie(event);
    if (event.start > cursor + 1e-6) {
      seq.push({ pitches: [], dur: snap(event.start - cursor), tieForward: false });
      tiedWord = undefined;
      cursor = event.start;
    }
    if (event.start < cursor - 1e-6) continue;
    const prev = seq[seq.length - 1];
    const continued = sameTiedPitch(prev, event, tie);
    if (continued && prev && !markWouldMove(prev, event)) {
      const endAt = snap(prev.dur);
      const piece = snap(event.dur);
      prev.dur = snap(prev.dur + event.dur);
      prev.tieForward = Boolean(tie?.start);
      absorbMarks(prev, event);
      if (event.lyric) {
        const extra = event.lyric;
        const syllable = tiedWord || prev.lyric?.text || "";
        const sameWord = Boolean(extra.text && syllable && extra.text === syllable);
        const textlessMark = !extra.text && hasExtendMark(extra);
        if (sameWord || textlessMark) {
          if (hasExtendMark(extra)) placeMergedMark(prev, extra, endAt, piece);
        } else if (extra.text && !syllable) {
          // A marker-only lyric is not a syllable. Keep it and take this word.
          const base = prev.lyric ?? { text: "", syllabic: extra.syllabic };
          prev.lyric = { ...base, text: extra.text, syllabic: extra.syllabic };
          if (hasExtendMark(extra)) placeMergedMark(prev, extra, endAt, piece);
          tiedWord = extra.text;
        } else if (extra.text && extra.text !== syllable) {
          header.lyricOnTie = true;
          if (hasExtendMark(extra)) placeMergedMark(prev, extra, endAt, piece);
        }
      }
      cursor = event.start + event.dur;
      continue;
    }
    if (continued && prev && markWouldMove(prev, event)) header.heldTieMark = true;
    const dur = snap(event.dur);
    if (dur <= 0) continue;
    let lyric = event.lyric;
    if (continued && lyric?.text && tiedWord && lyric.text === tiedWord) {
      lyric = withoutRepeatedWord(lyric);
    } else if (lyric?.text) {
      tiedWord = lyric.text;
    } else if (!continued) {
      tiedWord = undefined;
    }
    seq.push({
      pitches: event.pitches,
      dur,
      tieForward: Boolean(tie?.start),
      ...marksFrom(event),
      lyric,
    });
    cursor = event.start + event.dur;
  }
  return seq.map((item) => {
    const note: ScoreNote = { pitches: item.pitches, dur: item.dur };
    if (item.dynamic) note.dynamic = item.dynamic;
    if (item.hairpin) note.hairpin = item.hairpin;
    if (item.hairpinEnd) note.hairpinEnd = true;
    if (item.articulations?.length) note.articulations = item.articulations;
    if (item.ornament) note.ornament = item.ornament;
    if (
      (item.ornament === "grace" || item.ornament === "appoggiatura") &&
      item.gracePitch != null
    ) {
      note.gracePitch = item.gracePitch;
    }
    if (item.slurStart) note.slurStart = true;
    if (item.slurEnd) note.slurEnd = true;
    if (item.lyric && item.pitches.length) note.lyric = item.lyric;
    if (item.fingers?.some((finger) => Number.isInteger(finger) && finger >= 1 && finger <= 5)) {
      note.fingers = item.fingers;
    }
    return note;
  });
}

type PartRead = { id: string; name: string; piano: boolean; events: Ev[]; header: Header };

function collectParts(
  kind: "partwise" | "timewise",
  score: XNode,
  concertScore: boolean,
): PartRead[] {
  const names = new Map<string, string>();
  const pianos = new Set<string>();
  const list = first(score, "part-list");
  if (list) {
    for (const part of kids(list, "score-part")) {
      names.set(part.attrs.id || "", (textOf(part, "part-name") || "").trim());
      const labels = [textOf(part, "part-name"), ...kids(part, "score-instrument").map(node => textOf(node, "instrument-name"))].join(" ");
      const programs = kids(part, "midi-instrument").map(node => Number(textOf(node, "midi-program")));
      if (/\bpiano\b|pianoforte|钢琴|鋼琴/i.test(labels) || (programs.length > 0 && programs.every(p => p >= 1 && p <= 8))) pianos.add(part.attrs.id || "");
    }
  }
  const raw: Array<{ id: string; measures: XNode[] }> = [];
  if (kind === "partwise") {
    kids(score, "part").forEach((part, index) => {
      raw.push({ id: part.attrs.id || `P${index + 1}`, measures: kids(part, "measure") });
    });
  } else {
    const map = new Map<string, XNode[]>();
    const order: string[] = [];
    for (const measure of kids(score, "measure")) {
      for (const part of kids(measure, "part")) {
        const id = part.attrs.id || "P1";
        if (!map.has(id)) {
          order.push(id);
          map.set(id, []);
        }
        map.get(id)?.push(part);
      }
    }
    for (const id of order) raw.push({ id, measures: map.get(id) ?? [] });
  }
  return raw.map((part) => {
    const read = readPart(part.measures, concertScore);
    return {
      id: part.id,
      name: names.get(part.id) || "",
      piano: pianos.has(part.id),
      events: read.events,
      header: read.header,
    };
  });
}


function readCredits(score: XNode): { lyricist?: string; composer?: string } {
  const ident = first(score, "identification");
  if (!ident) return {};
  const out: { lyricist?: string; composer?: string } = {};
  for (const node of kids(ident, "creator")) {
    const value = cleanCredit(node.text);
    if (!value) continue;
    const kind = (node.attrs.type || "").toLowerCase();
    if (kind === "lyricist" || kind === "poet") out.lyricist = out.lyricist ?? value;
    else if (kind === "composer" || kind === "arranger" || kind === "") out.composer = out.composer ?? value;
  }
  return out;
}

function readTitle(score: XNode, fallback: string): string {
  const work = textOf(first(score, "work"), "work-title");
  const movement = textOf(score, "movement-title");
  const title = (work || movement || fallback || "").trim();
  return title.slice(0, 80) || "未命名";
}

function noticeFor(name: string, dropped: string[], notes: string[]): string {
  const kept = name
    ? `已保留「${name}」的音高、时值、调号、拍号和速度。`
    : "已保留旋律的音高、时值、调号、拍号和速度。";
  const skip = dropped.length ? `已略过${dropped.join("、")}。` : "";
  const extra = notes.length ? `${notes.join("。")}。` : "";
  return `${kept}${skip}${extra}音高是实际音高。`;
}

/** `|:` `:|` and endings 1 / 2 from barlines, in score quarters. */
function repeatsFromMarks(marks: RepeatMark[]): { list: ScoreRepeat[]; unsupported: boolean } {
  const order = [...marks].sort((a, b) => a.at - b.at || (a.side === "right" ? -1 : 1));
  const list: ScoreRepeat[] = [];
  let open = 0;
  let first: number | undefined;
  let second: ScoreRepeat | undefined;
  let unsupported = false;
  for (const mark of order) {
    const ending = mark.ending;
    if (ending && ending.number !== "1" && ending.number !== "2") unsupported = true;
    if (mark.repeat === "forward") open = mark.at;
    if (ending?.type === "start" && ending.number === "1") first = mark.at;
    if (ending?.type === "start" && ending.number === "2") second = list.find((r) => Math.abs(r.to - mark.at) < 1e-6 && r.ending !== undefined);
    if (ending && ending.number === "2" && (ending.type === "stop" || ending.type === "discontinue") && second) {
      second.endingEnd = mark.at;
      second = undefined;
    }
    if (mark.repeat === "backward") {
      list.push({ from: open, to: mark.at, ...(first !== undefined ? { ending: first } : {}) });
      first = undefined;
      open = mark.at;
    }
  }
  return { list, unsupported };
}

export function musicXmlToScore(xml: string, fallbackTitle: string): MusicXmlImport {
  const source = xml.replace(/^\uFEFF/, "");
  if (source.startsWith("PK")) {
    throw new Error("压缩的 .mxl 请通过 MusicXML/.mxl 文件导入入口打开");
  }
  let root: XNode;
  try {
    root = parseXml(source);
  } catch (err) {
    if (err instanceof Error && err.message.includes("MusicXML")) throw err;
    throw new Error("这不是 MusicXML 文件");
  }
  const found = findScore(root);
  if (!found) throw new Error("这不是 MusicXML 文件");
  const concertScore = hasName(found.node, "concert-score");
  const parts = collectParts(found.kind, found.node, concertScore);
  if (!parts.length) throw new Error("文件里没有音符");
  const chosenIndex = Math.max(
    0,
    parts.findIndex((part) => part.events.some((event) => event.pitched)),
  );
  const chosen = parts[chosenIndex];
  const timelineId = (event: Ev) => `${event.voice || "1"}/${event.staff || "1"}`;
  const seen: string[] = [];
  for (const event of chosen.events) {
    const id = timelineId(event);
    if (!seen.includes(id)) seen.push(id);
  }
  const metadata = first(first(found.node, "identification"), "miscellaneous");
  const declared = Number(metadata?.children.find(n => n.name === "miscellaneous-field" && n.attrs.name === "puxian-independent-voices")?.text);
  const ownIds = Number.isInteger(declared) && declared >= 3 && declared <= 16
    ? Array.from({ length: declared }, (_, i) => `${i + 1}/${i + 1}`) : null;
  const keptIds = ownIds && seen.every(id => ownIds.includes(id)) ? ownIds : seen.slice(0, 16);
  const primaryId = keptIds[0] ?? "1/1";
  const staff = primaryId.split("/")[1] || "1";
  const notesOf = (id: string) =>
    linearize(
      chosen.events
        .filter((event) => timelineId(event) === id)
        .sort((a, b) => a.start - b.start || Number(b.pitched) - Number(a.pitched)),
      chosen.header,
    );
  const notes = notesOf(primaryId);
  if (!notes.length && !keptIds.some(id => notesOf(id).length)) throw new Error("文件里没有音符");
  const secondNotes = keptIds[1] ? notesOf(keptIds[1]) : [];
  const extraNotes = keptIds.slice(2).map(notesOf);

  const header = chosen.header;
  const sig = header.sigByStaff.get(staff) ?? header.defaultSig;
  let key: KeyName;
  let mode: Mode;
  if (!sig) {
    const guessed = guessKey(notes);
    key = guessed.key;
    mode = guessed.mode;
  } else {
    mode = sig.mode;
    const opening = header.sigByStaff.has(staff)
      ? header.sigByStaff.get(staff)!.keyShift
      : (header.keyShiftByStaff.get(staff) ?? sig.keyShift);
    key = transposeKey(keyFromFifths(sig.fifths, mode), concertScore ? 0 : opening);
  }
  const beats = clampInt(header.beats ?? 4, 1, 16);
  const beatUnit = [1, 2, 4, 8, 16, 32].includes(header.beatUnit ?? 0)
    ? (header.beatUnit as number)
    : 4;
  const bpm = clampInt(header.bpm ?? 96, 20, 400);
  const clef = pickClef(header.clefs, staff, notes);
  const midis = [...notes, ...secondNotes, ...extraNotes.flat()].flatMap((note) => note.pitches);
  const extraParts = parts.some(
    (part, index) => index !== chosenIndex && part.events.some((event) => event.pitched),
  );
  const dropped: string[] = [];
  if (extraParts || seen.length > 16) dropped.push("其余声部");
  if (hasAny(found.node, ["repeat", "ending", "segno", "coda"])) dropped.push("反复");
  if (header.grace) dropped.push("装饰音");
  if (header.otherOrnament) dropped.push("其他装饰音");
  if (header.otherDynamic) dropped.push("其他力度");
  if (!header.cue && hasName(found.node, "cue")) dropped.push("提示音");
  if (header.unpitched) dropped.push("打击乐音高");
  if (header.trimmed) dropped.push("过多的和弦音");
  if (header.cClef) dropped.push("C谱号");
  const notesOnImport: string[] = [];
  if (header.coarseDynamic) notesOnImport.push("更细的力度记成 p 或 f");
  if (header.heldTieMark) {
    notesOnImport.push("延音线后一截上的力度或渐强渐弱留在后一个音，没有挪到长音开头");
  }
  if (header.stackedSlur) notesOnImport.push("叠着的连线只留了一层");
  const transposeDrifted =
    header.driftStaves.has(staff) ||
    (!header.sigByStaff.has(staff) && !header.keyShiftByStaff.has(staff) && header.defaultDrift);
  if (sig?.changed) notesOnImport.push("中途调号变化已保留");
  if (transposeDrifted) {
    notesOnImport.push("中途移调变了，调名只按开头的实际调，后面的音仍按当时的移调换算");
  }
  if (header.cue) notesOnImport.push("提示音不记音高，时值留成休止，后面的音不会提前");
  if (header.partialTie) {
    notesOnImport.push("和弦里只有部分音有延音线，没有把整个和弦接成长音");
  }
  if (header.extraVerse) notesOnImport.push("只保留了第 1 段歌词，其余段没有并进来");
  if (header.lyricOnRest) notesOnImport.push("休止符上的歌词已略过，没有挪到后面的音");
  if (header.lyricOnChord) notesOnImport.push("和弦上多出来的歌词没有再占一个音");
  if (header.lyricOnTie) notesOnImport.push("连音后面不同的歌词没有再写一次");
  if (header.unsupportedLyric) notesOnImport.push("歌词里的连读或不能识别的音节记号只留了文字");
  if (header.lyricTrimmed) notesOnImport.push("过长的歌词已截短");
  if (keptIds.length > 1) notesOnImport.push(keptIds.length === 2 ? "两个声部都留下了，各按自己的节奏" : `${keptIds.length} 个声部都留下了，各按自己的节奏`);
  if (seen.length > 16) notesOnImport.push("只保留前十六个声部");

  const losses: string[] = [];
  const spellingLost = (node: XNode): boolean => {
    if (node.name === "pitch") {
      const step = textOf(node, "step") ?? "";
      const acc = num(textOf(node, "alter")) ?? 0;
      const octave = num(textOf(node, "octave")) ?? 4;
      const midi = (octave + 1) * 12 + (LETTER_PC[step] ?? 0) + acc;
      const written = spellMidi(midi, key, mode);
      return written.letter !== step || written.acc !== acc || written.octave !== octave;
    }
    return node.children.some(spellingLost);
  };
  if (spellingLost(found.node)) losses.push("源音高拼写与等音调名（当前按实际音高和调号重新拼写）");
  if (extraParts) losses.push("其他乐器分谱（只读第一个有音的分谱）");
  if (seen.length > 16) losses.push("第十七声部起（谱线最多十六个声部）");
  if (hasAny(found.node, ["repeat", "ending"])) losses.push("反复与房号（只按谱面播放一遍）");
  if (hasAny(found.node, ["segno", "coda"])) losses.push("跳转记号（D.S.、Coda 等）");
  if (header.extraVerse) losses.push("第 2 段起的歌词（只保留第 1 段）");
  if (hasAny(found.node, ["pedal"])) losses.push("踏板");
  if (hasAny(found.node, ["fermata"])) losses.push("延长记号");
  if (hasAny(found.node, ["non-arpeggiate"])) losses.push("不琶音括号（non-arpeggiate）");
  if (hasAny(found.node, ["glissando", "slide"])) losses.push("滑音");
  if (hasAny(found.node, ["tremolo"])) losses.push("震音");
  if (hasAny(found.node, ["breath-mark", "caesura"])) losses.push("呼吸与停顿记号");
  if (hasAny(found.node, ["words"])) losses.push("谱上文字");
  if (hasAny(found.node, ["rehearsal"]) && !header.rehearsals.length) losses.push("排练号");
  if (header.grace) losses.push("装饰音（倚音）");
  if (header.otherOrnament) losses.push("其他装饰音（波音、回音等）");
  if (header.otherDynamic) losses.push("其他力度记号");
  if (header.coarseDynamic) losses.push("更细的力度（pp、ff 等）记成 p 或 f");
  if (header.stackedSlur) losses.push("叠着的连线只留一层");
  if (header.partialTie) losses.push("和弦里只有部分音的延音线");
  if (header.overlapSlices) losses.push("同声部重叠音已按发声区间拆段，持音在拆段处会重新起音");
  if (!header.cue && hasName(found.node, "cue")) losses.push("提示音");
  if (header.cue) losses.push("提示音的音高（时值留成休止）");
  if (header.unpitched) losses.push("打击乐音高");
  if (header.trimmed) losses.push("超过 8 个音的和弦音");
  if (header.cClef) losses.push("C 谱号（改用高音或低音谱号）");
  if (header.lyricOnRest) losses.push("休止符上的歌词");
  if (header.lyricOnChord || header.lyricOnTie) losses.push("和弦或延音上多出来的歌词");
  if (header.unsupportedLyric) losses.push("歌词连读与音节记号（只留文字）");
  if (header.lyricTrimmed) losses.push("过长歌词的截断部分");

  const score: Score = {
    changes: canonicalChanges([{ at: 0, bpm, beats, beatUnit, key, mode }, ...header.changes.filter(c => !c.staff || c.staff === staff)]).filter(c => c.at > 0),
    title: readTitle(found.node, fallbackTitle),
    ...(chosen.piano ? { staffInstrument: "piano" as const } : {}),
    ...readCredits(found.node),
    bpm,
    beats,
    beatUnit,
    key,
    mode,
    clef,
    tonicOctave: inferTonicOctave(midis, key),
    notes,
    measureEnds: header.measureEnds,
  };
  if (keptIds.length > 1) score.voice2 = secondNotes;
  if (extraNotes.length) score.extraVoices = extraNotes;
  const repeats = repeatsFromMarks(header.repeatMarks);
  const hadRepeats = hasAny(found.node, ["repeat", "ending"]);
  const hadJumps = hasAny(found.node, ["segno", "coda"]) || header.jumpMarks.length > 0;
  let repeatsKept = !hadRepeats;
  if (repeats.list.length) {
    const kept = keepValidRepeats(score, repeats.list);
    if (kept) score.repeats = kept;
    if (kept && kept.length === repeats.list.length && !repeats.unsupported) {
      repeatsKept = true;
      notesOnImport.push("已保留反复记号与一房、二房");
    } else if (kept) notesOnImport.push("部分反复记号已保留，其余（嵌套、三房以上等）按谱面顺序");
  }
  let jumpsKept = !hadJumps;
  if (header.jumpMarks.length) {
    const jumps: ScoreJumps = {};
    for (const m of header.jumpMarks) if (jumps[m.kind] === undefined) jumps[m.kind] = m.at;
    if (!jumpProblem(score, jumps)) {
      score.jumps = jumps;
      jumpsKept = true;
      notesOnImport.push("已保留跳转记号（D.C./D.S./Fine/Coda）");
    }
  }
  const drop = (list: string[], prefix: string) => {
    const at = list.findIndex((item) => item.startsWith(prefix));
    if (at >= 0) list.splice(at, 1);
  };
  if (repeatsKept && jumpsKept) drop(dropped, "反复");
  if (repeatsKept) drop(losses, "反复与房号");
  if (jumpsKept) drop(losses, "跳转记号");
  const marks = canonicalChordSymbols(
    header.harmonies.filter((item) => item.symbol).map((item) => ({ at: item.at, symbol: item.symbol })),
  );
  if (marks) score.chordSymbols = marks;
  const rehearsals = canonicalRehearsals(header.rehearsals);
  if (rehearsals) score.rehearsals = rehearsals;
  const fermatas = canonicalFermatas(
    chosen.events.flatMap((event) => {
      if (!event.fermata) return [];
      const voice = keptIds.indexOf(timelineId(event));
      if (voice < 0) return [];
      return [{ voice, at: event.start }];
    }),
  );
  if (fermatas) score.fermatas = fermatas;
  if (fermatas) drop(losses, "延长记号");
  const graduals = cleanGradualTempos(header.gradualTempos);
  if (graduals) (score as ScoreWithGradual).gradualTempos = graduals;
  if (header.unusedWords <= 0) drop(losses, "谱上文字");
  const lostHarmony = header.harmonies.filter((item) => item.unsupported || !item.symbol).length;
  if (lostHarmony && marks) notesOnImport.push(`有 ${lostHarmony} 处复杂或不识别的和弦标记已按原文保留`);
  else if (lostHarmony) notesOnImport.push(`有 ${lostHarmony} 处和弦标记无法识别，没有写进谱里`);
  else if (marks) notesOnImport.push("已保留和弦标记");
  return {
    score,
    notice: noticeFor(chosen.name.slice(0, 40), dropped, notesOnImport),
    losses,
  };
}
