export const KEY_NAMES = ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"] as const;

export type KeyName = (typeof KEY_NAMES)[number];
export type Mode = "major" | "minor";
export type Clef = "treble" | "bass";

export const DYNAMIC_MARKS = ["p", "mp", "mf", "f"] as const;
export type DynamicMark = (typeof DYNAMIC_MARKS)[number];

export const ARTICULATIONS = ["staccato", "accent", "tenuto"] as const;
export type Articulation = (typeof ARTICULATIONS)[number];

/**
 * `grace` is a slashed acciaccatura. `appoggiatura` is an unslashed grace.
 * `trill` is a trill mark. `arpeggio` rolls a chord upward (chords only).
 */
export const ORNAMENTS = ["trill", "grace", "appoggiatura", "arpeggio"] as const;
export type Ornament = (typeof ORNAMENTS)[number];

export const HAIRPINS = ["cresc", "dim"] as const;
export type Hairpin = (typeof HAIRPINS)[number];

export const LYRIC_SYLLABICS = ["single", "begin", "middle", "end"] as const;
export type LyricSyllabic = (typeof LYRIC_SYLLABICS)[number];

/** MusicXML `<extend type>`. Absent means a bare `<extend/>`. */
export const LYRIC_EXTEND_TYPES = ["start", "continue", "stop"] as const;
export type LyricExtendType = (typeof LYRIC_EXTEND_TYPES)[number];

/**
 * Extender on one tied fragment after the opening of a joined note.
 * `at` is quarters from the note start. Absent `extendType` is a bare `<extend/>`.
 */
export type LyricFragment = {
  at: number;
  dur: number;
  extendType?: LyricExtendType;
};

/**
 * One syllable for this note event.
 * A chord has one lyric, not one per pitch. Rests do not carry lyrics.
 * Empty `text` is an explicit blank. Empty `text` with `extend` holds the previous syllable.
 * `extendType` is the typed mark on the opening fragment. A stop still occupies that note.
 * `extend` without `extendType` is a bare `<extend/>` on the opening fragment.
 * A later typed fragment does not change that opening into start.
 * `fragments` lists every later tied fragment's extender, in time order.
 * An empty list means there are no continuations. The old `extendEnd` slot is
 * read only when `fragments` is absent, and only as a tail fragment. It does
 * not add an opening extender.
 * `extendEnd`, `extendEndBare`, `extendEndAt`, and `extendEndDur` mirror `fragments`
 * when there is exactly one. Older scores that only stored that slot still load.
 */
export type NoteLyric = {
  text: string;
  syllabic: LyricSyllabic;
  extend?: boolean;
  extendType?: LyricExtendType;
  fragments?: LyricFragment[];
  extendEnd?: LyricExtendType;
  /** Untyped extender when `fragments` has the single bare continuation. */
  extendEndBare?: boolean;
  extendEndAt?: number;
  extendEndDur?: number;
};

export type ScoreNote = {
  /** Empty array is a rest. */
  pitches: number[];
  /** Length in quarter notes. */
  dur: number;
  /** Verse 1 only. Absent means this note has no lyric slot filled in. */
  lyric?: NoteLyric;
  /** Loudness from this note until the next dynamic. */
  dynamic?: DynamicMark;
  /** Opens a hairpin that closes on a later `hairpinEnd`. */
  hairpin?: Hairpin;
  hairpinEnd?: boolean;
  articulations?: Articulation[];
  ornament?: Ornament;
  /** Sounding pitch of a grace note. Absent means the upper neighbor. */
  gracePitch?: number;
  slurStart?: boolean;
  slurEnd?: boolean;
  /** Piano fingering 1=thumb … 5=pinky, same order as pitches. Absent means none. */
  fingers?: number[];
};

/** Absolute quarter-note position; paired meter/key fields are atomic. */
export type ScoreChange = { at: number; bpm?: number; beats?: number; beatUnit?: number; key?: KeyName; mode?: Mode };

export type ChordSymbol = { at: number; symbol: string };

/** Section / rehearsal label, in quarter notes at a bar start. */
export type RehearsalMark = { at: number; label: string };

/**
 * One repeat, in quarter notes on bar lines: `|:` at `from`, `:|` at `to`.
 * `ending` (optional) starts the 1st ending (played on the first pass only, ends at `to`);
 * `endingEnd` (needs `ending`) closes the 2nd-ending bracket that starts at `to`.
 * Not nested, not overlapping; sorted by `from`.
 */
export type ScoreRepeat = { from: number; to: number; ending?: number; endingEnd?: number };

