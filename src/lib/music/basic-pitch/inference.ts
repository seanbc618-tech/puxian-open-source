/*
 * Windowed inference adapted from Spotify basic-pitch-ts (src/inference.ts, v1.0.1).
 * Copyright 2022 Spotify AB. Licensed under the Apache License, Version 2.0.
 * Full notice: public/third-party/basic-pitch-LICENSE.txt
 *
 * Changes by 谱线: takes tfjs-core and an already loaded GraphModel so the
 * worker and node tests share it; windows are cut in JS; every tensor is
 * disposed; output stays as flat Float32Array; supports cancellation.
 */
import type * as tfc from "@tensorflow/tfjs-core";
import {
  BP_HOP_SAMPLES,
  BP_KEPT_FRAMES,
  BP_OVERLAP_FRAMES,
  BP_OVERLAP_SAMPLES,
  BP_PITCHES,
  BP_WINDOW_FRAMES,
  BP_WINDOW_SAMPLES,
  framesForSamples,
  type Activation,
} from "./notes.ts";

type Tf = typeof tfc;
type Executable = {
  execute: (inputs: tfc.Tensor, outputs: string[]) => tfc.Tensor | tfc.Tensor[];
};

/** Output node names in the converted graph (frames, onsets). */
const FRAMES = "Identity_1";
const ONSETS = "Identity_2";

export function windowCount(samples: number): number {
  return Math.max(1, Math.ceil(framesForSamples(samples) / BP_KEPT_FRAMES));
}

/**
 * Run the model over mono 22.05 kHz audio.
 * `onProgress` gets 0..1 after each batch; `cancelled` is polled between batches.
 * `batch` windows go through the model per call: on a GPU that saves a round trip
 * per window, on the CPU it changes nothing. Output is identical for any batch size.
 */
export async function runBasicPitch(
  tf: Tf,
  model: Executable,
  audio: Float32Array,
  onProgress?: (done: number) => void,
  cancelled?: () => boolean,
  batch = 1,
): Promise<{ frames: Activation; onsets: Activation }> {
  const nOut = framesForSamples(audio.length);
  const windows = windowCount(audio.length);
  const frames = new Float32Array(windows * BP_KEPT_FRAMES * BP_PITCHES);
  const onsets = new Float32Array(windows * BP_KEPT_FRAMES * BP_PITCHES);
  const half = BP_OVERLAP_SAMPLES / 2;
  const cut = BP_OVERLAP_FRAMES / 2;
  const size = Math.max(1, Math.min(8, Math.floor(batch)));
  for (let w0 = 0; w0 < windows; w0 += size) {
    if (cancelled?.()) throw new Error("cancelled");
    const count = Math.min(size, windows - w0);
    const chunk = new Float32Array(count * BP_WINDOW_SAMPLES);
    for (let b = 0; b < count; b++) {
      // Window w starts at sample w*hop of the signal padded with `half` zeros.
      const from = (w0 + b) * BP_HOP_SAMPLES - half;
      const offset = b * BP_WINDOW_SAMPLES;
      for (let i = 0; i < BP_WINDOW_SAMPLES; i++) {
        const s = from + i;
        if (s >= 0 && s < audio.length) chunk[offset + i] = audio[s];
      }
    }
    const input = tf.tensor3d(chunk, [count, BP_WINDOW_SAMPLES, 1]);
    let outs: tfc.Tensor[] = [];
    try {
      outs = model.execute(input, [FRAMES, ONSETS]) as tfc.Tensor[];
      const [f, o] = await Promise.all([outs[0].data(), outs[1].data()]);
      for (let b = 0; b < count; b++) {
        const base = b * BP_WINDOW_FRAMES * BP_PITCHES;
        const rowFrom = base + cut * BP_PITCHES;
        const rowTo = base + (BP_WINDOW_FRAMES - cut) * BP_PITCHES;
        const at = (w0 + b) * BP_KEPT_FRAMES * BP_PITCHES;
        frames.set((f as Float32Array).subarray(rowFrom, rowTo), at);
        onsets.set((o as Float32Array).subarray(rowFrom, rowTo), at);
      }
    } finally {
      input.dispose();
      for (const t of outs) t.dispose();
    }
    onProgress?.((w0 + count) / windows);
    // Yield so a cancel message can arrive between batches.
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  const n = Math.min(nOut, windows * BP_KEPT_FRAMES);
  return {
    frames: { frames: n, data: frames.subarray(0, n * BP_PITCHES) },
    onsets: { frames: n, data: onsets.subarray(0, n * BP_PITCHES) },
  };
}
