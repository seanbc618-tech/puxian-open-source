/** 123 简谱文本（Dolce 的 ABC 方言）→ Score, read-only subset.
 * Independently implemented from Dolce 6b1d3fc `docs/格式/123格式.md` (MIT, Copyright (c) 2026 lodebar2026).
 * No upstream code is copied. Subset, encoding and loss matrix: docs/text-formats.md.
 */
import {
  CHANGE_BEAT_UNITS,
  CHANGE_BEATS_MAX,
  CHANGE_BPM_MAX,
  CHANGE_BPM_MIN,
} from "./score-timeline.ts";
import { inferTonicOctave, KEY_NAMES, MAJOR_STEPS, type ChordSymbol, type KeyName, type Mode, type Score, type ScoreChange, type ScoreNote } from "./theory.ts";
import { canonicalChordSymbols, parseChordSymbol } from "./chord-symbol.ts";
import { canonicalRehearsals, cleanRehearsalLabel, isPlayOrder } from "./rehearsals.ts";
import { canonicalFermatas, type FermataMark } from "./fermata.ts";
import type { GradualKind, GradualTempo, ScoreWithGradual } from "./gradual-tempo.ts";
import {
  cleanGradualTempos,
  defaultGradualClose,
  nextBpmAfter,
  readTempoWords,
  shiftGradualTempos,
} from "./text-mid-marks.ts";
import { parseCreditLine } from "./score-credits.ts";
import {
  alignLyrics,
  CLOSING_PUNCT,
  DegreeCarry,
  doKey,
  isCjk,
  OPENING_PUNCT,
  padPickup,
  pushPunct,
  type LyricItem,
  type LyricSlot,
} from "./text-score-util.ts";

export type TextImport = { score: Score; losses: string[]; notes: string[] };

const LETTERS = "CDEFGAB";
const LETTER_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const MODE_DEGREE: Record<string, number> = {
  "": 1, maj: 1, major: 1, ion: 1, m: 6, min: 6, minor: 6, aeo: 6, dor: 2, phr: 3, lyd: 4, mix: 5, loc: 7,
};
const ALIASES: Record<string, string> = {
  曲号: "X", 标题: "T", 副标题: "T2", 词曲: "C", 调: "K", 调号: "K", 拍: "M", 拍号: "M", 速度: "Q", 声部: "V",
  歌词: "w", 段: "w", 顺序: "P", 注: "N", 样式: "I",
};

const FIELD_RE = new RegExp(
  `^\\s*([A-Za-z+]|${Object.keys(ALIASES).sort((a, b) => b.length - a.length).join("|")})[:：](.*)$`,
);

type KeyInfo = { key: KeyName; mode: Mode; doMidi: number; modal: boolean };

