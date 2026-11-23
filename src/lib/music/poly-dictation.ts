// Polyphonic dictation: Basic Pitch note events → cleaned → quantized score draft.
// Quantization reuses the MIDI importer (midi-quantize.ts), so chords, triplets,
// grace notes and the loss wording match MIDI import.
import { estimateBpm, type DetectedNote } from "./audio.ts";
import { quantizeMidi, type QuantizeReport, type TimedMidiNote } from "./midi-quantize.ts";
import { inferTonicOctave, type Score, type ScoreNote } from "./theory.ts";
import { BP_FFT_HOP, BP_SAMPLE_RATE, type PolyNoteEvent } from "./basic-pitch/notes.ts";
import { chordLine, estimateKey, inferChordSymbols } from "./poly-harmony.ts";
import { quarterAt, type PulseGrid } from "./poly-rhythm.ts";
import { barStarts } from "./practice.ts";
import type { ChordSymbol } from "./chord-symbol.ts";

/** Longest stretch sent to the model; the rest of a long upload is listed as not dictated. */
export const MAX_POLY_SECONDS = 90;
/** Onsets closer than this are one attack (a played chord). */
export const CHORD_ONSET_TOLERANCE = 0.06;
const DIVISION = 480;
/** Intervals above a louder sounding note that a harmonic usually lands on. */
const OVERTONE_INTERVALS = new Set([12, 19, 24, 28, 31, 36]);
const OVERTONE_RELEASE_TOLERANCE = 2 * BP_FFT_HOP / BP_SAMPLE_RATE;

export type PolyCleanReport = { overtones: number; blips: number };

/**
 * Drop likely overtone ghosts (an octave/twelfth above a louder note that is
 * already sounding) and short, faint blips. Counts are reported, never silent.
 */
export function cleanPolyNotes(
  notes: PolyNoteEvent[],
  keepOvertones = false,
): { notes: PolyNoteEvent[]; report: PolyCleanReport } {
  const report: PolyCleanReport = { overtones: 0, blips: 0 };
  const sorted = [...notes].filter((n) => n.dur > 0 && Number.isFinite(n.start)).sort((a, b) => a.start - b.start || a.midi - b.midi);
  const kept: PolyNoteEvent[] = [];
  for (const n of sorted) {
    if (n.dur < 0.12 && n.amplitude < 0.45) {
      report.blips++;
      continue;
    }
    if (!keepOvertones) {
      const parent = sorted.some(
        (p) =>
          p !== n &&
          OVERTONE_INTERVALS.has(n.midi - p.midi) &&
          p.start <= n.start + CHORD_ONSET_TOLERANCE &&
          p.start + p.dur > n.start + 0.02 &&
          // A separate attack that outlasts the lower note has its own envelope.
          (n.start - p.start <= CHORD_ONSET_TOLERANCE ||
            n.start + n.dur <= p.start + p.dur + OVERTONE_RELEASE_TOLERANCE) &&
          n.amplitude < p.amplitude * 0.7,
      );
      if (parent) {
        report.overtones++;
        continue;
      }
    }
    kept.push(n);
  }
  return { notes: kept, report };
}

/** Pull near-simultaneous onsets onto their earliest member so quantize sees one chord. */
export function clusterOnsets(notes: PolyNoteEvent[], tolerance = CHORD_ONSET_TOLERANCE): PolyNoteEvent[] {
  const sorted = [...notes].sort((a, b) => a.start - b.start || a.midi - b.midi);
  const out: PolyNoteEvent[] = [];
  let anchor = -Infinity;
  for (const n of sorted) {
    if (n.start - anchor > tolerance) anchor = n.start;
    const end = n.start + n.dur;
    out.push({ ...n, start: anchor, dur: end - anchor });
  }
  return out;
}

/** One attack per chord, for the tempo estimate shared with mono dictation. */
export function estimatePolyBpm(notes: PolyNoteEvent[]): number {
  const attacks: DetectedNote[] = [];
  for (const n of clusterOnsets(notes)) {
    const last = attacks.at(-1);
    if (last && Math.abs(last.start - n.start) < 1e-9) {
      last.dur = Math.max(last.dur, n.dur);
      continue;
    }
    attacks.push({ start: n.start, dur: n.dur, midi: n.midi });
  }
  return estimateBpm(attacks);
}

