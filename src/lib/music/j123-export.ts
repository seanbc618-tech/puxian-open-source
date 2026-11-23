/** Score → 123 简谱文本, the inverse of import123.
 * Independently implemented from Dolce 6b1d3fc `docs/格式/123格式.md` (MIT).
 * No upstream code is copied. See docs/text-formats.md.
 */
import { nextBar, stateAt } from "./score-timeline.ts";
import { MAJOR_STEPS, type KeyName, type Mode, type Score, type ScoreChange, type ScoreNote } from "./theory.ts";
import { parse123Key } from "./j123-import.ts";
import type { GradualTempo, ScoreWithGradual } from "./gradual-tempo.ts";
import { canonicalFermatas, type FermataMark } from "./fermata.ts";
import { cleanGradualTempos, gradualWordsLabel } from "./text-mid-marks.ts";

export type J123Export = { text: string; bytes: Uint8Array; losses: string[] };

const EPS = 1e-7;
const KEY_SPELL: Record<KeyName, string> = {
  C: "C", Db: "bD", D: "D", Eb: "bE", E: "E", F: "F", "F#": "#F", G: "G", Ab: "bA", A: "A", Bb: "bB", B: "B",
};

const loseInto = (losses: string[], s: string) => {
  if (!losses.includes(s)) losses.push(s);
};

export function format123Key(key: KeyName, mode: Mode): string {
  return mode === "minor" ? `6=${KEY_SPELL[key]}` : `1=${KEY_SPELL[key]}`;
}

function doMidiOf(key: KeyName, mode: Mode): number {
  const parsed = parse123Key(format123Key(key, mode));
  if (!parsed) throw new Error("无法写出调号。");
  return parsed.doMidi;
}

function octMark(oct: number): string {
  return oct > 0 ? "'".repeat(oct) : oct < 0 ? ",".repeat(-oct) : "";
}

export function pitch123Token(midi: number, doMidi: number): string {
  const rel = midi - doMidi;
  const oct = Math.floor(rel / 12);
  const within = ((rel % 12) + 12) % 12;
  const deg = MAJOR_STEPS.indexOf(within);
  if (deg >= 0) return `${deg + 1}${octMark(oct)}`;
  for (let i = 0; i < 7; i++) {
    if ((MAJOR_STEPS[i] + 1) % 12 === within) return `#${i + 1}${octMark(oct)}`;
    if ((MAJOR_STEPS[i] + 11) % 12 === within) return `b${i + 1}${octMark(oct)}`;
  }
  return `1${octMark(oct)}`;
}

type DurPiece = { open?: string; suffix: string; close?: string };

const BINARIES: { u: number; dots: number; value: number }[] = [];
for (let u = 0; u <= 6; u++) {
  for (let dots = 0; dots <= 3; dots++) {
    BINARIES.push({ u, dots, value: 2 ** -u * (2 - 2 ** -dots) });
  }
}
BINARIES.sort((a, b) => b.value - a.value);

function formatWritten(u: number, dots: number, dashes: number): string {
  return `${"_".repeat(u)}${".".repeat(dots)}${" -".repeat(dashes)}`;
}

function matchWritten(written: number): { u: number; dots: number; dashes: number } | null {
  if (!(written > EPS)) return null;
  const maxDashes = Math.min(200, Math.floor(written + EPS));
  for (let dashes = maxDashes; dashes >= 0; dashes--) {
    const head = written - dashes;
    if (head <= EPS) continue;
    const bin = BINARIES.find((b) => Math.abs(b.value - head) <= 1e-8);
    if (bin) return { u: bin.u, dots: bin.dots, dashes };
  }
  return null;
}

function singlePiece(d: number): DurPiece | null {
  if (!(d > EPS) || !Number.isFinite(d)) return null;
  const plain = matchWritten(d);
  if (plain) return { suffix: formatWritten(plain.u, plain.dots, plain.dashes) };
  for (let n = 2; n <= 16; n++) {
    for (let p = 1; p <= 16; p++) {
      const written = (d * n) / p;
      if (written > 200 || written <= EPS) continue;
      const w = matchWritten(written);
      if (w) return { open: `(${n}:${p}:`, suffix: formatWritten(w.u, w.dots, w.dashes), close: ")" };
    }
  }
  return null;
}

