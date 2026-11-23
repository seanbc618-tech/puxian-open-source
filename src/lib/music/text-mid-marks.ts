/** Shared helpers for mid-score marks in 123 / 番茄 / jianpu-ly text.
 * Type-only use of gradual-tempo shapes; no runtime import, so the
 * gradual-tempo chunk is not pulled into a first-screen mapDeps stem.
 */
import { CHANGE_BPM_MAX, CHANGE_BPM_MIN, clampChangeBpm } from "./score-timeline.ts";
import type { GradualKind, GradualTempo } from "./gradual-tempo.ts";

const EPS = 1e-6;

export type TempoWords =
  | { role: "start"; kind: GradualKind; toBpm?: number }
  | { role: "end" };

/** Strip a 123 position prefix (`^` `_` `<` `>` `@`) or leftover whitespace. */
export function stripAnnotationPrefix(text: string): string {
  return text.replace(/^[\^_<>@]+/, "").trim();
}

function takeTargetBpm(text: string): { rest: string; toBpm?: number } {
  const m = /(?:♩\s*=\s*|1\s*\/\s*4\s*=\s*|=\s*)(\d+(?:\.\d+)?)/.exec(text);
  if (!m) return { rest: text.trim() };
  const bpm = Number(m[1]);
  if (!Number.isFinite(bpm)) return { rest: text.trim() };
  const rest = `${text.slice(0, m.index)} ${text.slice(m.index + m[0].length)}`.replace(/\s+/g, " ").trim();
  const rounded = Math.round(bpm);
  if (rounded < CHANGE_BPM_MIN || rounded > CHANGE_BPM_MAX) return { rest };
  return { rest, toBpm: clampChangeBpm(bpm) };
}

/** Rit./accel./a tempo wording used in 123 `"^rit."` notes, 番茄 `&rit`, and jianpu-ly `^"rit."`. */
export function readTempoWords(raw: string): TempoWords | null {
  const { rest, toBpm } = takeTargetBpm(stripAnnotationPrefix(raw).replace(/\s+/g, " ").trim());
  if (!rest) return null;
  if (/^(a\s*tempo|atempo|in\s*tempo|tempo)$/i.test(rest)) return { role: "end" };
  if (/渐慢/.test(rest) || /\brit(ard(ando)?)?\.?\b/i.test(rest) || /\brall(entando)?\.?\b/i.test(rest)) {
    return toBpm !== undefined ? { role: "start", kind: "rit", toBpm } : { role: "start", kind: "rit" };
  }
  if (/渐快/.test(rest) || /\baccel(erando)?\.?\b/i.test(rest) || /\bstringendo\b/i.test(rest)) {
    return toBpm !== undefined ? { role: "start", kind: "accel", toBpm } : { role: "start", kind: "accel" };
  }
  return null;
}

export function gradualWordsLabel(kind: GradualKind, toBpm?: number): string {
  const base = kind === "rit" ? "rit." : "accel.";
  return toBpm !== undefined ? `${base}=${toBpm}` : base;
}

function roundedAt(at: number) {
  return Math.round(Math.max(0, at) * 1e6) / 1e6;
}

/** Local canonicalizer; same rules as gradual-tempo, kept here to avoid that chunk. */
export function cleanGradualTempos(list: readonly GradualTempo[] | unknown): GradualTempo[] | undefined {
  if (!Array.isArray(list)) return undefined;
  const cleaned: GradualTempo[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const from = roundedAt(Number((item as GradualTempo).from));
    const to = roundedAt(Number((item as GradualTempo).to));
    const kind = (item as GradualTempo).kind;
    if ((kind !== "rit" && kind !== "accel") || !(to > from + EPS)) continue;
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

export function shiftGradualTempos(list: GradualTempo[] | undefined, pad: number): void {
  if (!list?.length || !pad) return;
  for (const span of list) {
    span.from += pad;
    span.to += pad;
  }
}

const DEFAULT_SPAN = 4;

/** Close a words-only start: next mid-score tempo, else a short span clipped to the end. */
export function defaultGradualClose(
  from: number,
  kind: GradualKind,
  scoreEnd: number,
  nextTempoAt?: number,
  toBpm?: number,
): GradualTempo | undefined {
  const start = roundedAt(from);
  let to: number;
  if (nextTempoAt !== undefined && nextTempoAt > start + EPS) to = nextTempoAt;
  else if (scoreEnd > start + EPS) to = Math.min(scoreEnd, start + DEFAULT_SPAN);
  else to = start + DEFAULT_SPAN;
  to = roundedAt(to);
  if (!(to > start + EPS)) return undefined;
  const span: GradualTempo = { from: start, to, kind };
  if (toBpm !== undefined) span.toBpm = clampChangeBpm(toBpm);
  return span;
}

export function nextBpmAfter(changes: { at: number; bpm?: number }[] | undefined, from: number): number | undefined {
  const marks = (changes ?? []).filter((c) => c.bpm !== undefined && c.at > from + EPS).sort((a, b) => a.at - b.at);
  return marks[0]?.at;
}
