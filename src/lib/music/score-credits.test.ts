import assert from "node:assert/strict";
import test from "node:test";
import { applyCredits, cleanCredit, creditField, creditsLine, parseCreditLine } from "./score-credits.ts";
import { importAbc, exportAbc } from "./abc.ts";
import { import123 } from "./j123-import.ts";
import { musicXmlToScore, scoreToMusicXml } from "./musicxml.ts";
import { jianpuPrint } from "./jianpu-print.ts";
import { DEFAULT_PRINT_SETTINGS } from "./print-layout.ts";
import type { Score, ScoreNote } from "./theory.ts";

const notes = (...durs: number[]): ScoreNote[] => durs.map((dur) => ({ pitches: [60], dur }));
const scoreOf = (extra: Partial<Score> = {}): Score => ({
  title: "小星星", bpm: 80, beats: 4, beatUnit: 4, key: "C", mode: "major", clef: "treble", tonicOctave: 4,
  notes: notes(1, 1, 1, 1, 1, 1, 1, 1), ...extra,
});

test("清洗：去掉空格、截到 40 字", () => {
  assert.equal(cleanCredit("  李  四  "), "李 四");
  assert.equal(cleanCredit("   "), undefined);
  assert.equal(cleanCredit("一".repeat(50))?.length, 40);
});

test("解析：词曲标签、作词作曲、英文、以及单独一个名字当作曲作者", () => {
  assert.deepEqual(parseCreditLine("词：张三 曲：李四"), { lyricist: "张三", composer: "李四" });
  assert.deepEqual(parseCreditLine("作词：张三 作曲：李四"), { lyricist: "张三", composer: "李四" });
  assert.deepEqual(parseCreditLine("曲:Wang"), { composer: "Wang" });
  assert.deepEqual(parseCreditLine("词：只写了词"), { lyricist: "只写了词" });
  assert.deepEqual(parseCreditLine("lyricist: Ann  composer: Bob"), { lyricist: "Ann", composer: "Bob" });
  assert.deepEqual(parseCreditLine("Mozart"), { composer: "Mozart" });
  assert.deepEqual(parseCreditLine("  "), {});
});

test("applyCredits 与一行摘要；空字符串清掉该栏", () => {
  const a = applyCredits(scoreOf(), { lyricist: "张三", composer: "李四" });
  assert.deepEqual([a.lyricist, a.composer], ["张三", "李四"]);
  assert.equal(creditsLine(a), "词：张三　曲：李四");
  assert.equal(creditField(a), "词：张三 曲：李四");
  const b = applyCredits(a, { lyricist: "" });
  assert.equal(b.lyricist, undefined);
  assert.equal(b.composer, "李四");
  assert.equal(creditField(scoreOf({ composer: "李四" })), "李四");
  assert.equal(creditsLine(scoreOf()), "");
});

test("MusicXML creator 读写往返", () => {
  const src = `<?xml version="1.0"?>
<score-partwise version="3.1"><work><work-title>小星星</work-title></work>
<identification>
  <creator type="composer">李四</creator>
  <creator type="lyricist">张三</creator>
  <encoding><software>x</software></encoding>
</identification>
<part-list><score-part id="P1"><part-name>S</part-name></score-part></part-list>
<part id="P1"><measure number="1"><attributes><divisions>1</divisions><key><fifths>0</fifths></key>
<time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note>
</measure></part></score-partwise>`;
  const r = musicXmlToScore(src, "x");
  assert.equal(r.score.lyricist, "张三");
  assert.equal(r.score.composer, "李四");
  const back = musicXmlToScore(scoreToMusicXml(r.score), "x");
  assert.equal(back.score.lyricist, "张三");
  assert.equal(back.score.composer, "李四");
});

test("123 C: 与 ABC C: 读入并写回；打印简谱左词右曲并标小节号", () => {
  const j = import123("%123-1.0\nT:小星星\nC:词：张三 曲：李四\nK:1=C\n1 2 3 4 | 5 6 7 1 |\n");
  assert.deepEqual([j.score.lyricist, j.score.composer], ["张三", "李四"]);
  assert.ok(!j.losses.some((l) => l.includes("署名")), j.losses.join(" / "));
  const a = importAbc("X:1\nT:小星星\nC:词：张三 曲：李四\nM:4/4\nL:1/4\nK:C\nCDEF|GABc|\n");
  assert.deepEqual([a.score.lyricist, a.score.composer], ["张三", "李四"]);
  const out = exportAbc(a.score);
  assert.match(out.text, /C:词：张三 曲：李四/);
  const bare = importAbc("X:1\nT:t\nC:Mozart\nM:4/4\nL:1/4\nK:C\nCDEF|\n");
  assert.equal(bare.score.composer, "Mozart");
  assert.equal(bare.score.lyricist, undefined);
  const printed = jianpuPrint(scoreOf({ lyricist: "张三", composer: "李四" }), DEFAULT_PRINT_SETTINGS);
  assert.match(printed.markup, /词：张三/);
  assert.match(printed.markup, /曲：李四/);
  assert.match(printed.markup, /data-bar-number="1"/);
  assert.match(printed.markup, /data-bar-number="2"/);
  const plain = jianpuPrint(scoreOf(), DEFAULT_PRINT_SETTINGS);
  assert.doesNotMatch(plain.markup, /词：/);
  assert.match(plain.markup, /data-bar-number="1"/);
});
