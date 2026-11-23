import assert from "node:assert/strict";
import test from "node:test";
import { barStartAt, canonicalRehearsals, cleanRehearsalLabel, editRehearsal, isPlayOrder, remapRehearsalsForNotes, rehearsalsSummary } from "./rehearsals.ts";
import type { Score, ScoreNote } from "./theory.ts";

const notes = (...durs: number[]): ScoreNote[] => durs.map((dur) => ({ pitches: [60], dur }));
const scoreOf = (n: ScoreNote[], extra: Partial<Score> = {}): Score => ({
  title: "t", bpm: 80, beats: 4, beatUnit: 4, key: "C", mode: "major", clef: "treble", tonicOctave: 4, notes: n, ...extra,
});

test("清洗：去掉空格、截到 12 字、同拍只留最后一条", () => {
  assert.equal(cleanRehearsalLabel("  主  歌  "), "主 歌");
  assert.equal(cleanRehearsalLabel("   "), null);
  assert.equal(cleanRehearsalLabel("一二三四五六七八九十一二三")!.length, 12);
  const cleaned = canonicalRehearsals([
    { at: 0, label: "前奏" },
    { at: 4, label: "  " },
    { at: 0, label: "主歌" },
    { at: 8, label: "副歌" },
  ]);
  assert.deepEqual(cleaned, [{ at: 0, label: "主歌" }, { at: 8, label: "副歌" }]);
  assert.equal(canonicalRehearsals([]), undefined);
  assert.equal(canonicalRehearsals("nope"), undefined);
});

test("演唱顺序 P:AABA / P:A,A,B,A 与单个段落名分开", () => {
  assert.equal(isPlayOrder("AABA"), true);
  assert.equal(isPlayOrder("A,A,B,A"), true);
  assert.equal(isPlayOrder("A"), false);
  assert.equal(isPlayOrder("AB"), false);
  assert.equal(isPlayOrder("主歌"), false);
  assert.equal(isPlayOrder("Verse"), false);
});

test("编辑：落到该小节开头；再点同一小节替换；清除只去掉这一处", () => {
  const score = scoreOf(notes(1, 1, 1, 1, 2, 2));
  assert.equal(barStartAt(score, 2.5), 0);
  assert.equal(barStartAt(score, 4), 4);
  const a = editRehearsal(score, 2.5, "前奏");
  assert.deepEqual(a.rehearsals, [{ at: 0, label: "前奏" }]);
  const b = editRehearsal(a, 1, "主歌");
  assert.deepEqual(b.rehearsals, [{ at: 0, label: "主歌" }]);
  const c = editRehearsal(b, 5, "副歌");
  assert.deepEqual(c.rehearsals, [{ at: 0, label: "主歌" }, { at: 4, label: "副歌" }]);
  const d = editRehearsal(c, 0, null);
  assert.deepEqual(d.rehearsals, [{ at: 4, label: "副歌" }]);
  const e = editRehearsal(d, 4, null);
  assert.equal(e.rehearsals, undefined);
  assert.equal(rehearsalsSummary(c), "第 1 小节「主歌」、第 2 小节「副歌」");
});

test("旋律改写：标记跟着原来所在的音走；超出新长度就丢掉", () => {
  const prev = notes(4, 4, 4);
  const marks = [{ at: 0, label: "前奏" }, { at: 4, label: "主歌" }, { at: 8, label: "副歌" }];
  const same = remapRehearsalsForNotes(marks, prev, notes(4, 4, 4));
  assert.deepEqual(same.marks, marks);
  assert.equal(same.notice, undefined);
  const shorter = remapRehearsalsForNotes(marks, prev, notes(4, 4));
  assert.deepEqual(shorter.marks, [{ at: 0, label: "前奏" }, { at: 4, label: "主歌" }]);
  assert.ok(shorter.notice?.includes("超出"));
  const stretched = remapRehearsalsForNotes(marks, prev, notes(8, 8, 8));
  assert.deepEqual(stretched.marks, [{ at: 0, label: "前奏" }, { at: 8, label: "主歌" }, { at: 16, label: "副歌" }]);
  assert.ok(stretched.notice?.includes("跟到"));
});

import { importAbc, exportAbc } from "./abc.ts";
import { import123 } from "./j123-import.ts";
import { musicXmlToScore, scoreToMusicXml } from "./musicxml.ts";

test("MusicXML 排练号读写往返；普通谱上文字仍记为丢失", () => {
  const src = `<?xml version="1.0"?>
<score-partwise version="3.1"><part-list><score-part id="P1"><part-name>S</part-name></score-part></part-list>
<part id="P1"><measure number="1"><attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
<direction placement="above"><direction-type><rehearsal>前奏</rehearsal></direction-type></direction>
<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note>
</measure>
<measure number="2">
<direction placement="above"><direction-type><rehearsal>主歌</rehearsal></direction-type></direction>
<note><pitch><step>G</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note>
</measure></part></score-partwise>`;
  const r = musicXmlToScore(src, "x");
  assert.deepEqual(r.score.rehearsals, [{ at: 0, label: "前奏" }, { at: 4, label: "主歌" }]);
  assert.ok(!r.losses.some((l) => l.includes("排练") || l.includes("谱上文字")), r.losses.join(" / "));
  const back = musicXmlToScore(scoreToMusicXml(r.score), "x");
  assert.deepEqual(back.score.rehearsals, r.score.rehearsals);
  const words = musicXmlToScore(src.replace("<rehearsal>前奏</rehearsal>", "<words>free text</words>"), "x");
  assert.ok(words.losses.some((l) => l.includes("谱上文字")), words.losses.join(" / "));
});

test("123 行内 [P:主歌] 读成段落标记；P:AABA 仍记为演唱顺序", () => {
  const r = import123("%123-1.0\nK:1=C\n[P:前奏] 1 2 3 4 | [P:主歌] 5 6 7 1 |\n");
  assert.deepEqual(r.score.rehearsals, [{ at: 0, label: "前奏" }, { at: 4, label: "主歌" }]);
  const order = import123("%123-1.0\nK:1=C\n[P:AABA] 1 2 3 4 |\n");
  assert.equal(order.score.rehearsals, undefined);
  assert.ok(order.losses.some((l) => l.includes("演唱顺序")));
});

test("ABC 的 P: 读入并写回", () => {
  const r = importAbc("X:1\nT:分段\nM:4/4\nL:1/4\nK:C\n[P:前奏]CDEF |[P:副歌]GABc |\n");
  assert.deepEqual(r.score.rehearsals, [{ at: 0, label: "前奏" }, { at: 4, label: "副歌" }]);
  const out = exportAbc(r.score);
  assert.match(out.text, /\[P:前奏\]/);
  assert.match(out.text, /\[P:副歌\]/);
});
