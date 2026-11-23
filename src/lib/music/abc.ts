/**
 * ABC notation (abcnotation.com 2.1 subset): read the first tune's first voice into a Score,
 * and write a Score back as plain, hand-editable ABC (L:1/8, four bars a line, w: lyrics).
 * Idea absorbed from ABC transcription tools / EasyABC (text in, sheet out, text back out);
 * no upstream code. Supported subset and loss list: docs/abc.md.
 */
import { CHANGE_BEAT_UNITS, CHANGE_BEATS_MAX, CHANGE_BPM_MAX, CHANGE_BPM_MIN } from "./score-timeline.ts";
import { inferTonicOctave, KEY_NAMES, type Articulation, type ChordSymbol, type DynamicMark, type KeyName, type Mode, type Score, type ScoreChange, type ScoreJumps, type ScoreNote, type ScoreRepeat } from "./theory.ts";
import { canonicalChordSymbols, parseChordSymbol } from "./chord-symbol.ts";
import { barStarts } from "./practice.ts";
import { jumpProblem, repeatProblem } from "./repeats.ts";
import type { LyricItem, LyricSlot } from "./text-score-util.ts";
import type { TextImport } from "./j123-import.ts";

const EPS = 1e-6;
function cleanRehearsalLabel(raw: string): string | null {
  const text = raw.replace(/\s+/g, " ").trim().slice(0, 12);
  return text || null;
}
function isPlayOrder(value: string): boolean {
  const t = value.trim();
  if (!t) return false;
  if (/,/.test(t) && t.split(/\s*,\s*/).every((p) => /^[A-Ha-h]$/.test(p))) return true;
  return /^[A-Ha-h]{3,}$/.test(t);
}
function canonicalRehearsals(marks: { at: number; label: string }[]): { at: number; label: string }[] | undefined {
  const cleaned: { at: number; label: string }[] = [];
  const seen = new Set<number>();
  for (const item of [...marks].sort((a, b) => a.at - b.at)) {
    const label = cleanRehearsalLabel(item.label);
    if (!label) continue;
    const key = Math.round(item.at * 1e6) / 1e6;
    if (seen.has(key)) { cleaned[cleaned.length - 1] = { at: key, label }; continue; }
    seen.add(key);
    cleaned.push({ at: key, label });
  }
  return cleaned.length ? cleaned : undefined;
}
const LETTERS = "CDEFGAB";
const LETTER_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
/** Circle-of-fifths position of each natural letter as a major tonic. */
const LETTER_FIFTHS: Record<string, number> = { C: 0, D: 2, E: 4, F: -1, G: 1, A: 3, B: 5 };
const SHARP_ORDER = "FCGDAEB";
const FLAT_ORDER = "BEADGCF";
/** Mode → fifths offset from its tonic's major key, and semitones above that major tonic. */
const MODES: { re: RegExp; name: string; fifths: number; semis: number }[] = [
  { re: /^(maj(or)?|ion(ian)?)$/i, name: "大调", fifths: 0, semis: 0 },
  { re: /^(m|min(or)?|aeo(lian)?)$/i, name: "小调", fifths: -3, semis: 9 },
  { re: /^dor(ian)?$/i, name: "多利亚", fifths: -2, semis: 2 },
  { re: /^phr(ygian)?$/i, name: "弗里几亚", fifths: -4, semis: 4 },
  { re: /^lyd(ian)?$/i, name: "利底亚", fifths: 1, semis: 5 },
  { re: /^mix(olydian)?$/i, name: "混合利底亚", fifths: -1, semis: 7 },
  { re: /^loc(rian)?$/i, name: "洛克里亚", fifths: -5, semis: 11 },
];

/**
 * w: syllables onto sounding notes from `from`. Kept here (not shared with 123 / 番茄) so the
 * ABC chunk stays self-contained and the editor does not grow a shared split chunk.
 */
function alignAbcLyrics(slots: LyricSlot[], from: number, items: LyricItem[]) {
  let i = from;
  const out = { overflow: 0, onRest: 0 };
  for (const item of items) {
    if (item.kind === "bar") {
      const bar = slots[i - 1]?.bar;
      if (bar !== undefined && i > from) while (i < slots.length && slots[i].bar === bar) i++;
      continue;
    }
    const slot = slots[i++];
    if (!slot) {
      if (item.kind === "text") out.overflow++;
      continue;
    }
    if (item.kind === "skip" || slot.note.lyric) continue;
    slot.note.lyric = item.kind === "hold" ? { text: "", syllabic: "single", extend: true } : { text: item.text, syllabic: item.syllabic ?? "single" };
  }
  return out;
}

type Sig = Record<string, number>;
function signature(fifths: number): Sig {
  const sig: Sig = { C: 0, D: 0, E: 0, F: 0, G: 0, A: 0, B: 0 };
  for (let i = 0; i < Math.min(7, Math.abs(fifths)); i++) sig[fifths > 0 ? SHARP_ORDER[i] : FLAT_ORDER[i]] = fifths > 0 ? 1 : -1;
  return sig;
}

/** Major-key fifths of a KeyName (C# never appears; Db = −5, F# = +6). */

function cleanCredit(raw: string): string | undefined {
  const text = raw.replace(/\s+/g, " ").trim().slice(0, 40);
  return text || undefined;
}
function parseCreditLine(raw: string): { lyricist?: string; composer?: string } {
  const text = raw.replace(/\s+/g, " ").trim();
  if (!text) return {};
  const take = (re: RegExp) => {
    const match = re.exec(text);
    return match ? cleanCredit(match[1] ?? "") : undefined;
  };
  const lyricist = take(/(?:作)?词(?:作者)?[：:]\s*(.+?)(?=\s*(?:作)?曲(?:作者)?[：:]|$)/);
  const composerLabeled = take(/(?:作)?曲(?:作者)?[：:]\s*(.+?)(?=\s*(?:作)?词(?:作者)?[：:]|$)/);
  if (lyricist || composerLabeled) return { ...(lyricist ? { lyricist } : {}), ...(composerLabeled ? { composer: composerLabeled } : {}) };
  const bare = cleanCredit(text);
  return bare ? { composer: bare } : {};
}
function keyFifths(key: KeyName): number {
  return LETTER_FIFTHS[key[0]] + (key[1] === "b" ? -7 : key[1] === "#" ? 7 : 0);
}

