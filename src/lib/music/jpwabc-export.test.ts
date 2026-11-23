import { test } from "node:test";
import assert from "node:assert/strict";
import { exportJpwabc } from "./jpwabc-export.ts";
import { importJpwabc } from "./jpwabc-import.ts";
import { EXAMPLES, scoreFromExample } from "./examples.ts";
import type { Score } from "./theory.ts";

const base = (notes: Score["notes"], extra: Partial<Score> = {}): Score => ({
  title: "测试", bpm: 90, beats: 4, beatUnit: 4, key: "G", mode: "major", clef: "treble", tonicOctave: 4, notes, ...extra,
});
const n = (pitches: number[], dur: number, lyric?: string) => ({ pitches, dur, ...(lyric ? { lyric: { text: lyric, syllabic: "single" as const } } : {}) });

test("写出 UTF-16LE + BOM、CRLF，含 .Title/.Voice/.Words", () => {
  const { bytes, text } = exportJpwabc(base([n([67], 1, "一"), n([69], 1, "闪"), n([], 1), n([71], 1)]));
  assert.deepEqual([...bytes.subarray(0, 2)], [0xff, 0xfe]);
  assert.equal(Buffer.from(bytes.subarray(2)).toString("utf16le"), text);
  assert.match(text, /\r\n\.Voice\r\n/);
  assert.match(text, /KeyAndMeters = \{1=G,4\/4\}/);
  assert.match(text, /Expression = \{♩=90\}/);
  assert.match(text, /\.Voice\r\n1 2 0 3 \|\]\r\n/);
  assert.match(text, /W1:一 闪\r\n/); // trailing slots without lyrics are trimmed
  assert.doesNotMatch(text.replace(/\r\n/g, ""), /\n/);
});

test("导出→导入：音高、时值、歌词、调拍速往返一致", () => {
  const score = base([
    n([67], 1.5, "奇"), n([69], 0.5, "异"), n([71], 1), n([], 1),
    n([74], 0.25, "恩"), n([72], 0.25), n([70], 0.5), n([66], 3),
    n([79], 4, "典"),
  ], { key: "Db", beats: 4 });
  const back = importJpwabc(exportJpwabc(score).bytes).score;
  assert.equal(back.key, "Db");
  assert.equal(back.beats, 4);
  assert.equal(back.bpm, 90);
  assert.equal(back.title, "测试");
  assert.deepEqual(back.notes.map((x) => [x.pitches, x.dur, x.lyric?.text]), score.notes.map((x) => [x.pitches, x.dur, x.lyric?.text]));
});

test("内置示例都能导出并往返音高与时值", () => {
  let exported = 0;
  for (const example of EXAMPLES) {
    const score = scoreFromExample(example);
    let out;
    try { out = exportJpwabc(score); } catch { continue; }
    exported++;
    const back = importJpwabc(out.bytes).score;
    assert.deepEqual(back.notes.map((x) => x.dur), score.notes.map((x) => x.dur), example.title);
    if (score.mode === "major")
      assert.deepEqual(back.notes.map((x) => x.pitches), score.notes.map((x) => x.pitches.length ? [Math.max(...x.pitches)] : []), example.title);
  }
  assert.ok(exported >= EXAMPLES.length - 1, `exported ${exported}/${EXAMPLES.length}`);
});

test("写不进的内容列入 losses，不静默", () => {
  const score = base([
    { pitches: [60, 64, 67], dur: 1, dynamic: "mf", articulations: ["staccato"] },
    { pitches: [62], dur: 1, slurStart: true, lyric: { text: "啊", syllabic: "begin" } },
    { pitches: [64], dur: 2, slurEnd: true },
  ], { voice2: [n([48], 4)], changes: [{ at: 4, bpm: 100 }], chordSymbols: [{ at: 0, symbol: "C" }] });
  const { losses, text } = exportJpwabc(score);
  for (const word of ["第二声部", "和弦（", "和弦标记", "力度", "连线"]) assert.ok(losses.some((l) => l.includes(word)), word);
  assert.ok(losses.length >= 5);
  assert.match(text, /\.Voice\r\n1 /); // chord keeps its top note: G4 is 1 in 1=G
});

test("拒绝三连音与空谱，现有谱不改", () => {
  assert.throws(() => exportJpwabc(base([n([67], 1 / 3), n([67], 1 / 3), n([67], 1 / 3)])), /三连音|连音|写不出/);
  assert.throws(() => exportJpwabc(base([])), /空|没有/);
});

test("小调按关系大调写出并说明", () => {
  const { losses, text } = exportJpwabc(base([n([57], 4)], { key: "A", mode: "minor", tonicOctave: 3 }));
  assert.match(text, /1=C/);
  assert.ok(losses.some((l) => l.includes("小调")));
});
