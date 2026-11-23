import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { quantizeMidi, quantizeNotice } from "./midi-quantize.ts";
import { analyzeMelody } from "./audio.ts";
import { scoreLayoutMotion, type LayoutView } from "./score-motion.ts";
import {
  beginStaffRender,
  exportDownloadName,
  freezeExportSnapshot,
  initialStaffGeneration,
  noteStaffFailed,
  noteStaffRendered,
  staffWaitResult,
} from "./staff-export.ts";
import { EXAMPLES, scoreFromExample } from "./examples.ts";
import {
  describeMidiVoice,
  listMidiVoices,
  midiChoicePrompt,
  previewMidiImport,
  midiImportNotice,
  midiLosses,
  midiToScore,
  scoreToMidi,
  type MidiVoice,
} from "./midi.ts";
import {
  engraveAbc,
  formatJianpu,
  formatLetters,
  importJianpu,
  jianpuShareText,
  parseJianpu,
  parseLetters,
  readJianpuHeader,
  staffCaption,
  toAbc,
} from "./notation.ts";
import { RecordingArm, finishArming, initialRecordGate, tapRecord } from "./record-session.ts";
import {
  KEY_NAMES,
  addChordPitch,
  canTranspose,
  keyPadShift,
  shortestShift,
  stackChordAt,
  tonicMidi,
  transposeKey,
  transposeScore,
  type KeyName,
  type Score,
} from "./theory.ts";

const concert = {
  key: "C" as const,
  mode: "major" as const,
  tonicOctave: 4,
  beats: 4,
  beatUnit: 4,
};

function asScore(notes: Score["notes"], extra: Partial<Score> = {}): Score {
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
    ...extra,
  };
}

function sameNotes(a: Score["notes"], b: Score["notes"]) {
  assert.equal(a.length, b.length);
  for (let i = 0; i < a.length; i += 1) {
    assert.deepEqual(a[i].pitches, b[i].pitches, `pitch ${i}`);
    assert.ok(Math.abs(a[i].dur - b[i].dur) < 1e-9, `dur ${i}: ${a[i].dur} vs ${b[i].dur}`);
  }
}

describe("jianpu", () => {
  it("round-trips every built-in tune", () => {
    for (const example of EXAMPLES) {
      const score = scoreFromExample(example);
      const parsed = parseJianpu(formatJianpu(score), score);
      assert.equal(parsed.error, null, example.id);
      sameNotes(score.notes, parsed.notes);
    }
  });

  it("reads fullwidth digits and a pasted key header", () => {
    const digits = parseJianpu("１ ２ ３", concert);
    assert.equal(digits.error, null);
    assert.deepEqual(
      digits.notes.map((note) => note.pitches[0]),
      [60, 62, 64],
    );

    const pasted = parseJianpu("1 = 降B\n4/4\n1 2 3", concert);
    assert.equal(pasted.error, null);
    assert.equal(pasted.notes.length, 3);
    assert.equal(pasted.notes[0].pitches[0], 60);
  });

  it("treats 5.6 like (5.6), and keeps a spaced dot as its own note", () => {
    const glued = parseJianpu("5.6", concert);
    const grouped = parseJianpu("(5.6)", concert);
    assert.equal(glued.error, null);
    sameNotes(glued.notes, grouped.notes);
    assert.equal(glued.notes[0].dur, 1.5);
    assert.equal(glued.notes[1].dur, 0.5);

    const spaced = parseJianpu("5. 6", concert);
    assert.equal(spaced.notes[0].dur, 1.5);
    assert.equal(spaced.notes[1].dur, 1);
  });

  it("shares text that pastes back, in the written key when shifted", () => {
    const score = scoreFromExample(EXAMPLES[0]);
    const shared = jianpuShareText(score, 0);
    assert.match(shared, /^1 = C\n4\/4\n/);
    const parsed = parseJianpu(shared, score);
    assert.equal(parsed.error, null);
    sameNotes(score.notes, parsed.notes);

    const clarinet = jianpuShareText(score, 2);
    assert.match(clarinet, /^1 = D\n4\/4\n/);
    const written = transposeScore(score, 2);
    const writtenNotes = parseJianpu(clarinet, written);
    assert.equal(writtenNotes.error, null);
    sameNotes(written.notes, writtenNotes.notes);
    assert.equal(written.notes[0].pitches[0], 62);
  });

  it("applies a pasted key and meter, and round-trips sounding pitches", () => {
    const moved = importJianpu("1 = F\n3/4\n1 2 3", concert, 0);
    assert.equal(moved.error, null);
    assert.equal(moved.key, "F");
    assert.equal(moved.beats, 3);
    assert.equal(moved.beatUnit, 4);
    assert.deepEqual(
      moved.notes.map((note) => note.pitches[0]),
      [65, 67, 69],
    );

    const meterOnly = importJianpu("6/8\n1 2 3", concert, 0);
    assert.equal(meterOnly.key, "C");
    assert.equal(meterOnly.beats, 6);
    assert.equal(meterOnly.beatUnit, 8);
    assert.equal(meterOnly.notes[0].dur, 0.5);

    const sixteenth = importJianpu("3/16\n1", concert, 0);
    assert.equal(sixteenth.error, null);
    assert.equal(sixteenth.beats, 3);
    assert.equal(sixteenth.beatUnit, 16);
    assert.equal(sixteenth.notes.length, 1);
    assert.equal(sixteenth.notes[0].dur, 0.25);
    assert.equal(readJianpuHeader("3/16\n1").beatUnit, 16);

    const sixEight = { ...concert, beats: 6, beatUnit: 8 };
    const unknown = importJianpu("1 = H\n4/4\n1 2 3", sixEight, 0);
    assert.match(unknown.error ?? "", /调名/);
    assert.equal(unknown.key, "C");
    assert.equal(unknown.beats, 6);
    assert.equal(unknown.beatUnit, 8);
    assert.equal(unknown.notes.length, 0);
    assert.match(parseJianpu("1 = H\n1", concert).error ?? "", /调名/);

    const badMeter = importJianpu("5/3\n1", sixEight, 0);
    assert.match(badMeter.error ?? "", /拍号/);
    assert.equal(badMeter.beats, 6);
    assert.equal(badMeter.beatUnit, 8);
    assert.equal(badMeter.notes.length, 0);

    for (const example of [EXAMPLES[0], EXAMPLES[3]]) {
      const score = scoreFromExample(example);
      for (const shift of [0, 2, 9, 7, 3]) {
        const text = jianpuShareText(score, shift);
        const imported = importJianpu(
          text,
          { ...score, key: shift === 0 ? score.key : "G" },
          shift,
        );
        assert.equal(imported.error, null, `${example.id} shift ${shift}`);
        assert.equal(imported.key, score.key);
        assert.equal(imported.beats, score.beats);
        assert.equal(imported.beatUnit, score.beatUnit);
        sameNotes(score.notes, imported.notes);
      }
    }
  });
});

