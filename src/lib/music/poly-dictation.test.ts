import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import * as tf from "@tensorflow/tfjs-core";
import "@tensorflow/tfjs-backend-cpu";
import { loadGraphModel } from "@tensorflow/tfjs-converter";
import { runBasicPitch, windowCount } from "./basic-pitch/inference.ts";
import {
  BP_HOP_SAMPLES,
  BP_KEPT_FRAMES,
  BP_PITCHES,
  decodeNotes,
  framesForSamples,
  frameToSeconds,
  type PolyNoteEvent,
} from "./basic-pitch/notes.ts";
import { synthesize, type SynthNote } from "./basic-pitch/synth.ts";
import {
  buildPolyDraft,
  cleanPolyNotes,
  clusterOnsets,
  estimatePolyBpm,
  matchNotes,
  melodyLine,
  suggestSplit,
} from "./poly-dictation.ts";
import type { PulseGrid } from "./poly-rhythm.ts";
import type { Score } from "./theory.ts";

const base: Score = {
  title: "测试",
  bpm: 92,
  beats: 4,
  beatUnit: 4,
  key: "C",
  mode: "major",
  clef: "treble",
  tonicOctave: 4,
  notes: [],
};

test("melody extraction preserves the selected note's attack and release within a chord", () => {
  const bass = { midi: 48, start: 0.25, dur: 0.8, amplitude: 0.8 };
  const lead = { midi: 72, start: 0.29, dur: 0.4, amplitude: 0.7 };
  assert.deepEqual(melodyLine([lead, bass]), [lead]);
});

test("melody extraction keeps a solo pickup and excludes a doubled bass under the lead entry", () => {
  const upperBass = { midi: 55, start: 0, dur: 0.6, amplitude: 0.7 };
  const lowerBass = { ...upperBass, midi: 43 };
  const lead = { midi: 72, start: 0.3, dur: 0.4, amplitude: 0.8 };
  assert.deepEqual(melodyLine([lowerBass, upperBass, lead]), [lead]);
  assert.deepEqual(melodyLine([upperBass, lead]), [{ ...upperBass, dur: 0.3 }, lead]);
});

test("a descending lead can continue past the release of the preceding note", () => {
  const high = { midi: 79, start: 0, dur: 0.55, amplitude: 0.71 };
  const inner = { midi: 60, start: 0.2, dur: 0.15, amplitude: 0.53 };
  const next = { midi: 74, start: 0.4, dur: 0.38, amplitude: 0.7 };
  assert.deepEqual(melodyLine([high, inner, next]), [{ ...high, dur: 0.4 }, next]);
});

test("a stronger sustained note takes precedence over a short higher chord tone", () => {
  const lead = { midi: 71, start: 0.32, dur: 0.8, amplitude: 0.7 };
  const chordTone = { midi: 74, start: 0.31, dur: 0.15, amplitude: 0.5 };
  assert.deepEqual(melodyLine([chordTone, lead]), [lead]);
});

test("a weak higher attack does not interrupt a sustained melody", () => {
  const lead = { midi: 67, start: 0, dur: 0.58, amplitude: 0.8 };
  const chordTone = { midi: 72, start: 0.28, dur: 0.24, amplitude: 0.36 };
  const next = { midi: 69, start: 0.58, dur: 0.28, amplitude: 0.62 };
  assert.deepEqual(melodyLine([lead, chordTone, next]), [lead, next]);
});

test("a lower accompaniment sustaining across a lead re-attack keeps both lead durations", () => {
  const first = { midi: 72, start: 0, dur: 0.375, amplitude: 0.8 };
  const repeated = { ...first, start: 0.375, amplitude: 0.7 };
  const backing = { midi: 65, start: 0.25, dur: 0.5, amplitude: 0.6 };
  assert.deepEqual(melodyLine([first, backing, repeated]), [first, repeated]);

  const descending = { ...backing, dur: 0.25, amplitude: 0.85 };
  assert.deepEqual(melodyLine([first, descending, repeated]), [
    { ...first, dur: 0.25 }, { ...descending, dur: 0.125 }, repeated,
  ]);
});

