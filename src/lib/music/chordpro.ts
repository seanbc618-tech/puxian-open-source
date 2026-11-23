/**
 * ChordPro (chordpro.org) lead-sheet text, after OnSong / SongbookPro: lyrics with [chords]
 * inline. Export writes voice 1's lyrics and the chord symbols; "套用" puts a ChordPro song's
 * words and chords onto the melody already written. Idea only, no upstream code; see docs/chordpro.md.
 */
import { canonicalChordSymbols, parseChordSymbol } from "./chord-symbol.ts";
import { barStarts } from "./practice.ts";
import type { ChordSymbol, KeyName, Mode, Score, ScoreNote } from "./theory.ts";

const EPS = 1e-6;
const CLOSING = "，。！？；：、,.!?;:）)」』》";
const isCjk = (ch: string) => /[\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff]/.test(ch);

const MINOR_NAMES: Record<string, string> = { Db: "C#", Ab: "G#" };
function keyText(key: KeyName, mode: Mode): string {
  return mode === "minor" ? `${MINOR_NAMES[key] ?? key}m` : key;
}

/** Plain-text ChordPro of voice 1: one line per phrase (punctuation) or four bars. */
export function exportChordPro(score: Score): { text: string; losses: string[] } {
  const losses: string[] = [];
  const lose = (s: string) => void (losses.includes(s) || losses.push(s));
  if (score.voice2?.some((n) => n.lyric?.text)) lose("声部二的歌词");
  const starts = [...barStarts(score), Infinity];
  const symbols = [...(score.chordSymbols ?? [])].sort((a, b) => a.at - b.at);
  let next = 0;
  const lines: string[] = [];
  let line = "";
  let barsInLine = 0;
  let lineHasText = false;
  let q = 0;
  let bar = 0;
  const flush = () => {
    const trimmed = line.trim();
    if (trimmed) lines.push(trimmed);
    line = "";
    barsInLine = 0;
    lineHasText = false;
  };
  const notes = score.notes;
  for (let i = 0; i < notes.length; i++) {
    const n = notes[i];
    const end = q + n.dur;
    let chords = "";
    while (next < symbols.length && symbols[next].at < end - EPS) chords += `[${symbols[next++].symbol}]`;
    const ly = n.pitches.length ? n.lyric : undefined;
    const text = ly && !ly.extend ? ly.text : "";
    if (chords && !text && line && !/\s$/.test(line)) line += " ";
    line += chords;
    if (text) {
      line += text;
      lineHasText = true;
      const joined = ly!.syllabic === "begin" || ly!.syllabic === "middle";
      const last = text.at(-1) ?? "";
      if (joined) line += "-";
      else if (!isCjk(last) || CLOSING.includes(last)) line += " ";
    } else if (chords) line += " ";
    q = end;
    while (starts[bar + 1] <= q + EPS) {
      bar++;
      barsInLine++;
    }
    const endsPhrase = text && CLOSING.includes(text.at(-1) ?? "");
    if (endsPhrase || barsInLine >= (lineHasText ? 8 : 4)) flush();
  }
  // Chords after the last note.
  while (next < symbols.length) line += ` [${symbols[next++].symbol}]`;
  flush();
  const head = [`{title: ${score.title.replace(/[{}\n]/g, " ").trim() || "谱线"}}`, `{key: ${keyText(score.key, score.mode)}}`, `{time: ${score.beats}/${score.beatUnit}}`, ...(score.tempoMarked === false ? [] : [`{tempo: ${Math.round(score.bpm)}}`])];
  if (!lines.length) lose("这首还没有歌词和和弦名");
  return { text: [...head, "", ...lines, ""].join("\n"), losses };
}

type Token = { kind: "chord"; symbol: string } | { kind: "syllable"; text: string; syllabic: "single" | "begin" | "middle" | "end" } | { kind: "eol" };

/** Reads ChordPro (or chords-in-brackets text) into words and chords, in order. */
export function parseChordPro(text: string): { title?: string; key?: string; tokens: Token[]; losses: string[] } {
  const losses: string[] = [];
  const lose = (s: string) => void (losses.includes(s) || losses.push(s));
  const tokens: Token[] = [];
  let title: string | undefined;
  let key: string | undefined;
  for (const raw of text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const directive = /^\{\s*([\w-]+)\s*(?::\s*(.*?))?\s*\}$/.exec(line);
    if (directive) {
      const [, name, value] = directive;
      const n = name.toLowerCase();
      if ((n === "title" || n === "t") && value) title = value;
      else if (n === "key" && value) key = value;
      else if (!/^(subtitle|st|artist|composer|time|tempo|capo|comment|c|ci|cb|start_of_\w+|end_of_\w+|so\w|eo\w|chorus)$/.test(n)) lose(`指令 {${name}}`);
      continue;
    }
    let word = "";
    let continued = false;
    const flushWord = (hyphen: boolean) => {
      if (!word) return;
      tokens.push({ kind: "syllable", text: word, syllabic: continued ? (hyphen ? "middle" : "end") : hyphen ? "begin" : "single" });
      word = "";
      continued = hyphen;
    };
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === "[") {
        const close = line.indexOf("]", i);
        if (close < 0) {
          lose("没闭合的 [");
          break;
        }
        const symbol = line.slice(i + 1, close).trim();
        i = close;
        if (!symbol) continue;
        // A chord inside a word is pushed before the (not yet pushed) word, so it sits on that word's note.
        if (word) lose("词中间的和弦（放到这个词开头）");
        tokens.push({ kind: "chord", symbol });
      } else if (c === " " || c === "\t") flushWord(false);
      else if (c === "-" && word && !isCjk(word)) flushWord(true);
      else if (isCjk(c)) {
        flushWord(false);
        tokens.push({ kind: "syllable", text: c, syllabic: "single" });
        continued = false;
      } else if (CLOSING.includes(c) || "“‘「『《（(".includes(c)) {
        // Punctuation rides on the neighbouring syllable.
        if (word) word += c;
        else {
          const prev = [...tokens].reverse().find((t) => t.kind === "syllable" || t.kind === "eol");
          if (prev?.kind === "syllable" && CLOSING.includes(c)) prev.text += c;
          else word += c;
        }
      } else word += c;
    }
    flushWord(false);
    tokens.push({ kind: "eol" });
  }
  return { title, key, tokens, losses };
}

