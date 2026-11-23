/** Pure metronome model: tap tempo, accents, and lookahead click schedules. */
export const METRO_MIN_BPM = 30;
export const METRO_MAX_BPM = 240;
export type BeatAccent = "strong" | "normal" | "mute";
export type Subdivision = 1 | 2 | 3 | 4;
export const SUBDIVISIONS: readonly { value: Subdivision; label: string }[] = [
  { value: 1, label: "不细分" },
  { value: 2, label: "八分（2）" },
  { value: 3, label: "三连音（3）" },
  { value: 4, label: "十六分（4）" },
];
export const ACCENT_LABEL: Record<BeatAccent, string> = { strong: "重", normal: "普通", mute: "静音" };

export function clampBpm(bpm: number): number {
  if (!Number.isFinite(bpm)) return 100;
  return Math.min(METRO_MAX_BPM, Math.max(METRO_MIN_BPM, Math.round(bpm)));
}

/** Default accents: first beat strong, others normal. */
export function defaultAccents(beats: number): BeatAccent[] {
  const n = Math.max(1, Math.min(12, Math.round(beats) || 4));
  return Array.from({ length: n }, (_, i) => (i === 0 ? "strong" : "normal"));
}
/** Keep chosen accents when the meter changes length. */
export function resizeAccents(accents: readonly BeatAccent[], beats: number): BeatAccent[] {
  const base = defaultAccents(beats);
  return base.map((value, i) => accents[i] ?? value);
}
export function cycleAccent(accent: BeatAccent): BeatAccent {
  return accent === "strong" ? "normal" : accent === "normal" ? "mute" : "strong";
}

/**
 * Tap tempo: median of the last up to 8 intervals. Taps over 2 s apart start over.
 * Returns the trimmed tap list to keep and the BPM (null until two taps).
 */
export function tapTempo(taps: readonly number[], now: number): { taps: number[]; bpm: number | null } {
  const last = taps[taps.length - 1];
  const kept = last != null && now - last <= 2000 && now > last ? [...taps, now] : [now];
  const recent = kept.slice(-9);
  const intervals = recent.slice(1).map((t, i) => t - recent[i]);
  if (!intervals.length) return { taps: recent, bpm: null };
  const sorted = [...intervals].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return { taps: recent, bpm: clampBpm(60000 / median) };
}

export type MetroClick = { when: number; beat: number; sub: number; level: number; accent: boolean };
export type MetroSettings = { bpm: number; accents: readonly BeatAccent[]; subdivision: Subdivision };

/** Level of one tick: strong/normal beat, quieter subdivisions, nothing for muted beats. */
export function clickLevel(accent: BeatAccent, sub: number): number {
  if (accent === "mute") return 0;
  if (sub > 0) return 0.35;
  return accent === "strong" ? 1 : 0.6;
}

/**
 * Ticks with time in [from, to) seconds for a metronome started at `origin`.
 * `index` is the global tick counter so the scheduler can resume where it left off.
 */
export function metroTicks(settings: MetroSettings, origin: number, fromIndex: number, to: number): { clicks: MetroClick[]; next: number } {
  const beatSec = 60 / clampBpm(settings.bpm);
  const sub = settings.subdivision;
  const tick = beatSec / sub;
  const beats = Math.max(1, settings.accents.length);
  const clicks: MetroClick[] = [];
  let index = fromIndex;
  for (;;) {
    const when = origin + index * tick;
    if (when >= to) break;
    const beatIndex = Math.floor(index / sub);
    const beat = beatIndex % beats;
    const s = index % sub;
    const accent = settings.accents[beat] ?? "normal";
    const level = clickLevel(accent, s);
    if (level > 0) clicks.push({ when, beat, sub: s, level, accent: s === 0 && accent === "strong" });
    index++;
    if (clicks.length > 512) break;
  }
  return { clicks, next: index };
}

/**
 * Practice trainers, after Pro Metronome's gap click and tempo trainer (idea only):
 * sound `play` bars, then leave `mute` bars silent so the player keeps time alone;
 * raise the tempo by `step` every `every` bars until `target`.
 */
export type GapClick = { play: number; mute: number };
export type TempoRamp = { step: number; every: number; target: number };
export const GAP_OPTIONS: readonly { id: string; label: string; gap: GapClick | null }[] = [
  { id: "off", label: "不用", gap: null },
  { id: "2-1", label: "响 2 小节，停 1 小节", gap: { play: 2, mute: 1 } },
  { id: "1-1", label: "响 1 小节，停 1 小节", gap: { play: 1, mute: 1 } },
  { id: "2-2", label: "响 2 小节，停 2 小节", gap: { play: 2, mute: 2 } },
  { id: "4-4", label: "响 4 小节，停 4 小节", gap: { play: 4, mute: 4 } },
];
export const RAMP_OPTIONS: readonly { id: string; label: string; step: number; every: number }[] = [
  { id: "off", label: "不用", step: 0, every: 0 },
  { id: "2/2", label: "每 2 小节加 2", step: 2, every: 2 },
  { id: "4/4", label: "每 4 小节加 4", step: 4, every: 4 },
  { id: "8/5", label: "每 8 小节加 5", step: 5, every: 8 },
];

/** True when 0-based bar `bar` is one of the silent bars. */
export function barMuted(gap: GapClick | null | undefined, bar: number): boolean {
  if (!gap || gap.play < 1 || gap.mute < 1) return false;
  return bar % (gap.play + gap.mute) >= gap.play;
}

/** Tempo of 0-based bar `bar`: steps up from `base`, never past the target (or the metronome range). */
export function rampBpm(base: number, ramp: TempoRamp | null | undefined, bar: number): number {
  const start = clampBpm(base);
  if (!ramp || ramp.step <= 0 || ramp.every < 1) return start;
  const target = clampBpm(ramp.target);
  if (target <= start) return start;
  return Math.min(target, start + ramp.step * Math.floor(Math.max(0, bar) / ramp.every));
}

export type TrainerSettings = MetroSettings & { gap?: GapClick | null; ramp?: TempoRamp | null };
/** Where the scheduler stands: the next tick's global index and its time. */
export type MetroCursor = { index: number; when: number };
export type TrainerClick = MetroClick & { bar: number; bpm: number; silent: boolean };

/**
 * Like `metroTicks`, but each bar takes its own tempo (ramp) and silent bars still come back
 * (with `silent`) so the beat light keeps moving. Ticks with time before `to`.
 */
export function trainerTicks(settings: TrainerSettings, cursor: MetroCursor, to: number): { clicks: TrainerClick[]; cursor: MetroCursor } {
  const sub = settings.subdivision;
  const beats = Math.max(1, settings.accents.length);
  const clicks: TrainerClick[] = [];
  let { index, when } = cursor;
  while (when < to && clicks.length <= 512) {
    const beatIndex = Math.floor(index / sub);
    const bar = Math.floor(beatIndex / beats);
    const beat = beatIndex % beats;
    const s = index % sub;
    const bpm = rampBpm(settings.bpm, settings.ramp, bar);
    const accent = settings.accents[beat] ?? "normal";
    const level = clickLevel(accent, s);
    const silent = barMuted(settings.gap, bar);
    // A silent bar reports its beats (not subdivisions) so the light keeps moving; muted beats stay dark.
    if (level > 0 && (!silent || s === 0)) clicks.push({ when, beat, sub: s, level: silent ? 0 : level, accent: !silent && s === 0 && accent === "strong", bar, bpm, silent });
    when += 60 / bpm / sub;
    index++;
  }
  return { clicks, cursor: { index, when } };
}
