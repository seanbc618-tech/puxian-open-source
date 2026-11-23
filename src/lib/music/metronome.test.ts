import assert from "node:assert/strict";
import test from "node:test";
import { clampBpm, cycleAccent, defaultAccents, metroTicks, resizeAccents, tapTempo } from "./metronome.ts";

test("bpm range 30–240", () => {
  assert.equal(clampBpm(10), 30);
  assert.equal(clampBpm(300), 240);
  assert.equal(clampBpm(99.6), 100);
});

test("tap tempo is the median of recent intervals and restarts after a pause", () => {
  let state = tapTempo([], 0);
  assert.equal(state.bpm, null);
  for (const t of [500, 1000, 1500, 2700, 3200]) state = tapTempo(state.taps, t);
  // intervals 500,500,500,1200,500 → median 500 → 120
  assert.equal(state.bpm, 120);
  state = tapTempo(state.taps, 6000);
  assert.equal(state.bpm, null);
  assert.deepEqual(state.taps, [6000]);
  let long = { taps: [] as number[], bpm: null as number | null };
  for (let i = 0; i < 20; i++) long = tapTempo(long.taps, i * 400);
  assert.equal(long.taps.length, 9);
  assert.equal(long.bpm, 150);
});

test("accents default, resize and cycle", () => {
  assert.deepEqual(defaultAccents(3), ["strong", "normal", "normal"]);
  assert.deepEqual(resizeAccents(["mute", "strong"], 4), ["mute", "strong", "normal", "normal"]);
  assert.deepEqual(resizeAccents(["mute", "strong", "normal"], 2), ["mute", "strong"]);
  assert.equal(cycleAccent("strong"), "normal");
  assert.equal(cycleAccent("normal"), "mute");
  assert.equal(cycleAccent("mute"), "strong");
});

test("ticks: accents, muted beats, subdivisions, resume index", () => {
  const settings = { bpm: 120, accents: ["strong", "mute", "normal"] as const, subdivision: 2 as const };
  const first = metroTicks(settings, 10, 0, 11.5);
  // tick = 0.25 s → indices 0..5 → beats 0,0,1,1,2,2 ; beat 1 muted
  assert.deepEqual(first.clicks.map((c) => [c.beat, c.sub, c.accent]), [[0, 0, true], [0, 1, false], [2, 0, false], [2, 1, false]]);
  assert.equal(first.next, 6);
  assert.equal(first.clicks[0].level, 1);
  assert.equal(first.clicks[1].level, 0.35);
  assert.equal(first.clicks[2].level, 0.6);
  const second = metroTicks(settings, 10, first.next, 12);
  assert.equal(second.clicks[0].when, 11.5);
  assert.equal(second.clicks[0].beat, 0);
});
