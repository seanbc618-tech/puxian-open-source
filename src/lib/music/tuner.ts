/** Pure tuner math: frequency → nearest note / string, in cents against an adjustable A4. */
export const NOTE_NAMES = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"] as const;
export const JIANPU_DEGREES = ["1", "♯1", "2", "♭3", "3", "4", "♯4", "5", "♯5", "6", "♭7", "7"] as const;
export const A4_MIN = 430;
export const A4_MAX = 450;
export const IN_TUNE_CENTS = 5;

export type TuningPreset = { id: string; label: string; strings: readonly number[] };
/** Standard open strings, low to high (MIDI). */
export const TUNING_PRESETS: readonly TuningPreset[] = [
  { id: "free", label: "自由（任意音）", strings: [] },
  { id: "guitar", label: "吉他 EADGBE", strings: [40, 45, 50, 55, 59, 64] },
  { id: "ukulele", label: "尤克里里 GCEA", strings: [67, 60, 64, 69] },
  { id: "violin", label: "小提琴 GDAE", strings: [55, 62, 69, 76] },
];

export function clampA4(a4: number): number {
  if (!Number.isFinite(a4)) return 440;
  return Math.min(A4_MAX, Math.max(A4_MIN, Math.round(a4)));
}

/** Fractional MIDI number of a frequency for the given A4. */
export function hzToMidi(hz: number, a4 = 440): number {
  return 69 + 12 * Math.log2(hz / clampA4(a4));
}
export function midiToHz(midi: number, a4 = 440): number {
  return clampA4(a4) * 2 ** ((midi - 69) / 12);
}
/** Converts livePitch's A440-relative fractional MIDI back to Hz. */
export function livePitchHz(midi440: number): number {
  return 440 * 2 ** ((midi440 - 69) / 12);
}

export function noteName(midi: number): string {
  const pc = ((midi % 12) + 12) % 12;
  return `${NOTE_NAMES[pc]}${Math.floor(midi / 12) - 1}`;
}

/** Movable-do degree of a pitch class against the song's tonic pitch class. */
export function jianpuDegree(midi: number, tonicPc: number): string {
  return JIANPU_DEGREES[(((midi - tonicPc) % 12) + 12) % 12];
}

export type TunerReading = {
  hz: number;
  midi: number;
  name: string;
  cents: number;
  inTune: boolean;
  /** Set only for string presets. */
  string?: { index: number; midi: number; name: string; hint: "调高" | "调低" | "准" };
};

export function tunerReading(hz: number, a4 = 440, preset?: TuningPreset): TunerReading | null {
  if (!Number.isFinite(hz) || hz <= 0) return null;
  const exact = hzToMidi(hz, a4);
  let target = Math.round(exact);
  let stringInfo: TunerReading["string"];
  if (preset && preset.strings.length) {
    let best = 0;
    preset.strings.forEach((midi, index) => {
      if (Math.abs(exact - midi) < Math.abs(exact - preset.strings[best])) best = index;
    });
    target = preset.strings[best];
    const cents = (exact - target) * 100;
    stringInfo = {
      index: best,
      midi: target,
      name: noteName(target),
      hint: Math.abs(cents) <= IN_TUNE_CENTS ? "准" : cents < 0 ? "调高" : "调低",
    };
  }
  const cents = Math.round((exact - target) * 1000) / 10;
  return {
    hz: Math.round(hz * 10) / 10,
    midi: target,
    name: noteName(target),
    cents,
    inTune: Math.abs(cents) <= IN_TUNE_CENTS,
    ...(stringInfo ? { string: stringInfo } : {}),
  };
}

/** Needle position −1…1 for ±50 cents (clamped). */
export function needle(cents: number): number {
  return Math.max(-1, Math.min(1, cents / 50));
}

/** Median of recent frames to keep the needle steady; silence (null) clears after `hold` misses. */
export function smoothPitch(history: readonly (number | null)[], size = 5): number | null {
  const recent = history.slice(-size).filter((v): v is number => v != null && Number.isFinite(v));
  if (recent.length < Math.min(2, size)) return null;
  const sorted = [...recent].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
