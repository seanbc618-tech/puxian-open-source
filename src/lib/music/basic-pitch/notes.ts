/*
 * Note decoding adapted from Spotify basic-pitch-ts (src/toMidi.ts, v1.0.1).
 * Copyright 2022 Spotify AB. Licensed under the Apache License, Version 2.0.
 * Full notice: public/third-party/basic-pitch-LICENSE.txt
 *
 * Changes by 谱线: flat Float32Array matrices instead of nested arrays; the
 * "melodia" pass walks energy cells in descending order once instead of
 * rescanning for the global maximum (same result, linear-log time); exact
 * per-window frame timing; no MIDI writer or pitch bends.
 */

/** Model constants from basic_pitch/constants.py. */
export const BP_SAMPLE_RATE = 22050;
export const BP_FFT_HOP = 256;
export const BP_WINDOW_SAMPLES = BP_SAMPLE_RATE * 2 - BP_FFT_HOP; // 43844
export const BP_OVERLAP_FRAMES = 30;
export const BP_OVERLAP_SAMPLES = BP_OVERLAP_FRAMES * BP_FFT_HOP; // 7680
export const BP_HOP_SAMPLES = BP_WINDOW_SAMPLES - BP_OVERLAP_SAMPLES; // 36164
export const BP_WINDOW_FRAMES = 172;
/** Frames kept from each window after half the overlap is cut from both ends. */
export const BP_KEPT_FRAMES = BP_WINDOW_FRAMES - BP_OVERLAP_FRAMES; // 142
export const BP_PITCHES = 88;
export const BP_MIDI_OFFSET = 21;

/** Row-major (frames × 88) activation matrix. */
export type Activation = { frames: number; data: Float32Array };

export type PolyNoteEvent = {
  /** Seconds from the start of the analyzed audio. */
  start: number;
  dur: number;
  midi: number;
  /** Mean frame activation in [0,1]; a salience, not a probability. */
  amplitude: number;
};

export type DecodeOptions = {
  onsetThreshold?: number;
  frameThreshold?: number;
  /** Minimum note length in model frames (~11.6 ms each). */
  minNoteFrames?: number;
  inferOnsets?: boolean;
  melodiaTrick?: boolean;
  energyTolerance?: number;
  minMidi?: number;
  maxMidi?: number;
};

/** Seconds for a model frame index in the concatenated (unwrapped) output. */
export function frameToSeconds(frame: number): number {
  const window = Math.floor(frame / BP_KEPT_FRAMES);
  const local = frame - window * BP_KEPT_FRAMES;
  return (window * BP_HOP_SAMPLES + local * BP_FFT_HOP) / BP_SAMPLE_RATE;
}

/** Count frame starts inside the audio using the same window clock as frameToSeconds. */
export function framesForSamples(samples: number): number {
  const windows = Math.floor(samples / BP_HOP_SAMPLES);
  const remaining = samples - windows * BP_HOP_SAMPLES;
  return windows * BP_KEPT_FRAMES + Math.ceil(remaining / BP_FFT_HOP);
}

function inferredOnsets(onsets: Activation, frames: Activation, nDiff = 2): Float32Array {
  const n = frames.frames;
  const P = BP_PITCHES;
  const diff = new Float32Array(n * P);
  let diffMax = 0;
  let onsetMax = 0;
  for (let i = 0; i < onsets.data.length; i++) if (onsets.data[i] > onsetMax) onsetMax = onsets.data[i];
  for (let t = nDiff; t < n; t++) {
    for (let p = 0; p < P; p++) {
      const here = frames.data[t * P + p];
      let m = Infinity;
      for (let k = 1; k <= nDiff; k++) {
        const prev = t - k >= 0 ? frames.data[(t - k) * P + p] : 0;
        m = Math.min(m, here - prev);
      }
      const v = Math.max(0, m);
      diff[t * P + p] = v;
      if (v > diffMax) diffMax = v;
    }
  }
  const out = new Float32Array(n * P);
  const scale = diffMax > 0 ? onsetMax / diffMax : 0;
  for (let i = 0; i < out.length; i++) out[i] = Math.max(onsets.data[i], diff[i] * scale);
  return out;
}

type FrameEvent = { startFrame: number; frames: number; midi: number; amplitude: number };

/**
 * Windows are stitched every 142 frames. A held note can pick up a false
 * re-onset right at a seam (the frame-difference onset sees the stitch); join a
 * note that starts within two frames of a seam to the same pitch ending there
 * if the original activation shows no release between those notes. A model
 * onset after a falling envelope can mark a re-attack even above threshold.
 */
function mergeSeams(
  events: FrameEvent[],
  frames: Float32Array,
  onsets: Float32Array,
  frameThreshold: number,
  onsetThreshold: number,
): FrameEvent[] {
  const sorted = [...events].sort((a, b) => a.midi - b.midi || a.startFrame - b.startFrame);
  const out: FrameEvent[] = [];
  for (const e of sorted) {
    const prev = out.at(-1);
    const seam = Math.round(e.startFrame / BP_KEPT_FRAMES) * BP_KEPT_FRAMES;
    const pitch = e.midi - BP_MIDI_OFFSET;
    const cell = e.startFrame * BP_PITCHES + pitch;
    const before = frames[cell - BP_PITCHES];
    const earlier = frames[cell - 2 * BP_PITCHES];
    const renewedAttack = onsets[cell] > onsetThreshold &&
      before < earlier && frames[cell] > before;
    if (
      prev &&
      prev.midi === e.midi &&
      seam > 0 &&
      Math.abs(e.startFrame - seam) <= 2 &&
      Math.abs(prev.startFrame + prev.frames - e.startFrame) <= 2 &&
      earlier >= frameThreshold &&
      before >= frameThreshold &&
      !renewedAttack
    ) {
      const end = Math.max(prev.startFrame + prev.frames, e.startFrame + e.frames);
      prev.amplitude = (prev.amplitude * prev.frames + e.amplitude * e.frames) / (prev.frames + e.frames);
      prev.frames = end - prev.startFrame;
      continue;
    }
    out.push({ ...e });
  }
  return out;
}

