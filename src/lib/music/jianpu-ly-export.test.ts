import test from "node:test";
import assert from "node:assert/strict";
import { scoreToJianpuLy } from "./jianpu-ly-export.ts";
import { type Score, type ScoreNote } from "./theory.ts";
const n = (pitch: number | null, dur = 1): ScoreNote => ({
  pitches: pitch == null ? [] : [pitch],
  dur,
});
const score = (notes: ScoreNote[], extra: Partial<Score> = {}): Score => ({
  title: "小星星",
  bpm: 88,
  beats: 4,
  beatUnit: 4,
  key: "C",
  mode: "major",
  clef: "treble",
  tonicOctave: 4,
  notes,
  ...extra,
});

test("小星星：标题、调号、拍号、速度、延音", () => {
  const result = scoreToJianpuLy(score([n(60), n(60), n(67), n(67), n(69), n(69), n(67, 2)]));
  assert.match(result.text, /^title=小星星\n1=C 4\/4 4=88\n1 1 5 5 6 6 5 -\n$/);
  assert.deepEqual(result.warnings, []);
});
test("休止、附点、八度、升降与跨小节延音", () => {
  const result = scoreToJianpuLy(score([n(null, 0.5), n(61, 0.75), n(72, 0.25), n(48, 4.5)]));
  assert.match(result.text, /q0 q#1\. s1' 1, c-\. - -/);
});
test("附点六十四分音符导出 h1.，补休止不修改原曲", () => {
  const input = score([n(60, 0.09375)]);
  const before = JSON.stringify(input);
  const result = scoreToJianpuLy(input);
  assert.equal(result.text, "title=小星星\n1=C 4/4 4=88\nh1. 0 0 0 q0. h0. h0\n");
  assert.ok(result.warnings.some((w) => w.includes("补齐")));
  assert.equal(JSON.stringify(input), before);
});
test("附点六十四分偏移后的跨小节音保留时值与延音", () => {
  for (const pitch of [64, null]) {
    const input = score([n(60, 0.09375), n(62, 3.875), n(pitch, 0.0625)]);
    const before = JSON.stringify(input);
    const result = scoreToJianpuLy(input);
    const tiny = "\\".repeat(5);
    assert.equal(
      result.text,
      `title=小星星\n1=C 4/4 4=88\nh1. 2 - - q-. d- ${pitch == null ? "0" : "3"}${tiny} ${pitch == null ? "0" : "-"}${tiny} 0 0 0 q0. d0 h0.\n`,
    );
    // Decode exported durations independently: both bars must total exactly 4 beats.
    let elapsed = 0;
    for (const token of result.text.split("\n")[2].split(" ")) {
      const beams = (token.match(/\\/g) ?? []).length;
      const prefix = "cqsdh".indexOf(token[0]);
      const dur = 2 ** -(beams || Math.max(prefix, 0)) * (token.endsWith(".") ? 1.5 : 1);
      assert.ok(elapsed % 4 + dur <= 4);
      elapsed += dur;
    }
    assert.equal(elapsed, 8);
    assert.doesNotMatch(result.text, /(?:^|\s)-\.(?:\s|$)/);
    assert.equal(JSON.stringify(input), before);
  }
});
test("两个 part 独立时间线，补齐末小节，不修改原曲", () => {
  const input = score([n(60, 5)], { voice2: [n(null, 1), n(55)] });
  const before = JSON.stringify(input);
  const result = scoreToJianpuLy(input);
  assert.match(result.text, /1 - - - - 0 0 0\nNextPart\n1=C 4\/4 4=88\n0 5, 0 0 0 0 0 0/);
  assert.ok(result.warnings.some((w) => w.includes("补齐")));
  assert.equal(JSON.stringify(input), before);
});
test("H 歌词：休止不占位，空音节、汉字组合和延音", () => {
  const input = score([
    n(null),
    { ...n(60, 2), lyric: { text: "星星", syllabic: "single" } },
    n(62),
    { ...n(64), lyric: { text: "亮", syllabic: "single" } },
  ]);
  assert.match(scoreToJianpuLy(input).text, /H: 星_星 "" 亮/);
});
test("小调按 la 表示；移调默认记谱音高，concert 保留实际音高", () => {
  const input = score([n(69, 4)], { key: "A", mode: "minor" });
  assert.match(scoreToJianpuLy(input).text, /6=A.*\n6 - - -/);
  assert.match(scoreToJianpuLy(input, { instrumentShift: 2 }).text, /6=B.*\n6 - - -/);
  assert.equal(
    scoreToJianpuLy(input, { instrumentShift: 2, pitch: "concert" }).text,
    scoreToJianpuLy(input).text,
  );
  assert.match(scoreToJianpuLy(score([n(60, 4)]), { instrumentShift: 2 }).text, /1=D.*\n1 - - -/);
});
test("不支持的关键音符拒绝导出；表情损失明确提示；文字不能注入命令", () => {
  assert.throws(() => scoreToJianpuLy(score([{ pitches: [60, 64], dur: 1 }])), /和弦/);
  assert.throws(() => scoreToJianpuLy(score([n(60, 1 / 3)])), /三连音/);
  assert.throws(() => scoreToJianpuLy(score([n(60, 1 / 6)])), /三连音/);
  assert.throws(() => scoreToJianpuLy(score([n(60, 0.03125)])), /六十四分/);
  const result = scoreToJianpuLy(
    score([{ ...n(60, 4), dynamic: "p" }], { title: '歌\nLP: \\include "bad"' }),
  );
  assert.ok(result.warnings.some((w) => w.includes("力度")));
  assert.doesNotMatch(result.text, /\nLP:|\\include|"bad"/);
});

test("导出延长和渐快/渐慢：\\fermata 与 ^\"rit.\" / ^\"accel.\"", () => {
  const input = score([n(60), n(62), n(64), n(65), n(67), n(69), n(71), n(72)], {
    fermatas: [{ voice: 0, at: 0 }],
    gradualTempos: [
      { from: 2, to: 6, kind: "rit", toBpm: 60 },
    ],
  } as Partial<Score>);
  const result = scoreToJianpuLy(input);
  assert.match(result.text, /1 \\fermata/);
  assert.match(result.text, /\^"rit\.=60"/);
  assert.match(result.text, /\^"a tempo"/);
  assert.ok(!result.warnings.some((w) => /延长|渐快|渐慢/.test(w)), result.warnings.join(" / "));
});