/**
 * Split point between the two voices (MIDI number, notes ≥ split go to voice 1),
 * or null when one chord layer is enough: everything sits on one side, or the
 * range is under an octave and a half.
 */
export function suggestSplit(notes: PolyNoteEvent[]): number | null {
  if (notes.length < 2) return null;
  const midis = notes.map((n) => n.midi).sort((a, b) => a - b);
  if (midis[midis.length - 1] - midis[0] < 18) return null;
  const split = 60;
  const upper = midis.filter((m) => m >= split).length;
  const lower = midis.length - upper;
  // A bass line usually has far fewer attacks than the melody and chord tones above it.
  if (upper < Math.max(2, midis.length * 0.04) || lower < Math.max(2, midis.length * 0.04)) return null;
  return split;
}

/** How much of what was heard is written. */
export type PolyLayout = "melody" | "reduced" | "all";

export const POLY_LAYOUT_LABEL: Record<PolyLayout, string> = {
  melody: "旋律＋和弦名（最好读）",
  reduced: "两手简化（每个和弦最多 3 个音）",
  all: "全部听到的音",
};

export type PolyDraftOptions = {
  bpm: number;
  /**
   * Beats followed through the performance. When given, notes are placed on these
   * beats (rubato does not drift), and bpm/meter/pickup come from it.
   */
  pulse?: PulseGrid;
  /** Default "all" keeps the old behaviour for callers that do not choose. */
  layout?: PolyLayout;
  grid?: 0.25 | 0.125;
  /** MIDI split between voices, or null for one chord layer in the active voice. */
  split: number | null;
  keepOvertones?: boolean;
  /** Seconds of audio left out because the upload was longer than MAX_POLY_SECONDS. */
  clippedSeconds?: number;
};

export type PolyDraft = {
  /** Base score with bpm/key and the dictated voice(s) replaced. */
  score: Score;
  /** True when both voices were written (split); false for one chord layer. */
  twoVoices: boolean;
  detected: number;
  written: number;
  chords: number;
  notice: string;
  losses: string[];
  notes: string[];
  reports: QuantizeReport[];
  clean: PolyCleanReport;
  /** Chord names per bar for the preview, e.g. "| Am | E |". */
  chordLine: string;
  /** Quarter notes of rest written before the first note so bar 1 starts on the downbeat. */
  pickup: number;
};

/** `zero` is the pulse-grid position written as the start of the score. */
function toTicks(notes: PolyNoteEvent[], origin: number, bpm: number, pulse?: PulseGrid, zero = 0): TimedMidiNote[] {
  if (pulse) {
    return notes.map((n) => {
      const start = Math.max(0, Math.round((quarterAt(pulse, n.start) - zero) * DIVISION));
      const end = Math.round((quarterAt(pulse, n.start + n.dur) - zero) * DIVISION);
      return { start, end: Math.max(start + 1, end), midi: n.midi };
    });
  }
  const perSecond = (bpm / 60) * DIVISION;
  return notes.map((n) => {
    const start = Math.max(0, Math.round((n.start - origin) * perSecond));
    return { start, end: Math.max(start + 1, Math.round((n.start + n.dur - origin) * perSecond)), midi: n.midi };
  });
}

/** Follow the top line, preferring a stronger, sustained attack over a short chord tone. */
export function melodyLine(
  notes: readonly PolyNoteEvent[],
  tolerance = CHORD_ONSET_TOLERANCE,
): PolyNoteEvent[] {
  const sorted = [...notes].sort((a, b) => a.start - b.start || a.midi - b.midi);
  const line: PolyNoteEvent[] = [];
  let anchor = -Infinity;
  for (const n of sorted) {
    if (n.start - anchor > tolerance) {
      anchor = n.start;
      line.push(n);
    } else {
      const previous = line[line.length - 1];
      const [lower, higher] = n.midi > previous.midi ? [previous, n] : [n, previous];
      line[line.length - 1] = lower.amplitude > higher.amplitude && lower.dur > 2 * higher.dur
        ? lower
        : higher;
    }
  }
  // A doubled bass can start before the lead enters. Keep a solo low
  // pickup, but omit an octave doubling that is still sounding under
  // the substantially higher first melody attack.
  const [opening, entry] = line;
  if (opening && entry && entry.midi - opening.midi >= 12 &&
      opening.start + opening.dur > entry.start && sorted.some((n) =>
        n.midi === opening.midi - 12 && Math.abs(n.start - opening.start) <= CHORD_ONSET_TOLERANCE &&
        n.start + n.dur > entry.start,
      )) {
    line.shift();
  }
  // Inner chord tones struck under a held melody note are not melody.
  const out: PolyNoteEvent[] = [];
  for (const [index, n] of line.entries()) {
    const last = out.at(-1);
    if (last) {
      const overlap = last.start + last.dur - n.start;
      const next = line[index + 1];
      // A lower accompaniment can enter late in a held note and continue
      // through its re-attack. The short overlap alone misses that case.
      if (next && overlap > CHORD_ONSET_TOLERANCE &&
          n.midi < last.midi && n.amplitude < Math.min(last.amplitude, next.amplitude) &&
          next.midi === last.midi &&
          Math.abs(next.start - (last.start + last.dur)) <= CHORD_ONSET_TOLERANCE &&
          n.start + n.dur > next.start + CHORD_ONSET_TOLERANCE) continue;
      // A weak attack mostly covered by the current melody can be an inner
      // voice, including when the accompaniment crosses above the melody.
      if (overlap > 0.05 && n.midi !== last.midi && n.dur - overlap < overlap &&
          n.amplitude < last.amplitude) continue;
      if (overlap > 0) last.dur = n.start - last.start;
    }
    out.push({ ...n });
  }
  return out;
}

