import test from "node:test";
import assert from "node:assert/strict";
import { accompanimentEvents, beatAttacks, isNoChord } from "./comp.ts";
import type { Score } from "./theory.ts";

function score(partial: Partial<Score> & Pick<Score, "notes">): Score {
  return {
    title: "t",
    bpm: 120,
    beats: 4,
    beatUnit: 4,
    key: "C",
    mode: "major",
    clef: "treble",
    tonicOctave: 4,
    ...partial,
  };
}

test("N.C. and empty marks are silent", () => {
  assert.equal(isNoChord("N.C."), true);
  assert.equal(isNoChord("nc"), true);
  assert.equal(isNoChord("无"), true);
  assert.equal(isNoChord("C"), false);
  const empty = score({ notes: [{ pitches: [60], dur: 4 }] });
  assert.deepEqual(accompanimentEvents(empty), []);
  const nc = score({
    notes: [{ pitches: [60], dur: 4 }],
    chordSymbols: [{ at: 0, symbol: "N.C." }],
  });
  assert.deepEqual(accompanimentEvents(nc), []);
});

test("C to G in 4/4: bass on beats 1 and 3, chord on downbeats, range clips", () => {
  const s = score({
    notes: [{ pitches: [60], dur: 8 }],
    chordSymbols: [{ at: 0, symbol: "C" }, { at: 4, symbol: "G" }],
  });
  const all = accompanimentEvents(s);
  const bass = all.filter((e) => e.timbre === "bass");
  const piano = all.filter((e) => e.timbre === "piano");
  assert.deepEqual(bass.map((e) => e.start), [0, 2, 4, 6]);
  assert.ok(bass[0].midi % 12 === 0, "C bass is a C");
  assert.ok(bass[2].midi % 12 === 7, "G bass is a G");
  assert.ok(piano.some((e) => e.start === 0 && e.midi % 12 === 0));
  assert.ok(piano.some((e) => e.start === 4 && e.midi % 12 === 7));
  assert.ok(piano.every((e) => e.start === 0 || e.start === 4 || e.start === 2 || e.start === 6));
  const mid = accompanimentEvents(s, 4, 8);
  assert.ok(mid.every((e) => e.start >= 4 - 1e-9 && e.start + e.dur <= 8 + 1e-9));
  assert.ok(mid.some((e) => e.timbre === "bass" && e.midi % 12 === 7));
  assert.ok(!mid.some((e) => e.start < 4 - 1e-9));
});

test("slash bass stays on the written bass pitch", () => {
  const s = score({
    notes: [{ pitches: [60], dur: 4 }],
    chordSymbols: [{ at: 0, symbol: "C/G" }],
  });
  const bass = accompanimentEvents(s).filter((e) => e.timbre === "bass");
  assert.ok(bass.length >= 1);
  assert.ok(bass.every((e) => e.midi % 12 === 7), "C/G bass is G");
});

test("3/4 places bass on beats 1 and 3; 6/8 stays on the dotted pulse", () => {
  const triple = score({
    beats: 3,
    beatUnit: 4,
    notes: [{ pitches: [60], dur: 3 }],
    chordSymbols: [{ at: 0, symbol: "Am" }],
  });
  const bass34 = accompanimentEvents(triple).filter((e) => e.timbre === "bass").map((e) => e.start);
  assert.deepEqual(bass34, [0, 2]);
  const compound = score({
    beats: 6,
    beatUnit: 8,
    notes: [{ pitches: [60], dur: 3 }],
    chordSymbols: [{ at: 0, symbol: "F" }],
  });
  const attacks = beatAttacks(compound, 0, 3);
  assert.ok(attacks.includes(0) && attacks.includes(0.5));
  const bass68 = accompanimentEvents(compound).filter((e) => e.timbre === "bass").map((e) => +e.start.toFixed(4));
  assert.deepEqual(bass68, [0, 1, 2]);
});

test("accompaniment never writes into the score and ignores unknown marks", () => {
  const s = score({
    notes: [{ pitches: [64], dur: 4 }],
    chordSymbols: [{ at: 0, symbol: "C" }, { at: 2, symbol: "?" }],
  });
  const before = JSON.stringify(s);
  const events = accompanimentEvents(s);
  assert.equal(JSON.stringify(s), before);
  assert.ok(events.every((e) => e.start < 2));
  assert.ok(events.length > 0);
});
