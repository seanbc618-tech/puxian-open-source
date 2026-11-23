/** 番茄简谱文本（番茄简谱脚本 v1.0）→ Score, read-only subset.
 * Independently implemented from Dolce 6b1d3fc `docs/实现/文本谱.md`, `docs/模块/源格式-文本谱.md`
 * and the dialect table in `src/fanqie/dialect.ts` (MIT, Copyright (c) 2026 lodebar2026).
 * No upstream code is copied. Subset, encoding and loss matrix: docs/text-formats.md.
 */
import { CHANGE_BEAT_UNITS, CHANGE_BEATS_MAX, CHANGE_BPM_MAX, CHANGE_BPM_MIN } from "./score-timeline.ts";
import { KEY_NAMES, MAJOR_STEPS, type ChordSymbol, type KeyName, type Score, type ScoreChange, type ScoreNote } from "./theory.ts";
import { canonicalChordSymbols, parseChordSymbol } from "./chord-symbol.ts";
import { alignLyrics, DegreeCarry, doKey, isCjk, padPickup, type LyricItem, type LyricSlot } from "./text-score-util.ts";
import type { TextImport } from "./j123-import.ts";
import { canonicalFermatas, type FermataMark } from "./fermata.ts";
import type { GradualKind, GradualTempo, ScoreWithGradual } from "./gradual-tempo.ts";
import {
  cleanGradualTempos,
  defaultGradualClose,
  nextBpmAfter,
  readTempoWords,
  shiftGradualTempos,
} from "./text-mid-marks.ts";

const LETTERS = "CDEFGAB";
const LETTER_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const BARLINES = [":|:", ":||", "||:", "||/", "|:", ":|", "||", "|/", "|*", "|"];
const DYN: Record<string, ScoreNote["dynamic"]> = { p: "p", mp: "mp", mf: "mf", f: "f", pp: "p", ppp: "p", ff: "f", fff: "f" };
const PUNCT_AFTER = "，。！？、；：,.!?;:…—）)》”’\"";
const PUNCT_BEFORE = "（(《“‘";

type El =
  | { kind: "note"; head: string; acc: number | null; oct: number; halves: number; dots: number; anchor: boolean; grace?: { head: string; acc: number | null; oct: number }; marks: string[] }
  | { kind: "sustain"; anchor: boolean }
  | { kind: "bar"; code: string; meter?: { beats: number; beatUnit: number }; keyDegree?: string }
  | { kind: "open"; tuplet: boolean }
  | { kind: "close" }
  | { kind: "wedge"; type: "cresc" | "dim" }
  | { kind: "wedgeEnd" }
  | { kind: "chordSym"; symbol: string };

/** Sniffs tomato vs 诗歌本 by header fields, as the two dialects are incompatible. */
export function sniffFanqie(text: string): "tomato" | "shige" | null {
  let tomato = 0, shige = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    if (/^(V|B|D|P)\s*[:：]/.test(line)) tomato++;
    if (/^(T|XL|XR|TL|TR|BL|BC|BR|FontSize|Margin)\s*[:：]/i.test(line)) shige++;
    if (/^[1-7]\s*=/.test(line)) shige += 2;
  }
  if (!tomato && !shige) return null;
  return shige > tomato ? "shige" : "tomato";
}

function decode(input: string | Uint8Array | ArrayBuffer): string {
  if (typeof input === "string") return input.replace(/^\uFEFF/, "");
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff))
    throw new Error("番茄简谱文本应为 UTF-8；这像是 UTF-16 文件（JP-Word 请用 .jpwabc 导入）。");
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\uFEFF/, "");
  } catch {
    throw new Error("番茄简谱文本不是有效的 UTF-8，现有谱未更改。");
  }
}

