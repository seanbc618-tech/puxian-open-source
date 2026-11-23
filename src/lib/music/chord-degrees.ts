import { parseChordSymbol, pitchClassOf, formatPitch, type ChordSymbol } from "./chord-symbol.ts";
import type { KeyName, Mode, Score } from "./theory.ts";
import { nextBar, stateAt } from "./score-timeline.ts";
import { barStarts } from "./practice.ts";
import { scoreQuarters } from "./voices.ts";
const MAJOR = [0, 2, 4, 5, 7, 9, 11],
  MINOR = [0, 2, 3, 5, 7, 8, 10];
const LETTERS = "CDEFGAB";
const PCS = [0, 2, 4, 5, 7, 9, 11];
export function diatonicChords(key: KeyName, mode: Mode): string[] {
  const root = parseChordSymbol(key)!.root,
    start = LETTERS.indexOf(root.letter),
    pc = pitchClassOf(root);
  const scale = mode === "minor" ? MINOR : MAJOR;
  const suffix =
    mode === "minor" ? ["m", "dim", "", "m", "m", "", ""] : ["", "m", "m", "", "", "m", "dim"];
  return scale.map((n, i) => {
    const letter = LETTERS[(start + i) % 7],
      target = (pc + n) % 12;
    let acc = (target - PCS[(start + i) % 7] + 12) % 12;
    if (acc > 6) acc -= 12;
    return formatPitch({ letter, acc }) + suffix[i];
  });
}
export function chordDegree(symbol: string, key: KeyName, mode: Mode, numeric = false): string {
  const parsed = parseChordSymbol(symbol);
  if (!parsed) return symbol;
  const tonic = parseChordSymbol(key)!.root,
    scale = mode === "minor" ? MINOR : MAJOR;
  const i = (LETTERS.indexOf(parsed.root.letter) - LETTERS.indexOf(tonic.letter) + 7) % 7;
  let alteration = (pitchClassOf(parsed.root) - pitchClassOf(tonic) - scale[i] + 12) % 12;
  if (alteration > 6) alteration -= 12;
  const accidental = alteration < 0 ? "♭".repeat(-alteration) : "♯".repeat(alteration);
  const minor = [
    "minor",
    "minor-seventh",
    "diminished",
    "diminished-seventh",
    "half-diminished",
  ].includes(parsed.quality);
  let degree = numeric ? String(i + 1) : ["I", "II", "III", "IV", "V", "VI", "VII"][i];
  if (minor) degree = numeric ? degree + "m" : degree.toLowerCase();
  const q = parsed.quality;
  if (q.includes("diminished")) {
    if (numeric) degree = String(i + 1);
    degree += q === "half-diminished" ? "ø" : "°";
  }
  if (q === "augmented") degree += "+";
  if (
    q === "dominant" ||
    q === "minor-seventh" ||
    q === "diminished-seventh" ||
    q === "half-diminished"
  )
    degree += "7";
  if (q === "major-seventh") degree += "maj7";
  if (q === "suspended-second") degree += "sus2";
  if (q === "suspended-fourth") degree += "sus4";
  if (q === "power") degree += "5";
  return (
    accidental +
    degree +
    (parsed.unknown ?? "") +
    (parsed.bass ? "/" + chordDegree(formatPitch(parsed.bass), key, mode, numeric) : "")
  );
}
export const PROGRESSIONS = [
  { name: "I–V–vi–IV", degrees: [1, 5, 6, 4] },
  { name: "vi–IV–I–V", degrees: [6, 4, 1, 5] },
  { name: "I–vi–IV–V", degrees: [1, 6, 4, 5] },
  { name: "ii–V–I", degrees: [2, 5, 1] },
  { name: "卡农 I–V–vi–iii–IV–I–IV–V", degrees: [1, 5, 6, 3, 4, 1, 4, 5] },
];
/** One chord per existing measure, respecting meter/key changes; never extend the score. */
export function expandProgression(
  score: Score,
  degrees: readonly number[],
  selectedAt = 0,
): ChordSymbol[] {
  const starts = barStarts(score),
    end = scoreQuarters(score);
  let at = starts.filter((n) => n <= selectedAt + 1e-8).at(-1) ?? 0;
  const result: ChordSymbol[] = [];
  for (const d of degrees) {
    if (at >= end - 1e-8) break;
    const state = stateAt(score, at),
      symbol = diatonicChords(state.key, state.mode)[d - 1];
    if (symbol) result.push({ at, symbol });
    at = nextBar(score, at);
  }
  return result;
}
export function mergeProgression(
  existing: readonly ChordSymbol[],
  preview: readonly ChordSymbol[],
  overwrite = false,
): ChordSymbol[] {
  return [
    ...existing.filter((e) => !overwrite || !preview.some((p) => Math.abs(p.at - e.at) < 1e-8)),
    ...preview.filter((p) => overwrite || !existing.some((e) => Math.abs(p.at - e.at) < 1e-8)),
  ].sort((a, b) => a.at - b.at);
}
