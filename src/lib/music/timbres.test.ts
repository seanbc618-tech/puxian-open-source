import { test } from "node:test";
import assert from "node:assert/strict";
import { TIMBRES, isTimbre, toneEnvelope, type Timbre } from "./timbres.ts";
import { alignMixer, mixerPrograms } from "./mixer.ts";
import { scoreToMidi, midiToScore, listMidiVoices, previewMidiVoices } from "./midi.ts";
import type { Score } from "./theory.ts";
const score: Score = {
  title: "音色往返",
  bpm: 120,
  beats: 4,
  beatUnit: 4,
  key: "C",
  mode: "major",
  clef: "treble",
  tonicOctave: 4,
  notes: [{ pitches: [60], dur: 1 }],
  voice2: [{ pitches: [48], dur: 2 }],
};

test("六种原创合成参数、GM program 与音色校验", () => {
  assert.deepEqual(
    Object.values(TIMBRES).map((p) => p.program),
    [0, 4, 48, 73, 24, 33],
  );
  for (const p of Object.values(TIMBRES)) {
    assert.equal(p.partials.length, p.levels.length);
    assert.ok(p.levels.every((l) => l > 0 && l <= 1));
    assert.ok(p.partials.every((f) => f > 0));
    assert.ok(p.cutoff > 0);
  }
  assert.equal(isTimbre("piano"), true);
  for (const value of [null, {}, "__proto__", "toString", "violin"])
    assert.equal(isTimbre(value), false);
});

test("包络：钢琴保留衰减，弦乐/长笛持续；极短、长音、重音和连奏时序有效", () => {
  assert.deepEqual(toneEnvelope("piano", 1), {
    attack: 0.012,
    hold: 0.012,
    sustain: 1,
    end: 1.08,
    stop: 1.45,
  });
  assert.equal(toneEnvelope("piano", 10).end, 1.6);
  assert.equal(toneEnvelope("piano", 1, "accent").attack, 0.004);
  assert.equal(toneEnvelope("piano", 1, "legato").attack, 0.04);
  assert.ok(toneEnvelope("strings", 4).end > 4);
  assert.ok(toneEnvelope("flute", 4).hold > 3);
  const signatures = new Set(
    Object.keys(TIMBRES).map((t) => JSON.stringify(toneEnvelope(t as Timbre, 0.5))),
  );
  assert.equal(signatures.size, 6);
  for (const t of Object.keys(TIMBRES) as Timbre[])
    for (const duration of [0, -0.1, 0.001, 0.04, 0.5, 10, NaN, Infinity])
      for (const attack of ["normal", "accent", "legato"] as const) {
        const e = toneEnvelope(t, duration, attack);
        assert.ok(Object.values(e).every(Number.isFinite));
        assert.ok(e.attack > 0 && e.hold >= e.attack && e.end > e.hold && e.stop > e.end);
        assert.ok(e.sustain > 0 && e.sustain <= 1);
      }
});

test("MIDI 旧行为字节不变；只给用户选过音色的轨道写 program，包括主动选钢琴", () => {
  const legacy = scoreToMidi(score);
  const untouched = alignMixer(undefined, 2);
  assert.deepEqual(scoreToMidi(score, mixerPrograms(untouched)), legacy);
  assert.deepEqual(
    listMidiVoices(legacy).map((v) => v.program),
    [undefined, undefined],
  );
  const selected = alignMixer([{ timbre: "piano", timbreChanged: true }, {}], 2);
  const bytes = scoreToMidi(score, mixerPrograms(selected));
  assert.deepEqual(
    listMidiVoices(bytes).map((v) => v.program),
    [0, undefined],
  );
  assert.deepEqual(midiToScore(bytes, "x").notes, midiToScore(legacy, "x").notes);
  assert.deepEqual(scoreToMidi(score, [-1, NaN]), legacy);
  assert.deepEqual(scoreToMidi(score, [128, 1.5]), legacy);
});

test("六种音色双声部 MIDI 往返：program、独立轨道/通道、音高和时值保留，不写入 Score", () => {
  for (const timbre of Object.keys(TIMBRES)) {
    const channels = alignMixer(
      [
        { timbre, timbreChanged: true },
        { timbre: "bass", timbreChanged: true },
      ],
      2,
    );
    const bytes = scoreToMidi(score, mixerPrograms(channels));
    const voices = listMidiVoices(bytes);
    assert.deepEqual(
      voices.map((v) => v.program),
      [TIMBRES[timbre as Timbre].program, 33],
    );
    assert.deepEqual(
      voices.map((v) => [v.track, v.channel]),
      [
        [0, 0],
        [1, 1],
      ],
    );
    const restored = previewMidiVoices(bytes, "x").score;
    assert.deepEqual(restored.notes, score.notes);
    assert.deepEqual(restored.voice2, score.voice2);
    assert.equal("mixer" in restored, false);
    const second = scoreToMidi(
      restored,
      voices.map((v) => v.program),
    );
    assert.deepEqual(
      listMidiVoices(second).map((v) => v.program),
      voices.map((v) => v.program),
    );
  }
});