const modelDir = new URL("./basic-pitch/model/", import.meta.url);
let modelPromise: ReturnType<typeof loadGraphModel> | undefined;
function model() {
  modelPromise ??= (async () => {
    await tf.setBackend("cpu");
    const json = JSON.parse(readFileSync(new URL("model.json", modelDir), "utf8"));
    const bin = readFileSync(new URL("group1-shard1of1.bin", modelDir));
    return loadGraphModel(
      tf.io.fromMemory({
        modelTopology: json.modelTopology,
        weightSpecs: json.weightsManifest[0].weights,
        weightData: bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength),
      }),
    );
  })();
  return modelPromise;
}

async function dictate(notes: SynthNote[], seconds: number) {
  const audio = synthesize(notes, seconds);
  const out = await runBasicPitch(tf, await model(), audio);
  const raw = decodeNotes(out.frames, out.onsets);
  return { raw, clean: cleanPolyNotes(raw).notes };
}

function report(name: string, ref: SynthNote[], raw: PolyNoteEvent[], clean: PolyNoteEvent[]) {
  const before = matchNotes(ref, raw);
  const after = matchNotes(ref, clean);
  console.log(
    `[poly-accuracy] ${name}: ref ${ref.length}, raw ${raw.length} (P ${before.precision.toFixed(2)} R ${before.recall.toFixed(2)} F1 ${before.f1.toFixed(2)}), ` +
      `cleaned ${clean.length} (P ${after.precision.toFixed(2)} R ${after.recall.toFixed(2)} F1 ${after.f1.toFixed(2)}), ` +
      `mean onset error ${(after.meanOnsetError * 1000).toFixed(1)} ms (±50 ms window)`,
  );
  return after;
}

test("frame timing follows the 142-frame windows and their 36164-sample hop", () => {
  assert.equal(frameToSeconds(0), 0);
  assert.ok(Math.abs(frameToSeconds(1) - 256 / 22050) < 1e-12);
  assert.ok(Math.abs(frameToSeconds(BP_KEPT_FRAMES) - 36164 / 22050) < 1e-12);
  assert.equal(windowCount(10), 1);
  assert.equal(framesForSamples(BP_HOP_SAMPLES), BP_KEPT_FRAMES);
  assert.equal(framesForSamples(BP_HOP_SAMPLES + 1), BP_KEPT_FRAMES + 1);
  assert.equal(framesForSamples(BP_HOP_SAMPLES * 50 + 257), BP_KEPT_FRAMES * 50 + 2);
  assert.equal(windowCount(BP_HOP_SAMPLES * 50 + 257), 51);
});

test("decodeNotes keeps sustained frames through the input boundaries", () => {
  const frames = 32;
  const activations = new Float32Array(frames * BP_PITCHES);
  const onsets = new Float32Array(activations.length);
  onsets[64 - 21] = 0.9;
  for (let frame = 0; frame < frames; frame += 1) {
    activations[frame * BP_PITCHES + 60 - 21] = 0.8;
    activations[frame * BP_PITCHES + 64 - 21] = 0.8;
    if (frame < 12) activations[frame * BP_PITCHES + 67 - 21] = 0.8;
  }
  const notes = decodeNotes({ frames, data: activations }, { frames, data: onsets }, { inferOnsets: false });
  assert.deepEqual(
    notes.map(({ midi, start, dur }) => [midi, start, dur]),
    [[60, 0, frameToSeconds(frames)], [64, 0, frameToSeconds(frames)], [67, 0, frameToSeconds(12)]],
  );
});

test("sustained-note recovery preserves the next semitone inside its release lookahead", () => {
  const frames = 36;
  const data = new Float32Array(frames * BP_PITCHES);
  for (let t = 4; t < 16; t++) data[t * BP_PITCHES + 60 - 21] = 0.9;
  for (let t = 18; t < 26; t++) data[t * BP_PITCHES + 61 - 21] = 0.7;
  const notes = decodeNotes({ frames, data }, { frames, data: new Float32Array(data.length) });
  assert.deepEqual(
    notes.map(({ midi, start, dur }) => [midi, start, start + dur]),
    [[60, frameToSeconds(4), frameToSeconds(16)], [61, frameToSeconds(18), frameToSeconds(26)]],
  );
});

