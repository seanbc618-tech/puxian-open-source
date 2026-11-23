/** Quarter-note lengths that can be read without a tuplet or an explicit label. */
function symbolRhythm(duration: number, factors: number[]): boolean {
  for (let power = -4; power <= 3; power++) {
    const base = 2 ** power;
    if (factors.some((f) => Math.abs(duration - base * f) < 1e-7)) return true;
  }
  return false;
}

export function standardRhythm(duration: number): boolean {
  return symbolRhythm(duration, [1, 1.5]);
}

function standardAbcRhythm(duration: number): boolean {
  return symbolRhythm(duration, [1, 1.5, 1.75, 1.875, 1.9375, 1.96875]);
}

/** Recover source fractions without exposing floating-point accumulation in notation. */
export function rhythmFraction(value: number): string {
  for (let denominator = 1; denominator <= 65536; denominator++) {
    const numerator = Math.round(value * denominator);
    if (Math.abs(value - numerator / denominator) < Math.min(1e-7, Math.abs(value) * 1e-7))
      return denominator === 1 ? `${numerator}` : `${numerator}/${denominator}`;
  }
  const numerator = Math.round(value * 1e9);
  const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
  const common = gcd(Math.abs(numerator), 1e9);
  return `${numerator / common}/${1e9 / common}`;
}

/** ABC supports single-digit tuplet ratios. Never replace an unsupported duration by a nearby one. */
export function abcRhythm(units: number): { length: string; prefix: string } {
  if (standardAbcRhythm(units / 12)) return { length: rhythmFraction(units), prefix: "" };
  for (let p = 2; p <= 9; p++)
    for (let q = 1; q <= 9; q++) {
      const written = (units * p) / q;
      if (standardAbcRhythm(written / 12))
        return { length: rhythmFraction(written), prefix: `(${p}:${q}:1` };
    }
  return { length: rhythmFraction(units), prefix: `"^[${rhythmFraction(units / 12)}拍]"` };
}

export function exactRhythm(value: number): number {
  const [numerator, denominator = "1"] = rhythmFraction(value).split("/");
  return Number(numerator) / Number(denominator);
}

let tupletAtoms: number[] | undefined;
function supportedAtoms(): number[] {
  if (!tupletAtoms) {
    const values = new Set<number>();
    for (let power = -4; power <= 3; power++)
      for (const dots of [1, 1.5, 1.75, 1.875, 1.9375, 1.96875])
        for (let p = 2; p <= 9; p++)
          for (let q = 1; q <= 9; q++) values.add((2 ** power * dots * q) / p);
    tupletAtoms = [...values].sort((a, b) => b - a);
  }
  return tupletAtoms;
}

/** Split long / irregular binary values into tied, readable atoms; keep tuplet time exact. */
export function rhythmPieces(duration: number): number[] {
  duration = exactRhythm(duration);
  if (!abcRhythm(duration * 12).prefix.includes("拍")) return [duration];
  for (const factor of [1, 3, 5, 7, 9]) {
    const written = duration * factor;
    if (Math.abs(written * 16 - Math.round(written * 16)) > 1e-7) continue;
    const parts: number[] = [];
    let left = written;
    for (let power = 3; power >= -4; power--) {
      const base = 2 ** power;
      while (left >= base - 1e-8) {
        parts.push(base / factor);
        left -= base;
      }
    }
    if (Math.abs(left) < 1e-8 && parts.length) return parts;
  }
  // A composite tuplet denominator can sometimes be spelled as tied ratios:
  // 1/15 = 1/24 + 1/40. Each written atom is supported by abcjs.
  for (const first of supportedAtoms()) {
    const rest = duration - first;
    if (rest <= 1e-8) continue;
    if (!abcRhythm(rest * 12).prefix.includes("拍")) return [first, rest];
  }
  return [duration];
}