/** Keep at most `max` pitches per chord: the top ones for the melody hand, the bottom ones for the bass. */
function capChords(notes: ScoreNote[], max: number, keep: "top" | "bottom"): { notes: ScoreNote[]; dropped: number } {
  let dropped = 0;
  const out = notes.map((note) => {
    if (note.pitches.length <= max) return note;
    dropped += note.pitches.length - max;
    const sorted = [...note.pitches].sort((a, b) => a - b);
    const pitches = keep === "top" ? sorted.slice(-max) : sorted.slice(0, max);
    const next: ScoreNote = { ...note, pitches };
    if (next.ornament === "arpeggio" && pitches.length < 2) delete next.ornament;
    return next;
  });
  return { notes: out, dropped };
}

/**
 * A short rest between two attacks is usually a released key, not a written rest: fold it into the
 * note before so "1 1. 0" reads as "1 -". A rest that starts on a barline or runs into the next bar stays.
 */
export function fillShortRests(notes: ScoreNote[], bar: number, maxRest: number): { notes: ScoreNote[]; filled: number } {
  const out: ScoreNote[] = [];
  let at = 0;
  let filled = 0;
  for (const note of notes) {
    const prev = out.at(-1);
    const inBar = at % bar;
    const onBarline = inBar < 1e-9 || bar - inBar < 1e-9;
    if (
      prev && prev.pitches.length && !note.pitches.length && note.dur <= maxRest + 1e-9 && !note.lyric &&
      !onBarline && Math.floor((at + 1e-9) / bar) === Math.floor((at + note.dur - 1e-9) / bar)
    ) {
      out[out.length - 1] = { ...prev, dur: prev.dur + note.dur };
      filled += 1;
    } else {
      out.push(note);
    }
    at += note.dur;
  }
  return { notes: out, filled };
}

function countPitches(notes: ScoreNote[]) {
  return notes.reduce((s, n) => s + n.pitches.length, 0);
}