test("onset decoding preserves an adjacent note during a brief activation gap", () => {
  const frames = 40;
  const data = new Float32Array(frames * BP_PITCHES);
  const onsets = new Float32Array(data.length);
  onsets[4 * BP_PITCHES + 60 - 21] = 0.9;
  for (let t = 4; t < 30; t++) {
    if (t < 12 || t >= 20) data[t * BP_PITCHES + 60 - 21] = 0.8;
    else data[t * BP_PITCHES + 61 - 21] = 0.7;
  }
  const notes = decodeNotes({ frames, data }, { frames, data: onsets }, { inferOnsets: false });
  assert.deepEqual(
    notes.map(({ midi, start, dur }) => [midi, start, start + dur]),
    [[60, frameToSeconds(4), frameToSeconds(30)], [61, frameToSeconds(12), frameToSeconds(20)]],
  );
});

test("decodeNotes finds a held chord in hand-built activations and joins a window seam", () => {
  const frames = 300;
  const fr = new Float32Array(frames * BP_PITCHES);
  const on = new Float32Array(frames * BP_PITCHES);
  for (const midi of [60, 64, 67]) {
    const p = midi - 21;
    on[10 * BP_PITCHES + p] = 0.9;
    // A false re-onset right on the first seam must not split the note.
    on[BP_KEPT_FRAMES * BP_PITCHES + p] = 0.8;
    for (let t = 10; t < 250; t++) fr[t * BP_PITCHES + p] = 0.8;
  }
  const notes = decodeNotes({ frames, data: fr }, { frames, data: on }, { inferOnsets: false });
  assert.deepEqual(notes.map((n) => n.midi), [60, 64, 67]);
  for (const n of notes) {
    assert.ok(Math.abs(n.start - frameToSeconds(10)) < 1e-9);
    assert.ok(n.dur > 2.5, `held ${n.dur}`);
  }
});

test("decodeNotes preserves a repeat with a release at the window seam", () => {
  const frames = 210;
  const fr = new Float32Array(frames * BP_PITCHES);
  const on = new Float32Array(fr.length);
  const pitch = 60 - 21;
  on[100 * BP_PITCHES + pitch] = 0.9;
  on[BP_KEPT_FRAMES * BP_PITCHES + pitch] = 0.9;
  for (let t = 100; t < 170; t++) {
    if (t !== BP_KEPT_FRAMES - 1) fr[t * BP_PITCHES + pitch] = 0.8;
  }
  const notes = decodeNotes({ frames, data: fr }, { frames, data: on }, { inferOnsets: false });
  assert.equal(notes.length, 2);
  assert.ok(Math.abs(notes[0].start + notes[0].dur - frameToSeconds(BP_KEPT_FRAMES - 1)) < 1e-9);
  assert.equal(notes[1].start, frameToSeconds(BP_KEPT_FRAMES));
});

test("decodeNotes preserves a model re-attack over a still-active tail at a seam", () => {
  const frames = 210;
  const data = new Float32Array(frames * BP_PITCHES);
  const onsets = new Float32Array(data.length);
  const pitch = 60 - 21;
  const attack = 100;
  const repeat = BP_KEPT_FRAMES;
  const end = 170;
  for (let frame = attack; frame < end; frame++) data[frame * BP_PITCHES + pitch] = 0.8;
  data[(repeat - 2) * BP_PITCHES + pitch] = 0.55;
  data[(repeat - 1) * BP_PITCHES + pitch] = 0.4;
  onsets[attack * BP_PITCHES + pitch] = 0.9;
  onsets[repeat * BP_PITCHES + pitch] = 0.9;
  const notes = decodeNotes({ frames, data }, { frames, data: onsets }, { inferOnsets: false });
  assert.deepEqual(notes.map(({ midi, start, dur }) => [midi, start, start + dur]), [
    [60, frameToSeconds(attack), frameToSeconds(repeat)],
    [60, frameToSeconds(repeat), frameToSeconds(end)],
  ]);
});

