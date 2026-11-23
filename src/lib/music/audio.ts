import type { ScoreNote } from "./theory.ts";

export type DetectedNote = {
  start: number;
  dur: number;
  midi: number;
  /** Heuristic stability score in [0,1], not a calibrated probability. */
  confidence?: number;
  /** True when this onset was split from a same-pitch re-attack; do not merge it back. */
  reattack?: boolean;
};

/** Notes below this stability score are drawn faded in the dictation preview. */
export const LOW_PITCH_CONFIDENCE = 0.65;

export function isLowPitchConfidence(note: DetectedNote): boolean {
  return (note.confidence ?? 1) < LOW_PITCH_CONFIDENCE;
}

/** Mid-interval spread plus short duration lower the heuristic; not a calibrated posterior. */
export function pitchConfidence(midis: number[], duration: number): number {
  if (!midis.length) return 0;
  const values = [...midis].sort((a, b) => a - b);
  const center = values[Math.floor(values.length / 2)];
  const spread = values.reduce((sum, value) => sum + Math.abs(value - center), 0) / values.length;
  return Math.max(0, Math.min(1, (1 - Math.min(1, spread / 0.75)) * Math.min(1, duration / 0.2)));
}

export type MelodyKind = "dry" | "accompanied";

export type MelodyTake = {
  notes: DetectedNote[];
  /** Duration actually inspected, including silent or unclear passages. */
  analyzedSeconds?: number;
  kind: MelodyKind;
  /** Shown when the upload is not a single dry line. */
  notice: string | null;
};

type ChannelBuffer = {
  length: number;
  numberOfChannels: number;
  getChannelData: (channel: number) => Float32Array;
};

const ANALYSIS_RATE = 16000;
const ACCOMPANIMENT_NOTICE = "这段有伴奏，只记下了较突出的单音旋律，没有拆开和弦。";
const ACCOMPANIMENT_UNCLEAR_NOTICE = "伴奏盖过了旋律，听不出稳定的单音。请哼一段，或改用 MIDI。";

export function mixToMono(buffer: ChannelBuffer, sampleRate: number, maxSeconds = Infinity): Float32Array {
  const capped = Math.min(buffer.length, Math.floor(sampleRate * maxSeconds));
  const out = new Float32Array(capped);
  const channels = buffer.numberOfChannels;
  for (let channel = 0; channel < channels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < capped; i += 1) out[i] += data[i] / channels;
  }
  let peak = 0;
  for (let i = 0; i < out.length; i += 1) peak = Math.max(peak, Math.abs(out[i]));
  if (peak > 0.0001) {
    const gain = 0.95 / peak;
    for (let i = 0; i < out.length; i += 1) out[i] *= gain;
  }
  return out;
}

function downsample(input: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return input;
  const ratio = from / to;
  const length = Math.floor(input.length / ratio);
  const out = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    let count = 0;
    for (let j = start; j < end; j += 1) {
      sum += input[j];
      count += 1;
    }
    out[i] = count ? sum / count : 0;
  }
  return out;
}

function peakNormalize(input: Float32Array): Float32Array {
  let peak = 0;
  for (let i = 0; i < input.length; i += 1) peak = Math.max(peak, Math.abs(input[i]));
  if (peak < 1e-5) return input;
  const gain = 0.95 / peak;
  const out = new Float32Array(input.length);
  for (let i = 0; i < input.length; i += 1) out[i] = input[i] * gain;
  return out;
}

function rms(input: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < input.length; i += 1) sum += input[i] * input[i];
  return Math.sqrt(sum / Math.max(1, input.length));
}

/** One-pole high-pass. Used to soften bass under a melody, not to remove the voice. */
function highpass(input: Float32Array, sampleRate: number, cutoff: number): Float32Array {
  const out = new Float32Array(input.length);
  const rc = 1 / (2 * Math.PI * cutoff);
  const a = rc / (rc + 1 / sampleRate);
  let y = 0;
  let prev = 0;
  for (let i = 0; i < input.length; i += 1) {
    const x = input[i];
    y = a * (y + x - prev);
    prev = x;
    out[i] = y;
  }
  return out;
}

function preEmphasis(input: Float32Array, coef: number): Float32Array {
  const out = new Float32Array(input.length);
  let prev = 0;
  for (let i = 0; i < input.length; i += 1) {
    const x = input[i];
    out[i] = x - coef * prev;
    prev = x;
  }
  return out;
}

/**
 * Tilt the spectrum toward the melody: cut low accompaniment and lift harmonics.
 * A dry voice does not need this; the caller keeps the raw signal in that case.
 */
function emphasizeMelody(input: Float32Array, sampleRate: number): Float32Array {
  return preEmphasis(highpass(input, sampleRate, 120), 0.97);
}

function bassShare(input: Float32Array, sampleRate: number): number {
  const rc = 1 / (2 * Math.PI * 140);
  const alpha = 1 / (1 + rc * sampleRate);
  let y = 0;
  let low = 0;
  let all = 0;
  for (let i = 0; i < input.length; i += 1) {
    y += alpha * (input[i] - y);
    low += y * y;
    all += input[i] * input[i];
  }
  if (all < 1e-8) return 0;
  return Math.sqrt(low / all);
}

function yin(buf: Float32Array, sampleRate: number, threshold = 0.15, minHz = 75): number | null {
  const size = buf.length;
  const tauMin = Math.max(2, Math.floor(sampleRate / 1100));
  const tauMax = Math.min(size - 2, Math.floor(sampleRate / minHz));
  if (tauMax <= tauMin + 2) return null;
  const diff = new Float32Array(tauMax + 1);
  // CMND needs every lag in its cumulative denominator, including below tauMin.
  for (let tau = 1; tau <= tauMax; tau += 1) {
    let sum = 0;
    const limit = size - tau;
    for (let i = 0; i < limit; i += 1) {
      const delta = buf[i] - buf[i + tau];
      sum += delta * delta;
    }
    diff[tau] = sum;
  }
  const cmnd = new Float32Array(tauMax + 1);
  let running = 0;
  for (let tau = 1; tau <= tauMax; tau += 1) {
    running += diff[tau];
    cmnd[tau] = running > 0 ? (diff[tau] * tau) / running : 1;
  }
  let estimate = -1;
  for (let tau = tauMin; tau <= tauMax; tau += 1) {
    // Keep the corrected denominator conservative on dense accompaniment.
    if (cmnd[tau] < threshold) {
      while (tau + 1 <= tauMax && cmnd[tau + 1] < cmnd[tau]) tau += 1;
      estimate = tau;
      break;
    }
  }
  if (estimate < 0) return null;
  const prev = cmnd[estimate - 1] ?? cmnd[estimate];
  const curr = cmnd[estimate];
  const next = cmnd[estimate + 1] ?? cmnd[estimate];
  const denom = prev - 2 * curr + next;
  const shift = denom === 0 ? 0 : (prev - next) / (2 * denom);
  const freq = sampleRate / (estimate + shift);
  if (!Number.isFinite(freq) || freq < minHz - 5 || freq > 1200) return null;
  return freq;
}

/**
 * Follow a moving melody when several periods fit the same frame.
 * Plain YIN takes the first (often lowest) dip; a mid-range line over a
 * bass pad then locks to the chord root. If a recent melody pitch is known
 * and the first dip sits well below it, keep a nearby mid-range dip even
 * when its CMND is a little weaker. Without that context, this matches yin().
 */
