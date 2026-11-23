/**
 * Repeat signs and 1st / 2nd endings: validation, editing, unrolling to a played order,
 * and position remapping after edits. Pure; the editor and exporters share it.
 */
// Type-only imports: this module is its own lazy chunk and must not pull the home page's
// score model along with it (the bundler would move shared modules into this chunk).
import type { Score, ScoreChange, ScoreJumps, ScoreNote, ScoreRepeat } from "./theory.ts";
import { unrollFermatas } from "./fermata.ts";

const EPS = 1e-6;

function voiceList(score: Score): ScoreNote[][] {
  return [score.notes, ...(score.voice2 != null || score.extraVoices?.length ? [score.voice2 ?? []] : []), ...(score.extraVoices ?? [])];
}
function scoreQuarters(score: Score): number {
  return Math.max(0, ...voiceList(score).map((v) => v.reduce((t, n) => t + (Number.isFinite(n.dur) ? n.dur : 0), 0)));
}
/** Same bar rule as score-timeline's nextBar: meter changes end a bar. */
function nextBar(score: Score, at: number): number {
  let origin = 0, beats = score.beats, unit = score.beatUnit, next = Infinity;
  for (const c of score.changes ?? []) {
    if (c.beats === undefined) continue;
    if (c.at > at + 1e-8) { next = c.at; break; }
    origin = c.at; beats = c.beats; unit = c.beatUnit!;
  }
  const length = (beats * 4) / unit;
  return Math.min(next, origin + (Math.floor((at - origin + 1e-8) / length) + 1) * length);
}
function barStarts(score: Score): number[] {
  const total = scoreQuarters(score);
  const starts = [0];
  for (let at = 0, guard = 0; guard < 100_000; guard += 1) {
    const next = nextBar(score, at);
    if (!Number.isFinite(next) || next <= at + EPS || next >= total - EPS) break;
    starts.push(next);
    at = next;
  }
  return starts;
}
function stateAt(score: Score, at: number) {
  const state = { bpm: score.bpm, beats: score.beats, beatUnit: score.beatUnit, key: score.key, mode: score.mode };
  for (const c of score.changes ?? []) {
    if (c.at > at + 1e-8) break;
    if (c.bpm !== undefined) state.bpm = c.bpm;
    if (c.beats !== undefined) { state.beats = c.beats; state.beatUnit = c.beatUnit!; }
    if (c.key !== undefined) { state.key = c.key; state.mode = c.mode!; }
  }
  return state;
}
const near = (a: number, b: number) => Math.abs(a - b) < EPS;

/** Bar lines of the score: every bar start plus the end. */
export function barLines(score: Score): number[] {
  const total = scoreQuarters(score);
  const starts = barStarts(score);
  return total > EPS ? [...starts, total] : starts;
}

/** Chinese reason the repeats cannot stand, or null when they are fine. */
export function repeatProblem(score: Score, repeats: readonly ScoreRepeat[] | undefined = score.repeats): string | null {
  if (!repeats?.length) return null;
  const lines = barLines(score);
  const onLine = (q: number) => lines.some((l) => near(l, q));
  let previousEnd = -Infinity;
  for (const r of repeats) {
    const values = [r.from, r.to, r.ending, r.endingEnd].filter((v): v is number => v !== undefined);
    if (!values.every((v) => Number.isFinite(v) && v >= 0)) return "反复记号的位置无效。";
    if (!values.every(onLine)) return "反复记号要落在小节线上。";
    if (!(r.to > r.from + EPS)) return "反复结束要在反复开始之后。";
    if (r.from < previousEnd - EPS) return "反复段不能重叠或嵌套。";
    if (r.ending !== undefined && !(r.ending > r.from + EPS && r.ending < r.to - EPS))
      return "一房要放在反复段末尾的小节上（不能是整段）。";
    if (r.endingEnd !== undefined) {
      if (r.ending === undefined) return "先设一房，再设二房。";
      if (!(r.endingEnd > r.to + EPS)) return "二房要紧接在反复结束之后。";
    }
    previousEnd = r.endingEnd ?? r.to;
  }
  return null;
}