type AbcKey = { key: KeyName; mode: Mode; fifths: number; clef?: "treble" | "bass"; loss?: string };

export function parseAbcKey(value: string): AbcKey | null {
  let v = value.replace(/%.*$/, "").trim();
  let clef: AbcKey["clef"];
  const clefMatch = /\bclef\s*=\s*(\w+)/i.exec(v) ?? /\b(bass|treble)\b/i.exec(v);
  if (clefMatch) {
    clef = /bass/i.test(clefMatch[1]) ? "bass" : "treble";
    v = v.replace(clefMatch[0], " ").trim();
  }
  v = v.replace(/\b(\w+)\s*=\s*\S+/g, " ").trim();
  if (!v || /^none$/i.test(v)) return { key: "C", mode: "major", fifths: 0, clef, loss: v ? "K:none 按 C 大调读入" : undefined };
  const m = /^([A-G])([#b]?)\s*([A-Za-z]*)\s*(.*)$/.exec(v);
  if (!m) return null;
  const modeWord = m[3];
  const mode = modeWord ? MODES.find((x) => x.re.test(modeWord)) : MODES[0];
  if (!mode) return null;
  const tonicFifths = LETTER_FIFTHS[m[1]] + (m[2] === "#" ? 7 : m[2] === "b" ? -7 : 0);
  const fifths = tonicFifths + mode.fifths;
  if (Math.abs(fifths) > 7) return null;
  const tonicPc = (LETTER_PC[m[1]] + (m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0) + 12) % 12;
  const extra = m[4].trim() ? "K: 里额外写的升降号" : undefined;
  if (mode.semis === 0 || mode.semis === 9) {
    return { key: KEY_NAMES[tonicPc] as KeyName, mode: mode.semis ? "minor" : "major", fifths, clef, loss: extra };
  }
  const majorPc = (tonicPc - mode.semis + 12) % 12;
  return { key: KEY_NAMES[majorPc] as KeyName, mode: "major", fifths, clef, loss: extra ?? `${mode.name}调式，按同调号的大调读入` };
}

function parseMeter(value: string): { beats: number; beatUnit: number } | null {
  const v = value.trim();
  if (v === "C") return { beats: 4, beatUnit: 4 };
  if (v === "C|") return { beats: 2, beatUnit: 2 };
  const m = /^(\d+)\s*\/\s*(\d+)$/.exec(v);
  if (!m) return null;
  return { beats: Number(m[1]), beatUnit: Number(m[2]) };
}

function parseFraction(value: string): number | null {
  const m = /^(\d+)\s*\/\s*(\d+)$/.exec(value.trim());
  if (!m || !Number(m[2])) return null;
  return Number(m[1]) / Number(m[2]);
}

/** Q: in quarter-note bpm, or null when unreadable. */
function parseTempo(value: string): number | null {
  const v = value.replace(/"[^"]*"/g, " ").trim();
  let m = /(\d+)\s*\/\s*(\d+)(?:\s+\d+\s*\/\s*\d+)*\s*=\s*(\d+(?:\.\d+)?)/.exec(v);
  if (m) return Number(m[3]) * (Number(m[1]) / Number(m[2])) * 4;
  m = /^(\d+(?:\.\d+)?)$/.exec(v);
  return m ? Number(m[1]) : null;
}

const DYNAMICS = new Set<string>(["p", "mp", "mf", "f"]);
const OTHER_DYNAMICS: Record<string, DynamicMark> = { pp: "p", ppp: "p", pppp: "p", ff: "f", fff: "f", ffff: "f", sfz: "f", fp: "f" };

type Pending = {
  dynamic?: DynamicMark;
  articulations: Articulation[];
  ornament?: ScoreNote["ornament"];
  gracePitch?: number;
  hairpin?: "cresc" | "dim";
  hairpinEnd?: boolean;
  slurStart?: boolean;
  jumps: (keyof ScoreJumps)[];
  chord?: string;
};

type BarEvent = { at: number; kind: "start" | "end" | "thin" | "thick"; ending?: number };

export function importAbc(input: string | Uint8Array): TextImport {
  const text = (typeof input === "string" ? input : new TextDecoder("utf-8").decode(input)).replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const losses: string[] = [];
  const notes: string[] = ["ABC 会替换整谱，只读第一首的第一个声部"];
  const lose = (s: string) => void (losses.includes(s) || losses.push(s));
  const note = (s: string) => void (notes.includes(s) || notes.push(s));

  const rawLines = text.split("\n");
  // First tune only: from the first X: (or the start) to the next X:.
  let startLine = rawLines.findIndex((l) => /^X:/.test(l));
  if (startLine < 0) startLine = 0;
  let endLine = rawLines.findIndex((l, i) => i > startLine && /^X:/.test(l));
  if (endLine >= 0) lose("文件里第一首之后的曲子");
  else endLine = rawLines.length;
  const lines = rawLines.slice(startLine, endLine);

  let title = "";
  let lyricist: string | undefined;
  let composerName: string | undefined;
  let meter: { beats: number; beatUnit: number } | null = null;
  let unit: number | null = null;
  let tempo: number | null = null;
  let key: AbcKey | null = null;
  let headerDone = false;

  // Body state
  let t = 0;
  let curMeter = { beats: 4, beatUnit: 4 };
  let curSig: Sig = signature(0);
  let barAcc: Record<string, number> = {};
  const out: ScoreNote[] = [];
  const ties = new Set<ScoreNote>();
  const noteAt = new Map<ScoreNote, number>();
  const chordMarks: ChordSymbol[] = [];
  const rehearsalMarks: { at: number; label: string }[] = [];
  const changes: ScoreChange[] = [];
  const barEvents: BarEvent[] = [];
  const jumpAt: { kind: keyof ScoreJumps; note: ScoreNote }[] = [];
  let firstBarAt: number | undefined;
  let pending: Pending = { articulations: [], jumps: [] };
  let tieOpen: ScoreNote | null = null;
  let lastNote: ScoreNote | null = null;
  let broken = 1;
  let tuplet: { left: number; factor: number } | null = null;
  let voiceId: string | null = null;
  let inOtherVoice = false;
  const allSlots: LyricSlot[] = [];
  let barIndex = 0;
  let lyricLines = 0;
  let lyricFrom = 0;
  let inOverlay = false;

  const applyField = (field: string, value: string, inline: boolean) => {
    if (field === "K") {
      const k = parseAbcKey(value);
      if (!k) {
        lose(`读不懂的调号 K:${value.trim()}`);
        return;
      }
      if (k.loss) lose(k.loss);
      if (inline || headerDone) {
        if (key && (k.key !== key.key || k.mode !== key.mode || headerDone)) changes.push({ at: t, key: k.key, mode: k.mode });
      } else key = k;
      curSig = signature(k.fifths);
      barAcc = {};
    } else if (field === "M") {
      const m = parseMeter(value);
      if (!m) {
        if (value.trim() && !/^none$/i.test(value.trim())) lose(`读不懂的拍号 M:${value.trim()}`);
        return;
      }
      if (headerDone) changes.push({ at: t, beats: m.beats, beatUnit: m.beatUnit });
      else meter = m;
      curMeter = m;
    } else if (field === "L") {
      const f = parseFraction(value);
      if (f) unit = f;
      else lose(`读不懂的单位时值 L:${value.trim()}`);
    } else if (field === "Q") {
      const q = parseTempo(value);
      if (q === null) {
        lose(`读不懂的速度 Q:${value.trim()}`);
        return;
      }
      if (headerDone) changes.push({ at: t, bpm: Math.round(q) });
      else tempo = q;
    } else if (field === "V") {
      const id = value.trim().split(/\s+/)[0] ?? "";
      if (voiceId === null) voiceId = id;
      inOtherVoice = id !== voiceId;
      if (inOtherVoice) lose("第二个及以后的声部（V:）");
    } else if (field === "P") {
      const label = cleanRehearsalLabel(value);
      if (label && !isPlayOrder(value)) rehearsalMarks.push({ at: t, label });
      else lose("演唱顺序（P:）");
    }
  };

  const unitQ = () => (unit ?? (meter && meter.beats / meter.beatUnit < 0.75 ? 1 / 16 : 1 / 8)) * 4;

  const readLength = (s: string, i: number): [number, number] => {
    const m = /^(\d*)((?:\/\d*)*)/.exec(s.slice(i))!;
    let num = m[1] ? Number(m[1]) : 1;
    let den = 1;
    const slashes = m[2].match(/\/\d*/g) ?? [];
    for (const sl of slashes) den *= sl.length > 1 ? Number(sl.slice(1)) || 2 : 2;
    if (!num) num = 1;
    return [num / den, i + m[0].length];
  };

  const readPitch = (s: string, i: number): [number, number] | null => {
    let j = i;
    let acc: number | null = null;
    const am = /^(\^\^|\^|__|_|=)/.exec(s.slice(j));
    if (am) {
      acc = am[1] === "^^" ? 2 : am[1] === "^" ? 1 : am[1] === "__" ? -2 : am[1] === "_" ? -1 : 0;
      j += am[1].length;
    }
    const ch = s[j];
    if (!ch || !/[A-Ga-g]/.test(ch)) return null;
    const letter = ch.toUpperCase();
    let octave = ch === letter ? 4 : 5;
    j++;
    while (s[j] === "'" || s[j] === ",") octave += s[j++] === "'" ? 1 : -1;
    const slot = `${letter}${octave}`;
    if (acc !== null) barAcc[slot] = acc;
    const a = barAcc[slot] ?? curSig[letter];
    return [(octave + 1) * 12 + LETTER_PC[letter] + a, j];
  };

  const finishPending = (n: ScoreNote, pitched: boolean) => {
    if (pending.chord !== undefined) {
      if (parseChordSymbol(pending.chord)) chordMarks.push({ at: t, symbol: pending.chord });
      else lose(`读不懂的和弦名 "${pending.chord}"`);
    }
    if (pitched) {
      if (pending.dynamic) n.dynamic = pending.dynamic;
      if (pending.articulations.length) n.articulations = [...new Set(pending.articulations)];
      if (pending.ornament) n.ornament = pending.ornament === "arpeggio" && n.pitches.length < 2 ? undefined : pending.ornament;
      if (pending.ornament === "arpeggio" && n.pitches.length < 2) lose("单音上的琶音");
      if (pending.gracePitch !== undefined && (pending.ornament === "grace" || pending.ornament === "appoggiatura")) n.gracePitch = pending.gracePitch;
      if (pending.hairpin) n.hairpin = pending.hairpin;
      if (pending.hairpinEnd) n.hairpinEnd = true;
      if (pending.slurStart) n.slurStart = true;
    } else if (pending.dynamic || pending.articulations.length || pending.ornament || pending.slurStart) lose("休止符上的表情记号");
    for (const j of pending.jumps) jumpAt.push({ kind: j, note: n });
    pending = { articulations: [], jumps: [] };
  };

  const addNote = (pitches: number[], len: number) => {
    let dur = len * unitQ() * broken;
    broken = 1;
    if (tuplet) {
      dur *= tuplet.factor;
      if (--tuplet.left <= 0) tuplet = null;
    }
    const sorted = [...new Set(pitches)].sort((a, b) => a - b);
    if (tieOpen && sorted.length && tieOpen.pitches.join() === sorted.join()) {
      // Continuation of a tie: one longer note in the Score.
      const prev = tieOpen;
      tieOpen = null;
      ties.add(prev);
      const n: ScoreNote = { pitches: sorted, dur };
      finishPending(n, true);
      out.push(n);
      noteAt.set(n, t);
      t += dur;
      lastNote = n;
      return;
    }
    if (tieOpen) lose("连到不同音上的延音线");
    tieOpen = null;
    const n: ScoreNote = { pitches: sorted, dur };
    finishPending(n, sorted.length > 0);
    out.push(n);
    noteAt.set(n, t);
    // ABC lyrics skip rests, so only sounding notes take a w: slot.
    if (sorted.length) allSlots.push({ note: n, pitched: true, bar: barIndex });
    t += dur;
    lastNote = n;
  };

  const decoration = (name: string) => {
    const d = name.trim();
    if (DYNAMICS.has(d)) pending.dynamic = d as DynamicMark;
    else if (OTHER_DYNAMICS[d]) {
      pending.dynamic = OTHER_DYNAMICS[d];
      lose(`力度 ${d}（按 ${OTHER_DYNAMICS[d]} 读入）`);
    } else if (d === "staccato" || d === ".") pending.articulations.push("staccato");
    else if (d === "accent" || d === ">" || d === "emphasis" || d === "L") pending.articulations.push("accent");
    else if (d === "tenuto") pending.articulations.push("tenuto");
    else if (d === "trill" || d === "T") pending.ornament = "trill";
    else if (d === "arpeggio") pending.ornament = "arpeggio";
    else if (d === "<(" || d === "crescendo(") pending.hairpin = "cresc";
    else if (d === ">(" || d === "diminuendo(") pending.hairpin = "dim";
    else if (d === "<)" || d === ">)" || d === "crescendo)" || d === "diminuendo)") pending.hairpinEnd = true;
    else if (d === "segno" || d === "S") pending.jumps.push("segno");
    else if (d === "coda" || d === "O") pending.jumps.push("coda");
    else if (d === "fine") pending.jumps.push("fine");
    else if (/^D\.?C\.?/i.test(d)) {
      pending.jumps.push("dc");
      if (/fine/i.test(d)) note("D.C. al Fine 按 D.C. 读入，需要谱里有 Fine");
    } else if (/^D\.?S\.?/i.test(d)) pending.jumps.push("ds");
    else if (d === "dacoda" || /^to\s*coda$/i.test(d)) pending.jumps.push("toCoda");
    else lose(`装饰记号 !${d}!`);
  };

  const barline = (kind: BarEvent["kind"][], ending?: number) => {
    if (firstBarAt === undefined && t > EPS) firstBarAt = t;
    for (const k of kind) barEvents.push({ at: t, kind: k, ending: undefined });
    if (ending !== undefined) barEvents.push({ at: t, kind: "thin", ending });
    barAcc = {};
    barIndex++;
    inOverlay = false;
  };

  const music = (s: string) => {
    let i = 0;
    while (i < s.length) {
      const c = s[i];
      if (inOverlay && c !== "|" && c !== ":" && c !== "[") {
        i++;
        continue;
      }
      if (c === " " || c === "\t" || c === "`" || c === "\\" || c === "y") {
        i++;
        continue;
      }
      if (c === '"') {
        const close = s.indexOf('"', i + 1);
        const body = close < 0 ? s.slice(i + 1) : s.slice(i + 1, close);
        i = close < 0 ? s.length : close + 1;
        if (/^[\^_<>@]/.test(body)) {
          lose("文字注释（\"^…\" 等）");
          continue;
        }
        pending.chord = body.trim();
        continue;
      }
      if (c === "!" || c === "+") {
        const close = s.indexOf(c, i + 1);
        if (close < 0) {
          lose(`没闭合的装饰记号 ${s.slice(i, i + 8)}`);
          break;
        }
        decoration(s.slice(i + 1, close));
        i = close + 1;
        continue;
      }
      if (c === "." || c === "T" || c === "L" || c === "S" || c === "O") {
        decoration(c);
        i++;
        continue;
      }
      if ("~HMPuv".includes(c)) {
        lose(`装饰记号 ${c}`);
        i++;
        continue;
      }
      if (c === "{") {
        const close = s.indexOf("}", i + 1);
        const body = close < 0 ? s.slice(i + 1) : s.slice(i + 1, close);
        i = close < 0 ? s.length : close + 1;
        const slash = body.trimStart().startsWith("/");
        const saved = { ...barAcc };
        const p = readPitch(body.replace(/^\s*\//, "").trimStart(), 0);
        barAcc = saved;
        if (p) {
          pending.ornament = slash ? "grace" : "appoggiatura";
          pending.gracePitch = p[0];
          if ((body.match(/[A-Ga-g]/g) ?? []).length > 1) lose("多个装饰音（只留第一个）");
        }
        continue;
      }
      if (c === "(") {
        const m = /^\((\d)(?::(\d*))?(?::(\d*))?/.exec(s.slice(i));
        if (m) {
          const p = Number(m[1]);
          const compound = curMeter.beatUnit === 8 && curMeter.beats % 3 === 0 && curMeter.beats > 3;
          const q = m[2] ? Number(m[2]) : [2, 4, 8].includes(p) ? 3 : p === 3 || p === 6 ? 2 : compound ? 3 : 2;
          const r = m[3] ? Number(m[3]) : p;
          if (p >= 2 && q > 0) tuplet = { left: r, factor: q / p };
          i += m[0].length;
        } else {
          pending.slurStart = true;
          i++;
        }
        continue;
      }
      if (c === ")") {
        if (lastNote) lastNote.slurEnd = true;
        i++;
        continue;
      }
      if (c === "-") {
        if (lastNote?.pitches.length) tieOpen = lastNote;
        i++;
        continue;
      }
      if (c === ">" || c === "<") {
        let n = 0;
        while (s[i] === c) {
          n++;
          i++;
        }
        const f = 1 / 2 ** n;
        if (lastNote) {
          const grow = c === ">" ? 2 - f : f;
          const before = lastNote.dur;
          lastNote.dur *= grow;
          t += lastNote.dur - before;
          broken = c === ">" ? f : 2 - f;
        }
        continue;
      }
      if (c === "&") {
        lose("同一小节里的叠加声部（&）");
        inOverlay = true;
        i++;
        continue;
      }
      if (c === "[" && /^\[[A-Za-z]:/.test(s.slice(i))) {
        const close = s.indexOf("]", i);
        const body = close < 0 ? s.slice(i + 1) : s.slice(i + 1, close);
        i = close < 0 ? s.length : close + 1;
        applyField(body[0], body.slice(2), true);
        continue;
      }
      if (c === "[" && /^\[\d/.test(s.slice(i))) {
        const m = /^\[(\d+)/.exec(s.slice(i))!;
        barEvents.push({ at: t, kind: "thin", ending: Number(m[1]) });
        i += m[0].length;
        continue;
      }
      if (c === "|" || c === ":" || (c === "[" && s[i + 1] === "|")) {
        const m = /^[|:\[\]]+/.exec(s.slice(i))!;
        let tok = m[0];
        i += tok.length;
        let ending: number | undefined;
        const em = /^\d+/.exec(s.slice(i));
        if (em && /\|$|\[$/.test(tok)) {
          ending = Number(em[0]);
          i += em[0].length;
          while (s[i] === "," || s[i] === "-" || /\d/.test(s[i] ?? "")) i++;
        } else if (tok.endsWith("[") && tok.length > 1) {
          // "|[K:G]" or "|[CEG]": the bracket belongs to what follows.
          i--;
        }
        tok = tok.replace(/\[$/, "");
        const kinds: BarEvent["kind"][] = [];
        const end = /^:+/.test(tok) || /:\|/.test(tok);
        const start = /:+$/.test(tok) || /\|:/.test(tok);
        if (tok === "::" || tok === ":|:" || tok === ":||:") kinds.push("end", "start");
        else {
          if (end) kinds.push("end");
          if (start) kinds.push("start");
        }
        if (!end && !start) kinds.push(/\|\||\|\]|\[\|/.test(tok) ? "thick" : "thin");
        barline(kinds, ending);
        continue;
      }
      if (c === "[") {
        const close = s.indexOf("]", i);
        if (close < 0) {
          lose("没闭合的和弦 [");
          break;
        }
        const body = s.slice(i + 1, close);
        const pitches: number[] = [];
        let innerLen: number | null = null;
        let k = 0;
        while (k < body.length) {
          const p = readPitch(body, k);
          if (!p) {
            k++;
            continue;
          }
          pitches.push(p[0]);
          const [len, after] = readLength(body, p[1]);
          if (innerLen === null) innerLen = len;
          k = after;
          if (body[k] === "-") k++;
        }
        const [outer, after] = readLength(s, close + 1);
        i = after;
        if (!pitches.length) continue;
        addNote(pitches, (innerLen ?? 1) * outer);
        continue;
      }
      if (c === "z" || c === "x") {
        const [len, after] = readLength(s, i + 1);
        i = after;
        if (c === "x") lose("隐形休止符 x（按休止读入）");
        addNote([], len);
        continue;
      }
      if (c === "Z" || c === "X") {
        const m = /^\d*/.exec(s.slice(i + 1))!;
        i += 1 + m[0].length;
        const bars = m[0] ? Number(m[0]) : 1;
        const barQ = (curMeter.beats * 4) / curMeter.beatUnit;
        for (let b = 0; b < bars; b++) {
          addNote([], barQ / unitQ());
          if (b < bars - 1) barline(["thin"]);
        }
        continue;
      }
      const p = readPitch(s, i);
      if (p) {
        const [len, after] = readLength(s, p[1]);
        i = after;
        addNote([p[0]], len);
        continue;
      }
      lose(`读不懂的符号 ${c}`);
      i++;
    }
  };

  const lyricLine = (value: string) => {
    if (lyricLines > 0) {
      lose("第二段及以后的歌词");
      return;
    }
    const items: LyricItem[] = [];
    let word = "";
    let continued = false;
    const flush = (hyphen: boolean) => {
      if (!word) return;
      const syllabic = continued ? (hyphen ? "middle" : "end") : hyphen ? "begin" : "single";
      items.push({ kind: "text", text: word.replace(/~/g, " "), syllabic });
      word = "";
      continued = hyphen;
    };
    for (let i = 0; i < value.length; i++) {
      const c = value[i];
      if (c === "\\" && value[i + 1] === "-") {
        word += "-";
        i++;
      } else if (c === " " || c === "\t") flush(false);
      else if (c === "-") {
        if (word) flush(true);
        else {
          const prev = items.at(-1);
          if (prev?.kind === "text" && !continued) {
            prev.syllabic = prev.syllabic === "end" ? "middle" : "begin";
            continued = true;
          }
        }
      } else if (c === "_") {
        flush(false);
        items.push({ kind: "hold" });
      } else if (c === "*") {
        flush(false);
        items.push({ kind: "skip" });
      } else if (c === "|") {
        flush(false);
        items.push({ kind: "bar" });
      } else word += c;
    }
    flush(false);
    lyricLines++;
    const r = alignAbcLyrics(allSlots, lyricFrom, items);
    if (r.overflow) lose("比音符多出来的歌词");
    if (r.onRest) lose("对到休止符上的歌词");
  };

  for (const raw of lines) {
    const line = raw.replace(/(^|[^\\])%.*$/, "$1").replace(/\s+$/, "");
    if (!line.trim()) {
      if (headerDone && out.length) break; // a blank line ends the tune
      continue;
    }
    const f = /^([A-Za-z+]):\s?(.*)$/.exec(line);
    // In the body, "A:" … "G:" would more likely be music than a header field.
    if (f && !(headerDone && /^[A-G]$/.test(f[1]))) {
      const [, field, value] = f;
      if (!headerDone) {
        if (field === "T" && !title) title = value.trim();
        else if (field === "C") {
          const got = parseCreditLine(value);
          if (got.lyricist && !lyricist) lyricist = got.lyricist;
          if (got.composer && !composerName) composerName = got.composer;
        }
        else if (field === "K") {
          applyField("K", value, false);
          headerDone = true;
          curMeter = meter ?? curMeter;
        } else if (field === "V") voiceId ??= value.trim().split(/\s+/)[0] ?? "";
        else if ("MLQ".includes(field)) applyField(field, value, false);
        continue;
      }
      if (field === "w") {
        if (!inOtherVoice) lyricLine(value);
        continue;
      }
      if (field === "W") {
        lose("曲后歌词 W:");
        continue;
      }
      if ("KMLQVP".includes(field)) {
        applyField(field, value, true);
        continue;
      }
      continue;
    }
    if (!headerDone) {
      if (/^%%/.test(raw)) continue;
      // Tolerate a missing K: — music begins.
      headerDone = true;
      note("缺少调号 K:，按 C 大调读入");
    }
    if (inOtherVoice) continue;
    const before = allSlots.length;
    lyricLines = 0;
    music(line);
    // The w: lines that follow refer to this music line.
    lyricFrom = before;
  }

  // Ties: merge continuation notes.
  const main: ScoreNote[] = [];
  for (let k = 0; k < out.length; k++) {
    const n = out[k];
    main.push(n);
    while (ties.has(out[k]) && k + 1 < out.length) {
      const next = out[++k];
      n.dur += next.dur;
      if (next.slurEnd) n.slurEnd = true;
      if (next.hairpinEnd) n.hairpinEnd = true;
      if (next.dynamic || next.articulations) lose("延音线后半上的记号");
      for (const j of jumpAt) if (j.note === next) j.note = n;
    }
  }
  if (!main.some((n) => n.pitches.length)) throw new Error("这段 ABC 里没有读到音符，现有谱未更改。");

  const k: AbcKey = key ?? { key: "C", mode: "major", fifths: 0 };
  if (!key && headerDone) note("缺少调号 K:，按 C 大调读入");
  const m = meter ?? { beats: 4, beatUnit: 4 };
  if (!meter) note("缺少拍号 M:，按 4/4 读入");
  if (m.beats < 1 || m.beats > CHANGE_BEATS_MAX || !CHANGE_BEAT_UNITS.includes(m.beatUnit)) throw new Error(`拍号 ${m.beats}/${m.beatUnit} 谱线不支持，现有谱未更改。`);
  if (!unit) note(`缺少单位时值 L:，按 ${(m.beats / m.beatUnit) < 0.75 ? "1/16" : "1/8"} 读入`);
  let bpm = tempo ?? 120;
  if (tempo === null) note("缺少速度 Q:，按 ♩=120 读入");
  if (bpm < CHANGE_BPM_MIN || bpm > CHANGE_BPM_MAX) {
    lose(`速度 ${Math.round(bpm)} 超出 ${CHANGE_BPM_MIN}–${CHANGE_BPM_MAX}，已改为最接近的值`);
    bpm = Math.min(CHANGE_BPM_MAX, Math.max(CHANGE_BPM_MIN, bpm));
  }
  const barQ = (m.beats * 4) / m.beatUnit;
  const timed = [...changes, ...chordMarks, ...rehearsalMarks];
  const pad = firstBarAt !== undefined && firstBarAt > EPS && firstBarAt < barQ - EPS ? barQ - firstBarAt : 0;
  if (pad) {
    main.unshift({ pitches: [], dur: pad });
    for (const c of timed) c.at += pad;
  }
  if (pad) {
    note(`弱起小节前补了 ${+pad.toFixed(3)} 拍休止，让小节线对齐`);
    for (const e of barEvents) if (e.at > EPS) e.at += pad;
  }
  const at = (n: ScoreNote) => {
    let q = 0;
    for (const x of main) {
      if (x === n) return q;
      q += x.dur;
    }
    return q;
  };

  const merged = new Map<number, ScoreChange>();
  for (const c of changes) {
    if (c.at <= EPS) continue;
    if (c.bpm !== undefined && (c.bpm < CHANGE_BPM_MIN || c.bpm > CHANGE_BPM_MAX)) {
      lose("超出范围的中途变速");
      continue;
    }
    if (c.beats !== undefined && (c.beats < 1 || c.beats > CHANGE_BEATS_MAX || !CHANGE_BEAT_UNITS.includes(c.beatUnit ?? 0))) {
      lose("谱线不支持的中途拍号");
      continue;
    }
    merged.set(c.at, { ...(merged.get(c.at) ?? {}), ...c });
  }
  const allPitches = main.flatMap((n) => n.pitches);
  const score: Score = {
    title: (title || "ABC 导入").slice(0, 80),
    ...(lyricist ? { lyricist } : {}),
    ...(composerName ? { composer: composerName } : {}),
    key: k.key,
    mode: k.mode,
    beats: m.beats,
    beatUnit: m.beatUnit,
    bpm: Math.round(bpm),
    clef: k.clef ?? "treble",
    tonicOctave: inferTonicOctave(allPitches, k.key),
    notes: main,
  };
  if (merged.size) score.changes = [...merged.values()].sort((a, b) => a.at - b.at);
  const symbols = canonicalChordSymbols(chordMarks);
  if (symbols) score.chordSymbols = symbols;
  const rehearsals = canonicalRehearsals(rehearsalMarks);
  if (rehearsals) score.rehearsals = rehearsals;

  // Repeats from bar events.
  const starts = barStarts(score);
  const total = main.reduce((q, n) => q + n.dur, 0);
  const lineAt = (q: number) => starts.some((s) => Math.abs(s - q) < EPS) || Math.abs(q - total) < EPS;
  const events = barEvents.filter((e) => lineAt(e.at)).sort((a, b) => a.at - b.at);
  if (events.length < barEvents.length) lose("不在小节线上的反复记号");
  const repeats: ScoreRepeat[] = [];
  let openFrom: number | null = null;
  let prevEnd = 0;
  let ending1: number | undefined;
  for (let idx = 0; idx < events.length; idx++) {
    const e = events[idx];
    if (e.ending === 1) ending1 = e.at;
    else if (e.ending !== undefined && e.ending >= 2) {
      const r = repeats.at(-1);
      if (r && Math.abs(r.to - e.at) < EPS && r.ending !== undefined) {
        const stop = events.find((x) => x.at > e.at + EPS && (x.kind === "thick" || x.kind === "start" || x.kind === "end" || x.ending !== undefined));
        r.endingEnd = stop?.at ?? starts.find((s) => s > e.at + EPS) ?? total;
      }
      if (e.ending > 2) lose("第三及以后的结尾");
    }
    if (e.kind === "start") openFrom = e.at;
    if (e.kind === "end") {
      const from = openFrom ?? prevEnd;
      if (e.at > from + EPS) repeats.push({ from, to: e.at, ...(ending1 !== undefined && ending1 > from + EPS && ending1 < e.at - EPS ? { ending: ending1 } : {}) });
      openFrom = null;
      prevEnd = e.at;
      ending1 = undefined;
    }
  }
  if (repeats.length) {
    const problem = repeatProblem(score, repeats);
    if (problem) lose(`反复记号（${problem.replace(/。$/, "")}）`);
    else score.repeats = repeats;
  }
  if (jumpAt.length) {
    const jumps: ScoreJumps = {};
    for (const j of jumpAt) {
      const q = at(j.note);
      const barStart = [...starts].reverse().find((s) => s <= q + EPS) ?? 0;
      const barEnd = starts.find((s) => s > q + EPS) ?? total;
      jumps[j.kind] = j.kind === "segno" || j.kind === "coda" ? barStart : barEnd;
    }
    const problem = jumpProblem(score, jumps);
    if (problem) lose(`跳转记号（${problem.replace(/。$/, "")}）`);
    else score.jumps = jumps;
  }
  return { score, losses, notes };
}


// ---------------------------------------------------------------- export

const ACC_MARK: Record<number, string> = { 2: "^^", 1: "^", 0: "=", [-1]: "_", [-2]: "__" };

/** Spelling for a pitch: the key signature's own letter, a natural, then a sharp or flat.
 * `sharpPcs` are pitch classes that read as raised even in flat keys (a minor key's raised 3rd, 6th, 7th). */
function spell(midi: number, sig: Sig, fifths: number, sharpPcs: readonly number[] = []): { letter: string; acc: number; octave: number } {
  const pc = ((midi % 12) + 12) % 12;
  const letters = LETTERS.split("");
  let letter = letters.find((L) => (LETTER_PC[L] + sig[L] + 12) % 12 === pc);
  let acc = letter ? sig[letter] : 0;
  if (!letter) letter = letters.find((L) => LETTER_PC[L] === pc);
  if (!letter) {
    const sharp = fifths >= 0 || sharpPcs.includes(pc);
    letter = letters.find((L) => LETTER_PC[L] === (pc + (sharp ? 11 : 1)) % 12)!;
    acc = sharp ? 1 : -1;
  }
  const octave = Math.floor((midi - acc) / 12) - 1;
  return { letter, acc, octave };
}

function noteName(letter: string, octave: number): string {
  if (octave >= 5) return letter.toLowerCase() + "'".repeat(octave - 5);
  return letter + ",".repeat(Math.max(0, 4 - octave));
}

/** Length in L:1/8 units, or null when it needs more than a /16 denominator. */
function lengthText(quarters: number): string | null {
  const u = quarters * 2;
  for (const den of [1, 2, 4, 8, 16]) {
    const n = u * den;
    if (Math.abs(n - Math.round(n)) < 1e-6 && Math.round(n) > 0) {
      const num = Math.round(n);
      if (den === 1) return num === 1 ? "" : String(num);
      if (num === 1 && den === 2) return "/";
      return `${num === 1 ? "" : num}/${den}`;
    }
  }
  return null;
}

/** ABC tonic for a Score key; minor keys respelled so the signature stays within seven. */
function abcKeyName(key: KeyName, mode: Mode): { text: string; fifths: number } {
  if (mode === "major") return { text: key === "F#" ? "F#" : key, fifths: keyFifths(key) };
  const pc = KEY_NAMES.indexOf(key);
  const minorNames = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "G#", "A", "Bb", "B"];
  const name = minorNames[pc];
  const tonicFifths = LETTER_FIFTHS[name[0]] + (name[1] === "#" ? 7 : name[1] === "b" ? -7 : 0);
  return { text: `${name}m`, fifths: tonicFifths - 3 };
}

function escapeTitle(s: string): string {
  return s.replace(/[\n\r%]/g, " ").trim() || "谱线";
}

export function exportAbc(score: Score): { text: string; losses: string[] } {
  const losses: string[] = [];
  const lose = (s: string) => void (losses.includes(s) || losses.push(s));
  if (score.voice2?.some((n) => n.pitches.length) || score.extraVoices?.some((v) => v.some((n) => n.pitches.length))) lose("第二个及以后的声部");
  if (score.notes.some((n) => n.fingers?.length)) lose("指法");
  if (score.notes.some((n) => n.lyric?.fragments?.length)) lose("同一音上的多段歌词片段");

  const head = abcKeyName(score.key, score.mode);
  let fifths = head.fifths;
  let sig = signature(fifths);
  const raisedOf = (key: KeyName, mode: Mode) => (mode === "minor" ? [4, 9, 11].map((d) => (KEY_NAMES.indexOf(key) + d) % 12) : []);
  let raised = raisedOf(score.key, score.mode);
  const starts = barStarts(score);
  const total = score.notes.reduce((q, n) => q + n.dur, 0);
  const lines = [...starts.slice(1), total];
  const changeAt = new Map<number, ScoreChange>();
  for (const c of score.changes ?? []) if (c.at > EPS) changeAt.set(Math.round(c.at * 1e6) / 1e6, c);
  const symbols = [...(score.chordSymbols ?? [])].sort((a, b) => a.at - b.at);
  const usedSymbols = new Set<ChordSymbol>();
  const usedRehearsals = new Set<{ at: number; label: string }>();
  const repeats = score.repeats ?? [];
  const jumps = score.jumps ?? {};
  const near = (a: number | undefined, b: number) => a !== undefined && Math.abs(a - b) < EPS;

  type Piece = { n: ScoreNote; start: number; dur: number; first: boolean; last: boolean };
  const pieces: Piece[] = [];
  let q = 0;
  for (const n of score.notes) {
    let s = q;
    const end = q + n.dur;
    let first = true;
    while (end - s > EPS) {
      const next = lines.find((l) => l > s + EPS) ?? end;
      const stop = Math.min(end, next);
      pieces.push({ n, start: s, dur: stop - s, first, last: stop >= end - EPS });
      first = false;
      s = stop;
    }
    q = end;
  }

  const music: string[] = [];
  const lyricLines: string[] = [];
  let line = "";
  let lyric: string[] = [];
  let hasLyric = false;
  let barsOnLine = 0;
  let barAcc: Record<string, number> = {};
  let tripletLeft = 0;
  let openHairpin: "cresc" | "dim" = "cresc";
  const lineOpen = (at: number) => {
    let tok = "";
    if (repeats.some((r) => near(r.from, at))) tok += "|:";
    return tok;
  };
  const flushLine = () => {
    if (!line.trim()) return;
    music.push(line.trimEnd());
    lyricLines.push(lyric.join(" "));
    line = "";
    lyric = [];
  };
  if (score.notes.length) line = lineOpen(0);
  if (repeats.some((r) => near(r.ending, 0))) line += "[1";

  for (let idx = 0; idx < pieces.length; idx++) {
    const p = pieces[idx];
    const c = changeAt.get(Math.round(p.start * 1e6) / 1e6);
    if (c) {
      changeAt.delete(Math.round(p.start * 1e6) / 1e6);
      if (c.beats !== undefined) line += `[M:${c.beats}/${c.beatUnit ?? 4}]`;
      if (c.key !== undefined) {
        const k = abcKeyName(c.key, c.mode ?? score.mode);
        line += `[K:${k.text}]`;
        fifths = k.fifths;
        sig = signature(fifths);
        raised = raisedOf(c.key, c.mode ?? score.mode);
        barAcc = {};
      }
      if (c.bpm !== undefined) line += `[Q:1/4=${Math.round(c.bpm)}]`;
    }
    for (const r of score.rehearsals ?? []) {
      if (usedRehearsals.has(r)) continue;
      if (near(r.at, p.start)) { line += `[P:${r.label}]`; usedRehearsals.add(r); }
    }
    let tok = "";
    for (const s of symbols) {
      if (usedSymbols.has(s)) continue;
      if (s.at >= p.start - EPS && s.at < p.start + p.dur - EPS) {
        if (!near(s.at, p.start)) lose("落在音符中间的和弦名（已移到该音上）");
        if (!tok.includes('"')) tok += `"${s.symbol}"`;
        else lose("同一个音上的第二个和弦名");
        usedSymbols.add(s);
      }
    }
    if (near(jumps.segno, p.start)) tok += "!segno!";
    if (near(jumps.coda, p.start)) tok += "!coda!";
    const barEnd = lines.find((l) => l > p.start + EPS) ?? total;
    const lastInBar = p.start + p.dur >= barEnd - EPS;
    if (lastInBar) {
      if (near(jumps.fine, barEnd)) tok += "!fine!";
      if (near(jumps.toCoda, barEnd)) tok += "!dacoda!";
      if (near(jumps.dc, barEnd)) tok += "!D.C.!";
      if (near(jumps.ds, barEnd)) tok += "!D.S.!";
    }
    const pitched = p.n.pitches.length > 0;
    if (p.first && pitched) {
      const n = p.n;
      if (n.dynamic) tok += `!${n.dynamic}!`;
      if (n.hairpinEnd) tok += openHairpin === "dim" ? "!>)!" : "!<)!";
      if (n.hairpin) {
        tok += n.hairpin === "cresc" ? "!<(!" : "!>(!";
        openHairpin = n.hairpin;
      }
      for (const a of n.articulations ?? []) tok += a === "staccato" ? "." : `!${a}!`;
      if (n.ornament === "trill") tok += "!trill!";
      if (n.ornament === "arpeggio") tok += "!arpeggio!";
      if ((n.ornament === "grace" || n.ornament === "appoggiatura") && n.gracePitch !== undefined) {
        const g = spell(n.gracePitch, sig, fifths, raised);
        tok += `{${n.ornament === "grace" ? "/" : ""}${g.acc !== sig[g.letter] ? ACC_MARK[g.acc] : ""}${noteName(g.letter, g.octave)}}`;
      }
      if (n.slurStart) tok += "(";
    }
    let len = lengthText(p.dur);
    if (len === null) {
      const tripLen = lengthText(p.dur * 1.5);
      if (tripLen !== null && tripletLeft > 0) {
        len = tripLen;
        tripletLeft--;
      } else if (tripLen !== null && idx + 2 < pieces.length && [1, 2].every((d) => near(pieces[idx + d].dur, p.dur))) {
        // Three equal notes in the time of two.
        len = tripLen;
        tok = "(3" + tok;
        tripletLeft = 2;
      } else {
        lose("谱线以外的特殊时值（已取最接近的十六分之一）");
        len = lengthText(Math.max(1 / 8, Math.round(p.dur * 8) / 8)) ?? "";
      }
    }
    if (pitched) {
      const names = p.n.pitches.map((m) => {
        const s = spell(m, sig, fifths, raised);
        const slot = `${s.letter}${s.octave}`;
        const cur = barAcc[slot] ?? sig[s.letter];
        const mark = cur !== s.acc ? ACC_MARK[s.acc] ?? "" : "";
        barAcc[slot] = s.acc;
        return mark + noteName(s.letter, s.octave);
      });
      tok += names.length > 1 ? `[${names.join("")}]${len}` : `${names[0]}${len}`;
      if (!p.last) tok += "-";
      if (p.last && p.n.slurEnd) tok += ")";
    } else tok += `z${len}`;
    line += tok;
    if (p.first && pitched) {
      const ly = p.n.lyric;
      if (ly?.extend && !ly.text) lyric.push("_");
      else if (ly?.text) {
        hasLyric = true;
        const word = ly.text.replace(/-/g, "\\-").replace(/ /g, "~");
        lyric.push(ly.syllabic === "begin" || ly.syllabic === "middle" ? `${word} -` : word);
      } else lyric.push("*");
    }
    // Beam groups read better split at each beat; a space is harmless in ABC.
    const beatQ = 4 / (score.beatUnit || 4);
    const endAt = p.start + p.dur;
    if (Math.abs(endAt / beatQ - Math.round(endAt / beatQ)) < EPS) line += " ";
    if (lastInBar) {
      barAcc = {};
      const isEnd = barEnd >= total - EPS;
      const closes = repeats.some((r) => near(r.to, barEnd));
      const opens = !isEnd && repeats.some((r) => near(r.from, barEnd));
      const thick = repeats.some((r) => near(r.endingEnd, barEnd));
      let bar = closes && opens ? "::" : closes ? ":|" : opens ? "|:" : isEnd ? "|]" : thick ? "||" : "|";
      if (repeats.some((r) => near(r.ending, barEnd))) bar += "[1";
      if (repeats.some((r) => near(r.to, barEnd) && r.endingEnd !== undefined)) bar += "[2";
      barsOnLine++;
      if (barsOnLine >= 4 && !isEnd) {
        // Start-repeat signs belong at the head of the next line.
        if (bar.startsWith("::")) {
          line += ":|";
          flushLine();
          line = "|:" + bar.slice(2);
        } else if (bar.startsWith("|:")) {
          line += "|";
          flushLine();
          line = bar;
        } else {
          line += bar;
          flushLine();
        }
        barsOnLine = 0;
      } else line += bar + " ";
    }
  }
  flushLine();
  for (const s of symbols) if (!usedSymbols.has(s)) lose("曲末之后的和弦名");
  if (changeAt.size) lose("落在音符中间的变速、变调或变拍");

  const headLines = [
    "X:1",
    `T:${escapeTitle(score.title)}`,
    ...(score.lyricist && score.composer ? [`C:词：${escapeTitle(score.lyricist)} 曲：${escapeTitle(score.composer)}`]
      : score.lyricist ? [`C:词：${escapeTitle(score.lyricist)}`]
      : score.composer ? [`C:${escapeTitle(score.composer)}`] : []),
    `M:${score.beats}/${score.beatUnit}`,
    "L:1/8",
    ...(score.tempoMarked === false ? [] : [`Q:1/4=${Math.round(score.bpm)}`]),
    `K:${head.text}${score.clef === "bass" ? " clef=bass" : ""}`,
  ];
  const body: string[] = [];
  music.forEach((m, i) => {
    body.push(m);
    if (hasLyric && /[^*\s]/.test(lyricLines[i].replace(/\*/g, ""))) body.push(`w:${lyricLines[i]}`);
  });
  return { text: [...headLines, ...body, ""].join("\n"), losses };
}