describe("chords", () => {
  it("adds another pitch on the same note and keeps the duration", () => {
    const note = { pitches: [64], dur: 1, dynamic: "mf" as const };
    const added = addChordPitch(note, 60);
    assert.equal(added.ok, true);
    if (!added.ok) return;
    assert.deepEqual(added.note.pitches, [60, 64]);
    assert.equal(added.note.dur, 1);
    assert.equal(added.note.dynamic, "mf");
    assert.deepEqual(note.pitches, [64]);

    const again = addChordPitch(added.note, 67);
    assert.equal(again.ok, true);
    if (!again.ok) return;
    assert.deepEqual(again.note.pitches, [60, 64, 67]);
  });

  it("refuses a rest, a duplicate, a ninth tone, and a pitch outside the piano", () => {
    assert.deepEqual(addChordPitch({ pitches: [], dur: 1 }, 60), { ok: false, reason: "rest" });
    assert.deepEqual(addChordPitch({ pitches: [60], dur: 1 }, 60), {
      ok: false,
      reason: "duplicate",
    });
    assert.deepEqual(addChordPitch({ pitches: [60], dur: 1 }, 20), { ok: false, reason: "range" });
    const full = { pitches: [60, 62, 64, 65, 67, 69, 71, 72], dur: 1 };
    assert.deepEqual(addChordPitch(full, 74), { ok: false, reason: "full" });
  });

  it("stacks onto the chosen beat and leaves the other notes alone", () => {
    const notes = [
      { pitches: [60], dur: 1 },
      { pitches: [62], dur: 0.5 },
      { pitches: [], dur: 0.5 },
    ];
    const stacked = stackChordAt(notes, 1, 65);
    assert.equal(stacked.ok, true);
    if (!stacked.ok) return;
    assert.deepEqual(stacked.notes[1].pitches, [62, 65]);
    assert.equal(stacked.notes[1].dur, 0.5);
    assert.deepEqual(notes[1].pitches, [62]);
    assert.deepEqual(stacked.notes[0].pitches, [60]);
    assert.deepEqual(stackChordAt(notes, 2, 60), { ok: false, reason: "rest" });
    assert.deepEqual(stackChordAt(notes, 3, 60), { ok: false, reason: "index" });
  });

  it("round-trips a jianpu chord without turning 12 into a chord", () => {
    const chord = parseJianpu("[1,3,5]", concert);
    assert.equal(chord.error, null);
    assert.deepEqual(chord.notes, [{ pitches: [60, 64, 67], dur: 1 }]);

    const low = parseJianpu("[1,5,]", concert);
    assert.equal(low.error, null);
    assert.deepEqual(low.notes[0].pitches, [55, 60]);
    assert.equal(formatJianpu(asScore(low.notes)), "[5,+1]");

    const eighths = parseJianpu("12", concert);
    assert.equal(eighths.error, null);
    assert.equal(eighths.notes.length, 2);
    assert.deepEqual(eighths.notes[0].pitches, [60]);
    assert.deepEqual(eighths.notes[1].pitches, [62]);

    const score = asScore([
      { pitches: [60, 64, 67], dur: 1 },
      { pitches: [62, 65], dur: 0.5 },
      { pitches: [64], dur: 0.5 },
      { pitches: [67, 71, 74], dur: 1.5 },
    ]);
    const text = formatJianpu(score);
    const back = parseJianpu(text, score);
    assert.equal(back.error, null, text);
    sameNotes(score.notes, back.notes);
  });

  it("writes dotted-eighth beats as a fraction, not 0.75", () => {
    const text = formatJianpu(asScore([{ pitches: [64], dur: 0.75 }]));
    assert.match(text, /\*3\/4/);
    assert.equal(text.includes("*0.75"), false);
    const back = parseJianpu(text, asScore([]));
    assert.equal(back.error, null, text);
    assert.equal(Math.abs((back.notes[0]?.dur ?? 0) - 0.75) < 1e-6, true);
  });

  it("round-trips a letter chord and engraves it as one staff event", () => {
    const parsed = parseLetters("[C4,E4,G4] D4");
    assert.equal(parsed.error, null);
    assert.deepEqual(parsed.notes[0].pitches, [60, 64, 67]);
    const text = formatLetters(asScore(parsed.notes));
    const back = parseLetters(text);
    assert.equal(back.error, null, text);
    sameNotes(parsed.notes, back.notes);

    const engraved = engraveAbc(asScore([{ pitches: [60, 64, 67], dur: 1 }]));
    assert.match(engraved.abc, /\[CEG\]12/);
    assert.equal(engraved.hits.length, 1);
    assert.equal(engraved.hits[0].index, 0);
  });

  it("accepts eight unique jianpu or letter tones and refuses a ninth", () => {
    const eight = parseJianpu("[1,2,3,4,5,6,7,1']", concert);
    assert.equal(eight.error, null);
    assert.deepEqual(eight.notes[0].pitches, [60, 62, 64, 65, 67, 69, 71, 72]);

    const repeated = parseJianpu("[1,2,3,4,5,6,7,1',1']", concert);
    assert.equal(repeated.error, null);
    assert.equal(repeated.notes[0].pitches.length, 8);

    const nine = parseJianpu("[1,2,3,4,5,6,7,1',2']", concert);
    assert.equal(nine.notes.length, 0);
    assert.match(nine.error ?? "", /最多八个音/);

    const letterEight = parseLetters("[C4,D4,E4,F4,G4,A4,B4,C5]");
    assert.equal(letterEight.error, null);
    assert.deepEqual(letterEight.notes[0].pitches, [60, 62, 64, 65, 67, 69, 71, 72]);

    const letterNine = parseLetters("[C4,D4,E4,F4,G4,A4,B4,C5,D5]");
    assert.equal(letterNine.notes.length, 0);
    assert.match(letterNine.error ?? "", /最多八个音/);
  });

  it("keeps a one-voice chord through MIDI", () => {
    const score = asScore([
      { pitches: [60, 64, 67], dur: 1 },
      { pitches: [], dur: 1 },
      { pitches: [62], dur: 0.5 },
    ]);
    const back = midiToScore(scoreToMidi(score), "和弦");
    sameNotes(score.notes, back.notes);
  });
});

describe("letters", () => {
  it("keeps octave carry and key spelling", () => {
    const run = parseLetters("C4 D E");
    assert.equal(run.error, null);
    assert.deepEqual(
      run.notes.map((note) => note.pitches[0]),
      [60, 62, 64],
    );

    const flat = asScore([{ pitches: [61], dur: 1 }], { key: "Db" });
    const text = formatLetters(flat);
    assert.match(text, /^Db4$/);
    const back = parseLetters(text);
    assert.equal(back.error, null);
    assert.equal(back.notes[0].pitches[0], 61);
  });

  it("round-trips a jianpu triplet", () => {
    const notes = parseJianpu("123", concert).notes;
    const text = formatLetters(asScore(notes));
    const back = parseLetters(text);
    assert.equal(back.error, null, text);
    sameNotes(notes, back.notes);
  });
});

