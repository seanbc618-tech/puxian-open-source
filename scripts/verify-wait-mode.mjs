import assert from "node:assert/strict";
import { encodeSharePayload } from "../src/lib/music/share-link.ts";

/** Deterministic device boundary; matching itself is exercised by node:test. */
export async function verifyWaitMode(port) {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() => {
      const input = new EventTarget();
      input.state = "connected";
      input.close = async () => {
        window.waitMidiClosed = (window.waitMidiClosed ?? 0) + 1;
      };
      const access = new EventTarget();
      access.inputs = new Map([["keyboard", input]]);
      window.sendWaitMidi = (midi, on = true, velocity = 100) => {
        const event = new Event("midimessage");
        Object.defineProperty(event, "data", {
          value: new Uint8Array([on ? 0x90 : 0x80, midi, velocity]),
        });
        input.dispatchEvent(event);
      };
      Object.defineProperty(navigator, "requestMIDIAccess", {
        configurable: true,
        value: async (options) => {
          window.waitMidiOptions = options;
          if (window.waitMidiPending)
            await new Promise((resolve) => {
              window.resolveWaitMidi = resolve;
            });
          return access;
        },
      });
      Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
        configurable: true,
        value: async () => {
          throw new DOMException("denied", "NotAllowedError");
        },
      });
    });
    const score = {
      title: "分手与等你弹验证",
      bpm: 120,
      beats: 4,
      beatUnit: 4,
      key: "C",
      mode: "major",
      clef: "treble",
      tonicOctave: 4,
      notes: [
        { pitches: [60, 64], dur: 4 },
        { pitches: [62], dur: 4 },
      ],
      voice2: [
        { pitches: [48], dur: 4 },
        { pitches: [50], dur: 4 },
      ],
    };
    const url = `http://127.0.0.1:${port}/#s=${encodeSharePayload(score)}`;
    await page.goto(url);
    await page.getByLabel("曲名", { exact: true }).waitFor();
    await page.getByRole("button", { name: "练习", exact: true }).click();
    await page.getByRole("button", { name: "只练右手", exact: true }).click();
    await page.getByLabel("另一手与伴奏", { exact: true }).selectOption("quiet");
    await page.getByLabel("等你弹输入", { exact: true }).selectOption("midi");
    await page.getByRole("button", { name: "开启等你弹", exact: true }).click();
    await page.getByText(/MIDI 已连接/).waitFor();
    assert.deepEqual(await page.evaluate(() => window.waitMidiOptions), { sysex: false });
    await page.waitForFunction(() =>
      document.querySelector('[data-midi="60"][data-active="true"]'),
    );
    assert.equal(
      await page.locator('[data-midi="48"][data-active="true"]').count(),
      0,
      "keyboard follows selected hand",
    );
    const marked = await page.locator(".staff .is-sounding").count();
    assert.ok(marked > 0, "current score note is highlighted");
    await page.waitForTimeout(500);
    assert.equal(
      await page.locator('[data-midi="60"][data-active="true"]').count(),
      1,
      "wait has no tempo clock",
    );
    await page.evaluate(() => window.sendWaitMidi(72));
    await page.waitForFunction(() =>
      document.querySelector('[data-midi="72"][data-played="true"]'),
    );
    assert.equal(await page.locator(".score-stage.wait-wrong").count(), 1);
    const wrongColor = await page
      .locator(".staff .is-sounding")
      .first()
      .evaluate((el) => getComputedStyle(el).fill);
    assert.equal(wrongColor, "rgb(183, 53, 41)", "wrong target flashes red");
    await page.evaluate(() => window.sendWaitMidi(60));
    assert.equal(
      await page.locator('[data-midi="60"][data-active="true"]').count(),
      1,
      "partial chord waits",
    );
    await page.evaluate(() => window.sendWaitMidi(64));
    await page.waitForFunction(() =>
      document.querySelector('[data-midi="62"][data-active="true"]'),
    );
    await page.evaluate(() => window.sendWaitMidi(62));
    await page
      .getByLabel("本次成绩", { exact: true })
      .getByText(/正确率 67% · 错 1 次/)
      .waitFor();
    await page.getByRole("button", { name: /第 1 小节 · 错 1 次 · 设为循环段/ }).click();
    assert.equal(
      await page
        .getByRole("button", { name: "循环播放", exact: true })
        .getAttribute("aria-pressed"),
      "true",
    );
    // Loop returns to the first target and remains active; transport can exit.
    await page.getByRole("button", { name: "开启等你弹", exact: true }).click();
    await page.getByText(/MIDI 已连接/).waitFor();
    await page.evaluate(() => {
      window.sendWaitMidi(60);
      window.sendWaitMidi(64);
    });
    await page.waitForFunction(() =>
      document.querySelector('[data-midi="60"][data-active="true"]'),
    );
    assert.equal(await page.getByRole("button", { name: "退出等你弹", exact: true }).count(), 1);
    await page.locator(".transport").getByRole("button", { name: "停止", exact: true }).click();
    assert.ok(
      await page.evaluate(() => window.waitMidiClosed >= 2),
      "devices closed on finish/exit",
    );
    await page.getByLabel("等你弹输入", { exact: true }).selectOption("mic");
    await page.getByRole("button", { name: "开启等你弹", exact: true }).click();
    await page.getByText(/未获得输入权限/).waitFor();
    assert.equal(await page.getByRole("button", { name: "开启等你弹", exact: true }).count(), 1);
    // Exit while a browser permission prompt is pending; late access must release devices.
    await page.getByLabel("等你弹输入", { exact: true }).selectOption("midi");
    await page.evaluate(() => {
      window.waitMidiPending = true;
    });
    await page.getByRole("button", { name: "开启等你弹", exact: true }).click();
    await page.waitForFunction(() => typeof window.resolveWaitMidi === "function");
    await page.getByRole("button", { name: "退出等你弹", exact: true }).click();
    const closed = await page.evaluate(() => window.waitMidiClosed);
    await page.evaluate(() => window.resolveWaitMidi());
    await page.waitForFunction((n) => window.waitMidiClosed > n, closed);
    assert.equal(
      await page.locator(".transport").getByRole("button", { name: "播放", exact: true }).count(),
      1,
    );
    assert.deepEqual(errors, [], "wait UI causes no uncaught errors");
    // Unsupported Web MIDI is explained and the option is absent.
    await page.evaluate(() =>
      Object.defineProperty(navigator, "requestMIDIAccess", {
        value: undefined,
        configurable: true,
      }),
    );
    await page.getByRole("button", { name: "练习", exact: true }).click();
    await page.getByRole("button", { name: "练习", exact: true }).click();
    await page.getByText(/此浏览器不支持 Web MIDI/).waitFor();
    assert.equal(
      await page.getByLabel("等你弹输入", { exact: true }).locator('option[value="midi"]').count(),
      0,
    );
    console.log(
      JSON.stringify({
        waitMode: "passed",
        checks: [
          "selected hand",
          "exact octave",
          "held chord",
          "frozen score",
          "wrong feedback",
          "results",
          "bar loop",
          "permission denial",
          "pending cancellation",
          "unsupported MIDI",
        ],
      }),
    );
  } finally {
    await browser.close();
  }
}
