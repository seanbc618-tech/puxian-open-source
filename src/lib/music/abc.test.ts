import assert from "node:assert/strict";
import test from "node:test";
import { exportAbc, importAbc, parseAbcKey } from "./abc.ts";
import { sniffAbc } from "./abc-sniff.ts";
import { detectTextFormat, importTextScoreFromPaste } from "./text-formats.ts";
import type { Score, ScoreNote } from "./theory.ts";

const enc = (s: string) => new TextEncoder().encode(s);
const pitches = (ns: ScoreNote[]) => ns.map((n) => n.pitches.join("+") || "r");
const durs = (ns: ScoreNote[]) => ns.map((n) => +n.dur.toFixed(4));

test("ABC 头部：标题、拍号、速度、调号与默认时值", () => {
  const { score, notes } = importAbc("X:1\nT:小星星\nM:2/4\nL:1/8\nQ:1/4=96\nK:G\nGG dd|ee d2|\n");
  assert.equal(score.title, "小星星");
  assert.deepEqual([score.beats, score.beatUnit, score.bpm, score.key, score.mode], [2, 4, 96, "G", "major"]);
  assert.deepEqual(pitches(score.notes), ["67", "67", "74", "74", "76", "76", "74"]);
  assert.deepEqual(durs(score.notes), [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 1]);
  assert.ok(notes[0].includes("替换整谱"));
});

test("调号与调式：小调、教会调式按同调号大调并记损失", () => {
  assert.deepEqual(parseAbcKey("Em"), { key: "E", mode: "minor", fifths: 1, clef: undefined, loss: undefined });
  assert.equal(parseAbcKey("Bb")?.fifths, -2);
  const dor = parseAbcKey("D dorian")!;
  assert.equal(dor.key, "C");
  assert.match(dor.loss ?? "", /多利亚/);
  assert.equal(parseAbcKey("A mix")?.key, "D");
  assert.equal(parseAbcKey("C clef=bass")?.clef, "bass");
  assert.equal(parseAbcKey("H"), null);
});

test("升降号随调号和小节生效，小节线后复原", () => {
  const { score } = importAbc("X:1\nM:4/4\nL:1/4\nK:D\nF ^G G =F|F c _B B|\n");
  assert.deepEqual(pitches(score.notes), ["66", "68", "68", "65", "66", "73", "70", "70"]);
});

test("时值写法：/、//、3/2、附点节奏 > <、三连音", () => {
  const { score } = importAbc("X:1\nM:4/4\nL:1/8\nK:C\nC/ C// C// C3/2 C/ A>B c<d (3cde z2|\n");
  assert.deepEqual(durs(score.notes), [0.25, 0.125, 0.125, 0.75, 0.25, 0.75, 0.25, 0.25, 0.75, 1 / 3, 1 / 3, 1 / 3, 1].map((x) => +x.toFixed(4)));
});

test("和弦、延音线、连线、装饰音与表情", () => {
  const { score } = importAbc('X:1\nM:4/4\nL:1/4\nK:C\n"C"[CEG]2 !f!.c (d-|d) {/B}c !trill!e !<(!f !<)!g z|\n');
  const [chord, c, d, gc, e, f, g] = score.notes;
  assert.deepEqual(chord.pitches, [60, 64, 67]);
  assert.equal(chord.dur, 2);
  assert.equal(c.dynamic, "f");
  assert.deepEqual(c.articulations, ["staccato"]);
  assert.equal(d.dur, 2);
  assert.equal(d.slurStart, true);
  assert.equal(d.slurEnd, true);
  assert.equal(gc.ornament, "grace");
  assert.equal(gc.gracePitch, 71);
  assert.equal(e.ornament, "trill");
  assert.equal(f.hairpin, "cresc");
  assert.equal(g.hairpinEnd, true);
  assert.deepEqual(score.chordSymbols, [{ at: 0, symbol: "C" }]);
});

test("反复与一二房子、D.C. 跳转", () => {
  const { score, losses } = importAbc("X:1\nM:2/4\nL:1/4\nK:C\n|:C D|E F|1G A:|2c2||!fine!d e|f !D.C.!g|]\n");
  assert.deepEqual(losses, []);
  assert.deepEqual(score.repeats, [{ from: 0, to: 6, ending: 4, endingEnd: 8 }]);
  assert.equal(score.jumps?.fine, 10);
  assert.equal(score.jumps?.dc, 12);
});

test("弱起小节补休止，歌词按音符对齐并跳过休止", () => {
  const { score, notes } = importAbc("X:1\nM:3/4\nL:1/4\nK:C\nG|c z e|g2-g|\nw:一 闪 亮 晶_\n");
  assert.equal(score.notes[0].pitches.length, 0);
  assert.equal(score.notes[0].dur, 2);
  assert.ok(notes.some((n) => n.includes("弱起")));
  assert.deepEqual(score.notes.filter((n) => n.lyric).map((n) => n.lyric!.text), ["一", "闪", "亮", "晶"]);
  assert.equal(score.notes.at(-1)!.dur, 3);
});

