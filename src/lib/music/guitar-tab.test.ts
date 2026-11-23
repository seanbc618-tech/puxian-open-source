import test from "node:test";
import assert from "node:assert/strict";
import { EXAMPLES, scoreFromExample } from "./examples.ts";
import {
  BASS_STANDARD,
  GUITAR_STANDARD,
  candidatesFor,
  describeTabMisses,
  guitarTabOf,
  layoutGuitarTab,
} from "./guitar-tab.ts";
import { scoreToMusicXmlTab } from "./tab-musicxml.ts";
import { tabPrint } from "./tab-print.ts";
import { DEFAULT_PRINT_SETTINGS } from "./print-layout.ts";
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

test("open strings sit at fret 0 on the matching string", () => {
  const opens = [64, 59, 55, 50, 45, 40];
  const score = base({ notes: opens.map((midi) => ({ pitches: [midi], dur: 1 })) });
  const frozen = structuredClone(score);
  const model = guitarTabOf(score);
  assert.deepEqual(
    model.places.map((p) => [p.midi, p.string, p.fret]),
    [
      [64, 1, 0],
      [59, 2, 0],
      [55, 3, 0],
      [50, 4, 0],
      [45, 5, 0],
      [40, 6, 0],
    ],
  );
  assert.equal(model.misses.length, 0);
  assert.deepEqual(score, frozen, "projection does not mutate the score");
});

test("C major scale in first position uses the expected frets", () => {
  // C3 D3 E3 F3 G3 A3 B3 C4
  const scale = [48, 50, 52, 53, 55, 57, 59, 60];
  const score = base({ notes: scale.map((midi) => ({ pitches: [midi], dur: 1 })) });
  const model = guitarTabOf(score);
  assert.deepEqual(
    model.places.map((p) => [p.string, p.fret]),
    [
      [5, 3], // C3 on A
      [4, 0], // D3 open
      [4, 2], // E3
      [4, 3], // F3
      [3, 0], // G3 open
      [3, 2], // A3
      [2, 0], // B3 open
      [2, 1], // C4
    ],
  );
  assert.equal(model.misses.length, 0);
});

test("a tempo change does not squash written start or duration", () => {
  const score = base({
    bpm: 60,
    changes: [{ at: 2, bpm: 120 }],
    notes: [
      { pitches: [64], dur: 2 },
      { pitches: [60], dur: 2 },
    ],
  });
  const model = guitarTabOf(score);
  assert.deepEqual(
    model.places.map((p) => [p.midi, p.start, p.dur]),
    [
      [64, 0, 2],
      [60, 2, 2],
    ],
  );
  assert.deepEqual(model.bars, [0, 4]);
});

test("two voices share one tab; a chord uses different strings", () => {
  const score = base({
    notes: [{ pitches: [60, 64, 67], dur: 2 }], // C4 E4 G4
    voice2: [{ pitches: [48], dur: 2 }], // C3
  });
  const model = guitarTabOf(score);
  assert.equal(model.places.length, 4);
  const strings = new Set(model.places.map((p) => p.string));
  assert.equal(strings.size, 4);
  assert.equal(model.misses.length, 0);
  const byMidi = Object.fromEntries(model.places.map((p) => [p.midi, p]));
  // Compact low-position voicing: G4 at e-string fret 3, E4 at B fret 5 (not open e, which
  // would force G4 onto fret 8 or 12). C3 stays on a low string at the matching fret.
  assert.deepEqual(
    [byMidi[67], byMidi[64], byMidi[60], byMidi[48]].map((item) => [item.string, item.fret]),
    [
      [1, 3],
      [2, 5],
      [3, 5],
      [5, 3],
    ],
  );
  assert.ok(model.places.every((item) => item.fret <= 5));
});

test("notes below the low string or above fret 24 are reported, not invented", () => {
  const score = base({
    notes: [
      { pitches: [39], dur: 1 }, // D#2, below E2
      { pitches: [89], dur: 1 }, // F6, above E4+24
      { pitches: [64], dur: 1 },
    ],
  });
  const model = guitarTabOf(score);
  assert.deepEqual(
    model.misses.map((m) => [m.midi, m.reason]),
    [
      [39, "low"],
      [89, "high"],
    ],
  );
  assert.equal(model.places.length, 1);
  assert.equal(model.places[0]!.midi, 64);
  assert.match(describeTabMisses(model.misses, GUITAR_STANDARD) ?? "", /无法安全落品/);
  assert.equal(candidatesFor(39, GUITAR_STANDARD).length, 0);
  assert.equal(candidatesFor(88, GUITAR_STANDARD).length > 0, true); // E6 = 24th fret
});

test("bass standard tuning places open E1–G2", () => {
  const opens = [43, 38, 33, 28];
  const score = base({ notes: opens.map((midi) => ({ pitches: [midi], dur: 1 })) });
  const model = guitarTabOf(score, BASS_STANDARD);
  assert.deepEqual(
    model.places.map((p) => [p.midi, p.string, p.fret]),
    [
      [43, 1, 0],
      [38, 2, 0],
      [33, 3, 0],
      [28, 4, 0],
    ],
  );
});

test("layout keeps a readable quarter width and maps string 1 to the top line", () => {
  const score = scoreFromExample(EXAMPLES.find((item) => item.id === "twinkle")!);
  const model = guitarTabOf(score);
  const layout = layoutGuitarTab(model, 320);
  assert.ok(layout.pxPerQuarter >= 28);
  assert.ok(layout.yOf(1) < layout.yOf(6));
  assert.equal(layout.xOf(0), layout.labelWidth);
  assert.ok(layout.width >= 320);
});

