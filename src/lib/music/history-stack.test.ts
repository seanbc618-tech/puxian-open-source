import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyHistory, rememberHistory, travelHistory } from "./history-stack.ts";
test("undo/redo preserves full immutable score snapshots and register; branching clears redo", () => {
  const a = {
    score: { voice2: [], lyrics: { fragments: ["你", "好"] }, expression: "p" },
    register: 60,
  };
  const b = { ...a, register: 62 };
  const h = rememberHistory(emptyHistory<typeof a>(), a);
  const undo = travelHistory(h, b, "undo")!;
  assert.deepEqual(undo.value, a);
  const redo = travelHistory(undo.history, a, "redo")!;
  assert.deepEqual(redo.value, b);
  assert.deepEqual(rememberHistory(undo.history, a).future, []);
  assert.equal(travelHistory(emptyHistory(), a, "undo"), null);
});
test("history is bounded at thirty and does not mutate prior history", () => {
  let h = emptyHistory<number>();
  const original = h;
  for (let i = 0; i < 45; i++) h = rememberHistory(h, i);
  assert.equal(h.past.length, 30);
  assert.equal(h.past[0], 15);
  assert.deepEqual(original, emptyHistory());
});
