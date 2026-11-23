import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hapticEnabled, setHapticEnabled } from "./tap-feedback.ts";

describe("tap-feedback", () => {
  it("honours an explicit on/off preference over the device default", () => {
    const store = new Map<string, string>();
    const memory = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => { store.set(key, value); },
    };
    setHapticEnabled(false, memory);
    assert.equal(hapticEnabled(memory), false);
    setHapticEnabled(true, memory);
    assert.equal(hapticEnabled(memory), true);
  });

  it("defaults to off when the user has not chosen and the device is not a touch surface", () => {
    const empty = { getItem: () => null };
    const previous = navigator.maxTouchPoints;
    Object.defineProperty(navigator, "maxTouchPoints", { configurable: true, value: 0 });
    try {
      assert.equal(hapticEnabled(empty), false);
    } finally {
      Object.defineProperty(navigator, "maxTouchPoints", { configurable: true, value: previous });
    }
  });
});