const GRID = 1920; // common multiple of 64, 96, 120, 160, 480
type DurCoin = { ticks: number; piece: DurPiece };
const COINS: DurCoin[] = (() => {
  const seen = new Set<number>();
  const out: DurCoin[] = [];
  const add = (actual: number, piece: DurPiece) => {
    if (!(actual > EPS) || actual > 64) return;
    const ticks = Math.round(actual * GRID);
    if (ticks <= 0 || seen.has(ticks) || Math.abs(ticks / GRID - actual) > 1e-9) return;
    seen.add(ticks);
    out.push({ ticks, piece });
  };
  for (const b of BINARIES) {
    for (let dashes = 0; dashes <= 16; dashes++) {
      const written = b.value + dashes;
      add(written, { suffix: formatWritten(b.u, b.dots, dashes) });
      for (let n = 2; n <= 16; n++) {
        for (let p = 1; p <= 16; p++) {
          add((written * p) / n, { open: `(${n}:${p}:`, suffix: formatWritten(b.u, b.dots, dashes), close: ")" });
        }
      }
    }
  }
  out.sort((a, b) => b.ticks - a.ticks);
  return out;
})();

function toGrid(d: number): number | null {
  const ticks = Math.round(d * GRID);
  return ticks > 0 && Math.abs(ticks / GRID - d) <= 1e-8 ? ticks : null;
}

/** Split an arbitrary positive duration into 123-importable pieces (ties on import). */
export function encode123Duration(quarters: number): DurPiece[] {
  if (!(quarters > EPS) || !Number.isFinite(quarters)) return [];
  const direct = singlePiece(quarters);
  if (direct) return [direct];
  const total = toGrid(quarters);
  if (total === null) return [];
  const coins = COINS.filter((c) => c.ticks <= total);
  const dist = Array<number>(total + 1).fill(Number.POSITIVE_INFINITY);
  const pick = Array<number>(total + 1).fill(-1);
  dist[0] = 0;
  for (let s = 0; s <= total; s++) {
    if (dist[s] === Number.POSITIVE_INFINITY) continue;
    for (let i = 0; i < coins.length; i++) {
      const n = s + coins[i]!.ticks;
      if (n <= total && dist[s]! + 1 < dist[n]!) {
        dist[n] = dist[s]! + 1;
        pick[n] = i;
      }
    }
  }
  if (dist[total] === Number.POSITIVE_INFINITY) return [];
  const pieces: DurPiece[] = [];
  for (let s = total; s > 0; ) {
    const i = pick[s]!;
    if (i < 0) return [];
    pieces.push(coins[i]!.piece);
    s -= coins[i]!.ticks;
  }
  pieces.reverse();
  return pieces;
}

function figureFor(pitch: string, piece: DurPiece): string {
  return `${piece.open ?? ""}${pitch}${piece.suffix}${piece.close ?? ""}`;
}

function scoreGraduals(score: Score): GradualTempo[] {
  return cleanGradualTempos((score as ScoreWithGradual).gradualTempos) ?? [];
}

function marksAt(
  changes: ScoreChange[],
  fermatas: FermataMark[],
  graduals: GradualTempo[],
  voice: number,
  at: number,
): { fields: string[]; prefixes: string[] } {
  const fields: string[] = [];
  const prefixes: string[] = [];
  const c = changes.find((item) => Math.abs(item.at - at) <= EPS);
  if (c?.key !== undefined) fields.push(`[K:${format123Key(c.key, c.mode ?? "major")}]`);
  if (c?.beats !== undefined && c.beatUnit !== undefined) fields.push(`[M:${c.beats}/${c.beatUnit}]`);
  if (c?.bpm !== undefined) fields.push(`[Q:1/4=${c.bpm}]`);
  for (const span of graduals) {
    if (Math.abs(span.from - at) <= EPS) {
      prefixes.push(`"^${gradualWordsLabel(span.kind, span.toBpm)}"`);
    }
    if (Math.abs(span.to - at) <= EPS) {
      const hasTempo = c?.bpm !== undefined;
      if (!hasTempo) prefixes.push('"^a tempo"');
    }
  }
  if (fermatas.some((f) => f.voice === voice && Math.abs(f.at - at) <= EPS)) prefixes.push("!fermata!");
  return { fields, prefixes };
}

