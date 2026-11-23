import assert from "node:assert/strict";
import { encodeSharePayload } from "../src/lib/music/share-link.ts";

/**
 * r22 作曲大师-style lyricist/composer + jianpu bar numbers.
 * The 写谱 credits panel is lazy-loaded; first screen stays untouched.
 */
export async function verifyCredits(port) {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const score = {
      title: "小星星",
      bpm: 80,
      beats: 4,
      beatUnit: 4,
      key: "C",
      mode: "major",
      clef: "treble",
      tonicOctave: 4,
      lyricist: "张三",
      composer: "李四",
      notes: [60, 62, 64, 65, 67, 69, 71, 72].map((p) => ({ pitches: [p], dur: 1 })),
    };
    await page.goto(`http://127.0.0.1:${port}/#s=${encodeSharePayload(score)}`);
    await page.getByRole("button", { name: "在编辑器中打开副本", exact: true }).click();
    const bar = page.getByRole("tablist", { name: "编辑器功能栏" });
    await bar.waitFor();
    assert.equal(await bar.getByRole("tab").count(), 8, "still 8 feature-bar items");
    await page.getByText("词：张三　曲：李四").first().waitFor();
    const numbers = page.locator("[data-bar-numbers] [data-bar-number]");
    await numbers.first().waitFor({ state: "attached", timeout: 8000 });
    const labels = await numbers.evaluateAll((els) => els.map((el) => el.getAttribute("data-bar-number")));
    assert.ok(labels.includes("1") && labels.includes("2"), `bar numbers missing: ${JSON.stringify(labels)}`);

    await page.getByRole("tab", { name: "写谱", exact: true }).click();
    const lyric = page.getByLabel("词作者");
    await lyric.waitFor();
    await lyric.fill("王五");
    await page.getByLabel("曲作者").fill("赵六");
    await page.getByRole("button", { name: "写入谱面", exact: true }).click();
    const stored = () =>
      page.evaluate(() => {
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
    const saved = await until((s) => s.lyricist === "王五" && s.composer === "赵六", "credits saved");
    assert.equal(saved.lyricist, "王五");
    await page.getByText("词：王五　曲：赵六").first().waitFor();
    await page.getByRole("button", { name: "撤销", exact: true }).click();
    await until((s) => s.lyricist === "张三" && s.composer === "李四", "undo restores credits");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "390: no sideways scroll");
    assert.deepEqual(errors, []);
    await page.close();
    console.log(JSON.stringify({ credits: "passed", checks: ["8 tabs", "header 词曲", "bar numbers", "写谱写入", "undo", "390 fits"] }));
  } finally {
    await browser.close();
  }
}
