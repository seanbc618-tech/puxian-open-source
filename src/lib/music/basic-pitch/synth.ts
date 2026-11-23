/** Offline additive synthesis for dictation tests: a soft piano-like tone per note. */
export type SynthNote = { start: number; dur: number; midi: number; gain?: number };

export function synthesize(notes: SynthNote[], seconds: number, rate = 22050): Float32Array {
  const out = new Float32Array(Math.ceil(seconds * rate));
  for (const n of notes) {
    const f0 = 440 * 2 ** ((n.midi - 69) / 12);
    const from = Math.round(n.start * rate);
    const len = Math.round(n.dur * rate);
    const release = Math.round(0.03 * rate);
    const gain = n.gain ?? 0.18;
    for (let i = 0; i < len + release && from + i < out.length; i++) {
      const t = i / rate;
      const attack = Math.min(1, t / 0.005);
      const decay = Math.exp(-t * 1.6);
      const tail = i < len ? 1 : 1 - (i - len) / release;
      let s = 0;
      for (let h = 1; h <= 6; h++) {
        if (f0 * h > rate / 2) break;
        s += Math.sin(2 * Math.PI * f0 * h * t) * (1 / h) * Math.exp(-t * 0.8 * h);
      }
      out[from + i] += gain * attack * decay * tail * s;
    }
  }
  return out;
}
