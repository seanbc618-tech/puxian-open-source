import {
  LYRIC_EXTEND_TYPES,
  LYRIC_SYLLABICS,
  type LyricExtendType,
  type LyricFragment,
  type LyricSyllabic,
  type NoteLyric,
  type ScoreNote,
} from "./theory.ts";

/**
 * Lyrics sit on a note event, one per chord, never on a rest.
 *
 * The staff paints them with an ABC `w:` line. abcjs skips rests and gives a
 * chord one slot, but each tied fragment is its own note, so a continuation
 * is a `*` and does not take the next syllable. An extender is the underscore
 * abcjs draws on the opening syllable (`Ah_`) plus a blank under every later
 * note in the span, including tie fragments. Further holds are more `_` skips.
 * A hold that starts the next system is a leading `_` on that line. abcjs does
 * not draw a line under those later notes; the following word stays put.
 *
 * Input is not speech alignment. Han characters are syllables. Latin syllables
 * are split on spaces, and `Hel-lo` is begin/end. `*` blanks a sounding note.
 * `_` or `～` holds the previous syllable across one more sounding note.
 * A literal `%` in a syllable is written `\%`, because abcjs treats `%` as a
 * line comment. The staff shows that escaped percent as a fullwidth ％.
 * Only verse 1 is kept. A second verse is reported and left out.
 * Jianpu and MIDI do not carry lyrics. A rewrite that changes pitches or
 * lengths drops lyrics instead of guessing a new alignment. Transpose,
 * instrument spelling, and an added chord tone keep the same attachment.
 */

const MAX_SYLLABLE = 64;

function stripControls(text: string): string {
  let out = "";
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (code >= 32) out += char;
  }
  return out;
}

export type LyricAtom =
  | { kind: "syllable"; lyric: NoteLyric }
  | { kind: "skip" }
  | { kind: "hold" };

function extendTypeOf(value: unknown): LyricExtendType | undefined {
  if ((LYRIC_EXTEND_TYPES as readonly string[]).includes(String(value))) {
    return value as LyricExtendType;
  }
  return undefined;
}

export function cleanLyric(value: unknown): NoteLyric | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as {
    text?: unknown;
    syllabic?: unknown;
    extend?: unknown;
    extendType?: unknown;
    extendEnd?: unknown;
    extendEndBare?: unknown;
    extendEndAt?: unknown;
    extendEndDur?: unknown;
    fragments?: unknown;
  };
  if (typeof raw.text !== "string") return undefined;
  const text = stripControls(raw.text).trim().slice(0, MAX_SYLLABLE);
  const syllabic = (LYRIC_SYLLABICS as readonly string[]).includes(String(raw.syllabic))
    ? (raw.syllabic as LyricSyllabic)
    : "single";
  const extendType = extendTypeOf(raw.extendType);
  const extendEnd = extendTypeOf(raw.extendEnd);
  const extendEndBare = raw.extendEndBare === true && extendEnd == null;
  const hasList = Array.isArray(raw.fragments);
  const listed = hasList ? cleanFragments(raw.fragments) : undefined;
  // A legacy continuation is only a tail. It does not become an opening extender.
  const extend = raw.extend === true || extendType != null;
  const extendEndAt = extendOffset(raw.extendEndAt, extendEnd != null || extendEndBare);
  const extendEndDur = extendOffset(raw.extendEndDur, extendEnd != null || extendEndBare);
  const legacy =
    !hasList && extendEndAt != null && (extendEnd != null || extendEndBare) && (extendEndDur ?? 0) > 0
      ? {
          at: extendEndAt,
          dur: extendEndDur ?? 0,
          ...(extendEnd ? { extendType: extendEnd } : {}),
        }
      : undefined;
  const fragments = hasList ? listed : legacy ? [legacy] : undefined;
  const lyric: NoteLyric = { text, syllabic: text ? syllabic : "single" };
  if (extend) lyric.extend = true;
  if (extendType) lyric.extendType = extendType;
  if (fragments) lyric.fragments = fragments;
  if (fragments?.length === 1) {
    const only = fragments[0];
    if (only.extendType) lyric.extendEnd = only.extendType;
    else lyric.extendEndBare = true;
    lyric.extendEndAt = only.at;
    lyric.extendEndDur = only.dur;
  } else if (!hasList && !fragments?.length) {
    if (extendEnd) lyric.extendEnd = extendEnd;
    if (extendEndBare) lyric.extendEndBare = true;
    if (extendEndAt != null) lyric.extendEndAt = extendEndAt;
    if (extendEndDur != null) lyric.extendEndDur = extendEndDur;
  }
  return lyric;
}

