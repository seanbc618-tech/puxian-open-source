import test from "node:test";
import assert from "node:assert/strict";
import {
  displayKeyName,
  displayKeyPc,
  isJianpuNaming,
  rebaseKeyNames,
  rebaseKeySignatures,
} from "./fixed-do.ts";

test("isJianpuNaming only accepts 首调 / 固定调 tokens", () => {
  assert.equal(isJianpuNaming("movable"), true);
  assert.equal(isJianpuNaming("fixed"), true);
  assert.equal(isJianpuNaming("fixed-do"), false);
  assert.equal(isJianpuNaming(""), false);
  assert.equal(isJianpuNaming(null), false);
});

test("movable display keeps the written key pitch class and name", () => {
  assert.equal(displayKeyPc(7, "movable"), 7);
  assert.equal(displayKeyPc(0, "movable"), 0);
  assert.equal(displayKeyPc(-1, "movable"), 11);
  assert.equal(displayKeyPc(14, "movable"), 2);
  assert.equal(displayKeyName("G", "movable"), "G");
  assert.equal(displayKeyName("♭E", "movable"), "♭E");
});

test("fixed-do display always uses C (pitch class 0), any written key", () => {
  for (const pc of [0, 1, 5, 7, 11, 14, -5]) {
    assert.equal(displayKeyPc(pc, "fixed"), 0, `pc ${pc}`);
  }
  assert.equal(displayKeyName("G", "fixed"), "C");
  assert.equal(displayKeyName("♭E", "fixed"), "C");
  assert.equal(displayKeyName("C", "fixed"), "C");
});

test("rebase keeps event times and only rewrites the display key", () => {
  const signatures = [{ start: 0, key: 7 }, { start: 16, key: 2 }];
  const names = [{ start: 0, name: "G" }, { start: 16, name: "D" }];
  assert.deepEqual(rebaseKeySignatures(signatures, "movable"), signatures);
  assert.deepEqual(rebaseKeyNames(names, "movable"), names);
  assert.deepEqual(rebaseKeySignatures(signatures, "fixed"), [
    { start: 0, key: 0 },
    { start: 16, key: 0 },
  ]);
  assert.deepEqual(rebaseKeyNames(names, "fixed"), [
    { start: 0, name: "C" },
    { start: 16, name: "C" },
  ]);
  assert.deepEqual(signatures, [{ start: 0, key: 7 }, { start: 16, key: 2 }], "input not mutated");
});
