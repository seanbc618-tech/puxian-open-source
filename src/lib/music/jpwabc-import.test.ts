import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { importJpwabc } from "./jpwabc-import.ts";
const fixture = readFileSync(
  new URL("./fixtures/jpwabc/basic.jpwabc.txt", import.meta.url),
  "utf8",
);
const wrap = (voice: string, extra = "") =>
  `.Title\nTitle = {测试}\nKeyAndMeters = {1=B,4/4}\nExpression = {♩=90}\n.Voice\n${voice}\n${extra}`;
test("UTF-16LE BOM / CRLF 与字符串导入关键语义一致", () => {
  const bytes = Buffer.concat([
    Buffer.from([255, 254]),
    Buffer.from(fixture.replace(/\n/g, "\r\n"), "utf16le"),
  ]);
  const { score, warnings } = importJpwabc(bytes);
  assert.deepEqual(score, importJpwabc(fixture).score);
  assert.equal(score.title, "中文合成练习");
  assert.equal(score.key, "G");
  assert.equal(score.beats, 3);
  assert.equal(score.beatUnit, 4);
  assert.equal(score.bpm, 76);
  assert.deepEqual(
    score.notes.map((n) => n.dur),
    [1.5, 0.5, 1, 1, 1, 1, 1, 1, 1],
  );
  assert.deepEqual(
    score.notes.map((n) => n.pitches),
    [[67], [69], [71], [], [84], [62], [73], [77], [72]],
  );
  assert.deepEqual(
    score.notes.map((n) => n.lyric?.text),
    ["春", "天", "你好", undefined, "山", undefined, "水", undefined, undefined],
  );
  assert.equal(score.voice2, undefined);
  assert.deepEqual(warnings, []);
  assert.deepEqual(
    importJpwabc(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)).score,
    score,
  );
});
test("UTF-8 误开、损坏编码及非法文本拒绝", () => {
  for (const value of [
    new TextEncoder().encode(fixture),
    new Uint8Array([255, 254, 0]),
    "1 2 3",
    ".Voice\n垃圾",
    ".Voice\n0 0",
  ])
    assert.throws(() => importJpwabc(value), /UTF|段头|记号|主旋律/);
});
test("B 调低八度、时值、附点与休止", () => {
  const { score } = importJpwabc(wrap("1 2' 3, 0__ 4-- 5._ 6_.."));
  assert.equal(score.tonicOctave, 3);
  assert.deepEqual(
    score.notes.slice(0, 3).map((n) => n.pitches),
    [[59], [73], [51]],
  );
  assert.deepEqual(
    score.notes.map((n) => n.dur),
    [1, 1, 1, 0.25, 3, 0.75, 0.875],
  );
});
test("反复、多段词、排版给出中文损失", () => {
  const { score, warnings } = importJpwabc(
    wrap(
      "|: (1 2) :| $(true)",
      ".Words\nW1@1,1:你/\nW2@1,1:我们\n.Repeat\n0-1V1\n.Layout\nLinesPerPage = {4}",
    ),
  );
  assert.equal(score.notes.length, 2);
  assert.equal(score.notes[0].lyric?.text, "你");
  for (const text of ["反复", "第 1 段", "版式", "演唱顺序"])
    assert.ok(warnings.some((w) => w.includes(text)));
});
test("等音调号归一化保留跨八度音高与 B、bB 规则", () => {
  for (const [rawKey, key, octave, midi] of [
    ["#B", "C", 4, 60],
    ["bC", "B", 3, 59],
    ["B", "B", 3, 59],
    ["bB", "Bb", 3, 58],
  ] as const) {
    const { score } = importJpwabc(wrap("1").replace("1=B,", `1=${rawKey},`));
    assert.equal(score.key, key);
    assert.equal(score.tonicOctave, octave);
    assert.deepEqual(score.notes[0].pitches, [midi]);
  }
});
test("歌词槽包含 / 占位，任何重复占用均拒绝", () => {
  for (const [first, second] of [["/你", "春"], ["/你", "/"], ["春", "/"], ["春", "你"]]) {
    assert.throws(
      () => importJpwabc(wrap("1 2", `.Words\nW1@1,1:${first}\nW1@1,1:${second}`)),
      /重叠/,
    );
  }
});
test("多声部与不能可靠转换的音乐拒绝，不静默丢主旋律", () => {
  for (const voice of ["1 [35]", "1 {(3}2 3 4", '1 "1=A" 2', "1 3/4 2", "1 {6}2", "1 x"])
    assert.throws(() => importJpwabc(wrap(voice)), /不支持/);
  assert.throws(() => importJpwabc(wrap("1 2", ".Voice\n3 4")), /重复/);
  assert.throws(() => importJpwabc(wrap("1", ".Words\nW1@1,1:你好")), /超出/);
});

test("歌词小节定位、CRLF、休止占位、分组标点与换行", () => {
  const { score } = importJpwabc(wrap("0 1 $ 2 3", ".Words\nW1@1,1:/{hello}，\nW1@2,1:你/"));
  assert.equal(score.notes[1].lyric?.text, "hello，");
  assert.equal(score.notes[2].lyric?.text, "你");
  assert.throws(() => importJpwabc(wrap("0 1", ".Words\nW1@1,1:你")), /休止/);
  assert.throws(() => importJpwabc(wrap("1 2", ".Words\nW1@1,1:{你[2]}")), /分组/);
  assert.throws(() => importJpwabc(wrap("1 2", ".Words\nW1@1,1:{你")), /分组/);
});
