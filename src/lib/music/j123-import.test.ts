import { test } from "node:test";
import assert from "node:assert/strict";
import { import123, parse123Key } from "./j123-import.ts";

const head = (body: string, extra = "") => `%123-1.0\nX:1\nT:测试\nK:1=C\nM:4/4\nQ:1/4=90\n${extra}${body}\n`;
const pitches = (src: string) => import123(src).score.notes.map((n) => n.pitches.join("+") || "0");
const durs = (src: string) => import123(src).score.notes.map((n) => n.dur);

test("头字段：标题、调、拍号、速度，中文别名与全角冒号", () => {
  const { score } = import123("标题：小星星\n调：1=bE\n拍号：3/4\n速度：1/4=72\n1 2 3 |\n");
  assert.equal(score.title, "小星星");
  assert.equal(score.key, "Eb");
  assert.equal(score.beats, 3);
  assert.equal(score.bpm, 72);
});

test("音高：八度、升降、小节内按级数沿用、B 调主音八度", () => {
  assert.deepEqual(pitches(head("1 1' 1, 1'' | #4 4 n4 4 | 4 |")), ["60", "72", "48", "84", "66", "66", "65", "65", "65"]);
  const b = import123("K:1=B\nM:4/4\n1 2 3 4 |\n").score;
  assert.equal(b.notes[0].pitches[0], 59);
});

test("时值：下划线减半、附点、延音线、三连音、休止", () => {
  assert.deepEqual(durs(head("1_ 2__ 3__ 4. 5_ 1 | 6- - 0 |")), [0.5, 0.25, 0.25, 1.5, 0.5, 1, 3, 1]);
  const t = durs(head("(3:1_ 2_ 3_) 4 5 6 |"));
  assert.ok(Math.abs(t[0] - 1 / 3) < 1e-9 && Math.abs(t[2] - 1 / 3) < 1e-9);
});

test("同音弧线合并为一个长音（谱线没有单独的连音线概念）", () => {
  assert.deepEqual(durs(head("1 2 3 3~ | 3 4 5 6 |")), [1, 1, 1, 2, 1, 1, 1]);
});

test("和弦、力度、装饰音", () => {
  const { score } = import123(head("[135] !mf!2 {3}4 5 |"));
  assert.deepEqual(score.notes[0].pitches, [60, 64, 67]);
  assert.equal(score.notes[1].dynamic, "mf");
  assert.equal(score.notes[2].ornament, "grace");
});

test("歌词：每个汉字一个音，跳过休止，- 连字、/ 跳过，只取第 1 段", () => {
  const r = import123(head("1 2 0 3 | 4 5 6 7 |\nw:一闪/亮 晶晶\nw:第二段歌词"));
  assert.deepEqual(r.score.notes.map((n) => n.lyric?.text ?? null), ["一", "闪", null, null, "亮", "晶", "晶", null]);
  assert.ok(r.losses.some((l) => l.includes("第 2 段")));
});

test("第二声部（V:2 与 &）进入 voice2，第三声部列入丢失", () => {
  const r = import123(head("V:1\n1 2 3 4 |\nV:2\n5, 6, 7, 1 |\nV:3\n1 1 1 1 |"));
  assert.deepEqual(r.score.voice2?.map((n) => n.pitches[0]), [55, 57, 59, 60]);
  assert.ok(r.losses.some((l) => l.includes("第三声部")));
  const amp = import123(head("1 2 3 4 & 5, - 5, - |")).score;
  assert.deepEqual(amp.voice2?.map((n) => n.dur), [2, 2]);
});

test("反复、跳房子列入丢失，和弦记号进 chordSymbols；行内变拍变速写进 changes", () => {
  const r = import123(head('|: "C"1 2 3 4 :| [1 5 5 5 5 | [M:3/4] [Q:1/4=120] 1 2 3 |]'));
  assert.ok(r.losses.some((l) => l.includes("反复")));
  assert.ok(r.score.changes?.some((c) => c.beats === 3 && c.bpm === 120));
  assert.deepEqual(r.score.chordSymbols, [{ at: 0, symbol: "C" }]);
});

