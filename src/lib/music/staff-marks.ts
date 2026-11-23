/**
 * 五线谱途中记号（r40）：把已有的途中速度、途中拍号、途中转调、延长记号和
 * 渐快 / 渐慢刻到五线谱上。数据仍在 `Score.changes` / `fermatas` /
 * `gradualTempos`，这里只改五线谱显示用的 ABC 文本和 SVG，不改谱子本身。
 *
 * 思路参考 MuseScore 手册的速度记号、拍号、调号、呼吸与停顿页面（只取
 * 「记号刻在谱表上方 / 该小节开头，渐变用文字加虚线延伸」的做法），
 * 没有用它的代码、名称、文案、素材或字体。
 *
 * `notation.ts` 在首屏 score-core 块里，不能动；本模块只被编辑器
 * （懒加载）引用，所以刻记号不会撑大首屏。
 */
import type { Score, ScoreChange, ScoreNote } from "./theory.ts";
import type { StaffHit } from "./notation.ts";
import { canonicalFermatas, noteOnsets } from "./fermata.ts";
import { voiceList } from "./voices.ts";

const EPS = 1e-6;

export type StaffGradualKind = "rit" | "accel";
export type StaffGradual = { from: number; to: number; kind: StaffGradualKind };

/** 五线谱上的渐变文字（意大利文缩写，和通行刻谱一致）。 */
export function staffGradualLabel(kind: StaffGradualKind): string {
  return kind === "accel" ? "accel." : "rit.";
}

/** 读谱级 `gradualTempos`：丢掉坏数据，按起点排序，去掉重叠。只读，不依赖 gradual-tempo 模块。 */
export function staffGraduals(score: Score): StaffGradual[] {
  const raw = (score as Score & { gradualTempos?: unknown }).gradualTempos;
  if (!Array.isArray(raw)) return [];
  const list: StaffGradual[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const from = Number((item as StaffGradual).from);
    const to = Number((item as StaffGradual).to);
    const kind = (item as StaffGradual).kind;
    if (kind !== "rit" && kind !== "accel") continue;
    if (!Number.isFinite(from) || !Number.isFinite(to) || from < 0 || to - from <= EPS) continue;
    list.push({ from, to, kind });
  }
  list.sort((a, b) => a.from - b.from);
  const kept: StaffGradual[] = [];
  for (const span of list) {
    const last = kept[kept.length - 1];
    if (last && span.from < last.to - EPS) continue;
    kept.push(span);
  }
  return kept;
}

/**
 * 五线谱显示用的谱：同一位置的多条途中记号合成一条（否则只刻得出第一条），
 * 与当前速度相同的重复 ♩= 不再重刻（渐变结束处的回原速除外）。
 * 什么都不用改时原样返回同一个对象。
 */
export function staffMarksScore(score: Score): Score {
  const changes = score.changes;
  if (!changes?.length) return score;
  const byAt = new Map<number, ScoreChange>();
  const order: number[] = [];
  for (const change of changes) {
    if (!change || !Number.isFinite(change.at)) continue;
    const key = Math.round(change.at * 1e6) / 1e6;
    const prev = byAt.get(key);
    if (prev) Object.assign(prev, { ...change, at: prev.at });
    else {
      byAt.set(key, { ...change });
      order.push(key);
    }
  }
  order.sort((a, b) => a - b);
  const ends = staffGraduals(score).map((span) => span.to);
  const merged: ScoreChange[] = [];
  let bpm = score.bpm;
  for (const key of order) {
    const change = byAt.get(key)!;
    if (change.bpm !== undefined) {
      const endsHere = ends.some((to) => Math.abs(to - change.at) <= EPS);
      if (change.bpm === bpm && change.at > EPS && !endsHere) delete change.bpm;
      else bpm = change.bpm;
    }
    const fields = Object.keys(change).filter((name) => name !== "at" && (change as Record<string, unknown>)[name] !== undefined);
    if (fields.length) merged.push(change);
  }
  const same =
    merged.length === changes.length &&
    merged.every((change, i) => JSON.stringify(change) === JSON.stringify(changes[i]));
  if (same) return score;
  const next: Score = { ...score };
  if (merged.length) next.changes = merged;
  else delete next.changes;
  return next;
}

type Edit = { pos: number; insert?: string; remove?: number };

