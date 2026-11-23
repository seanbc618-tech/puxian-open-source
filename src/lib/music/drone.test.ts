import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_DRONE, DRONE_STORE_KEY, cleanDrone, droneFrequencies, droneIntervals, droneRoot, justCents, readDrone, writeDrone } from "./drone.ts";

const r = (list: number[]) => list.map((f) => Math.round(f * 100) / 100);

test("root sits C3–B3 and climbs the scale", () => {
  assert.equal(droneRoot("C", "major", 1), 48);
  assert.equal(droneRoot("G", "major", 1), 55);
  assert.equal(droneRoot("G", "major", 5), 62);
  assert.equal(droneRoot("A", "minor", 3), 60);
});

test("voicings: single, pure fifth, diatonic triad (minor ii, diminished vii)", () => {
  assert.deepEqual(droneIntervals("major", 1, "root"), [0]);
  assert.deepEqual(droneIntervals("major", 7, "fifth"), [0, 7]);
  assert.deepEqual(droneIntervals("major", 1, "triad"), [0, 4, 7]);
  assert.deepEqual(droneIntervals("major", 2, "triad"), [0, 3, 7]);
  assert.deepEqual(droneIntervals("major", 7, "triad"), [0, 3, 6]);
  assert.deepEqual(droneIntervals("minor", 1, "triad"), [0, 3, 7]);
  assert.deepEqual(droneIntervals("minor", 6, "triad"), [0, 4, 7], "VI in minor wraps past the octave");
});

test("纯律 tunes third and fifth to ratios; equal stays 12-TET", () => {
  assert.deepEqual(r(droneFrequencies("A", "major", 1, "triad", "equal")), [220, 277.18, 329.63]);
  assert.deepEqual(r(droneFrequencies("A", "major", 1, "triad", "just")), [220, 275, 330]);
  assert.deepEqual(r(droneFrequencies("A", "minor", 1, "triad", "just")), [220, 264, 330]);
  assert.equal(justCents(4), -14);
  assert.equal(justCents(3), 16);
  assert.equal(justCents(7), 2);
  assert.equal(justCents(0), 0);
});

test("settings are cleaned, saved and survive broken storage", () => {
  assert.deepEqual(cleanDrone({ voicing: "x", tuning: "just", volume: 9 }), { voicing: "fifth", tuning: "just", volume: 1 });
  assert.deepEqual(cleanDrone(null), DEFAULT_DRONE);
  const data = new Map<string, string>();
  const store = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
  assert.equal(writeDrone(store, { voicing: "triad", tuning: "just", volume: 0.3 }), true);
  assert.deepEqual(JSON.parse(data.get(DRONE_STORE_KEY) ?? ""), { voicing: "triad", tuning: "just", volume: 0.3 });
  assert.deepEqual(readDrone(store), { voicing: "triad", tuning: "just", volume: 0.3 });
  const broken = { getItem: () => { throw new Error("no"); }, setItem: () => { throw new Error("full"); } };
  assert.deepEqual(readDrone(broken), DEFAULT_DRONE);
  assert.equal(writeDrone(broken, DEFAULT_DRONE), false);
});