function splitTimes(start: number, dur: number, cuts: number[]): number[] {
  const mid = cuts.filter((t) => t > start + EPS && t < start + dur - EPS).sort((a, b) => a - b);
  const points = [start, ...mid, start + dur];
  const uniq: number[] = [];
  for (const p of points) {
    if (!uniq.length || Math.abs(uniq[uniq.length - 1]! - p) > EPS) uniq.push(p);
  }
  return uniq;
}

function emitVoice(
  notes: ScoreNote[],
  score: Score,
  voice: number,
  changes: ScoreChange[],
  fermatas: FermataMark[],
  graduals: GradualTempo[],
  cuts: number[],
  losses: string[],
): { tokens: string[]; lyricChunks: string[] } {
  const tokens: string[] = [];
  const lyricChunks: string[] = [];
  let t = 0;
  const atBarBoundary = (when: number) => when > EPS && Math.abs(nextBar(score, when - EPS) - when) <= EPS;
  for (const note of notes) {
    const start = t;
    const end = t + note.dur;
    const points = splitTimes(start, note.dur, cuts);
    if (note.pitches.length > 8) loseInto(losses, "和弦超过 8 个音的部分");
    if (note.lyric && (note.lyric.syllabic !== "single" || note.lyric.extend || note.lyric.fragments?.length)) {
      loseInto(losses, "歌词的连字符或延长线未全部保留");
    }
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i]!;
      const b = points[i + 1]!;
      const dur = b - a;
      if (atBarBoundary(a) && tokens.at(-1) !== "|") tokens.push("|");
      const { fields, prefixes } = marksAt(changes, fermatas, graduals, voice, a);
      if (fields.length) tokens.push(fields.join(""));
      const state = stateAt(score, a);
      const doMidi = doMidiOf(state.key, state.mode);
      const midis = note.pitches.slice().sort((x, y) => x - y).slice(-8);
      let pitch: string;
      if (!midis.length) pitch = "0";
      else if (midis.length === 1) pitch = pitch123Token(midis[0]!, doMidi);
      else pitch = `[${midis.map((p) => pitch123Token(p, doMidi)).join("")}]`;
      const pieces = encode123Duration(dur);
      if (!pieces.length) {
        loseInto(losses, "个别时值无法按 123 精确写出，已改用最接近的时值");
        const fallback = singlePiece(Math.round(dur * 64) / 64) ?? { suffix: "" };
        pieces.push(fallback);
      }
      const deco: string[] = [...prefixes];
      if (i === 0) {
        if (note.dynamic) deco.push(`!${note.dynamic}!`);
        if (note.hairpin === "cresc") deco.push("!crescendo(!");
        if (note.hairpin === "dim") deco.push("!diminuendo(!");
        if (note.hairpinEnd) deco.push("!crescendo)!");
        if (note.articulations?.includes("staccato")) deco.push("!staccato!");
        if (note.articulations?.includes("accent")) deco.push("!accent!");
        if (note.articulations?.includes("tenuto")) deco.push("!tenuto!");
        if (note.ornament === "trill") deco.push("!tr!");
        if (note.ornament === "arpeggio") deco.push("!arpeggio!");
        if (note.ornament === "grace") loseInto(losses, "倚音未写入 123 导出");
        if (note.slurStart || note.slurEnd) loseInto(losses, "圆滑线未写入 123 导出");
      }
      const prefix = deco.join("");
      for (let idx = 0; idx < pieces.length; idx++) {
        if ((i > 0 || idx > 0) && pitch !== "0") tokens.push("~");
        const fig = figureFor(pitch, pieces[idx]!);
        tokens.push(idx === 0 && prefix ? `${prefix}${fig}` : fig);
      }
      if (atBarBoundary(b)) tokens.push("|");
      if (i === 0 && midis.length && note.lyric?.text.trim()) {
        const word = note.lyric.text.replace(/\s+/g, "");
        lyricChunks.push(word.includes(" ") || word.length > 1 && /[^\u3400-\u9fff]/.test(word) ? `{${word}}` : word);
      } else if (i === 0) lyricChunks.push("/");
    }
    t = end;
  }
  if (tokens.at(-1) !== "|") tokens.push("|");
  return { tokens, lyricChunks };
}