function yinFollow(
  buf: Float32Array,
  sampleRate: number,
  threshold = 0.15,
  minHz = 75,
  preferMidi: number | null = null,
): number | null {
  const size = buf.length;
  const tauMin = Math.max(2, Math.floor(sampleRate / 1100));
  const tauMax = Math.min(size - 2, Math.floor(sampleRate / minHz));
  if (tauMax <= tauMin + 2) return null;
  const diff = new Float32Array(tauMax + 1);
  for (let tau = 1; tau <= tauMax; tau += 1) {
    let sum = 0;
    const limit = size - tau;
    for (let i = 0; i < limit; i += 1) {
      const delta = buf[i] - buf[i + tau];
      sum += delta * delta;
    }
    diff[tau] = sum;
  }
  const cmnd = new Float32Array(tauMax + 1);
  let running = 0;
  for (let tau = 1; tau <= tauMax; tau += 1) {
    running += diff[tau];
    cmnd[tau] = running > 0 ? (diff[tau] * tau) / running : 1;
  }

  const interpolate = (tau: number): number | null => {
    const prev = cmnd[tau - 1] ?? cmnd[tau];
    const curr = cmnd[tau];
    const next = cmnd[tau + 1] ?? cmnd[tau];
    const denom = prev - 2 * curr + next;
    const shift = denom === 0 ? 0 : (prev - next) / (2 * denom);
    const freq = sampleRate / (tau + shift);
    if (!Number.isFinite(freq) || freq < minHz - 5 || freq > 1200) return null;
    return freq;
  };

  let estimate = -1;
  for (let tau = tauMin; tau <= tauMax; tau += 1) {
    if (cmnd[tau] < threshold) {
      while (tau + 1 <= tauMax && cmnd[tau + 1] < cmnd[tau]) tau += 1;
      estimate = tau;
      break;
    }
  }

  if (preferMidi != null && Number.isFinite(preferMidi) && estimate > 0) {
    const lockedMidi = hzToMidi(sampleRate / estimate);
    if (lockedMidi <= preferMidi - 9) {
      const loose = Math.max(threshold + 0.12, 0.28);
      let bestTau = -1;
      let bestDist = Infinity;
      let bestCmnd = Infinity;
      for (let tau = tauMin; tau <= tauMax; tau += 1) {
        if (cmnd[tau] > loose) continue;
        if (cmnd[tau] > (cmnd[tau - 1] ?? 1) || cmnd[tau] > (cmnd[tau + 1] ?? 1)) continue;
        const midi = hzToMidi(sampleRate / tau);
        const dist = Math.abs(midi - preferMidi);
        if (dist > 12.5 || midi <= lockedMidi + 3) continue;
        if (dist < bestDist - 0.2 || (Math.abs(dist - bestDist) <= 0.2 && cmnd[tau] < bestCmnd)) {
          bestTau = tau;
          bestDist = dist;
          bestCmnd = cmnd[tau];
        }
      }
      if (bestTau > 0) {
        const freq = interpolate(bestTau);
        if (freq != null) return freq;
      }
    }
  }

  if (estimate < 0) return null;
  return interpolate(estimate);
}

function relativeEnvelope(values: number[], hopSec: number, seconds = 0.22): number[] {
  const alpha = 1 - Math.exp(-hopSec / Math.max(0.05, seconds));
  const out: number[] = [];
  let slow = values[0] ?? 0;
  for (let i = 0; i < values.length; i += 1) {
    const energy = values[i] ?? 0;
    slow += alpha * (energy - slow);
    out.push(energy / Math.max(slow, 1e-6));
  }
  return out;
}

/** Place the onset at the energy rise, not at the start of the first pitched frame. */
function refineAttackTime(
  rmsValues: number[],
  hopSec: number,
  roughStart: number,
  roughEnd: number,
  notBefore: number,
): number {
  if (!(hopSec > 0) || !rmsValues.length) return roughStart;
  const dur = roughEnd - roughStart;
  if (!(dur > 0.05)) return roughStart;
  const peakFrom = Math.max(0, Math.floor(roughStart / hopSec));
  const peakTo = Math.min(rmsValues.length - 1, Math.floor((roughStart + Math.min(0.1, dur * 0.5)) / hopSec));
  let peak = 0;
  for (let i = peakFrom; i <= peakTo; i += 1) peak = Math.max(peak, rmsValues[i] ?? 0);
  if (peak < 1e-6) return Math.max(notBefore, roughStart);
  const searchFrom = Math.max(0, Math.floor(Math.max(notBefore, roughStart - 0.06) / hopSec));
  const searchTo = Math.min(rmsValues.length - 1, Math.max(peakFrom, Math.floor((roughStart + 0.04) / hopSec)));
  const low = peak * 0.28;
  const high = peak * 0.55;
  let below = -1;
  for (let i = searchFrom; i <= searchTo; i += 1) {
    if ((rmsValues[i] ?? 0) < low) below = i;
  }
  if (below < 0) return Math.max(notBefore, roughStart);
  let rise = below;
  for (let i = below; i <= Math.min(rmsValues.length - 1, searchTo + 4); i += 1) {
    if ((rmsValues[i] ?? 0) >= high) {
      rise = i;
      break;
    }
  }
  const before = rmsValues[Math.max(0, rise - 1)] ?? 0;
  const at = rmsValues[rise] ?? 0;
  const frac = at > before ? Math.min(1, Math.max(0, (high - before) / (at - before))) : 0;
  const refined = (Math.max(0, rise - 1) + frac) * hopSec;
  const lo = Math.max(notBefore, roughStart - 0.05);
  const hi = Math.min(roughEnd - 0.04, roughStart + 0.06);
  return Math.min(hi, Math.max(lo, refined));
}

/** Ignore a brief drop into the bass when recalling the current melody pitch. */
function recentMelodyMidi(frames: Array<number | null>): number | null {
  const recent: number[] = [];
  for (let k = frames.length - 1; k >= 0 && recent.length < 16; k -= 1) {
    if (frames[k] != null) recent.push(frames[k] as number);
  }
  if (!recent.length) return null;
  const peak = Math.max(...recent);
  for (const midi of recent) if (midi >= peak - 12) return midi;
  return recent[0];
}

/** Local live single-note detection, sharing the dictation YIN implementation. */
export function livePitch(samples: Float32Array, sampleRate: number): number | null {
  const frame = downsample(samples, sampleRate, ANALYSIS_RATE);
  if (rms(frame) < .008) return null;
  const hz = yin(frame, ANALYSIS_RATE, .15, 40);
  return hz == null ? null : 69 + 12 * Math.log2(hz / 440);
}

function hzToMidi(hz: number): number {
  return 69 + 12 * Math.log2(hz / 440);
}

function toAnalysisRate(samples: Float32Array, sampleRate: number): Float32Array {
  return downsample(samples, sampleRate, ANALYSIS_RATE);
}

/** How strongly a channel carries a moving line above the bass, after a high-pass. */
function melodyActivity(samples: Float32Array): number {
  const high = highpass(samples, ANALYSIS_RATE, 300);
  const frame = 512;
  const hop = 2400;
  let voiced = 0;
  let total = 0;
  for (let i = 0; i + frame <= high.length; i += hop) {
    total += 1;
    const hz = yin(high.subarray(i, i + frame), ANALYSIS_RATE);
    if (hz != null && hz >= 175 && hz <= 1100) voiced += 1;
  }
  if (!total) return 0;
  return (voiced / total) * rms(high);
}

function mixDown(channels: Float32Array[]): Float32Array {
  const length = channels.reduce((max, channel) => Math.max(max, channel.length), 0);
  const out = new Float32Array(length);
  for (const channel of channels) {
    for (let i = 0; i < channel.length; i += 1) out[i] += channel[i] / channels.length;
  }
  return out;
}

