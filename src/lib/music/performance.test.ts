import test from "node:test";
import assert from "node:assert/strict";
import { pageTurn, performanceSeconds, autoScrollSpeed } from "./performance.ts";

test("翻页按视口留 15% 重叠，390 窄屏与横屏，边界与末页后再翻", () => {
  for (const height of [600, 260]) {
    assert.deepEqual(pageTurn(0, height, 2000, 1), { top: height * 0.85, atEnd: false });
    assert.equal(pageTurn(height * 0.85, height, 2000, -1).top, 0);
  }
  assert.deepEqual(pageTurn(900, 600, 1000, 1), { top: 1000, atEnd: false });
  assert.deepEqual(pageTurn(1000, 600, 1000, 1), { top: 1000, atEnd: true });
  assert.deepEqual(pageTurn(0, 600, 0, 1), { top: 0, atEnd: true });
  assert.equal(pageTurn(0, 600, 1000, -1).top, 0);
  assert.equal(pageTurn(NaN, 600, NaN, 1).top, 0);
});
test("自动滚屏以四分拍计时，整合曲中速度变化，速度限制 50–150%", () => {
  assert.equal(performanceSeconds(120, 120), 60);
  assert.equal(performanceSeconds(120, 120, [{ at: 60, bpm: 60 }]), 90);
  assert.equal(
    performanceSeconds(120, 120, [{ at: 80 }, { at: -2, bpm: 1 }, { at: 60, bpm: 0 }]),
    60,
  );
  assert.equal(autoScrollSpeed(600, 60), 10);
  assert.equal(autoScrollSpeed(600, 60, 10), 5);
  assert.equal(autoScrollSpeed(600, 60, 200), 15);
  assert.equal(autoScrollSpeed(600, 60, NaN), 10);
  assert.equal(autoScrollSpeed(0, 60), 0);
  assert.equal(autoScrollSpeed(600, 0), 0);
  assert.equal(performanceSeconds(0, 120), 0);
  assert.equal(performanceSeconds(10, Infinity), 0);
});

test("pageTurn：和弦指南盖住的顶部不算一屏，翻页后不漏行", () => {
  assert.equal(pageTurn(0, 600, 2000, 1, 100).top, 425);
  assert.equal(pageTurn(425, 600, 2000, -1, 100).top, 0);
  assert.equal(pageTurn(0, 600, 2000, 1, Number.NaN).top, 510, "bad cover counts as none");
  assert.equal(pageTurn(0, 600, 2000, 1, 900).top, 0, "a cover taller than the stage does not move the page");
});
