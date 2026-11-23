import { voiceList } from "./voices.ts";
import { alignNoteSlots } from "./text-edit-carry.ts";
import { registerChordSymbolShifter, type KeyName, type Mode, type Score, type ScoreNote } from "./theory.ts";
import { barOfQuarter, barStarts } from "./practice.ts";
import type { Timeline } from "./score-timeline.ts";

/** A lead-sheet mark at a written quarter-note position. */
export type ChordSymbol = { at: number; symbol: string };

export type ChordQuality =
  | "major"
  | "minor"
  | "diminished"
  | "augmented"
  | "dominant"
  | "major-seventh"
  | "minor-seventh"
  | "half-diminished"
  | "diminished-seventh"
  | "suspended-second"
  | "suspended-fourth"
  | "power";

export type ChordPitch = { letter: string; acc: number };

export type ParsedChord = {
  root: ChordPitch;
  quality: ChordQuality;
  bass?: ChordPitch;
  /** Trailing quality text we did not map; kept so we do not drop the file. */
  unknown?: string;
};

const LETTER_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

const SHARP_SPELL: ChordPitch[] = [
  { letter: "C", acc: 0 },
  { letter: "C", acc: 1 },
  { letter: "D", acc: 0 },
  { letter: "D", acc: 1 },
  { letter: "E", acc: 0 },
  { letter: "F", acc: 0 },
  { letter: "F", acc: 1 },
  { letter: "G", acc: 0 },
  { letter: "G", acc: 1 },
  { letter: "A", acc: 0 },
  { letter: "A", acc: 1 },
  { letter: "B", acc: 0 },
];

const FLAT_SPELL: ChordPitch[] = [
  { letter: "C", acc: 0 },
  { letter: "D", acc: -1 },
  { letter: "D", acc: 0 },
  { letter: "E", acc: -1 },
  { letter: "E", acc: 0 },
  { letter: "F", acc: 0 },
  { letter: "G", acc: -1 },
  { letter: "G", acc: 0 },
  { letter: "A", acc: -1 },
  { letter: "A", acc: 0 },
  { letter: "B", acc: -1 },
  { letter: "B", acc: 0 },
];

const MAJOR_FIFTHS: Record<KeyName, number> = {
  C: 0,
  G: 1,
  D: 2,
  A: 3,
  E: 4,
  B: 5,
  "F#": 6,
  F: -1,
  Bb: -2,
  Eb: -3,
  Ab: -4,
  Db: -5,
};

/** Matches theory.prefersSharps for the twelve KeyName values (C and A minor count as sharps). */
export function chordPrefersSharps(key: KeyName, mode: Mode): boolean {
  const fifths = MAJOR_FIFTHS[key];
  return (mode === "minor" ? fifths - 3 : fifths) >= 0;
}

export function pitchClassOf(pitch: ChordPitch): number {
  return (((LETTER_PC[pitch.letter] ?? 0) + pitch.acc) % 12 + 12) % 12;
}

export function spellPitchClass(pc: number, key: KeyName, mode: Mode): ChordPitch {
  const index = ((pc % 12) + 12) % 12;
  const table = chordPrefersSharps(key, mode) ? SHARP_SPELL : FLAT_SPELL;
  return { ...table[index] };
}

export function formatPitch(pitch: ChordPitch): string {
  const acc = pitch.acc > 0 ? "#".repeat(pitch.acc) : "b".repeat(-pitch.acc);
  return `${pitch.letter}${acc}`;
}

const QUALITY_TOKEN: Record<ChordQuality, string> = {
  major: "",
  minor: "m",
  diminished: "dim",
  augmented: "aug",
  dominant: "7",
  "major-seventh": "maj7",
  "minor-seventh": "m7",
  "half-diminished": "m7b5",
  "diminished-seventh": "dim7",
  "suspended-second": "sus2",
  "suspended-fourth": "sus4",
  power: "5",
};

/** MusicXML 3.1 <kind> values we write and read. */
export const MUSICXML_KIND: Record<ChordQuality, string> = {
  major: "major",
  minor: "minor",
  diminished: "diminished",
  augmented: "augmented",
  dominant: "dominant",
  "major-seventh": "major-seventh",
  "minor-seventh": "minor-seventh",
  "half-diminished": "half-diminished",
  "diminished-seventh": "diminished-seventh",
  "suspended-second": "suspended-second",
  "suspended-fourth": "suspended-fourth",
  power: "power",
};

