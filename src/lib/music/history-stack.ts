/** Immutable bounded history. Snapshots must be immutable values. */
export const HISTORY_LIMIT = 30;
export type History<T> = { past: T[]; future: T[] };
export function emptyHistory<T>(): History<T> {
  return { past: [], future: [] };
}
export function rememberHistory<T>(history: History<T>, current: T): History<T> {
  return { past: [...history.past, current].slice(-HISTORY_LIMIT), future: [] };
}
export function travelHistory<T>(history: History<T>, current: T, direction: "undo" | "redo") {
  const source = direction === "undo" ? history.past : history.future;
  if (!source.length) return null;
  const value = source[source.length - 1];
  const remaining = source.slice(0, -1);
  const opposite = [...(direction === "undo" ? history.future : history.past), current].slice(
    -HISTORY_LIMIT,
  );
  return {
    value,
    history:
      direction === "undo"
        ? { past: remaining, future: opposite }
        : { past: opposite, future: remaining },
  };
}
