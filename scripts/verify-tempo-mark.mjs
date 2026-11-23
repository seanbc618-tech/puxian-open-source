import assert from "node:assert/strict";
import { encodeSharePayload } from "../src/lib/music/share-link.ts";

/**
 * r35 MuseScore-style mid-score tempo marks: set 途中速度 on a selected
 * mid-bar note, see ♩= on the jianpu, undo once, still 8 feature-bar items,
 * 390 fits. The panel is lazy-loaded with the 写谱 zone.
 */
export async function verifyTempoMark(port) {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const score = {
      title: "途中速度练习", bpm: 80, beats: 4, beatUnit: 4, key: "C", mode: "major", clef: "treble", tonicOctave: 4,
      notes: [60, 62, 64, 65].map((p) => ({ pitches: [p], dur: 1 })),
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
    await until((s) => s.title === "途中速度练习", "draft saved");
    const pick = page.locator(".jianpu-line, [data-jianpu], .staff-slot").first();
    await pick.waitFor();
    const setBtn = page.getByRole("button", { name: "设为从这里起", exact: true });
    await setBtn.waitFor();
    const degrees = page.locator("svg g[data-id] text").filter({ hasText: /^[1-7]$/ });
    // Prefer the second written degree so the mark sits mid-line, not in the header.
    const target = degrees.nth(1);
    await target.waitFor();
    await target.click({ force: true });
    for (let i = 0; i < 10 && await setBtn.isDisabled(); i += 1) {
      await degrees.nth(Math.min(i + 1, await degrees.count() - 1)).click({ force: true });
      await page.waitForTimeout(100);
    }
    const bpmBox = page.getByRole("spinbutton", { name: "途中速度" });
    await bpmBox.fill("60");
    await setBtn.click();
    const withMark = await until((s) => Array.isArray(s.changes) && s.changes.some((c) => c.bpm === 60), "途中速度 saved");
    assert.equal(withMark.bpm, 80, "opening tempo stays 80");
    assert.ok(withMark.changes[0].at > 0, `mark should be mid-score: ${JSON.stringify(withMark.changes)}`);
    await page.getByText("第 1 小节 ♩=60").first().waitFor();
    const drawn = await page.locator("[data-tempo-at]").count();
    const texts = await page.locator("[data-tempo-at]").evaluateAll((els) =>
      els.map((el) => ({ text: el.textContent, at: el.getAttribute("data-tempo-at") })),
    );
    assert.ok(
      drawn > 0 && texts.some((t) => /60/.test(t.text || "")),
      `jianpu tempo missing, drawn=${drawn} texts=${JSON.stringify(texts)}`,
    );
    await page.getByRole("button", { name: "撤销", exact: true }).click();
    await until((s) => !s.changes, "undo clears the mark");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "390: no sideways scroll");
    assert.deepEqual(errors, []);
    await page.close();
    console.log(JSON.stringify({ tempoMark: "passed", checks: ["8 tabs", "set mid-score ♩=60", "jianpu mark", "undo", "390 fits"] }));
  } finally {
    await browser.close();
  }
}
