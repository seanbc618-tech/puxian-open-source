import assert from "node:assert/strict";
import test from "node:test";
import { clampA4, jianpuDegree, livePitchHz, midiToHz, needle, noteName, smoothPitch, TUNING_PRESETS, tunerReading } from "./tuner.ts";

const guitar = TUNING_PRESETS.find((p) => p.id === "guitar")!;

test("A4 reads in tune and A4 reference is clamped 430–450", () => {
  const r = tunerReading(440)!;
  assert.equal(r.name, "A4");
  assert.equal(r.cents, 0);
  assert.equal(r.inTune, true);
  assert.equal(clampA4(400), 430);
  assert.equal(clampA4(460), 450);
  assert.equal(clampA4(Number.NaN), 440);
  assert.equal(tunerReading(442, 442)!.cents, 0);
  assert.ok(Math.abs(tunerReading(442)!.cents - 7.9) < 0.1);
});

test("cents sign, needle clamp, names", () => {
  assert.ok(tunerReading(midiToHz(60) * 2 ** (-20 / 1200))!.cents < -19);
  assert.equal(noteName(61), "C♯4");
  assert.equal(noteName(40), "E2");
  assert.equal(needle(80), 1);
  assert.equal(needle(-25), -0.5);
  assert.equal(tunerReading(0), null);
  assert.equal(tunerReading(Number.NaN), null);
});

test("string presets pick nearest string and hint direction", () => {
  const low = tunerReading(midiToHz(40) * 2 ** (-30 / 1200), 440, guitar)!;
  assert.equal(low.string?.name, "E2");
  assert.equal(low.string?.index, 0);
  assert.equal(low.string?.hint, "调高");
  const sharpB = tunerReading(midiToHz(59) * 2 ** (20 / 1200), 440, guitar)!;
  assert.equal(sharpB.string?.name, "B3");
  assert.equal(sharpB.string?.hint, "调低");
  // Measured against the string, not the nearest semitone.
  const between = tunerReading(midiToHz(57), 440, guitar)!;
  assert.ok(Math.abs(between.cents) >= 200);
  assert.equal(tunerReading(midiToHz(69), 440, TUNING_PRESETS.find((p) => p.id === "violin"))!.string?.hint, "准");
  assert.equal(tunerReading(440, 440, TUNING_PRESETS[0])!.string, undefined);
});

test("jianpu degree against tonic and livePitch conversion", () => {
  assert.equal(jianpuDegree(67, 0), "5");
  assert.equal(jianpuDegree(63, 3), "1");
  assert.equal(jianpuDegree(62, 3), "7");
  assert.ok(Math.abs(livePitchHz(69) - 440) < 1e-9);
});

test("smoothing uses the median and needs two frames", () => {
  assert.equal(smoothPitch([60]), null);
  assert.equal(smoothPitch([60, 80, 61]), 61);
  assert.equal(smoothPitch([null, null, 60, 62]), 61);
});
