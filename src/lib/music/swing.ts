/**
 * Eighth-note swing for playback (GarageBand-style time feel).
 * The written score stays even; only attack times stretch/shrink within each quarter.
 * Compound meters (beat unit 8, e.g. 6/8) are left straight.
 */
export type SwingFeel = "straight" | "light" | "swing";

/** First-eighth share of a quarter: 50% even, 60% light, 2/3 triplet. */
export const SWING_STRAIGHT = 0.5;
export const SWING_LIGHT = 0.6;
export const SWING_TRIPLET = 2 / 3;

export const SWING_RATIO: Record<SwingFeel, number> = {
  straight: SWING_STRAIGHT,
  light: SWING_LIGHT,
  swing: SWING_TRIPLET,
};

export function isSwingFeel(value: string | null | undefined): value is SwingFeel {
  return value === "straight" || value === "light" || value === "swing";
}

export function clampSwingRatio(ratio: number): number {
  if (!Number.isFinite(ratio)) return SWING_STRAIGHT;
  return Math.min(0.75, Math.max(SWING_STRAIGHT, ratio));
}

/** Simple meters can take 8th-note swing; 6/8 and other compound meters already have a long-short beat. */
export function swingApplies(beatUnit: number): boolean {
  const unit = Number.isFinite(beatUnit) && beatUnit > 0 ? beatUnit : 4;
  return unit === 2 || unit === 4;
}

/** Map a fraction of a quarter [0, 1) from written time into swung time. */
export function swingFrac(frac: number, ratio: number): number {
  const r = clampSwingRatio(ratio);
  const f = frac - Math.floor(frac);
  if (Math.abs(r - SWING_STRAIGHT) < 1e-12) return f;
  if (f < 0.5) return (f / 0.5) * r;
  return r + ((f - 0.5) / 0.5) * (1 - r);
}

/** Inverse of swingFrac. */
export function unsWingFrac(swung: number, ratio: number): number {
  const r = clampSwingRatio(ratio);
  const s = swung - Math.floor(swung);
  if (Math.abs(r - SWING_STRAIGHT) < 1e-12) return s;
  if (s < r) return (s / r) * 0.5;
  return 0.5 + ((s - r) / (1 - r)) * 0.5;
}

/** Written quarter position → swung quarter position (tempo conversion still uses secondsAt). */
export function swingWritten(at: number, ratio: number, beatUnit = 4): number {
  if (!Number.isFinite(at) || !swingApplies(beatUnit)) return at;
  const q = Math.floor(at + 1e-12);
  return q + swingFrac(at - q, ratio);
}

export function unsWingWritten(at: number, ratio: number, beatUnit = 4): number {
  if (!Number.isFinite(at) || !swingApplies(beatUnit)) return at;
  const q = Math.floor(at + 1e-12);
  return q + unsWingFrac(at - q, ratio);
}
