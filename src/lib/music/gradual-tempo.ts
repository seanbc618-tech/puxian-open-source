/**
 * Gradual tempo changes (渐快 / 渐慢): rit. and accel. over a written span.
 * Playback, the metronome and MIDI follow a smooth (sampled) curve;
 * written durations are not rewritten. Stored on the score as
 * `gradualTempos` (isScore / score-core are left unchanged).
 * Idea from MuseScore gradual tempo changes; no upstream code, brand,
 * copy, or assets. See docs/gradual-tempo.md.
 */
import type { Score, ScoreChange } from "./theory.ts";
import {
  CHANGE_BPM_MAX,
  CHANGE_BPM_MIN,
  barNumberAt,
  clampChangeBpm,
  tempoAt,
  tempoMarks,
} from "./tempo-mark.ts";

const EPS = 1e-6;
/** Sample the curve every 32nd note so MIDI / secondsAt stay close to linear BPM. */
const SAMPLE = 0.125;

function scoreQuarters(score: Score): number {
  const voices = [score.notes, score.voice2, ...(score.extraVoices ?? [])];
  return Math.max(0, ...voices.map((notes) =>
    (notes ?? []).reduce((sum, note) => sum + (Number.isFinite(note.dur) ? note.dur : 0), 0),
  ));
}


export { CHANGE_BPM_MAX, CHANGE_BPM_MIN, clampChangeBpm };

export type GradualKind = "rit" | "accel";

export type GradualTempo = {
  /** Inclusive start, in quarter notes. */
  from: number;
  /** Exclusive end, in quarter notes. */
  to: number;
  kind: GradualKind;
  /** Target metronome mark. Wins over `ratio` when both are present. */
  toBpm?: number;
  /** Target as a fraction of the starting tempo (e.g. 0.75). */
  ratio?: number;
};

export const DEFAULT_RIT_RATIO = 0.75;
export const DEFAULT_ACCEL_RATIO = 4 / 3;
export const DEFAULT_SPAN_QUARTERS = 4;

export function gradualKindLabel(kind: GradualKind): string {
  return kind === "rit" ? "渐慢 rit." : "渐快 accel.";
}

function almost(a: number, b: number) {
  return Math.abs(a - b) <= EPS;
}

function roundedAt(at: number) {
  return Math.round(Math.max(0, at) * 1e6) / 1e6;
}

export type ScoreWithGradual = Score & { gradualTempos?: GradualTempo[] };

function rawList(score: Pick<Score, never> | ScoreWithGradual): unknown {
  return (score as ScoreWithGradual).gradualTempos;
}

function isKind(value: unknown): value is GradualKind {
  return value === "rit" || value === "accel";
}

/** Drop empty / invalid marks and keep spans in written order, non-overlapping. */
export function canonicalGradualTempos(list: readonly GradualTempo[] | unknown): GradualTempo[] | undefined {
  if (!Array.isArray(list)) return undefined;
  const cleaned: GradualTempo[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const from = roundedAt(Number((item as GradualTempo).from));
    const to = roundedAt(Number((item as GradualTempo).to));
    const kind = (item as GradualTempo).kind;
    if (!isKind(kind) || !(to > from + EPS)) continue;
    const next: GradualTempo = { from, to, kind };
    const toBpm = (item as GradualTempo).toBpm;
    const ratio = (item as GradualTempo).ratio;
    if (toBpm !== undefined && Number.isFinite(toBpm)) next.toBpm = clampChangeBpm(toBpm);
    if (ratio !== undefined && Number.isFinite(ratio) && ratio > 0) {
      next.ratio = Math.min(4, Math.max(0.25, Math.round(ratio * 1000) / 1000));
    }
    cleaned.push(next);
  }
  cleaned.sort((a, b) => a.from - b.from || a.to - b.to);
  const kept: GradualTempo[] = [];
  for (const span of cleaned) {
    const last = kept[kept.length - 1];
    if (last && span.from < last.to - EPS) continue;
    kept.push(span);
  }
  return kept.length ? kept : undefined;
}

export function gradualTempos(score: Score): GradualTempo[] {
  return canonicalGradualTempos(rawList(score)) ?? [];
}

export function gradualTempoAt(score: Score, at: number): GradualTempo | undefined {
  const when = roundedAt(at);
  return gradualTempos(score).find((span) => when >= span.from - EPS && when < span.to - EPS);
}

export function hasGradualStart(score: Score, at: number): boolean {
  return gradualTempos(score).some((span) => almost(span.from, at));
}

/** Next mid-score metronome mark strictly after `at`, if any. */
export function nextTempoMarkAfter(score: Pick<Score, "changes">, at: number): number | undefined {
  const marks = tempoMarks(score).filter((mark) => mark.at > at + EPS);
  return marks[0]?.at;
}

