import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { importGp5, MAX_GP5_BYTES, mapGp5 } from "./gp5-import.ts";
import { importer, model } from "@coderline/alphatab";
const bytes = new Uint8Array(readFileSync(new URL("./fixtures/gp5/original-study.gp5", import.meta.url)));
test("original CC0 GP5 preserves rhythm, chords, independent voices and mapped techniques", () => {
  const result = importGp5(bytes);
  assert.equal(result.score.title, "Puxian original GP5 study");
  assert.equal(result.score.bpm, 96);
  assert.deepEqual(result.score.notes.map(n => [n.pitches, n.dur]), [[[59,64],1.5],[[66],0.5],[[],2]]);
  assert.deepEqual(result.score.voice2?.map(n => [n.pitches, n.dur]), [[[40],4]]);
  assert.equal(result.score.notes[0]?.ornament, "arpeggio");
  assert.equal(result.score.notes[0]?.slurStart, true);
  assert.equal(result.score.notes[1]?.slurEnd, true);
  assert.ok(result.losses.some(l => l.includes("扫弦")));
  assert.ok(result.losses.some(l => l.includes("击弦")));
});
test("wrong format, empty, oversized and truncated files fail without a score", () => {
  for (const bad of [new Uint8Array(), new TextEncoder().encode("not a gp5"), new Uint8Array(MAX_GP5_BYTES+1), bytes.slice(0,32), bytes.slice(0,bytes.length-12)]) {
    assert.throws(() => importGp5(bad));
  }
});
test("adapter reports skipped tracks, repeat structure and unsupported guitar effects", () => {
  const source = importer.ScoreLoader.loadScoreFromBytes(bytes);
  source.masterBars[0]!.isRepeatStart = true;
  const note = source.tracks[0]!.staves[0]!.bars[0]!.voices[0]!.beats[0]!.notes[0]!;
  note.isPalmMute = true;
  const percussion = new model.Track(); percussion.ensureStaveCount(1); percussion.staves[0]!.isPercussion = true; source.addTrack(percussion);
  const result = mapGp5(source,"fallback");
  for (const word of ["反复", "打击乐", "制音"]) assert.ok(result.losses.some(l => l.includes(word)));
});
test("minor keys and coincident meter/tempo changes remain valid stored score", async () => {
  const { isScore } = await import("./score-storage.ts");
  const source = importer.ScoreLoader.loadScoreFromBytes(bytes);
  const bar = source.tracks[0]!.staves[0]!.bars[0]!;
  bar.keySignatureType = 1; bar.keySignature = 0;
  const next = new model.MasterBar(); next.timeSignatureNumerator = 3;
  source.addMasterBar(next);
  const tempo = new model.Automation(); tempo.value = 110; tempo.ratioPosition = 0;
  next.tempoAutomations.push(tempo);
  const result = mapGp5(source,"fallback");
  assert.equal(result.score.key,"A"); assert.equal(result.score.mode,"minor");
  assert.equal(result.score.changes?.length,1);
  assert.equal(result.score.changes?.[0]?.bpm,110);
  assert.ok(isScore(result.score));
});
test("more than two GP5 voices land in extraVoices instead of being dropped", async () => {
  const { isScore } = await import("./score-storage.ts");
  const source = importer.ScoreLoader.loadScoreFromBytes(bytes);
  const other = importer.ScoreLoader.loadScoreFromBytes(bytes);
  for (const track of other.tracks) source.addTrack(track);
  const result = mapGp5(source, "fallback");
  assert.equal(result.score.extraVoices?.length, 2);
  assert.deepEqual(result.score.extraVoices?.[1]?.map(n => [n.pitches, n.dur]), [[[40],4]]);
  assert.ok(!result.losses.some(l => l.includes("最多保留")));
  assert.ok(isScore(result.score));
});