test("cleanPolyNotes drops a quieter octave ghost and a faint blip, and counts them", () => {
  const notes: PolyNoteEvent[] = [
    { start: 0, dur: 1, midi: 48, amplitude: 0.8 },
    { start: 0.01, dur: 0.6, midi: 60, amplitude: 0.35 },
    { start: 0.5, dur: 0.05, midi: 70, amplitude: 0.31 },
    { start: 0, dur: 1, midi: 64, amplitude: 0.75 },
  ];
  const { notes: kept, report } = cleanPolyNotes(notes);
  assert.deepEqual(kept.map((n) => n.midi), [48, 64]);
  assert.deepEqual(report, { overtones: 1, blips: 1 });
  assert.equal(cleanPolyNotes(notes, true).notes.length, 3);
});

test("cleanPolyNotes retains a separate upper attack that outlasts its bass", () => {
  const bass = { start: 0, dur: 0.8, midi: 43, amplitude: 0.8 };
  const upper = { start: 0.4, dur: 0.55, midi: 55, amplitude: 0.45 };
  const ghost = { start: 0.4, dur: 0.3, midi: 62, amplitude: 0.4 };
  assert.deepEqual(cleanPolyNotes([bass, upper, ghost]), {
    notes: [bass, upper],
    report: { overtones: 1, blips: 0 },
  });
});

test("clusterOnsets pulls a strummed attack onto one onset; suggestSplit picks two hands", () => {
  const c = clusterOnsets([
    { start: 1.0, dur: 1, midi: 60, amplitude: 1 },
    { start: 1.03, dur: 0.97, midi: 64, amplitude: 1 },
    { start: 1.2, dur: 1, midi: 67, amplitude: 1 },
  ]);
  assert.deepEqual(c.map((n) => n.start), [1.0, 1.0, 1.2]);
  assert.ok(Math.abs(c[1].dur - 1) < 1e-9);
  assert.equal(suggestSplit([{ start: 0, dur: 1, midi: 60, amplitude: 1 }, { start: 0, dur: 1, midi: 64, amplitude: 1 }]), null);
  assert.equal(
    suggestSplit([48, 52, 72, 74, 76].map((midi) => ({ start: 0, dur: 1, midi, amplitude: 1 }))),
    60,
  );
});

test("matchNotes is one-to-one within the onset window", () => {
  const m = matchNotes(
    [{ start: 0, midi: 60 }, { start: 0, midi: 64 }],
    [{ start: 0.02, midi: 60 }, { start: 0.03, midi: 60 }, { start: 0.2, midi: 64 }],
  );
  assert.equal(m.matched, 1);
  assert.ok(Math.abs(m.precision - 1 / 3) < 1e-9);
  assert.equal(m.recall, 0.5);
});

test("accuracy: synthesized C major triad (C4 E4 G4) is heard as one chord", async () => {
  const ref: SynthNote[] = [60, 64, 67].map((midi) => ({ start: 0.25, dur: 1.5, midi }));
  const { raw, clean } = await dictate(ref, 2.2);
  const m = report("C major triad", ref, raw, clean);
  assert.equal(m.recall, 1);
  assert.equal(m.precision, 1);
  assert.ok(m.meanOnsetError < 0.04);
  const draft = buildPolyDraft(raw, { ...base, bpm: 120 }, { bpm: 120, split: null });
  const chord = draft.score.notes.find((n) => n.pitches.length);
  assert.deepEqual(chord?.pitches, [60, 64, 67]);
  assert.equal(draft.twoVoices, false);
  assert.equal(draft.chords, 1);
});

