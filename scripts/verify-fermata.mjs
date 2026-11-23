import assert from "node:assert/strict";
import { encodeSharePayload } from "../src/lib/music/share-link.ts";

/**
 * r34 MuseScore-style fermatas: set 延长 on a selected note, see it on the
 * jianpu, undo once, still 8 feature-bar items, 390 fits. The panel is the
 * existing 表情记号 zone.
 */
export async function verifyFermata(port) {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const score = {
      title: "延长练习", bpm: 80, beats: 4, beatUnit: 4, key: "C", mode: "major", clef: "treble", tonicOctave: 4,
      notes: [60, 62, 64, 65].map((p) => ({ pitches: [p], dur: 1 })),
    };
    await page.goto(`http://127.0.0.1:${port}/#s=${encodeSharePayload(score)}`);
    await page.getByRole("button", { name: "在编辑器中打开副本", exact: true }).click();
    const bar = page.getByRole("tablist", { name: "编辑器功能栏" });
    await bar.waitFor();
    assert.equal(await bar.getByRole("tab").count(), 8, "still 8 feature-bar items");
    await page.getByRole("tab", { name: "表情记号", exact: true }).click();
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
    await until((s) => s.title === "延长练习", "draft saved");
    const pick = page.locator(".jianpu-line, [data-jianpu], .staff-slot").first();
    await pick.waitFor();
    const box = await pick.boundingBox();
    if (box) await page.mouse.click(box.x + 24, box.y + box.height * 0.55);
    // Bar numbers are also "1"–"7" text; skip those and click a written degree.
    const degree = page.locator("svg g[data-id] text").filter({ hasText: /^[1-7]$/ }).first();
    const hold = page.getByRole("button", { name: "延长", exact: true });
    await hold.waitFor();
    if (await hold.isDisabled()) {
      await degree.click({ force: true });
    }
    for (let i = 0; i < 10 && await hold.isDisabled(); i += 1) {
      if (box) await page.mouse.click(box.x + 24 + i, box.y + box.height * 0.55);
      else await degree.click({ force: true });
      await page.waitForTimeout(100);
    }
    await hold.click();
    const withMark = await until((s) => Array.isArray(s.fermatas) && s.fermatas.length > 0, "延长 saved");
    assert.equal(withMark.fermatas[0].voice, 0);
    assert.ok(Number.isFinite(withMark.fermatas[0].at), `bad onset ${JSON.stringify(withMark.fermatas)}`);
    const drawn = await page.locator("[data-fermata-at]").count();
    assert.ok(drawn > 0, `jianpu fermata missing, drawn=${drawn}`);
    await page.getByRole("button", { name: "撤销", exact: true }).click();
    await until((s) => !s.fermatas, "undo clears the mark");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "390: no sideways scroll");
    assert.deepEqual(errors, []);
    await page.close();
    console.log(JSON.stringify({ fermata: "passed", checks: ["8 tabs", "set 延长 on first note", "jianpu mark", "undo", "390 fits"] }));
  } finally {
    await browser.close();
  }
}