type Span = { from: number; to: number };
function spanList() {
  const out: Span[] = [];
  const push = (from: number, to: number) => {
    if (!(to > from + EPS)) return;
    const last = out.at(-1);
    if (last && near(last.to, from)) last.to = to;
    else out.push({ from, to });
  };
  return { out, push };
}

/** Played order as source spans: |: A [1 B :| [2 C → A B A C; then D.C. / D.S. jumps. */
export function unrollSegments(score: Score): { from: number; to: number }[] {
  const total = scoreQuarters(score);
  const repeats = score.repeats?.length && !repeatProblem(score) ? score.repeats : [];
  const { out, push } = spanList();
  let cursor = 0;
  for (const r of repeats) {
    push(cursor, r.to);
    push(r.from, r.ending ?? r.to);
    cursor = r.to;
  }
  push(cursor, total);
  const straight = out.length ? out : [{ from: 0, to: total }];
  const jumps = score.jumps && !jumpProblem(score) ? score.jumps : null;
  const at = jumps?.dc ?? jumps?.ds;
  if (!jumps || at === undefined) return straight;
  // First pass: the played order up to the jump (the last time it is reached).
  const first = spanList();
  let k = straight.length - 1;
  while (k > 0 && !(straight[k].from < at - EPS && straight[k].to >= at - EPS)) k -= 1;
  for (let i = 0; i < k; i += 1) first.push(straight[i].from, straight[i].to);
  first.push(straight[k].from, Math.min(at, straight[k].to));
  // After the jump: no repeats, last ending only (standard practice).
  const again = (from: number, to: number) => {
    let c = from;
    for (const r of repeats) {
      if (r.from < from - EPS || r.to > to + EPS) continue;
      first.push(c, r.ending ?? r.to);
      c = r.to;
    }
    first.push(c, to);
  };
  const restart = jumps.ds !== undefined ? jumps.segno! : 0;
  again(restart, jumps.fine ?? jumps.toCoda ?? total);
  if (jumps.toCoda !== undefined) again(jumps.coda!, total);
  return first.out;
}

export type Unrolled = {
  /** Linear score in played order (no `repeats`). */
  score: Score;
  /** Per voice: unrolled note index → source note index (-1 for padding rests). */
  source: number[][];
  /** Unrolled quarter → source quarter. */
  sourceAt: (quarter: number) => number;
  /** Unrolled quarter of each segment start, with its source span. */
  segments: { at: number; from: number; to: number }[];
};

function sameState(a: ReturnType<typeof stateAt>, b: ReturnType<typeof stateAt>) {
  return a.bpm === b.bpm && a.beats === b.beats && a.beatUnit === b.beatUnit && a.key === b.key && a.mode === b.mode;
}


/** Clip gradual rit./accel. spans onto the unrolled timeline. Local copy avoids pulling gradual-tempo into score-core. */
function unrollCopiedGradualTempos(
  list: readonly { from: number; to: number; kind: "rit" | "accel"; toBpm?: number; ratio?: number }[] | undefined,
  segments: readonly { at: number; from: number; to: number }[],
) {
  if (!list?.length) return undefined;
  const moved: { from: number; to: number; kind: "rit" | "accel"; toBpm?: number; ratio?: number }[] = [];
  const round = (at: number) => Math.round(Math.max(0, at) * 1e6) / 1e6;
  for (const seg of segments) {
    for (const span of list) {
      const from = Math.max(span.from, seg.from);
      const to = Math.min(span.to, seg.to);
      if (!(to > from + EPS)) continue;
      moved.push({ ...span, from: round(seg.at + from - seg.from), to: round(seg.at + to - seg.from) });
    }
  }
  return moved.length ? moved : undefined;
}

