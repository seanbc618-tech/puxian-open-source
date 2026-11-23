import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  analyzeMelody,
  isLowPitchConfidence,
  mixToMono,
  estimateBpm,
  suggestDictationGrid,
  pitchConfidence,
  cleanBeat,
  quantizeDetected,
  transcribeBuffer,
  transcribeMono,
  type DetectedNote,
} from "./audio.ts";

import { hummingFixture, scoreHumming } from "./humming-fixture.ts";

const MELODY = [60, 62, 64, 65, 67, 65, 64, 62];
const SR = 16000;

it("suggests sixteenth alignment for repeated subdivisions and keeps eighths for a stray attack", () => {
  const notes = (starts: number[]): DetectedNote[] =>
    starts.map((start, index) => ({ midi: 60 + index, start, dur: 0.1, confidence: 1 }));
  assert.equal(suggestDictationGrid(notes([0, 0.125, 0.25, 0.5, 0.875]), 120), 0.25);
  assert.equal(suggestDictationGrid(notes([0, 0.25, 0.5, 0.75, 1.125, 1.375]), 120), 0.5);
  assert.equal(suggestDictationGrid([], 120), 0.5);
});

it("preserves a sixteenth pickup when the rest of the phrase moves in eighths", () => {
  const notes = [0.132, 0.381, 0.628, 0.879].map((start, index) => ({
    start, dur: 0.24, midi: 60 + index, confidence: 1,
  }));
  const grid = suggestDictationGrid(notes, 120);
  assert.equal(grid, 0.25);
  assert.deepEqual(quantizeDetected(notes, 120, grid), [
    { pitches: [], dur: 0.25 },
    ...notes.map(({ midi }) => ({ pitches: [midi], dur: 0.5 })),
  ]);
});

