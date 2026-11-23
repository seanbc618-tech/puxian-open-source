import { stateAt } from "./score-timeline.ts";
import type { Score } from "./theory.ts";

type BeamToken = { text: string; units: number; at?: number };
/** ABC whitespace ends a beam. Work on engraved durations, never mutate source notes. */
export function beamSeparators(bar: BeamToken[], score: Score): string[] {
  // Timeline engraving spells imported tuplets as single-note ratios. Reunite a
  // complete equal-duration group within this bar before deciding beam boundaries.
  for (let i = 0; i < bar.length; i++) {
    const ratio = bar[i].text.match(/\((\d):(\d):1/);
    if (!ratio) continue;
    const count = Number(ratio[1]);
    const run = bar.slice(i, i + count);
    if (run.length !== count || !run.every(t => t.units === bar[i].units && t.text.includes(ratio[0]))) continue;
    run.forEach((t, j) => {
      // The generic rhythm fallback uses 3:1 quarter heads for eighth triplets.
      // Prefer the conventional 3:2 spelling so abcjs can actually beam them.
      const normalTriplet = ratio[1] === "3" && ratio[2] === "1";
      if (normalTriplet) t.text = t.text.replace(/(\d+)([-)]*)$/, (_, length, tail) => `${Number(length) / 2}${tail}`);
      t.text = t.text.replace(ratio[0], j ? "" : `(${ratio[1]}:${normalTriplet ? 2 : ratio[2]}:${count}`);
    });
    i += count - 1;
  }
  let elapsed = 0, tupletLeft = 0, tupletGroup = 0;
  const groups = bar.map(token => {
    const at = token.at ?? 0;
    const meter = stateAt(score, at);
    const beat = meter.beatUnit === 8 && meter.beats >= 6 && meter.beats % 3 === 0
      ? 18 : 48 / meter.beatUnit;
    const tupleMark = token.text.match(/\((\d)(?::\d(?::(\d))?)?/);
    if (tupleMark) { tupletLeft = Number(tupleMark[2] ?? tupleMark[1]); tupletGroup++; }
    const tuple = tupletLeft > 0 ? tupletGroup : 0;
    if (token.units > 0 && tupletLeft) tupletLeft--;
    const start = elapsed;
    elapsed += token.units;
    const cell = Math.floor((start + 1e-7) / beat);
    // Exact, unsupported durations retain their annotation but have no abcjs
    // notehead. Including one in a beam crashes the renderer's stem layout.
    const eligible = token.units > 0 && token.units < 12 && !/z|拍/.test(token.text)
      && elapsed <= (cell + 1) * beat + 1e-7;
    return { eligible, cell, tuple };
  });
  return groups.map((g, i) => i && g.eligible && groups[i - 1].eligible
    && g.cell === groups[i - 1].cell && g.tuple === groups[i - 1].tuple ? "" : " ");
}
