/**
 * Fermatas (延长记号): sit on a note or rest, show on the jianpu, stretch
 * playback by slowing that written span, and come in from MusicXML / 123.
 * Idea from MuseScore "Breaths and pauses" (time stretch on a fermata);
 * no upstream code, brand, copy, or assets. See docs/fermata.md.
 */
import type { Score, ScoreChange, ScoreNote } from "./theory.ts";

function voiceList(score: Score): ScoreNote[][] {
  return [
    score.notes,
    ...(score.voice2 != null || score.extraVoices?.length ? [score.voice2 ?? []] : []),
    ...(score.extraVoices ?? []),
  ];
}

function bpmAt(score: Score, at: number): number {
  let bpm = score.bpm;
  for (const change of score.changes ?? []) {
    if (change.at > at + 1e-8) break;
    if (change.bpm !== undefined) bpm = change.bpm;
  }
  return bpm;
}

export type FermataMark = { voice: number; at: number };

/** MuseScore-style default: the written span takes 1.5× wall-clock time. */
export const FERMATA_STRETCH = 1.5;

const EPS = 1e-6;
/** Playback-only floor; not the stored Score tempo clamp. */
const PLAY_BPM_MIN = 10;

export function noteOnsets(notes: readonly ScoreNote[]): { starts: number[]; end: number } {
  const starts: number[] = [];
  let at = 0;
  for (const note of notes) {
    starts.push(at);
    at += Number.isFinite(note.dur) ? note.dur : 0;
  }
  return { starts, end: at };
}

export function canonicalFermatas(marks: unknown): FermataMark[] | undefined {
  if (!Array.isArray(marks)) return undefined;
  const cleaned: FermataMark[] = [];
  const seen = new Set<string>();
  const sorted = marks
    .map((item) => item as Partial<FermataMark>)
    .filter(
      (item) =>
        item &&
        Number.isFinite(item.at) &&
        (item.at as number) >= 0 &&
        (item.at as number) <= 1_000_000 &&
        Number.isInteger(item.voice) &&
        (item.voice as number) >= 0 &&
        (item.voice as number) <= 15,
    )
    .map((item) => ({ voice: item.voice as number, at: Math.round((item.at as number) * 1e6) / 1e6 }))
    .sort((a, b) => a.at - b.at || a.voice - b.voice);
  for (const item of sorted) {
    const key = `${item.voice}:${item.at}`;
    if (seen.has(key)) continue;
    seen.add(key);
    cleaned.push(item);
  }
  return cleaned.length ? cleaned : undefined;
}

export function hasFermata(score: Pick<Score, "fermatas">, voice: number, at: number): boolean {
  return (canonicalFermatas(score.fermatas) ?? []).some(
    (mark) => mark.voice === voice && Math.abs(mark.at - at) <= EPS,
  );
}

function onsetsOf(score: Pick<Score, "notes" | "voice2" | "extraVoices">, voice: number) {
  return noteOnsets(voiceList(score as Score)[voice] ?? []);
}

/**
 * Toggle or clear fermatas on the selected notes of one voice.
 * `toggle` removes them when every selected note already has one, otherwise adds.
 */
export function editFermatas(
  score: Score,
  voice: number,
  indexes: readonly number[],
  mode: "toggle" | "clear" | "set" = "toggle",
): Score {
  const unique = [...new Set(indexes.filter((i) => Number.isInteger(i) && i >= 0))].sort((a, b) => a - b);
  if (!unique.length) return score;
  const { starts } = onsetsOf(score, voice);
  const targets = unique.map((i) => starts[i]).filter((at): at is number => at != null);
  if (!targets.length) return score;
  const current = canonicalFermatas(score.fermatas) ?? [];
  const allOn = targets.every((at) => current.some((m) => m.voice === voice && Math.abs(m.at - at) <= EPS));
  const add = mode === "set" || (mode === "toggle" && !allOn);
  const kept = current.filter(
    (m) => m.voice !== voice || !targets.some((at) => Math.abs(m.at - at) <= EPS),
  );
  const next = add ? [...kept, ...targets.map((at) => ({ voice, at }))] : kept;
  const cleaned = canonicalFermatas(next);
  const out: Score = { ...score };
  if (cleaned) out.fermatas = cleaned;
  else delete out.fermatas;
  return out;
}

