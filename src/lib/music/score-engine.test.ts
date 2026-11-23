import test from "node:test";
import assert from "node:assert/strict";
import abcjs from "abcjs";
import { musicXmlToScore, scoreToMusicXml } from "./musicxml.ts";
import { engraveAbc } from "./score-engraving.ts";
import { nextBar } from "./score-timeline.ts";
import { midiToScore, previewMidiImport } from "./midi.ts";
import { import123 } from "./j123-import.ts";
import { quantizeMidi } from "./midi-quantize.ts";
import { rhythmFraction, rhythmPieces } from "./rhythm-spelling.ts";
import { RestModel, scoreToJianpu, scoreToJianpuLines } from "./jianpu-render.ts";
import { jianpuPrint } from "./jianpu-print.ts";
import { DEFAULT_PRINT_SETTINGS } from "./print-layout.ts";
import { createBlankScore } from "./score-storage.ts";
import { noteXml as n, xmlScore, fragmentedMidi } from "./fixtures/engine-inputs.ts";

function parsed(abc: string) {
  const tune = abcjs.parseOnly(abc)[0];
  const notes = tune.lines
    .flatMap((l) => l.staff ?? [])
    .flatMap((s) => s.voices)
    .flat()
    .filter((n) => n?.el_type === "note");
  let multiplier = 1;
  const timed = notes.map((raw) => {
    const note = raw as unknown as {
      duration: number;
      tripletMultiplier?: number;
      endTriplet?: boolean;
      pitches?: { pitch: number; accidental?: string }[];
    };
    if (note.tripletMultiplier !== undefined) multiplier = note.tripletMultiplier;
    const next = { ...note, tripletMultiplier: multiplier };
    if (note.endTriplet) multiplier = 1;
    return next;
  });
  return { tune, notes: timed };
}
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`);

test("合成 MusicXML 弱起：全声部、途中标记一起平移", () => {
  const input = xmlScore([
    `${n("C", 1)}<direction><sound tempo="72"/></direction><backup><duration>1</duration></backup>${n("E", 1).replace("<voice>1", "<voice>2")}`,
    n("D", 4),
  ]);
  const { score } = musicXmlToScore(input, "弱起夹具");
  assert.deepEqual(score.notes[0], { pitches: [], dur: 3 });
  assert.deepEqual(score.voice2?.[0], { pitches: [], dur: 3 });
  assert.deepEqual(score.measureEnds, [4, 8]);
  assert.equal(score.changes?.find((c) => c.bpm === 72)?.at, 4);
  near(
    score.notes.reduce((s, n) => s + n.dur, 0),
    8,
  );
  assert.equal(nextBar(score, 0), 4);
});

test("短小节和华彩不被固定拍号切碎：五线、简谱屏幕和打印共享边界", () => {
  const { score } = musicXmlToScore(xmlScore([n("C", 4), n("D", 1), n("E", 9)]), "小节夹具");
  assert.deepEqual(score.measureEnds, [4, 5, 14]);
  assert.equal(nextBar(score, 4), 5);
  assert.equal(nextBar(score, 5), 14);
  const { tune, notes } = parsed(engraveAbc(score).abc);
  assert.deepEqual(tune.warnings ?? [], []);
  near(
    notes.reduce((s, n) => s + n.duration * 4 * (n.tripletMultiplier ?? 1), 0),
    14,
  );
  const info = scoreToJianpu(score)[0].info;
  const model = new RestModel(info);
  near(model.measuresInfo.measureNumberAtQ(5), 3);
  near(model.measuresInfo.measureLengthAtQ(5), 9);
  assert.deepEqual(
    scoreToJianpuLines(score, 0, 1).map((line) => line[0].offset),
    [0, 4, 5],
  );
  assert.deepEqual(
    jianpuPrint(score, DEFAULT_PRINT_SETTINGS).measures.map((m) => m.end),
    [4, 5, 14],
  );
  assert.deepEqual(musicXmlToScore(scoreToMusicXml(score), "往返").score.measureEnds, [4, 5, 14]);
});

test("backup 重叠与不等长和弦音不丢发声区间", () => {
  for (const body of [
    `${n("C", 2)}<backup><duration>1</duration></backup>${n("E", 2)}`,
    `${n("C", 1)}${n("E", 3, "<chord/>")}`,
  ]) {
    const { score } = musicXmlToScore(xmlScore([body]), "重叠夹具");
    const intervals = new Map<number, number[]>();
    let at = 0;
    for (const note of score.notes) {
      for (const p of note.pitches) {
        const span = intervals.get(p);
        intervals.set(p, [span?.[0] ?? at, at + note.dur]);
      }
      at += note.dur;
    }
    assert.deepEqual(intervals.get(60), [0, body.includes("backup") ? 2 : 1]);
    assert.deepEqual(intervals.get(64), [body.includes("backup") ? 1 : 0, 3]);
  }
});

test("非惯用音高拼写明确披露；同小节升号后还原写出", () => {
  const imported = musicXmlToScore(xmlScore([n("D", 1, "", -1), n("D", 1)]), "拼写夹具");
  assert.ok(imported.losses.some((s) => s.includes("拼写")));
  const score = {
    ...createBlankScore(),
    notes: [
      { pitches: [61], dur: 1 },
      { pitches: [60], dur: 1 },
    ],
  };
  const { notes } = parsed(engraveAbc(score).abc);
  assert.equal(notes[1].pitches?.[0].accidental, "natural");
});

test("可表示的分数和二进制组合：abcjs 实际解析时间精确且无警告", () => {
  for (const dur of [
    1 / 3,
    1 / 5,
    1 / 7,
    1 / 9,
    5 / 16,
    11 / 16,
    31 / 64,
    63 / 64,
    7 / 12,
    13 / 20,
  ]) {
    const score = { ...createBlankScore(), notes: [{ pitches: [60, 64], dur }] };
    const { tune, notes } = parsed(engraveAbc(score).abc);
    assert.deepEqual(tune.warnings ?? [], [], `${dur}`);
    near(
      notes.reduce((s, n) => s + n.duration * 4 * (n.tripletMultiplier ?? 1), 0),
      dur,
    );
    near(
      rhythmPieces(dur).reduce((s, n) => s + n, 0),
      dur,
    );
  }
});

test("十五连音拆成可表示的连音延音组合；十一连音稳定降级", () => {
  const { score } = musicXmlToScore(
    xmlScore([Array.from({ length: 15 }, () => n("C", 1)).join("")], 15),
    "连音夹具",
  );
  near(
    score.notes.reduce((s, n) => s + n.dur, 0),
    1,
  );
  const abc = engraveAbc(score).abc;
  assert.doesNotMatch(abc, /拍/);
  assert.deepEqual(parsed(abc).tune.warnings ?? [], []);
  assert.equal(abc, engraveAbc(score).abc);
  const unsupported = engraveAbc({
    ...createBlankScore(),
    notes: [{ pitches: [60], dur: 1 / 11 }],
  }).abc;
  assert.match(unsupported, /\[1\/11拍\]/);
  assert.ok(
    parsed(unsupported).tune.warnings?.some((w) => w.includes("Duration not representable")),
  );
  near(
    parsed(abc).notes.reduce((s, n) => s + n.duration * 4 * (n.tripletMultiplier ?? 1), 0),
    1,
  );
  assert.match(rhythmFraction(1 / 99991), /^\d+\/\d+$/);
});

test("合成 MIDI 的演奏碎片在普通与增强导入后均为可书写节奏", () => {
  for (const division of [7, 101, 480]) {
    const bytes = fragmentedMidi(division);
    for (const score of [midiToScore(bytes, "碎片"), previewMidiImport(bytes, "碎片").score]) {
      assert.ok(score.notes.every((n) => n.dur >= 0.125 - 1e-8));
      const { tune } = parsed(engraveAbc(score).abc);
      assert.deepEqual(tune.warnings ?? [], []);
    }
  }
  assert.throws(() => quantizeMidi([{ start: 0, end: 1, midi: 60 }], 480, 4, 0.03), /网格/);
});

test("123 导入复用精确刻谱路径：连音和同小节还原号", () => {
  const { score } = import123("%123-1.0\nK:1=C\nM:4/4\n(3:1_ 2_ 3_) #4 4 n4 |\n");
  const { tune, notes } = parsed(engraveAbc(score).abc);
  assert.deepEqual(tune.warnings ?? [], []);
  near(
    notes.reduce((s, n) => s + n.duration * 4 * (n.tripletMultiplier ?? 1), 0),
    4,
  );
  assert.equal(notes.at(-1)?.pitches?.[0].accidental, "natural");
});

test("简谱屏幕与打印的非标准余项不画错误减时线", () => {
  for (const dur of [1 / 11, 1 / 15, 1 / 35]) {
    const score = { ...createBlankScore(), notes: [{ pitches: [60], dur }] };
    const model = new RestModel(scoreToJianpu(score)[0].info);
    for (const block of model.jianpuBlockMap.values()) {
      // Every fraction-tagged block must have no conventional duration strokes.
      if (
        block.length < 1 / 16 - 1e-8 ||
        Math.abs(block.length * 16 - Math.round(block.length * 16)) > 1e-7
      )
        assert.equal(block.durationLines, undefined);
    }
    assert.match(jianpuPrint(score, DEFAULT_PRINT_SETTINGS).markup, /拍\]/);
  }
});

test("源小节边界与途中变速混合时简谱切片仍按时间排序", () => {
  const score = {
    ...createBlankScore(),
    notes: [{ pitches: [60], dur: 15 }],
    measureEnds: [4, 5, 15],
    changes: [{ at: 6, bpm: 70, beats: 3, beatUnit: 4 }],
  };
  const info = scoreToJianpu(score)[0].info;
  assert.deepEqual(
    info.notes.map((n) => n.start),
    [0, 4, 5, 6],
  );
  assert.ok(info.notes.every((n) => n.length > 0));
  assert.equal(nextBar(score, 15), 18);
});

test("不规则小节中的整休止与连音整休止不被 abcjs 改成拍号长度", () => {
  for (const dur of [4, 8 / 3]) {
    for (const source of [true, false]) {
      const score = {
        ...createBlankScore(),
        beats: source ? 3 : 12,
        notes: Array.from({ length: 3 }, () => ({ pitches: [], dur })),
        ...(source ? { measureEnds: [dur, dur * 2, dur * 3] } : {}),
      };
      const { tune, notes } = parsed(engraveAbc(score).abc);
      assert.deepEqual(tune.warnings ?? [], []);
      near(
        notes.reduce((s, n) => s + n.duration * 4 * (n.tripletMultiplier ?? 1), 0),
        dur * 3,
      );
    }
  }
});

// Assert abcjs's parsed beam boundaries, not just the whitespace serializer.
test("五线谱短音按拍连杠，两个 ABC 入口一致", async () => {
  const { engraveAbc: legacy } = await import("./notation.ts");
  const { createBlankScore } = await import("./score-storage.ts");
  for (const engrave of [engraveAbc, legacy]) {
    const make = (durations: number[], beats = 4, beatUnit = 4) => ({
      ...createBlankScore(), beats, beatUnit,
      notes: durations.map(dur => ({ pitches: [60], dur })),
    });
    const beams = (score: ReturnType<typeof make>) => {
      const abc = engrave(score).abc;
      return abcjs.parseOnly(abc)[0].lines.flatMap(l => l.staff ?? [])
        .flatMap(s => s.voices).flat().filter(n => n?.el_type === "note")
        .map(n => { const beam = n as unknown as { startBeam?: boolean; endBeam?: boolean }; return [!!beam.startBeam, !!beam.endBeam]; });
    };
    assert.deepEqual(beams(make([.5,.5,.5,.5])), [[true,false],[false,true],[true,false],[false,true]]);
    assert.deepEqual(beams(make([.25,.25,.25,.25])), [[true,false],[false,false],[false,false],[false,true]]);
    assert.deepEqual(beams(make([.5,.5,.5,.5,.5,.5],6,8)), [[true,false],[false,false],[false,true],[true,false],[false,false],[false,true]]);
    assert.deepEqual(beams(make(Array(10).fill(.5))).slice(-4), [[true,false],[false,true],[true,false],[false,true]]);
    const rest = make([.25,.25,.25,.25]); rest.notes[1].pitches = [];
    assert.deepEqual(beams(rest), [[false,false],[false,false],[true,false],[false,true]]);
    assert.deepEqual(beams(make([.75,.5,.25])), [[false,false],[false,false],[false,false]]);
    assert.deepEqual(beams(make([1/3,1/3,1/3])), [[true,false],[false,false],[false,true]]);
    const importedTuplet = {...make([1/3,1/3,1/3]), measureEnds: [1]};
    assert.deepEqual(beams(importedTuplet), [[true,false],[false,false],[false,true]]);
    const dotted = make([.75,.25]);
    assert.deepEqual(beams(dotted), [[true,false],[false,true]]);
    for (const beats of [2,3]) assert.deepEqual(beams(make([.5,.5,.5,.5], beats)), [[true,false],[false,true],[true,false],[false,true]]);
  }
});

test("MusicXML 导入的钢琴大谱表按拍连杠并省略声部名，普通同谱号保留名称", () => {
  const imported = musicXmlToScore(xmlScore([Array.from({length: 8}, () => n("C", .5)).join("")]), "连杠导入").score;
  const score = { ...imported, voice2: [{pitches: [48], dur: 4}] };
  const { abc, hits } = engraveAbc(score);
  assert.doesNotMatch(abc, /name=|声部[一二]/);
  assert.match(abc, /%%score \{1 \| 2\}/);
  assert.ok(abcjs.parseOnly(abc)[0].lines.flatMap(l => l.staff ?? []).flatMap(s => s.voices).flat().some(n => (n as unknown as {startBeam?: boolean})?.startBeam));
  for (const hit of hits) assert.ok(abc.slice(hit.start, hit.end).length);
  assert.match(engraveAbc({...score, voice2: [{pitches:[72],dur:4}]}).abc, /name="声部一"/);
});

test("现有《两只老虎》示例的八分音符连杠且时值不变", async () => {
  const { EXAMPLES, scoreFromExample } = await import("./examples.ts");
  const score = scoreFromExample(EXAMPLES.find(example => example.id === "tigers")!);
  const { notes } = parsed(engraveAbc(score).abc);
  assert.equal(notes.length, score.notes.length);
  score.notes.forEach((note, i) => near(notes[i].duration * 4 * notes[i].tripletMultiplier, note.dur));
  const beamed = notes.filter(note => (note as unknown as {startBeam?: boolean}).startBeam);
  assert.equal(beamed.length, 4, "两段 56 54 各有两组八分连杠");
});

test("《匈牙利狂想曲第二号》精确微时值不进入符杠，保留途中速度标记", async () => {
  const { score } = await import("./examples-pd/hr2.ts");
  const { staffMarksScore, markStaffAbc } = await import("./staff-marks.ts");
  const marked = staffMarksScore(score);
  const { abc } = markStaffAbc(engraveAbc(marked), marked);
  const { tune, notes } = parsed(abc);
  const unsupported = notes.filter(note => note.duration > 0 && note.duration < 1/128);
  assert.ok(unsupported.length > 0, "使用现有完整示例中的微时值");
  for (const note of unsupported) {
    const beam = note as unknown as { startBeam?: boolean; endBeam?: boolean };
    assert.ok(!beam.startBeam && !beam.endBeam, "没有可画符头的精确时值不能成为符杠端点");
  }
  const tempos = tune.lines.flatMap(line => line.staff ?? []).flatMap(staff => staff.voices)
    .flat().filter(item => item?.el_type === "tempo");
  assert.ok(tempos.length >= 2);
});

test("钢琴乐器标记贯穿多行示例、MusicXML/MIDI 导入与保存，普通分谱仍命名", async () => {
  const { loadExampleScore } = await import("./examples-load.ts");
  const { PD_EXAMPLES } = await import("./examples.ts");
  const { scoreToMidi, previewMidiVoices } = await import("./midi.ts");
  const { encodeSharePayload, parseShareHash } = await import("./share-link.ts");
  for (const meta of PD_EXAMPLES) {
    const score = await loadExampleScore(meta.id);
    assert.equal(score.staffInstrument, "piano", meta.id);
    assert.doesNotMatch(engraveAbc(score).abc, /name="声部/, meta.id);
  }
  const piano = {
    ...createBlankScore(), staffInstrument: "piano" as const,
    notes: [{pitches:[72],dur:1}], voice2:[{pitches:[67],dur:1}], extraVoices:[[{pitches:[64],dur:1}]],
  };
  const imported = musicXmlToScore(scoreToMusicXml(piano), "钢琴").score;
  assert.equal(imported.staffInstrument, "piano");
  const midi = previewMidiVoices(scoreToMidi(piano), "钢琴").score;
  assert.equal(midi.staffInstrument, "piano");
  const saved = parseShareHash(`#s=${encodeSharePayload(imported)}`)!;
  assert.equal(saved.staffInstrument, "piano");
  for (const score of [piano, imported, midi, saved]) assert.doesNotMatch(engraveAbc(score).abc, /name="声部/);
  const { staffInstrument: _, ...ensemble } = piano;
  assert.match(engraveAbc(ensemble).abc, /name="声部一"/);
});
