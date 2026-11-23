import assert from "node:assert/strict";
import test from "node:test";
import { editRepeats, keepValidRepeats, remapRepeats, repeatProblem, unrollScore, unrollSegments } from "./repeats.ts";
import type { Score } from "./theory.ts";
import { isScore } from "./score-storage.ts";

// 4/4, eight one-bar whole notes: bars start at 0,4,8,...,28; end 32.
const base = (extra: Partial<Score> = {}): Score => ({
  title: "反复", bpm: 120, beats: 4, beatUnit: 4, key: "C", mode: "major", clef: "treble", tonicOctave: 4,
  notes: Array.from({ length: 8 }, (_, i) => ({ pitches: [60 + i], dur: 4 })),
  ...extra,
});
const pitches = (s: Score) => s.notes.map((n) => n.pitches[0] ?? 0);

test("no repeats: one straight segment, same notes", () => {
  const s = base();
  assert.deepEqual(unrollSegments(s), [{ from: 0, to: 32 }]);
  const u = unrollScore(s);
  assert.deepEqual(u.score.notes, s.notes);
  assert.equal(u.sourceAt(10), 10);
});

test("single repeat bars 2–3", () => {
  const s = base({ repeats: [{ from: 4, to: 12 }] });
  assert.equal(repeatProblem(s), null);
  assert.deepEqual(unrollSegments(s), [{ from: 0, to: 12 }, { from: 4, to: 32 }]);
  const u = unrollScore(s);
  assert.deepEqual(pitches(u.score), [60, 61, 62, 61, 62, 63, 64, 65, 66, 67]);
  assert.deepEqual(u.source[0], [0, 1, 2, 1, 2, 3, 4, 5, 6, 7]);
  assert.equal(u.sourceAt(13), 5);
  assert.equal(u.score.repeats, undefined);
});

test("repeat from the start with 1st and 2nd endings", () => {
  // |: 1 2 [1. 3 :| [2. 4 | 5 ...
  const s = base({ repeats: [{ from: 0, to: 12, ending: 8, endingEnd: 16 }] });
  assert.equal(repeatProblem(s), null);
  assert.deepEqual(pitches(unrollScore(s).score), [60, 61, 62, 60, 61, 63, 64, 65, 66, 67]);
});

test("two repeats, voice 2 shorter stays aligned", () => {
  const s = base({ repeats: [{ from: 0, to: 8 }, { from: 16, to: 24 }], voice2: [{ pitches: [48], dur: 2 }, { pitches: [50], dur: 2 }] });
  const u = unrollScore(s);
  assert.deepEqual(pitches(u.score), [60, 61, 60, 61, 62, 63, 64, 65, 64, 65, 66, 67]);
  // voice 2: 48 50 then padding to bar 3, then 48 50 again.
  assert.deepEqual(u.score.voice2!.map((n) => n.pitches[0] ?? null), [48, 50, null, 48, 50]);
  assert.equal(u.score.voice2!.reduce((t, n) => t + n.dur, 0), 12);
});

test("tempo change inside a repeat is restated after the jump", () => {
  const s = base({ repeats: [{ from: 0, to: 8 }], changes: [{ at: 4, bpm: 60 }] });
  const u = unrollScore(s);
  assert.deepEqual(u.score.changes!.map((c) => [c.at, c.bpm]), [[4, 60], [8, 120], [12, 60]]);
});

test("invalid data is refused with a reason", () => {
  assert.match(repeatProblem(base({ repeats: [{ from: 2, to: 8 }] }))!, /小节线/);
  assert.match(repeatProblem(base({ repeats: [{ from: 8, to: 4 }] }))!, /之后/);
  assert.match(repeatProblem(base({ repeats: [{ from: 0, to: 12 }, { from: 8, to: 16 }] }))!, /重叠/);
  assert.match(repeatProblem(base({ repeats: [{ from: 0, to: 12, ending: 0 }] }))!, /一房/);
  assert.match(repeatProblem(base({ repeats: [{ from: 0, to: 12, endingEnd: 16 }] }))!, /先设一房/);
  assert.match(repeatProblem(base({ repeats: [{ from: 0, to: 12, ending: 8, endingEnd: 12 }] }))!, /二房/);
  // Broken repeats are played straight.
  assert.deepEqual(unrollSegments(base({ repeats: [{ from: 2, to: 8 }] })), [{ from: 0, to: 32 }]);
});

test("isScore rejects malformed repeats and accepts good ones", () => {
  assert.equal(isScore(base({ repeats: [{ from: 0, to: 8 }] })), true);
  assert.equal(isScore({ ...base(), repeats: "x" }), false);
  assert.equal(isScore({ ...base(), repeats: [{ from: 0 }] }), false);
  assert.equal(isScore({ ...base(), repeats: [{ from: 4, to: 4 }] }), false);
  assert.equal(isScore({ ...base(), repeats: [{ from: 0, to: 8, ending: "a" }] }), false);
});

test("bar-level editing: start, end, endings, clear, refusals", () => {
  let s = base();
  let r = editRepeats(s, 9, "end");
  assert.ok("repeats" in r);
  assert.deepEqual(r.repeats, [{ from: 0, to: 12 }]);
  s = { ...s, repeats: r.repeats };
  r = editRepeats(s, 5, "start");
  assert.ok("repeats" in r && r.repeats);
  assert.deepEqual(r.repeats, [{ from: 4, to: 12 }]);
  s = { ...s, repeats: r.repeats };
  const refused = editRepeats(s, 14, "second");
  assert.ok("error" in refused && /先设一房/.test(refused.error));
  r = editRepeats(s, 8, "first");
  assert.ok("repeats" in r);
  s = { ...s, repeats: r.repeats };
  r = editRepeats(s, 12, "second");
  assert.ok("repeats" in r);
  assert.deepEqual(r.repeats, [{ from: 4, to: 12, ending: 8, endingEnd: 16 }]);
  s = { ...s, repeats: r.repeats };
  const outside = editRepeats(s, 20, "first");
  assert.ok("error" in outside);
  assert.ok("error" in editRepeats(s, 26, "clear"));
  r = editRepeats(s, 13, "clear");
  assert.ok("repeats" in r && r.repeats === undefined);
});