/** 插在音符前缀里：跳过和弦记号 `"C"` 与三连音 `(3`，放在装饰之前。 */
export function markInsertPoint(abc: string, start: number): number {
  let pos = start;
  for (;;) {
    if (abc[pos] === '"') {
      const close = abc.indexOf('"', pos + 1);
      if (close < 0) return pos;
      pos = close + 1;
      continue;
    }
    if (abc.startsWith("(3", pos)) {
      pos += 2;
      continue;
    }
    return pos;
  }
}

function firstHit(hits: readonly StaffHit[], voice: number, index: number): StaffHit | undefined {
  let best: StaffHit | undefined;
  for (const hit of hits) {
    if ((hit.voice ?? 0) !== voice || hit.index !== index) continue;
    if (!best || hit.start < best.start) best = hit;
  }
  return best;
}

function lastHitEnd(hits: readonly StaffHit[], voice: number, index: number): number | null {
  let end: number | null = null;
  for (const hit of hits) {
    if ((hit.voice ?? 0) !== voice || hit.index !== index) continue;
    if (end == null || hit.end > end) end = hit.end;
  }
  return end;
}

function onsetIndex(starts: readonly number[], at: number): number {
  for (let i = 0; i < starts.length; i += 1) if (Math.abs(starts[i] - at) <= EPS) return i;
  return -1;
}

/** 渐变刻在哪个音上、虚线延到哪个音：起点所在（或之后第一个）音，到终点前最后一个音。 */
export function gradualNoteRange(
  notes: readonly ScoreNote[],
  span: Pick<StaffGradual, "from" | "to">,
): { first: number; last: number } | null {
  const { starts } = noteOnsets(notes);
  let first = -1;
  for (let i = 0; i < starts.length; i += 1) {
    const end = starts[i] + (Number.isFinite(notes[i].dur) ? notes[i].dur : 0);
    if (starts[i] <= span.from + EPS && end > span.from + EPS) {
      first = i;
      break;
    }
    if (starts[i] >= span.from - EPS) {
      first = i;
      break;
    }
  }
  if (first < 0 || starts[first] >= span.to - EPS) return null;
  let last = first;
  for (let i = first; i < starts.length; i += 1) if (starts[i] < span.to - EPS) last = i;
  return { first, last };
}

export type StaffGradualChars = { kind: StaffGradualKind; start: number; end: number };

export type StaffMarked = { abc: string; hits: StaffHit[]; graduals: StaffGradualChars[] };

/**
 * 在 engraveAbc 的结果上加刻：延长记号 `!fermata!`、渐变文字 `"^rit."`，
 * 并去掉下方声部重复的 ♩=（只在最上面一行谱表标速度）。
 * 返回新的 ABC、对齐后的点选区间，以及渐变在 ABC 里的字符范围（画虚线用）。
 */