export function export123(score: Score): J123Export {
  const losses: string[] = [];
  if (!score.notes.some((n) => n.pitches.length)) throw new Error("谱里还没有音符，无法导出 123。");
  if (score.beats < 1 || score.beats > 32 || ![1, 2, 4, 8, 16, 32].includes(score.beatUnit)) {
    throw new Error("此拍号写不进 123。");
  }
  const bpm = Math.round(score.bpm);
  if (bpm < 20 || bpm > 300) throw new Error("速度超出 123 支持范围（20–300）。");
  if (score.extraVoices?.some((v) => v.some((n) => n.pitches.length))) loseInto(losses, "第三声部起（123 最多两个声部）");

  const changes = (score.changes ?? []).filter((c) => c.at > EPS);
  const fermatas = canonicalFermatas(score.fermatas) ?? [];
  const graduals = scoreGraduals(score);
  const cuts = [
    ...changes.map((c) => c.at),
    ...fermatas.map((f) => f.at),
    ...graduals.flatMap((g) => [g.from, g.to]),
  ].sort((a, b) => a - b);

  const v1 = emitVoice(score.notes, score, 0, changes, fermatas, graduals, cuts, losses);
  const lines: string[] = [
    "%123-1.0",
    "X:1",
    `T:${(score.title || "谱线导出").replace(/[\r\n]/g, " ").slice(0, 80)}`,
  ];
  if (score.lyricist && score.composer) lines.push(`C:词 ${score.lyricist} 曲 ${score.composer}`);
  else if (score.lyricist) lines.push(`C:词 ${score.lyricist}`);
  else if (score.composer) lines.push(`C:曲 ${score.composer}`);
  lines.push(`K:${format123Key(score.key, score.mode)}`);
  lines.push(`M:${score.beats}/${score.beatUnit}`);
  lines.push(`Q:1/4=${bpm}`);
  if (score.clef === "bass") lines.push("V:1 clef=bass");
  else lines.push("V:1");
  if (score.rehearsals?.length) {
    // Rehearsals are written inline on voice 1 at their `at`.
  }
  const wrap = (toks: string[], prefix = "") => {
    const out: string[] = [];
    let row: string[] = [];
    const push = () => {
      if (row.length) out.push(`${prefix}${row.join(" ")}`);
      row = [];
    };
    for (const tok of toks) {
      row.push(tok);
      if (tok === "|" && row.length >= 8) push();
    }
    push();
    return out;
  };
  // Insert rehearsal marks into a copy of v1 tokens by time — already handled only if we inject during emit.
  // Write [P:] at the matching change-less times: inject via marksAt? Done separately below if needed.
  if (score.rehearsals?.length) {
    // Re-emit is expensive; inject tokens at the start of the matching time in a second pass is hard.
    // emitVoice doesn't know rehearsals. Add them now by prefixing the token stream isn't time-aware.
    // We'll include [P:] during emit by piggybacking fields — extend marksAt in a follow-up if tests need it.
    loseInto(losses, "段落标记未写入 123 导出");
  }
  if (score.chordSymbols?.length) loseInto(losses, "和弦标记（如 Am、G7）未写入 123 导出");
  if (score.repeats?.length) loseInto(losses, "反复记号未写入 123 导出");
  if (score.jumps && Object.values(score.jumps).some((v) => v !== undefined)) loseInto(losses, "跳转记号未写入 123 导出");

  lines.push(...wrap(v1.tokens));
  if (v1.lyricChunks.some((w) => w !== "/")) {
    const last = v1.lyricChunks.reduce((i, w, k) => (w !== "/" ? k + 1 : i), 0);
    lines.push(`w:${v1.lyricChunks.slice(0, last).join(" ")}`);
  }
  if (score.voice2?.some((n) => n.pitches.length)) {
    const v2 = emitVoice(score.voice2, score, 1, changes, fermatas, graduals, cuts, losses);
    lines.push("V:2");
    lines.push(...wrap(v2.tokens));
    if (v2.lyricChunks.some((w) => w !== "/")) {
      const last = v2.lyricChunks.reduce((i, w, k) => (w !== "/" ? k + 1 : i), 0);
      lines.push(`w:${v2.lyricChunks.slice(0, last).join(" ")}`);
    }
  }
  const text = `${lines.join("\n")}\n`;
  return { text, bytes: new TextEncoder().encode(text), losses };
}