export function unrollScore(score: Score): Unrolled {
  const spans = unrollSegments(score);
  const segments: Unrolled["segments"] = [];
  let at = 0;
  for (const span of spans) {
    segments.push({ at, ...span });
    at += span.to - span.from;
  }
  const voices = voiceList(score);
  const source: number[][] = [];
  const outVoices = voices.map((notes, voice) => {
    const starts: number[] = [];
    let q = 0;
    for (const note of notes) {
      starts.push(q);
      q += Number.isFinite(note.dur) ? note.dur : 0;
    }
    const out: ScoreNote[] = [];
    const map: number[] = [];
    const startsIn = (seg: { from: number; to: number }) => starts.some((t) => t >= seg.from - EPS && t < seg.to - EPS);
    segments.forEach((seg, k) => {
      const last = k === segments.length - 1;
      let cursor = seg.from;
      notes.forEach((note, i) => {
        const end = starts[i] + note.dur;
        if (starts[i] < seg.from - EPS || starts[i] >= seg.to - EPS) return;
        if (starts[i] > cursor + EPS) {
          out.push({ pitches: [], dur: starts[i] - cursor });
          map.push(-1);
        }
        const dur = Math.min(end, seg.to) - starts[i];
        out.push(near(dur, note.dur) ? note : { ...note, dur });
        map.push(i);
        cursor = starts[i] + dur;
      });
      // Keep voices aligned at every jump; the final stretch keeps its natural end.
      const voiceEnd = Math.min(seg.to, q);
      if (!last && cursor < seg.to - EPS && segments.slice(k + 1).some(startsIn)) {
        out.push({ pitches: [], dur: seg.to - cursor });
        map.push(-1);
      } else if (last && cursor < voiceEnd - EPS) {
        out.push({ pitches: [], dur: voiceEnd - cursor });
        map.push(-1);
      }
    });
    source[voice] = map;
    return out;
  });
  const changes: ScoreChange[] = [];
  segments.forEach((seg, k) => {
    if (k > 0) {
      const before = stateAt(score, spans[k - 1].to - 1e-4);
      const now = stateAt(score, seg.from);
      if (!sameState(before, now)) changes.push({ at: seg.at, ...now });
    }
    for (const c of score.changes ?? [])
      if (c.at > seg.from + EPS && c.at < seg.to - EPS) changes.push({ ...c, at: seg.at + c.at - seg.from });
  });
  const chords = segments.flatMap((seg) =>
    (score.chordSymbols ?? [])
      .filter((c) => c.at >= seg.from - EPS && c.at < seg.to - EPS)
      .map((c) => ({ ...c, at: seg.at + c.at - seg.from })),
  );
  const out: Score = { ...score, notes: outVoices[0] ?? [] };
  delete out.repeats;
  delete out.jumps;
  if (score.voice2 != null) out.voice2 = outVoices[1] ?? [];
  if (score.extraVoices) out.extraVoices = outVoices.slice(2);
  if (changes.length) out.changes = changes;
  else delete out.changes;
  if (chords.length) out.chordSymbols = chords;
  else delete out.chordSymbols;
  const fermatas = unrollFermatas(score.fermatas, segments);
  if (fermatas) out.fermatas = fermatas;
  else delete out.fermatas;
  const graduals = unrollCopiedGradualTempos((score as { gradualTempos?: { from: number; to: number; kind: "rit" | "accel"; toBpm?: number; ratio?: number }[] }).gradualTempos, segments);
  if (graduals) (out as { gradualTempos?: typeof graduals }).gradualTempos = graduals;
  else delete (out as { gradualTempos?: unknown }).gradualTempos;
  const sourceAt = (quarter: number) => {
    let seg = segments[0];
    for (const s of segments) if (quarter >= s.at - EPS) seg = s;
    return seg ? Math.min(seg.to, seg.from + Math.max(0, quarter - seg.at)) : quarter;
  };
  return { score: out, source, sourceAt, segments };
}

export type RepeatAction = "start" | "end" | "first" | "second" | "clear";

