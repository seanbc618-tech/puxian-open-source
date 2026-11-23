import test from "node:test";
import assert from "node:assert/strict";
import { retryImport } from "./lazy-retry.ts";

test("retryImport：失败一次后重新加载成功", async () => {
  let calls = 0;
  const value = await retryImport(async () => {
    calls += 1;
    if (calls === 1) throw new Error("chunk dropped");
    return 42;
  }, 2, 1);
  assert.equal(value, 42);
  assert.equal(calls, 2);
});

test("retryImport：重试用完后把原来的错误交给错误边界", async () => {
  let calls = 0;
  await assert.rejects(
    retryImport(async () => {
      calls += 1;
      throw new Error(`fail ${calls}`);
    }, 2, 1),
    /fail 3/,
  );
  assert.equal(calls, 3);
});

test("retryImport：第一次就成功时不再加载", async () => {
  let calls = 0;
  assert.equal(await retryImport(async () => ++calls, 2, 1), 1);
  assert.equal(calls, 1);
});
