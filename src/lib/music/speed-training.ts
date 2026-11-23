import { SPEED_MIN, SPEED_MAX } from "./practice.ts";
export type SpeedTraining = {
  start: number;
  target: number;
  step: number;
  repeats: number;
  countEach: boolean;
};
export const DEFAULT_TRAINING: SpeedTraining = {
  start: 50,
  target: 100,
  step: 10,
  repeats: 4,
  countEach: false,
};
export function cleanTraining(value: unknown): SpeedTraining {
  const v = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const num = (key: string, fallback: number, min: number, max: number) =>
    typeof v[key] === "number" && Number.isFinite(v[key])
      ? Math.max(min, Math.min(max, Math.round(v[key] as number)))
      : fallback;
  return {
    start: num("start", 50, SPEED_MIN * 100, SPEED_MAX * 100),
    target: num("target", 100, SPEED_MIN * 100, SPEED_MAX * 100),
    step: num("step", 10, 1, 70),
    repeats: num("repeats", 4, 1, 100),
    countEach: v.countEach === true,
  };
}
/** Integer percentages avoid accumulated floating point error. Start >= target is one target stage. */
export function trainingStages(settings: SpeedTraining): number[] {
  const s = cleanTraining(settings);
  const stages: number[] = [];
  for (let speed = Math.min(s.start, s.target); speed < s.target; speed += s.step)
    stages.push(speed);
  return [...stages, s.target];
}
export function trainingProgress(settings: SpeedTraining, completed: number) {
  const s = cleanTraining(settings);
  const stages = trainingStages(s);
  const total = stages.length * s.repeats;
  const done = Math.max(0, Math.min(total, Math.floor(completed) || 0));
  const stage = Math.min(stages.length - 1, Math.floor(done / s.repeats));
  return {
    completed: done,
    total,
    done: done === total,
    speed: stages[stage] / 100,
    pass: done + 1,
    stagePass: (done % s.repeats) + 1,
    next: stages[stage + 1] ?? null,
  };
}
export function advanceTraining(settings: SpeedTraining, completed: number) {
  return trainingProgress(settings, trainingProgress(settings, completed).completed + 1);
}
