import assert from "node:assert/strict";
import { test } from "node:test";
import { notePlace } from "./note-place.ts";

test("selection is described as bar and position in the bar", () => {
  const q = (n = 1) => ({ pitches: [60], dur: n });
  const notes = [q(), q(), q(), q(), q(0.5), q(0.5), q(), q(2), q(4)];
  assert.deepEqual(notePlace(notes, 0, 4, 4), { bar: 1, nth: 1 });
  assert.deepEqual(notePlace(notes, 3, 4, 4), { bar: 1, nth: 4 });
  assert.deepEqual(notePlace(notes, 4, 4, 4), { bar: 2, nth: 1 });
  assert.deepEqual(notePlace(notes, 7, 4, 4), { bar: 2, nth: 4 });
  assert.deepEqual(notePlace(notes, 8, 4, 4), { bar: 3, nth: 1 });
  // 3/4 and 6/8 bar lengths.
  assert.deepEqual(notePlace(notes, 3, 3, 4), { bar: 2, nth: 1 });
  assert.deepEqual(notePlace(notes, 3, 6, 8), { bar: 2, nth: 1 });
  // Rests count as positions.
  const withRest = [q(), { pitches: [], dur: 1 }, q()];
  assert.deepEqual(notePlace(withRest, 2, 4, 4), { bar: 1, nth: 3 });
});