/** End of a one-note span: next tempo mark, or `from` plus a few beats, clipped to the score. */
export function defaultGradualEnd(
  score: Score,
  from: number,
  mode: "next-mark" | "beats" = "next-mark",
  spanQuarters = DEFAULT_SPAN_QUARTERS,
): number {
  const start = roundedAt(from);
  const end = scoreQuarters(score);
  const span = Number.isFinite(spanQuarters) && spanQuarters > EPS ? spanQuarters : DEFAULT_SPAN_QUARTERS;
  if (mode === "next-mark") {
    const next = nextTempoMarkAfter(score, start);
    if (next !== undefined && next > start + EPS) return Math.min(next, Math.max(start + EPS, end) || next);
  }
  const cap = end > start + EPS ? end : start + span;
  return roundedAt(Math.min(cap, start + span));
}

export function resolveGradualTarget(score: Pick<Score, "bpm" | "changes">, span: GradualTempo): number {
  const startBpm = tempoAt(score, span.from);
  if (span.toBpm !== undefined) return clampChangeBpm(span.toBpm);
  if (span.ratio !== undefined) return clampChangeBpm(startBpm * span.ratio);
  const mark = tempoMarks(score).find((item) => almost(item.at, span.to));
  if (mark) return clampChangeBpm(mark.bpm);
  const ratio = span.kind === "rit" ? DEFAULT_RIT_RATIO : DEFAULT_ACCEL_RATIO;
  return clampChangeBpm(startBpm * ratio);
}

function withGradual(score: Score, list: GradualTempo[] | undefined): Score {
  const out: ScoreWithGradual = { ...score };
  const next = canonicalGradualTempos(list);
  if (next) out.gradualTempos = next;
  else delete out.gradualTempos;
  return out;
}

/**
 * Add or replace a gradual span. Overlapping earlier marks are dropped.
 * Does not rewrite written durations or Score.changes (those stay for 途中速度).
 */
export function setGradualTempo(
  score: Score,
  input: { from: number; to: number; kind: GradualKind; toBpm?: number; ratio?: number },
): Score {
  const from = roundedAt(input.from);
  let to = roundedAt(input.to);
  if (!(to > from + EPS)) to = roundedAt(from + DEFAULT_SPAN_QUARTERS);
  if (!(to > from + EPS)) return score;
  let kind = input.kind;
  const startBpm = tempoAt(score, from);
  const draft: GradualTempo = { from, to, kind };
  if (input.toBpm !== undefined && Number.isFinite(input.toBpm)) draft.toBpm = clampChangeBpm(input.toBpm);
  else if (input.ratio !== undefined && Number.isFinite(input.ratio) && input.ratio > 0) {
    draft.ratio = Math.min(4, Math.max(0.25, Math.round(input.ratio * 1000) / 1000));
  }
  const target = resolveGradualTarget(score, draft);
  if (draft.toBpm !== undefined || draft.ratio !== undefined) {
    kind = target < startBpm - 0.5 ? "rit" : target > startBpm + 0.5 ? "accel" : kind;
    draft.kind = kind;
  }
  const kept = gradualTempos(score).filter((span) => span.to <= from + EPS || span.from >= to - EPS);
  kept.push(draft);
  return withGradual(score, kept);
}

/** Remove the span that starts at `at`, or the one covering it. */
export function clearGradualTempo(score: Score, at: number): Score {
  const when = roundedAt(at);
  const current = gradualTempos(score);
  if (!current.length) return score;
  const kept = current.filter((span) => !almost(span.from, when) && !(when >= span.from - EPS && when < span.to - EPS));
  if (kept.length === current.length) return score;
  return withGradual(score, kept);
}

export function gradualTempoSummary(score: Score): string {
  return gradualTempos(score)
    .map((span) => {
      const fromBar = barNumberAt(score, span.from);
      const toBar = barNumberAt(score, Math.max(span.from, span.to - EPS));
      const target = resolveGradualTarget(score, span);
      const where = fromBar === toBar ? `第 ${fromBar} 小节` : `第 ${fromBar}–${toBar} 小节`;
      return `${where} ${gradualKindLabel(span.kind)} 至 ♩=${target}`;
    })
    .join("、");
}

function isEmptyChange(change: ScoreChange) {
  return change.bpm === undefined && change.beats === undefined && change.key === undefined;
}

export { scoreWithGradualTempo } from "./fermata.ts";

/** Remap spans onto an unrolled (repeated / jumped) timeline. */
export function unrollGradualTempos(
  list: readonly GradualTempo[] | undefined,
  segments: readonly { at: number; from: number; to: number }[],
): GradualTempo[] | undefined {
  const marks = canonicalGradualTempos(list);
  if (!marks?.length) return undefined;
  const moved: GradualTempo[] = [];
  for (const seg of segments) {
    for (const span of marks) {
      const from = Math.max(span.from, seg.from);
      const to = Math.min(span.to, seg.to);
      if (!(to > from + EPS)) continue;
      moved.push({
        ...span,
        from: roundedAt(seg.at + from - seg.from),
        to: roundedAt(seg.at + to - seg.from),
      });
    }
  }
  return canonicalGradualTempos(moved);
}
