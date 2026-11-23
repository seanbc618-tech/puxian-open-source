import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GATE, soundingEvents } from "./expression.ts";
import {
  DOWNBEAT_LEVEL,
  OFFBEAT_LEVEL,
  followNoteAt,
  noteAtQuarter,
  quarterSeconds,
  scheduleBeats,
  staffFollowMarks,
  writtenQuarters,
  type BeatClick,
} from "./playback-clock.ts";
import type { Score, ScoreNote } from "./theory.ts";

function approx(actual: number, expected: number) {
  assert.ok(Math.abs(actual - expected) < 1e-9, `expected ${expected}, got ${actual}`);
}

function expectClicks(
  clicks: BeatClick[],
  bpm: number,
  beats: number,
  beatUnit: number,
  count: number,
) {
  assert.equal(clicks.length, count);
  const beatQ = 4 / beatUnit;
  const second = quarterSeconds(bpm);
  for (let i = 0; i < clicks.length; i += 1) {
    const click = clicks[i];
    approx(click.quarter, i * beatQ);
    approx(click.seconds, click.quarter * second);
    assert.equal(click.beat, i % beats);
    assert.equal(click.accent, click.beat === 0);
    assert.equal(click.level, click.accent ? DOWNBEAT_LEVEL : OFFBEAT_LEVEL);
    assert.ok(click.quarter < count * beatQ || count === 0);
  }
  if (clicks.length > 1) {
    for (let i = 1; i < clicks.length; i += 1) {
      assert.ok(clicks[i].quarter > clicks[i - 1].quarter);
    }
  }
}

describe("quarterSeconds", () => {
  it("follows the playback quarter, and a dead tempo counts as one beat per minute", () => {
    approx(quarterSeconds(120), 0.5);
    approx(quarterSeconds(60), 1);
    approx(quarterSeconds(90), 2 / 3);
    assert.equal(quarterSeconds(0), 60);
    assert.equal(quarterSeconds(-12), 60);
    assert.equal(quarterSeconds(Number.NaN), 60);
    assert.equal(quarterSeconds(Number.POSITIVE_INFINITY), 60);
  });
});

