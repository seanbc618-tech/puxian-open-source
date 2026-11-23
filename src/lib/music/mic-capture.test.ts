import assert from "node:assert/strict";
import test from "node:test";
import {
  MIC_CAPTURE_BUFFER,
  MIC_WORKLET_NAME,
  MIC_WORKLET_SOURCE,
  takeMicFrame,
} from "./mic-capture.ts";

test("mic frames copy a 4096-sample block and stop at the cap", () => {
  const frame = new Float32Array(MIC_CAPTURE_BUFFER);
  for (let i = 0; i < frame.length; i += 1) frame[i] = i;
  const first = takeMicFrame(frame, 0, MIC_CAPTURE_BUFFER * 2);
  assert.equal(first.done, false);
  assert.equal(first.collected, MIC_CAPTURE_BUFFER);
  assert.deepEqual(first.chunk, frame);
  assert.notEqual(first.chunk, frame);
  const second = takeMicFrame(frame, first.collected, MIC_CAPTURE_BUFFER * 2);
  assert.equal(second.done, true);
  assert.equal(second.collected, MIC_CAPTURE_BUFFER * 2);
  assert.equal(second.chunk?.length, MIC_CAPTURE_BUFFER);
  const after = takeMicFrame(frame, second.collected, MIC_CAPTURE_BUFFER * 2);
  assert.equal(after.done, true);
  assert.equal(after.chunk, null);
});

test("a short last frame is clipped to the remaining room", () => {
  const frame = new Float32Array([1, 2, 3, 4]);
  const result = takeMicFrame(frame, 5, 7);
  assert.deepEqual(Array.from(result.chunk ?? []), [1, 2]);
  assert.equal(result.collected, 7);
  assert.equal(result.done, true);
});

test("the worklet source registers under the capture name and copies the frame", () => {
  assert.match(MIC_WORKLET_SOURCE, new RegExp(`registerProcessor\\("${MIC_WORKLET_NAME}"`));
  assert.match(MIC_WORKLET_SOURCE, /input\.slice\(\)/);
  assert.doesNotMatch(MIC_WORKLET_SOURCE, /createScriptProcessor/);
});
