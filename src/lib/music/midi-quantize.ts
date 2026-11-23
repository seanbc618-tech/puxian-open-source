// Adapted concepts from StarryCosmosPiano/genshin-jianpu-editor importer.ts.
// Original work Copyright (c) 2026 lodebar2026
// Modifications Copyright (c) 2026 StarryCosmosPiano
// MIT; full notice: public/third-party/genshin-jianpu-editor-LICENSE.txt
import { nextBar, nextChange } from "./score-timeline.ts";
import type { Score, ScoreNote } from "./theory.ts";

export type TimedMidiNote = { start: number; end: number; midi: number };
/** Rolled-chord limits in quarter notes: onset step, whole spread, hold after the last onset, release spread. */
const ARP_STEP = 0.125;
const ARP_SPREAD = 0.375;
const ARP_HOLD = 0.25;
const ARP_RELEASE = 0.25;

/** Same residue snap as mono dictation. Kept local so this file does not import the audio chunk. */
function cleanBeat(value: number): number {
  if (!Number.isFinite(value)) return value;
  let best = value;
  let bestErr = 1e-8;
  for (const den of [1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64]) {
    const snapped = Math.round(value * den) / den;
    const err = Math.abs(value - snapped);
    if (err < bestErr) {
      best = snapped;
      bestErr = err;
    }
  }
  return best;
}
export type QuantizeReport = {
  triplets: number;
  grace: number;
  short: number;
  overlaps: number;
  discarded: number;
  /** Rolled chords merged into one chord with the arpeggio mark. */
  arpeggios: number;
  maxError: number;
  extended: { midi: number; beats: number }[];
};

