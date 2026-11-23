import { cleanTraining, DEFAULT_TRAINING, type SpeedTraining } from "./speed-training.ts";
import { cleanLoopPause, cleanLoopTimes } from "./loop-pause.ts";
/**
 * Per-song practice settings, kept only on this device (localStorage). They are
 * never written into the Score, drafts, exports or the cloud.
 */
import { clampSpeed, playbackSpeed, type LoopRange } from "./practice.ts";

export const PRACTICE_STORE_KEY = "puxian-practice-v1";
export const PRACTICE_STORE_LIMIT = 50;

export const PRACTICE_CLIP_LIMIT = 12;
export type PracticeClip = { id: string; name: string; range: LoopRange; speed: number };

export type PracticeSettings = {
  hand?: "right" | "left";
  otherHand?: "quiet";
  training?: SpeedTraining;
  clips?: PracticeClip[];
  /** Loop pause (seconds) and passes before stopping; absent = 0 (none / until stopped). */
  loopPause?: number;
  loopTimes?: number;
  speed: number;
  countInBars: 0 | 1 | 2;
  loopOn: boolean;
  loopRange: LoopRange | null;
};

export const DEFAULT_PRACTICE: PracticeSettings = {
  speed: 1,
  countInBars: 0,
  loopOn: false,
  loopRange: null,
};

type Entry = PracticeSettings & { at: number };
type Storage = Pick<globalThis.Storage, "getItem" | "setItem" | "removeItem">;

function cleanRange(value: unknown): LoopRange | null {
  if (!value || typeof value !== "object") return null;
  const { from, to } = value as Record<string, unknown>;
  return typeof from === "number" &&
    typeof to === "number" &&
    Number.isFinite(from) &&
    Number.isFinite(to) &&
    from >= 0 &&
    to > from
    ? { from, to }
    : null;
}

export function cleanPractice(value: unknown): PracticeSettings {
  if (!value || typeof value !== "object") return { ...DEFAULT_PRACTICE };
  const raw = value as Record<string, unknown>;
  const count = raw.countInBars === 1 || raw.countInBars === 2 ? raw.countInBars : 0;
  const loopRange = cleanRange(raw.loopRange);
  const clips = cleanClips(raw.clips);
  const training =
    raw.training && typeof raw.training === "object" ? cleanTraining(raw.training) : undefined;
  return {
    ...(training && JSON.stringify(training) !== JSON.stringify(DEFAULT_TRAINING)
      ? { training }
      : {}),
    ...(clips.length ? { clips } : {}),
    ...(raw.hand === "right" || raw.hand === "left" ? { hand: raw.hand } : {}),
    ...(raw.otherHand === "quiet" ? { otherHand: "quiet" as const } : {}),
    ...(cleanLoopPause(raw.loopPause) ? { loopPause: cleanLoopPause(raw.loopPause) } : {}),
    ...(cleanLoopTimes(raw.loopTimes) ? { loopTimes: cleanLoopTimes(raw.loopTimes) } : {}),
    speed: clampSpeed(typeof raw.speed === "number" ? raw.speed : 1),
    countInBars: count,
    loopOn: raw.loopOn === true && loopRange != null,
    loopRange,
  };
}

function readAll(storage: Storage): Record<string, Entry> {
  try {
    const parsed = JSON.parse(storage.getItem(PRACTICE_STORE_KEY) ?? "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? Object.fromEntries(
          Object.entries(parsed)
            .filter(([, v]) => v && typeof v === "object")
            .map(([k, v]) => [
              k,
              { ...cleanPractice(v), at: Number.isFinite((v as Entry).at) ? (v as Entry).at : 0 },
            ]),
        )
      : {};
  } catch {
    return {};
  }
}

export function isDefaultPractice(settings: PracticeSettings) {
  return (
    !settings.hand && !settings.otherHand &&
    !settings.training &&
    !settings.clips?.length &&
    !settings.loopPause && !settings.loopTimes &&
    settings.speed === 1 &&
    settings.countInBars === 0 &&
    !settings.loopOn &&
    settings.loopRange == null
  );
}

export function loadPractice(storage: Storage | undefined, songId: string): PracticeSettings {
  if (!storage || !songId) return { ...DEFAULT_PRACTICE };
  const entry = readAll(storage)[songId];
  return entry ? cleanPractice(entry) : { ...DEFAULT_PRACTICE };
}

/** Saves (or forgets, when back to defaults) one song's settings; keeps the newest LIMIT songs. */
export function savePractice(
  storage: Storage | undefined,
  songId: string,
  settings: PracticeSettings,
  now = Date.now(),
) {
  if (!storage || !songId) return;
  const all = readAll(storage);
  const clean = cleanPractice(settings);
  if (isDefaultPractice(clean)) delete all[songId];
  else all[songId] = { ...clean, at: now };
  const kept = Object.entries(all)
    .sort(([, a], [, b]) => (b.at ?? 0) - (a.at ?? 0))
    .slice(0, PRACTICE_STORE_LIMIT);
  try {
    if (!kept.length) storage.removeItem(PRACTICE_STORE_KEY);
    else storage.setItem(PRACTICE_STORE_KEY, JSON.stringify(Object.fromEntries(kept)));
  } catch {
    // Quota or private mode: practice settings are a convenience only.
  }
}

export function cleanClips(value: unknown): PracticeClip[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value
    .flatMap((raw) => {
      if (!raw || typeof raw !== "object") return [];
      const range = cleanRange(raw.range);
      if (
        !range ||
        typeof raw.id !== "string" ||
        !raw.id ||
        seen.has(raw.id) ||
        typeof raw.name !== "string" ||
        !raw.name.trim() ||
        typeof raw.speed !== "number" ||
        !Number.isFinite(raw.speed)
      )
        return [];
      seen.add(raw.id);
      return [
        {
          id: raw.id.slice(0, 100),
          name: raw.name.trim().slice(0, 60),
          range,
          speed: playbackSpeed(raw.speed),
        },
      ];
    })
    .slice(0, PRACTICE_CLIP_LIMIT);
}
export function addPracticeClip(
  clips: readonly PracticeClip[],
  clip: PracticeClip,
): PracticeClip[] {
  return cleanClips([...clips, clip]);
}
