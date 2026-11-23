import assert from "node:assert/strict";
import { it } from "node:test";
import { transposeScore } from "../music/theory.ts";
import { setKeyChange } from "../music/key-mark.ts";
import { kernSystemsToMusicXml, kernSystemsToScore as convertKern } from "./kern.ts";
import { musicXmlToScore } from "../music/musicxml.ts";
const kernSystemsToScore = (systems: string[], title: string) =>
  convertKern(systems, title, musicXmlToScore);
const scale = `**kern\t**kern
*clefF4\t*clefG2
*k[]\t*k[]
*M4/4\t*M4/4
=1\t=1
1C\t4c
.\t4d
.\t4e
.\t4f
=2\t=2
1D\t1g
==\t==
*-\t*-`;
it("original kern converter preserves independent grandstaff pitches/durations through MusicXML", () => {
  const result = kernSystemsToScore([scale], "自编练习");
  assert.equal(result.score.beats, 4);
  assert.equal(result.score.clef, "treble");
  assert.equal(result.score.key, "C");
  assert.deepEqual(
    result.score.voice2!.map((n) => [n.pitches, n.dur]),
    [
      [[48], 4],
      [[50], 4],
    ],
  );
  assert.deepEqual(
    result.score.notes.slice(0, 4).map((n) => [n.pitches, n.dur]),
    [
      [[60], 1],
      [[62], 1],
      [[64], 1],
      [[65], 1],
    ],
  );
  assert.deepEqual(result.score.measureEnds, [4, 8]);
  const { xml } = kernSystemsToMusicXml([scale], "a<&");
  assert.match(xml, /a&lt;&amp;/);
  assert.equal(musicXmlToScore(xml, "test").score.notes.length, 5);
});
it("joins systems as ordered measures and accepts released model ekern header", () => {
  const r = kernSystemsToScore([scale.replaceAll("**kern", "**ekern_1.0"), scale], "test");
  assert.deepEqual(r.score.measureEnds, [4, 8, 12, 16]);
});
it("fails honestly on malformed rhythms, missing headers and unsupported grace notes", () => {
  assert.throws(() => kernSystemsToScore(["4c"], "test"), /表头/);
  assert.throws(
    () => kernSystemsToScore([scale.replace(".\t4d", "4C\t4d")], "test"),
    /节奏无法对齐/,
  );
  assert.throws(() => kernSystemsToScore([scale.replace("4c", "8cq")], "test"), /时值/);
});

it("preserves minor key and reports missing key/meter instead of claiming detection", () => {
  const minor = kernSystemsToScore(
    [scale.replace("*M4/4\t*M4/4", "*a:\t*a:\n*M6/8\t*M6/8")],
    "minor",
  );
  assert.equal(minor.score.mode, "minor");
  assert.equal(minor.score.key, "A");
  assert.equal(minor.score.beats, 6);
  const incomplete = kernSystemsToScore(
    [scale.replace("*k[]\t*k[]\n", "").replace("*M4/4\t*M4/4\n", "")],
    "missing",
  );
  assert.ok(incomplete.losses.some((x) => x.includes("未识别到拍号")));
  assert.ok(incomplete.losses.some((x) => x.includes("未识别到调号")));
});

it("multi-page import supports existing whole-score transpose and mid-score keys in all voices", () => {
  const { score } = kernSystemsToScore([scale, scale, scale], "three pages");
  assert.equal(
    score.changes?.length ?? 0,
    0,
    "repeated page headers must not reset mid-score edits",
  );
  const shifted = transposeScore(score, 2);
  assert.equal(shifted.key, "D");
  for (const name of ["notes", "voice2"] as const) {
    assert.deepEqual(
      shifted[name]?.map((n) => n.pitches),
      score[name]?.map((n) => n.pitches.map((p) => p + 2)),
    );
  }
  assert.deepEqual(shifted.measureEnds, [4, 8, 12, 16, 20, 24]);
  const marked = setKeyChange(score, 8, "G", "major");
  assert.ok(marked.changes?.some((c) => c.at === 8 && c.key === "G"));
  assert.equal(marked.key, "C");
  assert.deepEqual(marked.notes, score.notes);
});

it("keeps actual page-boundary key and meter changes while dropping repeated declarations", () => {
  const changed = scale.replaceAll("*k[]", "*k[f#]").replaceAll("*M4/4", "*M3/4");
  const { score } = kernSystemsToScore([scale, changed, changed], "key changes");
  assert.equal(score.changes?.length, 1);
  assert.equal(score.changes?.[0].at, 8);
  assert.equal(score.changes?.[0].key, "G");
  assert.equal(score.changes?.[0].beats, 3);
  const shifted = transposeScore(score, 2);
  assert.equal(shifted.changes?.[0].key, "A");
});