/** Absolute tick positions are retained until projection; errors never accumulate. */
export function quantizeMidi(raw: TimedMidiNote[], division: number, bar: number, grid = 0.25, timeline?: Score) {
  if (![0.125, 0.25, 0.5, 1].includes(grid)) throw new Error("MIDI 量化网格须为可书写的二进制时值");
  if (!(division > 0)) throw new Error("MIDI 每拍刻度无效");
  const report: QuantizeReport = {
    triplets: 0,
    grace: 0,
    short: 0,
    overlaps: 0,
    discarded: 0,
    arpeggios: 0,
    maxError: 0,
    extended: [],
  };
  const groups: {
    start: number;
    end: number;
    pitches: number[];
    originals: TimedMidiNote[];
    gracePitch?: number;
    arpeggio?: boolean;
    cell?: number;
    anchor?: number;
    tripletStart?: boolean;
    tripletSpan?: number;
  }[] = [];
  for (const n of [...raw].sort((a, b) => a.start - b.start || b.midi - a.midi)) {
    const start = n.start / division,
      end = n.end / division;
    const prev = groups.at(-1);
    if (prev && Math.abs(prev.start - start) <= 1 / 64) {
      prev.pitches.push(n.midi);
      prev.originals.push({ start, end, midi: n.midi });
      prev.end = Math.max(prev.end, end);
    } else groups.push({ start, end, pitches: [n.midi], originals: [{ start, end, midi: n.midi }] });
  }
  // A rolled chord: three or more onsets rising within a short spread, all still
  // held after the last one and released together, become one chord marked
  // arpeggio. A broken-chord melody releases each note first and stays notes.
  for (let i = 0; i < groups.length; i++) {
    let j = i;
    while (
      j + 1 < groups.length &&
      Math.min(...groups[j + 1].pitches) > Math.max(...groups[j].pitches) &&
      groups[j + 1].start - groups[j].start <= ARP_STEP &&
      groups[j + 1].start - groups[i].start <= ARP_SPREAD
    ) j++;
    if (j - i + 1 < 3) continue;
    const run = groups.slice(i, j + 1);
    const ends = run.map((g) => g.end);
    const last = run[run.length - 1].start;
    if (Math.min(...ends) < last + ARP_HOLD || Math.max(...ends) - Math.min(...ends) > ARP_RELEASE) continue;
    groups.splice(i, run.length, {
      start: run[0].start,
      end: Math.max(...ends),
      pitches: run.flatMap((g) => g.pitches),
      originals: run.flatMap((g) => g.originals),
      arpeggio: true,
    });
    report.arpeggios++;
  }
  // A single short anticipation can be represented by the existing grace model.
  for (let i = 0; i + 1 < groups.length; i++) {
    const a = groups[i],
      b = groups[i + 1];
    if (
      a.pitches.length === 1 &&
      a.end - a.start < 0.125 &&
      b.start - a.start <= 0.25 &&
      a.end <= b.start + 1 / 64 &&
      b.end - b.start >= 0.25 &&
      b.gracePitch === undefined &&
      !b.arpeggio
    ) {
      b.gracePitch = a.pitches[0];
      b.start = a.start;
      groups.splice(i, 1);
      report.grace++;
      i--;
    }
  }
  const error = (x: number, step: number) => Math.abs(x - Math.round(x / step) * step);
  // Complete local 3:2 groups only; binary wins ambiguous cases.
  for (let i = 0; i + 2 < groups.length; i++) {
    for (const cell of [2 / 3, 1 / 3, 1 / 6]) {
      const anchor = Math.round(groups[i].start / (cell * 3)) * (cell * 3);
      const errors = [0, 1, 2].map((k) => Math.abs(groups[i + k].start - anchor - k * cell));
      const rms = Math.sqrt(errors.reduce((s, x) => s + x * x, 0) / 3);
      const binary = Math.sqrt(
        [0, 1, 2].reduce((s, k) => s + error(groups[i + k].start, grid) ** 2, 0) / 3,
      );
      const endErrors = [0, 1, 2].map((k) =>
        Math.abs(groups[i + k].end - anchor - (k + 1) * cell),
      );
      const groupEnd = anchor + 3 * cell;
      const next = groups[i + 3];
      // Each note must fill its cell, and the following binary onset must not
      // cut the final cell short during projection below.
      const intact = Math.max(...endErrors) <= cell * 0.2 &&
        (!next || (next.start >= groupEnd - 1e-8 &&
          Math.round(next.start / grid) * grid >= groupEnd - 1e-8));
      if (intact && Math.max(...errors) <= cell * 0.2 && rms < binary * 0.65) {
        for (let k = 0; k < 3; k++)
          Object.assign(groups[i + k], { anchor: anchor + k * cell, cell });
        groups[i].tripletStart = true;
        groups[i + 2].tripletSpan = 3 * cell;
        report.triplets++;
        i += 2;
        break;
      }
    }
  }
  const notes: ScoreNote[] = [];
  let tripletStart = 0;
  let cursor = 0;
  const snap = (x: number) => Math.round(x / grid) * grid;
  const append = (pitches: number[], start: number, end: number, gracePitch?: number, arpeggio = false) => {
    let at = start;
    while (end - at > 1e-8) {
      const boundary = timeline ? Math.min(nextBar(timeline, at), nextChange(timeline, at)) : (Math.floor((at + 1e-8) / bar) + 1) * bar;
      const stop = Math.min(end, boundary);
      if (notes.length >= 250_000) throw new Error("MIDI 量化结果过长，请分段导入");
      notes.push({
        pitches,
        dur: cleanBeat(stop - at),
        ...(gracePitch === undefined ? {} : { ornament: "grace" as const, gracePitch }),
        ...(arpeggio && pitches.length > 1 ? { ornament: "arpeggio" as const } : {}),
      });
      gracePitch = undefined;
      arpeggio = false;
      at = stop;
    }
  };
  const starts = groups.map((g) => g.anchor ?? snap(g.start));
  groups.forEach((g, i) => {
    const start = starts[i];
    if (start < cursor - 1e-8) {
      report.discarded += g.pitches.length;
      return;
    }
    if (start > cursor) append([], cursor, start);
    if (g.tripletStart) tripletStart = notes.length;
    let end = g.cell
      ? start + Math.max(1, Math.round((g.end - g.start) / g.cell)) * g.cell
      : Math.max(start + grid, snap(g.end));
    if (i + 1 < groups.length && end > starts[i + 1]) {
      end = starts[i + 1];
      report.overlaps++;
    }
    if (end <= start + 1e-8) {
      report.discarded += g.pitches.length;
      cursor = start;
      return;
    }
    if (g.end - g.start < 0.125) report.short++;
    const pitches = [...new Set(g.pitches)].sort((a, b) => a - b);
    report.discarded += Math.max(0, pitches.length - 4);
    const kept = pitches.slice(-4);
    // Score chords share one duration. Compare that output with every retained
    // original note, including shorter chord members hidden by the group end.
    for (const original of g.originals) {
      if (!kept.includes(original.midi)) continue;
      report.maxError = Math.max(
        // A rolled chord's stagger is carried by the arpeggio mark, so its
        // onset error is measured from the first tone of the roll.
        report.maxError, Math.abs(start - (g.arpeggio ? g.originals[0].start : original.start)), Math.abs(end - original.end),
      );
      if (g.originals.length > 1 && end > original.end + 1e-8) {
        report.extended.push({ midi: original.midi, beats: end - original.end });
      }
    }
    append(kept, start, end, g.gracePitch, g.arpeggio);
    if (g.tripletSpan !== undefined) {
      // Keep the exact remainder after snapping, including any bar splits.
      const last = notes.length - 1;
      const preceding = notes.slice(tripletStart, last).reduce((sum, note) => sum + note.dur, 0);
      notes[last].dur = g.tripletSpan - preceding;
    }
    cursor = end;
  });
  return { notes, report };
}

export function quantizeNotice(r: QuantizeReport): string {
  const extension = r.extended.length
    ? `和弦统一时值延长 ${r.extended.length} 个音（${r.extended.map((n) => `MIDI ${n.midi} +${n.beats.toFixed(3)} 拍`).join("，")}）；`
    : "";
  return `量化：三连音 ${r.triplets} 组，倚音 ${r.grace} 个，短音近似 ${r.short} 个，重叠截短 ${r.overlaps} 处，丢弃 ${r.discarded} 个音，琶音 ${r.arpeggios} 组（记成和弦加琶音记号）；${extension}最大落点或结束偏差 ${r.maxError.toFixed(3)} 拍。跨小节长音以等价时值序列表示，播放会重新起音。`;
}
