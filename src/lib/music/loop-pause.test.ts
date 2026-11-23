import assert from "node:assert/strict";
import test from "node:test";
import { cleanLoopPause, cleanLoopTimes, fullPasses, loopClock, passStart } from "./loop-pause.ts";

test("不停顿不限遍：与原来的循环时钟一致", () => {
  assert.deepEqual(loopClock(0, 4, 0, 0), { done: 0, within: 0, rest: 0, finished: false });
  assert.deepEqual(loopClock(9, 4, 0, 0), { done: 2, within: 1, rest: 0, finished: false });
  assert.equal(passStart(1, 3, 4, 0), 13);
  assert.equal(fullPasses(0), Infinity);
});

test("每遍之间停顿：停顿里不走谱，倒数剩余秒数", () => {
  assert.deepEqual(loopClock(3.5, 4, 2, 0), { done: 0, within: 3.5, rest: 0, finished: false });
  assert.deepEqual(loopClock(4.5, 4, 2, 0), { done: 0, within: 4, rest: 1.5, finished: false });
  assert.deepEqual(loopClock(6.5, 4, 2, 0), { done: 1, within: 0.5, rest: 0, finished: false });
  assert.equal(passStart(0, 2, 4, 2), 12);
});

test("练够 N 遍就停，最后一遍后不再等停顿", () => {
  assert.equal(loopClock(15.9, 4, 2, 3).finished, false);
  assert.deepEqual(loopClock(16, 4, 2, 3), { done: 3, within: 4, rest: 0, finished: true });
  assert.equal(fullPasses(3), 3);
});

test("变速续播的半遍算作第一遍", () => {
  assert.equal(fullPasses(3, 1), 2);
  assert.equal(loopClock(9.9, 4, 2, 3, 1).finished, false);
  assert.equal(loopClock(10, 4, 2, 3, 1).finished, true);
});

test("存档里的值只认选项", () => {
  assert.equal(cleanLoopPause(2), 2);
  assert.equal(cleanLoopPause(3), 0);
  assert.equal(cleanLoopPause("2"), 0);
  assert.equal(cleanLoopTimes(5), 5);
  assert.equal(cleanLoopTimes(-1), 0);
});

test("循环状态文字：第几遍、停顿倒数、遍数上限", async () => {
  const { practiceLoopStatus, practiceChange } = await import("./practice-text.ts");
  const base = { playing: true, loopOn: true, loopRange: { from: 0, to: 4 }, label: "第 1–2 小节" };
  assert.equal(practiceLoopStatus({ ...base, now: { pass: 2, rest: 0 }, times: 5 }), "正在循环第 1–2 小节：第 2 / 5 遍，按停止结束。");
  assert.equal(practiceLoopStatus({ ...base, now: { pass: 2, rest: 2 }, times: 0 }), "第 2 遍练完，停 2 秒再来。");
  assert.equal(practiceLoopStatus({ ...base, playing: false, times: 3 }), "已设循环第 1–2 小节，播放时反复这一段，练 3 遍后停。");
  assert.equal(practiceLoopStatus(base), "正在循环第 1–2 小节，按停止结束。", "unchanged without the new fields");
  const key = { speed: 1, countInBars: 0, loopOn: true, from: 0, to: 4 };
  assert.equal(practiceChange(key, { ...key, loopPause: 2 }), "restart");
  assert.equal(practiceChange(key, { ...key, loopTimes: 0, loopPause: 0 }), "none");
});