it("recovers the actual c_major_simple.png feedback output without hiding rhythm repair", async () => {
  const { readFileSync } = await import("node:fs");
  const raw = readFileSync(new URL("./fixtures/c-major-feedback.krn", import.meta.url), "utf8");
  assert.throws(() => kernSystemsToScore([raw], "反馈"), /节奏无法对齐/);
  const recovered = convertKern([raw], "反馈", musicXmlToScore, { recover: true });
  assert.equal(recovered.score.measureEnds?.length, 4);
  assert.ok(recovered.score.notes.some((n) => n.pitches.length));
  assert.ok(recovered.score.voice2?.some((n) => n.pitches.length));
  assert.ok(recovered.losses.some((l) => l.includes("节奏冲突") && l.includes("顺延")));
  assert.deepEqual(recovered.included, [0]);
});

it("keeps a valid system prefix and later systems when a middle symbol is unsupported", () => {
  const broken = scale.replace("1D\t1g", "8qC\t8qg");
  const recovered = convertKern([scale, broken, scale], "部分", musicXmlToScore, {
    recover: true,
    labels: ["第 1 页 / 第 1 个系统", "第 1 页 / 第 2 个系统", "第 2 页 / 第 1 个系统"],
  });
  assert.deepEqual(recovered.score.measureEnds, [4, 8, 12, 16, 20]);
  assert.ok(
    recovered.losses.some((l) => l.includes("第 1 页 / 第 2 个系统") && l.includes("未导入")),
  );
  assert.deepEqual(recovered.included, [0, 1, 2]);
});

it("omits only unconvertible systems and preserves their exact locations", () => {
  const recovered = convertKern(["garbage", scale], "部分", musicXmlToScore, {
    recover: true,
    labels: ["第 1 页 / 第 6 个系统", "第 2 页 / 第 1 个系统"],
  });
  assert.deepEqual(recovered.included, [1]);
  assert.deepEqual(recovered.score.measureEnds, [4, 8]);
  assert.ok(
    recovered.losses.some((l) => l.includes("第 1 页 / 第 6 个系统") && l.includes("没有可转换")),
  );
});

it("partial page/system failures keep ordered drafts and exclude failed regions honestly", async () => {
  const { compileRecognition } = await import("./recognition.ts");
  const result = compileRecognition(
    [
      { page: 3, system: 1, text: scale, complete: true },
      { page: 1, system: 2, text: scale, complete: false, error: "模型长度限制，尾部未识别" },
      { page: 1, system: 1, text: scale, complete: true },
    ],
    [
      { page: 1, done: true, warnings: [] },
      { page: 2, done: true, error: "本页谱表定位失败", warnings: [] },
      { page: 3, done: true, warnings: [] },
    ],
    "部分草稿",
    musicXmlToScore,
  );
  assert.ok(result.draft);
  assert.equal(result.draft.partial, true);
  assert.deepEqual(result.draft.pages, [1, 3]);
  assert.equal(result.draft.systems, 3);
  assert.deepEqual(result.draft.score.measureEnds, [4, 8, 12, 16, 20, 24]);
  assert.ok(result.issues.some((l) => l.includes("第 2 页") && l.includes("定位失败")));
  assert.ok(
    result.issues.some((l) => l.includes("第 1 页 / 第 2 个系统") && l.includes("尾部未识别")),
  );
});

it("local staff rectification concentrates tilted curved lines under a paper shadow", async () => {
  const { flattenStaffImage } = await import("./preprocess.ts");
  const w = 480,
    h = 180;
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const paper = Math.round(245 - (70 * x) / w);
      const shift = Math.round((x - w / 2) * 0.016 + 2 * Math.sin((x / w) * Math.PI));
      const line = [35, 43, 51, 59, 67, 105, 113, 121, 129, 137].includes(y - shift);
      const i = (y * w + x) * 4;
      rgba[i] = rgba[i + 1] = rgba[i + 2] = line && x > 15 && x < w - 15 ? 25 : paper;
      rgba[i + 3] = 255;
    }
  const out = flattenStaffImage(rgba, w, h);
  const rows = Array.from({ length: h }, (_, y) => {
    let n = 0;
    for (let x = 0; x < w; x++) if (out[(y * w + x) * 4] < 128) n++;
    return n;
  });
  assert.ok(
    rows.filter((n) => n > w * 0.6).length >= 10,
    "ten long staff lines survive local shadow and curvature",
  );
  assert.ok(rows.reduce((s, n) => s + n, 0) < w * 15, "paper shadow must not become ink");
});

it("keeps clean scan anti-aliasing unchanged for the original staff locator", async () => {
  const { flattenStaffImage } = await import("./preprocess.ts");
  const w = 400,
    h = 180;
  const rgba = new Uint8ClampedArray(w * h * 4).fill(255);
  for (const y of [35, 43, 51, 59, 67, 105, 113, 121, 129, 137])
    for (let x = 15; x < w - 15; x++) {
      const i = (y * w + x) * 4;
      rgba[i] = rgba[i + 1] = rgba[i + 2] = 20;
    }
  // A faint symbol edge must survive the clean-scan bypass pixel for pixel.
  rgba[(25 * w + 20) * 4] = 180;
  const before = rgba.slice();
  assert.equal(flattenStaffImage(rgba, w, h), rgba);
  assert.deepEqual(rgba, before);
});
