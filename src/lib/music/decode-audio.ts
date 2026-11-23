/**
 * Decode a PCM WAV in JavaScript when Web Audio's decodeAudioData is unavailable
 * (some WebKit builds have no audio device and the promise never settles).
 */

export type PcmAudio = { sampleRate: number; channels: Float32Array[] };

const MAX_WAV_BYTES = 64 * 1024 * 1024;

function u16(view: DataView, at: number, le = true) {
  return view.getUint16(at, le);
}
function u32(view: DataView, at: number, le = true) {
  return view.getUint32(at, le);
}
function tag(bytes: Uint8Array, at: number) {
  return String.fromCharCode(bytes[at] ?? 0, bytes[at + 1] ?? 0, bytes[at + 2] ?? 0, bytes[at + 3] ?? 0);
}

/** Little-endian PCM or IEEE float WAV only. Other encodings return null. */
export function decodePcmWav(bytes: Uint8Array): PcmAudio | null {
  if (bytes.length < 44 || bytes.length > MAX_WAV_BYTES) return null;
  if (tag(bytes, 0) !== "RIFF" || tag(bytes, 8) !== "WAVE") return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let fmt: { channels: number; sampleRate: number; bits: number; format: number } | null = null;
  let dataAt = 0;
  let dataLen = 0;
  let at = 12;
  while (at + 8 <= bytes.length) {
    const name = tag(bytes, at);
    const size = u32(view, at + 4);
    const body = at + 8;
    if (body + size > bytes.length) return null;
    if (name === "fmt ") {
      if (size < 16) return null;
      fmt = {
        format: u16(view, body),
        channels: u16(view, body + 2),
        sampleRate: u32(view, body + 4),
        bits: u16(view, body + 14),
      };
    } else if (name === "data") {
      dataAt = body;
      dataLen = size;
    }
    at = body + size + (size % 2);
  }
  if (!fmt || dataLen <= 0 || fmt.channels < 1 || fmt.channels > 8) return null;
  if (fmt.sampleRate < 8000 || fmt.sampleRate > 192_000) return null;
  const { channels, sampleRate, bits, format } = fmt;
  const bytesPer = bits / 8;
  if (bytesPer !== 1 && bytesPer !== 2 && bytesPer !== 3 && bytesPer !== 4) return null;
  const frames = Math.floor(dataLen / (bytesPer * channels));
  if (frames < 1) return null;
  const out = Array.from({ length: channels }, () => new Float32Array(frames));
  let p = dataAt;
  // 1 = integer PCM, 3 = IEEE float. 0xfffe extensible is not handled here.
  if (format === 3 && bits === 32) {
    for (let i = 0; i < frames; i++) {
      for (let c = 0; c < channels; c++, p += 4) out[c]![i] = view.getFloat32(p, true);
    }
  } else if (format === 1 && bits === 8) {
    for (let i = 0; i < frames; i++) {
      for (let c = 0; c < channels; c++, p += 1) out[c]![i] = ((bytes[p] ?? 0) - 128) / 128;
    }
  } else if (format === 1 && bits === 16) {
    for (let i = 0; i < frames; i++) {
      for (let c = 0; c < channels; c++, p += 2) out[c]![i] = view.getInt16(p, true) / 32768;
    }
  } else if (format === 1 && bits === 24) {
    for (let i = 0; i < frames; i++) {
      for (let c = 0; c < channels; c++, p += 3) {
        let v = bytes[p]! | (bytes[p + 1]! << 8) | (bytes[p + 2]! << 16);
        if (v & 0x800000) v -= 0x1000000;
        out[c]![i] = v / 8388608;
      }
    }
  } else if (format === 1 && bits === 32) {
    for (let i = 0; i < frames; i++) {
      for (let c = 0; c < channels; c++, p += 4) out[c]![i] = view.getInt32(p, true) / 2147483648;
    }
  } else {
    return null;
  }
  return { sampleRate, channels: out };
}

/** Copy PCM into a Web Audio buffer. Uses the constructor so it works without an audio device. */
export function audioBufferFromPcm(pcm: PcmAudio): AudioBuffer {
  const length = pcm.channels[0]?.length ?? 0;
  const buffer = new AudioBuffer({ length, sampleRate: pcm.sampleRate, numberOfChannels: pcm.channels.length });
  pcm.channels.forEach((channel, index) => buffer.getChannelData(index).set(channel));
  return buffer;
}

const DECODE_TIMEOUT_MS = 15_000;

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/**
 * Prefer a local WAV parse (does not need an output device). Otherwise use Web
 * Audio, with a timeout: some WebKit builds never settle decodeAudioData.
 */
export async function decodeUploadedAudio(
  bytes: Uint8Array,
  makeContext: () => AudioContext = () => new AudioContext(),
): Promise<AudioBuffer> {
  const wav = decodePcmWav(bytes);
  if (wav) return audioBufferFromPcm(wav);
  const ctx = makeContext();
  try {
    await ctx.resume().catch(() => undefined);
    const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    return await withTimeout(ctx.decodeAudioData(copy), DECODE_TIMEOUT_MS, "decode-timeout");
  } finally {
    void ctx.close().catch(() => undefined);
  }
}
