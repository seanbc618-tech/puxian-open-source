import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { PolyNoteEvent } from "./basic-pitch/notes.ts";
import { analyzePulse, beatPosition, quarterAt, regroupPulse, scalePulse } from "./poly-rhythm.ts";
import { estimateKey, chordLine } from "./poly-harmony.ts";
import { buildPolyDraft, cleanPolyNotes, suggestSplit } from "./poly-dictation.ts";
import type { Score } from "./theory.ts";

function rnd(seed: number) {
  return () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
}

const PROGRESSION = [
  [48, 60, 64, 67],
  [43, 59, 62, 67],
  [45, 60, 64, 69],
  [41, 60, 65, 69],
];

/** Bass on each downbeat, chord tones on every subdivision, a little timing jitter. */
function performance(bpm: number, meter: number, sub: number, bars: number, jitter = 0.01, seed = 1): PolyNoteEvent[] {
  const r = rnd(seed);
  const q = 60 / bpm;
  const out: PolyNoteEvent[] = [];
  for (let b = 0; b < bars; b++) {
    const chord = PROGRESSION[b % PROGRESSION.length]!;
    for (let beat = 0; beat < meter; beat++) {
      for (let s = 0; s < sub; s++) {
        const t = (b * meter + beat + s / sub) * q + (r() - 0.5) * 2 * jitter + 0.3;
        if (beat === 0 && s === 0) out.push({ start: t, dur: q * meter * 0.9, midi: chord[0]!, amplitude: 0.8 });
        const upper = chord.slice(1);
        out.push({ start: t, dur: (q / sub) * 0.9, midi: upper[(beat * sub + s) % upper.length]! + (s % 2 ? 12 : 0), amplitude: 0.5 });
        if (sub === 1 && beat > 0) out.push({ start: t, dur: q * 0.9, midi: upper[(beat + 1) % upper.length]!, amplitude: 0.45 });
      }
    }
  }
  return out;
}

const cases: Array<[string, number, number, number, number, string]> = [
  ["4/4 eighths at 100", 100, 4, 2, 12, "4/4"],
  ["4/4 eighths at 120", 120, 4, 2, 12, "4/4"],
  ["4/4 sixteenths at 60", 60, 4, 4, 8, "4/4"],
  ["3/4 waltz at 120", 120, 3, 1, 16, "3/4"],
  ["3/4 eighths at 90", 90, 3, 2, 12, "3/4"],
  ["4/4 quarters at 80", 80, 4, 1, 12, "4/4"],
  ["4/4 eighths at 140", 140, 4, 2, 16, "4/4"],
];

for (const [name, bpm, meter, sub, bars, want] of cases) {
  test(`pulse: ${name}`, () => {
    const grid = analyzePulse(performance(bpm, meter, sub, bars));
    assert.equal(`${grid.meter.beats}/${grid.meter.beatUnit}`, want);
    assert.ok(Math.abs(grid.bpm - bpm) <= Math.max(3, bpm * 0.04), `bpm ${grid.bpm} for ${bpm}`);
    assert.equal(grid.downbeat, 0);
  });
}

test("beatPosition interpolates between tracked beats and extrapolates at the ends", () => {
  const beats = [1, 2, 3.5];
  assert.equal(beatPosition(beats, 1), 0);
  assert.equal(beatPosition(beats, 1.5), 0.5);
  assert.equal(beatPosition(beats, 2.75), 1.5);
  assert.equal(beatPosition(beats, 0.5), -0.5);
  assert.equal(beatPosition(beats, 5), 3);
});

test("scalePulse doubles and halves around bar 1; regroupPulse switches quarter and eighth beats", () => {
  const grid = analyzePulse(performance(100, 4, 2, 12));
  const fast = scalePulse(grid, 2);
  assert.equal(fast.bpm, grid.bpm * 2);
  assert.equal(fast.beatTimes.length, grid.beatTimes.length * 2 - 1);
  const slow = scalePulse(grid, 0.5);
  assert.equal(slow.bpm, Math.round(grid.bpm / 2));
  const eighths = regroupPulse(performance(100, 4, 2, 12), grid, { beats: 6, beatUnit: 8 });
  assert.equal(eighths.beatQuarters, 0.5);
  assert.equal(eighths.bpm, grid.bpm);
  // A tracked quarter beat is two eighth beats later on the eighth grid: same quarter position.
  const t = grid.beatTimes[8]!;
  assert.ok(Math.abs((quarterAt(eighths, t) - quarterAt(eighths, grid.beatTimes[7]!)) - 1) < 1e-6);
});

const base: Score = { title: "t", bpm: 92, beats: 4, beatUnit: 4, key: "C", mode: "major", clef: "treble", tonicOctave: 4, notes: [] };

function bwv846(): PolyNoteEvent[] {
  const fixture = JSON.parse(readFileSync(new URL("./fixtures/poly/bwv846-45s.notes.json", import.meta.url), "utf8")) as { notes: number[][] };
  return fixture.notes.map(([start, dur, midi, amplitude]) => ({ start: start!, dur: dur!, midi: midi!, amplitude: amplitude! }));
}

test("真实录音 BWV 846（CC0）：约 55 BPM、4/4、C 大调，和弦 C | Dm7/C | G7/B | C", () => {
  const raw = bwv846();
  const heard = cleanPolyNotes(raw).notes;
  const grid = analyzePulse(heard);
  assert.equal(`${grid.meter.beats}/${grid.meter.beatUnit}`, "4/4");
  assert.ok(grid.bpm >= 48 && grid.bpm <= 62, `bpm ${grid.bpm} (performance ≈ 52–56; was 176)`);
  const key = estimateKey(heard);
  assert.equal(`${key.key} ${key.mode}`, "C major");
  const draft = buildPolyDraft(raw, base, { bpm: grid.bpm, pulse: grid, split: suggestSplit(heard), layout: "reduced" });
  assert.equal(draft.score.beats, 4);
  assert.match(draft.chordLine, /^\| C \| Dm7\/C \| G7\/B \| C \| Am\/C \| D7\/C \|/);
  assert.ok((draft.score.chordSymbols?.length ?? 0) >= 8);
  const err = Math.max(...draft.reports.map((r) => r.maxError));
  assert.ok(err < 2, `max placement error ${err} beats (was 4.74)`);
  for (const note of [...draft.score.notes, ...(draft.score.voice2 ?? [])]) assert.ok(note.pitches.length <= 3);
});

test("chordLine shows bars and truncates", () => {
  assert.equal(chordLine(["Am", "E", null]), "| Am | E | – |");
  assert.match(chordLine(Array.from({ length: 20 }, () => "C"), 4), /… ?$/);
});
