/**
 * iReal Pro chord-chart links (`irealb://…`, the format its "分享 / 导出 HTML" produces): read the
 * first song of a link or playlist into a Score whose voice 1 is block chords, one per chord span,
 * with the chord names kept as chord symbols, plus 拍号、调、速度、反复、结尾、D.C./D.S./Coda/Fine.
 * Idea absorbed from iReal Pro (huge shared library of lead-sheet charts, played back as a band);
 * the link layout is a public community-documented format, no upstream code. See docs/ireal.md.
 */
import { CHANGE_BEAT_UNITS, CHANGE_BEATS_MAX, CHANGE_BPM_MAX, CHANGE_BPM_MIN } from "./score-timeline.ts";
import { inferTonicOctave, KEY_NAMES, type ChordSymbol, type KeyName, type Mode, type Score, type ScoreChange, type ScoreJumps, type ScoreNote, type ScoreRepeat } from "./theory.ts";
import { canonicalChordSymbols, parseChordSymbol, pitchClassOf, type ChordQuality } from "./chord-symbol.ts";
import { jumpProblem, repeatProblem } from "./repeats.ts";
import type { TextImport } from "./j123-import.ts";

const EPS = 1e-6;
const MUSIC_PREFIX = "1r34LbKcu7";
const LETTER_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const INTERVALS: Record<ChordQuality, number[]> = {
  major: [0, 4, 7],
  minor: [0, 3, 7],
  diminished: [0, 3, 6],
  augmented: [0, 4, 8],
  dominant: [0, 4, 7, 10],
  "major-seventh": [0, 4, 7, 11],
  "minor-seventh": [0, 3, 7, 10],
  "half-diminished": [0, 3, 6, 10],
  "diminished-seventh": [0, 3, 6, 9],
  "suspended-second": [0, 2, 7],
  "suspended-fourth": [0, 5, 7],
  power: [0, 7],
};

export type IrealSong = {
  title: string;
  composer: string;
  style: string;
  key: string;
  bpm: number;
  /** Unscrambled chart text. */
  chart: string;
};

/** Swap pass on one 50-char block; applying it twice gives the block back. */
function swap50(s: string): string {
  const out = s.split("");
  for (let i = 0; i < 5; i++) {
    out[49 - i] = s[i];
    out[i] = s[49 - i];
  }
  for (let i = 10; i < 24; i++) {
    out[49 - i] = s[i];
    out[i] = s[49 - i];
  }
  return out.join("");
}

/** iReal stores the chart in 50-char blocks with characters swapped; a block followed by < 2 chars is plain. */
export function unscrambleIreal(s: string): string {
  let out = "";
  let rest = s;
  while (rest.length > 50) {
    const block = rest.slice(0, 50);
    rest = rest.slice(50);
    out += rest.length < 2 ? block : swap50(block);
  }
  return out + rest;
}

/** Inverse of `unscrambleIreal` (same swap), used by tests to build links. */
export const scrambleIreal = unscrambleIreal;

