import { mkdirSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";
import { encodeSharePayload } from "../src/lib/music/share-link.ts";

/** Verify the real browser audio boundary as well as the persisted Chinese controls. */
export async function verifyMixer(port) {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript(() => {
      window.mixerAudio = [];
      const access = new EventTarget();
      access.inputs = new Map();
      Object.defineProperty(navigator, "requestMIDIAccess", {
        configurable: true,
        value: async () => access,
      });
      const proto = AudioContext.prototype;
      for (const [method, param] of [
        ["createOscillator", "frequency"],
        ["createStereoPanner", "pan"],
        ["createBiquadFilter", "frequency"],
      ]) {
        const original = proto[method];
        proto[method] = function (...args) {
          const node = original.apply(this, args);
          const set = node[param].setValueAtTime.bind(node[param]);
          node[param].setValueAtTime = (value, when) => {
            window.mixerAudio.push({ method, value });
            return set(value, when);
          };
          return node;
        };
      }
      const originalGain = proto.createGain;
      proto.createGain = function () {
        const node = originalGain.call(this);
        const ramp = node.gain.exponentialRampToValueAtTime.bind(node.gain);
        node.gain.exponentialRampToValueAtTime = (value, when) => {
          window.mixerAudio.push({ method: "gainRamp", value });
          return ramp(value, when);
        };
        return node;
      };
    });
    const score = {
      title: "混音浏览器检查",
      bpm: 120,
      beats: 4,
      beatUnit: 4,
      key: "C",
      mode: "major",
      clef: "treble",
      tonicOctave: 4,
      notes: [{ pitches: [60], dur: 8 }],
      voice2: [{ pitches: [48], dur: 8 }],
    };
    await page.goto(`http://127.0.0.1:${port}/#s=${encodeSharePayload(score)}`);
    await page.getByLabel("曲名", { exact: true }).waitFor();
    await page.getByRole("button", { name: "在编辑器中打开副本", exact: true }).click();
    await page.getByRole("tablist", { name: "编辑器功能栏" }).waitFor();
    assert.equal(
      await page.getByRole("tablist", { name: "编辑器功能栏" }).getByRole("tab").count(),
      8,
    );
    await page.getByRole("button", { name: "练习", exact: true }).click();
    await page.getByLabel("声部一音色", { exact: true }).selectOption("flute");
    await page.getByLabel("声部二音色", { exact: true }).selectOption("bass");
    const range = async (label, value) => {
      await page.getByLabel(label, { exact: true }).fill(String(value));
    };
    await range("声部一音量", 50);
    await range("声部一左右声像", -80);
    await range("声部二左右声像", 100);
    const transport = page.locator(".transport");
    async function play() {
      await page.evaluate(() => {
        window.mixerAudio = [];
      });
      await transport.getByRole("button", { name: "播放", exact: true }).click();
      await page.waitForFunction(() =>
        window.mixerAudio.some((e) => e.method === "createOscillator"),
      );
      const trace = await page.evaluate(() => window.mixerAudio);
      await transport.getByRole("button", { name: "停止", exact: true }).click();
      return trace;
    }
    const values = (trace, method) => trace.filter((e) => e.method === method).map((e) => e.value);
    let trace = await play();
    assert.deepEqual(values(trace, "createStereoPanner"), [-0.8, 1]);
    assert.deepEqual(values(trace, "createBiquadFilter"), [6500, 1800]);
    assert.ok(
      values(trace, "gainRamp").some((v) => Math.abs(v - 0.78 * 0.5) < 1e-9),
      "volume multiplies flute fundamental",
    );
    await page.getByRole("button", { name: "声部二独奏 S", exact: true }).click();
    trace = await play();
    assert.deepEqual(values(trace, "createBiquadFilter"), [1800], "solo excludes first voice");
    await page.getByRole("button", { name: "声部一独奏 S", exact: true }).click();
    await page.getByRole("button", { name: "声部二静音 M", exact: true }).click();
    trace = await play();
    assert.deepEqual(values(trace, "createBiquadFilter"), [6500], "mute wins even when soloed");
    await page.getByRole("button", { name: "声部二独奏 S", exact: true }).click();
    await page.getByRole("button", { name: "声部一独奏 S", exact: true }).click();
    await page.getByRole("button", { name: "声部二静音 M", exact: true }).click();
    await page.getByRole("button", { name: "只练右手", exact: true }).click();
    await page.getByLabel("另一手与伴奏", { exact: true }).selectOption("quiet");
    trace = await play();
    assert.ok(
      values(trace, "gainRamp").some((v) => Math.abs(v - 0.75 * 0.3) < 1e-9),
      "quiet hand scales before mixer",
    );
    // Exercise the practice (speed/loop/training) scheduler, not just whole-score playback.
    // r16: 渐进加速 is folded until opened.
    if (!(await page.locator("[data-speed-training]").evaluate((d) => d.open))) await page.locator("[data-speed-training] > summary").click();
    await page.getByRole("button", { name: "开启渐进加速", exact: true }).click();
    trace = await play();
    assert.deepEqual(values(trace, "createBiquadFilter").slice(0, 2), [6500, 1800]);
    await page.getByRole("button", { name: "取消渐进加速", exact: true }).click();
    await page.getByLabel("等你弹输入", { exact: true }).selectOption("midi");
    await page.getByRole("button", { name: "开启等你弹", exact: true }).click();
    await page.getByRole("button", { name: "听当前音", exact: true }).waitFor();
    await page.evaluate(() => {
      window.mixerAudio = [];
    });
    await page.getByRole("button", { name: "听当前音", exact: true }).click();
    trace = await page.evaluate(() => window.mixerAudio);
    assert.deepEqual(
      values(trace, "createBiquadFilter"),
      [6500],
      "wait hint uses selected hand and the same timbre",
    );
    assert.ok(values(trace, "gainRamp").some((v) => Math.abs(v - 0.78 * 0.5) < 1e-9));
    await page.getByRole("button", { name: "退出等你弹", exact: true }).click();
    // Panner capability is optional; synthesis must still work.
    await page.evaluate(() => {
      AudioContext.prototype.createStereoPanner = undefined;
    });
    trace = await play();
    assert.deepEqual(values(trace, "createStereoPanner"), []);
    assert.equal(values(trace, "createBiquadFilter").length, 2);
    await page.waitForFunction(() =>
      Object.values(JSON.parse(localStorage.getItem("puxian-mixer-v1") ?? "{}")).some(
        (e) => e.channels?.[0]?.volume === 50,
      ),
    );
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("puxian-mixer-v1")));
    assert.ok(
      Object.values(stored).some(
        (e) => e.channels[0].timbre === "flute" && e.channels[1].timbre === "bass",
      ),
    );
    assert.equal(
      await page.evaluate(() => localStorage.getItem("puxian-score-v1").includes('"timbre"')),
      false,
      "score has no playback preferences",
    );
    await page.goto(`http://127.0.0.1:${port}/`);
    await page.getByRole("button", { name: "继续上次草稿", exact: true }).click();
    await page.getByRole("button", { name: "练习", exact: true }).click();
    await page.getByLabel("声部一音色", { exact: true }).waitFor();
    assert.equal(await page.getByLabel("声部一音色", { exact: true }).inputValue(), "flute");
    assert.equal(await page.getByLabel("声部二音色", { exact: true }).inputValue(), "bass");
    assert.equal(await page.getByLabel("声部一音量", { exact: true }).inputValue(), "50");
    if (process.env.PUXIAN_MIXER_SHOTS) {
      mkdirSync(process.env.PUXIAN_MIXER_SHOTS, { recursive: true });
      await page
        .locator("[data-mixer]")
        .screenshot({ path: join(process.env.PUXIAN_MIXER_SHOTS, "mixer-desktop.png") });
    }
    await page.setViewportSize({ width: 320, height: 700 });
    assert.equal(
      await page.locator("[data-mixer]").evaluate((el) => el.scrollWidth <= el.clientWidth),
      true,
      "mixer fits narrow screens",
    );
    if (process.env.PUXIAN_MIXER_SHOTS)
      await page
        .locator("[data-mixer]")
        .screenshot({ path: join(process.env.PUXIAN_MIXER_SHOTS, "mixer-mobile.png") });
    await page.getByRole("button", { name: "去掉第二声部", exact: true }).click();
    await page.waitForFunction(
      () => document.querySelectorAll("[data-mixer] fieldset").length === 1,
    );
    await page.getByRole("button", { name: "加上第二声部", exact: true }).click();
    await page.getByLabel("声部二音色", { exact: true }).waitFor();
    assert.equal(
      await page.getByLabel("声部二音色", { exact: true }).inputValue(),
      "piano",
      "new voice starts with default, deleted settings stay discarded",
    );
    assert.equal(await page.getByLabel("声部一音色", { exact: true }).inputValue(), "flute");
    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify({
        mixer: "passed",
        checks: [
          "8 toolbar items",
          "six timbres",
          "gain/pan nodes",
          "mute/solo",
          "hand layering",
          "training synthesis",
          "wait hint synthesis",
          "voice removal/alignment",
          "no panner fallback",
          "per-song persistence",
          "score isolation",
          "320px layout",
        ],
      }),
    );
  } finally {
    await browser.close();
  }
}
