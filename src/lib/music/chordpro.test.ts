import assert from "node:assert/strict";
import test from "node:test";
import { applyChordPro, exportChordPro, parseChordPro } from "./chordpro.ts";
import type { Score, ScoreNote } from "./theory.ts";

const n = (p: number | null, dur = 1, text?: string): ScoreNote => ({ pitches: p == null ? [] : [p], dur, ...(text ? { lyric: { text, syllabic: "single" as const } } : {}) });
const base = (notes: ScoreNote[], extra: Partial<Score> = {}): Score => ({ title: "小星星", bpm: 96, beats: 4, beatUnit: 4, key: "C", mode: "major", clef: "treble", tonicOctave: 4, notes, ...extra });

test("导出：头部指令、和弦插在字前、标点断行", () => {
  const score = base([n(60, 1, "一"), n(60, 1, "闪"), n(67, 1, "一"), n(67, 1, "闪，"), n(69, 1, "亮"), n(69, 1, "晶"), n(67, 2, "晶。")], {
    chordSymbols: [{ at: 0, symbol: "C" }, { at: 4, symbol: "F" }, { at: 6, symbol: "C" }],
  });
  const { text, losses } = exportChordPro(score);
  assert.deepEqual(losses, []);
  assert.equal(text, "{title: 小星星}\n{key: C}\n{time: 4/4}\n{tempo: 96}\n\n[C]一闪一闪，\n[F]亮晶[C]晶。\n");
});

test("导出：英文按词空格、连字符音节、没有字的和弦单独留位", () => {
  const score = base([{ pitches: [60], dur: 1, lyric: { text: "Twin", syllabic: "begin" } }, { pitches: [60], dur: 1, lyric: { text: "kle", syllabic: "end" } }, n(null, 1), n(67, 1, "star")], {
    key: "Db", mode: "minor", chordSymbols: [{ at: 0, symbol: "C#m" }, { at: 2, symbol: "G#7" }],
  });
  const { text } = exportChordPro(score);
  assert.match(text, /\{key: C#m\}/);
  assert.match(text, /\n\[C#m\]Twin-kle \[G#7\] star\n/);
});

test("解析：指令、和弦、中文逐字、英文按词、连字符", () => {
  const r = parseChordPro("{title: 测试}\n{key: G}\n# 注释\n[G]你好 [D]world-wide\n");
  assert.equal(r.title, "测试");
  assert.equal(r.key, "G");
  assert.deepEqual(r.tokens.map((t) => (t.kind === "chord" ? `[${t.symbol}]` : t.kind === "eol" ? "/" : `${t.text}:${t.syllabic}`)), ["[G]", "你:single", "好:single", "[D]", "world:begin", "wide:end", "/"]);
});

test("套用：字按顺序落在有音高的音上，和弦落在下一个字的音上", () => {
  const score = base([n(60), n(null), n(62), n(64), n(65), n(67), n(69), n(71)], { chordSymbols: [{ at: 7, symbol: "B" }] });
  const r = applyChordPro(score, "[C]我爱[G]你，\n[Am]中国\n");
  assert.deepEqual(r.score.notes.map((x) => x.lyric?.text ?? ""), ["我", "", "爱", "你，", "中", "国", "", ""]);
  assert.deepEqual(r.score.chordSymbols, [{ at: 0, symbol: "C" }, { at: 3, symbol: "G" }, { at: 4, symbol: "Am" }]);
  assert.equal(r.syllables, 5);
  assert.ok(r.notes.some((x) => x.includes("还有 2 个音")));
  assert.equal(score.notes[0].lyric, undefined, "input not mutated");
});

test("套用：只有和弦的行一小节一个；字多于音记损失；读不懂的和弦记损失", () => {
  const score = base(Array.from({ length: 16 }, () => n(60)));
  const r = applyChordPro(score, "[C] [G] [Xyz]\n啊啊啊啊\n");
  assert.deepEqual(r.score.chordSymbols, [{ at: 0, symbol: "C" }, { at: 4, symbol: "G" }]);
  assert.ok(r.losses.some((l) => l.includes("Xyz")));
  assert.equal(r.score.notes[12].lyric?.text, "啊", "words start after the three chord bars (an unreadable chord still takes its bar)");
  assert.equal(r.score.notes[11].lyric, undefined);
  const many = applyChordPro(base([n(60), n(62)]), "一二三四");
  assert.ok(many.losses.some((l) => l.includes("2 个字")));
});

test("导出再套用：歌词与和弦不变", () => {
  const score = base([n(60, 1, "春"), n(62, 1, "眠"), n(64, 1, "不"), n(65, 1, "觉"), n(67, 2, "晓，"), n(null, 2), n(69, 1, "处"), n(67, 1, "处"), n(65, 2, "闻")], {
    chordSymbols: [{ at: 0, symbol: "C" }, { at: 2, symbol: "Am7" }, { at: 8, symbol: "Dm" }, { at: 10, symbol: "G7" }],
  });
  const text = exportChordPro(score).text;
  const back = applyChordPro({ ...score, chordSymbols: undefined, notes: score.notes.map(({ lyric, ...rest }) => (void lyric, rest)) }, text);
  assert.deepEqual(back.losses, []);
  assert.deepEqual(back.score.notes.map((x) => x.lyric?.text ?? ""), score.notes.map((x) => x.lyric?.text ?? ""));
  assert.deepEqual(back.score.chordSymbols, score.chordSymbols);
});

test("没有旋律或没有内容时报错，现有谱不动", () => {
  assert.throws(() => applyChordPro(base([n(null, 4)]), "[C]啊"), /先写好旋律/);
  assert.throws(() => applyChordPro(base([n(60)]), "{title: x}\n"), /没在这段文字里读到/);
});