/**
 * Jump marks, in quarter notes on bar lines. `segno` / `coda` sit at a bar start;
 * `fine`, `toCoda`, `dc` (D.C.) and `ds` (D.S.) at a bar end. One jump (D.C. or D.S.)
 * per score; it ends at Fine (al Fine), takes To Coda → Coda (al Coda), or runs to the end.
 */
export type ScoreJumps = { segno?: number; coda?: number; fine?: number; toCoda?: number; dc?: number; ds?: number };

export type Score = {
  /** Instrument identity for staff labels, independent of playback timbre. */
  staffInstrument?: "piano";
  /** Source measure ends in quarter notes, including incomplete and cadenza measures. */
  measureEnds?: number[];
  changes?: ScoreChange[];
  /**
   * Optional lead-sheet marks, in quarter notes from the start.
   * Absent means the score has no symbols (old drafts stay unchanged).
   */
  chordSymbols?: ChordSymbol[];
  /** Optional repeat signs and 1st/2nd endings. Absent: played straight through. */
  repeats?: ScoreRepeat[];
  /** Optional D.C. / D.S. / Fine / Coda marks. Absent: no jumps. */
  jumps?: ScoreJumps;
  /**
   * Optional section labels (前奏 / 主歌 / 副歌 / A …), in quarter notes at a bar start.
   * Absent means the score has no labels (old drafts stay unchanged).
   */
  rehearsals?: RehearsalMark[];
  /**
   * Optional fermatas, in quarter-note onsets per voice.
   * Absent means the score has none (old drafts stay unchanged).
   */
  fermatas?: { voice: number; at: number }[];
  title: string;
  /** Optional lyricist, shown as 词：… on the jianpu header. Absent on old drafts. */
  lyricist?: string;
  /** Optional composer, shown as 曲：… on the jianpu header. Absent on old drafts. */
  composer?: string;
  /**
   * Opening tempo was written on the source. Absent means it was (old drafts
   * keep showing ♩=). `false` means `bpm` is only a playback number: do not
   * engrave or export it as a tempo mark.
   */
  tempoMarked?: boolean;
  bpm: number;
  beats: number;
  beatUnit: number;
  key: KeyName;
  mode: Mode;
  clef: Clef;
  /** Scientific octave of scale degree 1 with no octave mark. */
  tonicOctave: number;
  /**
   * Voice 1. Old saved scores are this list alone.
   * Durations are this voice's own timeline, not a shared grid with voice 2.
   */
  notes: ScoreNote[];
  /**
   * Voice 2, with its own durations. Absent means there is no second voice.
   * An empty array means the voice was added and has no notes yet.
   * Do not invent trailing rests here to match voice 1; playback and engraving pad silence.
   */
  voice2?: ScoreNote[];
  /** Independent voices 3 onward; old single/two voice drafts remain compatible. */
  extraVoices?: ScoreNote[][];
};

export const INSTRUMENTS = [
  { id: "concert", label: "原调", shift: 0, hint: "实际音高" },
  { id: "bb", label: "降B单簧管", shift: 2, hint: "高一个大二度" },
  { id: "trumpet", label: "小号", shift: 2, hint: "降B调，高一个大二度" },
  { id: "eb", label: "中音萨克斯", shift: 9, hint: "降E调，高一个大六度" },
  { id: "f", label: "圆号", shift: 7, hint: "F调，高一个纯五度" },
  { id: "a", label: "A调单簧管", shift: 3, hint: "高一个小三度" },
] as const;

export type InstrumentId = (typeof INSTRUMENTS)[number]["id"];

export function instrumentOf(id: InstrumentId) {
  return INSTRUMENTS.find((item) => item.id === id) ?? INSTRUMENTS[0];
}

export const PC: Record<KeyName, number> = {
  C: 0,
  Db: 1,
  D: 2,
  Eb: 3,
  E: 4,
  F: 5,
  "F#": 6,
  G: 7,
  Ab: 8,
  A: 9,
  Bb: 10,
  B: 11,
};

const PREFERRED: KeyName[] = ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];

const LETTERS = ["C", "D", "E", "F", "G", "A", "B"] as const;
const LETTER_PC: Record<string, number> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
};

export const MAJOR_STEPS = [0, 2, 4, 5, 7, 9, 11];
export const MINOR_STEPS = [0, 2, 3, 5, 7, 8, 10];

const KEY_LABEL: Record<KeyName, string> = {
  C: "C",
  Db: "降D",
  D: "D",
  Eb: "降E",
  E: "E",
  F: "F",
  "F#": "升F",
  G: "G",
  Ab: "降A",
  A: "A",
  Bb: "降B",
  B: "B",
};

