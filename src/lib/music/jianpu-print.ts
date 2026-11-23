import { standardRhythm, rhythmFraction } from "./rhythm-spelling.ts";
import { writtenJianpuKey } from "./jianpu-key.ts";
import { repeatProblem } from "./repeats.ts";
import { voiceList } from "./voices.ts";
import {
  degreeToken,
  transposeKey,
  transposeScore,
  KEY_NAMES,
  type KeyName,
  type Mode,
  type Score,
} from "./theory.ts";
import {
  contentBox,
  normalizePrintSettings,
  measuresForPrint,
  planPrintPages,
  musicSlotPx,
  firstHeaderPx,
  pageLabel,
  type PrintSettings,
} from "./print-layout.ts";
import { installPrintPageCss } from "./print-sheet.ts";

export type ExportView = "jianpu" | "staff" | "tab";
export const exportView = (view: ExportView, chosen: ExportView | null): ExportView =>
  chosen ?? view;
export function exportPipeline<T>(mode: ExportView, jianpu: () => T, staff: () => T, tab?: () => T): T {
  if (mode === "jianpu") return jianpu();
  if (mode === "tab") {
    if (!tab) throw new Error("缺少六线谱导出管线");
    return tab();
  }
  return staff();
}

/** Mid-score marks used when Score.changes is present (e.g. after MIDI 曲中变化). */
export type ScoreChangeMark = {
  at: number;
  bpm?: number;
  beats?: number;
  beatUnit?: number;
  key?: string;
  writtenKey?: string;
  mode?: string;
};

const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!,
  );
const text = (x: number, y: number, s: string, size = 18, attrs = "", anchor = "middle") =>
  `<text x="${x}" y="${y}" font-size="${size}" text-anchor="${anchor}" ${attrs}>${esc(s)}</text>`;
const line = (x: number, y: number, xx: number, yy: number) =>
  `<line x1="${x}" y1="${y}" x2="${xx}" y2="${yy}" stroke="currentColor"/>`;

const isKeyName = (key: string): key is KeyName =>
  (KEY_NAMES as readonly string[]).includes(key);

export function scoreChanges(score: Score, shift = 0): ScoreChangeMark[] {
  const raw = (score as Score & { changes?: ScoreChangeMark[] }).changes;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((change) => change && Number.isFinite(change.at) && change.at > 0)
    .map((change) => {
      const next: ScoreChangeMark = { ...change };
      if (next.key && isKeyName(next.key)) {
        next.writtenKey = writtenJianpuKey(next.key, shift);
        if (shift) next.key = transposeKey(next.key, shift);
      }
      return next;
    })
    .sort((a, b) => a.at - b.at);
}

function measureSpans(
  duration: number,
  beats0: number,
  beatUnit0: number,
  changes: ScoreChangeMark[],
  measureEnds?: number[],
): { start: number; end: number; beats: number; beatUnit: number }[] {
  if (duration <= 0) return [];
  const measures: { start: number; end: number; beats: number; beatUnit: number }[] = [];
  let t = 0;
  let beats = beats0;
  let beatUnit = beatUnit0;
  while (t < duration - 1e-8) {
    const bar = (measureEnds?.find(end => end > t + 1e-8) ?? (t + (beats * 4) / beatUnit)) - t;
    measures.push({ start: t, end: t + bar, beats, beatUnit });
    t += bar;
    for (const change of changes) {
      if (Math.abs(change.at - t) < 1e-8) {
        if (change.beats != null) beats = change.beats;
        if (change.beatUnit != null) beatUnit = change.beatUnit;
      }
    }
  }
  return measures;
}

function keyModeAt(
  at: number,
  key: KeyName,
  mode: Mode,
  changes: ScoreChangeMark[],
): { key: KeyName; mode: Mode } {
  let currentKey = key;
  let currentMode = mode;
  for (const change of changes) {
    if (change.at > at + 1e-8) break;
    if (change.key && isKeyName(change.key)) currentKey = change.key;
    if (change.mode === "major" || change.mode === "minor") currentMode = change.mode;
  }
  return { key: currentKey, mode: currentMode };
}


function gradualMarks(score: Score): { from: number; to: number; kind: string }[] {
  const raw = (score as Score & { gradualTempos?: { from: number; to: number; kind?: string }[] }).gradualTempos;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((mark) => mark && Number.isFinite(mark.from) && Number.isFinite(mark.to) && mark.to > mark.from)
    .map((mark) => ({ from: mark.from, to: mark.to, kind: mark.kind === "accel" ? "accel" : "rit" }));
}

function changeLabel(change: ScoreChangeMark): string {
  const parts: string[] = [];
  if (change.key) parts.push(`1=${change.writtenKey ?? change.key}`);
  if (change.beats != null && change.beatUnit != null) parts.push(`${change.beats}/${change.beatUnit}`);
  if (change.bpm != null) parts.push(`♩=${change.bpm}`);
  return parts.join(" ");
}