describe("scheduleBeats", () => {
  it("clicks every quarter in 4/4, accents beat 1, and lines up with the notes", () => {
    const notes = [
      { dur: 1, pitches: [60] },
      { dur: 1, pitches: [62] },
      { dur: 1, pitches: [64] },
      { dur: 1, pitches: [65] },
    ];
    const clicks = scheduleBeats({
      bpm: 120,
      beats: 4,
      beatUnit: 4,
      quarters: writtenQuarters(notes),
    });
    expectClicks(clicks, 120, 4, 4, 4);
    assert.deepEqual(
      clicks.map((click) => click.seconds),
      [0, 0.5, 1, 1.5],
    );
    clicks.forEach((click, index) => {
      assert.equal(noteAtQuarter(notes, click.quarter), index);
    });
    assert.equal(OFFBEAT_LEVEL < DOWNBEAT_LEVEL, true);
    assert.equal(DOWNBEAT_LEVEL, 1);
  });

  it("does not add the downbeat that begins after the music ends", () => {
    const clicks = scheduleBeats({ bpm: 100, beats: 4, beatUnit: 4, quarters: 4 });
    assert.equal(clicks.length, 4);
    assert.equal(
      clicks.some((click) => click.quarter === 4),
      false,
    );
    const short = scheduleBeats({ bpm: 120, beats: 4, beatUnit: 4, quarters: 2.25 });
    expectClicks(short, 120, 4, 4, 3);
    assert.equal(short.at(-1)?.quarter, 2);
  });

  it("restarts the accent at the top of each 3/4 bar", () => {
    const clicks = scheduleBeats({ bpm: 60, beats: 3, beatUnit: 4, quarters: 6 });
    expectClicks(clicks, 60, 3, 4, 6);
    assert.deepEqual(
      clicks.map((click) => click.accent),
      [true, false, false, true, false, false],
    );
    assert.deepEqual(
      clicks.map((click) => click.seconds),
      [0, 1, 2, 3, 4, 5],
    );
  });

  it("clicks every eighth in 6/8 while BPM stays a quarter-note tempo", () => {
    const clicks = scheduleBeats({ bpm: 120, beats: 6, beatUnit: 8, quarters: 3 });
    expectClicks(clicks, 120, 6, 8, 6);
    assert.deepEqual(
      clicks.map((click) => click.quarter),
      [0, 0.5, 1, 1.5, 2, 2.5],
    );
    assert.deepEqual(
      clicks.map((click) => click.seconds),
      [0, 0.25, 0.5, 0.75, 1, 1.25],
    );
    assert.equal(clicks.filter((click) => click.accent).length, 1);
  });

  it("uses a half-note beat in 2/2 and still clicks when the music is shorter than a beat", () => {
    const clicks = scheduleBeats({ bpm: 90, beats: 2, beatUnit: 2, quarters: 4 });
    expectClicks(clicks, 90, 2, 2, 2);
    approx(clicks[1].seconds, 4 / 3);
    assert.equal(clicks[0].accent, true);
    assert.equal(clicks[1].accent, false);
    const pickup = scheduleBeats({ bpm: 90, beats: 2, beatUnit: 2, quarters: 1 });
    assert.equal(pickup.length, 1);
    assert.equal(pickup[0].quarter, 0);
    assert.equal(pickup[0].accent, true);
  });

  it("keeps the click going through a rest and counts one click per written beat", () => {
    const notes = [
      { dur: 1, pitches: [] as number[] },
      { dur: 1, pitches: [67] },
      { dur: 1, pitches: [69] },
      { dur: 1, pitches: [71] },
    ];
    const clicks = scheduleBeats({
      bpm: 80,
      beats: 4,
      beatUnit: 4,
      quarters: writtenQuarters(notes),
    });
    expectClicks(clicks, 80, 4, 4, 4);
    assert.equal(noteAtQuarter(notes, clicks[0].quarter), null);
    assert.equal(noteAtQuarter(notes, clicks[1].quarter), 1);

    const meters = [
      { bpm: 120, beats: 4, beatUnit: 4, quarters: 4, count: 4 },
      { bpm: 90, beats: 3, beatUnit: 4, quarters: 6, count: 6 },
      { bpm: 120, beats: 6, beatUnit: 8, quarters: 3, count: 6 },
      { bpm: 72, beats: 2, beatUnit: 2, quarters: 4, count: 2 },
      { bpm: 100, beats: 5, beatUnit: 4, quarters: 5, count: 5 },
      { bpm: 80, beats: 3, beatUnit: 8, quarters: 1.5, count: 3 },
      { bpm: 60, beats: 3, beatUnit: 16, quarters: 0.75, count: 3 },
      { bpm: 120, beats: 4, beatUnit: 4, quarters: 0.1, count: 1 },
    ];
    for (const meter of meters) {
      const scheduled = scheduleBeats(meter);
      expectClicks(scheduled, meter.bpm, meter.beats, meter.beatUnit, meter.count);
      assert.equal(
        scheduled.some((click) => click.quarter >= meter.quarters),
        false,
      );
    }
  });

  it("drops an empty or endless score and repairs a meter the staff cannot play", () => {
    assert.deepEqual(scheduleBeats({ bpm: 120, beats: 4, beatUnit: 4, quarters: 0 }), []);
    assert.deepEqual(scheduleBeats({ bpm: 120, beats: 4, beatUnit: 4, quarters: -2 }), []);
    assert.deepEqual(
      scheduleBeats({ bpm: 120, beats: 4, beatUnit: 4, quarters: Number.POSITIVE_INFINITY }),
      [],
    );
    const dead = scheduleBeats({ bpm: 0, beats: 4, beatUnit: 4, quarters: 2 });
    expectClicks(dead, 1, 4, 4, 2);
    assert.deepEqual(
      dead.map((click) => click.seconds),
      [0, 60],
    );
    const badUnit = scheduleBeats({ bpm: 120, beats: 4, beatUnit: 0, quarters: 2 });
    expectClicks(badUnit, 120, 4, 4, 2);
    const badBeats = scheduleBeats({ bpm: 60, beats: 0, beatUnit: 4, quarters: 4 });
    expectClicks(badBeats, 60, 4, 4, 4);
    assert.deepEqual(
      badBeats.map((click) => click.accent),
      [true, false, false, false],
    );
  });
});

describe("noteAtQuarter", () => {
  it("returns the written note under the playhead and skips rests", () => {
    const notes = [
      { dur: 1, pitches: [60, 64] },
      { dur: 0.5, pitches: [] as number[] },
      { dur: 0.5, pitches: [67] },
    ];
    assert.equal(noteAtQuarter(notes, 0), 0);
    assert.equal(noteAtQuarter(notes, 0.99), 0);
    assert.equal(noteAtQuarter(notes, 1), null);
    assert.equal(noteAtQuarter(notes, 1.49), null);
    assert.equal(noteAtQuarter(notes, 1.5), 2);
  });

  it("gives a shared boundary to the next note and nothing after the end", () => {
    const notes = [
      { dur: 1, pitches: [60] },
      { dur: 1, pitches: [62] },
    ];
    assert.equal(noteAtQuarter(notes, 1), 1);
    assert.equal(noteAtQuarter(notes, 2), null);
    assert.equal(noteAtQuarter(notes, 2.01), null);
    assert.equal(noteAtQuarter(notes, -0.01), null);
    assert.equal(noteAtQuarter(notes, Number.NaN), null);
    assert.equal(writtenQuarters(notes), 2);
  });

  it("stays on a written note for its whole length, where a grace or trill would sound", () => {
    const notes = [{ dur: 1, pitches: [72] }];
    assert.equal(noteAtQuarter(notes, 0), 0);
    assert.equal(noteAtQuarter(notes, 0.08), 0);
    assert.equal(noteAtQuarter(notes, 0.99), 0);
  });

  it("ignores a zero-length note instead of getting stuck on it", () => {
    const notes = [
      { dur: 0, pitches: [60] },
      { dur: 1, pitches: [62] },
    ];
    assert.equal(writtenQuarters(notes), 1);
    assert.equal(noteAtQuarter(notes, 0), 1);
    assert.equal(noteAtQuarter(notes, 0.5), 1);
    assert.equal(noteAtQuarter([], 0), null);
  });
});