function stereoWidth(left: Float32Array, right: Float32Array): number {
  const length = Math.min(left.length, right.length);
  let mid = 0;
  let side = 0;
  for (let i = 0; i < length; i += 1) {
    const m = 0.5 * (left[i] + right[i]);
    const s = 0.5 * (left[i] - right[i]);
    mid += m * m;
    side += s * s;
  }
  if (mid < 1e-8) return 0;
  return Math.sqrt(side / mid);
}

type Prepared = { signal: Float32Array; kind: MelodyKind; vocal: boolean };

/**
 * Prefer a channel that is already one dry line. Otherwise keep the center
 * and, when bass or a lower octave is masking the tune, tilt the spectrum up.
 */
function prepareSignal(channels: Float32Array[]): Prepared {
  const mid = channels.length === 1 ? channels[0] : mixDown(channels);
  let chosen = mid;
  let fromChannel = false;
  if (channels.length > 1) {
    let bestScore = melodyActivity(mid);
    for (const channel of channels) {
      const score = melodyActivity(channel);
      if (score > bestScore * 1.2 && score > bestScore + 0.008) {
        chosen = channel;
        bestScore = score;
        fromChannel = true;
      }
    }
  }

  const emphasized = emphasizeMelody(chosen, ANALYSIS_RATE);
  const frame = 512;
  const hop = Math.max(frame, Math.floor(chosen.length / 28));
  let rawHits = 0;
  let enhHits = 0;
  let agree = 0;
  let octave = 0;
  let compared = 0;
  let rawMidiSum = 0;
  let frames = 0;
  for (let i = 0; i + frame <= chosen.length && frames < 28; i += hop) {
    frames += 1;
    const rawHz = yin(chosen.subarray(i, i + frame), ANALYSIS_RATE);
    const enhHz = yin(emphasized.subarray(i, i + frame), ANALYSIS_RATE);
    const rawMidi = rawHz == null ? null : hzToMidi(rawHz);
    const enhMidi = enhHz == null ? null : hzToMidi(enhHz);
    if (rawMidi != null) {
      rawHits += 1;
      rawMidiSum += rawMidi;
    }
    if (enhMidi != null) enhHits += 1;
    if (rawMidi != null && enhMidi != null) {
      compared += 1;
      if (Math.abs(enhMidi - rawMidi) < 1.25) agree += 1;
      else if (Math.abs(enhMidi - rawMidi - 12) < 1.1) octave += 1;
    }
  }
  const filtered = smoothVoice(chosen, ANALYSIS_RATE);
  let cleanHits = 0;
  let audibleFrames = 0;
  const energyFloor = rms(filtered) * 0.3;
  for (let i = 0; i + 768 <= filtered.length; i += hop) {
    const part = filtered.subarray(i, i + 768);
    if (rms(part) < energyFloor) continue;
    audibleFrames++;
    if (yin(part, ANALYSIS_RATE, 0.12, 60) != null) cleanHits++;
  }
  const vocal = audibleFrames >= 3 && cleanHits >= audibleFrames * 0.8;
  const bass = bassShare(chosen, ANALYSIS_RATE);
  const meanRawMidi = rawHits ? rawMidiSum / rawHits : null;
  const rawEmpty = frames === 0 || rawHits < frames * 0.35;
  const enhStrong = enhHits >= frames * 0.45;
  const octaveProblem = compared >= 4 && octave >= 3 && octave > agree;
  const tracks = !rawEmpty && compared > 0 && agree >= compared * 0.7 && !octaveProblem;
  // Bass energy alone also describes a low, breathy hum. Strong filtered
  // periodicity can rescue it when the unfiltered detector misses the voice.
  const bassMask = bass > 0.52 && !vocal && !tracks && (meanRawMidi == null || meanRawMidi >= 50);
  // Unfiltered YIN can lock to a chord root while the treble-tilted signal
  // follows a different higher line. That is accompaniment even when the
  // interval is not a clean octave and the bass share is only moderate.
  const maskedLine = enhStrong && compared >= 4 && agree * 2 < compared && !tracks;
  let kind: MelodyKind = octaveProblem || bassMask || maskedLine || (rawEmpty && enhStrong && bass > 0.45) ? "accompanied" : "dry";

  if (!fromChannel && channels.length === 2 && kind === "dry" && stereoWidth(channels[0], channels[1]) > 0.85) {
    kind = "accompanied";
  }
  // A changing bass line can dominate raw YIN while neither raw nor the
  // harmonic tilt yields a stable voice. Try a steeper fundamental-preserving
  // filter in that ambiguous case, and verify that it exposes a coherent line.
  if (kind === "dry" && !vocal && !tracks && !fromChannel && bass > 0.45) {
    let upper = chosen;
    for (let pole = 0; pole < 4; pole += 1) upper = highpass(upper, ANALYSIS_RATE, 480);
    let upperHits = 0;
    let upperMidiSum = 0;
    for (let index = 0; index < frames; index += 1) {
      const start = index * hop;
      const freq = yin(upper.subarray(start, start + frame), ANALYSIS_RATE);
      if (freq == null) continue;
      upperHits += 1;
      upperMidiSum += hzToMidi(freq);
    }
    if (upperHits >= frames * 0.6 && upperHits > rawHits &&
        (meanRawMidi == null || upperMidiSum / upperHits >= meanRawMidi + 7)) {
      return { kind: "accompanied", vocal: false, signal: upper };
    }
  }
  return {
    kind,
    vocal,
    signal: kind === "dry" ? chosen : emphasized,
  };
}

/** Same-pitch gaps this small are a missed frame, not a new attack. */
const DROPOUT_GAP = 0.021;

function bridgeDropouts(frames: Array<number | null>, audible: boolean[]): Array<number | null> {
  const out = frames.slice();
  let index = 0;
  while (index < out.length) {
    if (out[index] != null) {
      index += 1;
      continue;
    }
    const run = index;
    while (index < out.length && out[index] == null) index += 1;
    const prev = run > 0 ? out[run - 1] : null;
    const next = index < out.length ? out[index] : null;
    const length = index - run;
    // A breath goes quiet. A dropout keeps its energy and only loses the pitch.
    let held = length > 0 && length <= 3;
    for (let fill = run; held && fill < index; fill += 1) held = audible[fill] === true;
    if (held && prev != null && next != null && Math.abs(prev - next) < 0.6) {
      for (let fill = run; fill < index; fill += 1) out[fill] = (prev + next) / 2;
    }
  }
  return out;
}

function repairOctaveBlips(frames: Array<number | null>): void {
  for (let i = 1; i < frames.length - 1; i += 1) {
    const midi = frames[i];
    const prev = frames[i - 1];
    if (midi == null || prev == null) continue;
    if (Math.abs(Math.abs(midi - prev) - 12) > 0.8) continue;
    let returns = false;
    for (let k = 1; k <= 3 && i + k < frames.length; k += 1) {
      const ahead = frames[i + k];
      if (ahead != null && Math.abs(ahead - prev) < 1.2) returns = true;
    }
    if (returns) frames[i] = prev;
  }
}

function tidyDetected(notes: DetectedNote[]): DetectedNote[] {
  const sorted = notes
    .filter((note) => note.dur >= 0.04 && Number.isFinite(note.start) && Number.isFinite(note.midi))
    .map((note) => ({ ...note }))
    .sort((a, b) => a.start - b.start);
  const withoutBlips: DetectedNote[] = [];
  for (let i = 0; i < sorted.length; i += 1) {
    const note = sorted[i];
    const prev = withoutBlips[withoutBlips.length - 1];
    const next = sorted[i + 1];
    const blip =
      note.dur < 0.09 && prev != null && next != null && prev.midi === next.midi && note.midi !== prev.midi;
    if (blip) continue;
    withoutBlips.push(note);
  }
  const merged: DetectedNote[] = [];
  for (const note of withoutBlips) {
    const prev = merged[merged.length - 1];
    const gap = prev ? note.start - (prev.start + prev.dur) : Infinity;
    // Same-pitch re-attacks are marked and must stay split; ordinary dropouts may still merge.
    if (prev && prev.midi === note.midi && gap <= DROPOUT_GAP && gap > -0.02 && !note.reattack) {
      prev.dur = Math.max(prev.start + prev.dur, note.start + note.dur) - prev.start;
      prev.confidence = Math.min(prev.confidence ?? 1, note.confidence ?? 1);
      continue;
    }
    merged.push(note);
  }
  return merged;
}

