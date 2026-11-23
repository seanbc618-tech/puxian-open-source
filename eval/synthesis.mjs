// Self-authored additive synthesizer and SMF reader for the MIDI emitted by scoreToMidi.
// No soundfont, external samples, or network. All code in this evaluation is MIT.
export function readMidi(bytes) {
  const b = Buffer.from(bytes);
  if (b.toString("ascii", 0, 4) !== "MThd") throw Error("SMF required");
  const ppq = b.readUInt16BE(12);
  let pos = 14;
  const notes = [];
  let micros = 500000;
  while (pos < b.length) {
    if (b.toString("ascii", pos, pos + 4) !== "MTrk") throw Error("track");
    const end = pos + 8 + b.readUInt32BE(pos + 4);
    pos += 8;
    let tick = 0,
      status = 0;
    const active = new Map();
    const variable = () => {
      let n = 0,
        c;
      do {
        c = b[pos++];
        n = n * 128 + (c & 127);
      } while (c & 128);
      return n;
    };
    while (pos < end) {
      tick += variable();
      let s = b[pos++];
      if (s < 128) {
        pos--;
        s = status;
      } else status = s;
      if (s === 255) {
        const type = b[pos++],
          len = variable();
        if (type === 81) {
          if (tick !== 0) throw Error("Only fixed-tempo fixtures supported");
          micros = b.readUIntBE(pos, 3);
        }
        pos += len;
        continue;
      }
      if (s === 240 || s === 247) {
        pos += variable();
        continue;
      }
      const type = s >> 4,
        channel = s & 15,
        pitch = b[pos++],
        value = [12, 13].includes(type) ? 0 : b[pos++];
      const key = channel + ":" + pitch;
      if (type === 9 && value) {
        active.set(key, { pitch, start: tick, velocity: value });
      }
      if (type === 8 || (type === 9 && !value)) {
        const n = active.get(key);
        if (!n) throw Error("unpaired MIDI off");
        notes.push({ ...n, dur: tick - n.start });
        active.delete(key);
      }
    }
    if (active.size) throw Error("unclosed MIDI notes");
  }
  const quarter = micros / 1e6;
  return {
    quarter,
    notes: notes
      .map((n) => ({ ...n, start: (n.start / ppq) * quarter, dur: (n.dur / ppq) * quarter }))
      .sort((a, b) => a.start - b.start || a.pitch - b.pitch),
  };
}
export function synthesize(notes, seconds, variant, seed = 20261114) {
  const rate = 22050,
    signal = new Float64Array(Math.ceil((seconds + 0.25) * rate));
  const add = (n, gain) => {
    const begin = Math.round(n.start * rate),
      length = Math.round(n.dur * rate);
    const f = 440 * 2 ** ((n.pitch - 69) / 12);
    for (let j = 0; j < length && j + begin < signal.length; j++) {
      const t = j / rate;
      const env = Math.min(1, t / 0.01, (length - j) / rate / 0.025);
      signal[begin + j] +=
        gain *
        env *
        (Math.sin(2 * Math.PI * f * t) +
          0.25 * Math.sin(4 * Math.PI * f * t) +
          0.1 * Math.sin(6 * Math.PI * f * t));
    }
  };
  for (const n of notes) add(n, 0.3);
  let state = seed >>> 0;
  const random = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
  if (variant === "noise")
    for (let i = 0; i < signal.length; i++) signal[i] += (random() * 2 - 1) * 0.055;
  if (variant === "accompaniment-reverb") {
    for (let t = 0; t < seconds; t += 2)
      for (const pitch of [48, 55, 60])
        add({ pitch, start: t, dur: Math.min(1.9, seconds - t) }, 0.09);
    const dry = signal.slice();
    for (const [delay, gain] of [
      [0.075, 0.24],
      [0.13, 0.17],
      [0.21, 0.1],
    ]) {
      const shift = Math.round(delay * rate);
      for (let i = shift; i < signal.length; i++) signal[i] += dry[i - shift] * gain;
    }
  }
  if (variant === "phone") {
    const hp = Math.exp((-2 * Math.PI * 300) / rate),
      lp = 1 - Math.exp((-2 * Math.PI * 3400) / rate);
    let previous = 0,
      high = 0,
      low = 0;
    for (let i = 0; i < signal.length; i++) {
      high = hp * (high + signal[i] - previous);
      previous = signal[i];
      low += lp * (high - low);
      signal[i] =
        Math.round(Math.max(-0.28, Math.min(0.28, low)) * 32767) / 32767 +
        (random() * 2 - 1) * 0.012;
    }
  }
  let peak = 0;
  for (const v of signal) peak = Math.max(peak, Math.abs(v));
  const gain = peak > 0.95 ? 0.95 / peak : 1;
  const wav = Buffer.alloc(44 + signal.length * 2);
  wav.write("RIFF");
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(rate, 24);
  wav.writeUInt32LE(rate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(signal.length * 2, 40);
  for (let i = 0; i < signal.length; i++)
    wav.writeInt16LE(Math.round(signal[i] * gain * 32767), 44 + i * 2);
  return wav;
}