test("中途变拍变速变调写进 changes；只读第一首和第一个声部", () => {
  const { score, losses } = importAbc("X:1\nM:4/4\nL:1/4\nK:C\nV:1\nC D E F|[M:3/4][Q:1/4=90]G A B|\nK:G\nF G A|\nV:2\nC,4|\n\nX:2\nK:C\nccc|\n");
  assert.deepEqual(score.changes, [{ at: 4, beats: 3, beatUnit: 4, bpm: 90 }, { at: 7, key: "G", mode: "major" }]);
  assert.equal(score.notes.at(-3)!.pitches[0], 66);
  assert.ok(losses.some((l) => l.includes("声部")));
  assert.ok(losses.some((l) => l.includes("第一首")));
});

test("读不懂的内容进损失列表，没有音符时报错", () => {
  const { losses } = importAbc("X:1\nK:C\n~C H D !wibble! E\n");
  assert.ok(losses.some((l) => l.includes("~")));
  assert.ok(losses.some((l) => l.includes("wibble")));
  assert.throws(() => importAbc("X:1\nT:空\nK:C\n"), /没有读到音符/);
});

test("识别 ABC 与 123/番茄文本，扩展名 .abc 优先", async () => {
  const abc = "X:1\nT:t\nK:C\nCDEF|GABc|\n";
  assert.equal(sniffAbc(abc), true);
  assert.equal(sniffAbc("X:1\nK:C\n1 2 3 4|5 6 7 1'|\n"), false);
  assert.equal(detectTextFormat("a.txt", enc(abc)).id, "abc");
  assert.equal(detectTextFormat("tune.abc", enc("whatever")).id, "abc");
  assert.equal((await importTextScoreFromPaste(abc)).format.id, "abc");
  assert.equal((await importTextScoreFromPaste(abc)).score.notes.filter((n) => n.pitches.length).length, 8, "ABC chunk loads on demand");
});

const base = (notes: ScoreNote[], extra: Partial<Score> = {}): Score => ({
  title: "测试", bpm: 100, beats: 4, beatUnit: 4, key: "C", mode: "major", clef: "treble", tonicOctave: 4, notes, ...extra,
});

test("导出：头部、调号拼写、跨小节延音线与每行四小节", () => {
  const notes: ScoreNote[] = [{ pitches: [66], dur: 3 }, { pitches: [67], dur: 2 }, { pitches: [], dur: 3 }, ...Array.from({ length: 16 }, () => ({ pitches: [62], dur: 1 }))];
  const { text, losses } = exportAbc(base(notes, { key: "D", mode: "minor" }));
  assert.deepEqual(losses, []);
  assert.match(text, /^X:1\nT:测试\nM:4\/4\nL:1\/8\nQ:1\/4=100\nK:Dm\n/);
  assert.match(text, /\^F6 G2- \| G2 z6 \|/);
  assert.equal(text.trim().split("\n").filter((l) => !/^[A-Za-z]:/.test(l)).length, 2);
});

test("导出再导入：音高、时值、表情、反复、跳转、和弦名、歌词与变化保持不变", () => {
  const src = importAbc(
    'X:1\nT:往返\nM:3/4\nL:1/8\nQ:1/4=88\nK:Eb\n|:"Eb"!mp!E2 G2 B2|"Ab"(3cde .f2 !accent!g2|1[EGB]6:|2{c}B4 =A2||\nw:啊 呀 咿 呀 咿 - 呀 嘿\n!segno!B2 !<(!c2 !<)!d2|e6-|e2 {/f}e2 !D.S.!z2|]\n',
  );
  assert.deepEqual(src.losses, []);
  const out = exportAbc(src.score);
  assert.deepEqual(out.losses, []);
  const back = importAbc(out.text);
  assert.deepEqual(back.losses, []);
  const strip = (s: Score) => ({ ...s, tonicOctave: 0 });
  assert.deepEqual(strip(back.score), strip(src.score));
});

test("导出：多声部、指法记损失；小调升号调与变调", () => {
  const s = base([{ pitches: [61], dur: 4, fingers: [1] }, { pitches: [63], dur: 4 }], {
    key: "Db", mode: "minor", voice2: [{ pitches: [48], dur: 4 }], changes: [{ at: 4, key: "F", mode: "major" }],
  });
  const { text, losses } = exportAbc(s);
  assert.match(text, /K:C#m/);
  assert.match(text, /\[K:F\]/);
  assert.ok(losses.includes("第二个及以后的声部"));
  assert.ok(losses.includes("指法"));
  const back = importAbc(text).score;
  assert.deepEqual(pitches(back.notes), ["61", "63"]);
  assert.equal(back.key, "Db");
  assert.equal(back.mode, "minor");
});