const KIND_FROM_XML: Record<string, ChordQuality> = Object.fromEntries(
  Object.entries(MUSICXML_KIND).map(([quality, kind]) => [kind, quality as ChordQuality]),
);

function parseAccidental(raw: string): { acc: number; rest: string } {
  let acc = 0;
  let i = 0;
  while (i < raw.length) {
    const ch = raw[i];
    if (ch === "#" || ch === "♯") acc += 1;
    else if (ch === "b" || ch === "♭") acc -= 1;
    else break;
    i += 1;
  }
  return { acc, rest: raw.slice(i) };
}

function parsePitch(raw: string): { pitch: ChordPitch; rest: string } | null {
  const match = /^([A-Ga-g])/.exec(raw);
  if (!match) return null;
  const letter = match[1].toUpperCase();
  const { acc, rest } = parseAccidental(raw.slice(1));
  return { pitch: { letter, acc }, rest };
}

/**
 * Parse a lead-sheet token such as `C`, `Am7`, `G/B`, `F#m7`, `Bbm`.
 * Returns null when there is no readable root.
 */
export function parseChordSymbol(symbol: string): ParsedChord | null {
  const trimmed = symbol.trim();
  if (!trimmed) return null;
  const rootHit = parsePitch(trimmed);
  if (!rootHit) return null;
  let rest = rootHit.rest.trim();
  let bass: ChordPitch | undefined;
  const slash = rest.lastIndexOf("/");
  if (slash >= 0) {
    const bassHit = parsePitch(rest.slice(slash + 1).trim());
    if (bassHit && bassHit.rest.trim() === "") {
      bass = bassHit.pitch;
      rest = rest.slice(0, slash).trim();
    }
  }
  let quality: ChordQuality = "major";
  let unknown: string | undefined;
  if (rest) {
    const lower = rest;
    const patterns: Array<{ quality: ChordQuality; re: RegExp }> = [
      { quality: "major-seventh", re: /^(maj7|major7|ma7|M7|Δ7|Δ|大七)/ },
      { quality: "half-diminished", re: /^(m7b5|min7b5|-7b5|ø7|ø)/i },
      { quality: "diminished-seventh", re: /^(dim7|o7|°7)/i },
      { quality: "minor-seventh", re: /^(min7|-7|m7|小七)/i },
      { quality: "dominant", re: /^7/ },
      { quality: "suspended-second", re: /^sus2/i },
      { quality: "suspended-fourth", re: /^(sus4|sus)/i },
      { quality: "diminished", re: /^(dim|o|°|减)/i },
      { quality: "augmented", re: /^(aug|\+|增)/i },
      { quality: "power", re: /^5/ },
      { quality: "minor", re: /^(min|m|-|小)/i },
      { quality: "major", re: /^(maj|ma|major|M)/ },
    ];
    let matched = false;
    for (const item of patterns) {
      const found = item.re.exec(lower);
      if (!found) continue;
      quality = item.quality;
      const leftover = lower.slice(found[0].length).trim();
      if (leftover) unknown = leftover;
      matched = true;
      break;
    }
    if (!matched) unknown = rest;
  }
  const parsed: ParsedChord = { root: rootHit.pitch, quality };
  if (bass) parsed.bass = bass;
  if (unknown) parsed.unknown = unknown;
  return parsed;
}

export function formatChordSymbol(parsed: ParsedChord, key: KeyName, mode: Mode): string {
  const root = formatPitch(spellPitchClass(pitchClassOf(parsed.root), key, mode));
  let body = `${root}${QUALITY_TOKEN[parsed.quality]}`;
  if (parsed.unknown) body += parsed.unknown;
  if (parsed.bass) body += `/${formatPitch(spellPitchClass(pitchClassOf(parsed.bass), key, mode))}`;
  return body;
}