export function isKeyName(value: string): value is KeyName {
  return (KEY_NAMES as readonly string[]).includes(value);
}

export function keyLabel(key: KeyName): string {
  return KEY_LABEL[key];
}

export function modeName(mode: Mode): string {
  return mode === "major" ? "大调" : "小调";
}

export function keyTitle(key: KeyName, mode: Mode): string {
  return `${keyLabel(key)} ${modeName(mode)}`;
}

export function stepsFor(mode: Mode): number[] {
  return mode === "major" ? MAJOR_STEPS : MINOR_STEPS;
}

export function tonicMidi(key: KeyName, octave: number): number {
  return (octave + 1) * 12 + PC[key];
}

export function transposeKey(key: KeyName, semitones: number): KeyName {
  const pc = (PC[key] + semitones) % 12;
  return PREFERRED[(pc + 12) % 12];
}

/** Lowest and highest MIDI note the keyboard and transpose buttons will write. */
export const PLAYABLE_LOW = 21;
export const PLAYABLE_HIGH = 108;

/** One sounding event holds at most this many pitches. MusicXML import uses the same cap. */
export const CHORD_TONE_LIMIT = 8;

export type ChordPitchFailure = "rest" | "duplicate" | "full" | "range";

export type ChordPitchResult =
  { ok: true; note: ScoreNote } | { ok: false; reason: ChordPitchFailure };

/**
 * Add one pitch to a note that already sounds.
 * Duration and expression marks stay on the whole chord. Pitches are stored low to high.
 * A rest, a duplicate, a ninth tone, or a pitch outside the piano is refused.
 */
export function addChordPitch(note: ScoreNote, midi: number): ChordPitchResult {
  if (!note.pitches.length) return { ok: false, reason: "rest" };
  if (!Number.isFinite(midi)) return { ok: false, reason: "range" };
  const pitch = Math.round(midi);
  if (pitch < PLAYABLE_LOW || pitch > PLAYABLE_HIGH) return { ok: false, reason: "range" };
  if (note.pitches.includes(pitch)) return { ok: false, reason: "duplicate" };
  if (note.pitches.length >= CHORD_TONE_LIMIT) return { ok: false, reason: "full" };
  const next: ScoreNote = {
    ...note,
    pitches: [...note.pitches, pitch].sort((a, b) => a - b),
  };
  if (note.articulations) next.articulations = note.articulations.slice();
  return { ok: true, note: next };
}

/** Replace `notes[index]` with that note plus `midi`. Other notes are copied unchanged. */
export function stackChordAt(
  notes: ScoreNote[],
  index: number,
  midi: number,
): { ok: true; notes: ScoreNote[] } | { ok: false; reason: ChordPitchFailure | "index" } {
  const note = notes[index];
  if (!note) return { ok: false, reason: "index" };
  const added = addChordPitch(note, midi);
  if (!added.ok) return added;
  const next = notes.slice();
  next[index] = added.note;
  return { ok: true, notes: next };
}

function movablePitches(note: ScoreNote): number[] {
  if (typeof note.gracePitch !== "number" || !Number.isFinite(note.gracePitch)) return note.pitches;
  return [...note.pitches, note.gracePitch];
}

/** True when shifting every sounding pitch stays inside the piano range. */
export function canTranspose(notes: ScoreNote[], semitones: number): boolean {
  if (!Number.isFinite(semitones) || semitones === 0) return true;
  return notes.every((note) =>
    movablePitches(note).every((pitch) => {
      const next = pitch + semitones;
      return next >= PLAYABLE_LOW && next <= PLAYABLE_HIGH;
    }),
  );
}

/**
 * Signed semitone step from one tonic to another, in -6..+6.
 * The tritone is signed by pitch-class order so the return trip cancels.
 */
export function shortestShift(from: KeyName, to: KeyName): number {
  const delta = (PC[to] - PC[from] + 12) % 12;
  if (delta === 0) return 0;
  if (delta === 6) return PC[to] > PC[from] ? 6 : -6;
  return delta > 6 ? delta - 12 : delta;
}

function mod12(value: number): number {
  return ((value % 12) + 12) % 12;
}

/**
 * Pitch of `key` nearest to `registerMidi`.
 * A tritone tie follows `shortestShift`, so the way back lands on the same note.
 */
export function nearestTonic(registerMidi: number, key: KeyName): number {
  const registerPc = mod12(registerMidi);
  const base = registerMidi - registerPc + PC[key];
  const homeKey = KEY_NAMES[registerPc];
  const preferred = registerMidi + shortestShift(homeKey, key);
  let best = base - 12;
  let bestDist = Math.abs(best - registerMidi);
  for (const candidate of [base, base + 12]) {
    const dist = Math.abs(candidate - registerMidi);
    if (dist < bestDist || (dist === bestDist && candidate === preferred)) {
      best = candidate;
      bestDist = dist;
    }
  }
  return best;
}