function midiHz(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

function addVoice(
  buf: Float32Array,
  midi: number,
  start: number,
  dur: number,
  amp: number,
  vibratoCents = 0,
) {
  const hz0 = midiHz(midi);
  const a = Math.floor(start * SR);
  const b = Math.min(buf.length, Math.floor((start + dur) * SR));
  let phase = 0;
  for (let i = a; i < b; i += 1) {
    const t = (i - a) / SR;
    const hz = hz0 * 2 ** ((vibratoCents / 1200) * Math.sin(2 * Math.PI * 5 * t));
    phase += hz / SR;
    let sum = 0;
    for (let h = 1; h <= 6; h += 1) sum += Math.sin(2 * Math.PI * phase * h) / h;
    const env = Math.min(1, t / 0.02) * Math.min(1, (b - i) / SR / 0.03);
    buf[i] += amp * env * sum;
  }
}

function addSine(buf: Float32Array, hz: number, start: number, dur: number, amp: number) {
  const a = Math.floor(start * SR);
  const b = Math.min(buf.length, Math.floor((start + dur) * SR));
  for (let i = a; i < b; i += 1) {
    const t = (i - a) / SR;
    buf[i] += amp * Math.sin(2 * Math.PI * hz * t);
  }
}

/** Quarter-note phrase at 100 BPM, each note sounding for most of the beat. */
function melodyBuffer(melAmp: number, bassAmp: number, padAmp: number, vibrato = 20): Float32Array {
  const quarter = 0.6;
  const len = Math.floor(SR * (MELODY.length * quarter + 0.25));
  const buf = new Float32Array(len);
  for (let n = 0; n < MELODY.length; n += 1) {
    addVoice(buf, MELODY[n], 0.06 + n * quarter, quarter * 0.9, melAmp, vibrato);
  }
  if (bassAmp > 0 || padAmp > 0) {
    const end = MELODY.length * quarter;
    for (let i = 0; i < len; i += 1) {
      const t = i / SR;
      if (t > end) break;
      if (bassAmp > 0) {
        buf[i] += bassAmp * Math.sin(2 * Math.PI * midiHz(36) * t);
        buf[i] += bassAmp * 0.5 * Math.sin(2 * Math.PI * midiHz(43) * t);
      }
      if (padAmp > 0) {
        buf[i] += padAmp * Math.sin(2 * Math.PI * midiHz(48) * t);
        buf[i] += padAmp * Math.sin(2 * Math.PI * midiHz(52) * t);
        buf[i] += padAmp * 0.8 * Math.sin(2 * Math.PI * midiHz(55) * t);
      }
    }
  }
  return buf;
}

function collapse(midis: number[]): number[] {
  return midis.filter((midi, index) => index === 0 || midi !== midis[index - 1]);
}

function pitchesOf(notes: DetectedNote[]): number[] {
  return collapse(notes.map((note) => note.midi));
}

describe("transcribe", () => {
  it("keeps a dry vocal line and does not warn about accompaniment", () => {
    const take = transcribeMono(melodyBuffer(0.6, 0, 0, 35), SR);
    assert.deepEqual(pitchesOf(take.notes), MELODY);
    assert.equal(take.kind, "dry");
    assert.equal(take.notice, null);
    assert.ok(Math.abs(estimateBpm(take.notes) - 100) <= 6);
    const scored = quantizeDetected(take.notes, 100, 0.25);
    assert.equal(scored.some((note) => note.pitches.length === 0), false);
    assert.ok(scored.every((note) => Math.abs(note.dur - 1) < 1e-6));
    assert.deepEqual(
      scored.map((note) => note.pitches[0]),
      MELODY,
    );
  });

  it("still hears a quiet or low dry tone", () => {
    const quiet = new Float32Array(SR);
    for (let i = 0; i < quiet.length; i += 1) quiet[i] = 0.01 * Math.sin((2 * Math.PI * 440 * i) / SR);
    const high = transcribeMono(quiet, SR);
    assert.equal(high.notes[0]?.midi, 69);
    assert.equal(high.kind, "dry");
    assert.equal(high.notice, null);

    const low = new Float32Array(SR);
    for (let i = 0; i < low.length; i += 1) low[i] = Math.sin((2 * Math.PI * 98 * i) / SR);
    const bass = transcribeMono(low, SR);
    assert.equal(bass.notes[0]?.midi, 43);
    assert.equal(bass.kind, "dry");
    assert.equal(bass.notice, null);
  });

  it("follows the melody when a pad sits an octave below", () => {
    const take = transcribeMono(melodyBuffer(0.5, 0, 0.15, 15), SR);
    assert.deepEqual(pitchesOf(take.notes), MELODY);
    assert.equal(take.kind, "accompanied");
    assert.match(take.notice ?? "", /伴奏/);
    assert.equal(take.notes.some((note) => note.midi < 55), false);
  });

  it("lifts a melody out of bass and a light pad", () => {
    const take = transcribeMono(melodyBuffer(0.45, 0.35, 0.2, 20), SR);
    assert.deepEqual(pitchesOf(take.notes), MELODY);
    assert.equal(take.kind, "accompanied");
    assert.match(take.notice ?? "", /伴奏/);
    assert.match(take.notice ?? "", /和弦/);
  });

  it("prefers a dry melody channel over a loud drone on the other side", () => {
    const quarter = 0.6;
    const len = Math.floor(SR * (MELODY.length * quarter + 0.25));
    const left = new Float32Array(len);
    for (let n = 0; n < MELODY.length; n += 1) {
      addVoice(left, MELODY[n], 0.06 + n * quarter, quarter * 0.9, 0.55, 15);
    }
    const right = new Float32Array(len);
    addSine(right, 98, 0, len / SR, 0.85);
    addSine(right, 147, 0, len / SR, 0.45);
    const take = transcribeBuffer(
      {
        length: len,
        numberOfChannels: 2,
        getChannelData: (channel: number) => (channel === 0 ? left : right),
      },
      SR,
    );
    assert.deepEqual(pitchesOf(take.notes), MELODY);
    assert.equal(take.kind, "dry");
    assert.equal(take.notice, null);
  });

  it("does not invent chords when the mix is too thick to follow", () => {
    const take = transcribeMono(melodyBuffer(0.22, 0.7, 0.4, 10), SR);
    assert.equal(take.kind, "accompanied");
    assert.match(take.notice ?? "", /伴奏/);
    assert.match(take.notice ?? "", /MIDI|听不出/);
    assert.equal(take.notes.length, 0);
    const scored = quantizeDetected(take.notes, estimateBpm(take.notes), 0.25);
    for (const note of scored) assert.ok(note.pitches.length <= 1);
  });

  it("follows a melody over a mid-range triad pad with light reverb", () => {
    // Official accompaniment-reverb uses C3+G3+C4 (a pad tone in the melody
    // octave) plus short echoes, with the same sine-plus-two-partials tones.
    // Unfiltered YIN often locks to the chord root, which is not a clean
    // octave below the tune.
    const quarter = 0.6;
    const len = Math.floor(SR * (MELODY.length * quarter + 0.25));
    const buf = new Float32Array(len);
    const addTone = (midi: number, start: number, dur: number, amp: number) => {
      const hz = midiHz(midi);
      const a = Math.floor(start * SR);
      const b = Math.min(buf.length, Math.floor((start + dur) * SR));
      for (let i = a; i < b; i += 1) {
        const t = (i - a) / SR;
        const env = Math.min(1, t / 0.01, (b - i) / SR / 0.025);
        buf[i] +=
          amp *
          env *
          (Math.sin(2 * Math.PI * hz * t) +
            0.25 * Math.sin(4 * Math.PI * hz * t) +
            0.1 * Math.sin(6 * Math.PI * hz * t));
      }
    };
    for (let n = 0; n < MELODY.length; n += 1) {
      addTone(MELODY[n], 0.06 + n * quarter, quarter * 0.9, 0.3);
    }
    const end = MELODY.length * quarter;
    for (let t = 0; t < end; t += 2) {
      const dur = Math.min(1.9, end - t);
      for (const pitch of [48, 55, 60]) addTone(pitch, t, dur, 0.09);
    }
    const dry = buf.slice();
    for (const [delay, gain] of [[0.075, 0.24], [0.13, 0.17], [0.21, 0.1]] as Array<[number, number]>) {
      const shift = Math.round(delay * SR);
      for (let i = shift; i < buf.length; i += 1) buf[i] += dry[i - shift] * gain;
    }
    const take = transcribeMono(buf, SR);
    assert.equal(take.kind, "accompanied");
    assert.match(take.notice ?? "", /伴奏/);
    assert.deepEqual(pitchesOf(take.notes), MELODY);
    assert.equal(take.notes.some((note) => note.midi < 55), false);
  });
});

describe("estimateBpm", () => {
  function onsets(ioi: number, count = 8, jitter = 0): DetectedNote[] {
    return Array.from({ length: count }, (_, index) => ({
      start: index * ioi + (index % 2 ? jitter : -jitter),
      dur: ioi * 0.8,
      midi: 60 + (index % 5),
    }));
  }

  it("keeps quarter-note onsets near the beat when they jitter", () => {
    const bpm = estimateBpm(onsets(0.5, 8, 0.02));
    assert.ok(bpm >= 112 && bpm <= 128, `got ${bpm}`);
  });

  it("does not call a 0.55s pulse double-time", () => {
    const bpm = estimateBpm(onsets(0.55));
    assert.ok(bpm >= 100 && bpm <= 120, `got ${bpm}`);
  });

  it("keeps quarters just below 154 on that beat", () => {
    const bpm = estimateBpm(onsets(60 / 150, 12));
    assert.ok(bpm >= 144 && bpm <= 156, `got ${bpm}`);
  });

  it("keeps a true allegro quarter line instead of folding it in half", () => {
    const at160 = estimateBpm(onsets(60 / 160, 12));
    assert.ok(at160 >= 154 && at160 <= 166, `got ${at160}`);
    const at168 = estimateBpm(onsets(60 / 168, 12));
    assert.ok(at168 >= 162 && at168 <= 174, `got ${at168}`);
  });

  it("uses the slower beat when short eighths sit inside longer notes", () => {
    const beat = 60 / 80;
    const notes: DetectedNote[] = [];
    let time = 0;
    for (let bar = 0; bar < 4; bar += 1) {
      for (let step = 0; step < 3; step += 1) {
        notes.push({ start: time, dur: 0.14, midi: 60 });
        time += beat / 2;
      }
      notes.push({ start: time, dur: 0.55, midi: 64 });
      time += beat;
    }
    const bpm = estimateBpm(notes);
    assert.ok(bpm >= 74 && bpm <= 96, `got ${bpm}`);
  });

  it("uses the shared beat of dotted eighths and quarters with a displaced attack", () => {
    const quarter = 60 / 108;
    const beats = [0, 0.75, 1.5, 2.5, 3, 4, 4.5, 5, 6, 6.75, 7.5];
    const notes = beats.map((beat, i) => ({
      start: beat * quarter + (i === 5 ? 0.05 : 0),
      dur: 0.25,
      midi: 60 + (i % 5),
    }));
    const bpm = estimateBpm(notes);
    assert.ok(Math.abs(bpm - 108) <= 2, `got ${bpm}`);
  });

  it("fits one beat across grouped sixteenths, eighths, and a delayed quarter onset", () => {
    const bpm = 78;
    const notes = [0, 0.25, 0.5, 1, 1.5, 2.5, 3.5, 3.75, 4, 4.5, 5, 5.5].map(
      (beat, i) => ({
        start: beat * 60 / bpm + (i === 5 ? 0.055 : 0),
        dur: 0.17,
        midi: 60 + (i % 5),
      }),
    );
    assert.ok(Math.abs(estimateBpm(notes) - bpm) <= 2);
  });


  it("keeps the beat of grouped and dotted subdivisions at faster tempi", () => {
    for (const bpm of [120, 132]) {
      for (const beats of [
        [0, 0.25, 0.5, 1, 1.5, 2.5, 3.5, 3.75, 4, 4.5, 5, 5.5],
        [0, 0.75, 1.5, 2.5, 3, 4, 4.5, 5, 6.5, 7],
      ]) {
        const notes = beats.map((beat, index) => ({
          start: beat * 60 / bpm, dur: 0.2, midi: 60 + index % 5,
        }));
        assert.equal(estimateBpm(notes), bpm);
      }
    }
  });

  it("uses a shared triplet beat across phrases of different lengths", () => {
    const quarter = 60 / 114;
    const thirds = [0, 1, 2, 3, 4, 5, 12, 13, 14, 18, 19, 20];
    const notes = thirds.map(tick => ({ start: 0.21 + tick * quarter / 3, dur: quarter / 3, midi: 69 }));
    assert.equal(estimateBpm(notes), 114);
  });

  it("recovers the beat at two apparent speeds using three- and five-sixteenth gaps", () => {
    const quarter = 60 / 128;
    for (const gaps of [
      [1, 1, 0.5, 0.5, 0.75, 1.5, 1.25, 0.5, 0.5, 1, 0.5, 0.5, 0.5],
      [0.5, 0.5, 2, 0.5, 0.75, 1.5, 1.25, 0.5, 0.5, 1, 0.5, 0.5, 0.5, 0.5],
    ]) {
      let time = 0;
      const notes = gaps.map(gap => {
        const note = { start: time, dur: gap * quarter, midi: 65 };
        time += gap * quarter;
        return note;
      });
      assert.equal(estimateBpm(notes), 128);
    }
  });

  it("ignores a long rest between phrases", () => {
    const notes = [
      ...onsets(0.5, 6),
      { start: 6.5, dur: 0.4, midi: 70 },
      { start: 7, dur: 0.4, midi: 72 },
      { start: 7.5, dur: 0.4, midi: 74 },
    ];
    const bpm = estimateBpm(notes);
    assert.ok(bpm >= 108 && bpm <= 132, `got ${bpm}`);
  });

  it("skips ghost onsets a few dozen milliseconds after the real attack", () => {
    const notes: DetectedNote[] = [];
    for (let index = 0; index < 8; index += 1) {
      notes.push({ start: index * 0.6, dur: 0.4, midi: 60 });
      notes.push({ start: index * 0.6 + 0.04, dur: 0.04, midi: 61 });
    }
    const bpm = estimateBpm(notes);
    assert.ok(bpm >= 94 && bpm <= 106, `got ${bpm}`);
  });

  it("reads a 16th-note motoric line at 66 instead of clamping to 170-176", () => {
    const sixteenth = 0.909091 / 4;
    const notes: DetectedNote[] = [];
    let time = sixteenth * 2;
    for (let group = 0; group < 4; group += 1) {
      for (let step = 0; step < 6; step += 1) {
        notes.push({ start: time, dur: sixteenth, midi: 67 + (step % 3) * 5 });
        time += sixteenth;
      }
      time += sixteenth * 3;
    }
    const bpm = estimateBpm(notes);
    assert.ok(bpm >= 60 && bpm <= 72, `got ${bpm}`);
  });

  it("keeps a 66 bpm 16th line when a few onsets are late or split, instead of clamping to 176", () => {
    // Onsets from the official browser-path take of wtc-prelude accompaniment-reverb
    // (2026-11-16 acc-pickup run). Raw pitches are mostly right, but split/late
    // attacks used to make estimateBpm prefer the old 176 clamp.
    const starts = [
      0.448, 0.672, 0.912, 1.264, 1.424, 1.584, 2.272, 2.544, 2.72, 3.088, 3.184, 3.408,
      4.096, 4.32, 4.544, 4.88, 4.992, 5.232, 5.904, 6.144, 6.368, 6.704, 6.816, 7.04,
    ];
    const notes = starts.map((start, index) => ({ start, dur: 0.2, midi: 67 + (index % 3) * 5 }));
    const bpm = estimateBpm(notes);
    assert.ok(bpm >= 60 && bpm <= 72, `got ${bpm}`);
  });

  it("keeps sixteenth runs at a true 120 instead of climbing to 176", () => {
    const sixteenth = 0.125;
    const notes: DetectedNote[] = [];
    let time = 0.5;
    for (let group = 0; group < 2; group += 1) {
      for (let step = 0; step < 4; step += 1) {
        notes.push({ start: time, dur: sixteenth, midi: 71 - step });
        time += sixteenth;
      }
      time += 0.25;
    }
    const bpm = estimateBpm(notes);
    assert.ok(bpm >= 112 && bpm <= 128, `got ${bpm}`);
  });

  it("recovers a 72 bpm line whose IOIs are sixteenths and dotted eighths", () => {
    const sixteenth = 0.833333 / 4;
    const notes: DetectedNote[] = [];
    let time = 0;
    for (let group = 0; group < 2; group += 1) {
      notes.push({ start: time, dur: sixteenth * 2, midi: 69 });
      time += sixteenth * 3;
      for (let step = 0; step < 3; step += 1) {
        notes.push({ start: time, dur: sixteenth, midi: 60 + step });
        time += sixteenth;
      }
    }
    const bpm = estimateBpm(notes);
    assert.ok(bpm >= 66 && bpm <= 78, `got ${bpm}`);
  });

  it("holdout: a 16th stream at 88 is not used for debugging official excerpts", () => {
    const sixteenth = 60 / 88 / 4;
    const notes: DetectedNote[] = [];
    for (let i = 0; i < 24; i += 1) {
      const gap = i % 8 === 7 ? sixteenth * 2 : sixteenth;
      const start = notes.length ? notes[notes.length - 1].start + gap : 0;
      notes.push({ start, dur: sixteenth, midi: 64 + (i % 4) });
    }
    const bpm = estimateBpm(notes);
    assert.ok(bpm >= 80 && bpm <= 96, `got ${bpm}`);
  });
});

describe("repeated pitches", () => {
  it("keeps one sustained pitch when energy moves from its fundamental into a harmonic", () => {
    const samples = Float32Array.from({ length: SR * 1.2 }, (_, i) => {
      const t = i / SR;
      const phase = 2 * Math.PI * midiHz(72) * t;
      const fundamental = 1 - 0.8 * Math.max(0, 1 - Math.abs(t - 0.55) / 0.034);
      const harmonic = Math.sqrt(1 - fundamental ** 2);
      const envelope = Math.min(1, t / 0.02, (1.2 - t) / 0.03);
      return 0.4 * envelope * (fundamental * Math.sin(phase) + harmonic * Math.sin(3 * phase));
    });
    const notes = transcribeMono(samples, SR).notes;
    assert.deepEqual(notes.map(n => n.midi), [72]);
    assert.ok(notes[0].start < 0.04 && Math.abs(notes[0].dur - 1.2) < 0.08);
  });

  it("keeps a quieter re-attack after a short first note", () => {
    const samples = Float32Array.from({ length: SR * 0.8 }, (_, i) => {
      const t = i / SR;
      const envelope = Math.min(1, t / 0.008, (0.8 - t) / 0.015, Math.abs(t - 0.12) / 0.015);
      return 0.4 * envelope * (t < 0.12 ? 1 : 0.7) * Math.sin(2 * Math.PI * 440 * t);
    });
    const notes = transcribeMono(samples, SR).notes;
    assert.deepEqual(notes.map(n => n.midi), [69, 69]);
    assert.ok(Math.abs(notes[0].dur - 0.12) < 0.025);
    assert.ok(Math.abs(notes[1].start - 0.12) < 0.025 && Math.abs(notes[1].dur - 0.68) < 0.08);
  });

  it("keeps two notes when the same pitch comes back after a short breath", () => {
    const gap = 0.04;
    const len = Math.floor(SR * (0.05 + 0.4 + gap + 0.45));
    const samples = new Float32Array(len);
    addVoice(samples, 60, 0.05, 0.4, 0.7, 0);
    addVoice(samples, 60, 0.05 + 0.4 + gap, 0.4, 0.7, 0);
    const notes = analyzeMelody(samples, SR).filter((note) => note.midi === 60);
    assert.equal(
      notes.length,
      2,
      notes.map((note) => `${note.midi}@${note.start.toFixed(3)}/${note.dur.toFixed(3)}`).join(" "),
    );
  });

  it("keeps adjacent same-pitch quarters that only re-attack, without a long silent gap", () => {
    // Matches eval/synthesis.mjs: 10ms attack, 25ms release, no extra rest between notes.
    // Twinkle's repeated pitches were previously merged, estimateBpm halved, and bars 3–4 went empty.
    const samples = new Float32Array(Math.floor(SR * 8.2));
    const pitches = [60, 60, 67, 67, 69, 69, 67, 67, 65, 65, 64, 64, 62, 62, 60, 60];
    pitches.forEach((midi, i) => addVoice(samples, midi, i * 0.5, 0.5, 0.7, 0));
    const buffer = { length: samples.length, numberOfChannels: 1, getChannelData: () => samples };
    for (const [label, notes] of [
      ["analyzeMelody", analyzeMelody(samples, SR)],
      ["transcribeMono", transcribeMono(samples, SR).notes],
      ["transcribeBuffer", transcribeBuffer(buffer, SR).notes],
    ] as const) {
      assert.equal(
        notes.length,
        16,
        `${label}: ` + notes.map((note) => `${note.midi}@${note.start.toFixed(3)}/${note.dur.toFixed(3)}`).join(" "),
      );
      assert.deepEqual(notes.map((note) => note.midi), pitches, label);
      const bpm = estimateBpm(notes);
      assert.ok(Math.abs(bpm - 120) <= 8, `${label}: expected ~120 bpm after splitting reattacks, got ${bpm}`);
      const quantized = quantizeDetected(notes, bpm, 0.5);
      const pitched = quantized.filter((note) => note.pitches.length);
      assert.equal(pitched.length, 16, label);
      assert.ok(pitched.every((note) => Math.abs(note.dur - 1) < 1e-6), label);
    }
  });
});

describe("general onset, re-attack and short-note tracking", () => {
  function addTone(buf: Float32Array, midi: number, start: number, dur: number, amp: number) {
    const hz = midiHz(midi);
    const a = Math.floor(start * SR);
    const b = Math.min(buf.length, Math.floor((start + dur) * SR));
    for (let i = a; i < b; i += 1) {
      const t = (i - a) / SR;
      const env = Math.min(1, t / 0.01, (b - i) / SR / 0.025);
      buf[i] +=
        amp *
        env *
        (Math.sin(2 * Math.PI * hz * t) +
          0.25 * Math.sin(4 * Math.PI * hz * t) +
          0.1 * Math.sin(6 * Math.PI * hz * t));
    }
  }

  it("estimates a clean 120 bpm sixteenth run near 120, not a hop-quantized 117", () => {
    const sixteenth = 0.125;
    const pitches = [71, 69, 68, 69, 72, 74, 72, 71, 72];
    const starts = [0.5, 0.625, 0.75, 0.875, 1, 1.5, 1.625, 1.75, 1.875];
    const durs = [0.125, 0.125, 0.125, 0.125, 0.25, 0.125, 0.125, 0.125, 0.125];
    const buf = new Float32Array(Math.floor(SR * 2.4));
    pitches.forEach((midi, i) => addTone(buf, midi, starts[i], durs[i], 0.3));
    const take = transcribeMono(buf, SR);
    assert.deepEqual(take.notes.map((n) => n.midi), pitches);
    const bpm = estimateBpm(take.notes);
    assert.ok(Math.abs(bpm - 120) <= 3, `expected ~120 bpm, got ${bpm} from ${take.notes.map((n) => n.start.toFixed(3)).join(",")}`);
  });

  it("keeps repeated same-pitch quarters that re-attack over a pad on the same pitch", () => {
    const buf = new Float32Array(Math.floor(SR * 3.2));
    addTone(buf, 60, 0, 0.5, 0.3);
    addTone(buf, 60, 0.5, 0.5, 0.3);
    addTone(buf, 67, 1.0, 0.5, 0.3);
    addTone(buf, 67, 1.5, 0.5, 0.3);
    for (const pitch of [48, 55, 60]) addTone(buf, pitch, 0, 1.9, 0.09);
    const notes = transcribeMono(buf, SR).notes;
    const midis = notes.map((n) => n.midi);
    assert.ok(midis.filter((m) => m === 60).length >= 2, `expected two C4s, got ${notes.map((n) => `${n.midi}@${n.start.toFixed(3)}/${n.dur.toFixed(3)}`).join(" ")}`);
    assert.ok(midis.filter((m) => m === 67).length >= 2, `expected two G4s, got ${notes.map((n) => `${n.midi}@${n.start.toFixed(3)}/${n.dur.toFixed(3)}`).join(" ")}`);
  });

  it("keeps repeated same-pitch quarters over a same-pitch pad even when reverb fills the valley", () => {
    // General fixture: melody starts with the pad, pad includes the melody
    // pitch, and a short reverb tail lifts the trough between two quarters.
    // The second attack may not double the filled valley; it should still split.
    // Use D4/A4, not a particular official tune. Assert the product path.
    function addReverb(buf: Float32Array) {
      const dry = buf.slice();
      for (const [delay, gain] of [
        [0.075, 0.24],
        [0.13, 0.17],
        [0.21, 0.1],
      ] as Array<[number, number]>) {
        const shift = Math.round(delay * SR);
        for (let i = shift; i < buf.length; i += 1) buf[i] += dry[i - shift] * gain;
      }
    }
    const buf = new Float32Array(Math.floor(SR * 8.3));
    const pattern = [62, 62, 69, 69, 67, 67, 65, 65, 64, 64, 62, 62, 61, 61, 62, 62];
    pattern.forEach((midi, i) => addTone(buf, midi, i * 0.5, 0.5, 0.3));
    for (let t = 0; t < 8; t += 2) {
      for (const pitch of [50, 57, 62]) addTone(buf, pitch, t, Math.min(1.9, 8.2 - t), 0.09);
    }
    addReverb(buf);
    const notes = transcribeBuffer(
      { length: buf.length, numberOfChannels: 1, getChannelData: () => buf },
      SR,
    ).notes;
    const detail = notes.map((n) => `${n.midi}@${n.start.toFixed(3)}/${n.dur.toFixed(3)}`).join(" ");
    assert.ok(notes.length >= 2 && notes[0].midi === 62 && notes[1].midi === 62, `expected opening D4-D4, got ${detail}`);
    assert.ok(notes[0].dur < 0.8 && notes[1].start < 0.7, `first D4 should be a quarter, not a merged half, got ${detail}`);
    assert.ok(notes.filter((n) => n.midi === 69).length >= 2, `expected two A4s, got ${detail}`);
  });

  it("keeps short arpeggio notes, including a chord-tone return, over a mid-range triad pad", () => {
    const step = 0.22;
    const pattern = [67, 72, 76, 67, 72, 76];
    const buf = new Float32Array(Math.floor(SR * 3.4));
    let time = 0.2;
    for (const midi of pattern) {
      addTone(buf, midi, time, step, 0.3);
      time += step;
    }
    time += step * 0.75;
    for (const midi of pattern) {
      addTone(buf, midi, time, step, 0.3);
      time += step;
    }
    for (let t = 0; t < time; t += 2) {
      const dur = Math.min(1.9, time - t);
      for (const pitch of [48, 55, 60]) addTone(buf, pitch, t, dur, 0.09);
    }
    const dry = buf.slice();
    for (const [delay, gain] of [[0.075, 0.24], [0.13, 0.17], [0.21, 0.1]] as Array<[number, number]>) {
      const shift = Math.round(delay * SR);
      for (let i = shift; i < buf.length; i += 1) buf[i] += dry[i - shift] * gain;
    }
    const notes = transcribeMono(buf, SR).notes.filter((n) => n.midi >= 62);
    const midis = notes.map((n) => n.midi);
    assert.ok(midis.length >= 10, `expected most of the 12 short notes, got ${notes.map((n) => `${n.midi}@${n.start.toFixed(3)}`).join(" ")}`);
    const returns = midis.filter((midi, i) => midi === 67 && i > 0 && midis[i - 1] === 76).length;
    assert.ok(returns >= 1, `expected a G4 return after E5, got ${midis.join(",")}`);
  });
});

describe("quantizeDetected", () => {
  it("quantizes a slightly short quarter to a quarter, including the last note", () => {
    const notes = MELODY.map((midi, index) => ({
      start: 0.08 + index * 0.6,
      dur: 0.53,
      midi,
    }));
    const out = quantizeDetected(notes, 100, 0.25);
    assert.equal(out.some((note) => note.pitches.length === 0), false);
    assert.ok(out.every((note) => Math.abs(note.dur - 1) < 1e-6));
    assert.deepEqual(
      out.map((note) => note.pitches[0]),
      MELODY,
    );
  });

  it("keeps a leading pickup rest instead of shifting the first note to beat zero", () => {
    const quarter = 60 / 66;
    const notes = [0.5, 1, 1.5, 2, 2.5].map((beats, index) => ({
      start: beats * quarter,
      dur: 0.45 * quarter,
      midi: 67 + index,
    }));
    const out = quantizeDetected(notes, 66, 0.5);
    assert.equal(out[0]?.pitches.length, 0);
    assert.ok(Math.abs((out[0]?.dur ?? 0) - 0.5) < 1e-6);
    assert.deepEqual(
      out.slice(1).map((note) => note.pitches[0]),
      [67, 68, 69, 70, 71],
    );
    assert.ok(out.slice(1).every((note) => Math.abs(note.dur - 0.5) < 1e-6));
  });

  it("keeps a long grid-aligned leading rest instead of shifting the first note to beat zero", () => {
    const quarter = 60 / 96;
    const starts = [13, 14, 15, 16, 17, 18, 19, 20, 21];
    const durs = [1, 1, 1, 1, 1, 1, 1, 1, 3];
    const midis = [78, 81, 79, 78, 73, 71, 73, 74, 69];
    const notes = starts.map((beats, index) => ({
      start: beats * quarter,
      dur: (durs[index] - 0.05) * quarter,
      midi: midis[index],
    }));
    for (const grid of [0.5, 0.25]) {
      const out = quantizeDetected(notes, 96, grid);
      assert.equal(out[0]?.pitches.length, 0, `grid ${grid} should keep the leading rest`);
      assert.ok(Math.abs((out[0]?.dur ?? 0) - 13) < 1e-6, `grid ${grid} rest ${out[0]?.dur}`);
      const sounded = out.filter((note) => note.pitches.length);
      assert.deepEqual(sounded.map((note) => note.pitches[0]), midis);
      assert.ok(sounded.every((note, index) => Math.abs(note.dur - durs[index]) < 1e-6));
    }
  });

  it("writes 3:2 eighth triplets when onsets trisect a beat that starts on the beat or half-beat", () => {
    const quarter = 60 / 96;
    const starts = [1, 1 + 1 / 3, 1 + 2 / 3, 2, 2 + 1 / 3, 2 + 2 / 3];
    const midis = [73, 76, 78, 80, 75, 71];
    const notes = starts.map((beats, index) => ({
      start: beats * quarter + 0.002,
      dur: (1 / 3) * quarter * 0.9,
      midi: midis[index],
    }));
    for (const grid of [0.5, 0.25]) {
      const out = quantizeDetected(notes, 96, grid);
      assert.equal(out[0]?.pitches.length, 0, `grid ${grid} should keep the one-beat rest`);
      assert.ok(Math.abs((out[0]?.dur ?? 0) - 1) < 1e-6, `grid ${grid} rest ${out[0]?.dur}`);
      const sounded = out.filter((note) => note.pitches.length);
      assert.deepEqual(sounded.map((note) => note.pitches[0]), midis);
      for (const note of sounded) {
        assert.ok(Math.abs(note.dur - 1 / 3) < 1e-6, `grid ${grid} dur ${note.dur}`);
      }
      let cursor = 0;
      let i = 0;
      for (const note of out) {
        if (!note.pitches.length) {
          cursor += note.dur;
          continue;
        }
        assert.ok(Math.abs(cursor - starts[i]) < 1e-6, `grid ${grid} start ${cursor} expected ${starts[i]}`);
        cursor += note.dur;
        i += 1;
      }
    }
  });

  it("writes 4/3 on the last slot of a 3:2 group when sounding is slightly short and the next onset is 4/3 later", () => {
    const quarter = 60 / 132;
    const starts = [1, 1 + 1 / 3, 1 + 2 / 3, 3, 3 + 1 / 3, 3 + 2 / 3];
    const durs = [0.3, 0.3, 1.28, 0.3, 0.3, 0.3];
    const midis = [73, 66, 69, 73, 66, 69];
    const notes = starts.map((beats, index) => ({
      start: beats * quarter + 0.002,
      dur: durs[index] * quarter,
      midi: midis[index],
    }));
    for (const grid of [0.5, 0.25]) {
      const out = quantizeDetected(notes, 132, grid);
      const sounded = out.filter((note) => note.pitches.length);
      assert.deepEqual(sounded.map((note) => note.pitches[0]), midis);
      assert.ok(Math.abs(sounded[2]?.dur - 4 / 3) < 1e-6, `grid ${grid} long slot ${sounded[2]?.dur}`);
      assert.ok(sounded.filter((_, i) => i !== 2).every((note) => Math.abs(note.dur - 1 / 3) < 1e-6));
      let cursor = 0;
      let i = 0;
      for (const note of out) {
        if (!note.pitches.length) {
          cursor += note.dur;
          continue;
        }
        assert.ok(Math.abs(cursor - starts[i]) < 1e-6, `grid ${grid} start ${cursor} expected ${starts[i]}`);
        cursor += note.dur;
        i += 1;
      }
    }
  });

  it("does not stretch a short last-slot 1/3 into 4/3 when the next onset is later", () => {
    const quarter = 60 / 96;
    const starts = [1, 1 + 1 / 3, 1 + 2 / 3, 3];
    const midis = [73, 66, 69, 73];
    const notes = starts.map((beats, index) => ({
      start: beats * quarter + 0.002,
      dur: (1 / 3) * quarter * 0.9,
      midi: midis[index],
    }));
    for (const grid of [0.5, 0.25]) {
      const out = quantizeDetected(notes, 96, grid);
      const sounded = out.filter((note) => note.pitches.length);
      assert.deepEqual(sounded.map((note) => note.pitches[0]), midis);
      assert.ok(sounded.slice(0, 3).every((note) => Math.abs(note.dur - 1 / 3) < 1e-6), `grid ${grid} triplet durs ${sounded.map((n) => n.dur)}`);
      assert.ok(Math.abs(sounded[2]?.dur - 4 / 3) > 0.5, `grid ${grid} must not stretch the short last slot`);
    }
  });

  it("does not rewrite grid-aligned sixteenths as eighth triplets", () => {
    const quarter = 0.5;
    const notes = [0, 0.25, 0.5, 0.75].map((beats, index) => ({
      start: beats * quarter,
      dur: 0.2 * quarter,
      midi: 60 + index,
    }));
    const out = quantizeDetected(notes, 120, 0.25);
    const sounded = out.filter((note) => note.pitches.length);
    assert.deepEqual(sounded.map((note) => note.pitches[0]), [60, 61, 62, 63]);
    assert.ok(sounded.every((note) => Math.abs(note.dur - 0.25) < 1e-6));
    let cursor = 0;
    for (const note of out) {
      if (!note.pitches.length) {
        cursor += note.dur;
        continue;
      }
      assert.ok(Math.abs(cursor * 4 - Math.round(cursor * 4)) < 1e-6, `onset ${cursor} left the sixteenth grid`);
      cursor += note.dur;
    }
  });

  it("does not invent a pickup rest for a few dozen milliseconds of leading latency", () => {
    const out = quantizeDetected(
      [
        { start: 0.08, dur: 0.5, midi: 60 },
        { start: 0.68, dur: 0.5, midi: 62 },
        { start: 1.28, dur: 0.5, midi: 64 },
      ],
      100,
      0.5,
    );
    assert.equal(out[0]?.pitches[0], 60);
    assert.equal(out.some((note) => note.pitches.length === 0), false);
  });

  it("keeps a one-step pickup on the grid when detected attacks are early or late", () => {
    for (const delay of [-0.03, 0.03]) {
      const notes = [0.25, 0.75, 1.25].map((beat, index) => ({
        start: beat * 0.6 + delay,
        dur: 0.3,
        midi: 60 + index,
      }));
      assert.deepEqual(quantizeDetected(notes, 100, 0.25), [
        { pitches: [], dur: 0.25 },
        { pitches: [60], dur: 0.5 },
        { pitches: [61], dur: 0.5 },
        { pitches: [62], dur: 0.5 },
      ]);
    }
  });


  it("drops a short wrong-pitch blip inside a sustained note instead of writing a sixteenth", () => {
    const out = quantizeDetected(
      [
        { start: 0.05, dur: 0.55, midi: 64 },
        { start: 0.62, dur: 0.52, midi: 64 },
        { start: 1.16, dur: 0.06, midi: 65 },
        { start: 1.24, dur: 0.5, midi: 64 },
        { start: 1.9, dur: 0.55, midi: 67 },
      ],
      96,
      0.25,
    );
    assert.equal(
      out.some((note) => note.pitches[0] === 65),
      false,
    );
    assert.equal(
      out.some((note) => note.pitches.length > 0 && note.dur <= 0.25),
      false,
    );
    assert.ok(out.filter((note) => note.pitches[0] === 64).length <= 2);
    assert.ok(out.some((note) => note.pitches[0] === 67));
  });

  it("keeps repeated notes that are separated by a real gap", () => {
    const out = quantizeDetected(
      [
        { start: 0, dur: 0.5, midi: 60 },
        { start: 0.58, dur: 0.5, midi: 60 },
        { start: 1.2, dur: 0.5, midi: 62 },
      ],
      100,
      0.25,
    );
    assert.equal(out.filter((note) => note.pitches[0] === 60).length, 2);
    assert.equal(out.some((note) => note.pitches.length === 0), false);
  });

  it("writes a rest for a clear gap and keeps the Score rest shape", () => {
    const out = quantizeDetected(
      [
        { start: 0, dur: 0.4, midi: 60 },
        { start: 1.2, dur: 0.4, midi: 62 },
      ],
      120,
      0.5,
    );
    assert.equal(out[0]?.pitches[0], 60);
    assert.ok(Math.abs((out[0]?.dur ?? 0) - 1) < 1e-6);
    const rest = out.find((note) => note.pitches.length === 0);
    assert.ok(rest, "expected a rest");
    assert.ok((rest?.dur ?? 0) >= 1);
    assert.equal(out.at(-1)?.pitches[0], 62);
    assert.ok((out.at(-1)?.dur ?? 0) >= 0.75);
  });

  it("keeps the aligned pitch when an earlier attack rounds onto an occupied eighth", () => {
    const notes = [0, 0.26, 0.5, 1, 1.5].map((beat, index) => ({
      start: beat * 0.5, dur: 0.125, midi: 60 + index,
    }));
    assert.deepEqual(quantizeDetected(notes, 120, 0.5), [
      { pitches: [60], dur: 0.5 }, { pitches: [62], dur: 0.5 },
      { pitches: [63], dur: 0.5 }, { pitches: [64], dur: 0.5 },
    ]);
  });

  it("does not emit a zero-duration note when two pitches share an onset", () => {
    const out = quantizeDetected(
      [
        { start: 0, dur: 0.04, midi: 60 },
        { start: 0.06, dur: 0.04, midi: 62 },
      ],
      100,
      0.25,
    );
    assert.ok(out.length >= 1);
    assert.ok(out.every((note) => note.dur > 0));
    assert.ok(out.every((note) => note.pitches.length <= 1));
    for (const note of out) {
      for (const pitch of note.pitches) assert.ok(pitch === 60 || pitch === 62);
    }
  });

  it("does not let slightly short notes stretch the whole phrase", () => {
    const ioi = 0.55;
    const sounding = 0.5;
    const count = 8;
    const notes = Array.from({ length: count }, (_, index) => ({
      start: index * ioi,
      dur: sounding,
      midi: 60 + (index % 3),
    }));
    const out = quantizeDetected(notes, 100, 0.25);
    const quarter = 0.6;
    const audioBeats = ((count - 1) * ioi + sounding) / quarter;
    const total = out.reduce((sum, note) => sum + note.dur, 0);
    assert.ok(Math.abs(total - audioBeats) <= 0.35, `total ${total} audio ${audioBeats}`);

    let cursor = 0;
    let index = 0;
    for (const note of out) {
      if (!note.pitches.length) {
        cursor += note.dur;
        continue;
      }
      const raw = (notes[index].start - notes[0].start) / quarter;
      const error = Math.abs(cursor - raw);
      assert.ok(error <= 0.25, `onset ${index} error ${error}`);
      cursor += note.dur;
      index += 1;
    }
    assert.equal(index, count);
  });

  it("does not turn a 50ms articulation into a rest or a sixteenth", () => {
    const out = quantizeDetected(
      [
        { start: 0, dur: 0.5, midi: 60 },
        { start: 0.55, dur: 0.5, midi: 62 },
        { start: 1.1, dur: 0.5, midi: 64 },
      ],
      100,
      0.25,
    );
    assert.equal(out.some((note) => note.pitches.length === 0), false);
    assert.deepEqual(
      out.map((note) => note.pitches[0]),
      [60, 62, 64],
    );
    assert.ok(out.every((note) => note.dur > 0.25 + 1e-6));
    const quarter = 0.6;
    const audioBeats = (1.1 + 0.5) / quarter;
    const total = out.reduce((sum, note) => sum + note.dur, 0);
    assert.ok(Math.abs(total - audioBeats) <= 0.35, `total ${total} audio ${audioBeats}`);
  });

  it("stores a clean last-beat length instead of a floating-point residue", () => {
    assert.equal(cleanBeat(0.9999999999999991), 1);
    assert.equal(String(cleanBeat(0.9999999999999991)), "1");
    const quarterSec = 60 / 120;
    const scale = [60, 62, 64, 65, 67, 69, 71, 72];
    const notes = scale.map((midi, index) => ({
      start: index * quarterSec * 0.5,
      dur: quarterSec * 0.46,
      midi,
    }));
    const out = quantizeDetected(notes, 120, 0.5);
    assert.ok(out.length >= scale.length);
    for (const note of out) {
      assert.equal(String(note.dur).includes("999999"), false, String(note.dur));
      assert.equal(note.dur, cleanBeat(note.dur));
    }
    assert.equal(out.at(-1)?.dur, 0.5);
  });

  it("keeps a real sixteenth when the grid is sixteenths", () => {
    const out = quantizeDetected(
      [
        { start: 0, dur: 0.14, midi: 60 },
        { start: 0.15, dur: 0.45, midi: 62 },
      ],
      100,
      0.25,
    );
    assert.equal(out[0]?.pitches[0], 60);
    assert.ok(Math.abs((out[0]?.dur ?? 0) - 0.25) < 1e-6);
    assert.equal(out[1]?.pitches[0], 62);
  });
});

describe("quiet real-world takes", () => {
  function quietPhrase() {
    const samples = new Float32Array(SR * 2);
    [60, 64, 67].forEach((midi, i) => addVoice(samples, midi, 0.2 + i * 0.45, 0.32, 0.002, 35));
    // A handling click must not set the gate for the entire quiet phrase.
    samples[20] = 0.9;
    let seed = 123;
    for (let i = 0; i < samples.length; i++) {
      seed = (1664525 * seed + 1013904223) >>> 0;
      samples[i] += (seed / 2 ** 32 - 0.5) * 0.0003;
    }
    return samples;
  }
  it("recovers a weak short phrase with click, light noise and vibrato through both PCM entries", () => {
    const samples = quietPhrase();
    const buffer = { length: samples.length, numberOfChannels: 1, getChannelData: () => samples };
    for (const take of [transcribeMono(samples, SR), transcribeBuffer(buffer, SR)]) {
      assert.deepEqual(collapse(take.notes.map((n) => n.midi)), [60, 64, 67]);
    }
  });
  it("does not turn quiet broadband noise into notes", () => {
    let seed = 456;
    const samples = Float32Array.from({ length: SR }, () => {
      seed = (1664525 * seed + 1013904223) >>> 0;
      return (seed / 2 ** 32 - 0.5) * 0.002;
    });
    const take = transcribeMono(samples, SR);
    assert.equal(take.notes.length, 0);
    assert.match(take.notice ?? "", /音高|听不出/);
  });
  it("gives Chinese feedback for empty, too-short and near-silent recordings", () => {
    for (const samples of [new Float32Array(0), new Float32Array(100), new Float32Array(SR).fill(1e-7)]) {
      for (const take of [transcribeMono(samples, SR), transcribeBuffer({ length: samples.length, numberOfChannels: 1, getChannelData: () => samples }, SR)]) {
        assert.equal(take.notes.length, 0);
        assert.match(take.notice ?? "", /声音|音高|太短/);
      }
    }
  });
});


describe("full-length dense dictation", () => {
  it("keeps a dense 65-second melody through chunk seams and quantization", () => {
    const samples = new Float32Array(65 * SR);
    const expected = Array.from({ length: 256 }, (_, i) => MELODY[i % MELODY.length]);
    expected.forEach((midi, i) => addVoice(samples, midi, 0.1 + i * 0.25, 0.21, 0.5));
    const buffer = { length: samples.length, numberOfChannels: 2, getChannelData: () => samples };
    const take = transcribeBuffer(buffer, SR);
    assert.deepEqual(take.notes.map(n => n.midi), expected);
    assert.equal(take.analyzedSeconds, 65);
    assert.ok(take.notes.at(-1)!.start > 63);
    assert.equal(quantizeDetected(take.notes, 120, 0.25).filter(n => n.pitches.length).length, 256);
    assert.equal(mixToMono(buffer, SR).length, samples.length);
    assert.match(take.notice ?? "", /完整音频.*65/);
  });

  it("joins a sustained note across a seam without duplicating it", () => {
    const samples = new Float32Array(32 * SR);
    addVoice(samples, 64, 23.5, 1.2, 0.5);
    addVoice(samples, 67, 31, 0.5, 0.5);
    const take = transcribeMono(samples, SR);
    assert.deepEqual(take.notes.map(n => n.midi), [64, 67]);
    assert.ok(take.notes[0].dur > 1.1);
    assert.ok(take.notes[1].start > 30);
    assert.ok(analyzeMelody(samples, SR).some(n => n.start > 30));
  });

  it("resamples late audio at 48 kHz without losing the time axis", () => {
    const samples = new Float32Array(33 * 48000);
    for (let i = 31 * 48000; i < 32 * 48000; i++) samples[i] = 0.5 * Math.sin(2 * Math.PI * 440 * i / 48000);
    const take = transcribeMono(samples, 48000);
    assert.equal(take.notes.length, 1);
    assert.equal(take.analyzedSeconds, 33);
    assert.equal(take.notes[0].midi, 69);
    assert.ok(Math.abs(take.notes[0].start - 31) < 0.05);
  });
});

describe("breathy humming with scoops", () => {
  for (const [base, breath] of [40, 48, 55, 60, 67].flatMap(base => [0.25, 0.85].map(breath => [base, breath]))) {
    it(`recovers voice at MIDI ${base}, breath ${breath} through both PCM entries`, () => {
      const { samples, sampleRate, truth } = hummingFixture(base, 731, 0.002, breath);
      const buffer = { length: samples.length, numberOfChannels: 1, getChannelData: () => samples };
      for (const take of [transcribeMono(samples, sampleRate), transcribeBuffer(buffer, sampleRate)]) {
        const score = scoreHumming(take.notes, truth);
        assert.deepEqual(take.notes.map(n => n.midi), truth.map(n => n.midi));
        assert.ok(score.pitchAccuracy >= 0.95, JSON.stringify(score));
        assert.ok(score.onsetF1 >= 0.8, JSON.stringify(score));
        assert.equal(take.kind, "dry");
      }
    });
  }

  it("rejects filtered environmental noise as well as white noise", () => {
    let seed = 987;
    let low = 0;
    const samples = Float32Array.from({ length: SR * 3 }, () => {
      seed = (1664525 * seed + 1013904223) >>> 0;
      low += 0.12 * ((seed / 2 ** 32 - 0.5) - low);
      return low * 0.02;
    });
    assert.equal(transcribeMono(samples, SR).notes.length, 0);
  });
});

describe("pitch confidence", () => {
  it("scores stable long segments high and short or unsteady ones low", () => {
    assert.ok(pitchConfidence([60, 60, 60, 60], 0.4) > 0.95);
    assert.ok(pitchConfidence([60, 61, 59, 62], 0.4) < 0.65);
    assert.ok(pitchConfidence([60, 60, 60], 0.08) < 0.5);
    assert.equal(pitchConfidence([], 0.4), 0);
    assert.equal(isLowPitchConfidence({ start: 0, dur: 0.4, midi: 60, confidence: 0.64 }), true);
    assert.equal(isLowPitchConfidence({ start: 0, dur: 0.4, midi: 60, confidence: 0.65 }), false);
    assert.equal(isLowPitchConfidence({ start: 0, dur: 0.4, midi: 60 }), false);
  });

  it("attaches high confidence to a clean sustained tone", () => {
    const samples = new Float32Array(SR);
    addVoice(samples, 69, 0.1, 0.7, 0.4);
    const notes = transcribeMono(samples, SR).notes;
    assert.equal(notes.length, 1);
    assert.equal(notes[0].midi, 69);
    assert.ok((notes[0].confidence ?? 0) >= 0.65);
    assert.equal(isLowPitchConfidence(notes[0]), false);
  });
});