export function markStaffAbc(
  engraved: { abc: string; hits: StaffHit[] },
  score: Score,
  options?: { leadSheet?: boolean },
): StaffMarked {
  const { abc, hits } = engraved;
  const edits: Edit[] = [];
  const voices: ScoreNote[][] = options?.leadSheet ? [score.notes] : voiceList(score);

  const lower = /^V:(\d+)\b/gm;
  let match: RegExpExecArray | null;
  let lowerFrom = -1;
  while ((match = lower.exec(abc))) {
    if (Number(match[1]) >= 2) {
      lowerFrom = match.index;
      break;
    }
  }
  if (lowerFrom >= 0) {
    const tempo = /\[Q:[^\]\n]*\] ?/g;
    tempo.lastIndex = lowerFrom;
    while ((match = tempo.exec(abc))) edits.push({ pos: match.index, remove: match[0].length });
  }

  for (const mark of canonicalFermatas(score.fermatas) ?? []) {
    const notes = voices[mark.voice];
    if (!notes) continue;
    const index = onsetIndex(noteOnsets(notes).starts, mark.at);
    if (index < 0) continue;
    const hit = firstHit(hits, mark.voice, index);
    if (!hit) continue;
    edits.push({ pos: markInsertPoint(abc, hit.start), insert: "!fermata!" });
  }

  const pending: { kind: StaffGradualKind; start: number; end: number }[] = [];
  for (const span of staffGraduals(score)) {
    const range = gradualNoteRange(voices[0] ?? [], span);
    if (!range) continue;
    const hit = firstHit(hits, 0, range.first);
    const end = lastHitEnd(hits, 0, range.last);
    if (!hit || end == null) continue;
    edits.push({ pos: markInsertPoint(abc, hit.start), insert: `"^${staffGradualLabel(span.kind)}"` });
    pending.push({ kind: span.kind, start: hit.start, end });
  }

  if (!edits.length) return { abc, hits, graduals: [] };
  edits.sort((a, b) => a.pos - b.pos || (a.remove ? -1 : 1));
  let out = "";
  let cursor = 0;
  for (const edit of edits) {
    if (edit.pos < cursor) continue;
    out += abc.slice(cursor, edit.pos);
    if (edit.insert) {
      out += edit.insert;
      cursor = edit.pos;
    }
    if (edit.remove) cursor = edit.pos + edit.remove;
  }
  out += abc.slice(cursor);
  // 位置 p 之前累计的长度变化（p 处的插入算在 p 之后）。按位置排好，二分查找，长谱也快。
  const inserts = edits.filter((edit) => edit.insert).map((edit) => [edit.pos, edit.insert!.length] as const);
  const removes = edits.filter((edit) => edit.remove).map((edit) => [edit.pos + edit.remove!, edit.remove!] as const).sort((a, b) => a[0] - b[0]);
  const prefix = (list: readonly (readonly [number, number])[]) => {
    const sums = [0];
    for (const [, size] of list) sums.push(sums[sums.length - 1] + size);
    return sums;
  };
  const insertSums = prefix(inserts);
  const removeSums = prefix(removes);
  /** Count of entries whose key satisfies key < p (strict) or key <= p. */
  const countBefore = (list: readonly (readonly [number, number])[], p: number, inclusive: boolean) => {
    let lo = 0;
    let hi = list.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (inclusive ? list[mid][0] <= p : list[mid][0] < p) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  const shift = (p: number) =>
    insertSums[countBefore(inserts, p, false)] - removeSums[countBefore(removes, p, true)];
  const moved = hits.map((hit) => ({ ...hit, start: hit.start + shift(hit.start), end: hit.end + shift(hit.end) }));
  const graduals = pending.map((item) => ({
    kind: item.kind,
    start: item.start + shift(item.start),
    end: item.end + shift(item.end),
  }));
  return { abc: out, hits: moved, graduals };
}

export type DashBox = { line: number; left: number; right: number };
export type DashSegment = { line: number; x1: number; x2: number };

/**
 * 渐变虚线：每行谱表一段，从该行第一个相关音到最后一个音的右边；
 * 起始行从文字右边开始。太短的段不画。
 */
export function gradualDashSegments(
  boxes: readonly DashBox[],
  text: { line: number; right: number } | null,
  gap = 4,
): DashSegment[] {
  const lines = new Map<number, { left: number; right: number }>();
  for (const box of boxes) {
    if (!Number.isFinite(box.left) || !Number.isFinite(box.right)) continue;
    const seen = lines.get(box.line);
    if (!seen) lines.set(box.line, { left: box.left, right: box.right });
    else {
      seen.left = Math.min(seen.left, box.left);
      seen.right = Math.max(seen.right, box.right);
    }
  }
  const segments: DashSegment[] = [];
  for (const line of [...lines.keys()].sort((a, b) => a - b)) {
    const span = lines.get(line)!;
    const x1 = text && text.line === line ? Math.max(span.left, text.right + gap) : span.left;
    const x2 = span.right;
    if (x2 - x1 < 6) continue;
    segments.push({ line, x1, x2 });
  }
  return segments;
}

type EngravedElem = {
  el_type?: string;
  startChar?: number;
  endChar?: number;
  abselem?: { elemset?: Element[] };
};
type EngravedLike = { lines?: Array<{ staff?: Array<{ voices?: EngravedElem[][] }> }> };

const SVG_NS = "http://www.w3.org/2000/svg";

function boxOf(node: Element): { x: number; y: number; width: number; height: number } | null {
  try {
    const box = (node as SVGGraphicsElement).getBBox();
    if (!box.width && !box.height) return null;
    return box;
  } catch {
    return null;
  }
}

