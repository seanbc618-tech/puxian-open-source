import test from "node:test";
import assert from "node:assert/strict";
import {
  canonicalChordSymbols,
  chordFromMusicXml,
  chordPrefersSharps,
  detectChordSymbol,
  detectScoreChordSymbols,
  formatChordSymbol,
  parseChordSymbol,
  transposeChordSymbol,
  transposeChordSymbols,
  remapChordSymbolsForNotes,
} from "./chord-symbol.ts";
import { isScore } from "./score-storage.ts";
import { transposeScore, type Score } from "./theory.ts";
import { engraveAbc } from "./notation.ts";

function score(over: Partial<Score> = {}): Score {
  return {
    title: "t",
    bpm: 60,
    beats: 4,
    beatUnit: 4,
    key: "C",
    mode: "major",
    clef: "treble",
    tonicOctave: 4,
    notes: [{ pitches: [60], dur: 1 }],
    ...over,
  };
}

test("parses and formats triads, sevenths, suspensions, and slash bass", () => {
  assert.equal(formatChordSymbol(parseChordSymbol("C")!, "C", "major"), "C");
  assert.equal(formatChordSymbol(parseChordSymbol("Am")!, "C", "major"), "Am");
  assert.equal(formatChordSymbol(parseChordSymbol("G7")!, "C", "major"), "G7");
  assert.equal(formatChordSymbol(parseChordSymbol("Cmaj7")!, "C", "major"), "Cmaj7");
  assert.equal(formatChordSymbol(parseChordSymbol("CM7")!, "C", "major"), "Cmaj7");
  assert.equal(formatChordSymbol(parseChordSymbol("Am7")!, "C", "major"), "Am7");
  assert.equal(formatChordSymbol(parseChordSymbol("G/B")!, "C", "major"), "G/B");
  assert.equal(formatChordSymbol(parseChordSymbol("F#m7")!, "G", "major"), "F#m7");
  assert.equal(formatChordSymbol(parseChordSymbol("Bbm")!, "Ab", "major"), "Bbm");
  assert.equal(formatChordSymbol(parseChordSymbol("Csus4")!, "C", "major"), "Csus4");
  assert.equal(formatChordSymbol(parseChordSymbol("Dsus2")!, "C", "major"), "Dsus2");
  assert.equal(formatChordSymbol(parseChordSymbol("Bdim")!, "C", "major"), "Bdim");
  assert.equal(formatChordSymbol(parseChordSymbol("Caug")!, "C", "major"), "Caug");
  assert.equal(parseChordSymbol(""), null);
  assert.equal(parseChordSymbol("???"), null);
});

test("transposes roots and slash bass into the new key's spelling", () => {
  assert.equal(transposeChordSymbol("C", 7, "G", "major").symbol, "G");
  assert.equal(transposeChordSymbol("Am", 7, "G", "major").symbol, "Em");
  assert.equal(transposeChordSymbol("G/B", 7, "G", "major").symbol, "D/F#");
  assert.equal(transposeChordSymbol("G7", 5, "F", "major").symbol, "C7");
  assert.equal(chordPrefersSharps("F", "major"), false);
  assert.equal(transposeChordSymbol("E", 1, "F", "major").symbol, "F");
  assert.equal(transposeChordSymbol("F#", 1, "F", "major").symbol, "G");
  // A tritone in a flat key is spelled as a flat.
  assert.equal(transposeChordSymbol("C", 1, "F", "major").symbol, "Db");
  const moved = transposeChordSymbols(
    [
      { at: 0, symbol: "C" },
      { at: 2, symbol: "G/B" },
      { at: 4, symbol: "???" },
    ],
    7,
    "G",
    "major",
  );
  assert.deepEqual(moved.symbols, [
    { at: 0, symbol: "G" },
    { at: 2, symbol: "D/F#" },
    { at: 4, symbol: "???" },
  ]);
  assert.deepEqual(moved.lost, ["???"]);
});

test("detects triads and common sevenths; slash bass when the lowest tone is not the root", () => {
  assert.equal(detectChordSymbol([60, 64, 67], "C", "major"), "C");
  assert.equal(detectChordSymbol([57, 60, 64], "C", "major"), "Am");
  assert.equal(detectChordSymbol([55, 59, 62, 65], "C", "major"), "G7");
  assert.equal(detectChordSymbol([60, 64, 67, 71], "C", "major"), "Cmaj7");
  assert.equal(detectChordSymbol([60, 65, 67], "C", "major"), "Csus4");
  assert.equal(detectChordSymbol([59, 62, 67], "C", "major"), "G/B");
  assert.equal(detectChordSymbol([60], "C", "major"), null);
  assert.equal(detectChordSymbol([60, 61, 66], "C", "major"), null, "no promise on cluster/jazz marks");
});