function smoothVoice(input: Float32Array, rate: number): Float32Array {
  const out = new Float32Array(input.length);
  const a = 1 - Math.exp(-2 * Math.PI * 900 / rate);
  let first = 0;
  let second = 0;
  for (let i = 0; i < input.length; i++) {
    first += a * (input[i] - first);
    second += a * (first - second);
    out[i] = second;
  }
  return out;
}

/** Same-pitch re-attack: a brief energy valley then a rise, not a missed pitch frame. */
function reattackCutFrames(rmsValues: number[], startFrame: number, endFrame: number, hopSec: number): number[] {
  if (endFrame - startFrame < 8) return [];
  const minSide = Math.max(3, Math.round(0.16 / hopSec));
  const cuts: number[] = [];
  let peak = rmsValues[startFrame] ?? 0;
  let valley = peak;
  let valleyAt = startFrame;
  let falling = false;
  for (let i = startFrame + 1; i <= endFrame && i < rmsValues.length; i += 1) {
    const energy = rmsValues[i] ?? 0;
    if (falling) {
      if (energy < valley) {
        valley = energy;
        valleyAt = i;
        continue;
      }
      // Recover if energy returns near the previous peak, or clearly rises
      // out of a deep trough. Requiring both (max of 2x valley and 70% of
      // peak) misses a genuine re-attack when pad or reverb lifts the
      // valley, so 2x valley is slightly higher than the second attack.
      const recovered = energy >= peak * 0.7 || (energy >= valley * 2 && energy >= peak * 0.5);
      const deep = valley <= peak * 0.55 && peak > 1e-6;
      const left = valleyAt - (cuts.at(-1) ?? startFrame);
      const right = endFrame - valleyAt;
      let width = 1;
      const shallow = peak * 0.7;
      for (let k = valleyAt - 1; k >= startFrame && (rmsValues[k] ?? 0) < shallow; k -= 1) width += 1;
      for (let k = valleyAt + 1; k <= i && (rmsValues[k] ?? 0) < shallow; k += 1) width += 1;
      const brief = width * hopSec <= 0.08;
      if (deep && recovered && brief && left >= minSide && right >= minSide) {
        cuts.push(valleyAt);
        peak = energy;
        falling = false;
        valley = energy;
        valleyAt = i;
        continue;
      }
      if (energy >= peak * 0.92) {
        peak = Math.max(peak, energy);
        falling = false;
        valley = energy;
        valleyAt = i;
      }
      continue;
    }
    if (energy >= peak) {
      peak = energy;
      valley = energy;
      valleyAt = i;
    } else if (energy < peak * 0.85) {
      falling = true;
      valley = energy;
      valleyAt = i;
    }
  }
  return cuts;
}

// Test the release against nearby sound on both sides, including a quieter
// second attack. An earlier accent elsewhere in the note is irrelevant.
function localReleaseCuts(energy: number[], first: number, last: number, hop: number): number[] {
  const shoulder = Math.round(0.06 / hop);
  // Five pitch frames survive the 70 ms minimum segment duration after rounding.
  const spacing = Math.ceil(0.08 / hop);
  const cuts: number[] = [];
  for (let i = first + spacing; i <= last - spacing; i++) {
    const low = energy[i];
    if (low >= energy[i - 1] || low > energy[i + 1]) continue;
    let left = 0;
    let right = 0;
    for (let j = 1; j <= shoulder; j++) {
      left = Math.max(left, energy[i - j]);
      right = Math.max(right, energy[i + j]);
    }
    if (Math.min(left, right) <= 0 || low > Math.min(left, right) * 0.55) continue;
    const prev = cuts.at(-1);
    if (prev == null || i - prev >= spacing) cuts.push(i);
    else if (low < energy[prev]) cuts[cuts.length - 1] = i;
  }
  return cuts;
}

function gapIsQuiet(rmsValues: number[], hopSec: number, gapStart: number, gapEnd: number, gate: number): boolean {
  const from = Math.max(0, Math.floor(gapStart / hopSec));
  const to = Math.min(rmsValues.length, Math.ceil(Math.max(gapStart, gapEnd) / hopSec));
  if (to <= from) return false;
  for (let i = from; i < to; i += 1) if ((rmsValues[i] ?? 0) < gate) return true;
  return false;
}