/** Written [from, to) spans that should be stretched; overlapping marks merge. */
export function fermataSpans(score: Score): { from: number; to: number }[] {
  const marks = canonicalFermatas(score.fermatas);
  if (!marks) return [];
  const raw: { from: number; to: number }[] = [];
  const voices = voiceList(score);
  for (const mark of marks) {
    const notes = voices[mark.voice] ?? [];
    const { starts } = noteOnsets(notes);
    let index = -1;
    starts.forEach((start, i) => {
      if (Math.abs(start - mark.at) <= EPS) index = i;
    });
    const dur = index >= 0 ? notes[index]!.dur : 0;
    if (!(dur > EPS)) continue;
    raw.push({ from: mark.at, to: mark.at + dur });
  }
  raw.sort((a, b) => a.from - b.from || a.to - b.to);
  const merged: { from: number; to: number }[] = [];
  for (const span of raw) {
    const last = merged[merged.length - 1];
    if (last && span.from <= last.to + EPS) last.to = Math.max(last.to, span.to);
    else merged.push({ ...span });
  }
  return merged;
}


/**
 * Playback/export copy: sample rit./accel. spans into mid-score bpm steps so
 * the existing clock can follow a smooth curve. Not written back to the draft.
 * Lives here so playback and MIDI can apply it without a new first-screen chunk.
 */
export function scoreWithGradualTempo(score: Score): Score {
  const raw = (score as Score & { gradualTempos?: unknown }).gradualTempos;
  if (!Array.isArray(raw) || !raw.length) return score;
  const spans: { from: number; to: number; kind: "rit" | "accel"; toBpm?: number; ratio?: number }[] = [];
  const round = (at: number) => Math.round(Math.max(0, at) * 1e6) / 1e6;
  const clamp = (bpm: number) => Math.min(220, Math.max(40, Math.round(bpm)));
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as { from?: unknown; to?: unknown; kind?: unknown; toBpm?: unknown; ratio?: unknown };
    const from = round(Number(rec.from));
    const to = round(Number(rec.to));
    if ((rec.kind !== "rit" && rec.kind !== "accel") || !(to > from + EPS)) continue;
    const span: (typeof spans)[number] = { from, to, kind: rec.kind };
    if (rec.toBpm !== undefined && Number.isFinite(Number(rec.toBpm))) span.toBpm = clamp(Number(rec.toBpm));
    if (rec.ratio !== undefined && Number.isFinite(Number(rec.ratio)) && Number(rec.ratio) > 0) {
      span.ratio = Math.min(4, Math.max(0.25, Math.round(Number(rec.ratio) * 1000) / 1000));
    }
    spans.push(span);
  }
  spans.sort((a, b) => a.from - b.from || a.to - b.to);
  if (!spans.length) return score;
  const targetOf = (span: (typeof spans)[number]) => {
    const start = bpmAt(score, span.from);
    if (span.toBpm !== undefined) return span.toBpm;
    if (span.ratio !== undefined) return clamp(start * span.ratio);
    const mark = (score.changes ?? []).find((change) => change.bpm !== undefined && Math.abs(change.at - span.to) <= EPS);
    if (mark?.bpm !== undefined) return clamp(mark.bpm);
    return clamp(start * (span.kind === "rit" ? 0.75 : 4 / 3));
  };
  const points = new Map<number, ScoreChange>();
  const put = (change: ScoreChange) => {
    const at = round(change.at);
    const prev = points.get(at) ?? { at };
    points.set(at, { ...prev, ...change, at });
  };
  for (const change of score.changes ?? []) put({ ...change });
  for (const span of spans) {
    const startBpm = bpmAt(score, span.from);
    const endBpm = targetOf(span);
    const length = span.to - span.from;
    const steps = Math.max(4, Math.round(length / 0.125));
    for (let i = 0; i < steps; i += 1) {
      const t = i / steps;
      put({ at: round(span.from + length * t), bpm: clamp(startBpm + (endBpm - startBpm) * t) });
    }
    put({ at: round(span.to), bpm: endBpm });
  }
  const changes = [...points.values()]
    .filter((change) => change.at > EPS && !(change.bpm === undefined && change.beats === undefined && change.key === undefined))
    .sort((a, b) => a.at - b.at);
  const atZero = points.get(0);
  const out: Score & { gradualTempos?: unknown } = { ...score };
  if (atZero?.bpm !== undefined) out.bpm = atZero.bpm;
  if (changes.length) out.changes = changes;
  else delete out.changes;
  delete out.gradualTempos;
  return out;
}

/**
 * Playback/export copy: existing mid-score tempo stays, but each fermata span
 * runs at 1/stretch of the written BPM so the wall-clock length is 1.5×.
 * Does not change notes, and is not written back to the draft.
 */
