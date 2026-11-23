import test from "node:test";
import assert from "node:assert/strict";
import { EXAMPLES, scoreFromExample } from "./examples.ts";
import { applyJianpuText, rewriteVoice } from "./jianpu-edit.ts";
import { alignNoteSlots, carryLyrics } from "./text-edit-carry.ts";
import { parseLetters } from "./notation.ts";
import type { Score } from "./theory.ts";

const LYRICS = "晨光穿过窗沿照亮书页晚风吹动树梢轻轻翻开下一页纸上";

function threeFourStudy(): Score {
  const example = EXAMPLES.find((item) => item.title === "三拍练习");
  assert.ok(example, "三拍练习 sample exists");
  const score = scoreFromExample(example!);
  let k = 0;
  const notes = score.notes.map((note) => {
    if (!note.pitches.length) return note;
    const text = Array.from(LYRICS)[k++];
    return text ? { ...note, lyric: { text, syllabic: "single" as const } } : note;
  });
  return { ...score, notes };
}

function sung(score: Score): string {
  return score.notes.filter((note) => note.lyric).map((note) => note.lyric!.text).join("");
}

const CHORDS = 8;
// Same rhythm as the sample, different tune (3/4, two-eighth pickup).
const REPLACEMENT = "0 0 11 2 1 4 3 - 11 2 1 5 4 - 11 1' 6 4 3 2 7,7, 6 4 5 4 - -";

test("sample has its chords and lyrics on every sung note", () => {
  const score = threeFourStudy();
  assert.equal(score.chordSymbols?.length, CHORDS);
  assert.equal(sung(score).length, score.notes.filter((note) => note.pitches.length).length);
});

test("回归：整段替换唱名（一次贴入）保留歌词与全部和弦", () => {
  const score = threeFourStudy();
  const replacement = REPLACEMENT;
  const result = applyJianpuText(score, replacement, 0);
  assert.equal(result.error, undefined);
  assert.equal(result.lyricsDropped, false);
  assert.equal(sung(result.score), sung(score));
  assert.equal(result.score.chordSymbols?.length, CHORDS);
  assert.deepEqual(result.score.chordSymbols, score.chordSymbols, "same rhythm keeps every chord on its beat");
});

test("回归：逐字键入新唱名时，中间状态不会把歌词与和弦永久删掉", () => {
  const score = threeFourStudy();
  const replacement = REPLACEMENT;
  const base = score;
  let current = score;
  let last = applyJianpuText(current, "", 0, 0, base);
  // Select-all then type one character at a time, as a person (or a test robot) does.
  for (let i = 1; i <= replacement.length; i += 1) {
    const step = applyJianpuText(current, replacement.slice(0, i), 0, 0, base);
    if (step.error) continue;
    current = step.score;
    last = step;
  }
  assert.equal(sung(last.score), sung(score));
  assert.equal(last.score.chordSymbols?.length, CHORDS);
  assert.equal(last.lyricNotice, undefined);
  assert.equal(last.chordNotice, undefined);
});

test("intermediate short melody reports lost lyrics and chords explicitly", () => {
  const score = threeFourStudy();
  const step = applyJianpuText(score, "1, 2, 3, 4, 5,", 0, 0, score);
  assert.equal(step.error, undefined);
  assert.equal(sung(step.score), "晨光穿过窗");
  assert.match(step.lyricNotice ?? "", /放不下/);
  assert.match(step.lyricNotice ?? "", /撤销/);
  assert.match(step.chordNotice ?? "", /放不下/);
  assert.ok((step.score.chordSymbols?.length ?? 0) >= 1);
});

test("一个音的插入只移动它自己那一段，后面的歌词和弦跟着原来的音", () => {
  const score = threeFourStudy();
  // Insert a passing note before the third note of the first full bar.
  const text = "0 0 24 6 3 1 5 2 - 47 3 6 2 4 - 31 5 7 2 6 3 62 4 6 7 1 - -";
  const result = applyJianpuText(score, text, 0, 0, score);
  assert.equal(result.error, undefined);
  const lyrics = result.score.notes.map((note) => note.lyric?.text ?? "·").join("");
  assert.ok(lyrics.startsWith("··晨光穿过·窗沿"), lyrics);
  assert.equal(result.score.chordSymbols?.length, CHORDS);
  assert.deepEqual(result.score.chordSymbols?.[0], { at: 3, symbol: "C" });
  // The chord at beat 6 moves with its note to beat 7.
  assert.deepEqual(result.score.chordSymbols?.[1], { at: 7, symbol: "G" });
});

test("音名框整段替换同样保留歌词与和弦", () => {
  const score = threeFourStudy();
  const parsed = parseLetters("C4 C4 D4 C4 F4 E4 C4 C4 D4 C4 G4 F4 C4 C4");
  assert.ok(!parsed.error);
  const result = rewriteVoice(score, {}, 0, parsed.notes);
  assert.equal(sung(result.score), Array.from(LYRICS).slice(0, 14).join(""));
  assert.match(result.lyricNotice ?? "", /放不下/);
});

test("alignNoteSlots pairs surviving notes and fills rewritten stretches in order", () => {
  const n = (p: number) => ({ pitches: [p], dur: 1 });
  assert.deepEqual(alignNoteSlots([n(60), n(62), n(64)], [n(60), n(61), n(62), n(64)]), [0, 2, 3]);
  assert.deepEqual(alignNoteSlots([n(60), n(62), n(64)], [n(70), n(71), n(72)]), [0, 1, 2]);
  assert.deepEqual(alignNoteSlots([n(60), n(62)], []), [-1, -1]);
});

test("carryLyrics never puts a syllable on a rest", () => {
  const prev = [
    { pitches: [60], dur: 1, lyric: { text: "一", syllabic: "single" as const } },
    { pitches: [62], dur: 1, lyric: { text: "二", syllabic: "single" as const } },
  ];
  const next = [{ pitches: [], dur: 1 }, { pitches: [65], dur: 1 }, { pitches: [67], dur: 1 }];
  const carry = carryLyrics(prev, next);
  assert.equal(carry.notes[0]!.lyric, undefined);
  assert.equal(carry.notes[1]!.lyric?.text, "一");
  assert.equal(carry.notes[2]!.lyric?.text, "二");
  assert.deepEqual(carry.lost, []);
});
