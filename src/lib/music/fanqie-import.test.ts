import { test } from "node:test";
import assert from "node:assert/strict";
import { importFanqie, sniffFanqie } from "./fanqie-import.ts";

const head = (body: string) => `V: 1.0\nB: 测试\nD: C\nP: 4/4\nJ: 90\n${body}\n`;
const notes = (body: string) => importFanqie(head(body)).score.notes;

test("头字段：标题、调、拍号、速度", () => {
  const { score } = importFanqie("V: 1.0\nB: 小星星\nD: bE\nP: 3/4\nJ: 76\nQ: 1 2 3 |\n");
  assert.equal(score.title, "小星星");
  assert.equal(score.key, "Eb");
  assert.equal(score.beats, 3);
  assert.equal(score.bpm, 76);
});

test("后缀：' , 八度，# $ = 升降还原，/ 减半，. 附点，- 延长", () => {
  assert.deepEqual(notes("Q: 1' 1, 4# 4= | 5/ 5/ 6. 7/ 1 |").map((n) => [n.pitches[0], n.dur]),
    [[72, 1], [48, 1], [66, 1], [65, 1], [67, 0.5], [67, 0.5], [69, 1.5], [71, 0.5], [60, 1]]);
  assert.deepEqual(notes("Q: 1 - - 0 |").map((n) => n.dur), [3, 1]);
});

test("同音圆滑线合并为长音；& 指令写入力度与奏法", () => {
  const ns = notes("Q: (3 3) 5&mf 6&dy |");
  assert.deepEqual(ns.map((n) => n.dur), [2, 1, 1]);
  assert.equal(ns[1].dynamic, "mf");
  assert.deepEqual(ns[2].articulations, ["staccato"]);
});

test("倚音 1[2] 写入 ornament", () => {
  const n = notes("Q: 1[2] 2 3 4 |")[0];
  assert.equal(n.ornament, "grace");
  assert.equal(n.gracePitch, 62);
});

test("歌词：C 行跟随最近的 Q 行，跳过休止，只取第 1 段", () => {
  const r = importFanqie(head("Q: 1 2 0 3 | 4 5 6 7 |\nC: 一闪亮晶晶\nC2: 第二段"));
  assert.deepEqual(r.score.notes.map((n) => n.lyric?.text ?? null), ["一", "闪", null, "亮", "晶", "晶", null, null]);
  assert.ok(r.losses.some((l) => l.includes("第 2 段")));
});

test("Q2 进 voice2，Q3 起列入丢失", () => {
  const r = importFanqie(head("Q1: 1 2 3 4 |\nQ2: 5, - 5, - |\nQ3: 1 1 1 1 |"));
  assert.deepEqual(r.score.voice2?.map((n) => [n.pitches[0], n.dur]), [[55, 2], [55, 2]]);
  assert.ok(r.losses.length > 0);
});

test("诗歌本方言被识别并拒绝，番茄方言被识别", () => {
  assert.equal(sniffFanqie(head("Q: 1 2 3 |")), "tomato");
  const shige = "T: 诗歌\nXL: 1=C\nFontSize: 12\n1 = C\n1 2 3 |\n";
  assert.equal(sniffFanqie(shige), "shige");
  assert.throws(() => importFanqie(shige), /诗歌本/);
});

test("编码：UTF-16 与没有音符的文本拒绝", () => {
  assert.throws(() => importFanqie(new Uint8Array([0xff, 0xfe, 0x31, 0])), /UTF/);
  assert.throws(() => importFanqie(head("Q: 0 0 0 0 |")));
});

test("弱起小节前补休止，Q2 同步补齐", () => {
  const r = importFanqie(head("Q1: 5, | 1 2 3 4 |\nQ2: 0 | 1, - - - |"));
  assert.deepEqual(r.score.notes.slice(0, 2).map((n) => [n.pitches, n.dur]), [[[], 3], [[55], 1]]);
  assert.deepEqual(r.score.voice2?.slice(0, 2).map((n) => n.dur), [3, 1]);
});

test("和弦记号 hx: 进 chordSymbols，弱起时一起后移", () => {
  const r = importFanqie(head('Q: "hx:C"1 2 "hx:G7"5 5 | "hx:C"1 - - - |'));
  assert.deepEqual(r.score.chordSymbols, [{ at: 0, symbol: "C" }, { at: 2, symbol: "G7" }, { at: 4, symbol: "C" }]);
  const p = importFanqie(head('Q: "hx:G"5, | "hx:C"1 2 3 4 |'));
  assert.deepEqual(p.score.chordSymbols?.map((c) => c.at), [3, 4]);
});

import { canonicalFermatas } from "./fermata.ts";
import { canonicalGradualTempos, type ScoreWithGradual } from "./gradual-tempo.ts";

test("番茄 &yc 延长和 &rit / &atempo 用语写入谱面，不再列入丢失", () => {
  const r = importFanqie(head("Q: 1&yc 2 3&rit 4 | 5 6 7&atempo 0 |\n"));
  assert.deepEqual(canonicalFermatas(r.score.fermatas), [{ voice: 0, at: 0 }]);
  const spans = canonicalGradualTempos((r.score as ScoreWithGradual).gradualTempos) ?? [];
  assert.equal(spans.length, 1);
  assert.equal(spans[0]!.kind, "rit");
  assert.ok(Math.abs(spans[0]!.from - 2) < 1e-6, String(spans[0]!.from));
  assert.ok(Math.abs(spans[0]!.to - 6) < 1e-6, String(spans[0]!.to));
  assert.ok(!r.losses.some((l) => /延长|速度与表情|rit/.test(l)), r.losses.join(" / "));
});