/**
 * Puts a ChordPro song's words and chords on voice 1: one syllable per sounding note in order
 * (CJK one character each, other scripts one word or hyphen-split syllable each). A chord sits at the
 * note of the syllable after it; a line of chords alone takes one bar each. Replaces voice 1's lyrics
 * and all chord symbols.
 */
export function applyChordPro(score: Score, text: string): { score: Score; losses: string[]; notes: string[]; syllables: number; chords: number } {
  const parsed = parseChordPro(text);
  const losses = [...parsed.losses];
  const lose = (s: string) => void (losses.includes(s) || losses.push(s));
  const notes: string[] = ["会替换声部一的歌词和全部和弦名，可撤销"];
  const melody: ScoreNote[] = score.notes.map((n) => {
    const { lyric: _lyric, ...rest } = n;
    void _lyric;
    return rest;
  });
  const startOf: number[] = [];
  let q = 0;
  for (const n of melody) {
    startOf.push(q);
    q += n.dur;
  }
  const total = q;
  const sounding = melody.map((n, i) => (n.pitches.length ? i : -1)).filter((i) => i >= 0);
  if (!sounding.length) throw new Error("先写好旋律，再把 ChordPro 的歌词和和弦套上去。");
  const bars = barStarts(score);
  const chords: ChordSymbol[] = [];
  let cursor = 0; // next sounding note to take a syllable
  let pending: string[] = [];
  let lineHasSyllable = false;
  let lineChords: string[] = [];
  let syllables = 0;
  let overflow = 0;
  const atCursor = () => (cursor < sounding.length ? startOf[sounding[cursor]] : total);
  const place = (at: number, symbol: string) => {
    if (!parseChordSymbol(symbol)) {
      lose(`读不懂的和弦名 [${symbol}]`);
      return;
    }
    if (at >= total - EPS) {
      lose("超出旋律末尾的和弦");
      return;
    }
    if (chords.some((c) => Math.abs(c.at - at) < EPS)) lose("同一个音前的多个和弦（只留最后一个）");
    chords.push({ at, symbol });
  };
  for (const t of parsed.tokens) {
    if (t.kind === "chord") {
      pending.push(t.symbol);
      lineChords.push(t.symbol);
    } else if (t.kind === "syllable") {
      lineHasSyllable = true;
      if (cursor >= sounding.length) {
        overflow++;
        pending = [];
        continue;
      }
      for (const s of pending) place(atCursor(), s);
      pending = [];
      const note = melody[sounding[cursor++]];
      note.lyric = { text: t.text.slice(0, 40), syllabic: t.syllabic };
      syllables++;
    } else {
      if (!lineHasSyllable && lineChords.length) {
        // A line of chords alone: one chord a bar, from the bar the next syllable is in.
        const from = atCursor();
        let b = bars.findIndex((s) => s >= from - EPS);
        if (b < 0) b = bars.length;
        for (const s of lineChords) place(bars[b++] ?? total, s);
        const nextAt = bars[b] ?? total;
        while (cursor < sounding.length && startOf[sounding[cursor]] < nextAt - EPS) cursor++;
      } else for (const s of pending) place(atCursor(), s);
      pending = [];
      lineChords = [];
      lineHasSyllable = false;
    }
  }
  if (overflow) lose(`比音符多出来的 ${overflow} 个字（音不够）`);
  if (syllables && cursor < sounding.length) notes.push(`还有 ${sounding.length - cursor} 个音没配到字`);
  if (parsed.key) {
    const k = /^([A-G][#b]?)(m)?/.exec(parsed.key.trim());
    const same = k && (k[1] === score.key || (k[1] === "C#" && score.key === "Db") || (k[1] === "G#" && score.key === "Ab") || (k[1] === "Gb" && score.key === "F#")) && Boolean(k[2]) === (score.mode === "minor");
    if (!same) notes.push(`ChordPro 标的调是 ${parsed.key}，谱的调没改`);
  }
  if (!syllables && !chords.length) throw new Error("没在这段文字里读到歌词或 [和弦]，现有谱未更改。");
  const next: Score = { ...score, notes: melody };
  const symbols = canonicalChordSymbols(chords);
  if (symbols) next.chordSymbols = symbols;
  else delete next.chordSymbols;
  return { score: next, losses, notes, syllables, chords: symbols?.length ?? 0 };
}
