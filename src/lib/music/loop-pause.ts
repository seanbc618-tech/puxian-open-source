/**
 * Loop pause and loop count for the A-B practice loop, after Amazing Slow Downer's
 * "pause between loops" and "repeat N times" (idea only, no code).
 * A pause leaves silence after each pass so the hands can reset; a count stops after N passes.
 */
export const LOOP_PAUSE_OPTIONS: readonly number[] = [0, 1, 2, 4];
export const LOOP_TIMES_OPTIONS: readonly number[] = [0, 3, 5, 10];

export const cleanLoopPause = (seconds: unknown) => (typeof seconds === "number" && LOOP_PAUSE_OPTIONS.includes(seconds) ? seconds : 0);
export const cleanLoopTimes = (times: unknown) => (typeof times === "number" && LOOP_TIMES_OPTIONS.includes(times) ? times : 0);

export type LoopClock = {
  /** Full passes finished, not counting a partial head pass. */
  done: number;
  /** Seconds into the current pass (or pass length while resting). */
  within: number;
  /** Seconds of pause left (0 while music plays). */
  rest: number;
  /** The last of `times` passes has ended. */
  finished: boolean;
};

/**
 * Where a looping run stands `since` seconds after its first full pass began.
 * `headPasses` is 1 when a partial pass (resume after a speed change) came first; it counts toward `times`.
 */
export function loopClock(since: number, passLength: number, pause: number, times: number, headPasses = 0): LoopClock {
  const length = Math.max(1e-6, passLength);
  const period = length + Math.max(0, pause);
  const t = Math.max(0, since);
  const done = Math.floor(t / period);
  const offset = t - done * period;
  const resting = offset >= length;
  const finishedPasses = done + headPasses + (resting ? 1 : 0);
  if (times > 0 && (finishedPasses >= times || done + headPasses >= times)) {
    return { done: Math.max(0, times - headPasses), within: length, rest: 0, finished: true };
  }
  return { done, within: resting ? length : offset, rest: resting ? period - offset : 0, finished: false };
}

/** How many full passes to schedule (Infinity for an endless loop). */
export function fullPasses(times: number, headPasses = 0): number {
  return times > 0 ? Math.max(0, times - headPasses) : Infinity;
}

/** Start time of full pass `index`. */
export function passStart(full0: number, index: number, passLength: number, pause: number): number {
  return full0 + index * (passLength + Math.max(0, pause));
}