test("MusicXML tab export has TAB clef, standard tuning, and string/fret", () => {
  const score = base({
    title: "开放弦",
    notes: [
      { pitches: [40], dur: 1 },
      { pitches: [64], dur: 1 },
    ],
  });
  const { xml, notices } = scoreToMusicXmlTab(score);
  assert.equal(notices.length, 0);
  assert.match(xml, /<sign>TAB<\/sign>/);
  assert.match(xml, /<staff-lines>6<\/staff-lines>/);
  assert.match(xml, /<staff-tuning line="1">[\s\S]*<tuning-step>E<\/tuning-step>[\s\S]*<tuning-octave>2<\/tuning-octave>/);
  assert.match(xml, /<staff-tuning line="6">[\s\S]*<tuning-step>E<\/tuning-step>[\s\S]*<tuning-octave>4<\/tuning-octave>/);
  assert.match(xml, /<technical>[\s\S]*<string>6<\/string>[\s\S]*<fret>0<\/fret>/);
  assert.match(xml, /<technical>[\s\S]*<string>1<\/string>[\s\S]*<fret>0<\/fret>/);
  assert.match(xml, /<part-name>吉他<\/part-name>/);
  assert.match(xml, /<software>谱线<\/software>/);
});

test("unplaceable pitches stay in MusicXML as pitch only, with a notice", () => {
  const score = base({
    notes: [
      { pitches: [39], dur: 1 },
      { pitches: [64], dur: 1 },
    ],
  });
  const { xml, notices } = scoreToMusicXmlTab(score);
  assert.equal(notices.length, 1);
  assert.match(notices[0]!, /无法安全落品/);
  assert.match(xml, /<step>E<\/step>/); // E4 is still written
  // The unplaced D#2 still has pitch, but no technical.
  assert.match(xml, /<alter>1<\/alter>|D#|<step>D<\/step>/);
  const notes = xml.split("<note>").slice(1);
  const low = notes.find((block) => /<alter>/.test(block) || /<step>D<\/step>/.test(block));
  const openE = notes.find((block) => /<string>1<\/string>/.test(block));
  assert.ok(low && !/<technical>/.test(low));
  assert.ok(openE && /<fret>0<\/fret>/.test(openE));
});

test("tab print emits cream SVG pages with fret numbers and no score mutation", () => {
  const score = scoreFromExample(EXAMPLES.find((item) => item.id === "twinkle")!);
  const frozen = structuredClone(score);
  const out = tabPrint(score, DEFAULT_PRINT_SETTINGS);
  assert.ok(out.pages.length >= 1);
  assert.match(out.pages[0]!, /fill="#f7f3ea"/);
  assert.match(out.pages[0]!, />0</); // open or low frets appear as text
  assert.match(out.markup, /data-system=/);
  assert.match(out.pages[0]!, /吉他标准调弦/);
  assert.deepEqual(score, frozen);
});

test("auto fingering prefers a low fret over the same pitch higher on a lower string", () => {
  // A4 can sit at e-string fret 5, or B-string fret 10, or even higher.
  const score = base({ notes: [{ pitches: [69], dur: 1 }] });
  const model = guitarTabOf(score);
  assert.deepEqual(
    model.places.map((item) => [item.string, item.fret]),
    [[1, 5]],
  );
  assert.equal(model.position.id, "auto");
});

test("a chosen position moves a mid-range note into that fret window", () => {
  // C4: B-string fret 1 in first position; G-string fret 5 in V; A-string fret 15 in XII.
  const score = base({ notes: [{ pitches: [60], dur: 1 }] });
  const first = guitarTabOf(score, "guitar-standard", "I");
  const fifth = guitarTabOf(score, "guitar-standard", "V");
  const twelfth = guitarTabOf(score, "guitar-standard", "XII");
  assert.deepEqual(first.places.map((item) => [item.string, item.fret]), [[2, 1]]);
  assert.deepEqual(fifth.places.map((item) => [item.string, item.fret]), [[3, 5]]);
  assert.deepEqual(twelfth.places.map((item) => [item.string, item.fret]), [[5, 15]]);
  const xml = scoreToMusicXmlTab(score, "guitar-standard", "V");
  assert.match(xml.xml, /<string>3<\/string>[\s\S]*<fret>5<\/fret>/);
});

test("tab model and print keep chord names above the staff", () => {
  const score = base({
    notes: [
      { pitches: [60], dur: 2 },
      { pitches: [67], dur: 2 },
    ],
    chordSymbols: [
      { at: 0, symbol: "C" },
      { at: 2, symbol: "G" },
    ],
  });
  const frozen = structuredClone(score);
  const model = guitarTabOf(score);
  assert.deepEqual(
    model.chordMarks,
    [
      { at: 0, symbol: "C" },
      { at: 2, symbol: "G" },
    ],
  );
  const withMarks = layoutGuitarTab(model, 320);
  const plain = layoutGuitarTab(guitarTabOf(base({ notes: score.notes })), 320);
  assert.ok(withMarks.axisHeight > plain.axisHeight);
  assert.ok(withMarks.yOf(1) > plain.yOf(1));
  const printed = tabPrint(score, DEFAULT_PRINT_SETTINGS);
  assert.match(printed.pages[0]!, />C</);
  assert.match(printed.pages[0]!, />G</);
  assert.match(printed.pages[0]!, /fill="#a44825"/);
  assert.deepEqual(score, frozen);
});
