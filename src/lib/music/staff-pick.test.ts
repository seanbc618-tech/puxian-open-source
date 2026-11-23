import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyMark } from "./expression.ts";
import {
  applyStaffPick,
  noteShapeOf,
  selectionSurvivesEdit,
  type SelectionOwner,
  type StaffPick,
} from "./staff-pick.ts";
import type { ScoreNote } from "./theory.ts";

function notes(count: number): ScoreNote[] {
  return Array.from({ length: count }, (_, index) => ({ pitches: [60 + index], dur: 1 }));
}

const idle: StaffPick = { voice: 0, anchor: null, selected: [] };

describe("选一段 ordinary clicks", () => {
  it("forms a range from two clicks that are not Shift, then lets a slur use it", () => {
    const first = applyStaffPick(idle, { index: 0, extend: false, voice: 0 }, true, 4);
    assert.deepEqual(first.selected, [0]);
    assert.equal(first.anchor, 0);
    const second = applyStaffPick(first, { index: 2, extend: false, voice: 0 }, true, 4);
    assert.deepEqual(second.selected, [0, 1, 2]);
    assert.equal(second.anchor, null);
    const marked = applyMark(notes(4), second.selected, { type: "slur" });
    assert.equal(marked[0].slurStart, true);
    assert.equal(marked[2].slurEnd, true);
    const wedge = applyMark(notes(4), second.selected, { type: "hairpin", value: "cresc" });
    assert.equal(wedge[0].hairpin, "cresc");
    assert.equal(wedge[2].hairpinEnd, true);
    const third = applyStaffPick(second, { index: 3, extend: false, voice: 0 }, true, 4);
    assert.deepEqual(third.selected, [3]);
    assert.equal(third.anchor, 3);
  });

  it("keeps the Shift anchor and does not treat a plain click outside 选一段 as a range", () => {
    const start = applyStaffPick(idle, { index: 1, extend: true, voice: 0 }, false, 4);
    const held = applyStaffPick(start, { index: 3, extend: true, voice: 0 }, false, 4);
    assert.deepEqual(held.selected, [1, 2, 3]);
    assert.equal(held.anchor, 1);
    const plain = applyStaffPick(held, { index: 0, extend: false, voice: 0 }, false, 4);
    assert.deepEqual(plain.selected, [0]);
    assert.equal(plain.anchor, 0);
  });

  it("does not carry a range onto the other voice", () => {
    const anchored = applyStaffPick(idle, { index: 0, extend: false, voice: 0 }, true, 4);
    const crossed = applyStaffPick(anchored, { index: 2, extend: false, voice: 1 }, true, 4);
    assert.equal(crossed.voice, 1);
    assert.deepEqual(crossed.selected, [2]);
    assert.equal(crossed.anchor, 2);
    const shifted = applyStaffPick(
      { voice: 0, anchor: 0, selected: [0, 1] },
      { index: 3, extend: true, voice: 1 },
      false,
      4,
    );
    assert.equal(shifted.voice, 1);
    assert.deepEqual(shifted.selected, [3]);
    const stayed = applyStaffPick(crossed, { index: 0, extend: false, voice: 1 }, true, 4);
    assert.deepEqual(stayed.selected, [0, 1, 2]);
    assert.equal(stayed.voice, 1);
  });
});

function click(
  pick: StaffPick,
  owner: SelectionOwner | null,
  index: number,
  extend: boolean,
  voice: 0 | 1,
  rangeMode: boolean,
  line: ScoreNote[],
): { pick: StaffPick; owner: SelectionOwner | null } {
  const next = applyStaffPick(pick, { index, extend, voice }, rangeMode, line.length);
  if (next.voice === pick.voice && next.anchor === pick.anchor && next.selected === pick.selected) {
    return { pick, owner };
  }
  return { pick: next, owner: { voice: next.voice, shape: noteShapeOf(line) } };
}

function afterEdit(
  owner: SelectionOwner | null,
  voice: 0 | 1,
  line: ScoreNote[],
): StaffPick | null {
  const shape = noteShapeOf(line);
  if (selectionSurvivesEdit(owner, voice, shape)) return null;
  return { voice, anchor: null, selected: [] };
}

describe("selection after a note edit", () => {
  it("drops a same-voice click when the melody is replaced by a shorter line", () => {
    const four = notes(4);
    const picked = click(idle, null, 3, false, 0, false, four);
    assert.deepEqual(picked.pick.selected, [3]);
    assert.equal(picked.pick.anchor, 3);
    const cleared = afterEdit(picked.owner, 0, notes(2));
    assert.deepEqual(cleared, { voice: 0, anchor: null, selected: [] });
    assert.equal(applyMark(notes(2), [3], { type: "dynamic", value: "f" })[0].dynamic, undefined);
  });

  it("drops the selection when a cross-voice click lands on an equal shape and that voice is then edited", () => {
    const line = notes(2);
    const onFirst = click(idle, null, 0, false, 0, false, line);
    const onSecond = click(onFirst.pick, onFirst.owner, 1, false, 1, false, line);
    assert.equal(onSecond.pick.voice, 1);
    assert.deepEqual(onSecond.pick.selected, [1]);
    assert.equal(selectionSurvivesEdit(onSecond.owner, 1, noteShapeOf(line)), true);
    const cleared = afterEdit(onSecond.owner, 1, [notes(1)[0]]);
    assert.deepEqual(cleared, { voice: 1, anchor: null, selected: [] });
  });
});
