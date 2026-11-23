import assert from "node:assert/strict";
import { encodeSharePayload } from "../src/lib/music/share-link.ts";

/**
 * r30 Sight Reading Factory-style drill: two bars in the current key and meter,
 * preview without rewriting, write + undo. Lives in 写谱, not the practice panel.
 */
export async function verifySightRead(port) {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const score = {
      title: "原谱",
      bpm: 96,
      beats: 4,
      beatUnit: 4,
      key: "G",
      mode: "major",
      clef: "treble",
      tonicOctave: 4,
      notes: [{ pitches: [67], dur: 4 }, { pitches: [69], dur: 4 }],
    };
    await page.goto(`http://127.0.0.1:${port}/#s=${encodeSharePayload(score)}`);
    await page.getByRole("button", { name: "在编辑器中打开副本", exact: true }).click();
    const bar = page.getByRole("tablist", { name: "编辑器功能栏" });
    await bar.waitFor();
    assert.equal(await bar.getByRole("tab").count(), 8, "still 8 feature-bar items");
    await page.getByRole("tab", { name: "辅助模块", exact: true }).click();
    const card = page.locator("[data-sight-read]");
    await card.waitFor();
    const line = card.locator("[data-sight-line]");
    await line.waitFor();
    const first = (await line.textContent()) ?? "";
    assert.match(first, /^1=G 4\/4  /);
    assert.equal(await card.getAttribute("data-sight-density"), "beats");

    const radios = card.getByRole("radiogroup", { name: "视奏节奏" }).getByRole("radio");
    const small = await radios.evaluateAll((els) =>
      els.filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && (r.width < 44 || r.height < 44);
      }).map((el) => (el.textContent ?? "").trim()),
    );
    assert.deepEqual(small, [], "视奏节奏 buttons must stay 44px");

    await card.getByRole("button", { name: "换一题", exact: true }).click();
    const second = (await line.textContent()) ?? "";
    assert.match(second, /^1=G 4\/4  /);
    assert.notEqual(second, first, "换一题 should change the drill");
    assert.equal(await card.getAttribute("data-sight-seed"), "2");

    const before = await page.evaluate(() => {
      const raw = JSON.parse(localStorage.getItem("puxian-score-v1") ?? "null");
      const score = raw?.notes ? raw : raw?.score;
      return score?.notes ?? [];
    });
    await card.getByRole("button", { name: "试听", exact: true }).click();
    assert.deepEqual(
      await page.evaluate(() => {
        const raw = JSON.parse(localStorage.getItem("puxian-score-v1") ?? "null");
        const score = raw?.notes ? raw : raw?.score;
        return score?.notes ?? [];
      }),
      before,
      "试听 must not rewrite the stored score",
    );

    await card.getByRole("button", { name: "写入当前声部", exact: true }).click();
    await page.getByText("已写入视奏练习，可撤销。").first().waitFor();
    await page.waitForFunction((original) => {
      const raw = JSON.parse(localStorage.getItem("puxian-score-v1") ?? "null");
      const score = raw?.notes ? raw : raw?.score;
      return JSON.stringify(score?.notes ?? []) !== JSON.stringify(original);
    }, before);
    const written = await page.evaluate(() => {
      const raw = JSON.parse(localStorage.getItem("puxian-score-v1") ?? "null");
      const score = raw?.notes ? raw : raw?.score;
      return score?.notes ?? [];
    });
    assert.notDeepEqual(written, before, "写入 replaces the active voice");
    assert.equal(written.reduce((sum, note) => sum + note.dur, 0), 8);

    await page.getByRole("button", { name: "撤销", exact: true }).first().click();
    await page.waitForFunction((original) => {
      const raw = JSON.parse(localStorage.getItem("puxian-score-v1") ?? "null");
      const score = raw?.notes ? raw : raw?.score;
      return JSON.stringify(score?.notes ?? []) === JSON.stringify(original);
    }, before);
    const restored = await page.evaluate(() => {
      const raw = JSON.parse(localStorage.getItem("puxian-score-v1") ?? "null");
      const score = raw?.notes ? raw : raw?.score;
      return score?.notes ?? [];
    });
    assert.deepEqual(restored, before, "undo restores the original voice");

    await card.getByRole("radio", { name: "含休止", exact: true }).click();
    assert.equal(await card.getAttribute("data-sight-density"), "rests");
    assert.equal(await page.evaluate(() => localStorage.getItem("puxian-sight-density-v1")), "rests");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "390: no sideways scroll");
    assert.deepEqual(errors, []);
    await page.close();
    console.log(JSON.stringify({
      sightRead: "passed",
      checks: ["8 tabs", "1=G 4/4 line", "换一题", "试听 keeps score", "write + undo", "390 44px"],
    }));
  } finally {
    await browser.close();
  }
}