/** Bar [start, end) containing `quarter`. */
export function barAround(score: Score, quarter: number): { start: number; end: number } | null {
  const lines = barLines(score);
  for (let i = 0; i + 1 < lines.length; i += 1)
    if (quarter >= lines[i] - EPS && quarter < lines[i + 1] - EPS) return { start: lines[i], end: lines[i + 1] };
  return null;
}

/**
 * Bar-level edit at the bar holding `quarter`. Returns the new list (undefined = none)
 * or a Chinese reason the change is refused.
 */
export function editRepeats(score: Score, quarter: number, action: RepeatAction): { repeats: ScoreRepeat[] | undefined } | { error: string } {
  const bar = barAround(score, quarter);
  if (!bar) return { error: "先在谱上选中一个音，再设反复。" };
  const list = (score.repeats ?? []).map((r) => ({ ...r }));
  const covering = (q: number) => list.find((r) => q >= r.from - EPS && q < (r.endingEnd ?? r.to) - EPS);
  let next = list;
  if (action === "clear") {
    const hit = covering(bar.start);
    if (!hit) return { error: "这一小节不在反复段里。" };
    next = list.filter((r) => r !== hit);
  } else if (action === "start") {
    const hit = list.find((r) => bar.start >= r.from - EPS && bar.start < r.to - EPS);
    if (hit) {
      hit.from = bar.start;
      if (hit.ending !== undefined && hit.ending <= bar.start + EPS) delete hit.ending, delete hit.endingEnd;
    } else next = [...list, { from: bar.start, to: bar.end }];
  } else if (action === "end") {
    // The repeat this :| closes: the last one that starts before this bar ends.
    const open = list.filter((r) => r.from < bar.end - EPS).at(-1);
    if (open && bar.end >= open.from) {
      open.to = bar.end;
      if (open.ending !== undefined && open.ending >= bar.end - EPS) delete open.ending, delete open.endingEnd;
      if (open.endingEnd !== undefined && open.endingEnd <= bar.end + EPS) delete open.endingEnd;
    } else next = [...list, { from: 0, to: bar.end }];
  } else if (action === "first") {
    const hit = list.find((r) => bar.start > r.from + EPS && bar.start < r.to - EPS);
    if (!hit) return { error: "一房要放在反复段末尾的小节上：先设反复开始和结束，再选反复段里靠后的小节。" };
    hit.ending = bar.start;
  } else {
    const hit = list.find((r) => near(r.to, bar.start) || (r.endingEnd !== undefined && bar.start >= r.to - EPS && bar.start < r.endingEnd - EPS));
    if (!hit) return { error: "二房要选紧接反复结束（:|）后面的小节。" };
    if (hit.ending === undefined) return { error: "先设一房，再设二房。" };
    hit.endingEnd = bar.end;
  }
  next.sort((a, b) => a.from - b.from);
  const problem = repeatProblem(score, next);
  if (problem) return { error: problem };
  return { repeats: next.length ? next : undefined };
}

/**
 * After one voice is rewritten (insert / delete / change durations), move repeat
 * positions like tempo changes: the untouched prefix stays, positions after the
 * rewritten span shift, and a repeat with a mark inside the span is dropped.
 */
/** Position map for one rewritten voice; null when nothing after the edit moves. */
function editMove(oldNotes: readonly { dur: number }[], newNotes: readonly { dur: number }[]): ((q: number) => number | null) | null {
  // Untouched notes keep their object identity; fall back to durations when nothing is shared.
  const shared = newNotes.some((n) => oldNotes.includes(n));
  const same = (a: { dur: number }, b: { dur: number }) => (shared ? a === b : near(a.dur, b.dur));
  let prefix = 0;
  while (prefix < oldNotes.length && prefix < newNotes.length && same(oldNotes[prefix], newNotes[prefix])) prefix += 1;
  let suffix = 0;
  while (suffix < oldNotes.length - prefix && suffix < newNotes.length - prefix &&
    same(oldNotes[oldNotes.length - 1 - suffix], newNotes[newNotes.length - 1 - suffix])) suffix += 1;
  const sum = (list: readonly { dur: number }[]) => list.reduce((s, n) => s + (Number.isFinite(n.dur) ? n.dur : 0), 0);
  const midStart = sum(oldNotes.slice(0, prefix));
  const oldMidEnd = sum(oldNotes) - sum(suffix ? oldNotes.slice(-suffix) : []);
  const newMidEnd = sum(newNotes) - sum(suffix ? newNotes.slice(-suffix) : []);
  const shift = newMidEnd - oldMidEnd;
  if (near(shift, 0)) return null;
  return (q: number): number | null => (q <= midStart + EPS ? q : q >= oldMidEnd - EPS ? q + shift : null);
}