/** All songs of the first `irealb://` link in the text (a bare link, a playlist, or iReal's exported HTML). */
export function parseIrealLink(text: string): { songs: IrealSong[]; playlist?: string } {
  if (/irealbook:\/\//.test(text) && !/irealb:\/\//.test(text)) throw new Error("这是旧版 irealbook:// 链接，请在 iReal Pro 里重新用「分享 → iReal Pro 格式」导出，现有谱未更改。");
  const hit = /irealb:\/\/([^"<>\s]+)/.exec(text);
  if (!hit) throw new Error("没找到 irealb:// 链接，现有谱未更改。");
  let decoded: string;
  try {
    decoded = decodeURIComponent(hit[1]);
  } catch {
    throw new Error("iReal 链接的编码不完整（可能复制时被截断），现有谱未更改。");
  }
  const parts = decoded.split("===");
  const playlist = parts.length > 1 ? parts.pop() : undefined;
  const songs: IrealSong[] = [];
  for (const raw of parts) {
    const at = raw.indexOf(MUSIC_PREFIX);
    if (at < 0) continue;
    const head = raw.slice(0, at).split("=").filter((x) => x !== "");
    const tail = raw.slice(at + MUSIC_PREFIX.length).split("=");
    const chart = unscrambleIreal(tail[0]);
    const after = tail.slice(1).filter((x) => x !== "");
    // Head: title, composer, style, key [, transpose]. Tail: [comp style,] bpm, repeats.
    const nums = after.filter((x) => /^\d+$/.test(x));
    songs.push({
      title: head[0] ?? "",
      composer: head[1] ?? "",
      style: head[2] ?? "",
      key: head[3] ?? "C",
      bpm: nums.length >= 2 ? Number(nums[nums.length - 2]) : 0,
      chart,
    });
  }
  if (!songs.length) throw new Error("iReal 链接里没有读得出的曲子，现有谱未更改。");
  return { songs, playlist: playlist?.trim() || undefined };
}

/** iReal chord spelling → the lead-sheet spelling the editor reads (C^7 → Cmaj7, C-7 → Cm7, Ch7 → Cm7b5 …). */
export function irealChordName(raw: string): string {
  const m = /^([A-G][b#]?)(.*?)(\/[A-G][b#]?)?$/.exec(raw);
  if (!m) return raw;
  let q = m[2].replace(/^\*(.*)\*$/, "$1");
  if (q === "^") q = "maj7";
  q = q
    .replace(/^-\^/, "mMaj")
    .replace(/^\^/, "maj")
    .replace(/^-/, "m")
    .replace(/^h7?/, "m7b5")
    .replace(/^o/, "dim");
  return `${m[1]}${q}${m[3] ?? ""}`;
}

function keyOf(raw: string): { key: KeyName; mode: Mode } | null {
  const m = /^([A-G])([b#]?)(-?)$/.exec(raw.trim());
  if (!m) return null;
  const pc = (LETTER_PC[m[1]] + (m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0) + 12) % 12;
  return { key: KEY_NAMES[pc] as KeyName, mode: m[3] ? "minor" : "major" };
}

function meterOf(digits: string): { beats: number; beatUnit: number } | null {
  if (digits === "12") return { beats: 12, beatUnit: 8 };
  if (digits.length !== 2) return null;
  const beats = Number(digits[0]);
  const beatUnit = Number(digits[1]);
  if (beats < 1 || beats > CHANGE_BEATS_MAX || !CHANGE_BEAT_UNITS.includes(beatUnit)) return null;
  return { beats, beatUnit };
}

/** Close-position block chord with its lowest note in G3…F#4; null when the name is unreadable. */
export function voiceChord(symbol: string): number[] | null {
  const parsed = parseChordSymbol(symbol);
  if (!parsed) return null;
  const root = pitchClassOf(parsed.root);
  const base = 55 + ((root - 7 + 12) % 12);
  const pitches = INTERVALS[parsed.quality].map((i) => base + i);
  if (parsed.bass) {
    const bass = pitchClassOf(parsed.bass);
    const low = 48 + ((bass - 0 + 12) % 12);
    if (!pitches.some((p) => p % 12 === bass)) pitches.unshift(low > base ? low - 12 : low);
    else pitches.unshift(low >= base ? low - 12 : low);
  }
  return [...new Set(pitches)].sort((a, b) => a - b);
}

type Cell = { chord?: string; nc?: boolean };
type Bar = {
  cells: Cell[];
  copyOf?: number;
  meter?: { beats: number; beatUnit: number };
  openRepeat?: boolean;
  closeRepeat?: boolean;
  ending?: number;
  /** A double / final bar line closes this bar. */
  hardEnd?: boolean;
  segno?: boolean;
  coda?: boolean;
  /** Coda sign written after this bar's chords: the "To Coda" jump is at its end. */
  codaAtEnd?: boolean;
  fine?: boolean;
  dc?: boolean;
  ds?: boolean;
};

const CHORD_RE = /^[A-G][b#]?(\*[^*]*\*|[+\-^\dhob#suadltiMj]*)(\/[A-G][b#]?)?/;

const b0 = (b: Bar) => b.copyOf === undefined && b.cells.every((c) => !c.chord && !c.nc);

/** Tokenise an unscrambled chart into bars of cells (a chord, N.C. or an empty slot). */
export function irealBars(chart: string): { bars: Bar[]; skipped: { alt: number; comments: string[]; unknown: number } } {
  const s = chart.replace(/XyQ/g, "   ").replace(/Kcl/g, "|x").replace(/LZ/g, "|");
  const bars: Bar[] = [];
  const skipped = { alt: 0, comments: [] as string[], unknown: 0 };
  let cur: Bar = { cells: [] };
  const has = (b: Bar) => b.cells.length > 0 || b.copyOf !== undefined;
  const marked = (b: Bar) => Object.keys(b).length > 1;
  const close = () => {
    if (!has(cur)) return;
    // Trailing XyQ after `}` / `]` only pads iReal's 16-cell grid line: drop a bar of empty cells with no marks.
    if (b0(cur) && !marked(cur)) {
      cur = { cells: [] };
      return;
    }
    bars.push(cur);
    cur = { cells: [] };
  };
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    const rest = s.slice(i);
    if (c === "<") {
      const end = s.indexOf(">", i);
      // `*NN` in front of a comment is only its vertical offset.
      const text = s.slice(i + 1, end < 0 ? s.length : end).replace(/^\*\d*/, "").trim();
      i = end < 0 ? s.length : end + 1;
      const low = text.toLowerCase();
      if (/^d\.?\s*c\.?/.test(low)) cur.dc = true;
      else if (/^d\.?\s*s\.?/.test(low)) cur.ds = true;
      else if (low === "fine") cur.fine = true;
      else if (text) skipped.comments.push(text);
      continue;
    }
    if (c === "(") {
      const end = s.indexOf(")", i);
      i = end < 0 ? s.length : end + 1;
      skipped.alt++;
      continue;
    }
    if (c === "*" && /^\*[A-Za-z]/.test(rest)) {
      i += 2;
      continue;
    }
    const t = /^T(12|\d\d)/.exec(rest);
    if (t) {
      const m = meterOf(t[1]);
      if (m) cur.meter = m;
      else skipped.comments.push(`拍号 T${t[1]}`);
      i += t[0].length;
      continue;
    }
    const n = /^N(\d)/.exec(rest);
    if (n) {
      cur.ending = Number(n[1]);
      i += 2;
      continue;
    }
    if (c === "{") {
      close();
      cur.openRepeat = true;
      i++;
      continue;
    }
    if (c === "}") {
      cur.closeRepeat = true;
      cur.hardEnd = true;
      close();
      i++;
      continue;
    }
    if (c === "|" || c === "[") {
      close();
      i++;
      continue;
    }
    if (c === "]" || c === "Z") {
      cur.hardEnd = true;
      if ((!has(cur) || (b0(cur) && Object.keys(cur).length <= 2)) && bars.length) bars[bars.length - 1].hardEnd = true;
      close();
      i++;
      continue;
    }
    if (c === "x") {
      cur.copyOf = bars.length - 1;
      i++;
      continue;
    }
    if (c === "r") {
      const a = bars.length - 2;
      cur.copyOf = a;
      close();
      cur = { cells: [], copyOf: a + 1 };
      i++;
      if (s[i] === "|") i++;
      while (s[i] === " ") i++;
      continue;
    }
    if (c === "S") {
      cur.segno = true;
      i++;
      continue;
    }
    if (c === "Q") {
      // Bar-start coda: nothing played yet in this bar; otherwise "To Coda" at its end.
      if (cur.cells.some((x) => x.chord || x.nc)) cur.codaAtEnd = true;
      else cur.coda = true;
      i++;
      continue;
    }
    if (c === " " || c === "p") {
      cur.cells.push({});
      i++;
      continue;
    }
    if (c === "n") {
      cur.cells.push({ nc: true });
      i++;
      continue;
    }
    if (c === "W") {
      const w = /^W(\/[A-G][b#]?)?/.exec(rest)!;
      cur.cells.push({});
      i += w[0].length;
      continue;
    }
    const chord = CHORD_RE.exec(rest);
    if (chord) {
      cur.cells.push({ chord: chord[0] });
      i += chord[0].length;
      continue;
    }
    if (!",YUfsl\n\r\t".includes(c)) skipped.unknown++;
    i++;
  }
  close();
  return { bars, skipped };
}

/** Split `total` quarters among chord spans by cell count, snapped to sixteenth notes. */
function spans(cellsBefore: number[], cells: number, total: number): number[] {
  const grid = 0.25;
  const steps = Math.round(total / grid);
  const cuts = cellsBefore.map((c) => Math.round((c / cells) * steps));
  cuts.push(steps);
  const out: number[] = [];
  for (let k = 0; k < cuts.length - 1; k++) out.push((cuts[k + 1] - cuts[k]) * grid);
  if (out.some((d) => d <= 0)) return cellsBefore.map(() => total / cellsBefore.length);
  return out;
}

export function importIreal(input: string | Uint8Array): TextImport {
  const text = typeof input === "string" ? input : new TextDecoder("utf-8").decode(input).replace(/^\uFEFF/, "");
  const { songs, playlist } = parseIrealLink(text);
  const song = songs[0];
  const losses: string[] = [];
  const notes: string[] = ["iReal 和弦谱会替换整谱：声部 1 写成柱式和弦，和弦名保留为和弦标记"];
  if (songs.length > 1) notes.push(`${playlist ? `歌单「${playlist}」` : "歌单"}共 ${songs.length} 首，只导入第一首《${song.title || "未命名"}》`);
  const k = keyOf(song.key);
  if (!k) losses.push(`调「${song.key}」，按 C 大调读入`);
  const key = k?.key ?? "C";
  const mode = k?.mode ?? "major";
  let bpm = song.bpm;
  if (!bpm) {
    bpm = 120;
    notes.push("链接未写速度，采用 ♩=120");
  } else if (bpm < CHANGE_BPM_MIN || bpm > CHANGE_BPM_MAX) {
    const clamped = Math.min(CHANGE_BPM_MAX, Math.max(CHANGE_BPM_MIN, bpm));
    losses.push(`速度 ${bpm} 超出范围，改为 ${clamped}`);
    bpm = clamped;
  }
  if (song.style) notes.push(`风格「${song.style}」只作说明，不改变伴奏`);
  if (song.composer && song.composer !== "Composer Unknown") notes.push(`作曲：${song.composer.split(" ").reverse().join(" ")}`);

  const { bars, skipped } = irealBars(song.chart);
  if (!bars.length) throw new Error("这首 iReal 曲子里没有读得出的小节，现有谱未更改。");
  if (skipped.alt) losses.push(`括号里的替代和弦 ${skipped.alt} 个`);
  if (skipped.comments.length) losses.push(`注释文字（${[...new Set(skipped.comments)].slice(0, 3).join("、")}${skipped.comments.length > 3 ? "…" : ""}）`);
  if (skipped.unknown) losses.push(`读不懂的记号 ${skipped.unknown} 处`);

  const first = bars[0].meter ?? { beats: 4, beatUnit: 4 };
  let meter = first;
  const main: ScoreNote[] = [];
  const marks: ChordSymbol[] = [];
  const changes: ScoreChange[] = [];
  const starts: number[] = [];
  let at = 0;
  let last: number[] = [];
  let lastName = "";
  const unread = new Set<string>();
  const resolved: Cell[][] = [];
  bars.forEach((bar, b) => {
    let cells = bar.cells;
    if (bar.copyOf !== undefined) cells = bar.copyOf >= 0 && bar.copyOf < b ? resolved[bar.copyOf] : [];
    resolved.push(cells);
    if (bar.meter && b > 0 && (bar.meter.beats !== meter.beats || bar.meter.beatUnit !== meter.beatUnit)) {
      changes.push({ at, beats: bar.meter.beats, beatUnit: bar.meter.beatUnit });
    }
    if (bar.meter) meter = bar.meter;
    const total = (meter.beats * 4) / meter.beatUnit;
    starts.push(at);
    const hits: number[] = [];
    cells.forEach((cell, c) => {
      if (cell.chord || cell.nc) hits.push(c);
    });
    if (!hits.length) {
      main.push({ pitches: [...last], dur: total });
      at += total;
      return;
    }
    const lead = hits[0] > 0;
    const before = lead ? [0, ...hits] : hits;
    const durs = spans(before, cells.length, total);
    durs.forEach((dur, j) => {
      const cell = lead ? (j === 0 ? undefined : cells[hits[j - 1]]) : cells[hits[j]];
      if (!cell) {
        main.push({ pitches: [...last], dur });
      } else if (cell.nc) {
        last = [];
        lastName = "";
        main.push({ pitches: [], dur });
      } else {
        const name = irealChordName(cell.chord!);
        const pitches = voiceChord(name);
        if (pitches) {
          // A repeated bar (x / %) or a re-struck same chord adds no new symbol.
          if (name !== lastName) marks.push({ at, symbol: name });
          last = pitches;
          lastName = name;
        } else {
          unread.add(cell.chord!);
        }
        main.push({ pitches: [...last], dur });
      }
      at += dur;
    });
  });
  if (unread.size) losses.push(`读不懂的和弦（${[...unread].slice(0, 3).join("、")}${unread.size > 3 ? "…" : ""}），沿用前一个和弦`);
  const end = at;
  const barEnd = (b: number) => starts[b + 1] ?? end;

  const score: Score = {
    title: (song.title || "iReal 导入").slice(0, 80),
    key,
    mode,
    beats: first.beats,
    beatUnit: first.beatUnit,
    bpm: Math.round(bpm),
    clef: "treble",
    tonicOctave: inferTonicOctave(main.flatMap((n) => n.pitches), key),
    notes: main,
  };
  if (changes.length) score.changes = changes;
  const symbols = canonicalChordSymbols(marks);
  if (symbols) score.chordSymbols = symbols;

  // Repeats: { … } with N1 / N2 endings.
  const repeats: ScoreRepeat[] = [];
  let open: number | null = null;
  let ending1: number | undefined;
  let lastClose = 0;
  for (let b = 0; b < bars.length; b++) {
    const bar = bars[b];
    if (bar.openRepeat) {
      open = starts[b];
      ending1 = undefined;
    }
    if (bar.ending === 1) ending1 = starts[b];
    if (bar.ending !== undefined && bar.ending > 2) losses.push("第三及以后的结尾");
    if (bar.closeRepeat) {
      const from = open ?? lastClose;
      const to = barEnd(b);
      const r: ScoreRepeat = { from, to };
      if (ending1 !== undefined && ending1 > from + EPS && ending1 < to - EPS) {
        r.ending = ending1;
        // 2nd ending runs from `to` to the next double / final bar (or the bar after when none).
        if (b + 1 < bars.length) {
          let e = b + 1;
          while (e < bars.length - 1 && !bars[e].hardEnd && !bars[e + 1].openRepeat) e++;
          r.endingEnd = barEnd(e);
        }
      }
      if (to > from + EPS) repeats.push(r);
      open = null;
      ending1 = undefined;
      lastClose = to;
    }
  }
  if (repeats.length) {
    const problem = repeatProblem(score, repeats);
    if (problem) losses.push(`反复记号（${problem.replace(/。$/, "")}）`);
    else score.repeats = repeats;
  }

  // Jumps: S segno, first Q "To Coda", second Q coda, <Fine>, <D.C./D.S. al …>.
  const jumps: ScoreJumps = {};
  let codaSeen = 0;
  bars.forEach((bar, b) => {
    if (bar.segno && jumps.segno === undefined) jumps.segno = starts[b];
    for (const kind of [bar.coda ? "start" : null, bar.codaAtEnd ? "end" : null]) {
      if (!kind) continue;
      codaSeen++;
      if (codaSeen === 1) jumps.toCoda = kind === "end" ? barEnd(b) : starts[b];
      else if (codaSeen === 2) jumps.coda = starts[b];
    }
    if (bar.fine && jumps.fine === undefined) jumps.fine = barEnd(b);
    if (bar.dc && jumps.dc === undefined && jumps.ds === undefined) jumps.dc = barEnd(b);
    if (bar.ds && jumps.dc === undefined && jumps.ds === undefined) jumps.ds = barEnd(b);
  });
  if (jumps.toCoda !== undefined && jumps.coda === undefined) delete jumps.toCoda;
  // iReal plays a chart with codas but no written D.C. as "back to the top, take the coda on the last time".
  let implicit = false;
  if (jumps.coda !== undefined && jumps.toCoda !== undefined && jumps.dc === undefined && jumps.ds === undefined) {
    jumps.dc = jumps.coda;
    implicit = true;
  }
  if (Object.keys(jumps).length) {
    const problem = jumpProblem(score, jumps);
    if (problem) losses.push(`跳转记号（${problem.replace(/。$/, "")}）`);
    else {
      score.jumps = jumps;
      if (implicit) notes.push("有 Coda 没写 D.C.，按 iReal 的习惯补一个 D.C. al Coda（Coda 前回到开头）");
    }
  }
  return { score, losses, notes };
}
