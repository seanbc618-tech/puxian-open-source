import test from "node:test";
import assert from "node:assert/strict";
import type { PolyNoteEvent } from "./basic-pitch/notes.ts";
import { estimateKey, inferChordSymbols } from "./poly-harmony.ts";

const ev = (start: number, dur: number, midi: number, amplitude = 0.6): PolyNoteEvent => ({ start, dur, midi, amplitude });

test("estimateKey: G maj7 / D maj7 with a D bass is D major, not its relative B minor", () => {
  const notes: PolyNoteEvent[] = [];
  for (let bar = 0; bar < 8; bar++) {
    const t = bar * 2.4;
    const [bass, chord] = bar % 2 ? [38, [57, 61, 66]] : [43, [59, 62, 66]];
    notes.push(ev(t, 2.3, bass!, 0.7));
    for (const m of chord as number[]) notes.push(ev(t + 0.8, 1.5, m, 0.5));
    notes.push(ev(t + 0.8, 0.7, [78, 81, 79, 78, 73, 71, 73, 74][bar]!, 0.6));
  }
  notes.push(ev(20, 2, 38, 0.8), ev(20, 2, 62, 0.5), ev(20, 2, 66, 0.5), ev(20, 2, 69, 0.5));
  assert.deepEqual(
    (({ key, mode }) => ({ key, mode }))(estimateKey(notes)),
    { key: "D", mode: "major" },
  );
});

test("estimateKey: A minor with G♯ and A/E bass", () => {
  const notes: PolyNoteEvent[] = [];
  const melody = [76, 75, 76, 75, 76, 71, 74, 72, 69];
  melody.forEach((m, i) => notes.push(ev(i * 0.2, 0.2, m)));
  notes.push(ev(1.8, 0.6, 45, 0.7), ev(2.0, 0.4, 52), ev(2.2, 0.4, 57), ev(2.4, 0.6, 40, 0.7), ev(2.6, 0.4, 52), ev(2.8, 0.4, 56));
  notes.push(ev(3.2, 1, 45, 0.7), ev(3.2, 1, 69), ev(3.2, 1, 72), ev(3.2, 1, 76));
  assert.equal(estimateKey(notes).mode, "minor");
  assert.equal(estimateKey(notes).key, "A");
});

test("inferChordSymbols names one chord per bar and splits a 4/4 bar when halves differ", () => {
  const bar = (pitches: number[], dur = 4) => ({ pitches, dur });
  const voices = [[bar([60, 64, 67]), { pitches: [55, 59, 62], dur: 2 }, { pitches: [53, 57, 60], dur: 2 }, bar([57, 60, 64])]];
  const result = inferChordSymbols(voices, [0, 4, 8], 12, "C", "major", 1);
  assert.deepEqual(result.bars, ["C", "G F", "Am"]);
  assert.deepEqual(result.symbols.map((s) => [s.at, s.symbol]), [[0, "C"], [4, "G"], [6, "F"], [8, "Am"]]);
});