describe("transpose", () => {
  it("comes back to the same pitch after a tritone", () => {
    for (const from of KEY_NAMES) {
      for (const to of KEY_NAMES) {
        assert.equal(shortestShift(from, to) + shortestShift(to, from), 0, `${from} ${to}`);
      }
    }
    const score = scoreFromExample(EXAMPLES[0]);
    const up = transposeScore(score, shortestShift("C", "F#"));
    const back = transposeScore(up, shortestShift(up.key, "C"));
    assert.equal(back.key, "C");
    assert.equal(back.notes[0].pitches[0], score.notes[0].pitches[0]);
    assert.equal(back.tonicOctave, score.tonicOctave);
  });

  it("refuses a shift that leaves the piano", () => {
    const notes = [{ pitches: [60], dur: 1 }];
    assert.equal(canTranspose(notes, -12), true);
    assert.equal(canTranspose(notes, -48), false);
    assert.equal(canTranspose(notes, 48), true);
    assert.equal(canTranspose(notes, 49), false);
  });

  it("keeps every note put after a closed run of key-pad hops", () => {
    const score = scoreFromExample(EXAMPLES[0]);
    const register = tonicMidi(score.key, score.tonicOctave);
    const hop = (current: Score, key: KeyName) => {
      const shift = keyPadShift(current, register, key);
      assert.notEqual(shift, null, key);
      return shift ? transposeScore(current, shift) : current;
    };

    let cursor = score;
    for (const key of ["E", "Ab", "C"] as const) cursor = hop(cursor, key);
    assert.equal(cursor.key, "C");
    sameNotes(score.notes, cursor.notes);

    for (const first of KEY_NAMES) {
      for (const second of KEY_NAMES) {
        let walked = hop(score, first);
        walked = hop(walked, second);
        walked = hop(walked, "F#");
        walked = hop(walked, score.key);
        assert.equal(walked.key, score.key, `${first} ${second}`);
        sameNotes(score.notes, walked.notes);
      }
    }

    const nudged = transposeScore(score, 1);
    const nudgedRegister = register + 1;
    let afterNudge = nudged;
    for (const key of ["G", "Bb", nudged.key] as const) {
      const shift = keyPadShift(afterNudge, nudgedRegister, key);
      assert.notEqual(shift, null);
      if (shift) afterNudge = transposeScore(afterNudge, shift);
    }
    sameNotes(nudged.notes, afterNudge.notes);

    const low = asScore([{ pitches: [21], dur: 1 }], { key: "C", tonicOctave: 0 });
    assert.equal(keyPadShift(low, tonicMidi("C", 0), "B"), null);
    assert.equal(low.notes[0].pitches[0], 21);
  });
});

describe("recording", () => {
  it("starts once, queues one stop, and drops the mic after unmount", () => {
    let gate = initialRecordGate();
    const first = tapRecord(gate);
    assert.equal(first.begin, true);
    assert.equal(first.stopNow, false);
    gate = first.gate;

    const second = tapRecord(gate);
    assert.equal(second.begin, false);
    assert.equal(second.stopNow, false);
    assert.equal(second.gate.stopQueued, true);
    gate = second.gate;

    const third = tapRecord(gate);
    assert.equal(third.begin, false);
    assert.equal(third.gate.stopQueued, true);

    const armed = finishArming(gate, true);
    assert.equal(armed.open, false);
    assert.equal(armed.gate.phase, "idle");

    const again = tapRecord(initialRecordGate());
    const live = finishArming(again.gate, true);
    assert.equal(live.open, true);
    assert.equal(live.gate.phase, "live");
    const stopped = tapRecord(live.gate);
    assert.equal(stopped.stopNow, true);
    assert.equal(stopped.begin, false);

    const left = finishArming(again.gate, false);
    assert.equal(left.open, false);
    assert.equal(left.gate.phase, "idle");
  });

  it("releases tracks registered before resume, including ones added after stop", () => {
    const arm = new RecordingArm();
    const stopped: string[] = [];
    const closed: string[] = [];
    arm.track({ stop: () => stopped.push("mic") });
    arm.closer(() => closed.push("context"));
    arm.release();
    arm.track({ stop: () => stopped.push("late") });
    arm.closer(() => closed.push("late"));
    arm.release();
    assert.deepEqual(stopped, ["mic", "late"]);
    assert.deepEqual(closed, ["context", "late"]);
    assert.equal(arm.isReleased, true);
  });
});

describe("export", () => {
  it("writes concert MIDI and a transposed staff", () => {
    const score = scoreFromExample(EXAMPLES[3]);
    const back = midiToScore(scoreToMidi(score), "fallback");
    assert.equal(back.title, "四拍练习");
    assert.equal(back.bpm, 72);
    assert.equal(back.beats, 4);
    assert.equal(back.beatUnit, 4);
    assert.equal(back.key, "F");
    sameNotes(score.notes, back.notes);

    const raw = scoreToMidi(score);
    const padded = new Uint8Array(raw.length + 2);
    padded.set(raw.subarray(0, 14), 0);
    padded.set(raw.subarray(14), 16);
    padded[7] = 8;
    const again = midiToScore(padded, "fallback");
    assert.equal(again.title, "四拍练习");
    assert.equal(again.notes[0].pitches[0], score.notes[0].pitches[0]);

    assert.match(toAbc(score, 0), /^K:F$/m);
    assert.equal(transposeKey(score.key, 2), "G");
    assert.match(toAbc(score, 2), /^K:G$/m);
    assert.match(staffCaption(score, 2), /1 = G/);
    assert.match(staffCaption(score, 2), /实际/);
    assert.ok(raw.includes(score.notes[0].pitches[0]));
  });
});

describe("score layout motion", () => {
  const concert: LayoutView = { key: "C", mode: "major", clef: "treble", tonicOctave: 4, shift: 0 };

  it("stays still on the first paint and on note edits", () => {
    assert.deepEqual(scoreLayoutMotion(null, concert, false), { animate: false, nudge: 0 });
    assert.deepEqual(scoreLayoutMotion(concert, { ...concert }, false), {
      animate: false,
      nudge: 0,
    });
  });

  it("slides with the written pitch for key and instrument changes", () => {
    const up = scoreLayoutMotion(concert, { ...concert, key: "D" }, false);
    assert.equal(up.animate, true);
    assert.ok(up.nudge > 0);

    const down = scoreLayoutMotion({ ...concert, key: "D" }, concert, false);
    assert.equal(down.animate, true);
    assert.ok(down.nudge < 0);

    const clarinet = scoreLayoutMotion(concert, { ...concert, shift: 2 }, false);
    assert.equal(clarinet.animate, true);
    assert.ok(clarinet.nudge > 0);

    const back = scoreLayoutMotion({ ...concert, shift: 2 }, concert, false);
    assert.ok(back.nudge < 0);
  });

  it("fades a clef or mode change without pretending the pitch moved", () => {
    const clef = scoreLayoutMotion(concert, { ...concert, clef: "bass" }, false);
    assert.equal(clef.animate, true);
    assert.equal(clef.nudge, 0);
    const mode = scoreLayoutMotion(concert, { ...concert, mode: "minor" }, false);
    assert.equal(mode.animate, true);
    assert.equal(mode.nudge, 0);
  });

  it("does not move when the user prefers reduced motion", () => {
    assert.deepEqual(scoreLayoutMotion(concert, { ...concert, key: "F#" }, true), {
      animate: false,
      nudge: 0,
    });
  });
});