export function transposeParsedChord(parsed: ParsedChord, semitones: number, key: KeyName, mode: Mode): ParsedChord {
  const shift = ((semitones % 12) + 12) % 12;
  const next: ParsedChord = {
    ...parsed,
    root: spellPitchClass((pitchClassOf(parsed.root) + shift) % 12, key, mode),
  };
  if (parsed.bass) next.bass = spellPitchClass((pitchClassOf(parsed.bass) + shift) % 12, key, mode);
  return next;
}

export function transposeChordSymbol(
  symbol: string,
  semitones: number,
  key: KeyName,
  mode: Mode,
): { symbol: string; ok: boolean } {
  const parsed = parseChordSymbol(symbol);
  if (!parsed) return { symbol, ok: false };
  return { symbol: formatChordSymbol(transposeParsedChord(parsed, semitones, key, mode), key, mode), ok: true };
}

export function transposeChordSymbols(
  symbols: readonly ChordSymbol[] | undefined,
  semitones: number,
  key: KeyName,
  mode: Mode,
): { symbols?: ChordSymbol[]; lost: string[] } {
  if (!symbols?.length) return { lost: [] };
  if (!semitones) return { symbols: canonicalChordSymbols(symbols), lost: [] };
  const lost: string[] = [];
  const next: ChordSymbol[] = [];
  for (const item of symbols) {
    const moved = transposeChordSymbol(item.symbol, semitones, key, mode);
    if (!moved.ok) lost.push(item.symbol);
    next.push({ at: item.at, symbol: moved.symbol });
  }
  return { symbols: canonicalChordSymbols(next), lost };
}

export function qualityFromMusicXmlKind(kind: string): ChordQuality | null {
  return KIND_FROM_XML[kind] ?? null;
}

export function chordFromMusicXml(input: {
  rootStep: string;
  rootAlter?: number;
  kind: string;
  kindText?: string;
  bassStep?: string;
  bassAlter?: number;
}): { symbol: string; unsupported: boolean } | null {
  const text = input.kindText?.trim();
  if (text) {
    const parsed = parseChordSymbol(text);
    if (parsed) return { symbol: text, unsupported: Boolean(parsed.unknown) };
    if (input.kind === "other" || input.kind === "none") return { symbol: text, unsupported: true };
  }
  const quality = qualityFromMusicXmlKind(input.kind);
  const rootHit = parsePitch(`${input.rootStep}${alterAcc(input.rootAlter)}`);
  if (!rootHit) {
    if (text) return { symbol: text, unsupported: true };
    return null;
  }
  if (!quality) {
    if (text) return { symbol: text, unsupported: true };
    return { symbol: formatPitch(rootHit.pitch), unsupported: true };
  }
  const parsed: ParsedChord = { root: rootHit.pitch, quality };
  if (input.bassStep) {
    const bassHit = parsePitch(`${input.bassStep}${alterAcc(input.bassAlter)}`);
    if (bassHit) parsed.bass = bassHit.pitch;
  }
  return { symbol: formatChordSymbol(parsed, "C", "major"), unsupported: false };
}

function alterAcc(alter: number | undefined): string {
  if (!alter) return "";
  return alter > 0 ? "#".repeat(alter) : "b".repeat(-alter);
}

const TEMPLATES: Array<{ quality: ChordQuality; pcs: number[] }> = [
  { quality: "diminished-seventh", pcs: [0, 3, 6, 9] },
  { quality: "half-diminished", pcs: [0, 3, 6, 10] },
  { quality: "major-seventh", pcs: [0, 4, 7, 11] },
  { quality: "minor-seventh", pcs: [0, 3, 7, 10] },
  { quality: "dominant", pcs: [0, 4, 7, 10] },
  { quality: "diminished", pcs: [0, 3, 6] },
  { quality: "augmented", pcs: [0, 4, 8] },
  { quality: "minor", pcs: [0, 3, 7] },
  { quality: "major", pcs: [0, 4, 7] },
  { quality: "suspended-fourth", pcs: [0, 5, 7] },
  { quality: "suspended-second", pcs: [0, 2, 7] },
  { quality: "power", pcs: [0, 7] },
];

function uniquePcs(midis: readonly number[]): number[] {
  const set = new Set<number>();
  for (const midi of midis) {
    if (!Number.isFinite(midi)) continue;
    set.add(((Math.round(midi) % 12) + 12) % 12);
  }
  return [...set].sort((a, b) => a - b);
}