/**
 * abcjs 自动换行时，途中转调之后、源码换行处的那一行开头会把调号刻两遍
 * （看起来像多了升降号）。去掉完全重复的那一份。（试过用「\\」续行，会让 abcjs 丢掉大部分 ♩=，不用。）
 * 返回去掉了几份。
 */
export function dropDoubledKeySignatures(svg: SVGSVGElement | null | undefined): number {
  if (!svg) return 0;
  const seen = new Set<string>();
  let dropped = 0;
  for (const node of [...svg.querySelectorAll(".abcjs-key-signature")]) {
    const tag = (node.getAttribute("class") ?? "").split(/\s+/).filter((name) => /^abcjs-(l|m|mm|v)\d+$/.test(name)).sort().join(" ");
    if (!tag) continue;
    if (seen.has(tag)) {
      node.remove();
      dropped += 1;
    } else seen.add(tag);
  }
  return dropped;
}

/** 在已刻好的五线谱 SVG 上画渐变虚线。只往 SVG 里加线，不改宿主大小。返回画了几段。 */
export function drawStaffGraduals(
  svg: SVGSVGElement | null | undefined,
  tunes: readonly EngravedLike[],
  graduals: readonly StaffGradualChars[],
): number {
  if (!svg) return 0;
  svg.querySelectorAll("[data-staff-gradual]").forEach((el) => el.remove());
  if (!graduals.length) return 0;
  const layer = svg.ownerDocument.createElementNS(SVG_NS, "g");
  layer.setAttribute("data-staff-gradual", "");
  layer.setAttribute("pointer-events", "none");
  let drawn = 0;
  for (const span of graduals) {
    const boxes: DashBox[] = [];
    const tops = new Map<number, number>();
    let text: { line: number; right: number; y: number } | null = null;
    const label = staffGradualLabel(span.kind);
    tunes.forEach((tune) => {
      (tune.lines ?? []).forEach((line, lineIndex) => {
        const voice = line.staff?.[0]?.voices?.[0] ?? [];
        for (const elem of voice) {
          if (elem.el_type !== "note" || elem.startChar == null) continue;
          if (elem.startChar < span.start - 1 || elem.startChar >= span.end) continue;
          const group = (elem.abselem?.elemset ?? []).find((node) => node.classList?.contains("abcjs-note") || node.classList?.contains("abcjs-rest"))
            ?? elem.abselem?.elemset?.[0];
          if (!group) continue;
          const heads = [...group.querySelectorAll(".abcjs-notehead")];
          const parts = heads.length ? heads : [group];
          for (const part of parts) {
            const box = boxOf(part);
            if (!box) continue;
            boxes.push({ line: lineIndex, left: box.x, right: box.x + box.width });
          }
          const staffBox = boxOf(svg.querySelector(`.abcjs-staff.abcjs-l${lineIndex}`) ?? group);
          if (staffBox && !tops.has(lineIndex)) tops.set(lineIndex, staffBox.y);
          if (!text) {
            const words = [...group.querySelectorAll("text.abcjs-annotation, .abcjs-annotation")].find(
              (node) => (node.textContent ?? "").trim() === label,
            );
            const wordBox = words ? boxOf(words) : null;
            if (words && wordBox) {
              words.setAttribute("data-staff-gradual-kind", span.kind);
              text = { line: lineIndex, right: wordBox.x + wordBox.width, y: wordBox.y + wordBox.height * 0.6 };
            }
          }
        }
      });
    });
    const textAt = text as { line: number; right: number; y: number } | null;
    for (const segment of gradualDashSegments(boxes, textAt)) {
      const y = textAt && textAt.line === segment.line ? textAt.y : (tops.get(segment.line) ?? 0) - 10;
      const dash = svg.ownerDocument.createElementNS(SVG_NS, "line");
      dash.setAttribute("x1", segment.x1.toFixed(1));
      dash.setAttribute("x2", segment.x2.toFixed(1));
      dash.setAttribute("y1", y.toFixed(1));
      dash.setAttribute("y2", y.toFixed(1));
      dash.setAttribute("stroke", "#1c1916");
      dash.setAttribute("stroke-width", "0.9");
      dash.setAttribute("stroke-dasharray", "4 3");
      dash.setAttribute("data-staff-gradual-line", span.kind);
      layer.appendChild(dash);
      drawn += 1;
    }
  }
  if (drawn) svg.appendChild(layer);
  return drawn;
}