function cleanFragments(value: unknown): LyricFragment[] {
  const out: LyricFragment[] = [];
  if (!Array.isArray(value)) return out;
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const rec = item as { at?: unknown; dur?: unknown; extendType?: unknown };
    if (typeof rec.at !== "number" || typeof rec.dur !== "number") continue;
    if (!Number.isFinite(rec.at) || !Number.isFinite(rec.dur) || rec.at < 0 || rec.dur <= 0) continue;
    const extendType = extendTypeOf(rec.extendType);
    const fragment: LyricFragment = {
      at: Math.round(rec.at * 48) / 48,
      dur: Math.round(rec.dur * 48) / 48,
    };
    if (extendType) fragment.extendType = extendType;
    out.push(fragment);
  }
  out.sort((a, b) => a.at - b.at);
  return out;
}

function extendOffset(value: unknown, enabled: boolean): number | undefined {
  if (!enabled || typeof value !== "number" || !Number.isFinite(value) || value < 0) return undefined;
  return Math.round(value * 48) / 48;
}

export function scoreHasLyrics(notes: readonly ScoreNote[]): boolean {
  return notes.some((note) => note.pitches.length > 0 && cleanLyric(note.lyric) != null);
}

function copyNote(note: ScoreNote): ScoreNote {
  const next: ScoreNote = { ...note, pitches: note.pitches.slice() };
  if (note.articulations) next.articulations = note.articulations.slice();
  const lyric = cleanLyric(note.lyric);
  if (lyric && note.pitches.length) next.lyric = lyric;
  else delete next.lyric;
  return next;
}

function occupied(note: ScoreNote): boolean {
  return note.pitches.length > 0 && cleanLyric(note.lyric) != null;
}

/** True when a later edit is holding fewer lyric attachments than before. */
export function lyricsDropped(prev: readonly ScoreNote[], next: readonly ScoreNote[]): boolean {
  return prev.filter(occupied).length > next.filter(occupied).length;
}