export function remapRepeats(repeats: ScoreRepeat[] | undefined, oldNotes: readonly { dur: number }[], newNotes: readonly { dur: number }[]): ScoreRepeat[] | undefined {
  if (!repeats?.length) return repeats;
  const move = editMove(oldNotes, newNotes);
  if (!move) return repeats;
  const out: ScoreRepeat[] = [];
  for (const r of repeats) {
    const from = move(r.from), to = move(r.to);
    const ending = r.ending === undefined ? undefined : move(r.ending);
    const endingEnd = r.endingEnd === undefined ? undefined : move(r.endingEnd);
    if (from == null || to == null || ending === null || endingEnd === null) continue;
    out.push({ from, to, ...(ending !== undefined ? { ending } : {}), ...(endingEnd !== undefined ? { endingEnd } : {}) });
  }
  return out.length ? out : undefined;
}

/** Repeats that still fit after an edit: the valid ones, in order. */
export function keepValidRepeats(score: Score, repeats: ScoreRepeat[] | undefined): ScoreRepeat[] | undefined {
  if (!repeats?.length) return undefined;
  const kept: ScoreRepeat[] = [];
  for (const r of repeats) if (!repeatProblem(score, [...kept, r])) kept.push(r);
  return kept.length ? kept : undefined;
}

/** Short label for the bar under `quarter`, e.g. "第 3 小节 · 一房". */
export function repeatsSummary(score: Score): string {
  const lines = barLines(score);
  const bar = (q: number) => lines.findIndex((l) => near(l, q)) + 1;
  return (score.repeats ?? [])
    .map((r) => `第 ${bar(r.from)}–${bar(r.to) - 1} 小节反复${r.ending !== undefined ? `（一房从第 ${bar(r.ending)} 小节${r.endingEnd !== undefined ? `，二房到第 ${bar(r.endingEnd) - 1} 小节` : ""}）` : ""}`)
    .join("；");
}

/** Keep repeats in step with a note edit: shift with a lone edited voice, then drop what no longer fits. */
export function fitRepeats(prev: Score, next: Score): Score {
  if (!next.repeats?.length || next.repeats !== prev.repeats) return next;
  const before = voiceList(prev), after = voiceList(next);
  let repeats: ScoreRepeat[] | undefined = next.repeats;
  const changed = after.flatMap((v, i) => (v !== before[i] ? [i] : []));
  if (changed.length === 1 && before.length === after.length) {
    const v = changed[0];
    if (!after.some((notes, i) => i !== v && notes.some((n) => n.dur > 0))) repeats = remapRepeats(repeats, before[v], after[v]);
  }
  const kept = keepValidRepeats(next, repeats);
  if (JSON.stringify(kept) === JSON.stringify(next.repeats)) return next;
  const out = { ...next };
  if (kept) out.repeats = kept;
  else delete out.repeats;
  return out;
}

/**
 * ABC bar lines for the staff view: `|:` `:|` `[1` `[2`, `||` after a 2nd ending, and
 * jump decorations (!segno! !coda! before the bar's first note; !fine! !D.S.alcoda! …
 * on the closing bar line). Undefined when there is nothing to mark (plain " | ").
 */