export function analyzeMelody(samples: Float32Array, sampleRate: number, vocal = true): DetectedNote[] {
  const normalized = peakNormalize(samples);
  const target = ANALYSIS_RATE;
  const down = downsample(normalized, sampleRate, target);
  // Two low-pass poles suppress breath hiss before measuring periodicity.
  // Only the dry path uses this: accompaniment retains its conservative detector.
  const buf = vocal ? smoothVoice(down, target) : down;
  const frame = vocal ? 768 : 512;
  const hop = 256;
  const rmsValues: number[] = [];
  for (let i = 0; i + frame <= buf.length; i += hop) {
    let sum = 0;
    for (let j = 0; j < frame; j += 1) sum += buf[i + j] * buf[i + j];
    rmsValues.push(Math.sqrt(sum / frame));
  }
  const sorted = [...rmsValues].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  // Use sustained frame energy, not the loudest sample (handling clicks).
  const upper = sorted[Math.floor(sorted.length * 0.85)] ?? 0;
  const gate = Math.max(1e-5, Math.min(0.02, upper * 0.2), median * 0.45);
  const frames: Array<number | null> = [];
  const audible: boolean[] = [];
  let index = 0;
  for (let i = 0; i + frame <= buf.length; i += hop) {
    const heard = rmsValues[index] >= gate;
    audible.push(heard);
    if (!heard) {
      frames.push(null);
      index += 1;
      continue;
    }
    const hz = yinFollow(
      buf.subarray(i, i + frame),
      target,
      vocal ? 0.25 : 0.15,
      vocal ? 60 : 75,
      vocal ? null : recentMelodyMidi(frames),
    );
    index += 1;
    if (hz == null) {
      frames.push(null);
      continue;
    }
    const midi = hzToMidi(hz);
    frames.push(midi >= (vocal ? 35 : 43) && midi <= 88 ? midi : null);
  }

  const smooth = bridgeDropouts(
    frames.map((midi, i) => {
      if (midi == null) return null;
      const window: number[] = [];
      for (let k = -2; k <= 2; k += 1) {
        const value = frames[i + k];
        if (value != null) window.push(value);
      }
      window.sort((a, b) => a - b);
      return window[Math.floor(window.length / 2)] ?? midi;
    }),
    audible,
  );
  repairOctaveBlips(smooth);

  const hopSec = hop / target;
  // Measure articulation on the broadband signal. The pitch detector's
  // low-pass can turn a change in harmonic balance into an apparent release.
  const shortWin = Math.max(64, Math.round(target * 0.01));
  const shortHop = Math.max(32, Math.round(target * 0.005));
  const shortHopSec = shortHop / target;
  const shortRms: number[] = [];
  for (let i = 0; i + shortWin <= down.length; i += shortHop) {
    let sum = 0;
    for (let j = 0; j < shortWin; j += 1) sum += down[i + j] * down[i + j];
    shortRms.push(Math.sqrt(sum / shortWin));
  }
  type Segment = { start: number; end: number; midis: number[]; frame0: number; reattack?: boolean };
  const rawSegments: Segment[] = [];
  let current: Segment | null = null;
  const commit = () => {
    if (current && current.end - current.start >= 0.07) rawSegments.push(current);
    current = null;
  };
  for (let i = 0; i < smooth.length; i += 1) {
    const midi = smooth[i];
    const time = i * hopSec;
    if (midi == null) {
      commit();
      continue;
    }
    const recent = current ? current.midis.slice(-8) : [];
    recent.sort((a, b) => a - b);
    const center = recent.length ? recent[Math.floor(recent.length / 2)] : null;
    if (!current || center == null || Math.abs(midi - center) > 0.75) {
      commit();
      current = { start: time, end: time + hopSec, midis: [midi], frame0: i };
    } else {
      current.midis.push(midi);
      current.end = time + hopSec;
    }
  }
  commit();

  const relRms = vocal ? null : relativeEnvelope(shortRms, shortHopSec);
  const segments: Segment[] = [];
  for (const segment of rawSegments) {
    const startF = segment.frame0;
    const endF = segment.frame0 + segment.midis.length - 1;
    const shortStart = Math.floor(segment.start / shortHopSec);
    const shortEnd = Math.floor((segment.end - shortHopSec / 2) / shortHopSec);
    const candidates = relRms
      ? [...reattackCutFrames(shortRms, shortStart, shortEnd, shortHopSec),
         ...reattackCutFrames(relRms, shortStart, shortEnd, shortHopSec)]
      : localReleaseCuts(shortRms, shortStart, shortEnd, shortHopSec);
    const cuts = candidates
      .map((frame) => Math.round((frame * shortHopSec) / hopSec))
      .filter((frame, index, list) => frame > startF && frame < endF && list.indexOf(frame) === index)
      .sort((a, b) => a - b);
    if (!cuts.length) {
      segments.push(segment);
      continue;
    }
    const bounds = [startF, ...cuts, endF + 1];
    for (let b = 0; b < bounds.length - 1; b += 1) {
      const from = bounds[b] - startF;
      const to = bounds[b + 1] - startF;
      const midis = segment.midis.slice(from, to);
      if (!midis.length) continue;
      const next: Segment = {
        start: bounds[b] * hopSec,
        end: bounds[b + 1] * hopSec,
        midis,
        frame0: bounds[b],
        reattack: b > 0,
      };
      if (next.end - next.start >= 0.07) segments.push(next);
    }
  }

  const notes: DetectedNote[] = [];
  for (const segment of segments) {
    const values = [...segment.midis].sort((a, b) => a - b);
    const midi = Math.round(values[Math.floor(values.length / 2)]);
    const prev = notes[notes.length - 1];
    const notBefore = prev ? prev.start + prev.dur : 0;
    const start = refineAttackTime(shortRms, shortHopSec, segment.start, segment.end, notBefore);
    const end = Math.max(start + Math.min(0.07, segment.end - segment.start), segment.end);
    const confidence = pitchConfidence(segment.midis, end - start);

    const gap = prev ? start - (prev.start + prev.dur) : Infinity;
    const dropout = prev && prev.midi === midi && gap <= DROPOUT_GAP && gap > -0.02 && !segment.reattack;
    if (dropout && !gapIsQuiet(rmsValues, hopSec, prev.start + prev.dur, start, gate)) {
      prev.dur = end - prev.start;
      prev.confidence = Math.min(prev.confidence ?? 1, confidence);
    } else {
      notes.push({ start, dur: end - start, midi, confidence, reattack: segment.reattack });
    }
  }
  return tidyDetected(notes);
}

/** A thick mix can lock onto whichever partial is loudest and flicker. Don't write that staff. */
function accompaniedPulse(notes: DetectedNote[]): number {
  const starts = notes.map((note) => note.start).sort((a, b) => a - b);
  const iois: number[] = [];
  for (let i = 1; i < starts.length; i += 1) {
    const gap = starts[i] - starts[i - 1];
    if (gap >= 0.05) iois.push(gap);
  }
  iois.sort((a, b) => a - b);
  // Use the faster regular spacing so mixed eighths and longer notes are not
  // judged against the wide gaps (including holes left by dropped pad leaks).
  return iois[Math.floor(iois.length * 0.25)] ?? iois[0] ?? 0.5;
}

function accompaniedLineIsClear(notes: DetectedNote[]): boolean {
  if (!notes.length) return false;
  // Judge flicker against the local pulse so a true sixteenth line is not
  // discarded as "too short," while a slow mix still treats 80ms blips as noise.
  const pulse = accompaniedPulse(notes);
  const flickerCut = Math.min(0.12, pulse * 0.55);
  const fleeting = notes.filter((note) => note.dur < flickerCut).length;
  if (fleeting > notes.length * 0.34) return false;
  const held = notes.filter((note) => note.dur >= flickerCut).map((note) => note.dur).sort((a, b) => a - b);
  const median = held[Math.floor(held.length / 2)] ?? 0;
  return median >= Math.min(0.18, pulse * 0.7);
}

/** The product records the prominent melody, not short pad tones an octave below it. */
function dropAccompaniedBassLeaks(notes: DetectedNote[]): DetectedNote[] {
  if (notes.length < 3) return notes;
  const midis = notes.map((note) => note.midi).sort((a, b) => a - b);
  const center = midis[Math.min(midis.length - 1, Math.floor(midis.length * 0.65))];
  return notes.filter((note) => note.midi > center - 12);
}

function finishTake(notes: DetectedNote[], kind: MelodyKind): MelodyTake {
  const line = kind === "accompanied" ? dropAccompaniedBassLeaks(notes) : notes;
  if (kind === "accompanied" && !accompaniedLineIsClear(line)) {
    return { notes: [], kind, notice: ACCOMPANIMENT_UNCLEAR_NOTICE };
  }
  if (kind === "accompanied") return { notes: line, kind, notice: ACCOMPANIMENT_NOTICE };
  return { notes: line, kind, notice: notes.length ? null : "没有听出稳定的音高。请靠近麦克风，清楚地哼一段单音旋律。" };
}

function transcribeChunk(channels: Float32Array[], sampleRate: number): MelodyTake {
  const prepared = channels.map((channel) => toAnalysisRate(channel, sampleRate));
  if (!prepared.length || prepared.every((channel) => channel.length < 512)) {
    return { notes: [], kind: "dry", notice: "声音太短，请哼唱至少半秒后再试。" };
  }
  // Reject near silence before normalization can amplify it into a false melody.
  if (prepared.every((channel) => rms(channel) < 1e-5)) {
    return { notes: [], kind: "dry", notice: "声音太轻或接近静音，请检查麦克风并靠近一些再试。" };
  }
  const { signal, kind, vocal } = prepareSignal(prepared);
  const notes = analyzeMelody(signal, ANALYSIS_RATE, kind === "dry" && vocal);
  if (notes.length === 0 && kind === "dry") {
    const retry = analyzeMelody(emphasizeMelody(signal, ANALYSIS_RATE), ANALYSIS_RATE, false);
    if (retry.length) return finishTake(retry, "accompanied");
  }
  return finishTake(notes, kind);
}

/** Bound temporary PCM allocations; overlap supplies context at each seam. */
// Short cores keep a masked passage from rejecting an entire verse.
const CHUNK_SECONDS = 8;
const CONTEXT_SECONDS = 0.512;

