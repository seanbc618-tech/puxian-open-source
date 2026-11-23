import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { secondsAt } from "./playback-clock.ts";
import {
  FERMATA_STRETCH,
  canonicalFermatas,
  editFermatas,
  fermataSpans,
  hasFermata,
  remapFermatasForNotes,
  scoreWithFermataTempo,
  shiftFermatasForInsert,
  unrollFermatas,
} from "./fermata.ts";
import type { Score, ScoreNote } from "./theory.ts";
import { musicXmlToScore, scoreToMusicXml } from "./musicxml.ts";
import { import123 } from "./j123-import.ts";

function score(notes: ScoreNote[], extra: Partial<Score> = {}): Score {
  return {
    title: "t",
    bpm: 120,
    beats: 4,
    beatUnit: 4,
    key: "C",
    mode: "major",
    clef: "treble",
    tonicOctave: 4,
    notes,
    ...extra,
  };
}

const n = (midi: number, dur = 1): ScoreNote => ({ pitches: [midi], dur });

describe("fermata marks", () => {
  it("toggles a fermata on a selected note, including a rest, and clears it", () => {
    const base = score([n(60, 1), { pitches: [], dur: 1 }, n(64, 2)]);
    const onNote = editFermatas(base, 0, [0], "toggle");
    assert.deepEqual(canonicalFermatas(onNote.fermatas), [{ voice: 0, at: 0 }]);
    assert.equal(hasFermata(onNote, 0, 0), true);
    const off = editFermatas(onNote, 0, [0], "toggle");
    assert.equal(off.fermatas, undefined);
    const onRest = editFermatas(base, 0, [1], "set");
    assert.deepEqual(onRest.fermatas, [{ voice: 0, at: 1 }]);
    const cleared = editFermatas(onRest, 0, [1], "clear");
    assert.equal(cleared.fermatas, undefined);
  });

  it("slows the written span so a fermata lasts 1.5 times as long, then resumes the original tempo", () => {
    const withMark = editFermatas(score([n(60, 2), n(64, 2)]), 0, [0], "set");
    assert.deepEqual(fermataSpans(withMark), [{ from: 0, to: 2 }]);
    const timed = scoreWithFermataTempo(withMark);
    // Two written quarters at 120 BPM are 1 s; stretch 1.5 → 1.5 s.
    assert.ok(Math.abs(secondsAt(timed, 2) - 1.5) < 1e-9, `hold ${secondsAt(timed, 2)}`);
    // The following two quarters run at 120 again: +1 s, total 2.5 s (not 3).
    assert.ok(Math.abs(secondsAt(timed, 4) - 2.5) < 1e-9, `end ${secondsAt(timed, 4)}`);
    assert.equal(secondsAt(withMark, 4), 2, "the written draft keeps its original tempo");
    assert.equal(FERMATA_STRETCH, 1.5);
    // Existing mid-score tempo after the hold stays intact.
    const changing = editFermatas(
      score([n(60, 2), n(64, 2)], { changes: [{ at: 2, bpm: 60 }] }),
      0,
      [0],
      "set",
    );
    const after = scoreWithFermataTempo(changing);
    assert.ok(Math.abs(secondsAt(after, 2) - 1.5) < 1e-9);
    assert.ok(Math.abs(secondsAt(after, 4) - 3.5) < 1e-9);
  });

  it("holds the whole ensemble when only one voice has the mark", () => {
    const duo = editFermatas(
      score([n(72, 2), n(71, 2)], { voice2: [n(48, 4)] }),
      0,
      [0],
      "set",
    );
    const timed = scoreWithFermataTempo(duo);
    // Voice 2's long note covers the hold, so the last two written quarters start later.
    assert.ok(Math.abs(secondsAt(timed, 2) - 1.5) < 1e-9);
    assert.ok(Math.abs(secondsAt(timed, 4) - 2.5) < 1e-9);
  });

  it("follows a rewritten melody and copies marks when a selection is repeated", () => {
    const prev = [n(60, 1), n(62, 1), n(64, 2)];
    const marks = [{ voice: 0, at: 1 }, { voice: 1, at: 0 }];
    const stretched = remapFermatasForNotes(marks, 0, prev, [n(60, 2), n(62, 2), n(64, 2)]);
    assert.deepEqual(stretched.marks, [{ voice: 1, at: 0 }, { voice: 0, at: 2 }]);
    const short = remapFermatasForNotes(marks, 0, prev, [n(60, 1)]);
    assert.deepEqual(short.marks, [{ voice: 1, at: 0 }]);
    assert.match(short.notice ?? "", /没留在谱上/);
    const inserted = shiftFermatasForInsert(marks, 0, 0, 2, 2);
    assert.deepEqual(inserted, [
      { voice: 1, at: 0 },
      { voice: 0, at: 1 },
      { voice: 0, at: 3 },
    ]);
  });

  it("copies a fermata in a repeated section onto each played pass", () => {
    const marks = unrollFermatas(
      [{ voice: 0, at: 1 }],
      [
        { at: 0, from: 0, to: 4 },
        { at: 4, from: 0, to: 4 },
      ],
    );
    assert.deepEqual(marks, [
      { voice: 0, at: 1 },
      { voice: 0, at: 5 },
    ]);
  });
});

describe("fermata import and export", () => {
  it("round-trips a fermata through MusicXML, including one on a rest", () => {
    const original = editFermatas(score([n(60, 1), { pitches: [], dur: 1 }, n(64, 2)]), 0, [1], "set");
    const xml = scoreToMusicXml(original);
    assert.match(xml, /<fermata\/>/);
    const back = musicXmlToScore(xml, "fallback");
    assert.deepEqual(canonicalFermatas(back.score.fermatas), [{ voice: 0, at: 1 }]);
    assert.ok(!(back.losses ?? []).some((l) => l.includes("延长")), back.losses?.join(" / "));
  });

  it("reads a 123 延长 decoration onto the following note", () => {
    const result = import123("%123-1.0\nX:1\nT:测\nK:1=C\nM:4/4\nQ:1/4=90\n!延长!1 2 3 4 |\n");
    assert.deepEqual(canonicalFermatas(result.score.fermatas), [{ voice: 0, at: 0 }]);
    assert.ok(!(result.losses ?? []).some((l) => l.includes("延长")), result.losses?.join(" / "));
  });
});