/** Draft score from raw model notes. Pure and deterministic; the UI re-runs it when options change. */
export function buildPolyDraft(raw: PolyNoteEvent[], base: Score, options: PolyDraftOptions): PolyDraft {
  const { notes: cleaned, report: clean } = cleanPolyNotes(raw, options.keepOvertones);
  const pulse = options.pulse;
  const layout = options.layout ?? "all";
  const bpm = Math.max(30, Math.min(240, Math.round(pulse ? pulse.bpm : options.bpm)));
  const grid = options.grid ?? 0.25;
  // Keep the chord window within half a notation cell at fast tempos.
  const tolerance = Math.min(CHORD_ONSET_TOLERANCE, grid * 30 / bpm);
  const clustered = clusterOnsets(cleaned, tolerance).map((n) => ({ ...n, midi: Math.max(0, Math.min(127, n.midi)) }));
  const origin = clustered.length ? clustered[0].start : 0;
  const beats = pulse ? pulse.meter.beats : base.beats;
  const beatUnit = pulse ? pulse.meter.beatUnit : base.beatUnit;
  const timeline: Score = { ...base, beats, beatUnit, changes: undefined, notes: [], voice2: undefined };
  const bar = (beats * 4) / beatUnit;
  const split = layout === "melody" ? null : options.split;
  const upperRaw = layout === "melody"
    ? melodyLine(cleaned, tolerance).map((n) => ({ ...n, midi: Math.max(0, Math.min(127, n.midi)) }))
    : split == null ? clustered : clustered.filter((n) => n.midi >= split);
  const lowerRaw = split == null ? [] : clustered.filter((n) => n.midi < split);
  const twoVoices = split != null && upperRaw.length > 0 && lowerRaw.length > 0;
  const reports: QuantizeReport[] = [];
  // Keep a shared origin for pickups without shifting the grid by the first attack's timing jitter.
  const firstBeat = pulse && clustered.length ? quarterAt(pulse, origin) : 0;
  const firstStep = Math.round(firstBeat / grid);
  const clipStep = pulse ? Math.round(quarterAt(pulse, 0) / grid) : 0;
  // An attack on the clip's opening subdivision cannot have preceding recorded beats.
  // The beat tracker may have extrapolated a partial bar before the clip.
  const zero = (firstStep === clipStep ? clipStep : Math.min(0, firstStep)) * grid;
  const quantize = (list: PolyNoteEvent[]) => {
    if (!list.length) return [];
    const q = quantizeMidi(toTicks(list, origin, bpm, pulse, zero), DIVISION, bar, grid, timeline);
    reports.push(q.report);
    return q.notes;
  };
  let upper: ScoreNote[];
  let lower: ScoreNote[] = [];
  let capped = 0;
  if (twoVoices) {
    upper = quantize(upperRaw);
    lower = quantize(lowerRaw);
  } else {
    upper = quantize(upperRaw);
  }
  if (layout === "reduced") {
    // Smooth short release gaps only in the simplified arrangement.
    const maxRest = (4 / beatUnit) * 0.5;
    upper = fillShortRests(upper, bar, maxRest).notes;
    lower = fillShortRests(lower, bar, maxRest).notes;
    const a = capChords(upper, 3, "top");
    const b = capChords(lower, 2, "bottom");
    upper = a.notes;
    lower = b.notes;
    capped = a.dropped + b.dropped;
  }
  const all = [...upper, ...lower];
  const key = estimateKey(cleaned.length ? cleaned : raw);
  const leading = upper.length && !upper[0].pitches.length ? upper[0].dur : 0;
  const pickup = pulse && pulse.downbeat > 0 ? leading : 0;
  const score: Score = {
    ...base,
    bpm,
    beats,
    beatUnit,
    key: key.key,
    mode: key.mode,
    tonicOctave: inferTonicOctave(upper.flatMap((n) => n.pitches), key.key),
    notes: upper,
    ...(twoVoices ? { voice2: lower } : {}),
  };
  delete score.changes;
  if (!twoVoices && base.voice2 != null && layout !== "melody") score.voice2 = base.voice2;
  if (layout === "melody") delete score.voice2;
  // Chord names from everything heard, not only what is written (the melody layout drops the hands).
  const heardVoices: ScoreNote[][] = layout === "all" ? [upper, lower] : (() => {
    const full = quantizeMidi(toTicks(clustered, origin, bpm, pulse, zero), DIVISION, bar, grid, timeline);
    return [full.notes];
  })();
  const length = Math.max(...[upper, lower].map((v) => v.reduce((sum, n) => sum + n.dur, 0)));
  const starts = barStarts({ ...score, notes: upper, voice2: lower.length ? lower : undefined });
  const harmony = inferChordSymbols(heardVoices, starts, length, key.key, key.mode, beatUnit === 8 ? 0.5 : 1);
  const chordSymbols: ChordSymbol[] = harmony.symbols.filter((c) => c.at >= pickup - 1e-9);
  if (chordSymbols.length) score.chordSymbols = chordSymbols;
  else delete score.chordSymbols;
  const chords = all.filter((n) => n.pitches.length > 1).length;
  const written = countPitches(all);
  const discarded = reports.reduce((s, r) => s + r.discarded, 0);
  const overlaps = reports.reduce((s, r) => s + r.overlaps, 0);
  const losses: string[] = [];
  if (clean.overtones) losses.push(`疑似泛音 ${clean.overtones} 个（比同时响的低音高八度或十二度、且更轻）`);
  if (clean.blips) losses.push(`过短又过轻的杂音 ${clean.blips} 个`);
  if (discarded) losses.push(`量化时丢弃的 ${discarded} 个音（含同时超过 4 个音的和弦音）`);
  if (capped) losses.push(`为了好读去掉的内声部和弦音 ${capped} 个（和弦名仍按全部听到的音推断）`);
  if (layout === "melody") losses.push("左手与和弦内声部（只写旋律，和声见和弦名）");
  if (overlaps) losses.push(`重叠截短 ${overlaps} 处（同一声部里长音被下一个和弦截断）`);
  if (options.clippedSeconds && options.clippedSeconds > 0.5)
    losses.push(`${MAX_POLY_SECONDS} 秒以后的 ${Math.round(options.clippedSeconds)} 秒音频（未听写）`);
  if (raw.length) {
    const amps = raw.map((n) => n.amplitude);
    if (Math.max(...amps) - Math.min(...amps) >= 0.2) losses.push("音量轻重（力度变化）");
  }
  losses.push("踏板、滑音与音色（只按听到的音高和音长记）");
  const voiceText = layout === "melody"
    ? "只写最高的旋律线放入正在改的声部，和声写成和弦名；确认后替换这个声部。"
    : twoVoices
    ? `高于等于 ${midiName(split!)} 的音放入声部一，低音放入声部二；确认后替换两个声部。`
    : "全部音按和弦层放入正在改的声部；确认后只替换这个声部。";
  const notice = [
    `多音听写：听出 ${raw.length} 个音，去掉 ${clean.overtones + clean.blips} 个疑似泛音或杂音。`,
    voiceText,
    ...reports.map((r, i) => (twoVoices ? (i === 0 ? "声部一：" : "声部二：") : "") + polyQuantizeNotice(r)),
  ].join(" ");
  return {
    score,
    twoVoices,
    detected: raw.length,
    written,
    chords,
    notice,
    losses,
    notes: ["模型在本机浏览器里运行，音频不会上传。", "Basic Pitch 模型（Spotify，Apache-2.0）。"],
    reports,
    clean,
    chordLine: chordLine(harmony.bars.slice(pickup > 0 ? 1 : 0)),
    pickup,
  };
}