test("remap after inserting / deleting a note shifts later marks", () => {
  const old = base().notes;
  const inserted = [...old.slice(0, 1), { pitches: [70], dur: 4 }, ...old.slice(1)];
  assert.deepEqual(remapRepeats([{ from: 4, to: 12 }], old, inserted), [{ from: 4, to: 16 }]);
  assert.deepEqual(remapRepeats([{ from: 8, to: 12 }], old, inserted), [{ from: 12, to: 16 }]);
  const removed = [...old.slice(0, 2), ...old.slice(3)];
  // A mark inside the removed bar drops that repeat.
  assert.equal(remapRepeats([{ from: 8, to: 16, ending: 12 }], old, removed)?.length, 1);
  assert.equal(remapRepeats([{ from: 4, to: 12 }, { from: 9, to: 16 }], old, removed)?.length, 1);
  const shorter = base({ notes: base().notes.slice(0, 2) });
  assert.equal(keepValidRepeats(shorter, [{ from: 0, to: 4 }, { from: 4, to: 24 }])?.length, 1);
});

test("share link and MIDI carry repeats", async () => {
  const { encodeSharePayload, decodeSharePayload } = await import("./share-link.ts");
  const { scoreToMidi } = await import("./midi.ts");
  const s = base({ repeats: [{ from: 0, to: 12, ending: 8, endingEnd: 16 }] });
  assert.deepEqual(decodeSharePayload(encodeSharePayload(s))?.repeats, s.repeats);
  const plain = scoreToMidi(base());
  const unrolled = scoreToMidi(s);
  // Two more whole notes (bars 1–2 again): 2 × (on + off) events longer.
  assert.ok(unrolled.length > plain.length);
  assert.deepEqual(scoreToMidi(unrollScore(s).score), unrolled);
});

test("MusicXML writes and reads repeats and endings", async () => {
  const { scoreToMusicXml, musicXmlToScore } = await import("./musicxml.ts");
  const s = base({ repeats: [{ from: 4, to: 12, ending: 8, endingEnd: 16 }, { from: 20, to: 28 }] });
  const xml = scoreToMusicXml(s);
  assert.equal((xml.match(/<repeat direction="forward"\/>/g) ?? []).length, 2);
  assert.equal((xml.match(/<repeat direction="backward"\/>/g) ?? []).length, 2);
  assert.match(xml, /<ending number="1" type="start">1\.<\/ending>/);
  assert.match(xml, /<ending number="2" type="discontinue"\/>/);
  const back = musicXmlToScore(xml, "x");
  assert.deepEqual(back.score.repeats, s.repeats);
  assert.ok(!back.losses.some((l) => l.startsWith("反复")));
  assert.match(back.notice, /已保留反复记号/);
  // A plain score has no barline noise.
  assert.doesNotMatch(scoreToMusicXml(base()), /<barline/);
  assert.equal(musicXmlToScore(scoreToMusicXml(base()), "x").score.repeats, undefined);
});

test("fitRepeats follows a single-voice edit and drops what no longer fits", async () => {
  const { fitRepeats } = await import("./repeats.ts");
  const prev = base({ repeats: [{ from: 4, to: 12 }] });
  const inserted = { ...prev, notes: [prev.notes[0], { pitches: [70], dur: 4 }, ...prev.notes.slice(1)] };
  assert.deepEqual(fitRepeats(prev, inserted).repeats, [{ from: 4, to: 16 }]);
  const cut = { ...prev, notes: prev.notes.slice(0, 2) };
  assert.equal(fitRepeats(prev, cut).repeats, undefined);
  const retitled = { ...prev, title: "新" };
  assert.equal(fitRepeats(prev, retitled), retitled);
});

test("wait mode steps through the played order", async () => {
  const { waitTargets } = await import("./wait-mode.ts");
  const s = base({ repeats: [{ from: 0, to: 12, ending: 8, endingEnd: 16 }] });
  assert.deepEqual(waitTargets(s).map((t) => t.pitches[0]), [60, 61, 62, 60, 61, 63, 64, 65, 66, 67]);
  // A practice loop keeps the bars as drawn.
  assert.deepEqual(waitTargets(s, "both", { from: 0, to: 12 }).map((t) => t.pitches[0]), [60, 61, 62]);
});

test("staff ABC draws |: :| [1 [2", async () => {
  const { engraveAbc } = await import("./notation.ts");
  const { abcBarText } = await import("./repeats.ts");
  const s = base({ repeats: [{ from: 4, to: 12, ending: 8, endingEnd: 16 }] });
  const abc = engraveAbc(s, 0, { bars: abcBarText(s) }).abc;
  assert.match(abc, /\|:\^C48 \|\[1 D48 :\|\[2 \^D48 \|\|/);
  assert.equal(abcBarText(base()), undefined);
  assert.equal(engraveAbc(base(), 0, { bars: abcBarText(base()) }).abc, engraveAbc(base()).abc);
  // Hits still point at the right characters.
  const { abc: text, hits } = engraveAbc(s, 0, { bars: abcBarText(s) });
  assert.equal(text.slice(hits[2].start, hits[2].end), "D48");
});
