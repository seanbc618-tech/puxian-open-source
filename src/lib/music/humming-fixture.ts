/** Original deterministic synthetic voices; no recordings or third-party assets. */
export function hummingFixture(base = 48, seed = 731, amplitude = 0.025, breath = 0.85, glide = 0.09) {
  const sampleRate = 16000;
  const truth = [0, 4, 7, 5, 2, 0].map((step, i) => ({
    midi: base + step, start: 0.2 + i * 0.72, dur: 0.62,
  }));
  const samples = new Float32Array(4.7 * sampleRate);
  const random = () => {
    seed = (1664525 * seed + 1013904223) >>> 0;
    return seed / 2 ** 32 * 2 - 1;
  };
  for (let i = 0; i < samples.length; i++) samples[i] = amplitude * 0.08 * random();
  for (const [n, note] of truth.entries()) {
    let phase = 0;
    for (let j = 0; j < note.dur * sampleRate; j++) {
      const t = j / sampleRate;
      // Configurable scoop from the previous pitch, followed by 45-cent vibrato.
      const scoop = n ? (truth[n - 1].midi - note.midi) * Math.max(0, 1 - t / glide) : 0;
      const midi = note.midi + scoop + 0.45 * Math.sin(2 * Math.PI * 5.3 * t);
      phase += 440 * 2 ** ((midi - 69) / 12) / sampleRate;
      const voice = Math.sin(2 * Math.PI * phase) + 0.35 * Math.sin(4 * Math.PI * phase)
        + 0.16 * Math.sin(6 * Math.PI * phase);
      const envelope = Math.min(1, t / 0.025, (note.dur - t) / 0.035);
      samples[Math.floor(note.start * sampleRate) + j] += amplitude * envelope * (voice + breath * random());
    }
  }
  return { samples, sampleRate, truth };
}

/** Pitch coverage on 10ms samples of stable note interiors; missing notes count wrong.
 * Onsets: one-to-one matching within 80ms AND 50 cents. */
export function scoreHumming(notes: {start: number; dur: number; midi: number}[], truth: {start: number; dur: number; midi: number}[]) {
  let correct = 0, total = 0;
  for (const ref of truth) {
    for (let t = ref.start + 0.12; t < ref.start + ref.dur - 0.04; t += 0.01) {
      total++;
      if (notes.some(n => n.start <= t && n.start + n.dur >= t && Math.abs(n.midi - ref.midi) <= 0.5)) correct++;
    }
  }
  const used = new Set<number>();
  let matches = 0;
  for (const ref of truth) {
    const index = notes.findIndex((n, i) => !used.has(i) && Math.abs(n.start - ref.start) <= 0.08 && Math.abs(n.midi - ref.midi) <= 0.5);
    if (index >= 0) { used.add(index); matches++; }
  }
  return { correct, total, matches, reference: truth.length, detected: notes.length,
    pitchAccuracy: correct / total, onsetF1: 2 * matches / (truth.length + notes.length) };
}