test("detects a symbol only when the sounding chord changes", () => {
  const found = detectScoreChordSymbols(
    score({
      notes: [
        { pitches: [60, 64, 67], dur: 2 },
        { pitches: [60, 64, 67], dur: 1 },
        { pitches: [55, 59, 62], dur: 1 },
        { pitches: [], dur: 1 },
      ],
    }),
  );
  assert.deepEqual(found, [
    { at: 0, symbol: "C" },
    { at: 3, symbol: "G" },
  ]);
});

test("old drafts without chordSymbols stay valid; transposeScore moves marks with the melody", () => {
  const plain = score();
  assert.equal(isScore(plain), true);
  assert.equal("chordSymbols" in plain, false);
  const marked = score({
    notes: [
      { pitches: [60], dur: 1 },
      { pitches: [67], dur: 1 },
    ],
    chordSymbols: [
      { at: 0, symbol: "C" },
      { at: 1, symbol: "G" },
    ],
  });
  assert.equal(isScore(marked), true);
  const moved = transposeScore(marked, 2);
  assert.equal(moved.key, "D");
  assert.deepEqual(moved.notes.map((n) => n.pitches), [[62], [69]]);
  assert.deepEqual(moved.chordSymbols, [
    { at: 0, symbol: "D" },
    { at: 1, symbol: "A" },
  ]);
  const frozen = structuredClone(marked);
  transposeScore(marked, 2);
  assert.deepEqual(marked, frozen);
});

test("canonical list keeps one mark per instant and drops junk", () => {
  assert.deepEqual(
    canonicalChordSymbols([
      { at: 2, symbol: "G7" },
      { at: 0, symbol: "  C  " },
      { at: 0, symbol: "Am" },
      { at: -1, symbol: "X" },
      { at: 3, symbol: "" },
    ]),
    [
      { at: 0, symbol: "Am" },
      { at: 2, symbol: "G7" },
    ],
  );
  assert.equal(canonicalChordSymbols([]), undefined);
});

test("MusicXML kind/root/bass rebuilds a common mark; unknown text is kept and flagged", () => {
  assert.deepEqual(
    chordFromMusicXml({ rootStep: "G", kind: "dominant", bassStep: "B" }),
    { symbol: "G7/B", unsupported: false },
  );
  assert.deepEqual(
    chordFromMusicXml({ rootStep: "C", kind: "major-seventh" }),
    { symbol: "Cmaj7", unsupported: false },
  );
  const raw = chordFromMusicXml({ rootStep: "C", kind: "other", kindText: "C13#11" });
  assert.equal(raw?.symbol, "C13#11");
  assert.equal(raw?.unsupported, true);
});

test("ABC and lead-sheet engraving put quoted marks on the melody only", () => {
  const duo = score({
    notes: [{ pitches: [60], dur: 1 }, { pitches: [62], dur: 1 }],
    voice2: [{ pitches: [48], dur: 2 }],
    chordSymbols: [{ at: 0, symbol: "C" }, { at: 1, symbol: "G" }],
  });
  const full = engraveAbc(duo);
  assert.match(full.abc, /"C"/);
  assert.match(full.abc, /"G"/);
  assert.match(full.abc, /V:2/);
  const lead = engraveAbc(duo, 0, { leadSheet: true });
  assert.match(lead.abc, /"C"/);
  assert.doesNotMatch(lead.abc, /V:2/);
  const written = engraveAbc(duo, 2);
  assert.match(written.abc, /"D"/);
});

test("rewriting the melody follows chord marks to the same note slots, or drops ones past the end", () => {
  const previous = [
    { pitches: [60], dur: 1 },
    { pitches: [64], dur: 1 },
    { pitches: [67], dur: 2 },
    { pitches: [72], dur: 4 },
  ];
  const symbols = [
    { at: 0, symbol: "C" },
    { at: 2, symbol: "G" },
    { at: 4, symbol: "F" },
  ];
  const shortened = remapChordSymbolsForNotes(symbols, previous, [
    { pitches: [60], dur: 2 },
    { pitches: [67], dur: 2 },
  ]);
  assert.deepEqual(shortened.symbols, [
    { at: 0, symbol: "C" },
    { at: 2, symbol: "G" },
  ]);
  assert.match(shortened.notice ?? "", /超出新旋律/);

  const sameShape = remapChordSymbolsForNotes(symbols, previous, previous);
  assert.equal(sameShape.notice, undefined);
  assert.deepEqual(sameShape.symbols, symbols);
});
