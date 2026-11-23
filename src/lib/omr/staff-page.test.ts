import assert from "node:assert/strict";
import { test } from "node:test";
import { browserStaffRefusal } from "./staff-page.ts";

test("two staves stay a piano system and are not refused", () => {
  assert.equal(browserStaffRefusal(10, 2), null);
  assert.equal(browserStaffRefusal(15, 3), null);
});

test("one complete staff is a single treble line, even when extra rows are present", () => {
  const text = browserStaffRefusal(7, 1);
  assert.ok(text);
  assert.match(text, /^这一页是单行五线谱/);
  assert.doesNotMatch(text, /裁切|无法组成钢琴系统|谱表定位失败|简谱/);
});

test("numbered notation leads with 暂不支持简谱 and a chart does not", () => {
  const jianpu = browserStaffRefusal(12, 0);
  assert.match(jianpu ?? "", /^暂不支持简谱/);
  assert.doesNotMatch(jianpu ?? "", /谱表定位失败|无法组成钢琴系统/);
  const chart = browserStaffRefusal(2, 0);
  assert.match(chart ?? "", /^这不像五线谱/);
  assert.doesNotMatch(chart ?? "", /简谱/);
});