function transcribePrepared(channels: Float32Array[], sampleRate: number): MelodyTake {
  const length = channels.reduce((max, channel) => Math.max(max, channel.length), 0);
  const duration = length / sampleRate;
  if (duration <= CHUNK_SECONDS) {
    return { ...transcribeChunk(channels, sampleRate), analyzedSeconds: duration };
  }
  const notes: DetectedNote[] = [];
  let kind: MelodyKind = "dry";
  let unclear = false;
  for (let start = 0; start < duration; start += CHUNK_SECONDS) {
    const end = Math.min(duration, start + CHUNK_SECONDS);
    const from = Math.max(0, Math.floor((start - CONTEXT_SECONDS) * sampleRate));
    const to = Math.min(length, Math.ceil((end + CONTEXT_SECONDS) * sampleRate));
    const take = transcribeChunk(channels.map((channel) => channel.subarray(from, to)), sampleRate);
    if (take.kind === "accompanied") kind = "accompanied";
    if (!take.notes.length && take.kind === "accompanied") unclear = true;
    for (const note of take.notes) {
      const onset = note.start + from / sampleRate;
      const release = onset + note.dur;
      // Keep only this core's interval. Adjacent same-pitch fragments are joined below.
      const clippedStart = Math.max(start, onset);
      const clippedEnd = Math.min(end, release);
      if (clippedEnd > clippedStart) notes.push({ ...note, start: clippedStart, dur: clippedEnd - clippedStart });
    }
  }
  // Join before tidyDetected's minimum-duration filter so short seam fragments survive.
  const stitched: DetectedNote[] = [];
  for (const note of notes) {
    const prev = stitched.at(-1);
    if (
      prev &&
      prev.midi === note.midi &&
      Math.abs(note.start - prev.start - prev.dur) < 1e-6 &&
      !note.reattack
    ) {
      prev.dur = note.start + note.dur - prev.start;
      prev.confidence = Math.min(prev.confidence ?? 1, note.confidence ?? 1);
    } else stitched.push({ ...note });
  }
  const cleaned = tidyDetected(stitched);
  // Clarity is assessed locally: a masked passage must not discard clear passages elsewhere.
  const notice = [
    kind === "accompanied" ? (cleaned.length ? ACCOMPANIMENT_NOTICE : ACCOMPANIMENT_UNCLEAR_NOTICE) :
      cleaned.length ? null : "没有听出稳定的音高。请清楚地哼一段单音旋律。",
    unclear ? "部分片段伴奏较强，已跳过听不清的旋律。" : null,
    `已分析完整音频（${duration.toFixed(1)} 秒）。`,
  ].filter(Boolean).join(" ");
  return { notes: cleaned, kind, notice, analyzedSeconds: duration };
}

export function transcribeMono(samples: Float32Array, sampleRate: number): MelodyTake {
  return transcribePrepared([samples], sampleRate);
}

export function transcribeBuffer(buffer: ChannelBuffer, sampleRate: number): MelodyTake {
  const count = Math.max(1, buffer.numberOfChannels | 0);
  const channels: Float32Array[] = [];
  for (let channel = 0; channel < count; channel += 1) channels.push(buffer.getChannelData(channel));
  return transcribePrepared(channels, sampleRate);
}

const PULSE_TARGETS: Array<[number, number]> = [
  [0.25, 0.85],
  [0.5, 0.72],
  [0.75, 0.8],
  [1, 1],
  [1.5, 0.8],
  [2, 1],
  [3, 0.85],
  [4, 0.7],
];

function pulseFit(beats: number): number {
  let best = 0;
  for (const [target, weight] of PULSE_TARGETS) {
    const err = beats - target;
    best = Math.max(best, weight * Math.exp(-err * err * 28));
  }
  return best;
}

export function estimateBpm(notes: DetectedNote[]): number {
  if (notes.length < 3) return 92;
  const starts = [...notes].map((note) => note.start).sort((a, b) => a - b);
  const kept = [starts[0]];
  for (let i = 1; i < starts.length; i += 1) {
    if (starts[i] - kept[kept.length - 1] >= 0.09) kept.push(starts[i]);
  }
  if (kept.length < 3) return 92;
  const gaps: number[] = [];
  for (let i = 1; i < kept.length; i += 1) {
    const gap = kept[i] - kept[i - 1];
    if (gap <= 2) gaps.push(gap);
  }
  if (gaps.length < 2) return 92;
  const ordered = [...gaps].sort((a, b) => a - b);
  const median = ordered[Math.floor(ordered.length / 2)];
  const cluster = gaps.filter((gap) => gap >= median * 0.72 && gap <= median * 1.28);
  const center = cluster.reduce((sum, gap) => sum + gap, 0) / cluster.length;
  let bpm0 = 60 / center;
  if (bpm0 < 56) bpm0 *= 2;
  const triplets = groupedTripletTempo(kept, median);
  if (triplets != null) return triplets;
  // The dominant IOI may be a sixteenth, eighth, or quarter. Search those
  // metrical levels instead of treating a fast IOI as a quarter and clamping
  // it to 176. Existing allegro-quarter tests stay on the undivided beat.
  // Score only gaps that are simple multiples of the typical IOI so a few
  // split or late onsets cannot make a clamp-to-176 (or a 3:2 reading) win.
  const pulseGaps = metricalGaps(gaps, median);
  const candidates: Array<{ bpm: number; score: number }> = [];
  for (const div of [1, 2, 3, 4, 6, 8]) {
    const approx = bpm0 / div;
    if (approx < 50 || approx > 200) continue;
    candidates.push(searchTempo(approx, pulseGaps));
  }
  // Do not add a 176 clamp candidate when the raw IOI-as-quarter is above the
  // cap: that leftover from the old clamp beats a true 66 on slightly irregular
  // 16th lines. searchTempo already clamps a legitimate level that is still fast.
  // Regular slow quarters and halves also fit twice the tempo. Require
  // independent subdivision evidence before promoting the faster reading.
  if (!candidates.length) candidates.push(searchTempo(bpm0, gaps));
  let best = candidates[0];
  for (const candidate of candidates) if (candidate.score > best.score) best = candidate;
  // Dotted-eighth and quarter gaps can share a sixteenth pulse even when
  // neither is an integer multiple of the other. Keep this evidence outside
  // the median-gap filter, which deliberately discards unrelated attacks.
  const syncopated = syncopatedTempo(gaps, best.bpm);
  if (syncopated != null) return syncopated;
  const grouped = subdividedTempo(kept);
  if (grouped != null) return grouped;
  // Short eighths with longer surrounding gaps can also support half tempo.
  // A straight allegro line, even faster than 154, stays on the quarter.
  if (best.bpm > 154) {
    const slow = searchTempo(best.bpm / 2, gaps);
    if (eighthReadingFits(notes, gaps, center, slow.score, best.score)) return slow.bpm;
  }
  // A half-speed reading can place recurring eighths on sixteenths while
  // leaving dotted and tied intervals halfway between its grid lines.
  if (best.bpm * 2 <= 176 && hasFinerSubdivision(gaps, best.bpm)) return best.bpm * 2;
  return best.bpm;
}