export function abcBarText(score: Score): ((closing: number | null, opening: number | null, voice?: number) => string) | undefined {
  const repeats = score.repeats?.length && !repeatProblem(score) ? score.repeats : [];
  const marks = jumpMarks(score);
  if (!repeats.length && !marks.length) return undefined;
  const lines = barLines(score);
  const bar = (q: number) => lines.findIndex((l) => near(l, q));
  const open = new Set<number>(), close = new Set<number>(), stop = new Set<number>(), ending = new Map<number, number>();
  for (const r of repeats) {
    open.add(bar(r.from));
    close.add(bar(r.to) - 1);
    if (r.ending !== undefined) ending.set(bar(r.ending), 1);
    if (r.endingEnd !== undefined) {
      ending.set(bar(r.to), 2);
      stop.add(bar(r.endingEnd) - 1);
    }
  }
  const before = new Map<number, string>(), after = new Map<number, string>();
  const abcJump = (j: ScoreJumps) =>
    `${j.dc !== undefined ? "D.C." : "D.S."}${j.fine !== undefined ? "alfine" : j.toCoda !== undefined ? "alcoda" : ""}`;
  for (const m of marks) {
    const i = bar(m.at);
    if (i < 0) continue;
    const deco = m.kind === "segno" ? "segno" : m.kind === "coda" || m.kind === "toCoda" ? "coda" : m.kind === "fine" ? "fine" : abcJump(score.jumps!);
    if (m.side === "start") before.set(i, (before.get(i) ?? "") + `!${deco}!`);
    else after.set(i - 1, (after.get(i - 1) ?? "") + `!${deco}!`);
  }
  return (closing, opening, voice = 0) => {
    // Jump marks once, above the top voice.
    const decoEnd = closing == null || voice !== 0 ? "" : after.get(closing) ?? "";
    const plain = closing == null ? "" : close.has(closing) ? ":|" : stop.has(closing) ? "||" : "|";
    const start = opening == null ? "" : (open.has(opening) ? "|:" : "") + (ending.has(opening) ? `[${ending.get(opening)} ` : "");
    const decoStart = opening == null || voice !== 0 ? "" : before.has(opening) ? `${before.get(opening)} ` : "";
    if (closing == null) return start + decoStart;
    if (opening == null) return ` ${decoEnd}${plain}`;
    const shut = plain === "|" && start.startsWith("|:") ? "" : plain;
    return ` ${decoEnd}${shut}${start || " "}${decoStart}`;
  };
}

// ---- D.C. / D.S. / Fine / Coda ------------------------------------------------------

export type JumpAction = "segno" | "coda" | "fine" | "toCoda" | "dc" | "ds" | "clearJumps";
const JUMP_KEYS = ["segno", "coda", "fine", "toCoda", "dc", "ds"] as const;

function insideRepeat(score: Score, q: number): boolean {
  return (score.repeats ?? []).some((r) => q > r.from + EPS && q < (r.endingEnd ?? r.to) - EPS);
}

/**
 * Chinese reason the jumps cannot be played yet (incomplete or contradictory), or null.
 * Marks without a D.C. / D.S. are only drawn.
 */
