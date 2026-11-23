import test from "node:test";
import assert from "node:assert/strict";
import { clearFingering, scoreHasFingering, suggestFingering } from "./fingering.ts";
import { musicXmlToScore, scoreToMusicXml } from "./musicxml.ts";
import { isScore } from "./score-storage.ts";
import { simplifyScore } from "./simplify.ts";
import type { Score } from "./theory.ts";

function base(over: Partial<Score> & { notes: Score["notes"] }): Score {
  return {
    title: "t",
    bpm: 60,
    beats: 4,
    beatUnit: 4,
    key: "C",
    mode: "major",
    clef: "treble",
    tonicOctave: 4,
    ...over,
  };
}

test("C major scale gets the standard right-hand fingering 1-2-3-1-2-3-4-5", () => {
  const scale = [60, 62, 64, 65, 67, 69, 71, 72].map((midi) => ({ pitches: [midi], dur: 1 }));
  const frozen = structuredClone(base({ notes: scale }));
  const next = suggestFingering(frozen);
  assert.deepEqual(next.notes.map((note) => note.fingers), [[1], [2], [3], [1], [2], [3], [4], [5]]);
  assert.deepEqual(frozen.notes.map((note) => note.fingers), Array(8).fill(undefined));
});

test("a lower-register scale without a second voice uses the left-hand pattern", () => {
  const scale = [48, 50, 52, 53, 55, 57, 59, 60].map((midi) => ({ pitches: [midi], dur: 1 }));
  const next = suggestFingering(base({ notes: scale, clef: "bass" }));
  assert.deepEqual(next.notes.map((note) => note.fingers), [[5], [4], [3], [2], [1], [3], [2], [1]]);
});

test("triads use 1-3-5 in the right hand and 5-3-1 in the left", () => {
  const next = suggestFingering(
    base({
      notes: [{ pitches: [60, 64, 67], dur: 2 }],
      voice2: [{ pitches: [48, 52, 55], dur: 2 }],
    }),
  );
  assert.deepEqual(next.notes[0]!.fingers, [1, 3, 5]);
  assert.deepEqual(next.voice2![0]!.fingers, [5, 3, 1]);
});

test("clearing fingerings leaves a score without the field; old drafts stay valid", () => {
  const raw = base({ notes: [{ pitches: [60], dur: 1 }] });
  assert.equal(isScore(raw), true);
  assert.equal(scoreHasFingering(raw), false);
  const marked = suggestFingering(raw);
  assert.equal(scoreHasFingering(marked), true);
  const cleared = clearFingering(marked);
  assert.equal(cleared.notes[0]!.fingers, undefined);
  assert.equal(scoreHasFingering(cleared), false);
  assert.equal(isScore({ ...raw, notes: [{ pitches: [60], dur: 1, fingers: [1] }] }), true);
  assert.equal(isScore({ ...raw, notes: [{ pitches: [60], dur: 1, fingers: [9] }] }), false);
});

test("MusicXML round-trips piano fingerings", () => {
  const score = base({
    title: "指法",
    notes: [{ pitches: [60, 64, 67], dur: 1, fingers: [1, 3, 5] }],
  });
  const xml = scoreToMusicXml(score);
  assert.match(xml, /<fingering>1<\/fingering>/);
  assert.match(xml, /<fingering>3<\/fingering>/);
  assert.match(xml, /<fingering>5<\/fingering>/);
  const back = musicXmlToScore(xml, "fallback").score;
  assert.deepEqual(back.notes[0]!.fingers, [1, 3, 5]);
});

test("beginner simplify keeps the melody and bass, drops inner tones, and is non-mutating", () => {
  const score = base({
    notes: [
      { pitches: [64, 67, 71], dur: 0.25 },
      { pitches: [64, 67, 71], dur: 0.25 },
      { pitches: [64, 67, 71], dur: 0.25 },
      { pitches: [64, 67, 71], dur: 0.25 },
    ],
    voice2: [{ pitches: [48, 52, 55], dur: 1 }],
  });
  const frozen = structuredClone(score);
  const next = simplifyScore(score, "beginner");
  assert.deepEqual(score, frozen);
  assert.deepEqual(next.notes.map((note) => note.pitches), [[71], [71]]);
  assert.equal(next.notes.reduce((sum, note) => sum + note.dur, 0), 1);
  assert.deepEqual(next.voice2!.map((note) => note.pitches), [[48]]);
  assert.equal(simplifyScore(next, "beginner"), next);
});

test("medium simplify only trims wide chords and ornaments, keeping rhythm", () => {
  const score = base({
    notes: [{ pitches: [60, 64, 67, 72], dur: 0.5, ornament: "trill" }],
  });
  const next = simplifyScore(score, "medium");
  assert.equal(next.notes[0]!.dur, 0.5);
  assert.ok(next.notes[0]!.pitches.includes(72));
  assert.ok(next.notes[0]!.pitches.includes(60) === false || next.notes[0]!.pitches.length <= 3);
  assert.equal(next.notes[0]!.ornament, undefined);
});