/** `K:` value → do-key. `K:Em` / `K:6=E` keep the G-major signature with 6 as tonic. */
export function parse123Key(value: string): KeyInfo | null {
  const v = value.trim().replace(/♯/g, "#").replace(/♭/g, "b");
  const m = /^(?:([1-7])\s*=\s*)?(?:([#b])([A-G])|([A-G])([#b]?))(\s*)([A-Za-z]*)(?=\s|$)/.exec(v);
  if (!m) return null;
  // "Am" / "A minor" are modes; a spaced unknown word (e.g. a clef) is ignored, a glued one is an error.
  let modeWord = (m[7] ?? "").toLowerCase();
  if (!(modeWord in MODE_DEGREE)) {
    if (!m[6]) return null;
    modeWord = "";
  }
  const letter = (m[3] ?? m[4]).toUpperCase();
  const accText = m[2] ?? m[5] ?? "";
  const alter = accText === "#" ? 1 : accText === "b" ? -1 : 0;
  const degree = m[1] ? Number(m[1]) : MODE_DEGREE[modeWord];
  if (m[1] && modeWord) return null;
  // Spell do so that do + major step(degree) is the written tonic.
  const tonicPc = LETTER_PC[letter] + alter;
  const doLetter = LETTERS[(LETTERS.indexOf(letter) - (degree - 1) + 7) % 7];
  let doAlter = (((tonicPc - MAJOR_STEPS[degree - 1] - LETTER_PC[doLetter]) % 12) + 12) % 12;
  if (doAlter > 6) doAlter -= 12;
  const { key: doName, doMidi } = doKey(doLetter, doAlter);
  if (degree === 6)
    return { key: KEY_NAMES[(((tonicPc % 12) + 12) % 12)], mode: "minor", doMidi, modal: false };
  return { key: doName, mode: "major", doMidi, modal: degree !== 1 };
}

function parseMeter(value: string): { beats: number; beatUnit: number; extra: boolean } | null {
  const v = value.trim();
  if (/^C\|/.test(v)) return { beats: 2, beatUnit: 2, extra: false };
  if (/^C(?=\s|$)/.test(v)) return { beats: 4, beatUnit: 4, extra: false };
  const all = [...v.matchAll(/(\d+)\s*\/\s*(\d+)/g)];
  if (!all.length) return null;
  return { beats: Number(all[0][1]), beatUnit: Number(all[0][2]), extra: all.length > 1 };
}

function parseTempo(value: string): number | null {
  const v = value.trim();
  const frac = /(\d+)\s*\/\s*(\d+)\s*=\s*(\d+(?:\.\d+)?)/.exec(v);
  if (frac) return (Number(frac[3]) * Number(frac[1]) * 4) / Number(frac[2]);
  const bare = /^(\d+(?:\.\d+)?)(?=\s|$)/.exec(v);
  return bare ? Number(bare[1]) : null;
}

type Paren = { kind: "slur"; start: number } | { kind: "tuplet"; factor: number };
type Voice = {
  notes: ScoreNote[];
  slots: LyricSlot[];
  t: number;
  bar: number;
  barHasContent: boolean;
  lines: number[];
  carry: DegreeCarry;
  doMidi: number;
  octave: number;
  parens: Paren[];
  factor: number;
  ties: Set<ScoreNote>;
  arcFrom: ScoreNote | null;
  sawLyrics: boolean;
  firstBarAt?: number;
};

const newVoice = (doMidi: number, octave = 0): Voice => ({
  notes: [], slots: [], t: 0, bar: 0, barHasContent: false, lines: [0], carry: new DegreeCarry(),
  doMidi, octave, parens: [], factor: 1, ties: new Set(), arcFrom: null, sawLyrics: false,
});

function decodeText(input: string | Uint8Array | ArrayBuffer): string {
  if (typeof input === "string") return input.replace(/^\uFEFF/, "");
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff))
    throw new Error("123 文件应为 UTF-8；这像是 UTF-16 文件（JP-Word 请用 .jpwabc 导入）。");
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\uFEFF/, "");
  } catch {
    throw new Error("123 文件不是有效的 UTF-8 文本，现有谱未更改。");
  }
}