export function jumpProblem(score: Score, jumps: ScoreJumps | undefined = score.jumps): string | null {
  if (!jumps) return null;
  const lines = barLines(score);
  const values = JUMP_KEYS.map((k) => jumps[k]).filter((v): v is number => v !== undefined);
  if (!values.length) return null;
  if (!values.every((v) => Number.isFinite(v) && v >= 0)) return "跳转记号的位置无效。";
  if (!values.every((v) => lines.some((l) => near(l, v)))) return "跳转记号要落在小节线上。";
  if (values.some((v) => insideRepeat(score, v))) return "跳转记号不能放在反复段中间（可以放在反复段两端）。";
  const { segno, coda, fine, toCoda, dc, ds } = jumps;
  if (dc !== undefined && ds !== undefined) return "D.C. 和 D.S. 只能有一个。";
  const at = dc ?? ds;
  if (at === undefined) return "还没有 D.C. 或 D.S.：记号只画出，不跳转。";
  if (ds !== undefined && segno === undefined) return "D.S. 要先设 Segno 记号。";
  if (ds !== undefined && !(segno! < ds - EPS)) return "Segno 要在 D.S. 之前。";
  const restart = ds !== undefined ? segno! : 0;
  if (fine !== undefined && (toCoda !== undefined || coda !== undefined)) return "Fine 和 Coda 只能选一种结尾。";
  if (fine !== undefined && !(fine > restart + EPS && fine <= at + EPS)) return "Fine 要在跳回的位置和 D.C./D.S. 之间。";
  if ((toCoda === undefined) !== (coda === undefined)) return toCoda === undefined ? "设了 Coda，还要设 To Coda（从哪里跳到尾声）。" : "设了 To Coda，还要设 Coda（尾声从哪里开始）。";
  if (toCoda !== undefined && !(toCoda > restart + EPS && toCoda < at + EPS)) return "To Coda 要在跳回的位置和 D.C./D.S. 之间。";
  if (coda !== undefined && !(coda >= at - EPS)) return "Coda 尾声要在 D.C./D.S. 之后。";
  if (coda !== undefined && !(coda < scoreQuarters(score) - EPS)) return "Coda 后面还要有音。";
  return null;
}

/** The score repeats or jumps, so playback / MIDI follow a played order. */
export function hasPlayOrder(score: Score): boolean {
  return Boolean(score.repeats?.length) || (score.jumps != null && (score.jumps.dc !== undefined || score.jumps.ds !== undefined) && !jumpProblem(score));
}

/** Italian text of the jump, e.g. "D.S. al Coda". */
export function jumpText(jumps: ScoreJumps): string | null {
  const head = jumps.dc !== undefined ? "D.C." : jumps.ds !== undefined ? "D.S." : null;
  if (!head) return null;
  return head + (jumps.fine !== undefined ? " al Fine" : jumps.toCoda !== undefined ? " al Coda" : "");
}

export type JumpMark = { at: number; kind: "segno" | "coda" | "fine" | "toCoda" | "jump"; text: string; side: "start" | "end" };

/** Marks to draw, in score order. */
export function jumpMarks(score: Score): JumpMark[] {
  const j = score.jumps;
  if (!j) return [];
  const out: JumpMark[] = [];
  if (j.segno !== undefined) out.push({ at: j.segno, kind: "segno", text: "Segno", side: "start" });
  if (j.coda !== undefined) out.push({ at: j.coda, kind: "coda", text: "Coda", side: "start" });
  if (j.fine !== undefined) out.push({ at: j.fine, kind: "fine", text: "Fine", side: "end" });
  if (j.toCoda !== undefined) out.push({ at: j.toCoda, kind: "toCoda", text: "To Coda", side: "end" });
  const at = j.dc ?? j.ds;
  if (at !== undefined) out.push({ at, kind: "jump", text: jumpText(j)!, side: "end" });
  return out.sort((a, b) => a.at - b.at);
}

/** Set or remove (toggle) one jump mark at the bar holding `quarter`. */
export function editJumps(score: Score, quarter: number, action: JumpAction): { jumps: ScoreJumps | undefined } | { error: string } {
  const bar = barAround(score, quarter);
  if (!bar) return { error: "先在谱上选中一个音，再设跳转记号。" };
  if (action === "clearJumps") {
    if (!score.jumps) return { error: "谱里没有跳转记号。" };
    return { jumps: undefined };
  }
  const at = action === "segno" || action === "coda" ? bar.start : bar.end;
  if (insideRepeat(score, at)) return { error: "跳转记号不能放在反复段中间：选反复段第一小节（Segno / Coda）或最后一小节（Fine / To Coda / D.C. / D.S.）。" };
  const next: ScoreJumps = { ...(score.jumps ?? {}) };
  if (next[action] !== undefined && near(next[action]!, at)) delete next[action];
  else {
    next[action] = at;
    // One jump, one ending kind.
    if (action === "dc") delete next.ds;
    if (action === "ds") delete next.dc;
    if (action === "fine") delete next.toCoda, delete next.coda;
    if (action === "toCoda" || action === "coda") delete next.fine;
  }
  return { jumps: JUMP_KEYS.some((k) => next[k] !== undefined) ? next : undefined };
}

