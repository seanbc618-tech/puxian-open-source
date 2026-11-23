import {
  parseChordSymbol,
  pitchClassOf,
  transposeChordSymbol,
  formatPitch,
  spellPitchClass,
  type ChordQuality,
} from "./chord-symbol.ts";
export type ChordInstrument = "guitar" | "ukulele" | "piano";
export const TUNINGS = { guitar: [40, 45, 50, 55, 59, 64], ukulele: [67, 60, 64, 69] } as const;
const INTERVALS: Record<ChordQuality, number[]> = {
  major: [0, 4, 7],
  minor: [0, 3, 7],
  dominant: [0, 4, 7, 10],
  "major-seventh": [0, 4, 7, 11],
  "minor-seventh": [0, 3, 7, 10],
  diminished: [0, 3, 6],
  augmented: [0, 4, 8],
  "suspended-second": [0, 2, 7],
  "suspended-fourth": [0, 5, 7],
  "half-diminished": [0, 3, 6, 10],
  "diminished-seventh": [0, 3, 6, 9],
  power: [0, 7],
};
// Low to high strings. -1 means muted. Independently authored standard teaching shapes.
const GUITAR: Record<string, number[]> = {
  C: [-1, 3, 2, 0, 1, 0],
  D: [-1, -1, 0, 2, 3, 2],
  E: [0, 2, 2, 1, 0, 0],
  F: [1, 3, 3, 2, 1, 1],
  G: [3, 2, 0, 0, 0, 3],
  A: [-1, 0, 2, 2, 2, 0],
  B: [-1, 2, 4, 4, 4, 2],
  Am: [-1, 0, 2, 2, 1, 0],
  Bm: [-1, 2, 4, 4, 3, 2],
  Cm: [-1, 3, 5, 5, 4, 3],
  Dm: [-1, -1, 0, 2, 3, 1],
  Em: [0, 2, 2, 0, 0, 0],
  Fm: [1, 3, 3, 1, 1, 1],
  Gm: [3, 5, 5, 3, 3, 3],
  C7: [-1, 3, 2, 3, 1, 0],
  D7: [-1, -1, 0, 2, 1, 2],
  E7: [0, 2, 0, 1, 0, 0],
  F7: [1, 3, 1, 2, 1, 1],
  G7: [3, 2, 0, 0, 0, 1],
  A7: [-1, 0, 2, 0, 2, 0],
  B7: [-1, 2, 1, 2, 0, 2],
  Cmaj7: [-1, 3, 2, 0, 0, 0],
  Dmaj7: [-1, -1, 0, 2, 2, 2],
  Emaj7: [0, 2, 1, 1, 0, 0],
  Fmaj7: [-1, -1, 3, 2, 1, 0],
  Gmaj7: [3, 2, 0, 0, 0, 2],
  Amaj7: [-1, 0, 2, 1, 2, 0],
  Am7: [-1, 0, 2, 0, 1, 0],
  Bm7: [-1, 2, 4, 2, 3, 2],
  Dm7: [-1, -1, 0, 2, 1, 1],
  Em7: [0, 2, 0, 0, 0, 0],
  Asus2: [-1, 0, 2, 2, 0, 0],
  Dsus2: [-1, -1, 0, 2, 3, 0],
  Csus2: [-1, 3, 0, 0, 1, 3],
  Asus4: [-1, 0, 2, 2, 3, 0],
  Dsus4: [-1, -1, 0, 2, 3, 3],
  Esus4: [0, 2, 2, 2, 0, 0],
  Cdim: [-1, 3, 4, 5, 4, -1],
  Caug: [-1, 3, 2, 1, 1, -1],
};
const UKULELE: Record<string, number[]> = {
  C: [0, 0, 0, 3],
  D: [2, 2, 2, 0],
  E: [4, 4, 4, 2],
  F: [2, 0, 1, 0],
  G: [0, 2, 3, 2],
  A: [2, 1, 0, 0],
  B: [4, 3, 2, 2],
  Am: [2, 0, 0, 0],
  Bm: [4, 2, 2, 2],
  Cm: [0, 3, 3, 3],
  Dm: [2, 2, 1, 0],
  Em: [0, 4, 3, 2],
  Fm: [1, 0, 1, 3],
  Gm: [0, 2, 3, 1],
  C7: [0, 0, 0, 1],
  D7: [2, 2, 2, 3],
  E7: [1, 2, 0, 2],
  F7: [2, 3, 1, 0],
  G7: [0, 2, 1, 2],
  A7: [0, 1, 0, 0],
  B7: [2, 3, 2, 2],
  Cmaj7: [0, 0, 0, 2],
  Fmaj7: [2, 4, 1, 3],
  Gmaj7: [0, 2, 2, 2],
  Am7: [0, 0, 0, 0],
  Dm7: [2, 2, 1, 3],
  Em7: [0, 2, 0, 2],
  Csus2: [0, 2, 3, 3],
  Csus4: [0, 0, 1, 3],
  Cdim: [-1, 3, 2, 3],
  Caug: [1, 0, 0, 3],
};
export function chordTones(symbol: string): number[] {
  const parsed = parseChordSymbol(symbol);
  if (!parsed) return [];
  // Unknown extensions cannot safely be represented as a plain triad.
  if (parsed.unknown) return [];
  return INTERVALS[parsed.quality].map((n) => (n + pitchClassOf(parsed.root)) % 12);
}
export function shapeSymbol(symbol: string, capo: number): string {
  return transposeChordSymbol(symbol, -Math.max(0, Math.min(7, Math.round(capo))), "C", "major")
    .symbol;
}
/** Bounded search: all chord tones, contiguous sounding strings, at most four fingers or a simple barre. */
export function searchFingering(
  tones: readonly number[],
  tuning: readonly number[],
): number[] | null {
  if (!tones.length) return null;
  let best: number[] | null = null,
    cost = Infinity;
  const options = tuning.map((m) => [
    -1,
    ...Array.from({ length: 6 }, (_, i) => i).filter((f) => tones.includes((m + f) % 12)),
  ]);
  const visit = (frets: number[]) => {
    if (frets.length < tuning.length) {
      for (const f of options[frets.length]) visit([...frets, f]);
      return;
    }
    const sounding = frets.map((f, i) => (f < 0 ? -1 : (tuning[i] + f) % 12));
    if (!tones.every((t) => sounding.includes(t))) return;
    const first = frets.findIndex((f) => f >= 0),
      last = frets.length - 1 - [...frets].reverse().findIndex((f) => f >= 0);
    if (frets.slice(first, last + 1).some((f) => f < 0)) return;
    const pressed = frets.filter((f) => f > 0),
      min = Math.min(...pressed),
      max = Math.max(0, ...pressed);
    if (pressed.length && max - min > 4) return;
    // A barre may only pass through strings fretted at or above it; never an open string.
    const barre = pressed.length
      ? frets.slice(frets.indexOf(min), frets.lastIndexOf(min) + 1).every((f) => f >= min)
      : false;
    const fingers =
      pressed.length - (barre ? Math.max(0, pressed.filter((f) => f === min).length - 1) : 0);
    if (fingers > 4) return;
    const c =
      fingers * 2 +
      max +
      (pressed.length ? max - min : 0) +
      frets.filter((f) => f < 0).length * 3 -
      frets.filter((f) => f === 0).length * 2;
    if (c < cost) {
      cost = c;
      best = frets;
    }
  };
  visit([]);
  return best;
}
export function chordDiagram(symbol: string, instrument: ChordInstrument, capo = 0) {
  const shape = instrument === "piano" ? symbol : shapeSymbol(symbol, capo);
  const parsed = parseChordSymbol(shape),
    tones = chordTones(shape);
  const rootShape = shape.split("/")[0];
  const frets =
    instrument === "piano" || !tones.length
      ? null
      : [
          ...((instrument === "guitar" ? GUITAR : UKULELE)[rootShape] ??
            searchFingering(tones, TUNINGS[instrument]) ??
            []),
        ];
  return {
    shape,
    tones,
    frets: frets?.length ? frets : null,
    bass: parsed?.bass ? formatPitch(parsed.bass) : undefined,
    notes: tones.map((pc) => formatPitch(spellPitchClass(pc, "C", "major"))),
  };
}
export function capoCost(symbols: readonly string[], capo: number): number {
  return (
    symbols.reduce((sum, s) => {
      const d = chordDiagram(s, "guitar", capo);
      if (!d.frets) return sum + 40;
      const f = d.frets,
        pressed = f.filter((n) => n > 0);
      return (
        sum +
        pressed.length * 2 +
        Math.max(0, ...pressed) -
        f.filter((n) => n === 0).length * 3 +
        (f.filter((n) => n === 1).length >= 3 ? 6 : 0)
      );
    }, 0) +
    capo * 1.5
  );
}
export function recommendCapo(symbols: readonly string[]): number {
  return Array.from({ length: 8 }, (_, i) => i).sort(
    (a, b) => capoCost(symbols, a) - capoCost(symbols, b),
  )[0];
}

/** Written-quarter lookup, including silence before the first mark. */
export function currentAndNextChord(
  symbols: readonly { at: number; symbol: string }[],
  at: number,
) {
  let index = -1;
  symbols.forEach((mark, i) => {
    if (mark.at <= at + 1e-8) index = i;
  });
  return { current: index >= 0 ? symbols[index] : undefined, next: symbols[index + 1] };
}