/** Separate, deterministic SVG engraving; screen hit targets and Score stay untouched. */
export function jianpuPrint(score: Score, settings: PrintSettings, shift = 0, caption = "") {
  const s = normalizePrintSettings(settings),
    box = contentBox(s),
    w = box.contentWidthPx,
    h = box.contentHeightPx;
  const written = transposeScore(score, shift);
  const changes = scoreChanges(score, shift);
  const voices = voiceList(written);
  const timelines = voices.map((notes) => {
    let t = 0;
    return notes.map((n) => {
      const start = t;
      t += n.dur;
      return { ...n, start, end: t };
    });
  });
  const duration = Math.max(0, ...timelines.map((v) => v.at(-1)?.end ?? 0));
  const repeats = score.repeats?.length && !repeatProblem(score) ? score.repeats : [];
  const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;
  const measures = measureSpans(duration, score.beats, score.beatUnit, changes, score.measureEnds);
  const per = measuresForPrint(s, w / s.scale);
  const systems: {
    top: number;
    bottom: number;
    markup: string;
    firstBar: number;
    lastBar: number;
  }[] = [];
  let top = 0;
  for (let first = 0; first < measures.length; ) {
    // Dense measures occupy their own system; all voices share these boundaries.
    let count = Math.min(per, measures.length - first);
    const density = (n: number) => {
      const start = measures[first].start,
        end = measures[first + n - 1].end;
      return Math.max(
        ...timelines.map((v) =>
          v
            .filter((a) => a.end > start && a.start < end)
            .reduce((sum, a) => sum + Math.max(34, (a.lyric?.text.length ?? 0) * 18), 0),
        ),
      );
    };
    while (count > 1 && density(count) * s.scale > w - 30) count--;
    const start = measures[first].start,
      end = measures[first + count - 1].end;
    const hasMarks = Boolean(written.chordSymbols?.length || written.rehearsals?.length || written.fermatas?.length);
    const heights = timelines.map(
      (v) =>
        (hasMarks && v === timelines[0] ? 88 : 70) +
        Math.max(
          1,
          ...v.filter((n) => n.end > start && n.start < end).map((n) => n.pitches.length),
        ) *
          42,
    );
    const naturalW = Math.max(w / s.scale, density(count) + 30),
      factor = Math.min(s.scale, w / naturalW);
    let markup = "",
      yBase = 0;
    timelines.forEach((voice, vi) => {
      const row = heights[vi],
        baseline = yBase + row - 44;
      const active = voice.filter((n) => n.end > start + 1e-8 && n.start < end - 1e-8);
      for (let b = first; b < first + count; b++) {
        const measure = measures[b];
        const bx = 15 + ((b - first) * (naturalW - 30)) / count,
          bw = (naturalW - 30) / count;
        const events = active.filter(
          (n) => n.end > measure.start + 1e-8 && n.start < measure.end - 1e-8,
        );
        markup += `<g data-measure="${b}" data-voice="${vi}">`;
        if (vi === 0) {
          for (const change of changes) {
            if (change.at < measure.start - 1e-8 || change.at >= measure.end - 1e-8) continue;
            const label = changeLabel(change);
            if (!label) continue;
            const ratio = (change.at - measure.start) / Math.max(measure.end - measure.start, 1e-8);
            const x = bx + Math.min(0.92, Math.max(0.08, ratio)) * bw;
            markup += text(
              x,
              yBase + 14,
              label,
              11,
              `data-change-at="${change.at}"`,
            );
          }
          for (const span of gradualMarks(written)) {
            if (span.to <= measure.start + 1e-8 || span.from >= measure.end - 1e-8) continue;
            const ratioOf = (t: number) => (t - measure.start) / Math.max(measure.end - measure.start, 1e-8);
            const x1 = bx + Math.min(0.96, Math.max(0.04, ratioOf(Math.max(span.from, measure.start)))) * bw;
            const x2 = bx + Math.min(0.96, Math.max(0.04, ratioOf(Math.min(span.to, measure.end)))) * bw;
            const y = yBase + 14;
            const startsHere = span.from >= measure.start - 1e-8 && span.from < measure.end - 1e-8;
            const kind = span.kind === "accel" ? "accel" : "rit";
            if (startsHere) {
              markup += text(
                x1,
                y,
                kind === "accel" ? "渐快 accel." : "渐慢 rit.",
                11,
                `data-gradual-from="${span.from}" data-gradual-to="${span.to}" data-gradual-kind="${kind}"`,
                "start",
              );
            }
            const dashX = startsHere ? x1 + 58 : x1;
            if (x2 > dashX + 2) {
              markup += `<line x1="${dashX}" y1="${y - 3}" x2="${x2}" y2="${y - 3}" stroke="#1c1916" stroke-width="1" stroke-dasharray="4 3" fill="none" data-gradual-line="" data-gradual-from="${span.from}" data-gradual-to="${span.to}"/>`;
            }
          }
          for (const mark of written.rehearsals ?? []) {
            if (Math.abs(mark.at - measure.start) > 1e-8) continue;
            markup += text(bx + 6, yBase + 2, `【${mark.label}】`, 12, `data-rehearsal-at="${mark.at}" font-weight="600"`);
          }
          markup += text(bx + 2, yBase + 12, String(b + 1), 9, `data-bar-number="${b + 1}" opacity="0.72"`, "start");
          const j = score.jumps;
          if (j) {
            const jumpLabel = (j.dc !== undefined ? "D.C." : "D.S.") + (j.fine !== undefined ? " al Fine" : j.toCoda !== undefined ? " al Coda" : "");
            const marks: [number | undefined, string, string, boolean][] = [
              [j.segno, "segno", "Segno", true], [j.coda, "coda", "⊕ Coda", true], [j.fine, "fine", "Fine", false],
              [j.toCoda, "toCoda", "To Coda ⊕", false], [j.dc ?? j.ds, "jump", jumpLabel, false],
            ];
            for (const [q, kind, label, atStart] of marks)
              if (q !== undefined && near(q, atStart ? measure.start : measure.end))
                markup += `<text x="${atStart ? bx + 6 : bx + bw - 6}" y="${yBase + 14}" font-size="12" font-style="italic" text-anchor="${atStart ? "start" : "end"}" data-jump="${kind}">${label}</text>`;
          }
          for (const mark of written.chordSymbols ?? []) {
            if (mark.at < measure.start - 1e-8 || mark.at >= measure.end - 1e-8) continue;
            const ratio = (mark.at - measure.start) / Math.max(measure.end - measure.start, 1e-8);
            const x = bx + Math.min(0.92, Math.max(0.08, ratio)) * bw;
            markup += text(
              x,
              yBase + 32,
              mark.symbol,
              13,
              `data-chord-at="${mark.at}" font-weight="600"`,
            );
          }
        }
        events.forEach((n, ni) => {
          const x = bx + ((ni + 0.5) * bw) / Math.max(1, events.length);
          const segStart = Math.max(n.start, measure.start),
            len = Math.min(n.end, measure.end) - segStart;
          const pitches = [...n.pitches].sort((a, b) => a - b);
          const km = keyModeAt(segStart, written.key, written.mode, changes);
          (pitches.length ? pitches : [null]).forEach((p, pi) => {
            const token =
              p === null ? "0" : degreeToken(p, km.key, km.mode, written.tonicOctave);
            const y = baseline - pi * 42;
            markup += text(
              x,
              y,
              token.replace(/[',]/g, ""),
              23,
              `data-note-start="${n.start}" data-pitch="${p ?? "rest"}"`,
            );
            const oct = (token.match(/'/g)?.length ?? 0) - (token.match(/,/g)?.length ?? 0);
            for (let o = 0; o < Math.abs(oct); o++)
              markup += `<circle cx="${x}" cy="${y + (oct > 0 ? -27 - o * 5 : 8 + o * 5)}" r="1.5"/>`;
          });
          const dotted = [0.09375, 0.1875, 0.375, 0.75, 1.5, 3, 6].some((d) => Math.abs(len - d) < 1e-6);
          const base = dotted ? len / 1.5 : len;
          if (dotted && standardRhythm(len)) markup += text(x + 16, baseline, "·", 23);
          for (let u = 0; standardRhythm(len) && u < Math.max(0, Math.ceil(-Math.log2(base) - 1e-6)); u++)
            markup += line(x - 9, baseline + 17 + u * 4, x + 9, baseline + 17 + u * 4);
          if (standardRhythm(len) && base >= 2)
            markup += text(x + 25, baseline, "—".repeat(Math.max(1, Math.floor(base) - 1)), 17);
          if (!standardRhythm(len))
            markup += text(x, baseline + 28, `[${rhythmFraction(len)}拍]`, 10);
          if ((written.fermatas ?? []).some((m) => m.voice === vi && Math.abs(m.at - n.start) < 1e-8)) {
            const fy = baseline - Math.max(1, pitches.length) * 42 - 4;
            markup += `<g data-fermata-at="${n.start}" data-fermata-voice="${vi}"><path d="M ${x - 7} ${fy} Q ${x} ${fy - 8} ${x + 7} ${fy}" fill="none" stroke="#1c1916" stroke-width="1.2" stroke-linecap="round"/><circle cx="${x}" cy="${fy - 1.5}" r="1.3" fill="#1c1916"/></g>`;
          }
          if (segStart > n.start + 1e-8 && pitches.length)
            markup += text(x, baseline - pitches.length * 42, "⌒", 18);
          if (n.lyric?.text && Math.abs(segStart - n.start) < 1e-8)
            markup += text(x, baseline + 39, n.lyric.text, 16, `data-lyric-start="${n.start}"`);
        });
        markup += line(bx + bw, yBase + 12, bx + bw, baseline + 20);
        for (const r of repeats) {
          const y1 = yBase + 12, y2 = baseline + 20, mid = (y1 + y2) / 2;
          const sign = (x: number, dir: 1 | -1, kind: string) =>
            `<rect x="${dir === 1 ? x : x - 3}" y="${y1}" width="3" height="${y2 - y1}" data-repeat="${kind}"/>` +
            line(x + dir * 6, y1, x + dir * 6, y2) +
            `<circle cx="${x + dir * 10}" cy="${mid - 7}" r="2"/><circle cx="${x + dir * 10}" cy="${mid + 7}" r="2"/>`;
          if (near(r.from, measure.start)) markup += sign(bx + 1, 1, "start");
          if (near(r.to, measure.end)) markup += sign(bx + bw, -1, "end");
          if (vi !== 0) continue;
          const spans: [number | undefined, number | undefined, string][] = [[r.ending, r.to, "1"], [r.endingEnd === undefined ? undefined : r.to, r.endingEnd, "2"]];
          for (const [from, to, label] of spans) {
            if (from === undefined || to === undefined || measure.start < from - 1e-8 || measure.start >= to - 1e-8) continue;
            const yb = yBase + 2, opens = near(from, measure.start), closes = label === "1" && near(to, measure.end);
            markup += `<path d="M ${bx + 3} ${opens ? yb + 12 : yb} V ${yb} H ${bx + bw - 3}${closes ? ` V ${yb + 12}` : ""}" fill="none" stroke="currentColor" stroke-width="1.2" data-ending="${label}"/>`;
            if (opens) markup += text(bx + 14, yb + 12, `${label}.`, 11);
          }
        }
        markup += "</g>";
      }
      yBase += row;
    });
    const height = yBase * factor;
    systems.push({
      top,
      bottom: top + height,
      markup: `<g transform="scale(${factor})">${markup}</g>`,
      firstBar: first,
      lastBar: first + count - 1,
    });
    top += height + 20;
    first += count;
  }
  const plans = planPrintPages(systems, {
    padPx: 4,
    scale: 1,
    musicHeightPx: () => musicSlotPx(h, 0, false),
  });
  const pages = plans.map((p, i) => {
    let body =
      text(w / 2, 28, score.title || "未命名", 22) +
      (score.lyricist ? text(18, 28, `词：${score.lyricist}`, 12, `data-credit="lyricist"`, "start") : "") +
      (score.composer ? text(w - 18, 28, `曲：${score.composer}`, 12, `data-credit="composer"`, "end") : "") +
      text(w / 2, 53, `1=${writtenJianpuKey(score.key, shift)}　${score.beats}/${score.beatUnit}${score.tempoMarked === false ? "" : `　♩=${score.bpm}`}`, 15);
    if (caption)
      body += text(
        w / 2,
        75,
        caption,
        12,
        caption.length * 12 > w - 20
          ? `textLength="${w - 20}" lengthAdjust="spacingAndGlyphs"`
          : "",
      );
    const header = firstHeaderPx(false);
    // Reserve the same header on subsequent pages as on the first.
    for (let j = p.start; j <= p.end; j++)
      body += `<g data-system="${j}" transform="translate(${(w * (1 - p.fit)) / 2},${header + (systems[j].top - p.viewTop) * p.fit}) scale(${p.fit})">${systems[j].markup}</g>`;
    body += text(w / 2, h - 10, pageLabel(i, plans.length), 12);
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" color="#1c1916" fill="#1c1916" font-family="Arial, sans-serif"><rect width="100%" height="100%" fill="#f7f3ea"/>${body}</svg>`;
  });
  const markup = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h * pages.length}" viewBox="0 0 ${w} ${h * pages.length}">${pages.map((p, i) => `<g transform="translate(0,${h * i})">${p}</g>`).join("")}</svg>`;
  return { pages, markup, systems, plans, width: w, height: h, measures };
}

export function drawJianpuPrint(
  host: HTMLElement,
  score: Score,
  settings: PrintSettings,
  shift: number,
  caption: string,
) {
  installPrintPageCss(settings);
  const result = jianpuPrint(score, settings, shift, caption);
  host.innerHTML = result.pages
    .map(
      (p) =>
        `<section class="print-page" style="width:${result.width}px;height:${result.height}px">${p}</section>`,
    )
    .join("");
  host.dataset.pages = String(result.pages.length);
  return result;
}