export function scoreWithFermataTempo(score: Score): Score {
  const spans = fermataSpans(score);
  if (!spans.length) return score;
  const points = new Map<number, ScoreChange>();
  const put = (change: ScoreChange) => {
    const at = Math.round(change.at * 1e6) / 1e6;
    const prev = points.get(at) ?? { at };
    points.set(at, { ...prev, ...change, at });
  };
  for (const change of score.changes ?? []) put({ ...change });
  const slow = (bpm: number) => Math.max(PLAY_BPM_MIN, bpm / FERMATA_STRETCH);
  for (const span of spans) {
    const writtenFrom = bpmAt(score, span.from);
    const writtenTo = bpmAt(score, span.to);
    put({ at: span.from, bpm: slow(writtenFrom) });
    put({ at: span.to, bpm: writtenTo });
    for (const change of score.changes ?? []) {
      if (change.bpm !== undefined && change.at > span.from + EPS && change.at < span.to - EPS) {
        put({ at: change.at, bpm: slow(change.bpm) });
      }
    }
  }
  const changes = [...points.values()].filter((change) => change.at > EPS).sort((a, b) => a.at - b.at);
  const atZero = points.get(0);
  const out: Score = { ...score };
  if (atZero?.bpm !== undefined) out.bpm = atZero.bpm;
  if (changes.length) out.changes = changes;
  else delete out.changes;
  return out;
}

/**
 * Follow this voice's fermatas onto a rewritten melody.
 * Marks on other voices are left as they are.
 */
export function remapFermatasForNotes(
  marks: readonly FermataMark[] | undefined,
  voice: number,
  previous: readonly ScoreNote[],
  next: readonly ScoreNote[],
): { marks?: FermataMark[]; notice?: string } {
  const all = canonicalFermatas(marks);
  if (!all) return {};
  const others = all.filter((m) => m.voice !== voice);
  const mine = all.filter((m) => m.voice === voice);
  if (!mine.length) return { marks: all };
  const prev = noteOnsets(previous);
  const after = noteOnsets(next);
  const moved: FermataMark[] = [];
  const taken = new Set<number>();
  let lost = 0;
  let followed = 0;
  const sameLen = previous.length === next.length;
  for (const mark of mine) {
    let index = -1;
    prev.starts.forEach((start, i) => {
      if (Math.abs(start - mark.at) <= EPS) index = i;
    });
    const target = sameLen && index >= 0 ? index : -1;
    let at: number | null = null;
    if (target >= 0) at = after.starts[target]!;
    else if (mark.at < after.end - EPS) at = mark.at;
    if (at == null) {
      lost += 1;
      continue;
    }
    const slot = Math.round(at * 1e6);
    if (taken.has(slot)) {
      lost += 1;
      continue;
    }
    taken.add(slot);
    if (Math.abs(at - mark.at) > EPS) followed += 1;
    moved.push({ voice, at });
  }
  const cleaned = canonicalFermatas([...others, ...moved]);
  const parts: string[] = [];
  if (followed) parts.push(`${followed} 处延长记号已跟到新的拍点`);
  if (lost) parts.push(`${lost} 处超出新旋律、没留在谱上`);
  return {
    marks: cleaned,
    notice: parts.length ? `旋律改了，${parts.join("，")}。` : undefined,
  };
}

/** After inserting `length` quarters at `end` in this voice, copy marks inside [start, end) and shift later ones. */
export function shiftFermatasForInsert(
  marks: readonly FermataMark[] | undefined,
  voice: number,
  start: number,
  end: number,
  length: number,
): FermataMark[] | undefined {
  const all = canonicalFermatas(marks);
  if (!all) return undefined;
  const mine = all.filter((m) => m.voice === voice);
  const others = all.filter((m) => m.voice !== voice);
  const copied = mine
    .filter((m) => m.at >= start - EPS && m.at < end - EPS)
    .map((m) => ({ ...m, at: m.at + length }));
  const kept = mine.map((m) => (m.at >= end - EPS ? { ...m, at: m.at + length } : m));
  return canonicalFermatas([...others, ...kept, ...copied]);
}

/** Replay a repeated section: copy marks whose written time falls in a played segment. */
export function unrollFermatas(
  marks: readonly FermataMark[] | undefined,
  segments: readonly { at: number; from: number; to: number }[],
): FermataMark[] | undefined {
  if (!marks?.length) return undefined;
  const moved = segments.flatMap((seg) =>
    marks
      .filter((m) => m.at >= seg.from - EPS && m.at < seg.to - EPS)
      .map((m) => ({ ...m, at: seg.at + m.at - seg.from })),
  );
  return canonicalFermatas(moved);
}