/**
 * Semitone change for a key-pad hop.
 * The target tonic is the nearest spelling of `to` around `registerMidi`,
 * not around the current tonic, so a cycle of hops cannot climb an octave.
 * Returns null when the hop would leave the playable range; the caller should no-op.
 */
export function keyPadShift(
  score: Pick<Score, "key" | "tonicOctave" | "notes" | "voice2" | "extraVoices">,
  registerMidi: number,
  to: KeyName,
): number | null {
  const current = tonicMidi(score.key, score.tonicOctave);
  const shift = nearestTonic(registerMidi, to) - current;
  const notes = [score.notes, score.voice2 ?? [], ...(score.extraVoices ?? [])].flat();
  if (shift !== 0 && !canTranspose(notes, shift)) return null;
  return shift;
}

function shiftWrittenNote(note: ScoreNote, semitones: number): ScoreNote {
  const next: ScoreNote = {
    ...note,
    pitches: note.pitches.map((pitch) => pitch + semitones),
  };
  if (typeof note.gracePitch === "number" && Number.isFinite(note.gracePitch)) {
    next.gracePitch = note.gracePitch + semitones;
  }
  return next;
}

/** Moves both voices by the same interval. The key and tonic move with them. */
export function transposeScore(score: Score, semitones: number): Score {
  if (semitones === 0) return score;
  const key = transposeKey(score.key, semitones);
  const shiftedTonic = tonicMidi(score.key, score.tonicOctave) + semitones;
  const next: Score = {
    ...score,
    key,
    changes: score.changes?.map(c => c.key ? { ...c, key: transposeKey(c.key, semitones) } : { ...c }),
    tonicOctave: Math.floor(shiftedTonic / 12) - 1,
    notes: score.notes.map((note) => shiftWrittenNote(note, semitones)),
  };
  if (score.voice2) next.voice2 = score.voice2.map((note) => shiftWrittenNote(note, semitones));
  if (score.extraVoices) next.extraVoices = score.extraVoices.map(v => v.map(note => shiftWrittenNote(note, semitones)));
  if (score.chordSymbols?.length) {
    const moved = shiftChordSymbols(score.chordSymbols, semitones, key, score.mode);
    if (moved) next.chordSymbols = moved;
    else delete next.chordSymbols;
  }
  return next;
}

export function intervalName(semitones: number): string {
  const names = [
    "同度",
    "小二度",
    "大二度",
    "小三度",
    "大三度",
    "纯四度",
    "减五度",
    "纯五度",
    "小六度",
    "大六度",
    "小七度",
    "大七度",
  ];
  if (semitones === 0) return "同度";
  const abs = Math.abs(semitones);
  const octaves = Math.floor(abs / 12);
  const step = names[abs % 12];
  const body = octaves ? `${octaves}个八度${step === "同度" ? "" : `又${step}`}` : step;
  return `${semitones > 0 ? "高" : "低"}${body}`;
}

export type Spelling = {
  letter: string;
  /** -2..2, absolute, not relative to the key signature. */
  acc: number;
  octave: number;
};

export function scaleAccidentals(key: KeyName, mode: Mode): Record<string, number> {
  const map: Record<string, number> = { C: 0, D: 0, E: 0, F: 0, G: 0, A: 0, B: 0 };
  const tonic = PC[key];
  const start = LETTERS.indexOf(key[0] as (typeof LETTERS)[number]);
  const steps = stepsFor(mode);
  for (let i = 0; i < 7; i += 1) {
    const letter = LETTERS[(start + i) % 7];
    const want = (tonic + steps[i]) % 12;
    let acc = (want - LETTER_PC[letter] + 12) % 12;
    if (acc > 6) acc -= 12;
    map[letter] = acc;
  }
  return map;
}

export function prefersSharps(key: KeyName, mode: Mode): boolean {
  const acc = scaleAccidentals(key, mode);
  const sum = Object.values(acc).reduce((total, value) => total + value, 0);
  return sum >= 0;
}

