import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FOREGROUND_RELEASE_NOTICE, shouldReleaseForegroundAudio } from "./foreground-audio.ts";

describe("packaged shell foreground audio", () => {
  it("releases only when the packaged page is hidden", () => {
    assert.equal(shouldReleaseForegroundAudio("hidden", "capacitor:"), true);
    assert.equal(shouldReleaseForegroundAudio("visible", "capacitor:"), false);
    assert.equal(shouldReleaseForegroundAudio("hidden", "https:"), false);
    assert.equal(shouldReleaseForegroundAudio("hidden", "http:"), false);
    assert.equal(shouldReleaseForegroundAudio("hidden", "file:"), false);
  });

  it("tells the player to start again by hand", () => {
    assert.match(FOREGROUND_RELEASE_NOTICE, /再点一次/);
    assert.match(FOREGROUND_RELEASE_NOTICE, /不会自动接着录/);
  });
});