export function import123(input: string | Uint8Array | ArrayBuffer): TextImport {
  const text = decodeText(input);
  if (text.includes("\0")) throw new Error("123 文件含有二进制内容，现有谱未更改。");
  const losses: string[] = [];
  const notes: string[] = [];
  const lose = (s: string) => void (losses.includes(s) || losses.push(s));
  const note = (s: string) => void (notes.includes(s) || notes.push(s));

  let title = "";
  let lyricist: string | undefined;
  let composer: string | undefined;
  let keyInfo: KeyInfo | null = null;
  let meter: { beats: number; beatUnit: number } | null = null;
  let bpm: number | null = null;
  let clef: Score["clef"] = "treble";
  const changes: ScoreChange[] = [];
  const chordMarks: ChordSymbol[] = [];
  const rehearsalMarks: { at: number; label: string }[] = [];
  const fermataMarks: FermataMark[] = [];
  let pendingFermata = false;
  const gradualMarks: GradualTempo[] = [];
  let openGradual: { from: number; kind: GradualKind; toBpm?: number } | null = null;
  const closeGradual = (at: number) => {
    if (!openGradual || at <= openGradual.from + 1e-6) return;
    const span: GradualTempo = { from: openGradual.from, to: at, kind: openGradual.kind };
    if (openGradual.toBpm !== undefined) span.toBpm = openGradual.toBpm;
    gradualMarks.push(span);
    openGradual = null;
  };
  const startGradual = (at: number, kind: GradualKind, toBpm?: number) => {
    closeGradual(at);
    openGradual = { from: at, kind };
    if (toBpm !== undefined) openGradual.toBpm = toBpm;
  };
  /** Chord symbols ride on voice 1's timeline; elsewhere they are listed as lost. */
  const chordMark = (v: Voice, body: string) => {
    const main = v === voiceAt(0) && !inAmp;
    if (main && parseChordSymbol(body)) chordMarks.push({ at: v.t, symbol: body.trim() });
    else lose(main ? "认不出的和弦记号" : "第二声部上的和弦记号");
  };
  let musicStarted = false;
  let stopped = false;
  const voiceIds: string[] = [];
  const voices: Voice[] = [];
  let current = 0;
  let amp: Voice | null = null;
  let inAmp = false;
  let barStartT = 0;
  const unknown = new Set<string>();
  type Block = { voice: Voice; from: number; verses: LyricItem[][] };
  const blocks: Block[] = [];
  let block: Block | null = null;

  const startKey = () => keyInfo ?? { key: "C" as KeyName, mode: "major" as Mode, doMidi: 60, modal: false };
  const voiceAt = (index: number): Voice | null => {
    if (index > 1) return null;
    while (voices.length <= index) voices.push(newVoice(startKey().doMidi));
    return voices[index];
  };
  const target = (): Voice | null => (inAmp ? amp : voiceAt(current));

  const applyKey = (value: string, v: Voice | null) => {
    const k = parse123Key(value);
    if (/clef\s*=\s*bass/.test(value) && current === 0 && !musicStarted) clef = "bass";
    if (/clef\s*=/.test(value) && !/clef\s*=\s*(treble|bass)(?=\s|$)/.test(value)) lose("谱号的八度移位与中音/次中音谱号");
    if (!k) {
      if (!/^\s*clef\s*=/.test(value) && value.trim()) lose(`认不出的调号「${value.trim().slice(0, 12)}」，沿用原调`);
      return;
    }
    if (k.modal) lose("教会调式（主音唱名不是 1 或 6），按同调号的大调读");
    if (!musicStarted) {
      keyInfo = k;
      for (const voice of voices) voice.doMidi = k.doMidi;
      return;
    }
    if (v) v.doMidi = k.doMidi;
    if (current === 0 && !inAmp && v) changes.push({ at: v.t, key: k.key, mode: k.mode });
  };
  const applyMeter = (value: string, v: Voice | null) => {
    const m = parseMeter(value);
    if (!m) {
      lose("自由拍或认不出的拍号（按 4/4 计）");
      return;
    }
    if (m.extra) lose("混合拍只取第一个拍号");
    if (!musicStarted || !v) meter = { beats: m.beats, beatUnit: m.beatUnit };
    else if (current === 0 && !inAmp) {
      if (m.beats < 1 || m.beats > CHANGE_BEATS_MAX || !CHANGE_BEAT_UNITS.includes(m.beatUnit))
        lose(`曲中拍号 ${m.beats}/${m.beatUnit} 超出支持范围，未保留`);
      else changes.push({ at: v.t, beats: m.beats, beatUnit: m.beatUnit });
    }
  };
  const applyTempo = (value: string, v: Voice | null) => {
    const q = parseTempo(value);
    if (q === null) {
      lose("文字速度（如「中速」）只作说明，未保留");
      return;
    }
    if (/"[^"]*"/.test(value)) lose("速度旁的文字说明");
    if (!musicStarted || !v) bpm = q;
    else if (current === 0 && !inAmp) {
      if (q < CHANGE_BPM_MIN || q > CHANGE_BPM_MAX) lose(`曲中速度 ${Math.round(q)} 超出 ${CHANGE_BPM_MIN}–${CHANGE_BPM_MAX}，未保留`);
      else {
        closeGradual(v.t);
        changes.push({ at: v.t, bpm: Math.round(q) });
      }
    }
  };

  const closeBlock = () => {
    block = null;
  };

  /** Pending per-note marks written before the note. */
  let pending: Partial<ScoreNote> & { grace?: number } = {};
  let pendingGradual: ReturnType<typeof readTempoWords> = null;

  const pushEvent = (v: Voice, pitches: number[], dur: number, slot: "note" | "rest" | "invisible" | "rhythm") => {
    const n: ScoreNote = { pitches, dur };
    if (pending.dynamic) n.dynamic = pending.dynamic;
    if (pending.hairpin) n.hairpin = pending.hairpin;
    if (pending.hairpinEnd) n.hairpinEnd = true;
    if (pending.articulations?.length) n.articulations = pending.articulations;
    if (pitches.length) {
      if (pending.ornament) n.ornament = pending.ornament;
      if (pending.grace !== undefined) {
        if (n.ornament) lose("同一个音上的颤音与倚音只留一个");
        n.ornament = "grace";
        n.gracePitch = pending.grace;
      }
    } else if (pending.ornament || pending.grace !== undefined) lose("挂在休止上的装饰音");
    if (pendingFermata) {
      const voice = v === voices[0] ? 0 : v === voices[1] || v === amp ? 1 : Math.max(0, voices.indexOf(v));
      fermataMarks.push({ voice, at: v.t });
      pendingFermata = false;
    }
    if (pendingGradual && (v === voices[0] || (!voices.length && current === 0)) && !inAmp && v === voiceAt(0)) {
      if (pendingGradual.role === "start") startGradual(v.t, pendingGradual.kind, pendingGradual.toBpm);
      else closeGradual(v.t);
      pendingGradual = null;
    }
    pending = {};
    if (v.arcFrom) {
      const from = v.arcFrom;
      v.arcFrom = null;
      if (v.notes.at(-1) === from && pitches.length && same(from.pitches, pitches)) v.ties.add(from);
      else if (pitches.length) {
        if (from.slurStart) lose("叠着的连线只留一层");
        from.slurStart = true;
        n.slurEnd = true;
      }
    }
    v.notes.push(n);
    if (slot !== "rest") v.slots.push({ note: n, pitched: slot === "note", bar: v.bar });
    if (slot === "rhythm") lose("节奏音符 X（无音高）记为休止");
    v.t += dur;
    v.barHasContent = true;
    return n;
  };
  const same = (a: number[], b: number[]) => a.length === b.length && a.every((p, i) => p === b[i]);

  const readDur = (s: string, i: number) => {
    const m = /^[_.]*/.exec(s.slice(i))![0];
    const u = (m.match(/_/g) ?? []).length,
      d = (m.match(/\./g) ?? []).length;
    return { dur: 2 ** -u * (2 - 2 ** -d), next: i + m.length };
  };
  const readPitch = (s: string, i: number) => {
    const m = /^(##|bb|#|b|n)?([1-7])([',]*)/.exec(s.slice(i));
    if (!m) return null;
    const acc = m[1] === undefined ? null : ({ "##": 2, bb: -2, "#": 1, b: -1, n: 0 } as Record<string, number>)[m[1]];
    const oct = [...m[3]].reduce((o, c) => o + (c === "'" ? 1 : -1), 0);
    return { degree: Number(m[2]), acc, oct, next: i + m[0].length };
  };

  const barline = (v: Voice) => {
    if (v.barHasContent) {
      if (v.bar === 0) v.firstBarAt = v.t;
      v.bar++;
      v.barHasContent = false;
    }
    v.carry.reset();
  };

  const parseMusic = (raw: string) => {
    const s = raw;
    let i = 0;
    while (i < s.length) {
      const v = target();
      const ch = s[i];
      const rest = s.slice(i);
      if (/\s|`/.test(ch)) {
        i++;
        continue;
      }
      if (!v) {
        // Third and later voices are dropped as a whole.
        i = s.length;
        break;
      }
      if (ch === "$") {
        if (!inAmp && v.lines.at(-1) !== v.slots.length) v.lines.push(v.slots.length);
        i += rest.startsWith("$$") ? 2 : 1;
        continue;
      }
      const bar = /^(:\|:|::\||\|::|::|:\|\]?|\|:|\[\|\]|\[\||\|\]|\|\||\.\||\|)/.exec(rest);
      if (bar) {
        if (bar[0].includes(":")) lose("反复记号（只按谱面播放一遍）");
        if (inAmp && amp) {
          inAmp = false;
          barline(amp);
        }
        const main = voiceAt(current)!;
        barline(main);
        if (current === 0) barStartT = main.t;
        i += bar[0].length;
        continue;
      }
      if (ch === "&") {
        if (current !== 0 || voices.length > 1 || voiceIds.length > 1) {
          lose("同一谱表的 & 第二声部（已有 V:2，未并入）");
          // Skip to the next barline.
          const end = s.slice(i + 1).search(/[|:]/);
          i = end < 0 ? s.length : i + 1 + end;
          continue;
        }
        amp ??= newVoice(voiceAt(0)!.doMidi);
        amp.doMidi = voiceAt(0)!.doMidi;
        if (amp.t < barStartT - 1e-9) {
          amp.notes.push({ pitches: [], dur: barStartT - amp.t });
          amp.t = barStartT;
        }
        inAmp = true;
        i++;
        continue;
      }
      const field = /^\[([A-Za-z]):([^\]]*)\]/.exec(rest);
      if (field) {
        const [, f, value] = field;
        if (f === "K") applyKey(value, v);
        else if (f === "M") applyMeter(value, v);
        else if (f === "Q") applyTempo(value, v);
        else if (f === "P") {
          const label = cleanRehearsalLabel(value);
          if (label && !isPlayOrder(value)) rehearsalMarks.push({ at: v.t, label });
          else lose("演唱顺序（P:）");
        }
        else if (f === "V") lose("行内换声部 [V:]（已忽略）");
        else lose("行内字段与版式指令");
        i += field[0].length;
        continue;
      }
      const chord = /^\[((?:(?:##|bb|#|b|n)?[1-7][',]*~?){2,})\]/.exec(rest);
      if (chord) {
        if (chord[1].includes("~")) lose("和音里只连一个音的延音线（当作圆滑线或忽略）");
        const pitches: number[] = [];
        let j = 0;
        const inner = chord[1].replace(/~/g, "");
        while (j < inner.length) {
          const p = readPitch(inner, j)!;
          pitches.push(v.carry.midi(v.doMidi, p.degree, p.acc, p.oct + v.octave));
          j = p.next;
        }
        const d = readDur(s, i + chord[0].length);
        const uniq = [...new Set(pitches)].sort((a, b) => a - b);
        if (uniq.length > 8) {
          lose("和弦超过 8 个音的部分");
          uniq.splice(0, uniq.length - 8);
        }
        pushEvent(v, uniq, d.dur * v.factor, "note");
        i = d.next;
        continue;
      }
      if (/^\[\d+(?:[,-]\d+)*(?=[\s"]|$)/.test(rest)) {
        lose("房号（第几遍结尾）只按谱面播放一遍");
        i += /^\[\d+(?:[,-]\d+)*/.exec(rest)![0].length;
        continue;
      }
      if (ch === "!") {
        const end = s.indexOf("!", i + 1);
        if (end < 0) {
          unknown.add("!");
          i++;
          continue;
        }
        deco(s.slice(i + 1, end).trim());
        i = end + 1;
        continue;
      }
      if (ch === '"') {
        const end = s.indexOf('"', i + 1);
        const body = end < 0 ? s.slice(i + 1) : s.slice(i + 1, end);
        const words = readTempoWords(body);
        if (words) {
          if (current === 0 && !inAmp) {
            if (words.role === "start") startGradual(v.t, words.kind, words.toBpm);
            else closeGradual(v.t);
          }
        } else if (/^[\^_<>@]/.test(body)) lose("谱上文字注记");
        else chordMark(v, body);
        i = end < 0 ? s.length : end + 1;
        continue;
      }
      if (ch === "{") {
        const end = s.indexOf("}", i + 1);
        if (end < 0) {
          unknown.add("{");
          i++;
          continue;
        }
        const inner = s.slice(i + 1, end);
        const graces: number[] = [];
        let j = 0;
        while (j < inner.length) {
          const p = readPitch(inner, j);
          if (p) {
            graces.push(v.carry.midi(v.doMidi, p.degree, p.acc, p.oct + v.octave));
            j = readDur(inner, p.next).next;
          } else j++;
        }
        if (graces.length) {
          pending.grace = graces[0];
          if (graces.length > 1) lose("一串多个倚音只留第一个");
        }
        i = end + 1;
        continue;
      }
      if (ch === "(") {
        const tup = /^\((\d+):(?:(\d+):)?/.exec(rest);
        if (tup) {
          const n = Number(tup[1]);
          const p = tup[2] ? Number(tup[2]) : n === 2 || n === 4 ? 3 : 2 ** Math.floor(Math.log2(n - 1e-9));
          if (!(n >= 2 && n <= 16 && p >= 1)) throw new Error(`多连音「${tup[0]}」写法不支持，现有谱未更改。`);
          v.parens.push({ kind: "tuplet", factor: v.factor });
          v.factor *= p / n;
          i += tup[0].length;
        } else {
          v.parens.push({ kind: "slur", start: v.notes.length });
          i++;
        }
        continue;
      }
      if (ch === ")") {
        const open = v.parens.pop();
        if (!open) unknown.add(")");
        else if (open.kind === "tuplet") v.factor = open.factor;
        else {
          const end = v.notes.length - 1;
          const a = v.notes[open.start];
          const b = v.notes[end];
          if (a && b && end > open.start) {
            if (end === open.start + 1 && a.pitches.length && same(a.pitches, b.pitches)) v.ties.add(a);
            else {
              if (a.slurStart || b.slurEnd) lose("叠着的连线只留一层");
              a.slurStart = true;
              b.slurEnd = true;
            }
          }
        }
        i++;
        continue;
      }
      if (ch === "~") {
        const last = v.notes.at(-1);
        if (last?.pitches.length) v.arcFrom = last;
        i++;
        continue;
      }
      if (ch === "-") {
        const last = v.notes.at(-1);
        if (last) {
          last.dur += v.factor;
          v.t += v.factor;
        }
        i++;
        continue;
      }
      if (ch === "y") {
        i++;
        continue;
      }
      const multi = /^Z(\d*)/.exec(rest);
      if (multi) {
        const n = Math.max(1, Number(multi[1] || 1));
        const barLen = ((meter?.beats ?? 4) * 4) / (meter?.beatUnit ?? 4);
        for (let k = 0; k < n; k++) {
          pushEvent(v, [], barLen, "rest");
          if (k < n - 1) barline(v);
        }
        i += multi[0].length;
        continue;
      }
      // Unquoted chord symbols: capital A–G (or #/b + A–G) up to whitespace.
      const bare = /^(?:[#b]?[A-G])[^\s|]*/.exec(rest);
      if (bare && /^[#b]?[A-G]/.test(rest)) {
        chordMark(v, bare[0]);
        i += bare[0].length;
        continue;
      }
      const p = readPitch(s, i);
      if (p) {
        const d = readDur(s, p.next);
        const midi = v.carry.midi(v.doMidi, p.degree, p.acc, p.oct + v.octave);
        pushEvent(v, [midi], d.dur * v.factor, "note");
        i = d.next;
        continue;
      }
      const restTok = /^([0xX])(@[A-G]\d)?/.exec(rest);
      if (restTok) {
        const d = readDur(s, i + restTok[0].length);
        pushEvent(v, [], d.dur * v.factor, restTok[1] === "0" ? "rest" : restTok[1] === "x" ? "invisible" : "rhythm");
        i = d.next;
        continue;
      }
      unknown.add(ch);
      i++;
    }
  };

  function deco(name: string) {
    const n = name.toLowerCase();
    const dyn: Record<string, ScoreNote["dynamic"]> = { p: "p", mp: "mp", mf: "mf", f: "f", pp: "p", ppp: "p", ff: "f", fff: "f" };
    if (n in dyn) {
      pending.dynamic = dyn[n];
      if (n.length > 2 || n === "pp" || n === "ff") lose("更细的力度（pp、ff 等）记成 p 或 f");
    } else if (["crescendo(", "<(", "diminuendo(", ">("].includes(n)) pending.hairpin = n.startsWith("c") || n.startsWith("<") ? "cresc" : "dim";
    else if (["crescendo)", "<)", "diminuendo)", ">)"].includes(n)) pending.hairpinEnd = true;
    else if (["staccato", "dy", "顿音", "staccatissimo", "wedge"].includes(n)) pending.articulations = [...(pending.articulations ?? []), "staccato"];
    else if (["accent", "zy", "重音", ">", "emphasis", "strong-accent"].includes(n)) pending.articulations = [...(pending.articulations ?? []), "accent"];
    else if (["tenuto", "bc", "保持音"].includes(n)) pending.articulations = [...(pending.articulations ?? []), "tenuto"];
    else if (["trill", "tr", "cy", "颤音", "trill-mark"].includes(n)) pending.ornament = "trill";
    else if (["fermata", "yc", "延长", "延长记号", "invertedfermata"].includes(n)) pendingFermata = true;
    else if (readTempoWords(name)) pendingGradual = readTempoWords(name);
    else if (["segno", "coda", "d.c.", "d.s.", "dacapo", "dacoda", "fine"].includes(n)) lose("跳转记号（D.C.、D.S.、Fine 等）");
    else if (["arpeggio", "琶音", "arpeggiate"].includes(n)) pending.ornament = "arpeggio";
    else lose("其他装饰与奏法记号");
  }

  const lyricItems = (body: string): LyricItem[] => {
    const items: LyricItem[] = [];
    const open = { v: "" };
    let word = "";
    let hyphen = false;
    const flush = (endsWithHyphen = false) => {
      if (word) {
        items.push({ kind: "text", text: open.v + word, syllabic: hyphen ? (endsWithHyphen ? "middle" : "end") : endsWithHyphen ? "begin" : "single" });
        open.v = "";
        hyphen = endsWithHyphen;
      } else if (!endsWithHyphen) hyphen = false;
      word = "";
    };
    for (let i = 0; i < body.length; i++) {
      const ch = body[i];
      if (ch === "\\" && i + 1 < body.length) {
        word += body[++i];
        continue;
      }
      if (/\s/.test(ch)) flush();
      else if (ch === "-") flush(true);
      else if (ch === "_") {
        flush();
        items.push({ kind: "hold" });
      } else if (ch === "/" || ch === "*") {
        flush();
        items.push({ kind: "skip" });
      } else if (ch === "|") {
        flush();
        items.push({ kind: "bar" });
      } else if (ch === "~") word += " ";
      else if (ch === "{") {
        flush();
        const end = body.indexOf("}", i + 1);
        const group = end < 0 ? body.slice(i + 1) : body.slice(i + 1, end);
        items.push({ kind: "text", text: open.v + group, syllabic: "single" });
        open.v = "";
        i = end < 0 ? body.length : end;
      } else if (ch === "<") {
        const end = body.indexOf(">", i + 1);
        i = end < 0 ? body.length : end;
      } else if (CLOSING_PUNCT.includes(ch)) {
        flush();
        pushPunct(items, ch, open);
      } else if (OPENING_PUNCT.includes(ch)) {
        flush();
        open.v += ch;
      } else {
        const cp = body.codePointAt(i)!;
        const c = String.fromCodePoint(cp);
        if (isCjk(c)) {
          flush();
          items.push({ kind: "text", text: open.v + c, syllabic: "single" });
          open.v = "";
        } else word += c;
        if (cp > 0xffff) i++;
      }
    }
    flush();
    return items;
  };

  const lines = text.split(/\r?\n/);
  for (const rawLine of lines) {
    if (stopped) break;
    let line = rawLine;
    if (/^%%/.test(line.trim())) {
      if (/^%%sing\b/.test(line.trim())) lose("演唱顺序（%%sing、P:）");
      else if (!/^%%newpage/.test(line.trim())) lose("版式与样式指令（I:、%%）");
      continue;
    }
    // `%` starts a comment except inside quotes; `\%` is literal.
    line = line.replace(/(^|[^\\])%.*$/, "$1");
    const trimmed = line.trim();
    if (!trimmed) {
      closeBlock();
      continue;
    }
    // Fields need the colon right after the name, so a bare-chord music line such as `F 5 1` stays music.
    const fm = FIELD_RE.exec(line);
    if (fm) {
      const name = ALIASES[fm[1]] ?? fm[1];
      const value = fm[2];
      if (name !== "w" && name !== "+") closeBlock();
      switch (name) {
        case "X":
          if (musicStarted) {
            stopped = true;
            lose("文件里的第 2 首起未导入（只导入第 1 首）");
          }
          break;
        case "T":
          if (!title && !musicStarted) title = value.trim();
          else lose(musicStarted ? "曲中的段落标题" : "副标题");
          break;
        case "T2":
          lose("副标题");
          break;
        case "K":
          applyKey(value, musicStarted ? target() : null);
          break;
        case "M":
          applyMeter(value, musicStarted ? target() : null);
          break;
        case "Q":
          applyTempo(value, musicStarted ? target() : null);
          break;
        case "L":
          break;
        case "V": {
          const id = value.trim().split(/\s+/)[0] || "1";
          inAmp = false;
          if (!voiceIds.includes(id)) voiceIds.push(id);
          current = voiceIds.indexOf(id);
          if (current > 1) lose("第三声部起（谱线最多两个声部）");
          if (/part\s*=/.test(value)) lose("同一乐器的第二条谱表按独立声部读入");
          const v = voiceAt(current);
          if (v && /clef\s*=\s*treble-8/.test(value)) {
            v.octave = -1;
            note("clef=treble-8 的声部已按实际音高（低八度）读入");
          }
          if (current === 0 && /clef\s*=\s*bass/.test(value)) clef = "bass";
          break;
        }
        case "w":
        case "+": {
          const v = voiceAt(current);
          if (!v) break;
          const items = lyricItems(value);
          if (name === "+" && block) {
            block.verses.at(-1)!.push(...items);
            break;
          }
          if (name === "+") break;
          if (!block || block.voice !== v) {
            const starts: number[] = v.lines.filter((x: number) => x < v.slots.length);
            block = { voice: v, from: starts.at(-1) ?? 0, verses: [] };
            blocks.push(block);
            v.sawLyrics = true;
          }
          block.verses.push(items);
          break;
        }
        case "W":
          lose("曲末附加歌词（W:）");
          break;
        case "P":
          lose("演唱顺序（%%sing、P:）");
          break;
        case "C": {
          const got = parseCreditLine(value);
          if (got.lyricist && !lyricist) lyricist = got.lyricist;
          if (got.composer && !composer) composer = got.composer;
          if (!got.lyricist && !got.composer) lose("词曲署名");
          break;
        }
        case "I":
          if (!/^\s*linebreak\b/.test(value)) lose("版式与样式指令（I:、%%）");
          break;
        case "U":
          lose("自定义符号（U:）");
          break;
        default:
          lose("署名、出处、注记等信息字段");
      }
      continue;
    }
    // Music line.
    const v = voiceAt(current);
    closeBlock();
    musicStarted = true;
    if (!v) {
      continue;
    }
    if (v.sawLyrics) {
      if (v.lines.at(-1) !== v.slots.length) v.lines.push(v.slots.length);
      v.sawLyrics = false;
    }
    // An open `&` branch lasts until its barline, even across a line end.
    parseMusic(line);
  }
  if (!voices.length || !voices[0].notes.some((n) => n.pitches.length))
    throw new Error("没有可导入的旋律音符；请确认这是 123 简谱文本，现有谱未更改。");
  if (unknown.size) lose(`跳过了认不出的记号「${[...unknown].slice(0, 6).join(" ")}」`);
  for (const v of voices) if (v.parens.some((p) => p.kind === "tuplet")) throw new Error("多连音缺「)」，现有谱未更改。");

  // Lyrics: first verse per block; later verses are reported, never merged.
  for (const b of blocks) {
    if (b.verses.length > 1) lose("第 2 段起的歌词（只保留第 1 段）");
    const r = alignLyrics(b.voice.slots, b.from, b.verses[0]);
    if (r.overflow) lose("歌词比音符多出的字");
    if (r.onRest) lose("落在不可见休止 x 或节奏音符上的歌词");
  }
  if (voices[1] && blocks.some((b) => b.voice === voices[1])) note("第二声部的歌词已保留在第二声部");

  // Ties: merge same-pitch arcs into one longer note, keeping the first lyric.
  const merge = (v: Voice) => {
    const out: ScoreNote[] = [];
    for (let k = 0; k < v.notes.length; k++) {
      const n = v.notes[k];
      out.push(n);
      while (v.ties.has(v.notes[k]) && k + 1 < v.notes.length) {
        const next = v.notes[++k];
        n.dur += next.dur;
        if (next.lyric?.text) lose("延音线后半上的歌词");
        if (next.dynamic || next.hairpin || next.articulations?.length) lose("延音线后半上的力度或奏法");
        if (next.slurEnd) n.slurEnd = true;
        if (next.hairpinEnd) n.hairpinEnd = true;
      }
    }
    return out;
  };
  const main = merge(voices[0]);
  let second: ScoreNote[] | undefined;
  if (voices[1]) second = merge(voices[1]);
  else if (amp) {
    second = merge(amp);
    while (second.length && !second.at(-1)!.pitches.length) second.pop();
    if (second.length) note("& 第二声部已放入声部二");
    else second = undefined;
  }

  for (const n of [...main, ...(second ?? [])]) {
    if (n.ornament === "arpeggio" && n.pitches.length < 2) {
      delete n.ornament;
      lose("单音上的琶音记号");
    }
  }
  const k = startKey();
  if (!keyInfo) note("缺少调号，按 1=C 读入");
  const m = meter ?? { beats: 4, beatUnit: 4 };
  if (!meter) note("缺少拍号，按 4/4 读入");
  if (m.beats < 1 || m.beats > 32 || ![1, 2, 4, 8, 16, 32].includes(m.beatUnit)) throw new Error("此拍号谱线不支持，现有谱未更改。");
  let tempo = bpm ?? 120;
  if (bpm === null) note("缺少速度，按 ♩=120 读入");
  if (tempo < 20 || tempo > 300) {
    lose(`速度 ${Math.round(tempo)} 超出 20–300，已改为最接近的值`);
    tempo = Math.min(300, Math.max(20, tempo));
  }
  if (k.mode === "minor") note("小调按谱线「1=主音」的写法显示，唱名与原文不同，音高不变");
  const allPitches = [...main, ...(second ?? [])].flatMap((n) => n.pitches);
  const leftoverGradual = openGradual as { from: number; kind: GradualKind; toBpm?: number } | null;
  if (leftoverGradual) {
    const end = voices[0]?.t ?? 0;
    const closed = defaultGradualClose(leftoverGradual.from, leftoverGradual.kind, end, nextBpmAfter(changes, leftoverGradual.from), leftoverGradual.toBpm);
    if (closed) gradualMarks.push(closed);
  }
  const pad = padPickup(voices[0].firstBarAt, (m.beats * 4) / m.beatUnit, second ? [main, second] : [main], [...changes, ...chordMarks, ...rehearsalMarks, ...fermataMarks]);
  if (pad) {
    shiftGradualTempos(gradualMarks, pad);
    note(`弱起小节前补了 ${+pad.toFixed(3)} 拍休止，让小节线对齐`);
  }
  const merged = new Map<number, ScoreChange>();
  for (const c of changes) {
    if (c.at <= 1e-9) continue;
    merged.set(c.at, { ...(merged.get(c.at) ?? {}), ...c });
  }
  const score: Score = {
    title: (title || "123 导入").slice(0, 80),
    ...(lyricist ? { lyricist } : {}),
    ...(composer ? { composer } : {}),
    key: k.key,
    mode: k.mode,
    beats: m.beats,
    beatUnit: m.beatUnit,
    bpm: Math.round(tempo),
    clef,
    tonicOctave: k.mode === "minor" ? inferTonicOctave(allPitches, k.key) : Math.floor(k.doMidi / 12) - 1,
    notes: main,
  };
  if (merged.size) score.changes = [...merged.values()].sort((a, b) => a.at - b.at);
  if (second) score.voice2 = second;
  const symbols = canonicalChordSymbols(chordMarks);
  if (symbols) score.chordSymbols = symbols;
  const rehearsals = canonicalRehearsals(rehearsalMarks);
  if (rehearsals) score.rehearsals = rehearsals;
  const fermatas = canonicalFermatas(fermataMarks);
  if (fermatas) score.fermatas = fermatas;
  const graduals = cleanGradualTempos(gradualMarks);
  if (graduals) (score as ScoreWithGradual).gradualTempos = graduals;
  return { score, losses, notes };
}