function followScore(notes: ScoreNote[]): Score {
  return {
    title: "试",
    bpm: 96,
    beats: 4,
    beatUnit: 4,
    key: "C",
    mode: "major",
    clef: "treble",
    tonicOctave: 4,
    notes,
  };
}

describe("followNoteAt", () => {
  it("clears a staccato when its sound ends, while the written note is still under the playhead", () => {
    const notes: ScoreNote[] = [
      { pitches: [60], dur: 1, articulations: ["staccato"] },
      { pitches: [62], dur: 1, articulations: ["tenuto"] },
    ];
    const events = soundingEvents(followScore(notes));
    const gate = events[0].dur;
    assert.equal(gate, GATE.staccato);
    assert.ok(gate < 1);

    assert.equal(followNoteAt(events, 0), 0);
    assert.equal(followNoteAt(events, gate - 0.001), 0);
    assert.equal(followNoteAt(events, gate), null);
    assert.equal(followNoteAt(events, 0.9), null);
    assert.equal(noteAtQuarter(notes, 0.9), 0);

    assert.equal(followNoteAt(events, 1), 1);
    assert.equal(followNoteAt(events, 1.99), 1);
    assert.equal(followNoteAt(events, 2), null);
  });

  it("stays on the written note through a grace or trill, and only while those events sound", () => {
    const grace = soundingEvents(
      followScore([
        { pitches: [60], dur: 1, ornament: "grace", gracePitch: 62 },
        { pitches: [67], dur: 1 },
      ]),
    );
    assert.equal(followNoteAt(grace, 0), 0);
    assert.equal(followNoteAt(grace, grace[0].dur), 0);
    const graceEnd = grace[1].start + grace[1].dur;
    assert.ok(graceEnd < 1);
    assert.equal(followNoteAt(grace, graceEnd - 0.001), 0);
    assert.equal(followNoteAt(grace, graceEnd), null);
    assert.equal(followNoteAt(grace, 1), 1);

    const trill = soundingEvents(followScore([{ pitches: [60], dur: 1, ornament: "trill" }]));
    const trillEnd = Math.max(...trill.map((event) => event.start + event.dur));
    assert.equal(followNoteAt(trill, 0), 0);
    assert.equal(followNoteAt(trill, trillEnd / 2), 0);
    assert.equal(followNoteAt(trill, trillEnd - 0.001), 0);
    assert.equal(followNoteAt(trill, trillEnd), null);
  });

  it("fills the whole chord while it sounds, and does not add a click per pitch", () => {
    const chord: ScoreNote[] = [
      { pitches: [60, 64, 67], dur: 1 },
      { pitches: [62], dur: 1 },
    ];
    const events = soundingEvents(followScore(chord));
    assert.equal(events.length, 4);
    assert.ok(events.slice(0, 3).every((event) => event.note === 0 && event.start === 0));
    assert.deepEqual(
      events.slice(0, 3).map((event) => event.midi),
      [60, 64, 67],
    );
    assert.equal(followNoteAt(events, 0), 0);
    assert.equal(followNoteAt(events, 0.5), 0);
    assert.equal(followNoteAt(events, 1), 1);
    const chordClicks = scheduleBeats({
      bpm: 96,
      beats: 4,
      beatUnit: 4,
      quarters: writtenQuarters(chord),
    });
    const singleClicks = scheduleBeats({
      bpm: 96,
      beats: 4,
      beatUnit: 4,
      quarters: writtenQuarters([{ dur: 1 }, { dur: 1 }]),
    });
    assert.deepEqual(chordClicks, singleClicks);
    assert.equal(chordClicks.length, 2);
  });

  it("keeps expression selection on a note after the follow fill has cleared", () => {
    const events = soundingEvents(
      followScore([{ pitches: [60], dur: 1, articulations: ["staccato"] }]),
    );
    const during = staffFollowMarks(0, [0], followNoteAt(events, 0));
    const after = staffFollowMarks(0, [0], followNoteAt(events, GATE.staccato));
    assert.deepEqual(during, { chosen: true, sounding: true });
    assert.deepEqual(after, { chosen: true, sounding: false });
    assert.equal(followNoteAt(events, -0.1), null);
    assert.equal(followNoteAt([], 0), null);
  });
});
