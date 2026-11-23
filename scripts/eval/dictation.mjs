import { readFileSync, writeFileSync, appendFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { JSDOM } from "jsdom";
import { browserSession, save, output, events, compare } from "./common.mjs";
import { scoreToMidi } from "../../src/lib/music/midi.ts";
import { musicXmlToScore } from "../../src/lib/music/musicxml.ts";
import { readMidi, synthesize } from "../../eval/synthesis.mjs";
globalThis.DOMParser = new JSDOM("").window.DOMParser;
const manifest = JSON.parse(readFileSync("eval/manifest.json", "utf8"));
const sources = manifest.items.slice(0, 4).map((item) => ({
  id: item.id,
  score: musicXmlToScore(readFileSync(item.truth, "utf8"), item.id).score,
  ends: item.ends,
}));
for (const [id, pitches] of [
  ["scale", [60, 62, 64, 65, 67, 69, 71, 72, 72, 71, 69, 67, 65, 64, 62, 60]],
  ["twinkle", [60, 60, 67, 67, 69, 69, 67, 67, 65, 65, 64, 64, 62, 62, 60, 60]],
])
  sources.push({
    id,
    ends: [4, 8, 12, 16],
    score: {
      title: id,
      bpm: 120,
      beats: 4,
      beatUnit: 4,
      key: "C",
      mode: "major",
      clef: "treble",
      tonicOctave: 4,
      notes: pitches.map((p) => ({ pitches: [p], dur: 1 })),
      changes: [],
    },
  });
mkdirSync(output, { recursive: true });
writeFileSync(resolve(output, "dictation.jsonl"), "");
const rows = [];
// A failed rerun must not look like the previous successful suite.
save("dictation-results.json", []);
const { page, close } = await browserSession();
try {
  for (const { id, score, ends } of sources) {
    const melody = {
      ...score,
      voice2: undefined,
      extraVoices: undefined,
      notes: score.notes.map((n) => ({
        ...n,
        pitches: n.pitches.length ? [Math.max(...n.pitches)] : [],
      })),
    };
    const midi = scoreToMidi(melody);
    writeFileSync(`eval/generated/audio-${id}.mid`, midi);
    const known = readMidi(midi),
      quarter = known.quarter;
    const truth = known.notes.map(({ pitch, start, dur }) => ({ pitch, start, dur }));
    for (const variant of ["clean", "noise", "accompaniment-reverb", "phone"]) {
      const wav = synthesize(truth, ends.at(-1) * quarter, variant);
      const path = `eval/generated/audio-${id}-${variant}.wav`;
      writeFileSync(path, wav);
      const raw = await page.evaluate(async (base64) => {
        const { transcribeBuffer, estimateBpm, quantizeDetected } =
          await import("/src/lib/music/audio.ts");
        const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
        const ctx = new AudioContext();
        try {
          const start = performance.now();
          const buffer = await ctx.decodeAudioData(bytes.buffer);
          const take = transcribeBuffer(buffer, buffer.sampleRate);
          const bpm = estimateBpm(take.notes);
          return {
            take,
            bpm,
            // Official usable acceptance grid is 0.25 (sixteenth).
            // Product UI default grid remains 0.5 (eighths). Do not use this
            // script to regenerate official seed audio; use the frozen-byte runner.
            quantized: quantizeDetected(take.notes, bpm, 0.25),
            seconds: (performance.now() - start) / 1000,
            sampleRate: buffer.sampleRate,
          };
        } finally {
          await ctx.close();
        }
      }, wav.toString("base64"));
      const predicted = raw.take.notes.map((n) => ({ pitch: n.midi, start: n.start, dur: n.dur }));
      const quantized = events({ notes: raw.quantized });
      const row = {
        id,
        variant,
        path,
        sha256: createHash("sha256").update(wav).digest("hex"),
        midiSha256: createHash("sha256").update(midi).digest("hex"),
        truth,
        quarter,
        ends,
        ...raw,
        draft: raw.take.notes.length > 0,
        metrics: compare(
          truth,
          predicted,
          ends.map((e) => e * quarter),
          0.08,
          0.12,
        ),
        draftMetrics: compare(
          truth.map((n) => ({ pitch: n.pitch, start: n.start / quarter, dur: n.dur / quarter })),
          quantized,
          ends,
          0.05,
          0.05,
        ),
      };
      if (!row.draft)
        for (const metrics of [row.metrics, row.draftMetrics])
          metrics.bars.forEach((b) => {
            b.strict = false;
            b.usable = false;
          });
      rows.push(row);
      appendFileSync(resolve(output, "dictation.jsonl"), JSON.stringify(row) + "\n");
      console.log(
        id,
        variant,
        JSON.stringify({
          bpm: raw.bpm,
          seconds: raw.seconds,
          notes: predicted.length,
          usable: row.draftMetrics.bars.filter((b) => b.usable).length,
          bars: ends.length,
        }),
      );
    }
  }
  save("dictation-results.json", rows);
  save("dictation-environment.json", {
    date: new Date().toISOString(),
    node: process.version,
    seed: 20261114,
    mode: "official usable monophonic upload: decodeAudioData → transcribeBuffer → estimateBpm → quantizeDetected(grid .25). Product UI default grid remains 0.5.",
    rate: 22050,
    cases: rows.length,
  });
} finally {
  await close();
}
