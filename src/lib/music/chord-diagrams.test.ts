import test from "node:test";
import assert from "node:assert/strict";
import {
  chordDiagram,
  currentAndNextChord,
  chordTones,
  TUNINGS,
  searchFingering,
  recommendCapo,
  capoCost,
  shapeSymbol,
} from "./chord-diagrams.ts";
test("standard guitar teaching shapes are correct low to high", () => {
  for (const [s, f] of Object.entries({
    C: [-1, 3, 2, 0, 1, 0],
    G: [3, 2, 0, 0, 0, 3],
    Am: [-1, 0, 2, 2, 1, 0],
    F: [1, 3, 3, 2, 1, 1],
    Bm: [-1, 2, 4, 4, 3, 2],
    E7: [0, 2, 0, 1, 0, 0],
  }))
    assert.deepEqual(chordDiagram(s, "guitar").frets, f, s);
});
test("all common qualities produce exactly the chord tones for both string instruments", () => {
  for (const instrument of ["guitar", "ukulele"] as const)
    for (const root of ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"])
      for (const q of ["", "m", "7", "maj7", "m7", "sus2", "sus4", "dim", "aug"]) {
        const s = root + q,
          d = chordDiagram(s, instrument);
        if (!d.frets) continue;
        const got = [
          ...new Set(d.frets.flatMap((f, i) => (f < 0 ? [] : [(TUNINGS[instrument][i] + f) % 12]))),
        ].sort((a, b) => a - b);
        // Standard dominant-seventh voicings may omit the fifth (C7 x32310).
        if (q === "7") {
          assert.ok(got.every((t) => d.tones.includes(t)));
          for (const t of [d.tones[0], d.tones[1], d.tones[3]])
            assert.ok(got.includes(t), `${instrument} ${s}`);
        } else
          assert.deepEqual(
            got,
            [...d.tones].sort((a, b) => a - b),
            `${instrument} ${s}`,
          );
        const pressed = d.frets.filter((f) => f > 0);
        assert.ok(Math.max(0, ...d.frets) <= 5);
        if (pressed.length) assert.ok(Math.max(...pressed) - Math.min(...pressed) <= 4);
      }
});
test("ukulele tuning is reentrant GCEA, not guitar pitches", () => {
  assert.deepEqual(TUNINGS.ukulele, [67, 60, 64, 69]);
  assert.deepEqual(chordDiagram("C", "ukulele").frets, [0, 0, 0, 3]);
  assert.deepEqual(chordDiagram("G", "ukulele").frets, [0, 2, 3, 2]);
});
test("slash chords show root shape plus bass, unknown extensions fall back honestly", () => {
  assert.deepEqual(chordDiagram("C/E", "guitar").frets, chordDiagram("C", "guitar").frets);
  assert.equal(chordDiagram("C/E", "guitar").bass, "E");
  assert.equal(chordDiagram("C13", "guitar").frets, null);
  assert.deepEqual(chordTones("Cmaj7"), [0, 4, 7, 11]);
  assert.equal(searchFingering([0, 1, 2, 3, 4, 5, 6], TUNINGS.guitar), null);
  assert.deepEqual(chordDiagram("Cm7", "piano", 3).tones, [0, 3, 7, 10]);
});
test("capo recommendation minimizes pure shape score without transposing concert chords", () => {
  const symbols = ["Eb", "Ab", "Bb"],
    original = [...symbols],
    best = recommendCapo(symbols);
  assert.ok([1, 3].includes(best));
  for (let i = 0; i <= 7; i++) assert.ok(capoCost(symbols, best) <= capoCost(symbols, i));
  assert.equal(shapeSymbol("Eb", 3), "C");
  assert.deepEqual(symbols, original);
  assert.equal(recommendCapo(["C", "G", "Am"]), 0);
  assert.equal(recommendCapo([]), 0);
});

test("current and next follow written quarter positions, including before first and after last", () => {
  const marks = [
    { at: 4, symbol: "C" },
    { at: 8, symbol: "G" },
  ];
  assert.deepEqual(currentAndNextChord(marks, 0), { current: undefined, next: marks[0] });
  assert.deepEqual(currentAndNextChord(marks, 4), { current: marks[0], next: marks[1] });
  assert.deepEqual(currentAndNextChord(marks, 99), { current: marks[1], next: undefined });
});
