import assert from "node:assert/strict";
import { encodeSharePayload } from "../src/lib/music/share-link.ts";

/**
 * Tuner on a synthetic microphone (a local oscillator), the standalone metronome's
 * Web Audio clicks, and mixer moves reaching notes that are already playing.
 */
export async function verifyPracticeTools(port) {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({
    headless: true,
    args: ["--autoplay-policy=no-user-gesture-required"],
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript(() => {
      window.toolTrace = { stops: 0, osc: [], trims: [] };
      Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
        configurable: true,
        value: async () => {
          const ctx = new AudioContext();
          await ctx.resume();
          const osc = ctx.createOscillator();
          osc.frequency.value = window.fakeMicHz ?? 110 * 2 ** (-30 / 1200);
          const out = ctx.createMediaStreamDestination();
          osc.connect(out);
          osc.start();
          const stream = out.stream;
          for (const track of stream.getTracks()) {
            const stop = track.stop.bind(track);
            track.stop = () => {
              window.toolTrace.stops += 1;
              stop();
              void ctx.close();
            };
          }
          return stream;
        },
      });
      const proto = AudioContext.prototype;
      const osc = proto.createOscillator;
      proto.createOscillator = function () {
        const node = osc.call(this);
        const set = node.frequency.setValueAtTime.bind(node.frequency);
        node.frequency.setValueAtTime = (value, when) => {
          window.toolTrace.osc.push(value);
          return set(value, when);
        };
        return node;
      };
      const gain = proto.createGain;
      proto.createGain = function () {
        const node = gain.call(this);
        const target = node.gain.setTargetAtTime.bind(node.gain);
        node.gain.setTargetAtTime = (value, when, k) => {
          window.toolTrace.trims.push(value);
          return target(value, when, k);
        };
        return node;
      };
    });
    const score = {
      title: "调音与节拍器检查",
      bpm: 90,
      beats: 3,
      beatUnit: 4,
      key: "C",
      mode: "major",
      clef: "treble",
      tonicOctave: 4,
      notes: Array.from({ length: 12 }, () => ({ pitches: [69], dur: 8 })),
      voice2: Array.from({ length: 12 }, () => ({ pitches: [45], dur: 8 })),
    };
    await page.goto(`http://127.0.0.1:${port}/#s=${encodeSharePayload(score)}`);
    await page.getByLabel("曲名", { exact: true }).waitFor();
    await page.getByRole("button", { name: "在编辑器中打开副本", exact: true }).click();
    const bar = page.getByRole("tablist", { name: "编辑器功能栏" });
    await bar.waitFor();
    assert.equal(await bar.getByRole("tab").count(), 8, "still 8 feature-bar items");

    // Tuner: nothing is fetched or asked for until it is opened.
    await bar.getByRole("tab", { name: /听写与音频/ }).click();
    assert.equal(await page.locator("[data-tuner]").count(), 0);
    await page.getByRole("button", { name: "调音器", exact: true }).click();
    const tuner = page.locator("[data-tuner]");
    await tuner.waitFor();
    await page.getByLabel("调音乐器", { exact: true }).selectOption("guitar");
    await tuner.getByRole("button", { name: "开始调音", exact: true }).click();
    // A2 thirty cents flat → nearest guitar string A2 (5th), tune up.
    await page.waitForFunction(() => document.querySelector("[data-tuner-note]")?.textContent === "A2", null, { timeout: 15000 });
    await page.waitForFunction(() => /第 5 弦 A2：调高/.test(document.querySelector("[data-tuner-string]")?.textContent ?? ""));
    // The first frames after the stream starts can straddle silence; the needle settles near -30.
    await page.waitForFunction(() => {
      const value = Number(document.querySelector('[data-tuner] [role="meter"]')?.getAttribute("aria-valuenow"));
      return value <= -25 && value >= -35;
    }, null, { timeout: 10000 }).catch(async (error) => {
      throw new Error(`needle near -30 cents, got ${await tuner.getByRole("meter").getAttribute("aria-valuenow")}`, { cause: error });
    });
    assert.match(await tuner.innerText(), /简谱 6/);
    await tuner.getByRole("button", { name: "停止调音", exact: true }).click();
    await page.waitForFunction(() => window.toolTrace.stops >= 1);
    // In tune within ±5 cents goes green; collapsing releases the microphone.
    await page.evaluate(() => { window.fakeMicHz = 196; });
    await page.getByLabel("调音乐器", { exact: true }).selectOption("violin");
    await tuner.getByRole("button", { name: "开始调音", exact: true }).click();
    await page.waitForFunction(() => /G3：已准/.test(document.querySelector("[data-tuner-string]")?.textContent ?? ""), null, { timeout: 15000 });
    assert.equal(await page.locator("[data-tuner-note]").evaluate((el) => getComputedStyle(el).color), "rgb(47, 125, 79)");
    await tuner.getByRole("button", { name: "收起调音器", exact: true }).click();
    await page.waitForFunction(() => window.toolTrace.stops >= 2);
    assert.equal(await page.locator("[data-tuner]").count(), 0);

    // Standalone metronome.
    await page.getByRole("button", { name: "练习", exact: true }).click();
    await page.getByRole("button", { name: /独立节拍器/ }).click();
    const metro = page.locator("[data-standalone-metronome]");
    await metro.waitFor();
    assert.equal(await metro.getByRole("button", { name: /^第 \d 拍/ }).count(), 3, "meter follows the score");
    assert.equal(await page.getByLabel("独立节拍器速度", { exact: true }).inputValue(), "90");
    for (let i = 0; i < 5; i++) {
      await metro.getByRole("button", { name: "点按测速", exact: true }).click();
      await page.waitForTimeout(300);
    }
    const tapped = Number(await page.getByLabel("独立节拍器速度", { exact: true }).inputValue());
    assert.ok(tapped >= 150 && tapped <= 240, `tap tempo ≈ 200, got ${tapped}`);
    await page.getByLabel("独立节拍器速度", { exact: true }).fill("240");
    await metro.getByRole("button", { name: "第 2 拍：普通", exact: true }).click();
    await metro.getByRole("button", { name: "第 2 拍：静音", exact: true }).waitFor();
    await page.evaluate(() => { window.toolTrace.osc = []; });
    await metro.getByRole("button", { name: "开始节拍器", exact: true }).click();
    await page.waitForFunction(() => document.querySelector('[data-standalone-metronome] [aria-current="true"]'));
    await page.waitForTimeout(900);
    const clicks = await page.evaluate(() => window.toolTrace.osc);
    // 240 BPM, 3/4 with beat 2 muted: strong(1760) and normal(1174.66) only, 2 per bar.
    assert.ok(clicks.includes(1760) && clicks.includes(1174.66), JSON.stringify(clicks));
    const strong = clicks.filter((v) => v === 1760).length;
    const normal = clicks.filter((v) => v === 1174.66).length;
    assert.ok(Math.abs(strong - normal) <= 1, `one strong per normal, ${strong}/${normal}`);
    // r17 (Pro Metronome-style trainers): silent bars keep the light moving without sound,
    // and the speed-up raises the tempo bar by bar.
    await metro.getByRole("button", { name: "停止节拍器", exact: true }).click();
    await metro.getByRole("button", { name: "第 2 拍：静音", exact: true }).click();
    await metro.getByRole("button", { name: "第 2 拍：重", exact: true }).click();
    await metro.getByRole("button", { name: "第 2 拍：普通", exact: true }).waitFor();
    await page.getByLabel("独立节拍器拍数", { exact: true }).selectOption("1");
    await page.getByLabel("静音小节（练内心节拍）", { exact: true }).selectOption("1-1");
    await page.evaluate(() => {
      window.metroStarts = [];
      const proto = window.AudioContext.prototype;
      const make = proto.createOscillator;
      proto.createOscillator = function () {
        const node = make.call(this);
        const start = node.start.bind(node);
        node.start = (when) => { window.metroStarts.push(when); return start(when); };
        return node;
      };
    });
    await metro.getByRole("button", { name: "开始节拍器", exact: true }).click();
    const nowLine = metro.locator("[data-metro-now]");
    await nowLine.filter({ hasText: "静音中，心里继续数" }).waitFor();
    await page.waitForTimeout(1200);
    await metro.getByRole("button", { name: "停止节拍器", exact: true }).click();
    // 240 BPM, one beat a bar = 0.25 s bars; every other bar is silent, so starts are 0.5 s apart.
    const starts = await page.evaluate(() => window.metroStarts.slice());
    assert.ok(starts.length >= 3, JSON.stringify(starts));
    const gaps = starts.slice(1).map((t, i) => +(t - starts[i]).toFixed(3));
    assert.ok(gaps.every((g) => Math.abs(g - 0.5) < 0.01), `silent bars skipped: ${gaps}`);
    await page.getByLabel("静音小节（练内心节拍）", { exact: true }).selectOption("off");
    await page.getByLabel("独立节拍器速度", { exact: true }).fill("200");
    await page.getByLabel("自动加速", { exact: true }).selectOption("2/2");
    await page.getByLabel("自动加速目标速度", { exact: true }).selectOption("210");
    await page.evaluate(() => { window.metroStarts = []; });
    await metro.getByRole("button", { name: "开始节拍器", exact: true }).click();
    await nowLine.filter({ hasText: "♩=202" }).waitFor();
    await nowLine.filter({ hasText: "♩=210 · 已到目标速度" }).waitFor({ timeout: 8000 });
    await page.waitForTimeout(700);
    await metro.getByRole("button", { name: "停止节拍器", exact: true }).click();
    const ramped = await page.evaluate(() => window.metroStarts.slice());
    const steps = ramped.slice(1).map((t, i) => t - ramped[i]);
    assert.ok(Math.abs(steps[0] - 60 / 200) < 0.002 && Math.abs(steps.at(-1) - 60 / 210) < 0.002, `tempo rises 200 → 210: ${steps.slice(0, 3)} … ${steps.slice(-2)}`);
    assert.equal(await metro.evaluate((el) => el.scrollWidth <= el.clientWidth), true, "trainer row fits");
    await page.getByLabel("自动加速", { exact: true }).selectOption("off");
    await page.getByLabel("独立节拍器拍数", { exact: true }).selectOption("3");
    await metro.getByRole("button", { name: "开始节拍器", exact: true }).click();
    // Starting score playback stops the standalone metronome.
    const transport = page.locator(".transport");
    await transport.getByRole("button", { name: "播放", exact: true }).click();
    await metro.getByRole("button", { name: "开始节拍器", exact: true }).waitFor();

    // Live mixer: a volume move and a mute reach the notes already scheduled.
    await page.evaluate(() => { window.toolTrace.trims = []; });
    await page.getByLabel("声部一音量", { exact: true }).fill("50");
    await page.waitForFunction(() => window.toolTrace.trims.some((v) => Math.abs(v - 0.5 / 0.8) < 1e-6 || Math.abs(v - 0.5) < 1e-6));
    await page.getByRole("button", { name: "声部二静音 M", exact: true }).click();
    await page.waitForFunction(() => window.toolTrace.trims.includes(0));
    await transport.getByRole("button", { name: "停止", exact: true }).click();
    await page.getByRole("button", { name: "声部二静音 M", exact: true }).click();
    await metro.getByRole("button", { name: "收起节拍器", exact: true }).click();
    assert.equal(await metro.count(), 0);

    await page.setViewportSize({ width: 320, height: 700 });
    await page.getByRole("button", { name: /独立节拍器/ }).click();
    await metro.waitFor();
    assert.equal(await metro.evaluate((el) => el.scrollWidth <= el.clientWidth), true, "metronome fits 320px");
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ practiceTools: "passed", checks: ["tuner string + cents + jianpu", "in-tune green", "mic released", "tap tempo", "accents/mute", "silent bars", "speed-up to target", "stops on playback", "live mixer volume/mute", "320px"] }));
  } finally {
    await browser.close();
  }
}
