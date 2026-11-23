import assert from "node:assert/strict";
import { test } from "node:test";
import { decodePcmWav } from "./decode-audio.ts";

function pcmWav(samples: number[], sampleRate = 44100, bits = 16): Uint8Array {
  const channels = 1;
  const bytesPer = bits / 8;
  const dataLen = samples.length * bytesPer;
  const out = new Uint8Array(44 + dataLen);
  const view = new DataView(out.buffer);
  const write = (at: number, text: string) => {
    for (let i = 0; i < text.length; i++) out[at + i] = text.charCodeAt(i);
  };
  write(0, "RIFF");
  view.setUint32(4, 36 + dataLen, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * bytesPer, true);
  view.setUint16(32, channels * bytesPer, true);
  view.setUint16(34, bits, true);
  write(36, "data");
  view.setUint32(40, dataLen, true);
  let at = 44;
  for (const s of samples) {
    const v = Math.max(-1, Math.min(1, s));
    if (bits === 16) {
      view.setInt16(at, Math.round(v * 32767), true);
      at += 2;
    } else {
      out[at++] = Math.round((v + 1) * 127.5);
    }
  }
  return out;
}

test("decodePcmWav 读 16 位单声道，并拒绝不是 PCM 的头", () => {
  const samples = [0, 0.5, -0.5, 1, -1];
  const wav = decodePcmWav(pcmWav(samples));
  assert.ok(wav);
  assert.equal(wav!.sampleRate, 44100);
  assert.equal(wav!.channels.length, 1);
  assert.equal(wav!.channels[0]![0], 0);
  assert.ok(Math.abs(wav!.channels[0]![1]! - 0.5) < 0.001);
  assert.ok(Math.abs(wav!.channels[0]![2]! + 0.5) < 0.001);
  assert.ok(wav!.channels[0]![3]! > 0.99);
  assert.ok(wav!.channels[0]![4]! < -0.99);
  assert.equal(decodePcmWav(new Uint8Array([1, 2, 3, 4])), null);
  const bad = pcmWav(samples);
  bad[20] = 99; // not PCM
  assert.equal(decodePcmWav(bad), null);
});

test("decodePcmWav 能读自编 C–G–F 合成和弦", () => {
  const sampleRate = 44100;
  const chords = [[262, 330, 392], [196, 247, 294], [175, 220, 262]];
  const samples = Array.from({ length: sampleRate * 6.3 }, (_, index) => {
    const chord = chords[Math.floor(index / (sampleRate * 2.1))];
    return chord.reduce((sum, hz) => sum + 0.2 * Math.sin(2 * Math.PI * hz * index / sampleRate), 0);
  });
  const bytes = pcmWav(samples, sampleRate);
  const wav = decodePcmWav(bytes);
  assert.ok(wav);
  assert.equal(wav!.sampleRate, 44100);
  assert.equal(wav!.channels.length, 1);
  assert.ok(Math.abs(wav!.channels[0]!.length / 44100 - 6.3) < 0.05);
  let peak = 0;
  for (const n of wav!.channels[0]!) peak = Math.max(peak, Math.abs(n));
  assert.ok(peak > 0.05);
});
