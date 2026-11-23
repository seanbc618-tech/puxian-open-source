/** Score → JP-Word `.jpwabc` subset, the inverse of jpwabc-import.ts.
 * Independently implemented from Dolce 6b1d3fc format docs (MIT, Copyright (c) 2026 lodebar2026).
 * See docs/text-formats.md for the supported subset and loss matrix.
 */
import { KEY_NAMES, PC, type KeyName, type Score, type ScoreNote } from "./theory.ts";

export type JpwabcExport = { text: string; bytes: Uint8Array; losses: string[] };

const JPW_KEY: Record<KeyName, string> = {
  C: "C", Db: "bD", D: "D", Eb: "bE", E: "E", F: "F", "F#": "#F", G: "G", Ab: "bA", A: "A", Bb: "bB", B: "B",
};
/** Degree spelling for each semitone above the tonic; matches the importer's `#`/`b` (+1/−1). */
const SPELL = ["1", "#1", "2", "b3", "3", "4", "#4", "5", "#5", "6", "b7", "7"];

/** Duration tokens the importer reads back exactly (quarter-note units). */
const DUR_TOKENS: [number, string][] = [
  [4, "---"], [3, "--"], [2, "-"], [1.75, ".."], [1.5, "."], [1, ""],
  [0.875, "_.."], [0.75, "_."], [0.5, "_"], [0.375, "__."], [0.25, "__"],
  [0.1875, "___."], [0.125, "___"], [0.0625, "____"],
];
const tokenFor = (dur: number) => DUR_TOKENS.find(([d]) => Math.abs(d - dur) < 1e-9)?.[1];
/** Larger pieces first; every piece is a token above. */
function splitDur(dur: number): number[] | null {
  const out: number[] = [];
  let left = dur;
  for (const [d] of DUR_TOKENS) {
    while (left - d > -1e-9 && out.length < 64) {
      out.push(d);
      left -= d;
    }
  }
  return Math.abs(left) < 1e-9 ? out : null;
}

/** Characters the importer treats as structure inside `{…}` or would split differently. */
function lyricToken(text: string): string {
  const clean = text.replace(/[{}[\]\r\n/]/g, "").trim();
  if (!clean) return "/";
  if (/^[A-Za-z]+$/.test(clean)) return clean;
  if ([...clean].length === 1 && !/[\s\-()，。！？；：、,.!?;:”’“‘]/.test(clean)) return clean;
  return `{${clean.replace(/[\s\-()]/g, "")}}`;
}