// Look for complete, separated runs of three (or six, etc.) equally spaced
// attacks. A stream of equal notes alone does not establish a triplet beat.
function groupedTripletTempo(starts: number[], unit: number): number | null {
  const groups = [0];
  const lengths = new Set<number>();
  let intervals = 0;
  let elapsed = 0;
  for (let end = 1; end <= starts.length; end++) {
    if (end < starts.length) {
      const gap = starts[end] - starts[end - 1];
      if (Math.abs(gap / unit - 1) < 0.2) continue;
    }
    const first = groups[groups.length - 1];
    const count = end - first;
    if (count % 3 !== 0) return null;
    lengths.add(count);
    intervals += count - 1;
    elapsed += starts[end - 1] - starts[first];
    if (end < starts.length) groups.push(end);
  }
  // Repetition of one identical figure also fits a straight subdivision
  // followed by a rest. Require grouping at more than one phrase length.
  if (groups.length < 3 || lengths.size < 2) return null;
  const quarter = 3 * elapsed / intervals;
  const bpm = Math.round(60 / quarter);
  if (bpm < 56 || bpm > 176) return null;
  const aligned = groups.every(i => {
    const beats = (starts[i] - starts[0]) / quarter;
    return Math.abs(beats - Math.round(beats)) < 0.12;
  });
  return aligned ? bpm : null;
}

function hasFinerSubdivision(gaps: number[], bpm: number): boolean {
  const oddLengths = new Set<number>();
  let aligned = 0;
  for (const gap of gaps) {
    const steps = gap * (2 * bpm) / 15;
    const nearest = Math.round(steps);
    if (Math.abs(steps - nearest) > 0.2) continue;
    aligned++;
    if (nearest % 2 === 1) oddLengths.add(nearest);
  }
  return oddLengths.size >= 2 && aligned >= gaps.length * 0.9;
}

// Short runs of subdivisions can occur inside a longer recurring beat. Fit a
// shared phase across the take, so one delayed or extra attack does not pull
// the tempo away from all the other attacks.
function subdividedTempo(starts: number[]): number | null {
  if (starts.length < 9) return null;
  const gaps = starts.slice(1).map((start, i) => start - starts[i]);
  let best: { bpm: number; error: number } | null = null;
  // The initial IOI estimate can be half or double the beat, or hit the
  // tempo floor. Test the grouping itself across the supported tempo range.
  for (let bpm = 56; bpm <= 176; bpm += 1) {
    const step = 15 / bpm;
    const fits = (gap: number, count: number) => Math.abs(gap / step - count) <= 0.32;
    // Require repeated pairs of short subdivisions as well as recurring
    // eighth and quarter intervals. Straight fast lines stay unchanged.
    let groups = 0;
    let run = 0;
    let eighths = 0;
    let quarters = 0;
    for (const gap of gaps) {
      run = fits(gap, 1) ? run + 1 : 0;
      if (run === 2) groups++;
      if (fits(gap, 2)) eighths++;
      if (fits(gap, 4)) quarters++;
    }
    if (groups < 2 || eighths < 3 || quarters < 2) continue;
    for (let bin = 0; bin < 16; bin += 1) {
      const phase = starts[0] + step * bin / 16;
      const errors = starts.map((start) => {
        const position = (start - phase) / step;
        return Math.abs(position - Math.round(position));
      });
      if (errors.filter((error) => error <= 0.22).length < starts.length * 0.75) continue;
      const error = errors.reduce((sum, value) => sum + Math.min(value, 0.22), 0);
      if (best == null || error < best.error) best = { bpm, error };
    }
  }
  return best?.bpm ?? null;
}

function syncopatedTempo(gaps: number[], fallback: number): number | null {
  if (gaps.length < 6) return null;
  function alignment(bpm: number) {
    const step = 15 / bpm;
    // Measure timing error in sixteenth notes so the same rhythm has the
    // same tolerance when played faster or slower.
    let supported = 0;
    let quarters = 0;
    let dottedEighths = 0;
    let fiveSixteenths = 0;
    let error = 0;
    for (const gap of gaps) {
      const steps = Math.round(gap / step);
      const residual = Math.abs(gap / step - steps);
      error += Math.min(0.22, residual);
      if (steps < 1 || residual > 0.22) continue;
      supported += 1;
      if (steps === 3) dottedEighths += 1;
      if (steps === 5) fiveSixteenths += 1;
      if (steps === 4) quarters += 1;
    }
    return { supported, quarters, dottedEighths, fiveSixteenths, error };
  }
  const baseline = alignment(fallback);
  let best = baseline;
  let tempo = null;
  for (let bpm = 56; bpm <= 176; bpm += 1) {
    // This ambiguity is specifically an apparent beat that is a dotted eighth.
    if (Math.abs(60 / fallback - 45 / bpm) > 0.024) continue;
    const fit = alignment(bpm);
    if (fit.dottedEighths < 1 || fit.dottedEighths + fit.fiveSixteenths < 2 || fit.quarters < 2 ||
        fit.supported < Math.ceil(gaps.length * 0.75) ||
        fit.supported <= baseline.supported || fit.error >= best.error) continue;
    best = fit;
    tempo = bpm;
  }
  return tempo;
}

function metricalGaps(gaps: number[], median: number): number[] {
  if (!(median > 0) || gaps.length < 2) return gaps;
  const kept = gaps.filter((gap) => {
    const ratio = gap / median;
    return [1, 2, 3, 4].some((multiple) => Math.abs(ratio - multiple) < 0.28);
  });
  return kept.length >= 2 ? kept : gaps;
}

function searchTempo(bpm0: number, gaps: number[]): { bpm: number; score: number } {
  const anchor = Math.round(Math.min(176, Math.max(56, bpm0)));
  let best = anchor;
  let bestScore = -Infinity;
  for (let bpm = Math.max(56, anchor - 6); bpm <= Math.min(176, anchor + 6); bpm += 1) {
    const quarter = 60 / bpm;
    let score = 0;
    for (const gap of gaps) score += pulseFit(gap / quarter);
    score -= Math.abs(bpm - anchor) * 0.02;
    if (score > bestScore) {
      bestScore = score;
      best = bpm;
    }
  }
  return { bpm: best, score: bestScore };
}

function eighthReadingFits(
  notes: DetectedNote[],
  gaps: number[],
  center: number,
  slowScore: number,
  fastScore: number,
): boolean {
  if (!(slowScore >= fastScore * 0.75)) return false;
  const durs = notes
    .map((note) => note.dur)
    .filter((dur) => dur > 0.05 && dur < 2)
    .sort((a, b) => a - b);
  if (durs.length < 3) return false;
  const medianDur = durs[Math.floor(durs.length / 2)] ?? 0;
  if (!(medianDur < center * 0.62)) return false;
  const longerBeat = gaps.filter((gap) => gap > center * 1.7 && gap < center * 2.35).length;
  return longerBeat >= 2;
}


/** Drop a floating-point residue (such as 0.9999999999999991) without changing the grid. */
export function cleanBeat(value: number): number {
  if (!Number.isFinite(value)) return value;
  let best = value;
  let bestErr = 1e-8;
  for (const den of [1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64]) {
    const snapped = Math.round(value * den) / den;
    const err = Math.abs(value - snapped);
    if (err < bestErr) {
      best = snapped;
      bestErr = err;
    }
  }
  return best;
}

function pickupBeat(firstBeats: number, grid: number): number {
  const snapped = Math.round(firstBeats / grid) * grid;
  // Keep any length of grid-aligned leading silence. A delay shorter than
  // one grid step, such as a few dozen milliseconds of detection latency,
  // is not written as a rest.
  return snapped >= grid - 1e-6 &&
    Math.abs(firstBeats - snapped) <= grid * 0.4 ? snapped : 0;
}

