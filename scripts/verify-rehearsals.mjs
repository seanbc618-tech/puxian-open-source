import assert from "node:assert/strict";
import { encodeSharePayload } from "../src/lib/music/share-link.ts";

/**
 * r21 TT作曲家-style section labels: set 前奏 / 副歌 on selected bars, see them
 * on the jianpu, undo once, still 8 feature-bar items, 390 fits. The editor
 * panel is lazy-loaded with the 写谱 zone.
 */
export async function verifyRehearsals(port) {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const score = {
      title: "分段练习", bpm: 80, beats: 4, beatUnit: 4, key: "C", mode: "major", clef: "treble", tonicOctave: 4,
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
    await until((s) => s.title === "分段练习", "draft saved");
    // Click the first note on the jianpu (or staff backup) then set 前奏.
    const firstHit = page.locator("[data-jianpu-hit], .jianpu-note, [data-index='0']").first();
    // The jianpu view marks notes as clickable groups; fall back to the piano / letter input area.
    const pick = page.locator(".jianpu-line, [data-jianpu], .staff-slot").first();
    await pick.waitFor();
    // Click at the left of the first jianpu line to select the first note.
    const box = await pick.boundingBox();
    if (box) await page.mouse.click(box.x + 24, box.y + box.height * 0.55);
    const prelude = page.getByRole("button", { name: "前奏", exact: true });
    await prelude.waitFor();
    // If no note is selected, the button is disabled: click the first written degree.
    if (await prelude.isDisabled()) {
      const degree = page.locator("svg text").filter({ hasText: /^[1-7]$/ }).first();
      await degree.click({ force: true });
    }
    await prelude.click();
    const withMark = await until((s) => Array.isArray(s.rehearsals) && s.rehearsals[0]?.label === "前奏", "前奏 saved");
    assert.equal(withMark.rehearsals[0].at, 0);
    await page.getByText("第 1 小节「前奏」").first().waitFor();
    const label = page.locator("[data-rehearsal-marks] [data-rehearsal-at], [data-jianpu] [data-rehearsal-at]").first();
    await label.waitFor({ state: "attached", timeout: 5000 }).catch(() => null);
    const drawn = await page.locator("[data-rehearsal-marks] [data-rehearsal-at]").count();
    const texts = await page.locator("[data-rehearsal-at]").evaluateAll((els) => els.map((el) => ({ text: el.textContent, visible: !!(el.checkVisibility?.() ?? el.getClientRects().length) })));
    assert.ok(texts.some((t) => /前奏/.test(t.text || "")), `label missing: ${JSON.stringify(texts)} drawn=${drawn}`);

    await page.getByRole("button", { name: "撤销", exact: true }).click();
    await until((s) => !s.rehearsals, "undo clears the mark");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "390: no sideways scroll");
    assert.deepEqual(errors, []);
    await page.close();
    console.log(JSON.stringify({ rehearsals: "passed", checks: ["8 tabs", "set 前奏 on bar 1", "jianpu label", "undo", "390 fits"] }));
  } finally {
    await browser.close();
  }
}