export function exportJpwabc(score: Score): JpwabcExport {
  const losses: string[] = [];
  const lose = (s: string) => {
    if (!losses.includes(s)) losses.push(s);
  };
  for (const n of score.notes) {
    if (!Number.isFinite(n.dur) || n.dur <= 0 || !splitDur(n.dur))
      throw new Error("含三连音或其他 JP-Word 写不出的时值，已停止导出；请改用 MusicXML。");
  }
  if (!score.notes.some((n) => n.pitches.length)) throw new Error("谱里还没有音符，无法导出 JP-Word。");
  if (score.beats < 1 || score.beats > 32 || ![1, 2, 4, 8, 16, 32].includes(score.beatUnit))
    throw new Error("此拍号写不进 JP-Word。");
  // Minor scores use the relative major so 6 is the tonic, as JP-Word has no mode field.
  const key: KeyName = score.mode === "minor" ? KEY_NAMES[(PC[score.key] + 3) % 12] : score.key;
  if (score.mode === "minor") lose(`小调：按关系大调 1=${JPW_KEY[key]} 写出（主音唱 6），读回为大调`);
  const tonicOctave = key === "B" || key === "Bb" ? 3 : 4;
  const base = 12 * (tonicOctave + 1) + PC[key];
  const pitchToken = (midi: number) => {
    const rel = midi - base;
    const oct = Math.floor(rel / 12);
    return SPELL[((rel % 12) + 12) % 12] + (oct > 0 ? "'".repeat(oct) : ",".repeat(-oct));
  };
  const bpm = Math.round(score.bpm);
  if (bpm < 20 || bpm > 300) throw new Error("速度超出 JP-Word 支持范围（20–300）。");
  if (bpm !== score.bpm) lose("小数速度已取整");
  if (score.voice2 != null && score.voice2.some((n) => n.pitches.length)) lose("第二声部（JP-Word 只写单声部）");
  if (score.changes?.length) lose("曲中变速、变拍、转调（只写开头的调号、拍号和速度）");
  if (score.chordSymbols?.length) lose("和弦标记（如 Am、G7）");
  if (score.rehearsals?.length) lose("段落标记");
  if (score.lyricist || score.composer) lose("词曲署名");

  const bar = (score.beats * 4) / score.beatUnit;
  const voice: string[] = [];
  const lyricTokens: string[] = [];
  let pos = 0;
  let lastLyric = -1;
  const describe = (n: ScoreNote) => {
    if (n.pitches.length > 1) lose("和弦（只留最高音）");
    if (n.dynamic || n.hairpin || n.hairpinEnd) lose("力度与渐强渐弱");
    if (n.articulations?.length) lose("跳音、重音、保持音");
    if (n.ornament) lose("颤音与倚音");
    if (n.slurStart || n.slurEnd) lose("连线");
    if (n.lyric && n.lyric.syllabic !== "single") lose("英文歌词的连字符分音节");
    if (n.lyric?.extend || n.lyric?.fragments?.length) lose("歌词延长线");
  };
  for (const n of score.notes) {
    describe(n);
    const head = n.pitches.length ? pitchToken(Math.max(...n.pitches)) : "0";
    const pieces = splitDur(n.dur)!;
    if (pieces.length > 1) lose(n.pitches.length ? "跨长度的音拆成几段写出，读回会重新起音" : "长休止拆成几段");
    pieces.forEach((d, i) => {
      voice.push(`${n.pitches.length || i === 0 ? head : "0"}${tokenFor(d)}`);
      // The importer consumes one lyric slot per written note, rests included.
      if (i === 0 && n.lyric?.text.trim() && n.pitches.length) {
        lyricTokens.push(lyricToken(n.lyric.text));
        lastLyric = lyricTokens.length;
      } else lyricTokens.push("/");
      pos += d;
      if (Math.abs(pos / bar - Math.round(pos / bar)) < 1e-9) voice.push("|");
    });
  }
  if (voice.at(-1) === "|") voice[voice.length - 1] = "|]";
  else voice.push("|]");
  const title = score.title.replace(/[\r\n{}]/g, " ").trim() || "谱线导出";
  if (title !== score.title.trim()) lose("曲名里的换行与花括号已替换为空格");
  const lines = [
    "// ************** JPW-ABC File Ver 1.0 (for JP-Word v5.50m) **************",
    ".Title",
    `Title = {${title}}`,
    `KeyAndMeters = {1=${JPW_KEY[key]},${score.beats}/${score.beatUnit}}`,
    ...(score.tempoMarked === false ? [] : [`Expression = {♩=${bpm}}`]),
    ".Voice",
  ];
  // 24 tokens per line keeps files readable; line breaks carry no meaning on import.
  for (let i = 0; i < voice.length; i += 24) lines.push(voice.slice(i, i + 24).join(" "));
  if (lastLyric > 0) lines.push(".Words", `W1:${lyricTokens.slice(0, lastLyric).join(" ")}`);
  const text = lines.join("\r\n") + "\r\n";
  const body = new Uint8Array(2 + text.length * 2);
  body[0] = 0xff;
  body[1] = 0xfe;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    body[2 + i * 2] = c & 0xff;
    body[3 + i * 2] = c >> 8;
  }
  return { text, bytes: body, losses };
}
