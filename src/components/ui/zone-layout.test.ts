import test from "node:test";
import assert from "node:assert/strict";
import { isPrimaryZone, PRIMARY_ZONES } from "./zone-layout.ts";

test("only score remains on the main surface", () => {
  assert.deepEqual(PRIMARY_ZONES, ["zone-score"]);
  for (const id of PRIMARY_ZONES) assert.equal(isPrimaryZone(id), true);
  for (const id of ["zone-input", "zone-expression", "zone-lyrics", "zone-play", "zone-key", "zone-style", "zone-audio", "zone-drafts"]) {
    assert.equal(isPrimaryZone(id), false, id);
  }
});