describe("staff export", () => {
  it("does not treat a failed render with a leftover svg as ready", () => {
    let gen = initialStaffGeneration();
    gen = beginStaffRender(gen);
    gen = noteStaffRendered(gen, gen.requested);
    assert.equal(staffWaitResult(gen, true), "ready");

    gen = beginStaffRender(gen);
    const failedAt = gen.requested;
    gen = noteStaffFailed(gen, failedAt);
    assert.equal(gen.ready === gen.requested, false);
    assert.equal(staffWaitResult(gen, true), "failed");

    const superseded = noteStaffFailed(gen, failedAt - 1);
    assert.equal(superseded.failed, failedAt);
  });

  it("keeps the png name and markup from the snapshot after the title changes", () => {
    const snapshot = freezeExportSnapshot({
      title: "小星星",
      caption: "C 大调 · 1 = C · 4/4 · 88",
      markup: "<svg><text>小星星</text><text>C 大调 · 1 = C · 4/4 · 88</text></svg>",
    });
    const liveTitle = "改名了";
    assert.equal(exportDownloadName(snapshot, "png"), "小星星.png");
    assert.equal(exportDownloadName(snapshot, "svg"), "小星星.svg");
    assert.match(snapshot.markup, /小星星/);
    assert.match(snapshot.markup, /1 = C/);
    assert.equal(snapshot.filename === liveTitle, false);
    assert.doesNotMatch(snapshot.markup, /改名了/);
  });
});

function vlq(value: number): number[] {
  const bytes = [value & 0x7f];
  let rest = value >> 7;
  while (rest > 0) {
    bytes.push((rest & 0x7f) | 0x80);
    rest >>= 7;
  }
  return bytes.reverse();
}

function u16be(value: number): number[] {
  return [(value >> 8) & 0xff, value & 0xff];
}

