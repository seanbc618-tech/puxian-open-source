import test from "node:test";
import assert from "node:assert/strict";
import {
  SWING_LIGHT,
  SWING_STRAIGHT,
  SWING_TRIPLET,
  clampSwingRatio,
  isSwingFeel,
  swingApplies,
  swingFrac,
  swingWritten,
  unsWingFrac,
  unsWingWritten,
} from "./swing.ts";
import { secondsAt } from "./playback-clock.ts";
import type { Score } from "./theory.ts";

test("isSwingFeel and ratio clamp", () => {
  assert.equal(isSwingFeel("straight"), true);
  assert.equal(isSwingFeel("light"), true);
  assert.equal(isSwingFeel("swing"), true);
  assert.equal(isSwingFeel("heavy"), false);
  assert.equal(clampSwingRatio(Number.NaN), 0.5);
  assert.equal(clampSwingRatio(0.4), 0.5);
  assert.equal(clampSwingRatio(0.9), 0.75);
});

test("straight feel is an identity; compound meters do not swing", () => {
  assert.equal(swingApplies(4), true);
  assert.equal(swingApplies(2), true);
  assert.equal(swingApplies(8), false);
  for (const at of [0, 0.25, 0.5, 0.75, 1, 3.5]) {
    assert.equal(swingWritten(at, SWING_STRAIGHT, 4), at);
    assert.equal(unsWingWritten(at, SWING_STRAIGHT, 4), at);
    assert.equal(swingWritten(at, SWING_TRIPLET, 8), at, "6/8 stays straight");
  }
});

test("triplet swing stretches the first eighth to 2/3 of the quarter", () => {
  assert.equal(swingFrac(0, SWING_TRIPLET), 0);
  assert.ok(Math.abs(swingFrac(0.5, SWING_TRIPLET) - SWING_TRIPLET) < 1e-12);
  assert.equal(swingFrac(1, SWING_TRIPLET), 0, "1 wraps to the next quarter's 0");
  assert.ok(Math.abs(swingWritten(0.5, SWING_TRIPLET) - SWING_TRIPLET) < 1e-12);
  assert.ok(Math.abs(swingWritten(1.5, SWING_TRIPLET) - (1 + SWING_TRIPLET)) < 1e-12);
  assert.ok(Math.abs(swingWritten(0.25, SWING_TRIPLET) - SWING_TRIPLET / 2) < 1e-12);
  assert.ok(Math.abs(unsWingWritten(SWING_TRIPLET, SWING_TRIPLET) - 0.5) < 1e-12);
});

test("light swing (60/40) and inverse round-trip", () => {
  assert.ok(Math.abs(swingFrac(0.5, SWING_LIGHT) - 0.6) < 1e-12);
  for (const ratio of [SWING_STRAIGHT, SWING_LIGHT, SWING_TRIPLET]) {
    for (let i = 0; i < 16; i += 1) {
      const frac = i / 16;
      const back = unsWingFrac(swingFrac(frac, ratio), ratio);
      assert.ok(Math.abs(back - frac) < 1e-10, `ratio ${ratio} frac ${frac} → ${back}`);
      const at = 4 + frac;
      assert.ok(Math.abs(unsWingWritten(swingWritten(at, ratio), ratio) - at) < 1e-10);
    }
  }
});

test("a bar of even eighths at ♩=60 lasts the same, but the upbeat is later", () => {
  const score: Score = {
    title: "t", bpm: 60, beats: 4, beatUnit: 4, key: "C", mode: "major", clef: "treble", tonicOctave: 4,
    notes: Array.from({ length: 8 }, () => ({ pitches: [60], dur: 0.5 })),
  };
  const time = (q: number, ratio: number) => secondsAt(score, swingWritten(q, ratio, 4));
  assert.equal(time(0, SWING_TRIPLET), 0);
  assert.equal(time(4, SWING_TRIPLET), 4, "the bar still lasts four seconds");
  assert.ok(Math.abs(time(0.5, SWING_TRIPLET) - SWING_TRIPLET) < 1e-12);
  const down = time(0.5, SWING_TRIPLET) - time(0, SWING_TRIPLET);
  const up = time(1, SWING_TRIPLET) - time(0.5, SWING_TRIPLET);
  assert.ok(Math.abs(down / up - 2) < 1e-9, "2:1 long-short");
  assert.equal(time(0.5, SWING_STRAIGHT), 0.5);
});