/**
 * Name a simultaneous set of pitches. Exact pitch-class match only;
 * the lowest note becomes a slash bass when it is not the root.
 */
export function detectChordSymbol(midis: readonly number[], key: KeyName, mode: Mode): string | null {
  const pcs = uniquePcs(midis);
  if (pcs.length < 2) return null;
  const sounding = new Set(pcs);
  let best: { quality: ChordQuality; root: number } | null = null;
  for (const template of TEMPLATES) {
    if (template.pcs.length !== pcs.length) continue;
    for (const root of pcs) {
      const want = template.pcs.map((step) => (root + step) % 12);
      if (want.every((pc) => sounding.has(pc))) {
        best = { quality: template.quality, root };
        break;
      }
    }
    if (best) break;
  }
  if (!best) return null;
  const parsed: ParsedChord = {
    root: spellPitchClass(best.root, key, mode),
    quality: best.quality,
  };
  const lowest = Math.min(...midis.filter((midi) => Number.isFinite(midi)));
  const bassPc = ((Math.round(lowest) % 12) + 12) % 12;
  if (bassPc !== best.root) parsed.bass = spellPitchClass(bassPc, key, mode);
  return formatChordSymbol(parsed, key, mode);
}

type Timed = { start: number; dur: number; pitches: number[] };

function timeline(notes: readonly ScoreNote[]): Timed[] {
  const out: Timed[] = [];
  let at = 0;
  for (const note of notes) {
    if (!Number.isFinite(note.dur) || note.dur <= 0) continue;
    out.push({ start: at, dur: note.dur, pitches: note.pitches });
    at += note.dur;
  }
  return out;
}

function soundingAt(voices: readonly (readonly Timed[])[], at: number): number[] {
  const pitches: number[] = [];
  for (const voice of voices) {
    for (const note of voice) {
      if (at >= note.start - 1e-9 && at < note.start + note.dur - 1e-9) pitches.push(...note.pitches);
    }
  }
  return pitches;
}

/** One symbol at each onset where the detected mark changes. Rests do not write a mark. */
export function detectScoreChordSymbols(score: Pick<Score, "notes" | "voice2" | "extraVoices" | "key" | "mode">): ChordSymbol[] {
  const voices = voiceList(score).map(timeline);
  const onsets = new Set<number>();
  for (const voice of voices) for (const note of voice) if (note.pitches.length) onsets.add(note.start);
  const starts = [...onsets].sort((a, b) => a - b);
  const symbols: ChordSymbol[] = [];
  let previous = "";
  for (const at of starts) {
    const symbol = detectChordSymbol(soundingAt(voices, at), score.key, score.mode);
    if (!symbol || symbol === previous) continue;
    symbols.push({ at, symbol });
    previous = symbol;
  }
  return symbols;
}

export function canonicalChordSymbols(symbols: unknown): ChordSymbol[] | undefined {
  if (!Array.isArray(symbols)) return undefined;
  const cleaned: ChordSymbol[] = [];
  const seen = new Set<number>();
  const sorted = symbols
    .map((item) => item as Partial<ChordSymbol>)
    .filter((item) => item && Number.isFinite(item.at) && (item.at as number) >= 0 && (item.at as number) <= 1_000_000 && typeof item.symbol === "string" && item.symbol.trim())
    .map((item) => ({ at: item.at as number, symbol: item.symbol!.trim().slice(0, 40) }))
    .sort((a, b) => a.at - b.at);
  for (const item of sorted) {
    const key = Math.round(item.at * 1e6) / 1e6;
    if (seen.has(key)) {
      cleaned[cleaned.length - 1] = { at: key, symbol: item.symbol };
      continue;
    }
    seen.add(key);
    cleaned.push({ at: key, symbol: item.symbol });
  }
  return cleaned.length ? cleaned : undefined;
}

export function isChordSymbolList(value: unknown): value is ChordSymbol[] {
  return canonicalChordSymbols(value) !== undefined || (Array.isArray(value) && value.length === 0);
}

export function chordSymbolAt(symbols: readonly ChordSymbol[] | undefined, at: number): string | undefined {
  if (!symbols?.length || !Number.isFinite(at)) return undefined;
  let found: string | undefined;
  for (const item of symbols) {
    if (item.at <= at + 1e-9) found = item.symbol;
    else break;
  }
  return found;
}

