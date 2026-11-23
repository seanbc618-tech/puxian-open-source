import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  microphoneError,
  microphoneHelp,
  recordingMeter,
  RECORD_SECONDS,
  isMicrophoneStatusError,
} from "./record-session.ts";

describe("microphoneHelp", () => {
  it("describes iOS Safari, iOS Chrome, desktop Chrome, and other desktop browsers", () => {
    assert.match(
      microphoneHelp("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"),
      /设置 → Safari → 麦克风/,
    );
    assert.match(
      microphoneHelp("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0.0.0 Mobile/15E148 Safari/604.1"),
      /设置里打开该浏览器的麦克风/,
    );
    assert.match(
      microphoneHelp("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36"),
      /地址栏左侧图标/,
    );
    assert.match(
      microphoneHelp("Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0"),
      /地址栏站点权限/,
    );
  });
});

describe("microphoneError", () => {
  const chrome = "Mozilla/5.0 Chrome/129.0.0.0 Safari/537.36";
  it("distinguishes denial, missing device, insecure context, and unknown failures", () => {
    const denied = microphoneError({ name: "NotAllowedError" }, chrome);
    assert.match(denied, /麦克风权限未获允许/);
    assert.match(denied, /地址栏左侧图标/);
    assert.match(denied, /上传音乐/);

    assert.match(microphoneError({ name: "NotFoundError" }, chrome), /没有找到麦克风/);
    assert.match(microphoneError({ name: "NotReadableError" }, chrome), /被占用/);
    assert.match(microphoneError({ name: "UnsupportedError" }, chrome, true), /未提供麦克风接口/);
    assert.match(microphoneError({ name: "InsecureContextError" }, chrome, true), /安全上下文/);
    assert.match(microphoneError({ name: "NotAllowedError" }, chrome, false), /安全上下文/);
    assert.match(microphoneError({ name: "AnythingElse" }, chrome), /录音未能启动/);
  });
});

describe("recordingMeter", () => {
  it("maps RMS to a 0–1 level and clamps elapsed time to the 20 second cap", () => {
    const silent = recordingMeter(new Float32Array(128), 0, 1000);
    assert.equal(silent.elapsed, 0);
    assert.equal(silent.remaining, RECORD_SECONDS);
    assert.ok(silent.level < 0.05);

    const loud = new Float32Array(128).fill(1);
    const peak = recordingMeter(loud, 10_000, 1000);
    assert.equal(peak.elapsed, 10);
    assert.equal(peak.remaining, 10);
    assert.ok(peak.level > 0.99);

    const capped = recordingMeter(new Float32Array(8), 40_000, 1000);
    assert.equal(capped.elapsed, RECORD_SECONDS);
    assert.equal(capped.remaining, 0);

    const empty = recordingMeter(new Float32Array(0), 500, 1000);
    assert.equal(empty.elapsed, 0.5);
    assert.ok(Number.isFinite(empty.level));
  });
});

describe("isMicrophoneStatusError", () => {
  it("keeps mic guidance in the dictation panel instead of the floating toast", () => {
    assert.equal(isMicrophoneStatusError("麦克风权限未获允许，或被页面的权限策略限制。"), true);
    assert.equal(isMicrophoneStatusError("哼得太短了。慢一点，至少半秒。"), true);
    assert.equal(isMicrophoneStatusError("这不是 MIDI 文件"), false);
  });
});