const SHARP_SPELL: Array<Pick<Spelling, "letter" | "acc">> = [
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

const FLAT_SPELL: Array<Pick<Spelling, "letter" | "acc">> = [
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

export function spellMidi(midi: number, key: KeyName, mode: Mode): Spelling {
  const pc = ((midi % 12) + 12) % 12;
  const octave = Math.floor(midi / 12) - 1;
  const scale = scaleAccidentals(key, mode);
  const steps = stepsFor(mode);
  const tonic = PC[key];
  const start = LETTERS.indexOf(key[0] as (typeof LETTERS)[number]);
  for (let i = 0; i < 7; i += 1) {
    if ((tonic + steps[i]) % 12 === pc) {
      const letter = LETTERS[(start + i) % 7];
      return { letter, acc: scale[letter] ?? 0, octave };
    }
  }
  const table = prefersSharps(key, mode) ? SHARP_SPELL : FLAT_SPELL;
  return { letter: table[pc].letter, acc: table[pc].acc, octave };
}

function octMark(shift: number): string {
  if (shift > 0) return "'".repeat(shift);
  if (shift < 0) return ",".repeat(-shift);
  return "";
}

/** Numbered-notation token for one pitch, relative to degree 1. */
export function degreeToken(midi: number, key: KeyName, mode: Mode, tonicOctave: number): string {
  const rel = midi - tonicMidi(key, tonicOctave);
  const octShift = Math.floor(rel / 12);
  const within = rel - octShift * 12;
  const steps = stepsFor(mode);
  const diatonic = steps.indexOf(within);
  if (diatonic >= 0) return String(diatonic + 1) + octMark(octShift);

  const lower = steps.indexOf(within - 1);
  const upper = steps.indexOf(within + 1);
  if (upper === 6) return `b7${octMark(octShift)}`;
  if (prefersSharps(key, mode) && lower >= 0) return `#${lower + 1}${octMark(octShift)}`;
  if (!prefersSharps(key, mode) && upper >= 0) return `b${upper + 1}${octMark(octShift)}`;
  if (lower >= 0) return `#${lower + 1}${octMark(octShift)}`;
  if (upper >= 0) return `b${upper + 1}${octMark(octShift)}`;
  return `?${octMark(octShift)}`;
}

export function degreeMidi(
  degree: number,
  acc: number,
  octShift: number,
  key: KeyName,
  mode: Mode,
  tonicOctave: number,
): number {
  const raw = PC[key] + stepsFor(mode)[degree - 1] + acc;
  const octave = tonicOctave + octShift + Math.floor(raw / 12);
  const pc = ((raw % 12) + 12) % 12;
  return (octave + 1) * 12 + pc;
}

export function inferTonicOctave(midis: number[], key: KeyName): number {
  if (!midis.length) return 4;
  const sorted = [...midis].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  let octave = Math.floor(median / 12) - 1;
  let tonic = tonicMidi(key, octave);
  while (tonic > median) {
    octave -= 1;
    tonic -= 12;
  }
  while (median - tonic >= 12) {
    octave += 1;
    tonic += 12;
  }
  return Math.max(1, Math.min(6, octave));
}

export function beatUnitCount(beatUnit: number): number {
  return Math.round((4 / beatUnit) * 12);
}

export function barUnitCount(beats: number, beatUnit: number): number {
  return beats * beatUnitCount(beatUnit);
}

const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

export function guessKey(notes: ScoreNote[]): { key: KeyName; mode: Mode } {
  const hist = new Array<number>(12).fill(0);
  for (const note of notes) {
    for (const pitch of note.pitches) hist[((pitch % 12) + 12) % 12] += note.dur;
  }
  let bestKey: KeyName = "C";
  let bestMode: Mode = "major";
  let best = -Infinity;
  for (const key of KEY_NAMES) {
    for (const mode of ["major", "minor"] as const) {
      const profile = mode === "major" ? MAJOR_PROFILE : MINOR_PROFILE;
      let score = 0;
      for (let i = 0; i < 12; i += 1) score += hist[(PC[key] + i) % 12] * profile[i];
      if (score > best) {
        best = score;
        bestKey = key;
        bestMode = mode;
      }
    }
  }
  return { key: bestKey, mode: bestMode };
}

type ChordSymbolShifter = (
  symbols: ChordSymbol[],
  semitones: number,
  key: KeyName,
  mode: Mode,
) => ChordSymbol[] | undefined;

let chordSymbolShifter: ChordSymbolShifter | undefined;

/** Filled in by chord-symbol.ts so transposeScore does not import that module. */
export function registerChordSymbolShifter(fn: ChordSymbolShifter) {
  chordSymbolShifter = fn;
}

function shiftChordSymbols(
  symbols: ChordSymbol[],
  semitones: number,
  key: KeyName,
  mode: Mode,
): ChordSymbol[] | undefined {
  if (chordSymbolShifter) return chordSymbolShifter(symbols, semitones, key, mode);
  return symbols.map((item) => ({ ...item }));
}
