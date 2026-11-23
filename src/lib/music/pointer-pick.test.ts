import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isLongPress, LONG_PRESS_MS, pointerMoved, PICK_SLOP_PX } from "./pointer-pick.ts";

describe("pointer-pick", () => {
  it("treats a small wobble as a tap and a scroll as movement", () => {
    assert.equal(pointerMoved(0, 0, 6, 6), false);
    assert.equal(pointerMoved(0, 0, PICK_SLOP_PX, 0), false);
    assert.equal(pointerMoved(0, 0, PICK_SLOP_PX + 1, 0), true);
    assert.equal(pointerMoved(10, 10, 10, 10 + PICK_SLOP_PX + 3), true);
  });

  it("counts a long press after the hold threshold", () => {
    assert.equal(isLongPress(1000, 1000 + LONG_PRESS_MS - 1), false);
    assert.equal(isLongPress(1000, 1000 + LONG_PRESS_MS), true);
  });
});