function noteOnsets(notes: readonly ScoreNote[]): { starts: number[]; end: number } {
  const starts: number[] = [];
  let at = 0;
  for (const note of notes) {
    starts.push(at);
    at += Number.isFinite(note.dur) ? note.dur : 0;
  }
  return { starts, end: at };
}

/**
 * Keep lead-sheet marks attached to the same note slot after the melody is rewritten.
 * Slots are paired by {@link alignNoteSlots}: surviving notes keep their marks, a
 * rewritten stretch is paired in order. A mark whose note has no partner stays on
 * its old beat when the new melody still reaches it. Marks past the new ending,
 * or landing on a beat another mark already took, are counted in the notice.
 */
export function remapChordSymbolsForNotes(
  symbols: readonly ChordSymbol[] | undefined,
  previous: readonly ScoreNote[],
  next: readonly ScoreNote[],
): { symbols?: ChordSymbol[]; notice?: string; dropped?: string[] } {
  if (!symbols?.length) return {};
  const prev = noteOnsets(previous);
  const after = noteOnsets(next);
  const map = alignNoteSlots(previous, next);
  const moved: ChordSymbol[] = [];
  const taken = new Set<number>();
  const lost: string[] = [];
  let followed = 0;
  for (const mark of symbols) {
    // The note sounding under the mark, and how far into it the mark sits.
    let index = -1;
    prev.starts.forEach((start, i) => {
      if (start <= mark.at + 1e-6) index = i;
    });
    const offset = index >= 0 ? mark.at - prev.starts[index]! : 0;
    const target = index >= 0 ? (map[index] ?? -1) : -1;
    const targetDur = target >= 0 ? (next[target]?.dur ?? 0) : 0;
    let at: number;
    if (target >= 0 && offset < targetDur - 1e-6) at = after.starts[target]! + offset;
    else if (target >= 0 && offset < 1e-6) at = after.starts[target]!;
    else if (mark.at < after.end - 1e-6) at = mark.at;
    else {
      lost.push(mark.symbol);
      continue;
    }
    const slot = Math.round(at * 1e6);
    if (taken.has(slot)) {
      lost.push(mark.symbol);
      continue;
    }
    taken.add(slot);
    if (Math.abs(at - mark.at) > 1e-6) followed += 1;
    moved.push({ ...mark, at });
  }
  const cleaned = canonicalChordSymbols(moved);
  const parts: string[] = [];
  if (followed) parts.push(`${followed} 处和弦标记已跟到新的拍点`);
  if (lost.length) parts.push(`${lost.length} 处（${lost.slice(0, 6).join(" ")}${lost.length > 6 ? " …" : ""}）超出新旋律、放不下，没留在谱上，点「撤销」可找回`);
  return {
    symbols: cleaned,
    notice: parts.length ? `旋律改了，${parts.join("，")}。` : undefined,
    dropped: lost.length ? lost : undefined,
  };
}

export function describeChordPlace(score: Timeline & Pick<Score, "notes" | "voice2" | "extraVoices">, at: number): string {
  const bar = barOfQuarter(score, at);
  const starts = barStarts(score);
  const start = starts[bar - 1] ?? 0;
  const beat = Math.floor((at - start) / (4 / (score.beatUnit || 4)) + 1e-9) + 1;
  return `第 ${bar} 小节第 ${beat} 拍`;
}

/** Display/print helper: melody only, symbols and lyrics kept. Does not mutate the source. */
export function leadSheetScore(score: Score): Score {
  if (score.voice2 == null) return score;
  const next = { ...score };
  delete next.voice2;
  delete next.extraVoices;
  return next;
}

export function scoreHasChordSymbols(score: Pick<Score, "chordSymbols">): boolean {
  return Boolean(score.chordSymbols?.length);
}

/** Escape a token for an ABC quoted chord symbol. */
export function abcChordToken(symbol: string): string {
  return symbol.replace(/["\\]/g, "").trim();
}


registerChordSymbolShifter((symbols, semitones, key, mode) => {
  const moved = transposeChordSymbols(symbols, semitones, key, mode);
  return moved.symbols;
});
