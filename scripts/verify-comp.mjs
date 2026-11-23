import assert from "node:assert/strict";
import { encodeSharePayload } from "../src/lib/music/share-link.ts";

/**
 * r28 iReal-style play-along: 播放时加伴奏 in 写谱 → 和弦标记.
 * Playback only; the written symbols and first-screen budget stay unchanged.
 */
export async function verifyComp(port) {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const score = {
      title: "和弦练习",
      bpm: 100,
      beats: 4,
      beatUnit: 4,
      key: "C",
      mode: "major",
      clef: "treble",
      tonicOctave: 4,
      notes: [{ pitches: [60], dur: 4 }, { pitches: [67], dur: 4 }],
      chordSymbols: [{ at: 0, symbol: "C" }, { at: 4, symbol: "G" }],
    };
    await page.goto(`http://127.0.0.1:${port}/#s=${encodeSharePayload(score)}`);
    await page.getByRole("button", { name: "在编辑器中打开副本", exact: true }).click();
    const bar = page.getByRole("tablist", { name: "编辑器功能栏" });
    await bar.waitFor();
    assert.equal(await bar.getByRole("tab").count(), 8, "still 8 feature-bar items");
    await page.getByRole("tab", { name: "辅助模块", exact: true }).click();
    const toggle = page.getByRole("button", { name: "播放时加伴奏", exact: true });
    await toggle.waitFor();
    assert.equal(await toggle.getAttribute("aria-pressed"), "false");
    assert.equal(await toggle.getAttribute("data-comp-on"), "0");
    const box = await toggle.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { w: r.width, h: r.height };
    });
    assert.ok(box.w >= 44 && box.h >= 44, `播放时加伴奏 must stay 44px, got ${box.w}x${box.h}`);

    await toggle.click();
    assert.equal(await toggle.getAttribute("aria-pressed"), "true");
    assert.equal(await toggle.getAttribute("data-comp-on"), "1");
    assert.equal(await page.evaluate(() => localStorage.getItem("puxian-comp-v1")), "1");
    assert.deepEqual(
      await page.evaluate(() => {
        const raw = JSON.parse(localStorage.getItem("puxian-score-v1") ?? "null");
        const score = raw?.notes ? raw : raw?.score;
        return {
          symbols: score?.chordSymbols ?? [],
          flag: score?.comp ?? score?.playAlong ?? null,
        };
      }),
      { symbols: [{ at: 0, symbol: "C" }, { at: 4, symbol: "G" }], flag: null },
      "comp must not rewrite the stored score",
    );

    await toggle.click();
    assert.equal(await toggle.getAttribute("aria-pressed"), "false");
    assert.equal(await page.evaluate(() => localStorage.getItem("puxian-comp-v1")), "0");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "390: no sideways scroll");
    assert.deepEqual(errors, []);
    await page.close();
    console.log(JSON.stringify({
      comp: "passed",
      checks: ["8 tabs", "default off", "persist on/off", "score unchanged", "390 44px"],
    }));
  } finally {
    await browser.close();
  }
}