/** Chinese description with bar numbers: the route when it plays, otherwise the marks and what is missing. */
export function jumpsSummary(score: Score): string {
  const j = score.jumps;
  if (!j) return "";
  const lines = barLines(score);
  const bar = (q: number) => lines.findIndex((l) => near(l, q)) + 1;
  const at = j.dc ?? j.ds;
  const problem = jumpProblem(score);
  if (!problem && at !== undefined) {
    const back = j.dc !== undefined ? "回到开头" : `回到第 ${bar(j.segno!)} 小节 Segno`;
    const end = j.fine !== undefined
      ? `奏到第 ${bar(j.fine) - 1} 小节末 Fine 结束`
      : j.toCoda !== undefined
        ? `奏到第 ${bar(j.toCoda) - 1} 小节末 To Coda，跳到第 ${bar(j.coda!)} 小节 Coda 奏完`
        : "奏到结尾";
    return `第 ${bar(at) - 1} 小节末 ${jumpText(j)}：${back}，${end}`;
  }
  const parts: string[] = [];
  if (j.segno !== undefined) parts.push(`Segno 在第 ${bar(j.segno)} 小节`);
  if (at !== undefined) parts.push(`第 ${bar(at) - 1} 小节末 ${jumpText(j)}`);
  if (j.fine !== undefined) parts.push(`第 ${bar(j.fine) - 1} 小节末 Fine`);
  if (j.toCoda !== undefined) parts.push(`第 ${bar(j.toCoda) - 1} 小节末 To Coda`);
  if (j.coda !== undefined) parts.push(`Coda 从第 ${bar(j.coda)} 小节起`);
  return parts.join("，") + (problem ? `。还不能跳转：${problem}` : "");
}

function remapJumps(jumps: ScoreJumps | undefined, oldNotes: readonly { dur: number }[], newNotes: readonly { dur: number }[]): ScoreJumps | undefined {
  if (!jumps) return jumps;
  const move = editMove(oldNotes, newNotes);
  if (!move) return jumps;
  const next: ScoreJumps = {};
  for (const k of JUMP_KEYS) {
    const v = jumps[k] === undefined ? null : move(jumps[k]!);
    if (v != null) next[k] = v;
  }
  return JUMP_KEYS.some((k) => next[k] !== undefined) ? next : undefined;
}

/** Drop marks that left the bar lines or landed inside a repeat after an edit. */
function keepJumps(score: Score, jumps: ScoreJumps | undefined): ScoreJumps | undefined {
  if (!jumps) return undefined;
  const lines = barLines(score);
  const next: ScoreJumps = {};
  for (const k of JUMP_KEYS) {
    const v = jumps[k];
    if (v !== undefined && Number.isFinite(v) && lines.some((l) => near(l, v)) && !insideRepeat(score, v)) next[k] = v;
  }
  return JUMP_KEYS.some((k) => next[k] !== undefined) ? next : undefined;
}

export function fitJumps(prev: Score, next: Score): Score {
  if (!next.jumps || next.jumps !== prev.jumps) return next;
  const before = voiceList(prev), after = voiceList(next);
  let jumps: ScoreJumps | undefined = next.jumps;
  const changed = after.flatMap((v, i) => (v !== before[i] ? [i] : []));
  if (changed.length === 1 && before.length === after.length) {
    const v = changed[0];
    if (!after.some((notes, i) => i !== v && notes.some((n) => n.dur > 0))) jumps = remapJumps(jumps, before[v], after[v]);
  }
  const kept = keepJumps(next, jumps);
  if (JSON.stringify(kept) === JSON.stringify(next.jumps)) return next;
  const out = { ...next };
  if (kept) out.jumps = kept;
  else delete out.jumps;
  return out;
}