export function importFanqie(input: string | Uint8Array | ArrayBuffer): TextImport {
  const text = decode(input);
  if (text.includes("\0")) throw new Error("文件含有二进制内容，现有谱未更改。");
  const dialect = sniffFanqie(text);
  if (dialect === null) throw new Error("认不出番茄简谱头部（V:/B:/D:/P:），现有谱未更改。");
  if (dialect === "shige") throw new Error("这是诗歌本文本谱，暂只支持番茄简谱；可先转成 123 或 MusicXML 再导入。");
  const losses: string[] = [];
  const notes: string[] = [];
  const lose = (s: string) => void (losses.includes(s) || losses.push(s));
  const note = (s: string) => void (notes.includes(s) || notes.push(s));

  let title = "";
  let home: { letter: string; alter: number } | null = null;
  let meter: { beats: number; beatUnit: number } | null = null;
  let bpm: number | null = null;
  const unknown = new Set<string>();

  const parseLine = (s: string): El[] => {
    const out: El[] = [];
    const lastNote = () => {
      for (let k = out.length - 1; k >= 0; k--) {
        const e = out[k];
        if (e.kind === "note") return e;
        if (e.kind === "bar") return null;
      }
      return null;
    };
    const modifier = (n: Extract<El, { kind: "note" }>, ch: string) => {
      if (ch === "'") n.oct++;
      else if (ch === ",") n.oct--;
      else if (ch === "/") n.halves++;
      else if (ch === ".") n.dots++;
      else if (ch === "#") n.acc = 1;
      else if (ch === "$") n.acc = -1;
      else if (ch === "=") n.acc = 0;
      else return false;
      return true;
    };
    let i = 0;
    while (i < s.length) {
      const ch = s[i];
      const rest = s.slice(i);
      if (/\s|~|\^/.test(ch)) {
        i++;
        continue;
      }
      if (/[0-9]/.test(ch)) {
        const n: Extract<El, { kind: "note" }> = { kind: "note", head: ch, acc: null, oct: 0, halves: 0, dots: 0, anchor: ch !== "0", marks: [] };
        i++;
        while (i < s.length && modifier(n, s[i])) i++;
        out.push(n);
        continue;
      }
      if (ch === "-") {
        out.push({ kind: "sustain", anchor: false });
        i++;
        continue;
      }
      if (ch === "@") {
        const prev = out.at(-1);
        if (prev?.kind === "note" || prev?.kind === "sustain") prev.anchor = true;
        i++;
        continue;
      }
      const bar = BARLINES.find((b) => rest.startsWith(b));
      if (bar && (ch === "|" || ch === ":")) {
        out.push({ kind: "bar", code: bar });
        i += bar.length;
        continue;
      }
      if (ch === "(") {
        const tuplet = s[i + 1] === "y";
        out.push({ kind: "open", tuplet });
        i += tuplet ? 2 : 1;
        continue;
      }
      if (ch === ")") {
        out.push({ kind: "close" });
        i++;
        continue;
      }
      if (ch === "<" || ch === ">") {
        out.push({ kind: "wedge", type: ch === "<" ? "cresc" : "dim" });
        i++;
        while (s[i] === "+") i++;
        continue;
      }
      if (ch === "!") {
        out.push({ kind: "wedgeEnd" });
        i++;
        continue;
      }
      if (ch === "[") {
        const prev = out.at(-1);
        const end = s.indexOf("]", i + 1);
        // A grace sits right against its note; a volta bracket follows a barline or space.
        if (prev?.kind === "note" && i > 0 && !/\s/.test(s[i - 1]) && end > i) {
          let body = s.slice(i + 1, end);
          if (/^h/i.test(body)) {
            lose("后倚音");
            body = "";
          }
          const g = /([0-7])([',#$=/.]*)/.exec(body);
          if (g && g[1] !== "0") {
            const mods = g[2];
            prev.grace = {
              head: g[1],
              acc: mods.includes("#") ? 1 : mods.includes("$") ? -1 : mods.includes("=") ? 0 : null,
              oct: [...mods].reduce((o, c) => o + (c === "'" ? 1 : c === "," ? -1 : 0), 0),
            };
            if ((body.match(/[1-7]/g) ?? []).length > 1) lose("一串多个倚音只留第一个");
          }
          i = end + 1;
          continue;
        }
        lose("跳房子（第几遍结尾）只按谱面播放一遍");
        i++;
        while (s[i] === "+" || s[i] === "/") i++;
        if (s[i] === '"') {
          const q = s.indexOf('"', i + 1);
          i = q < 0 ? s.length : q + 1;
        }
        continue;
      }
      if (ch === "]") {
        i += s[i + 1] === "/" ? 2 : 1;
        continue;
      }
      if (ch === "&") {
        const m = /^&(\+*)([A-Za-z]+(?:\s+tempo)?)?(\+*)/.exec(rest)!;
        const name = (m[2] ?? "").replace(/\s+/g, "").toLowerCase();
        const target = out.at(-1);
        if (name) command(name, target && (target.kind === "note" ? target : target.kind === "bar" ? null : lastNote()));
        i += Math.max(1, m[0].length);
        continue;
      }
      if (ch === '"') {
        const q = s.indexOf('"', i + 1);
        const body = q < 0 ? s.slice(i + 1) : s.slice(i + 1, q);
        const target = out.at(-1);
        const meterQ = /^p\s*:\s*(\d+)\s*\/\s*(\d+)\s*$/i.exec(body);
        const keyQ = /^k\s*:\s*([#$b]?[1-7])/i.exec(body);
        if (target?.kind === "bar" && meterQ) target.meter = { beats: Number(meterQ[1]), beatUnit: Number(meterQ[2]) };
        else if (target?.kind === "bar" && keyQ) target.keyDegree = keyQ[1].replace("$", "b");
        else if (/^hx\s*:/i.test(body)) out.push({ kind: "chordSym", symbol: body.replace(/^hx\s*:\s*/i, "") });
        else lose("谱上注释文字");
        i = q < 0 ? s.length : q + 1;
        continue;
      }
      if (ch === "{") {
        const end = s.indexOf("}", i + 1);
        lose("{bz…}/{dsb…} 临时伴奏或并排声部");
        i = end < 0 ? s.length : end + 1;
        continue;
      }
      if (/[A-G]/.test(ch)) {
        const chord = /^[A-G][#b]?(?:maj|min|sus|dim|aug|add|m|M)?\d*(?:\/[A-G][#b]?)?/.exec(rest)!;
        out.push({ kind: "chordSym", symbol: chord[0] });
        i += chord[0].length;
        continue;
      }
      // `5&rit/`: a stray modifier after a command still belongs to the note.
      const n = lastNote();
      if (n && out.at(-1) === n && modifier(n, ch)) {
        i++;
        continue;
      }
      unknown.add(ch);
      i++;
    }
    return out;
  };

  function command(name: string, target: Extract<El, { kind: "note" }> | null | undefined) {
    if (name in DYN) {
      if (target) target.marks.push(`dyn:${name}`);
      if (name.length > 2 || name === "pp" || name === "ff") lose("更细的力度（pp、ff 等）记成 p 或 f");
      return;
    }
    const map: Record<string, string> = { zy: "accent", dy: "staccato", bc: "tenuto", tr: "trill", cy: "trill" };
    if (map[name]) {
      if (target) target.marks.push(map[name]);
      return;
    }
    if (["yc", "ycy"].includes(name)) {
      if (target) target.marks.push("fermata");
      return;
    }
    else if (["fine", "dc", "ds", "ty", "hs", "sbf"].includes(name)) lose("跳转记号（D.C.、D.S.、Fine 等）");
    else if (["cresc", "dim"].includes(name)) lose("速度与表情术语文字");
    else if (readTempoWords(name) || ["rit", "rall", "accel", "accelerando", "ritardando", "tempo", "atempo"].includes(name)) {
      const words = readTempoWords(name) ?? (
        name === "tempo" || name === "atempo" ? ({ role: "end" } as const)
        : name.startsWith("acc") ? ({ role: "start", kind: "accel" } as const)
        : ({ role: "start", kind: "rit" } as const)
      );
      if (target) target.marks.push(words.role === "end" ? "tempo-end" : `gradual:${words.kind}`);
      return;
    }
    else if (["zkh", "ykh"].includes(name)) lose("伴奏括弧");
    else if (name === "hx") lose("呼吸记号");
    else lose("其他装饰记号（滑音、波音等）");
  }

  type Voice = { notes: ScoreNote[]; slots: LyricSlot[]; t: number; bar: number; barHasContent: boolean; carry: DegreeCarry; doMidi: number; ties: Set<ScoreNote>; queue: { tuplet: boolean; start: number }[]; firstBarAt?: number };
  const voices: Voice[] = [];
  const voiceAt = (k: number, at: number) => {
    while (voices.length <= k) voices.push({ notes: [], slots: [], t: 0, bar: 0, barHasContent: false, carry: new DegreeCarry(), doMidi: homeKey().doMidi, ties: new Set(), queue: [] });
    const v = voices[k];
    if (v.t < at - 1e-9) {
      // A voice missing from earlier systems rests until it comes in.
      v.notes.push({ pitches: [], dur: at - v.t });
      v.t = at;
    }
    return v;
  };
  const homeKey = () => (home ? doKey(home.letter, home.alter) : { key: "C" as KeyName, doMidi: 60 });
  const changes: ScoreChange[] = [];
  const chordMarks: ChordSymbol[] = [];
  const fermataMarks: FermataMark[] = [];
  const gradualMarks: GradualTempo[] = [];
  let openGradual: { from: number; kind: GradualKind; toBpm?: number } | null = null;
  const closeGradual = (at: number) => {
    if (!openGradual || at <= openGradual.from + 1e-6) return;
    gradualMarks.push({ from: openGradual.from, to: at, kind: openGradual.kind });
    openGradual = null;
  };
  const same = (a: number[], b: number[]) => a.length === b.length && a.every((p, i) => p === b[i]);

  /** Converts one Q line; returns the slot index where it began. */
  const convert = (v: Voice, els: El[], isMain: boolean) => {
    const from = v.slots.length;
    let pendingWedge: "cresc" | "dim" | null = null;
    let lastEvent: ScoreNote | null = null;
    for (const e of els) {
      if (e.kind === "note") {
        const dur = 2 ** -e.halves * (2 - 2 ** -e.dots);
        const n: ScoreNote = { pitches: [], dur };
        const digit = Number(e.head);
        if (digit >= 1 && digit <= 7) n.pitches = [v.carry.midi(v.doMidi, digit, e.acc, e.oct)];
        if (e.head === "9") lose("节奏音符 9（无音高）记为休止");
        for (const m of e.marks) {
          if (m.startsWith("dyn:")) n.dynamic = DYN[m.slice(4)];
          else if (m === "trill") n.ornament = "trill";
          else n.articulations = [...new Set([...(n.articulations ?? []), m as "accent" | "staccato" | "tenuto"])];
        }
        if (e.grace && n.pitches.length) {
          if (n.ornament) lose("同一个音上的颤音与倚音只留一个");
          n.ornament = "grace";
          n.gracePitch = new DegreeCarry().midi(v.doMidi, Number(e.grace.head), e.grace.acc, e.grace.oct);
        }
        if (pendingWedge) {
          n.hairpin = pendingWedge;
          pendingWedge = null;
        }
        if (e.marks.includes("fermata")) {
          const voice = isMain ? 0 : 1;
          fermataMarks.push({ voice, at: v.t });
        }
        if (isMain) {
          if (e.marks.includes("tempo-end")) closeGradual(v.t);
          const start = e.marks.find((m) => m.startsWith("gradual:"));
          if (start) {
            closeGradual(v.t);
            openGradual = { from: v.t, kind: start.slice("gradual:".length) as GradualKind };
          }
        }
        v.notes.push(n);
        if (e.anchor) {
          v.slots.push({ note: n, pitched: n.pitches.length > 0, bar: v.bar });
        }
        v.t += dur;
        v.barHasContent = true;
        lastEvent = n;
      } else if (e.kind === "sustain") {
        const last = v.notes.at(-1);
        if (last) {
          last.dur += 1;
          v.t += 1;
          if (e.anchor) {
            v.slots.push({ note: last, pitched: false, bar: v.bar });
            lose("增时线上单独配的歌词");
          }
        }
      } else if (e.kind === "bar") {
        if (e.code.includes(":")) lose("反复记号（只按谱面播放一遍）");
        if (v.barHasContent) {
          if (v.bar === 0) v.firstBarAt = v.t;
          v.bar++;
          v.barHasContent = false;
        }
        v.carry.reset();
        if (e.meter && isMain) {
          if (e.meter.beats < 1 || e.meter.beats > CHANGE_BEATS_MAX || !CHANGE_BEAT_UNITS.includes(e.meter.beatUnit))
            lose(`曲中拍号 ${e.meter.beats}/${e.meter.beatUnit} 超出支持范围，未保留`);
          else if (v.t > 0) changes.push({ at: v.t, beats: e.meter.beats, beatUnit: e.meter.beatUnit });
          else meter = e.meter;
        }
        if (e.keyDegree) {
          const h = home ?? { letter: "C", alter: 0 };
          const deg = Number(e.keyDegree.at(-1));
          const acc = e.keyDegree.startsWith("#") ? 1 : e.keyDegree.startsWith("b") ? -1 : 0;
          const letter = LETTERS[(LETTERS.indexOf(h.letter) + deg - 1) % 7];
          let alter = (((LETTER_PC[h.letter] + h.alter + MAJOR_STEPS[deg - 1] + acc - LETTER_PC[letter]) % 12) + 12) % 12;
          if (alter > 6) alter -= 12;
          const k = doKey(letter, alter);
          for (const voice of voices) voice.doMidi = k.doMidi;
          if (isMain && v.t > 0) changes.push({ at: v.t, key: k.key, mode: "major" });
        }
      } else if (e.kind === "chordSym") {
        if (isMain && parseChordSymbol(e.symbol)) chordMarks.push({ at: v.t, symbol: e.symbol.trim() });
        else lose(isMain ? "认不出的和弦记号" : "第二声部上的和弦记号");
      } else if (e.kind === "open") v.queue.push({ tuplet: e.tuplet, start: v.notes.length });
      else if (e.kind === "close") {
        // First opened, first closed (`(5 - | (5) - | 5)` is a chain of ties).
        const open = v.queue.shift();
        if (!open) continue;
        const span = v.notes.slice(open.start);
        if (open.tuplet) {
          const n = span.length;
          if (n >= 2) {
            for (const x of span) {
              const d = x.dur * ((n - 1) / n);
              v.t -= x.dur - d;
              x.dur = d;
            }
          }
        } else if (span.length >= 2) {
          const a = span[0], b = span.at(-1)!;
          if (span.length === 2 && a.pitches.length && same(a.pitches, b.pitches)) v.ties.add(a);
          else if (a.pitches.length && b.pitches.length) {
            if (a.slurStart || b.slurEnd) lose("叠着的连线只留一层");
            a.slurStart = true;
            b.slurEnd = true;
          }
        }
      } else if (e.kind === "wedge") {
        // `5<` starts on the note it follows; a leading `<` waits for the next note.
        if (lastEvent) lastEvent.hairpin = e.type;
        else pendingWedge = e.type;
      } else if (e.kind === "wedgeEnd") {
        if (lastEvent) lastEvent.hairpinEnd = true;
      }
    }
    return from;
  };

  const lyricItems = (body: string): LyricItem[] => {
    const items: LyricItem[] = [];
    let open = "";
    const lastText = () => {
      const it = items.at(-1);
      return it?.kind === "text" ? it : null;
    };
    for (let i = 0; i < body.length; i++) {
      const ch = body[i];
      if (ch === "@") items.push({ kind: "skip" });
      else if (ch === "/" || /\s/.test(ch) || "-0^|*}".includes(ch)) continue;
      else if (ch === "<") {
        const end = body.indexOf(">", i + 1);
        i = end < 0 ? body.length : end;
      } else if (ch === "[" && /^\[[A-Za-z]+!?\]/.test(body.slice(i))) i += /^\[[A-Za-z]+!?\]/.exec(body.slice(i))![0].length - 1;
      else if (ch === "{") {
        const end = body.indexOf("}", i + 1);
        items.push({ kind: "text", text: open + (end < 0 ? body.slice(i + 1) : body.slice(i + 1, end)) });
        open = "";
        i = end < 0 ? body.length : end;
      } else if (ch === "~") {
        const prev = lastText();
        const cp = body.codePointAt(i + 1);
        if (cp !== undefined) {
          const c = String.fromCodePoint(cp);
          if (prev) prev.text += c;
          else items.push({ kind: "text", text: c });
          i += c.length;
        }
      } else if (PUNCT_BEFORE.includes(ch)) open += ch;
      else if (PUNCT_AFTER.includes(ch)) {
        const prev = lastText();
        if (prev) prev.text += ch;
      } else if (/[A-Za-z']/.test(ch)) {
        let end = i;
        while (end < body.length && /[A-Za-z']/.test(body[end])) end++;
        items.push({ kind: "text", text: open + body.slice(i, end) });
        open = "";
        i = end - 1;
      } else {
        const c = String.fromCodePoint(body.codePointAt(i)!);
        if (!isCjk(c) && c.charCodeAt(0) < 0x7f) {
          unknown.add(c);
        } else {
          items.push({ kind: "text", text: open + c });
          open = "";
        }
        i += c.length - 1;
      }
    }
    return items;
  };

  // Group = adjacent Q lines (with their C lines) until a blank line or a repeated voice number.
  let groupVoices = new Set<number>();
  let groupStart = 0;
  let lastQ: { voice: Voice; from: number; verse: number; isMain: boolean } | null = null;
  const lyricJobs: { voice: Voice; from: number; items: LyricItem[] }[] = [];
  let sawMusic = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) {
      groupVoices = new Set();
      lastQ = null;
      continue;
    }
    if (line.startsWith("#")) continue;
    if (/^\[fenye\]$/i.test(line)) continue;
    const body = /^([QCW])([!+-]?)(\d*)(?:-(\d+))?([!+-]?)(?:"([^"]*)"|<([^>]*)>)?\s*[:：](.*)$/.exec(line);
    if (body) {
      const [, kind, , num, rangeEnd, , , , content] = body;
      if (kind === "W") {
        lose("谱上文字行（W:）");
        continue;
      }
      if (kind === "Q") {
        const vno = num ? Number(num) : 1;
        if (groupVoices.has(vno)) groupVoices = new Set();
        if (!groupVoices.size) groupStart = voices[0]?.t ?? 0;
        groupVoices.add(vno);
        const els = parseLine(content);
        if (!els.length) {
          lastQ = null;
          continue;
        }
        if (vno > 2) {
          lose("第三声部起（谱线最多两个声部）");
          lastQ = null;
          continue;
        }
        sawMusic = true;
        const v = voiceAt(vno - 1, vno === 1 ? 0 : groupStart);
        const from = convert(v, els, vno === 1);
        lastQ = { voice: v, from, verse: 0, isMain: vno === 1 };
        continue;
      }
      // C: lyrics attach to the last Q line above.
      if (!lastQ) {
        lose("没有对应曲行的歌词");
        continue;
      }
      const verse = num ? Number(num) : ++lastQ.verse;
      if (rangeEnd && Number(rangeEnd) > verse) note("共用歌词只写入第 1 段");
      if (verse !== 1) {
        lose("第 2 段起的歌词（只保留第 1 段）");
        continue;
      }
      lyricJobs.push({ voice: lastQ.voice, from: lastQ.from, items: lyricItems(content.replace(/^\s*"[^"]*"/, "")) });
      continue;
    }
    const meta = /^([A-Za-z]+)\s*[:：](.*)$/.exec(line);
    if (meta) {
      const key = meta[1].toUpperCase();
      const value = meta[2].trim();
      if (key === "V") continue;
      if (key === "B") {
        if (!title) title = value;
        else lose("副标题");
      } else if (key === "Z") lose("词曲署名");
      else if (key === "D") {
        const m = /^(?:([A-G])([#$b♭♯]?)|([#$b♭♯])([A-G]))$/.exec(value);
        if (!m) throw new Error(`番茄调号「${value}」认不出，现有谱未更改。`);
        const letter = m[1] ?? m[4];
        const a = m[2] || m[3] || "";
        home = { letter, alter: a === "#" || a === "♯" ? 1 : a ? -1 : 0 };
        if (sawMusic) lose("曲中 D: 换调未保留");
      } else if (key === "P") {
        const all = [...value.matchAll(/(\d+)\s*\/\s*(\d+)/g)];
        if (!all.length) throw new Error(`番茄拍号「${value}」认不出，现有谱未更改。`);
        if (!meter) meter = { beats: Number(all[0][1]), beatUnit: Number(all[0][2]) };
        if (all.length > 1) lose("混合拍只取第一个拍号");
      } else if (key === "J") {
        const num = /^(\d+(?:\.\d+)?)\s*(.*)$/.exec(value);
        if (num) {
          bpm = Number(num[1]);
          if (num[2]) lose("速度旁的文字说明");
        } else lose("文字速度（如「中速」）只作说明，未保留");
      } else lose("页面与版式字段");
      continue;
    }
    lose("无前缀的注记文字");
  }
  if (!voices.length || !voices[0].notes.some((n) => n.pitches.length))
    throw new Error("没有可导入的旋律音符（Q: 行），现有谱未更改。");
  if (unknown.size) lose(`跳过了认不出的记号「${[...unknown].slice(0, 6).join(" ")}」`);

  for (const job of lyricJobs) {
    const r = alignLyrics(job.voice.slots, job.from, job.items);
    if (r.overflow) lose("歌词比音符多出的字");
    if (r.onRest) lose("落在隐藏休止或节奏音符上的歌词");
  }
  const merge = (v: Voice) => {
    const out: ScoreNote[] = [];
    for (let k = 0; k < v.notes.length; k++) {
      const n = v.notes[k];
      out.push(n);
      while (v.ties.has(v.notes[k]) && k + 1 < v.notes.length) {
        const next = v.notes[++k];
        n.dur += next.dur;
        if (next.lyric?.text) lose("延音线后半上的歌词");
        if (next.slurEnd) n.slurEnd = true;
        if (next.hairpinEnd) n.hairpinEnd = true;
      }
    }
    return out;
  };
  const k = homeKey();
  if (!home) note("缺少调号 D:，按 1=C 读入");
  const m = meter ?? { beats: 4, beatUnit: 4 };
  if (!meter) note("缺少拍号 P:，按 4/4 读入");
  if (m.beats < 1 || m.beats > 32 || ![1, 2, 4, 8, 16, 32].includes(m.beatUnit)) throw new Error("此拍号谱线不支持，现有谱未更改。");
  let tempo = bpm ?? 120;
  if (bpm === null) note("缺少速度 J:，按 ♩=120 读入");
  if (tempo < 20 || tempo > 300) {
    lose(`速度 ${Math.round(tempo)} 超出 20–300，已改为最接近的值`);
    tempo = Math.min(300, Math.max(20, tempo));
  }
  const main = merge(voices[0]);
  const second = voices[1] ? merge(voices[1]) : undefined;
  const leftoverGradual = openGradual as { from: number; kind: GradualKind; toBpm?: number } | null;
  if (leftoverGradual) {
    const end = voices[0]?.t ?? 0;
    const closed = defaultGradualClose(leftoverGradual.from, leftoverGradual.kind, end, nextBpmAfter(changes, leftoverGradual.from));
    if (closed) gradualMarks.push(closed);
  }
  const pad = padPickup(voices[0].firstBarAt, (m.beats * 4) / m.beatUnit, second ? [main, second] : [main], [...changes, ...chordMarks, ...fermataMarks]);
  if (pad) {
    shiftGradualTempos(gradualMarks, pad);
    note(`弱起小节前补了 ${+pad.toFixed(3)} 拍休止，让小节线对齐`);
  }
  const merged = new Map<number, ScoreChange>();
  for (const c of changes) {
    if (c.at <= 1e-9) continue;
    if (c.bpm !== undefined && (c.bpm < CHANGE_BPM_MIN || c.bpm > CHANGE_BPM_MAX)) continue;
    merged.set(c.at, { ...(merged.get(c.at) ?? {}), ...c });
  }
  const score: Score = {
    title: (title || "番茄简谱导入").slice(0, 80),
    key: KEY_NAMES[((k.doMidi % 12) + 12) % 12],
    mode: "major",
    beats: m.beats,
    beatUnit: m.beatUnit,
    bpm: Math.round(tempo),
    clef: "treble",
    tonicOctave: Math.floor(k.doMidi / 12) - 1,
    notes: main,
  };
  if (merged.size) score.changes = [...merged.values()].sort((a, b) => a.at - b.at);
  const symbols = canonicalChordSymbols(chordMarks);
  if (symbols) score.chordSymbols = symbols;
  if (second?.some((n) => n.pitches.length)) score.voice2 = second;
  const fermatas = canonicalFermatas(fermataMarks);
  if (fermatas) score.fermatas = fermatas;
  const graduals = cleanGradualTempos(gradualMarks);
  if (graduals) (score as ScoreWithGradual).gradualTempos = graduals;
  return { score, losses, notes };
}