/** Polyphonic note events from frame and onset activations (basic-pitch defaults). */
export function decodeNotes(frames: Activation, onsets: Activation, options: DecodeOptions = {}): PolyNoteEvent[] {
  const onsetThresh = options.onsetThreshold ?? 0.5;
  const frameThresh = options.frameThreshold ?? 0.3;
  const minLen = options.minNoteFrames ?? 5;
  const tolerance = options.energyTolerance ?? 11;
  const n = frames.frames;
  const P = BP_PITCHES;
  if (n < 2 || onsets.frames !== n) return [];
  const lo = Math.max(0, (options.minMidi ?? BP_MIDI_OFFSET) - BP_MIDI_OFFSET);
  const hi = Math.min(P - 1, (options.maxMidi ?? BP_MIDI_OFFSET + P - 1) - BP_MIDI_OFFSET);
  const frameData = new Float32Array(frames.data);
  const onsetData = new Float32Array(onsets.data);
  for (let t = 0; t < n; t++) {
    for (let p = 0; p < P; p++) {
      if (p < lo || p > hi) {
        frameData[t * P + p] = 0;
        onsetData[t * P + p] = 0;
      }
    }
  }
  const fr: Activation = { frames: n, data: frameData };
  const on = options.inferOnsets === false ? onsetData : inferredOnsets({ frames: n, data: onsetData }, fr);
  const at = (t: number, p: number) => on[t * P + p];
  // Local maxima over time (scipy argrelmax, order 1) above the onset threshold.
  const starts: [number, number][] = [];
  for (let p = 0; p < P; p++) {
    for (let t = 0; t < n; t++) {
      const v = at(t, p);
      if (!(v > onsetThresh)) continue;
      if (t > 0 && !(v > at(t - 1, p))) continue;
      if (t < n - 1 && !(v > at(t + 1, p))) continue;
      starts.push([t, p]);
    }
  }
  // numpy where() order is (time, pitch); the reference walks it in reverse.
  starts.sort((a, b) => b[0] - a[0] || b[1] - a[1]);
  const energy = new Float32Array(frameData);
  const clearBand = (t: number, p: number) => {
    energy[t * P + p] = 0;
    if (p < P - 1) energy[t * P + p + 1] = 0;
    if (p > 0) energy[t * P + p - 1] = 0;
  };
  const meanAmp = (from: number, to: number, p: number) => {
    let s = 0;
    for (let t = from; t < to; t++) s += frameData[t * P + p];
    return to > from ? s / (to - from) : 0;
  };
  const out: FrameEvent[] = [];
  for (const [t0, p] of starts) {
    let i = t0 + 1;
    let k = 0;
    while (i < n && k < tolerance) {
      if (energy[i * P + p] < frameThresh) k++;
      else k = 0;
      i++;
    }
    i -= k;
    if (i - t0 <= minLen) continue;
    for (let j = t0; j < i; j++) {
      if (energy[j * P + p] >= frameThresh) clearBand(j, p);
      else energy[j * P + p] = 0;
    }
    out.push({ startFrame: t0, frames: i - t0, midi: p + BP_MIDI_OFFSET, amplitude: meanAmp(t0, i, p) });
  }
  if (options.melodiaTrick !== false) {
    // Visiting cells from loudest to quietest and skipping cleared ones is the
    // same as repeatedly taking the global maximum: clearing never raises a cell.
    const order: number[] = [];
    for (let i = 0; i < energy.length; i++) if (energy[i] > frameThresh) order.push(i);
    order.sort((a, b) => energy[b] - energy[a] || a - b);
    for (const cell of order) {
      if (!(energy[cell] > frameThresh)) continue;
      const mid = Math.floor(cell / P);
      const p = cell % P;
      let i = mid + 1;
      let k = 0;
      while (i < n && k < tolerance) {
        if (energy[i * P + p] < frameThresh) k++;
        else k = 0;
        i++;
      }
      const end = i - k; // Exclusive: trim only the trailing frames below threshold.
      i = mid - 1;
      k = 0;
      while (i >= 0 && k < tolerance) {
        if (energy[i * P + p] < frameThresh) k++;
        else k = 0;
        i--;
      }
      const begin = i + 1 + k;
      const length = end - begin;
      // Silence scanned while finding the endpoints can contain the next
      // semitone. Suppress neighbors only where this note has activation.
      for (let t = begin; t < end; t++) {
        if (length > minLen && energy[t * P + p] >= frameThresh) clearBand(t, p);
        else energy[t * P + p] = 0;
      }
      if (length <= minLen) continue;
      out.push({ startFrame: begin, frames: length, midi: p + BP_MIDI_OFFSET, amplitude: meanAmp(begin, end, p) });
    }
  }
  return mergeSeams(out, frameData, onsetData, frameThresh, onsetThresh)
    .map((e) => {
      const start = frameToSeconds(e.startFrame);
      return { start, dur: frameToSeconds(e.startFrame + e.frames) - start, midi: e.midi, amplitude: e.amplitude };
    })
    .sort((a, b) => a.start - b.start || a.midi - b.midi);
}
