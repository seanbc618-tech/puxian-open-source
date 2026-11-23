import test from "node:test";
import assert from "node:assert/strict";
import { COMPACT_TITLE_QUERY, estimateTitleWidth, singleLineTitle, titleFolds, titleNeedsOwnRow } from "./title-fit.ts";

test("short titles stay beside the tools; long ones get a full-width row", () => {
  for (const title of ["小星星", "两只老虎", "欢乐颂", "Ode", ""]) assert.equal(titleNeedsOwnRow(title), false, title);
  for (const title of ["两只老虎（我的版本）", "这是一个非常非常长的曲名", "Twinkle Twinkle Little Star"])
    assert.equal(titleNeedsOwnRow(title), true, title);
  assert.ok(estimateTitleWidth("星星") > estimateTitleWidth("ab"));
});

test("titles stay one logical line", () => {
  assert.equal(singleLineTitle("第一行\n第二行\r\n\t第三"), "第一行 第二行 第三");
  assert.equal(singleLineTitle("无换行"), "无换行");
});

test("small phones fold an unfocused long title to one line; editing unfolds it", () => {
  assert.equal(titleFolds({ long: true, compact: true, focused: false }), true);
  assert.equal(titleFolds({ long: true, compact: true, focused: true }), false);
  assert.equal(titleFolds({ long: true, compact: false, focused: false }), false, "390×844 keeps the two-line title");
  assert.equal(titleFolds({ long: false, compact: true, focused: false }), false);
  assert.match(COMPACT_TITLE_QUERY, /max-width: 359px/);
  assert.match(COMPACT_TITLE_QUERY, /max-height: 700px/);
});
