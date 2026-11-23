import { voiceLabel, voiceList } from "./voices.ts";
import type { Score } from "./theory.ts";
import { meterAt, nextBar } from "./score-timeline.ts";

export type BarCheck = {
  voice: number;
  measure: number;
  actual: number;
  expected: number;
  missing: number;
};
const EPS = 1e-6;

/** Score has no explicit bars: full bars (and short bars ended by a mid-measure meter change)
 * are automatic; only a written tail that does not fill its current meter is reported.
 * Counts rests and each chord once, before engraving adds padding to the shorter voice.
 * Values in the result use the meter's denominator (one eighth in 6/8), not quarters.
 */
export function checkScoreBars(
  score: Pick<Score, "notes" | "voice2" | "extraVoices" | "beats" | "beatUnit" | "changes">,
): BarCheck[] {
  if (
    !Number.isFinite(score.beats) ||
    score.beats <= 0 ||
    !Number.isFinite(score.beatUnit) ||
    score.beatUnit <= 0
  )
    return [];
  const issues: BarCheck[] = [];
  const voices = voiceList(score);
  voices.forEach((notes, voice) => {
    if (!notes?.length) return;
    const total = notes.reduce(
      (sum, note) => sum + (Number.isFinite(note.dur) && note.dur > 0 ? note.dur : 0),
      0,
    );
    if (total <= EPS) return;
    let measure = 1;
    let start = 0;
    while (start < total - EPS) {
      const end = nextBar(score, start);
      if (!(end > start + EPS)) break;
      const filled = Math.min(total, end) - start;
      const length = end - start;
      const last = total <= end + EPS;
      if (last && filled + EPS < length) {
        const meter = meterAt(score, start);
        const actual = (filled * meter.beatUnit) / 4;
        issues.push({
          voice: voice as number,
          measure,
          actual,
          expected: meter.beats,
          missing: meter.beats - actual,
        });
      }
      measure += 1;
      start = end;
    }
  });
  return issues;
}

export function describeBarCheck(issue: BarCheck, beatUnit: number): string {
  const number = (value: number) => String(Number(value.toFixed(3)));
  return `${voiceLabel(issue.voice)}第 ${issue.measure} 小节：已有 ${number(issue.actual)} 拍，应为 ${number(issue.expected)} 拍，差 ${number(issue.missing)} 拍（每拍为 1/${beatUnit} 音符）。`;
}