export function suggestDictationGrid(notes: DetectedNote[], bpm: number): 0.25 | 0.5 {
  const cleaned = tidyDetected(notes);
  const gaps = cleaned.slice(1).map((note, index) =>
    (note.start - cleaned[index].start) * bpm / 15,
  );
  let aligned = 0;
  let odd = 0;
  for (const gap of gaps) {
    const steps = Math.round(gap);
    if (steps < 1 || Math.abs(gap - steps) > 0.35) continue;
    aligned += 1;
    if (steps % 2 === 1) odd += 1;
  }
  // An isolated late attack can look like a sixteenth. Require repeated
  // intervals that need the finer grid within an otherwise aligned phrase.
  if (odd >= 2 && aligned >= gaps.length * 0.75) return 0.25;

  // A phrase can stay on odd sixteenth steps throughout, so its inter-onset
  // intervals alone look like eighths. Check the phase against the clip start.
  const pickup = pickupBeat((cleaned[0]?.start ?? 0) * bpm / 60, 0.25);
  if (pickup % 0.5 !== 0 && cleaned.length >= 4) {
    const oddAttacks = cleaned.filter((note) => {
      const position = note.start * bpm / 15;
      const step = Math.round(position);
      return step % 2 === 1 && Math.abs(position - step) <= 0.35;
    }).length;
    if (oddAttacks >= cleaned.length * 0.75) return 0.25;
  }
  return 0.5;
}

/** Onsets that trisect a beat starting on a beat or half-beat, within draft tolerance. */
const TRIPLET_ALIGN = 0.05;

function eighthTripletGroups(onsets: number[]): { start: number; indices: [number, number, number] }[] {
  const groups: { start: number; indices: [number, number, number] }[] = [];
  let i = 0;
  while (i + 2 < onsets.length) {
    const start = Math.round(onsets[i] / 0.5) * 0.5;
    const expected = [start, start + 1 / 3, start + 2 / 3];
    const next = onsets[i + 3];
    if (
      Math.abs(onsets[i] - expected[0]) <= TRIPLET_ALIGN &&
      Math.abs(onsets[i + 1] - expected[1]) <= TRIPLET_ALIGN &&
      Math.abs(onsets[i + 2] - expected[2]) <= TRIPLET_ALIGN &&
      (next == null || next >= start + 1 - TRIPLET_ALIGN)
    ) {
      groups.push({ start, indices: [i, i + 1, i + 2] });
      i += 3;
      continue;
    }
    i += 1;
  }
  return groups;
}

function quantizeDuration(rawBeats: number, grid: number): number {
  const fine = Math.max(grid, Math.round(rawBeats / grid) * grid);
  if (grid > 0.25 + 1e-6) return fine;
  // A release tail often lands 10–20% long or short of a quarter. Prefer the
  // eighth grid when it is nearly as close, so the staff does not grow a sixteenth.
  const eighth = Math.max(grid, Math.round(rawBeats / 0.5) * 0.5);
  const fineErr = Math.abs(rawBeats - fine);
  const eighthErr = Math.abs(rawBeats - eighth);
  if (eighthErr <= 0.2 && eighthErr <= fineErr + 0.1) return eighth;
  return fine;
}

export function quantizeDetected(notes: DetectedNote[], bpm: number, grid: number): ScoreNote[] {
  const cleaned = tidyDetected(notes);
  if (!cleaned.length || !(grid > 0)) return [];
  const quarter = 60 / Math.max(1, bpm);
  // Quantize against the start of the take when the first onset is a
  // grid-aligned leading rest, including a long prelude. Shifting the origin
  // to the first note used to drop that rest and misalign every later bar.
  const keepPickup = pickupBeat(cleaned[0].start / quarter, grid) > 0;
  const origin = keepPickup ? 0 : cleaned[0].start;
  const items = cleaned.map((note, index) => {
    const next = cleaned[index + 1];
    const onset = (note.start - origin) / quarter;
    const sounding = Math.max(grid, note.dur / quarter);
    if (!next) return { midi: note.midi, onset, sounding, legato: false };
    const gapSec = next.start - (note.start + note.dur);
    const ioiBeats = (next.start - note.start) / quarter;
    const legato = ioiBeats > 0.05 && gapSec < 0.12 && gapSec < note.dur;
    return { midi: note.midi, onset, sounding, legato };
  });

  const tripletByIndex = new Map<number, { start: number; slot: number }>();
  for (const group of eighthTripletGroups(items.map((item) => item.onset))) {
    for (let slot = 0; slot < 3; slot += 1) {
      tripletByIndex.set(group.indices[slot], { start: group.start, slot });
    }
  }

  const residues = items
    .filter((_, index) => !tripletByIndex.has(index))
    .map((item) => item.onset - Math.round(item.onset / grid) * grid)
    .sort((a, b) => a - b);
  const phase = residues[Math.floor(residues.length / 2)] ?? 0;
  // Use the fitted phase to locate the grid line, then write the grid
  // position itself. A detection delay is not part of the pickup rest.
  // Clear 3:2 eighth triplets keep exact third-beat onsets instead of the grid.
  const snapped = items.map((item, index) => {
    const triplet = tripletByIndex.get(index);
    return triplet ? triplet.start + triplet.slot / 3 : Math.round((item.onset - phase) / grid) * grid;
  });
  const shift = keepPickup ? 0 : (snapped[0] ?? 0);
  const placed: { index: number; start: number }[] = [];
  for (let index = 0; index < items.length; index += 1) {
    const start = snapped[index] - shift;
    const last = placed.at(-1);
    if (!last || start > last.start) {
      placed.push({ index, start });
      continue;
    }
    // Two attacks can round to the same line. Keep both when the following
    // slot is free. Otherwise keep the better aligned attack on this line.
    const nextLine = snapped[index + 1] == null ? Infinity : snapped[index + 1] - shift;
    const rawGap = items[index].onset - items[last.index].onset;
    if (rawGap >= grid * 0.5 && last.start + grid < nextLine) {
      placed.push({ index, start: last.start + grid });
    } else {
      const line = last.start + shift + phase;
      if (Math.abs(items[index].onset - line) < Math.abs(items[last.index].onset - line)) {
        last.index = index;
      }
    }
  }

  const out: ScoreNote[] = [];
  let cursor = 0;
  for (let i = 0; i < placed.length; i += 1) {
    const { index, start: q0 } = placed[i];
    const next = placed[i + 1];
    const nextStart = next?.start ?? null;
    let end: number;
    const triplet = tripletByIndex.get(index);
    if (triplet) {
      end = q0 + cleanBeat(1 / 3);
      if (nextStart != null && end > nextStart - 1e-6) end = nextStart;
      // Detector releases are often slightly early. Write 4/3 when sounding is
      // closer to 4/3 than to a quarter or a triplet eighth, and the next
      // onset leaves room. Do not fill a short 1/3 plus a rest.
      if (
        triplet.slot === 2 &&
        Math.abs(items[index].sounding - 4 / 3) < Math.abs(items[index].sounding - 1) &&
        Math.abs(items[index].sounding - 4 / 3) < Math.abs(items[index].sounding - 1 / 3) &&
        (nextStart == null || nextStart >= q0 + 4 / 3 - TRIPLET_ALIGN)
      ) {
        end = q0 + cleanBeat(4 / 3);
      }
    } else if (next && next.index === index + 1 && items[index].legato) {
      end = next.start;
    } else {
      end = q0 + quantizeDuration(items[index].sounding, grid);
      if (nextStart != null && end > nextStart - 1e-6) end = Math.max(q0 + grid, nextStart);
    }
    if (!triplet && end < q0 + grid - 1e-6) end = q0 + grid;

    const hole = q0 - cursor;
    if (hole >= grid - 1e-6) {
      out.push({ pitches: [], dur: cleanBeat(hole) });
      cursor = q0;
    } else if (hole > 1e-6) {
      const previous = out[out.length - 1];
      if (previous) previous.dur = cleanBeat(previous.dur + hole);
      cursor = q0;
    }
    const dur = cleanBeat(end - cursor);
    if (!(dur > 1e-6)) continue;
    out.push({ pitches: [items[index].midi], dur });
    cursor = end;
  }
  return out;
}
