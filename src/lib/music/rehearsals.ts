/**
 * Section / rehearsal labels (前奏、主歌、副歌、A …): sit at a bar start, show on
 * the jianpu (and the staff), and come in from MusicXML / 123 / ABC.
 * Idea absorbed from TT作曲家 (Chinese jianpu editors put a boxed label at the
 * start of a section); no upstream code. See docs/rehearsals.md.
 */
import { barStarts } from "./practice.ts";
import type { RehearsalMark, Score, ScoreNote } from "./theory.ts";

export type { RehearsalMark };

export const REHEARSAL_PRESETS = ["前奏", "主歌", "副歌", "间奏", "尾声", "A", "B", "C"] as const;
export const MAX_REHEARSAL_LABEL = 12;

const EPS = 1e-6;

export function cleanRehearsalLabel(raw: string): string | null {
  const text = raw.replace(/\s+/g, " ").trim().slice(0, MAX_REHEARSAL_LABEL);
  return text || null;
}

/** True when a 123 / ABC `P:` value is a play-order string (AABA), not a single section name. */
export function isPlayOrder(value: string): boolean {
  const t = value.trim();
  if (!t) return false;
  if (/,/.test(t) && t.split(/\s*,\s*/).every((p) => /^[A-Ha-h]$/.test(p))) return true;
  return /^[A-Ha-h]{3,}$/.test(t);
}

export function canonicalRehearsals(marks: unknown): RehearsalMark[] | undefined {
  if (!Array.isArray(marks)) return undefined;
  const cleaned: RehearsalMark[] = [];
  const seen = new Set<number>();
  const sorted = marks
    .map((item) => item as Partial<RehearsalMark>)
    .filter((item) => item && Number.isFinite(item.at) && (item.at as number) >= 0 && (item.at as number) <= 1_000_000 && typeof item.label === "string")
    .map((item) => ({ at: item.at as number, label: cleanRehearsalLabel(item.label!) }))
    .filter((item): item is RehearsalMark => Boolean(item.label))
    .sort((a, b) => a.at - b.at);
  for (const item of sorted) {
    const key = Math.round(item.at * 1e6) / 1e6;
    if (seen.has(key)) {
      cleaned[cleaned.length - 1] = { at: key, label: item.label };
      continue;
    }
    seen.add(key);
    cleaned.push({ at: key, label: item.label });
  }
  return cleaned.length ? cleaned : undefined;
}

export function barStartAt(score: Score, at: number): number {
  const starts = barStarts(score);
  let start = 0;
  for (const q of starts) if (q <= at + EPS) start = q;
  return start;
}

/** Set or replace the label on the bar that contains `at`; `label: null` clears that bar. */
export function editRehearsal(score: Score, at: number, label: string | null): Score {
  const start = barStartAt(score, at);
  const next = (canonicalRehearsals(score.rehearsals) ?? []).filter((m) => Math.abs(m.at - start) > EPS);
  const cleaned = label == null ? null : cleanRehearsalLabel(label);
  if (cleaned) next.push({ at: start, label: cleaned });
  next.sort((a, b) => a.at - b.at);
  const out: Score = { ...score };
  if (next.length) out.rehearsals = next;
  else delete out.rehearsals;
  return out;
}

export function rehearsalsSummary(score: Score): string {
  const marks = canonicalRehearsals(score.rehearsals);
  if (!marks) return "";
  const starts = barStarts(score);
  return marks
    .map((m) => {
      let bar = 1;
      starts.forEach((q, i) => {
        if (q <= m.at + EPS) bar = i + 1;
      });
      return `第 ${bar} 小节「${m.label}」`;
    })
    .join("、");
}

function noteOnsets(notes: readonly ScoreNote[]) {
  const starts: number[] = [];
  let at = 0;
  for (const n of notes) {
    starts.push(at);
    at += n.dur;
  }
  return { starts, end: at };
}

/**
 * Follow rehearsal marks onto the new voice-1 melody, same rules as chord symbols:
 * a mark rides the note that was sounding under it; marks past the new end are dropped.
 */
export function remapRehearsalsForNotes(
  marks: readonly RehearsalMark[] | undefined,
  previous: readonly ScoreNote[],
  next: readonly ScoreNote[],
): { marks?: RehearsalMark[]; notice?: string } {
  if (!marks?.length) return {};
  const prev = noteOnsets(previous);
  const after = noteOnsets(next);
  // Align by index when lengths match; otherwise keep absolute time if it still fits.
  const moved: RehearsalMark[] = [];
  const taken = new Set<number>();
  const lost: string[] = [];
  let followed = 0;
  const sameLen = previous.length === next.length;
  for (const mark of marks) {
    let index = -1;
    prev.starts.forEach((start, i) => {
      if (start <= mark.at + EPS) index = i;
    });
    const offset = index >= 0 ? mark.at - prev.starts[index]! : 0;
    const target = sameLen && index >= 0 ? index : -1;
    const targetDur = target >= 0 ? (next[target]?.dur ?? 0) : 0;
    let at: number;
    if (target >= 0 && offset < targetDur - EPS) at = after.starts[target]! + offset;
    else if (target >= 0 && offset < EPS) at = after.starts[target]!;
    else if (mark.at < after.end - EPS) at = mark.at;
    else {
      lost.push(mark.label);
      continue;
    }
    const slot = Math.round(at * 1e6);
    if (taken.has(slot)) {
      lost.push(mark.label);
      continue;
    }
    taken.add(slot);
    if (Math.abs(at - mark.at) > EPS) followed += 1;
    moved.push({ ...mark, at });
  }
  const cleaned = canonicalRehearsals(moved);
  const parts: string[] = [];
  if (followed) parts.push(`${followed} 处段落标记已跟到新的拍点`);
  if (lost.length) parts.push(`${lost.length} 处超出新旋律、没留在谱上`);
  return {
    marks: cleaned,
    notice: parts.length ? `旋律改了，${parts.join("，")}。` : undefined,
  };
}