test("adjacent thirty-second attacks stay separate in fast polyphonic drafts", () => {
  const raw = [
    { start: 0, dur: 0.05, midi: 72, amplitude: 0.9 },
    { start: 0.01, dur: 0.04, midi: 60, amplitude: 0.8 },
    { start: 0.05, dur: 0.05, midi: 74, amplitude: 0.9 },
  ];
  for (const layout of ["all", "melody"] as const) {
    const { score } = buildPolyDraft(raw, base, { bpm: 150, split: null, grid: 0.125, layout });
    assert.deepEqual(score.notes.map(({ pitches, dur }) => ({ pitches, dur })), [
      { pitches: layout === "all" ? [60, 72] : [72], dur: 0.125 },
      { pitches: [74], dur: 0.125 },
    ]);
  }
});

test("an early first attack does not shift the beat grid for either voice", () => {
  const raw = [
    { start: 0.45, dur: 0.3, midi: 48, amplitude: 0.9 },
    { start: 0.8, dur: 0.2, midi: 72, amplitude: 0.9 },
  ];
  const pulse: PulseGrid = {
    beatTimes: [0.5, 1, 1.5], beatQuarters: 1, downbeat: 0,
    meter: { beats: 4, beatUnit: 4 }, bpm: 120, meterConfidence: 1,
  };
  const { score } = buildPolyDraft(raw, base, { bpm: 120, split: 60, pulse });
  assert.equal(score.voice2?.[0]?.pitches[0], 48);
  assert.equal(score.notes[0].dur, 0.5);
  assert.equal(score.notes[1].pitches[0], 72);
});

test("a tracked downbeat does not insert rests before the start of the recording", () => {
  const raw = [
    { start: 0.01, dur: 0.25, midi: 48, amplitude: 0.9 },
    { start: 0.25, dur: 0.25, midi: 72, amplitude: 0.9 },
  ];
  const pulse: PulseGrid = {
    beatTimes: [-0.25, 0.25, 0.75, 1.25], beatQuarters: 1, downbeat: 2,
    meter: { beats: 4, beatUnit: 4 }, bpm: 120, meterConfidence: 1,
  };
  const { score } = buildPolyDraft(raw, base, { bpm: 120, split: 60, pulse });
  assert.equal(score.voice2?.[0]?.pitches[0], 48);
  assert.equal(score.notes[0].dur, 0.5);
  assert.equal(score.notes[1].pitches[0], 72);
});

const melody: SynthNote[] = [72, 74, 76, 77, 79, 77, 76, 74].map((midi, i) => ({ start: 0.2 + i * 0.5, dur: 0.45, midi }));
const bass: SynthNote[] = [48, 55, 53, 55].map((midi, i) => ({ start: 0.2 + i, dur: 0.95, midi }));

test("accuracy: two-voice line (melody over a bass) splits into two voices", async () => {
  const ref = [...melody, ...bass];
  const { raw, clean } = await dictate(ref, 4.6);
  const m = report("two voices", ref, raw, clean);
  assert.ok(m.recall >= 0.9, `recall ${m.recall}`);
  assert.ok(m.precision >= 0.85, `precision ${m.precision}`);
  assert.ok(m.meanOnsetError < 0.04);
  assert.ok(Math.abs(estimatePolyBpm(clean) - 120) <= 2, `bpm ${estimatePolyBpm(clean)}`);
  const split = suggestSplit(clean);
  assert.equal(split, 60);
  const draft = buildPolyDraft(raw, base, { bpm: 120, split });
  assert.equal(draft.twoVoices, true);
  assert.deepEqual(
    draft.score.notes.filter((n) => n.pitches.length).map((n) => n.pitches[0]),
    melody.map((n) => n.midi),
  );
  assert.ok(draft.score.notes.filter((n) => n.pitches.length).every((n) => n.dur === 1));
  // Sounding pitch on each half-note beat of voice 2. A held G3 may be re-attacked
  // when the melody moves (a known model limit), but the pitch line must hold.
  const at = (notes: Score["notes"], q: number) => {
    let t = 0;
    for (const n of notes) {
      if (q >= t - 1e-9 && q < t + n.dur - 1e-9) return n.pitches[0];
      t += n.dur;
    }
    return undefined;
  };
  assert.deepEqual([0, 2, 4, 6].map((q) => at(draft.score.voice2 ?? [], q)), bass.map((n) => n.midi));
  assert.deepEqual([1, 3, 5, 7].map((q) => at(draft.score.voice2 ?? [], q)), bass.map((n) => n.midi));
  assert.equal(draft.score.key, "C");
  assert.ok(draft.losses.some((l) => l.startsWith("疑似泛音")));
  assert.ok(draft.losses.includes("踏板、滑音与音色（只按听到的音高和音长记）"));
});