test("小调：key 为主音，mode=minor", () => {
  assert.deepEqual(parse123Key("1=A minor")?.mode ?? parse123Key("A minor")?.mode, "minor");
  assert.equal(parse123Key("1=Z"), null);
});

test("编码：UTF-8（含 BOM）可读；UTF-16 与无音符拒绝", () => {
  const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(head("1 2 3 4 |"))]);
  assert.equal(import123(bytes).score.notes.length, 4);
  assert.throws(() => import123(new Uint8Array([0xff, 0xfe, 0x31, 0])), /UTF-16|UTF-8/);
  assert.throws(() => import123(head("0 0 0 0 |")));
});

test("调号写法：1=G、Em、6=E、A minor、带谱号词", () => {
  assert.deepEqual(parse123Key("1=G") && [parse123Key("1=G")!.key, parse123Key("1=G")!.mode], ["G", "major"]);
  assert.equal(parse123Key("Em")?.mode, "minor");
  assert.equal(parse123Key("Em")?.key, "E");
  assert.equal(parse123Key("6=E")?.key, "E");
  assert.equal(parse123Key("C treble")?.key, "C");
  assert.equal(parse123Key("Cxyz"), null);
});

test("弱起小节前补休止，小节线对齐，变化点随之后移", () => {
  const r = import123(head("5, | 1 2 3 4 | [Q:1/4=100] 5 6 7 1' |"));
  assert.deepEqual(r.score.notes.slice(0, 2).map((n) => [n.pitches, n.dur]), [[[], 3], [[55], 1]]);
  assert.equal(r.score.changes?.[0].at, 8);
  assert.ok(r.notes.some((n) => n.includes("弱起")));
  assert.deepEqual(import123(head("1 2 3 4 | 5 |")).score.notes[0].pitches, [60]);
});

test("和弦记号：引号与裸写都进 chordSymbols，认不出的列入丢失", () => {
  const r = import123(head('"Am"6 6 F 4 4 | "G7"5 - "H9"5 - |'));
  assert.deepEqual(r.score.chordSymbols, [{ at: 0, symbol: "Am" }, { at: 2, symbol: "F" }, { at: 4, symbol: "G7" }]);
  assert.ok(r.losses.some((l) => l.includes("认不出的和弦记号")));
});

test("123 琶音记号进和弦装饰，单音上的记为损失", () => {
  const r = import123(head("!arpeggio![135] !琶音!1 2 3 |"));
  assert.equal(r.score.notes[0].ornament, "arpeggio");
  assert.equal(r.score.notes[1].ornament, undefined);
  assert.ok(r.losses.some((l) => l.includes("单音上的琶音")));
});

import { export123 } from "./j123-export.ts";
import { canonicalFermatas } from "./fermata.ts";
import { canonicalChanges } from "./score-timeline.ts";
import { canonicalGradualTempos, resolveGradualTarget, type ScoreWithGradual } from "./gradual-tempo.ts";
import { loadExampleScore } from "./examples-load.ts";
import type { Score } from "./theory.ts";

function sameAt(a: number, b: number, label: string) {
  assert.ok(Math.abs(a - b) < 1e-6, `${label}: ${a} vs ${b}`);
}
function sameChanges(a: Score["changes"], b: Score["changes"]) {
  const left = canonicalChanges(a ?? []).filter((c) => c.at > 0);
  const right = canonicalChanges(b ?? []).filter((c) => c.at > 0);
  assert.equal(left.length, right.length, `changes ${JSON.stringify(left)} vs ${JSON.stringify(right)}`);
  for (let i = 0; i < left.length; i++) {
    sameAt(left[i]!.at, right[i]!.at, `change ${i} at`);
    const { at: _a, ...l } = left[i]!;
    const { at: _b, ...r } = right[i]!;
    assert.deepEqual(l, r, `change ${i}`);
  }
}
function sameFermatas(a: Score["fermatas"], b: Score["fermatas"]) {
  const left = canonicalFermatas(a) ?? [];
  const right = canonicalFermatas(b) ?? [];
  assert.equal(left.length, right.length);
  for (let i = 0; i < left.length; i++) {
    assert.equal(left[i]!.voice, right[i]!.voice);
    sameAt(left[i]!.at, right[i]!.at, `fermata ${i}`);
  }
}
function sameGraduals(src: Score, back: Score) {
  const left = canonicalGradualTempos((src as ScoreWithGradual).gradualTempos) ?? [];
  const right = canonicalGradualTempos((back as ScoreWithGradual).gradualTempos) ?? [];
  assert.equal(left.length, right.length, `gradual ${JSON.stringify(left)} vs ${JSON.stringify(right)}`);
  for (let i = 0; i < left.length; i++) {
    sameAt(left[i]!.from, right[i]!.from, `gradual ${i} from`);
    sameAt(left[i]!.to, right[i]!.to, `gradual ${i} to`);
    assert.equal(left[i]!.kind, right[i]!.kind);
    assert.equal(resolveGradualTarget(src, left[i]!), resolveGradualTarget(back, right[i]!));
  }
}