function u32be(value: number): number[] {
  return [(value >> 24) & 0xff, (value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

function metaText(type: number, text: string): number[] {
  const payload = [...new TextEncoder().encode(text)];
  return [0x00, 0xff, type, ...vlq(payload.length), ...payload];
}

function notePair(delta: number, channel: number, midi: number, dur: number): number[] {
  return [...vlq(delta), 0x90 | channel, midi, 80, ...vlq(dur), 0x80 | channel, midi, 0];
}

function endTrack(): number[] {
  return [0x00, 0xff, 0x2f, 0x00];
}

function midiFile(tracks: number[][]): Uint8Array {
  const body = tracks.flatMap((track) => [
    0x4d,
    0x54,
    0x72,
    0x6b,
    ...u32be(track.length),
    ...track,
  ]);
  const header = [
    0x4d,
    0x54,
    0x68,
    0x64,
    ...u32be(6),
    ...u16be(tracks.length > 1 ? 1 : 0),
    ...u16be(tracks.length),
    ...u16be(480),
  ];
  return Uint8Array.from([...header, ...body]);
}

function sounding(notes: Score["notes"]): number[] {
  return notes.flatMap((note) => note.pitches);
}

/** Conductor plus melody, accompaniment, a second channel, and a drum track. */
function multitrackStudyMidi(): Uint8Array {
  const tempo120 = [0x00, 0xff, 0x51, 0x03, 0x07, 0xa1, 0x20];
  const meter34 = [0x00, 0xff, 0x58, 0x04, 3, 2, 24, 8];
  return midiFile([
    [...tempo120, ...meter34, ...metaText(0x03, "多轨练习"), ...endTrack()],
    [
      ...metaText(0x03, "旋律"),
      ...notePair(0, 0, 60, 480),
      ...notePair(0, 0, 65, 480),
      ...notePair(0, 0, 67, 480),
      ...endTrack(),
    ],
    [
      ...metaText(0x03, "伴奏"),
      ...notePair(0, 0, 48, 480),
      ...notePair(0, 0, 53, 480),
      ...endTrack(),
    ],
    [...metaText(0x03, "和声"), ...notePair(0, 0, 55, 960), ...endTrack()],
    [
      ...metaText(0x03, "加花"),
      ...vlq(0),
      0x90,
      72,
      80,
      ...vlq(0),
      0x91,
      40,
      80,
      ...vlq(480),
      0x80,
      72,
      0,
      ...vlq(0),
      0x81,
      40,
      0,
      ...endTrack(),
    ],
    [...notePair(0, 9, 36, 480), ...notePair(0, 9, 38, 480), ...endTrack()],
  ]);
}

describe("midi voices", () => {
  it("keeps a single-track file on the same line, with or without an explicit voice", () => {
    const score = scoreFromExample(EXAMPLES[3]);
    const bytes = scoreToMidi(score);
    const voices = listMidiVoices(bytes);
    assert.equal(voices.length, 1);
    assert.equal(voices[0].track, 0);
    assert.equal(voices[0].channel, 0);
    assert.equal(voices[0].name, "四拍练习");
    assert.equal(
      voices[0].noteCount,
      score.notes.reduce((total, note) => total + note.pitches.length, 0),
    );
    const plain = midiToScore(bytes, "fallback");
    const picked = midiToScore(bytes, "fallback", voices[0]);
    assert.equal(plain.title, "四拍练习");
    assert.equal(picked.title, "四拍练习");
    assert.equal(picked.bpm, score.bpm);
    sameNotes(score.notes, plain.notes);
    sameNotes(plain.notes, picked.notes);
  });

  it("lists pitched tracks and channels, and loads only the one that was chosen", () => {
    const bytes = multitrackStudyMidi();
    const voices = listMidiVoices(bytes);
    assert.deepEqual(
      voices.map((voice) => [
        voice.track,
        voice.channel,
        voice.name,
        voice.noteCount,
        voice.low,
        voice.high,
      ]),
      [
        [1, 0, "旋律", 3, 60, 67],
        [2, 0, "伴奏", 2, 48, 53],
        [3, 0, "和声", 1, 55, 55],
        [4, 0, "加花", 1, 72, 72],
        [4, 1, "加花", 1, 40, 40],
      ],
    );
    assert.equal(
      voices.some((voice) => voice.channel === 9),
      false,
    );

    const melodyVoice = voices[0];
    const accompVoice = voices[1];
    assert.deepEqual(describeMidiVoice(melodyVoice), {
      title: "旋律",
      detail: "轨道 2 · 通道 1 · 3 个音 · C4–G4",
    });
    assert.deepEqual(describeMidiVoice(voices[3]), {
      title: "加花",
      detail: "轨道 5 · 通道 1 · 1 个音 · C5",
    });
    assert.deepEqual(describeMidiVoice(voices[4]), {
      title: "加花",
      detail: "轨道 5 · 通道 2 · 1 个音 · E2",
    });

    const melody = midiToScore(bytes, "fallback", melodyVoice);
    assert.equal(melody.title, "多轨练习");
    assert.equal(melody.bpm, 120);
    assert.equal(melody.beats, 3);
    assert.equal(melody.beatUnit, 4);
    assert.equal(melody.clef, "treble");
    assert.deepEqual(sounding(melody.notes), [60, 65, 67]);
    assert.ok(melody.notes.every((note) => Math.abs(note.dur - 1) < 1e-9));

    const accomp = midiToScore(bytes, "fallback", accompVoice);
    assert.deepEqual(sounding(accomp.notes), [48, 53]);
    assert.equal(accomp.clef, "bass");
    assert.equal(sounding(accomp.notes).includes(60), false);
    assert.equal(sounding(melody.notes).includes(48), false);
    assert.equal(sounding(melody.notes).includes(36), false);

    const upper = midiToScore(bytes, "fallback", voices[3]);
    const lower = midiToScore(bytes, "fallback", voices[4]);
    assert.deepEqual(sounding(upper.notes), [72]);
    assert.deepEqual(sounding(lower.notes), [40]);

    const mixed = sounding(midiToScore(bytes, "fallback").notes);
    assert.equal(mixed.includes(60), true);
    assert.equal(mixed.includes(48), true);

    assert.throws(() => midiToScore(bytes, "fallback", { track: 1, channel: 3 }), /没有音符/);
    assert.equal(midiChoicePrompt(voices.length).includes(`${voices.length} 个声部`), true);
    assert.match(midiChoicePrompt(voices.length), /正在改的声部/);
    assert.equal(
      midiImportNotice(melodyVoice, voices.length - 1, "C 大调"),
      "已载入「旋律」到正在改的声部，其余 4 个声部没有放进谱里。调性为C 大调。",
    );
  });

  it("splits two channels on a single track and ignores a drum-only file", () => {
    const bytes = midiFile([
      [
        ...vlq(0),
        0x90,
        60,
        80,
        ...vlq(0),
        0x91,
        48,
        70,
        ...vlq(480),
        0x80,
        60,
        0,
        ...vlq(0),
        0x81,
        48,
        0,
        ...endTrack(),
      ],
    ]);
    const voices = listMidiVoices(bytes);
    assert.equal(voices.length, 2);
    assert.equal(voices[0].name, null);
    assert.deepEqual(describeMidiVoice(voices[0]), {
      title: "轨道 1 · 通道 1",
      detail: "1 个音 · C4",
    });
    assert.deepEqual(sounding(midiToScore(bytes, "双通道", voices[0]).notes), [60]);
    assert.deepEqual(sounding(midiToScore(bytes, "双通道", voices[1]).notes), [48]);
    const mixed = sounding(midiToScore(bytes, "双通道").notes);
    assert.equal(mixed.includes(60) && mixed.includes(48), true);
    assert.equal(
      midiImportNotice(voices[1], 1, "C 大调"),
      "已载入轨道 1 通道 2到正在改的声部，其余 1 个声部没有放进谱里。调性为C 大调。",
    );

    const drums = midiFile([[...notePair(0, 9, 36, 480), ...endTrack()]]);
    assert.deepEqual(listMidiVoices(drums), []);
    assert.throws(() => midiToScore(drums, "鼓"), /没有音符/);
  });

  it("prefers the track name, then the instrument name, and counts a chord as two notes", () => {
    const named = midiFile([
      [
        ...metaText(0x04, "Violin"),
        ...metaText(0x03, "主旋律"),
        ...vlq(0),
        0x90,
        60,
        80,
        ...vlq(0),
        0x90,
        64,
        80,
        ...vlq(480),
        0x80,
        60,
        0,
        ...vlq(0),
        0x80,
        64,
        0,
        ...endTrack(),
      ],
    ]);
    const namedVoices = listMidiVoices(named);
    assert.equal(namedVoices.length, 1);
    assert.equal(namedVoices[0].name, "主旋律");
    assert.equal(namedVoices[0].noteCount, 2);
    assert.equal(namedVoices[0].low, 60);
    assert.equal(namedVoices[0].high, 64);
    assert.deepEqual(midiToScore(named, "fallback", namedVoices[0]).notes[0].pitches, [60, 64]);
    assert.equal(midiToScore(named, "fallback").title, "主旋律");

    const instrument = midiFile([
      [...metaText(0x04, "小提琴"), ...notePair(0, 0, 67, 480), ...endTrack()],
    ]);
    const instrumentVoice = listMidiVoices(instrument)[0];
    assert.equal(instrumentVoice.name, "小提琴");
    assert.equal(midiToScore(instrument, "未命名").title, "未命名");
    assert.deepEqual(describeMidiVoice(instrumentVoice), {
      title: "小提琴",
      detail: "轨道 1 · 通道 1 · 1 个音 · G4",
    });

    const blank = midiFile([[...metaText(0x03, "   "), ...notePair(0, 2, 61, 240), ...endTrack()]]);
    const blankVoice = listMidiVoices(blank)[0];
    assert.equal(blankVoice.name, null);
    assert.equal(blankVoice.channel, 2);
    assert.equal(describeMidiVoice(blankVoice).title, "轨道 1 · 通道 3");
    assert.equal(
      midiImportNotice(blankVoice, 0, "F 大调"),
      "读入了 MIDI，放进正在改的声部。调性为F 大调。",
    );
  });

  it("lists and imports a voice too large to spread into Math.min", () => {
    const count = 200_000;
    const body: number[] = [...metaText(0x03, "长旋律")];
    for (let i = 0; i < count; i += 1) {
      const midi = i === 0 ? 48 : i === count - 1 ? 84 : 60;
      body.push(0, 0x90, midi, 80, 0x83, 0x60, 0x80, midi, 0);
    }
    body.push(...endTrack());
    const bytes = midiFile([
      body,
      [...metaText(0x03, "伴奏"), ...notePair(0, 0, 72, 480), ...endTrack()],
    ]);

    const voices = listMidiVoices(bytes);
    assert.equal(voices.length, 2);
    assert.equal(voices[0].name, "长旋律");
    assert.equal(voices[0].track, 0);
    assert.equal(voices[0].channel, 0);
    assert.equal(voices[0].noteCount, count);
    assert.equal(voices[0].low, 48);
    assert.equal(voices[0].high, 84);
    assert.equal(voices[1].name, "伴奏");
    assert.equal(voices[1].noteCount, 1);
    assert.deepEqual(describeMidiVoice(voices[0]), {
      title: "长旋律",
      detail: "轨道 1 · 通道 1 · 200000 个音 · C3–C6",
    });

    const score = midiToScore(bytes, "fallback", voices[0]);
    assert.equal(score.notes.length, count);
    assert.deepEqual(score.notes[0].pitches, [48]);
    assert.deepEqual(score.notes[count - 1].pitches, [84]);
    assert.equal(
      score.notes.some((note) => note.pitches.includes(72)),
      false,
    );
    assert.equal(score.clef, "treble");
    assert.deepEqual(midiToScore(bytes, "fallback", voices[1]).notes[0].pitches, [72]);
  });

  it("keeps a blank track name unnamed", () => {
    const unnamed: MidiVoice = {
      track: 1,
      channel: 0,
      name: "  ",
      noteCount: 4,
      low: 60,
      high: 72,
    };
    assert.equal(describeMidiVoice(unnamed).title, "轨道 2 · 通道 1");
    assert.equal(describeMidiVoice(unnamed).detail, "4 个音 · C4–C5");
  });
});

describe("humming", () => {
  it("hears A4 from a 440 Hz tone", () => {
    const sampleRate = 16000;
    const samples = new Float32Array(sampleRate);
    for (let i = 0; i < samples.length; i += 1) {
      samples[i] = Math.sin((2 * Math.PI * 440 * i) / sampleRate);
    }
    const notes = analyzeMelody(samples, sampleRate);
    assert.equal(notes.length, 1);
    assert.equal(notes[0].midi, 69);
  });
});

describe("增强 MIDI 量化", () => {
  const preview = (track: number[], hands = false) =>
    previewMidiImport(midiFile([track]), "测试", { hands });
  it("同起音不同结束的和弦明确报告短音延长及真实结束偏差", () => {
    const result = preview([
      0, 0x90, 60, 100,
      0, 0x90, 64, 100,
      ...vlq(240), 0x80, 60, 0,
      ...vlq(1680), 0x80, 64, 0,
      ...endTrack(),
    ]);
    assert.deepEqual(result.score.notes.map(({ pitches, dur }) => ({ pitches, dur })),
      [{ pitches: [60, 64], dur: 4 }]);
    assert.match(result.notice, /和弦统一时值延长 1 个音（MIDI 60 \+3\.500 拍）/);
    assert.match(result.notice, /最大落点或结束偏差 3\.500 拍/);
  });
  it("和弦延长按后续起音截短后的实际输出计算，同结束和弦无延长提示", () => {
    const { report } = quantizeMidi([
      { start: 0, end: 240, midi: 60 },
      { start: 0, end: 1920, midi: 64 },
      { start: 480, end: 960, midi: 67 },
    ], 480, 4);
    assert.deepEqual(report.extended, [{ midi: 60, beats: 0.5 }]);
    assert.equal(report.maxError, 3);
    assert.equal(report.overlaps, 1);
    const equal = preview([
      0, 0x90, 60, 100, 0, 0x90, 64, 100,
      ...vlq(480), 0x80, 60, 0, 0, 0x80, 64, 0, ...endTrack(),
    ]);
    assert.doesNotMatch(equal.notice, /和弦统一时值延长/);
    assert.match(equal.notice, /最大落点或结束偏差 0\.000 拍/);
  });
  it("完整三连音与轻微偏差保持一拍，往返无漂移", () => {
    const bytes = midiFile([
      [
        ...notePair(0, 0, 60, 158),
        ...notePair(3, 0, 62, 160),
        ...notePair(0, 0, 64, 159),
        ...endTrack(),
      ],
    ]);
    const result = previewMidiImport(bytes, "三连音");
    assert.deepEqual(
      result.score.notes.map((n) => n.dur),
      [1 / 3, 1 / 3, 1 - 2 / 3],
    );
    assert.match(result.notice, /三连音 1 组/);
    const back = previewMidiImport(scoreToMidi(result.score), "回读");
    assert.equal(
      back.score.notes.reduce((s, n) => s + n.dur, 0),
      1,
    );
  });
  it("第三音为短和弦且后续起音截断完整组时保留普通网格", () => {
    const result = preview([
      ...notePair(0, 0, 60, 160),
      ...notePair(0, 0, 62, 160),
      0, 0x90, 64, 100,
      0, 0x90, 67, 100,
      ...vlq(40), 0x80, 64, 0,
      0, 0x80, 67, 0,
      ...notePair(0, 0, 65, 120),
      ...endTrack(),
    ]);
    assert.deepEqual(result.score.notes.map((n) => n.dur), [0.25, 0.5, 0.25]);
    assert.match(result.notice, /三连音 0 组/);
  });
  it("上行快速错开、同放的和弦识别为琶音和弦", () => {
    const { notes, report } = quantizeMidi([
      { start: 0, end: 960, midi: 60 },
      { start: 30, end: 960, midi: 64 },
      { start: 60, end: 960, midi: 67 },
      { start: 90, end: 960, midi: 72 },
      { start: 960, end: 1440, midi: 62 },
    ], 480, 4);
    assert.equal(report.arpeggios, 1);
    assert.deepEqual(notes[0].pitches, [60, 64, 67, 72]);
    assert.equal(notes[0].ornament, "arpeggio");
    assert.equal(notes[0].dur, 2);
    assert.ok(report.maxError < 0.01);
    assert.match(quantizeNotice(report), /琶音 1 组/);
  });
  it("逐个放开的快速分解和弦与只有两个起音的错开仍是单音", () => {
    const run = quantizeMidi([
      { start: 0, end: 60, midi: 60 },
      { start: 60, end: 120, midi: 64 },
      { start: 120, end: 180, midi: 67 },
      { start: 180, end: 480, midi: 72 },
    ], 480, 4);
    assert.equal(run.report.arpeggios, 0);
    assert.ok(run.notes.every((note) => note.ornament !== "arpeggio"));
    const two = quantizeMidi([
      { start: 0, end: 960, midi: 60 },
      { start: 30, end: 960, midi: 64 },
    ], 480, 4);
    assert.equal(two.report.arpeggios, 0);
    const down = quantizeMidi([
      { start: 0, end: 960, midi: 72 },
      { start: 30, end: 960, midi: 67 },
      { start: 60, end: 960, midi: 64 },
    ], 480, 4);
    assert.equal(down.report.arpeggios, 0);
  });
  it("短先现音成为倚音，孤立短音有近似提示", () => {
    const result = preview([...notePair(0, 0, 62, 30), ...notePair(0, 0, 64, 450), ...endTrack()]);
    assert.equal(result.score.notes[0].ornament, "grace");
    assert.equal(result.score.notes[0].gracePitch, 62);
    assert.equal(result.score.notes[0].dur, 1);
    assert.match(preview([...notePair(0, 0, 60, 30), ...endTrack()]).notice, /短音近似 1/);
  });
  it("跨小节长音与开头休止保持绝对时间", () => {
    const result = preview([...notePair(1440, 0, 60, 2880), ...endTrack()]);
    assert.deepEqual(
      result.score.notes.map((n) => n.dur),
      [3, 1, 4, 1],
    );
    assert.deepEqual(result.score.notes[0].pitches, []);
    assert.equal(
      result.score.notes.reduce((s, n) => s + n.dur, 0),
      9,
    );
  });
  it("6/8 按三拍小节切分，并保留普通节奏", () => {
    const bytes = midiFile([[0, 0xff, 0x58, 4, 6, 3, 24, 8,
      ...notePair(960, 0, 60, 2400), ...endTrack()]]);
    const result = previewMidiImport(bytes, "六八拍");
    assert.deepEqual(result.score.notes.map(n => n.dur), [2, 1, 3, 1]);
    assert.match(result.notice, /三连音 0 组/);
  });
  it("RH/LH 命名映射，左手开头休止不丢失", () => {
    const bytes = midiFile([
      [...metaText(3, "RH"), ...notePair(0, 0, 72, 480), ...endTrack()],
      [...metaText(3, "左手"), ...notePair(480, 1, 48, 480), ...endTrack()],
      endTrack(),
      [...notePair(0, 9, 36, 480), ...endTrack()],
    ]);
    const result = previewMidiImport(bytes, "双手", { hands: true });
    assert.equal(result.hands, true);
    assert.deepEqual(result.score.notes[0].pitches, [72]);
    assert.deepEqual(
      result.score.voice2?.map((n) => n.pitches),
      [[], [48]],
    );
  });
  it("RH/LH 命名声部音域交错时降级为所选声部", () => {
    const bytes = midiFile([
      [...metaText(3, "RH"), ...notePair(0, 0, 48, 480), ...notePair(0, 0, 84, 480), ...endTrack()],
      [...metaText(3, "LH"), ...notePair(0, 1, 60, 480), ...notePair(0, 1, 96, 480), ...endTrack()],
    ]);
    for (const hands of [true, "auto"] as const) {
      const result = previewMidiImport(bytes, "交错", { hands, voice: { track: 1, channel: 1 } });
      assert.equal(result.hands, false);
      assert.equal(result.score.voice2, undefined);
      assert.deepEqual(sounding(result.score.notes), [60, 96]);
      assert.match(result.notice, /音域.*降级.*其余 1 个声部未导入/s);
    }
  });
  it("左右标记冲突时禁止按分离音域推断双手", () => {
    const bytes = midiFile([48, 72].map((pitch) => [
      ...metaText(3, "RH LH"), ...notePair(0, 0, pitch, 480), ...endTrack(),
    ]));
    for (const hands of [true, "auto"] as const) {
      const result = previewMidiImport(bytes, "冲突", { hands, voice: { track: 1, channel: 0 } });
      assert.equal(result.hands, false);
      assert.equal(result.score.voice2, undefined);
      assert.deepEqual(sounding(result.score.notes), [72]);
      assert.match(result.notice, /标记冲突.*降级.*其余 1 个声部未导入/s);
    }
  });
  it("两条音域明显分离声部可映射，额外轨和单旋律保守降级", () => {
    const tracks = [48, 72].map((p) => [...notePair(0, 0, p, 480), ...endTrack()]);
    assert.equal(previewMidiImport(midiFile(tracks), "双手", { hands: "auto" }).hands, true);
    const failed = previewMidiImport(
      midiFile([...tracks, [...notePair(0, 0, 80, 480), ...endTrack()]]),
      "编曲",
      { hands: true },
    );
    assert.equal(failed.hands, false);
    assert.match(failed.notice, /降级.*其余 2/s);
    assert.equal(preview([...notePair(0, 0, 72, 480), ...endTrack()], true).hands, false);
    assert.throws(() => preview(endTrack()), /没有音符/);
    assert.throws(() => preview([...notePair(0, 9, 36, 480), ...endTrack()]), /没有音符/);
  });
  it("重叠截短而不推迟后续 onset", () => {
    const result = preview([
      0,
      0x90,
      60,
      80,
      ...vlq(240),
      0x90,
      64,
      80,
      ...vlq(240),
      0x80,
      60,
      0,
      ...vlq(240),
      0x80,
      64,
      0,
      ...endTrack(),
    ]);
    assert.deepEqual(
      result.score.notes.map((n) => n.dur),
      [0.5, 1],
    );
    assert.match(result.notice, /重叠截短 1/);
  });
});

describe("MIDI 导入边界加固", () => {
  it("拒绝空、伪装、截断文件及非法头，不返回部分谱", () => {
    const valid = midiFile([[...notePair(0, 0, 60, 480), ...endTrack()]]);
    const bad = [new Uint8Array(), new TextEncoder().encode("not a midi file")];
    for (let i = 0; i < valid.length; i++) bad.push(valid.slice(0, i));
    for (const [offset, value] of [[12, 0], [8, 2], [10, 0]] as const) {
      const bytes = valid.slice();
      bytes[offset] = 0;
      bytes[offset + 1] = value;
      bad.push(bytes);
    }
    bad.push(new Uint8Array(16 * 1024 * 1024 + 1));
    for (const bytes of bad) {
      for (const read of [listMidiVoices, (b: Uint8Array) => midiToScore(b, "原谱"),
        (b: Uint8Array) => previewMidiImport(b, "原谱")]) {
        assert.throws(() => read(bytes), /[\u4e00-\u9fff]/);
      }
    }
  });

  it("拒绝越界事件、无 running status、超长 VLQ 和极大时间跨度", () => {
    for (const body of [
      [0, 60, 80], [0, 0x90, 60], [0, 0x90, 128, 80],
      [0, 0xff, 1, 10, 65], [0, 0xf0, 10, 1],
      [0x81, 0x80, 0x80, 0x80, 0, 0xff, 0x2f, 0],
      [...vlq(0xfffffff), 0x90, 60, 80, ...notePair(0xfffffff, 0, 64, 480)],
    ]) assert.throws(() => listMidiVoices(midiFile([body])), /MIDI/);
  });

  it("八轨选择稳定，鼓轨和纯鼓文件不进入旋律", () => {
    const bytes = midiFile(Array.from({ length: 8 }, (_, i) =>
      [...notePair(0, i === 7 ? 9 : i, 60 + i, 480), ...endTrack()]));
    const voices = listMidiVoices(bytes);
    assert.equal(voices.length, 7);
    voices.forEach((v, i) => {
      assert.deepEqual(sounding(midiToScore(bytes, "八轨", v).notes), [60 + i]);
      assert.deepEqual(sounding(previewMidiImport(bytes, "八轨", { voice: v }).score.notes), [60 + i]);
    });
    const drums = midiFile([[...notePair(0, 9, 36, 480), ...endTrack()]]);
    assert.deepEqual(listMidiVoices(drums), []);
    assert.throws(() => previewMidiImport(drums, "鼓"), /打击乐/);
  });

  it("同音重叠按 FIFO 配对，零时长与缺失 off 丢弃，短音保持有限正时值", () => {
    const bytes = midiFile([[
      0, 0x90, 60, 80, 1, 60, 80,
      1, 0x80, 60, 0, 1, 60, 0,
      ...notePair(0, 0, 62, 0), ...notePair(0, 0, 64, 1),
      0, 0x90, 67, 80, ...endTrack(),
    ]]);
    assert.equal(listMidiVoices(bytes)[0].noteCount, 3);
    for (const score of [midiToScore(bytes, "短音"), previewMidiImport(bytes, "短音").score]) {
      assert.ok(score.notes.every(n => Number.isFinite(n.dur) && n.dur > 0));
      assert.ok(!sounding(score.notes).includes(62));
      assert.ok(!sounding(score.notes).includes(67));
    }
  });

  it("采用时间最早的速度、拍号和调号，后续变化保留为四分音符时间轴", () => {
    const bytes = midiFile([[
      0, 0xff, 0x51, 3, 7, 0xa1, 0x20,
      0, 0xff, 0x58, 4, 6, 3, 24, 8,
      0, 0xff, 0x59, 2, 2, 1,
      ...notePair(0, 0, 60, 480),
      0, 0xff, 0x51, 3, 0x0f, 0x42, 0x40,
      0, 0xff, 0x58, 4, 3, 2, 24, 8,
      0, 0xff, 0x59, 2, 0, 0, ...endTrack(),
    ]]);
    for (const score of [midiToScore(bytes, "变化"), previewMidiImport(bytes, "变化").score]) {
      assert.equal(score.bpm, 120);
      assert.equal(score.beats, 6);
      assert.equal(score.beatUnit, 8);
      assert.equal(score.key, "B");
      assert.equal(score.mode, "minor");
      assert.deepEqual(score.changes, [{ at: 1, bpm: 60, beats: 3, beatUnit: 4, key: "C", mode: "major" }]);
    }
  });
});


describe("MIDI 复审回归", () => {
  const readers = [listMidiVoices, (b: Uint8Array) => midiToScore(b, "复审"),
    (b: Uint8Array) => previewMidiImport(b, "复审")];
  it("拒绝缺失轨尾、声明轨数不符和尾随垃圾", () => {
    const pair = notePair(0, 0, 60, 480);
    const extraTrack = midiFile([[...pair, ...endTrack()], endTrack()]);
    extraTrack[11] = 1;
    const valid = midiFile([[...pair, ...endTrack()]]);
    for (const bytes of [midiFile([pair]), midiFile([[]]), extraTrack,
      Uint8Array.from([...valid, 0])]) {
      for (const read of readers) assert.throws(() => read(bytes), /MIDI 文件损坏/);
    }
  });
  it("后续及同 tick 的非法元数据也必须拒绝", () => {
    const initial = [0, 0xff, 0x51, 3, 7, 0xa1, 0x20,
      0, 0xff, 0x58, 4, 4, 2, 24, 8, 0, 0xff, 0x59, 2, 0, 0];
    for (const event of [[0xff, 0x51, 3, 0, 0, 0],
      [0xff, 0x58, 4, 0, 2, 24, 8], [0xff, 0x58, 4, 4, 8, 24, 8],
      [0xff, 0x59, 2, 8, 0], [0xff, 0x59, 2, 0, 2]]) {
      for (const delta of [0, 1]) {
        const bytes = midiFile([[...initial, delta, ...event,
          ...notePair(0, 0, 60, 480), ...endTrack()]]);
        for (const read of readers) assert.throws(() => read(bytes), /MIDI 文件损坏/);
      }
    }
  });
  it("跨轨元数据按时间选择，支持负调号", () => {
    const bytes = midiFile([
      [10, 0xff, 0x51, 3, 7, 0xa1, 0x20,
        0, 0xff, 0x58, 4, 4, 2, 24, 8, 0, 0xff, 0x59, 2, 0, 0, ...endTrack()],
      [0, 0xff, 0x51, 3, 0x0f, 0x42, 0x40,
        0, 0xff, 0x58, 4, 3, 2, 24, 8, 0, 0xff, 0x59, 2, 255, 0,
        ...notePair(0, 0, 60, 480), ...endTrack()],
    ]);
    for (const score of [midiToScore(bytes, "跨轨"), previewMidiImport(bytes, "跨轨").score]) {
      assert.equal(score.bpm, 60);
      assert.equal(score.beats, 3);
      assert.equal(score.key, "F");
      assert.equal(score.mode, "major");
    }
  });
  it("稀疏时间轴在量化输出上限停止", () => {
    const bytes = midiFile([[0, 0xff, 0x58, 4, 1, 4, 24, 8,
      ...notePair(30_000_001, 0, 60, 480), ...endTrack()]]);
    assert.throws(() => previewMidiImport(bytes, "稀疏"), /量化结果过长/);
  });
});

describe('曲中变化跨轨归并', () => {
  it('时间优先、同 tick 按文件轨序首个事件优先，后续合法事件不丢失', () => {
    const bytes = midiFile([
      [0,0xff,0x51,3,7,0xa1,0x20, ...vlq(480),0xff,0x51,3,0x0f,0x42,0x40,
        0,0xff,0x58,4,3,3,24,8, 0,0xff,0x59,2,1,0,
        ...vlq(480),0xff,0x51,3,7,0xa1,0x20, ...endTrack()],
      [0,0xff,0x58,4,4,2,24,8, 0,0xff,0x59,2,0,0,
        ...vlq(480),0xff,0x51,3,6,0x1a,0x80, 0,0xff,0x58,4,6,3,24,8,
        0,0xff,0x59,2,2,0, ...vlq(960),0xff,0x59,2,0xff,0, ...endTrack()],
      [...notePair(0,0,60,1920), ...endTrack()],
    ]);
    for (const score of [midiToScore(bytes,'tracks'),previewMidiImport(bytes,'tracks').score]) {
      assert.equal(score.bpm,120); assert.equal(score.beats,4); assert.equal(score.key,'C');
      assert.deepEqual(score.changes,[{at:1,bpm:60,beats:3,beatUnit:8,key:'G',mode:'major'}, {at:2,bpm:120}, {at:3,key:'F',mode:'major'}]);
    }
  });
  it('合法但超编辑范围的事件统一归一化，非法后续事件仍由严格解析拒绝', () => {
    const bytes = midiFile([[0,0xff,0x51,3,7,0xa1,0x20, 0,0xff,0x58,4,4,2,24,8,
      ...notePair(0,0,60,480), 0,0xff,0x51,3,0,0,1, 0,0xff,0x58,4,255,7,24,8, ...endTrack()]]);
    assert.deepEqual(midiToScore(bytes,'bounds').changes,[{at:1,bpm:220,beats:12,beatUnit:4}]);
  });
});

describe("midi import losses", () => {
  it("lists skipped voices, drums, pedal, bend, lyrics and velocity instead of dropping them silently", () => {
    const track = [
      0x00, 0xb0, 64, 127, // sustain pedal down
      0x00, 0xe0, 0x00, 0x50, // pitch bend away from centre
      ...metaText(0x05, "啊"),
      ...notePair(0, 0, 60, 480),
      0x00, 0x90, 62, 30, 0x83, 0x60, 0x80, 62, 0, // soft note
      ...notePair(0, 9, 36, 480), // drum
      ...endTrack(),
    ];
    const bytes = midiFile([track, [...notePair(0, 1, 48, 960), ...endTrack()]]);
    const voice = listMidiVoices(bytes)[0];
    const plain = midiLosses(bytes, voice);
    for (const word of ["其余 1 个声部", "打击乐", "踏板", "弯音", "歌词", "力度"])
      assert.ok(plain.some((l) => l.includes(word)), `${word}: ${plain.join(" / ")}`);
    const preview = previewMidiImport(bytes, "fallback", { voice });
    assert.ok(preview.losses.some((l) => l.includes("踏板")));
  });

  it("reports nothing for a clean single-voice file", () => {
    const bytes = midiFile([[...notePair(0, 0, 60, 480), ...notePair(0, 0, 62, 480), ...endTrack()]]);
    assert.deepEqual(midiLosses(bytes, listMidiVoices(bytes)[0]), []);
    assert.deepEqual(previewMidiImport(bytes, "fallback").losses, []);
  });
});