/** Same fields as the MIDI quantize notice, with the per-note extension list folded into a count. */
export function polyQuantizeNotice(r: QuantizeReport): string {
  const longest = r.extended.reduce((m, n) => Math.max(m, n.beats), 0);
  const extension = r.extended.length ? `和弦统一时值延长 ${r.extended.length} 个音（最多 +${longest.toFixed(2)} 拍）；` : "";
  return `量化：三连音 ${r.triplets} 组，倚音 ${r.grace} 个，短音近似 ${r.short} 个，重叠截短 ${r.overlaps} 处，丢弃 ${r.discarded} 个音，琶音 ${r.arpeggios} 组；${extension}最大落点或结束偏差 ${r.maxError.toFixed(3)} 拍。`;
}

const NAMES = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];
export function midiName(midi: number): string {
  return `${NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
}

export type NoteMatch = { precision: number; recall: number; f1: number; meanOnsetError: number; matched: number };

/**
 * mir_eval-style note matching: same pitch, onset within `onsetTolerance`
 * seconds, one-to-one, greedy by onset distance. Offsets are ignored.
 */
export function matchNotes(
  reference: { start: number; midi: number }[],
  estimate: { start: number; midi: number }[],
  onsetTolerance = 0.05,
): NoteMatch {
  const pairs: [number, number, number][] = [];
  reference.forEach((r, i) =>
    estimate.forEach((e, j) => {
      const d = Math.abs(r.start - e.start);
      if (r.midi === e.midi && d <= onsetTolerance) pairs.push([d, i, j]);
    }),
  );
  pairs.sort((a, b) => a[0] - b[0]);
  const usedR = new Set<number>();
  const usedE = new Set<number>();
  let errorSum = 0;
  for (const [d, i, j] of pairs) {
    if (usedR.has(i) || usedE.has(j)) continue;
    usedR.add(i);
    usedE.add(j);
    errorSum += d;
  }
  const matched = usedR.size;
  const precision = estimate.length ? matched / estimate.length : 0;
  const recall = reference.length ? matched / reference.length : 0;
  return {
    precision,
    recall,
    f1: precision + recall ? (2 * precision * recall) / (precision + recall) : 0,
    meanOnsetError: matched ? errorSum / matched : 0,
    matched,
  };
}