test("123 读入行内渐慢/渐快与延长，不再列入丢失", () => {
  const r = import123(head('!fermata!1 2 "^rit."3 4 | 5 6 [Q:1/4=60] 7 8 |'));
  assert.deepEqual(canonicalFermatas(r.score.fermatas), [{ voice: 0, at: 0 }]);
  const spans = canonicalGradualTempos((r.score as ScoreWithGradual).gradualTempos) ?? [];
  assert.equal(spans.length, 1);
  assert.equal(spans[0]!.kind, "rit");
  sameAt(spans[0]!.from, 2, "rit from");
  sameAt(spans[0]!.to, 6, "rit to");
  assert.ok(!r.losses.some((l) => /延长|渐|谱上文字|速度术语/.test(l)), r.losses.join(" / "));
  assert.equal(r.score.changes?.[0]?.bpm, 60);
});

test("123 导出再导入保留途中速度、拍号、转调、延长和渐快渐慢", () => {
  const notes = Array.from({ length: 16 }, () => ({ pitches: [60], dur: 1 }));
  const score: ScoreWithGradual = {
    title: "往返",
    bpm: 120,
    beats: 4,
    beatUnit: 4,
    key: "C",
    mode: "major",
    clef: "treble",
    tonicOctave: 4,
    notes,
    changes: [
      { at: 2, bpm: 80 },
      { at: 4, beats: 3, beatUnit: 4, key: "G", mode: "major" },
      { at: 10, bpm: 72 },
    ],
    fermatas: [{ voice: 0, at: 3 }],
    gradualTempos: [
      { from: 4, to: 7, kind: "rit", toBpm: 60 },
      { from: 10, to: 14, kind: "accel", ratio: 4 / 3 },
    ],
  };
  const out = export123(score);
  assert.match(out.text, /\[Q:1\/4=80\]/);
  assert.match(out.text, /\[M:3\/4\]/);
  assert.match(out.text, /\[K:1=G\]/);
  assert.match(out.text, /!fermata!/);
  assert.ok(out.text.includes('"^rit.=60"'));
  assert.ok(/"\^accel/.test(out.text));
  const back = import123(out.text);
  assert.ok(!back.losses.some((l) => /延长|渐|谱上文字|途中|变拍|转调|变速/.test(l)), back.losses.join(" / "));
  sameChanges(score.changes, back.score.changes);
  sameFermatas(score.fermatas, back.score.fermatas);
  sameGraduals(score, back.score);
  assert.equal(back.score.bpm, 120);
  assert.equal(back.score.beats, 4);
  assert.equal(back.score.key, "C");
});

test("匈牙利狂想曲第二号 123 往返后途中记号等价", async () => {
  const score = await loadExampleScore("hr2");
  const out = export123(score);
  const back = import123(out.bytes);
  assert.ok(!back.losses.some((l) => /延长|渐|谱上文字/.test(l)), back.losses.join(" / "));
  sameChanges(score.changes, back.score.changes);
  sameFermatas(score.fermatas, back.score.fermatas);
  sameGraduals(score, back.score);
});
