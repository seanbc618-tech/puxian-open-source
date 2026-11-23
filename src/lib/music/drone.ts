/**
 * 持续音 (drone): a sustained tonic, root + fifth or triad in the score's key, to tune
 * long notes, scales and singing against. Optional 纯律 (just intonation) tunes the third
 * and fifth to whole-number ratios so the chord holds still, without beats. Pure pitch math only.
 */
import { PC, type KeyName, type Mode } from "./theory.ts";

export type DroneVoicing = "root" | "fifth" | "triad";
export type DroneTuning = "equal" | "just";
export type DroneDegree = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export const DRONE_VOICINGS: readonly { id: DroneVoicing; label: string }[] = [
  { id: "root", label: "单音" },
  { id: "fifth", label: "根音 + 五度" },
  { id: "triad", label: "三和弦" },
];
export const DRONE_DEGREES: readonly DroneDegree[] = [1, 2, 3, 4, 5, 6, 7];
export const DRONE_STORE_KEY = "puxian-drone-v1";

const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const MINOR = [0, 2, 3, 5, 7, 8, 10];
/** Just ratios for the intervals a diatonic triad can hold above its root. */
const JUST: Record<number, number> = { 3: 6 / 5, 4: 5 / 4, 6: 64 / 45, 7: 3 / 2, 8: 8 / 5 };

const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

/** Root MIDI: the tonic between C3 and B3, then up the scale to `degree`. */
export function droneRoot(key: KeyName, mode: Mode, degree: DroneDegree): number {
  return 48 + PC[key] + (mode === "minor" ? MINOR : MAJOR)[degree - 1];
}

/** Semitones above the root: 0; 0 7 (a pure fifth); or the diatonic third and fifth. */
export function droneIntervals(mode: Mode, degree: DroneDegree, voicing: DroneVoicing): number[] {
  if (voicing === "root") return [0];
  if (voicing === "fifth") return [0, 7];
  const steps = mode === "minor" ? MINOR : MAJOR;
  const at = (i: number) => steps[i % 7] + (i >= 7 ? 12 : 0);
  const root = at(degree - 1);
  return [0, at(degree + 1) - root, at(degree + 3) - root];
}

/** Tone frequencies, root first. Just tuning keeps the root on equal temperament. */
export function droneFrequencies(key: KeyName, mode: Mode, degree: DroneDegree, voicing: DroneVoicing, tuning: DroneTuning): number[] {
  const root = hz(droneRoot(key, mode, degree));
  return droneIntervals(mode, degree, voicing).map((semis) =>
    semis === 0 ? root : root * (tuning === "just" && JUST[semis] ? JUST[semis] : 2 ** (semis / 12)));
}

/** Cents a just interval sits from equal temperament (for the 「纯律」 hint), e.g. 大三度 −14. */
export function justCents(semis: number): number {
  const ratio = JUST[semis];
  return ratio ? Math.round(1200 * Math.log2(ratio) - semis * 100) : 0;
}

export type DroneSettings = { voicing: DroneVoicing; tuning: DroneTuning; volume: number };
export const DEFAULT_DRONE: DroneSettings = { voicing: "fifth", tuning: "equal", volume: 0.5 };

type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;

export function cleanDrone(value: unknown): DroneSettings {
  if (!value || typeof value !== "object") return DEFAULT_DRONE;
  const raw = value as Record<string, unknown>;
  const voicing = DRONE_VOICINGS.some((v) => v.id === raw.voicing) ? (raw.voicing as DroneVoicing) : DEFAULT_DRONE.voicing;
  const tuning = raw.tuning === "just" ? "just" : "equal";
  const volume = typeof raw.volume === "number" && Number.isFinite(raw.volume) ? Math.min(1, Math.max(0.05, Math.round(raw.volume * 100) / 100)) : DEFAULT_DRONE.volume;
  return { voicing, tuning, volume };
}

export function readDrone(storage: Storage): DroneSettings {
  try {
    const raw = storage.getItem(DRONE_STORE_KEY);
    return raw ? cleanDrone(JSON.parse(raw)) : DEFAULT_DRONE;
  } catch {
    return DEFAULT_DRONE;
  }
}

export function writeDrone(storage: Storage, settings: DroneSettings): boolean {
  try {
    storage.setItem(DRONE_STORE_KEY, JSON.stringify(cleanDrone(settings)));
    return true;
  } catch {
    return false;
  }
}
