import assert from "node:assert/strict";
import { encodeSharePayload } from "../src/lib/music/share-link.ts";

/**
 * r38 MuseScore-style gradual tempo: set 渐慢 rit. on a mid-line note,
 * see the mark and dashed line on the jianpu, undo once, still 8
 * feature-bar items, 390 fits. The panel is lazy-loaded with 写谱.
 */
export async function verifyGradualTempo(port) {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const score = {
      title: "渐慢练习", bpm: 80, beats: 4, beatUnit: 4, key: "C", mode: "major", clef: "treble", tonicOctave: 4,
      notes: [60, 62, 64, 65, 67, 69, 71, 72].map((p) => ({ pitches: [p], dur: 1 })),
    };
    await page.goto(`http://127.0.0.1:${port}/#s=${encodeSharePayload(score)}`);
    await page.getByRole("button", { name: "在编辑器中打开副本", exact: true }).click();
    const bar = page.getByRole("tablist", { name: "编辑器功能栏" });
    await bar.waitFor();
    assert.equal(await bar.getByRole("tab").count(), 8, "still 8 feature-bar items");
    await page.getByRole("tab", { name: "写谱", exact: true }).click();
    const stored = () => page.evaluate(() => {
      const raw = JSON.parse(localStorage.getItem("puxian-score-v1") ?? "null");
      return raw?.notes ? raw : raw?.score;
    });
    const until = async (check, label) => {
      for (let i = 0; i < 60; i += 1) {
        const s = await stored();
        if (s && check(s)) return s;
        await page.waitForTimeout(100);
      }
      assert.fail(`${label}: ${JSON.stringify(await stored())}`);
    };
    await until((s) => s.title === "渐慢练习", "draft saved");
    const pick = page.locator(".jianpu-line, [data-jianpu], .staff-slot").first();
    await pick.waitFor();
    const setBtn = page.getByRole("button", { name: "渐慢 rit.", exact: true });
    await setBtn.waitFor();
    const degrees = page.locator("svg g[data-id] text").filter({ hasText: /^[1-7]$/ });
    const target = degrees.nth(1);
    await target.waitFor();
    await target.click({ force: true });
    for (let i = 0; i < 10 && await setBtn.isDisabled(); i += 1) {
      await degrees.nth(Math.min(i + 1, await degrees.count() - 1)).click({ force: true });
      await page.waitForTimeout(100);
    }
    const heightBefore = await page.locator(".jianpu-line, [data-jianpu]").first().evaluate((el) => {
      const host = el.closest("[data-jianpu]") ?? el;
      return parseFloat(getComputedStyle(host).height) || host.getBoundingClientRect().height;
    });
    await setBtn.click();
    const withMark = await until(
      (s) => Array.isArray(s.gradualTempos) && s.gradualTempos.some((c) => c.kind === "rit" && c.to > c.from),
      "渐慢 saved",
    );
    assert.equal(withMark.bpm, 80, "opening tempo stays 80");
    assert.ok(!withMark.changes, "draft does not rewrite Score.changes");
    await page.locator("[data-gradual-from][data-gradual-kind=\"rit\"]").first().waitFor({ state: "attached" });
    const drawn = await page.locator("[data-gradual-from]").count();
    const texts = await page.locator("[data-gradual-from]").evaluateAll((els) =>
      els.map((el) => ({ text: el.textContent, kind: el.getAttribute("data-gradual-kind"), tag: el.tagName })),
    );
    assert.ok(
      drawn > 0 && texts.some((t) => t.tag === "text" && /渐慢/.test(t.text || "") && t.kind === "rit"),
      `jianpu gradual missing, drawn=${drawn} texts=${JSON.stringify(texts)}`,
    );
    assert.ok(
      await page.locator("[data-gradual-line]").count() > 0,
      "dashed extension missing",
    );
    const heightAfter = await page.locator(".jianpu-line, [data-jianpu]").first().evaluate((el) => {
      const host = el.closest("[data-jianpu]") ?? el;
      return parseFloat(getComputedStyle(host).height) || host.getBoundingClientRect().height;
    });
    assert.ok(heightAfter <= heightBefore + 1, `host grew ${heightBefore} -> ${heightAfter}`);
    await page.getByRole("button", { name: "撤销", exact: true }).click();
    await until((s) => !s.gradualTempos, "undo clears the mark");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "390: no sideways scroll");
    assert.deepEqual(errors, []);
    await page.close();
    console.log(JSON.stringify({ gradualTempo: "passed", checks: ["8 tabs", "set rit.", "jianpu mark+dash", "host height", "undo", "390 fits"] }));
  } finally {
    await browser.close();
  }
}