const HAN = /\p{Script=Han}/u;
const LATIN = /[\p{Script=Latin}\p{N}'’]/u;

function isHold(char: string): boolean {
  return char === "_" || char === "＿" || char === "～" || char === "~";
}

/** `*` is ABC's skip; `/` is Dolce 123's Shift-free one (中文输入法下的 `／` 也认). */
function isBlank(char: string): boolean {
  return char === "*" || char === "＊" || char === "/" || char === "／";
}

/** `|` moves to the first note of the next bar (an alignment check, as in ABC). */
function isBarMark(char: string): boolean {
  return char === "|" || char === "｜";
}

function isDash(char: string): boolean {
  return char === "-" || char === "－" || char === "–";
}

export function parseLyricLine(input: string): { slots: NoteLyric[]; notices: string[]; bars: number[] } {
  const slots: NoteLyric[] = [];
  const notices: string[] = [];
  /** Slot counts at which a `|` was written. */
  const bars: number[] = [];
  const chars = Array.from(input);
  let i = 0;
  let ignored = false;

  const pushHold = () => {
    const prev = slots[slots.length - 1];
    if (prev?.text) prev.extend = true;
    slots.push({ text: "", syllabic: "single", extend: true });
  };

  while (i < chars.length) {
    const char = chars[i] ?? "";
    if (/\s/u.test(char)) {
      i += 1;
      continue;
    }
    if (isBlank(char)) {
      slots.push({ text: "", syllabic: "single" });
      i += 1;
      continue;
    }
    if (isHold(char)) {
      pushHold();
      i += 1;
      continue;
    }
    if (isBarMark(char)) {
      if (bars.at(-1) !== slots.length) bars.push(slots.length);
      i += 1;
      continue;
    }
    if (char === "{" || char === "｛") {
      // `{多字}`: several characters under one note.
      const close = chars.findIndex((c, k) => k > i && (c === "}" || c === "｝"));
      if (close > i) {
        const text = chars.slice(i + 1, close).join("").replace(/\s+/gu, " ").trim();
        slots.push({ text: text.slice(0, MAX_SYLLABLE), syllabic: "single" });
        i = close + 1;
        continue;
      }
    }
    if (char === "、") {
      // A Chinese IME turns `/` into `、`; as punctuation it takes no note.
      if (!notices.some((n) => n.includes("、"))) notices.push("「、」按标点处理，不占音；要空过一个音请用英文的 / 或 *。");
      i += 1;
      continue;
    }
    if (HAN.test(char)) {
      slots.push({ text: char, syllabic: "single" });
      i += 1;
      continue;
    }
    if (/^\p{P}$/u.test(char) || /^\p{S}$/u.test(char)) {
      i += 1;
      continue;
    }
    if (LATIN.test(char)) {
      const pieces: string[] = [];
      let buf = "";
      while (i < chars.length) {
        const current = chars[i] ?? "";
        if (LATIN.test(current)) {
          buf += current;
          i += 1;
          continue;
        }
        if (isDash(current) && buf && LATIN.test(chars[i + 1] ?? "")) {
          pieces.push(buf);
          buf = "";
          i += 1;
          continue;
        }
        break;
      }
      if (buf) pieces.push(buf);
      else if (!pieces.length) {
        ignored = true;
        i += 1;
        continue;
      }
      if (isDash(chars[i] ?? "")) {
        ignored = true;
        i += 1;
        notices.push("末尾的连字符没有下一个音节，已忽略。");
      }
      pieces.forEach((piece, index) => {
        const syllabic: LyricSyllabic =
          pieces.length === 1
            ? "single"
            : index === 0
              ? "begin"
              : index === pieces.length - 1
                ? "end"
                : "middle";
        slots.push({ text: piece.slice(0, MAX_SYLLABLE), syllabic });
      });
      continue;
    }
    ignored = true;
    i += 1;
  }
  if (ignored && !notices.length) notices.push("有些符号没当成歌词。");
  return { slots, notices, bars };
}

export function formatLyricLine(notes: readonly ScoreNote[]): string {
  const parts: string[] = [];
  let word: string[] = [];
  const flush = () => {
    if (!word.length) return;
    parts.push(word.join("-"));
    word = [];
  };
  for (const note of notes) {
    if (!note.pitches.length) continue;
    const lyric = cleanLyric(note.lyric);
    if (!lyric || (!lyric.text && !lyric.extend)) {
      flush();
      parts.push("*");
      continue;
    }
    if (!lyric.text && lyric.extend) {
      flush();
      parts.push("_");
      continue;
    }
    if (lyric.syllabic === "begin" || lyric.syllabic === "middle") {
      word.push(lyric.text);
      continue;
    }
    if (lyric.syllabic === "end" && word.length) {
      word.push(lyric.text);
      flush();
      continue;
    }
    flush();
    // Several Han characters (or spaces) on one note read back as one only inside {}.
    const han = Array.from(lyric.text).filter((c) => HAN.test(c)).length;
    parts.push(han > 1 || /\s/u.test(lyric.text) ? `{${lyric.text}}` : lyric.text);
  }
  flush();
  return parts.join(" ");
}

export function assignLyrics(
  notes: readonly ScoreNote[],
  line: string,
  /** Start of the bar after a quarter-note time; enables `|` in the line. */
  nextBarAt?: (at: number) => number,
): { notes: ScoreNote[]; notice: string | null } {
  const parsed = parseLyricLine(line);
  const next = notes.map(copyNote);
  // Rests take no syllable (Dolce 123 §5.1, ABC §5.1): only sounding notes are slots.
  const starts: number[] = [];
  let clock = 0;
  for (const note of next) {
    starts.push(clock);
    clock += note.dur;
  }
  const allTargets = next.flatMap((note, index) => (note.pitches.length ? [index] : []));
  for (const note of next) delete note.lyric;
  let cursor = 0;
  let placed = 0;
  let barJumps = 0;
  const bars = nextBarAt ? parsed.bars : [];
  let used = 0;
  for (let i = 0; i < parsed.slots.length; i += 1) {
    while (used < bars.length && bars[used] === i) {
      used += 1;
      if (cursor === 0) continue;
      const boundary = nextBarAt!(starts[allTargets[cursor - 1]]);
      const skip = allTargets.findIndex((index, k) => k >= cursor && starts[index] >= boundary - 1e-9);
      const to = skip < 0 ? allTargets.length : skip;
      if (to > cursor) barJumps += 1;
      cursor = to;
    }
    if (cursor >= allTargets.length) break;
    const lyric = cleanLyric(parsed.slots[i]);
    const index = allTargets[cursor];
    if (lyric && index != null) next[index].lyric = lyric;
    cursor += 1;
    placed += 1;
  }
  const targets = allTargets;
  const notices = parsed.notices.slice();
  if (barJumps) notices.push(`按「|」跳到下一小节 ${barJumps} 次，中间的音空过。`);
  if (!targets.length && parsed.slots.length) {
    notices.push("没有可以写歌词的音。休止符不占字。");
  } else if (placed < parsed.slots.length) {
    notices.push(`还有 ${parsed.slots.length - placed} 个字没有音可放，没有写上。`);
  } else if (cursor < targets.length && parsed.slots.length > 0) {
    if (targets.length - cursor >= 4 &&
        parsed.slots.some(slot => slot.syllabic === "single" && /^[\p{Script=Latin}]{12,}$/u.test(slot.text))) {
      notices.push("这串英文已作为一个音节写入，没有只保留前几个字母。英文请用空格分词，同一词用 Hel-lo / Twin-kle 这样的连字符分音节；完整歌词可在「谱上现在是」预览中查看。");
    }
    notices.push(`后面还有 ${targets.length - cursor} 个音没有歌词。`);
  } else if (!parsed.slots.length && notes.some((note) => note.lyric)) {
    notices.push("歌词已清掉。");
  }
  return { notes: next, notice: notices.length ? notices.join("") : null };
}

export function lyricFromEntry(
  input: string,
): { ok: true; lyric: NoteLyric } | { ok: false; reason: "empty" | "many" } {
  const parsed = parseLyricLine(input);
  if (parsed.slots.length > 1) return { ok: false, reason: "many" };
  const lyric = cleanLyric(parsed.slots[0]);
  if (!lyric) return { ok: false, reason: "empty" };
  return { ok: true, lyric };
}

export function setNoteLyric(
  notes: readonly ScoreNote[],
  index: number,
  lyric: NoteLyric | null,
): { ok: true; notes: ScoreNote[] } | { ok: false; reason: "index" | "rest" } {
  const note = notes[index];
  if (!note) return { ok: false, reason: "index" };
  if (!note.pitches.length) return { ok: false, reason: "rest" };
  const next = notes.map(copyNote);
  const cleaned = lyric ? cleanLyric(lyric) : undefined;
  if (cleaned) next[index].lyric = cleaned;
  else delete next[index].lyric;
  return { ok: true, notes: next };
}

export function clearLyrics(notes: readonly ScoreNote[]): ScoreNote[] {
  if (!notes.some((note) => note.lyric)) return notes as ScoreNote[];
  return notes.map((note) => {
    if (!note.lyric) return note;
    const next = copyNote(note);
    delete next.lyric;
    return next;
  });
}

/**
 * Characters abcjs treats specially on a `w:` line.
 * `\` starts an escape or a line continuation, `~` is a space inside a word,
 * and space `-` `_` `*` `|` split or skip syllables. `%` comments out the
 * rest of the line unless it is written `\%` (abcjs then shows ％).
 */
function escapeLyric(text: string): string {
  return text
    .replace(/\\/g, "")
    .replace(/~/g, "～")
    .replace(/ /g, "~")
    .replace(/([*_|-])/g, "\\$1")
    .replace(/%/g, "\\%");
}

/** ABC `w:` body for one music line. Null when that line has nothing to print. */
export function formatAbcLyrics(atoms: readonly LyricAtom[]): string | null {
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
