import { test } from "node:test";
import assert from "node:assert/strict";
import { followScrollLeft, followScrollTop } from "./follow-scroll.ts";

const view = { top: 100, height: 400, scrollTop: 0, maxScroll: 2000 };

test("音在视窗中段时不滚动", () => {
  assert.equal(followScrollTop(view, { top: 250, bottom: 280 }), null);
});

test("音落到下方时滚到距顶 30% 处，且不超出范围", () => {
  assert.equal(followScrollTop(view, { top: 520, bottom: 550 }), 300);
  assert.equal(followScrollTop({ ...view, maxScroll: 120 }, { top: 520, bottom: 550 }), 120);
});

test("往回跳（循环回到开头）时向上滚，不小于 0", () => {
  assert.equal(followScrollTop({ ...view, scrollTop: 900 }, { top: -300, bottom: -270 }), 380);
  assert.equal(followScrollTop({ ...view, scrollTop: 50 }, { top: 40, bottom: 70 }), 0);
});

test("没有高度或已在目标位置时返回 null", () => {
  assert.equal(followScrollTop({ ...view, height: 0 }, { top: 900, bottom: 930 }), null);
  assert.equal(followScrollTop({ ...view, maxScroll: 0 }, { top: 900, bottom: 930 }), null);
});

test("横向：行比视窗宽时跟随，放得下时不动", () => {
  const row = { left: 0, width: 300, scrollLeft: 0, maxScroll: 500 };
  assert.equal(followScrollLeft(row, { left: 100, right: 120 }), null);
  assert.equal(followScrollLeft(row, { left: 290, right: 310 }), 200);
  assert.equal(followScrollLeft({ ...row, maxScroll: 0 }, { left: 290, right: 310 }), null);
});