test("draft keeps the other voice when writing one chord layer, and reports clipped audio", () => {
  const raw: PolyNoteEvent[] = [
    { start: 0, dur: 0.5, midi: 60, amplitude: 0.8 },
    { start: 0.01, dur: 0.5, midi: 64, amplitude: 0.8 },
    { start: 0.5, dur: 0.5, midi: 62, amplitude: 0.8 },
  ];
  const withV2: Score = { ...base, voice2: [{ pitches: [48], dur: 4 }] };
  const draft = buildPolyDraft(raw, withV2, { bpm: 120, split: null, clippedSeconds: 30 });
  assert.deepEqual(draft.score.voice2, withV2.voice2);
  assert.deepEqual(draft.score.notes.map((n) => n.pitches), [[60, 64], [62]]);
  assert.ok(draft.losses.some((l) => l.includes("未听写")));
});

test("accuracy: four-part I–IV–V–I progression keeps most chord tones", async () => {
  const chords = [
    [48, 64, 67, 72],
    [53, 65, 69, 72],
    [55, 62, 67, 71],
    [48, 64, 67, 72],
  ];
  const ref: SynthNote[] = chords.flatMap((c, i) => c.map((midi) => ({ start: 0.2 + i, dur: 0.9, midi })));
  const { raw, clean } = await dictate(ref, 4.4);
  const m = report("I–IV–V–I four-part", ref, raw, clean);
  assert.ok(m.recall >= 0.8, `recall ${m.recall}`);
  assert.ok(m.precision >= 0.8, `precision ${m.precision}`);
});

test("多音：半拍以内的松键空隙并进前一个和弦，小节线上的休止保留、不吞开头休止", async () => {
  const { fillShortRests } = await import("./poly-dictation.ts");
  const c = [60, 64, 67];
  const { notes, filled } = fillShortRests(
    [
      { pitches: [], dur: 0.5 },
      { pitches: c, dur: 1.75 },
      { pitches: [], dur: 0.25 },
      { pitches: c, dur: 1.75 },
      { pitches: [], dur: 0.25 },
      { pitches: c, dur: 3.5 },
      { pitches: [], dur: 0.5 },
      { pitches: [], dur: 1 },
    ],
    4,
    0.5,
  );
  assert.equal(filled, 2);
  assert.deepEqual(notes.map((n) => [n.pitches.length, n.dur]), [[0, 0.5], [3, 2], [3, 2], [3, 3.5], [0, 0.5], [0, 1]]);
});

test("full and melody drafts retain a short rest between detected notes", () => {
  const raw: PolyNoteEvent[] = [
    { start: 0, dur: 0.25, midi: 72, amplitude: 0.8 },
    { start: 0.375, dur: 0.25, midi: 74, amplitude: 0.8 },
  ];
  for (const layout of ["all", "melody"] as const) {
    const draft = buildPolyDraft(raw, base, { bpm: 120, split: null, layout });
    assert.deepEqual(draft.score.notes.map(({ pitches, dur }) => [pitches, dur]),
      [[[72], 0.5], [[], 0.25], [[74], 0.5]]);
  }
  const reduced = buildPolyDraft(raw, base, { bpm: 120, split: null, layout: "reduced" });
  assert.deepEqual(reduced.score.notes.map(({ pitches, dur }) => [pitches, dur]),
    [[[72], 0.75], [[74], 0.5]]);
});
