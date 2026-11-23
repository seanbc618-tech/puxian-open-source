import assert from "node:assert/strict";
import { encodeSharePayload } from "../src/lib/music/share-link.ts";

/**
 * r27 GarageBand-style eighth-note swing: 直拍 / 轻摆 / 摇摆 in 移调与乐器.
 * Playback feel only; the written score and first-screen budget stay unchanged.
 */
export async function verifySwing(port) {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const score = {
      title: "小星星",
      bpm: 60,
      beats: 4,
      beatUnit: 4,
      key: "C",
      mode: "major",
      clef: "treble",
      tonicOctave: 4,
      notes: [60, 60, 67, 67].map((p) => ({ pitches: [p], dur: 0.5 })),
    };
    await page.goto(`http://127.0.0.1:${port}/#s=${encodeSharePayload(score)}`);
    await page.getByRole("button", { name: "在编辑器中打开副本", exact: true }).click();
    const bar = page.getByRole("tablist", { name: "编辑器功能栏" });
    await bar.waitFor();
    assert.equal(await bar.getByRole("tab").count(), 8, "still 8 feature-bar items");
    await page.getByRole("tab", { name: "移调与乐器", exact: true }).click();
    const group = page.getByRole("radiogroup", { name: "摇摆节奏" });
    await group.waitFor();
    assert.equal(await group.getAttribute("data-swing-feel"), "straight");
    const straight = group.getByRole("radio", { name: "直拍", exact: true });
    const light = group.getByRole("radio", { name: "轻摆", exact: true });
    const swing = group.getByRole("radio", { name: "摇摆", exact: true });
    assert.equal(await straight.getAttribute("aria-checked"), "true");
    const small = await page.evaluate(() =>
      [...document.querySelectorAll('[aria-label="摇摆节奏"] button')]
        .filter((el) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && (r.width < 44 || r.height < 44);
        })
        .map((el) => (el.textContent ?? "").trim()),
    );
    assert.deepEqual(small, [], "摇摆节奏 buttons must stay 44px");

    await swing.click();
    assert.equal(await group.getAttribute("data-swing-feel"), "swing");
    assert.equal(await swing.getAttribute("aria-checked"), "true");
    await page.getByText("复合拍（如 6/8）仍按原谱。节拍器打在正拍上。").waitFor();
    assert.equal(await page.evaluate(() => localStorage.getItem("puxian-swing-v1")), "swing");
    assert.equal(
      await page.evaluate(() => {
        const raw = JSON.parse(localStorage.getItem("puxian-score-v1") ?? "null");
        const score = raw?.notes ? raw : raw?.score;
        return score?.swing ?? score?.feel ?? null;
      }),
      null,
      "swing must not be written into the stored score",
    );

    await light.click();
    assert.equal(await group.getAttribute("data-swing-feel"), "light");
    assert.equal(await page.evaluate(() => localStorage.getItem("puxian-swing-v1")), "light");

    await straight.click();
    assert.equal(await group.getAttribute("data-swing-feel"), "straight");
    assert.equal(await page.evaluate(() => localStorage.getItem("puxian-swing-v1")), "straight");
    assert.equal(await page.locator("text=复合拍（如 6/8）").count(), 0, "hint hides on 直拍");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "390: no sideways scroll");
    assert.deepEqual(errors, []);
    await page.close();
    console.log(JSON.stringify({
      swing: "passed",
      checks: ["8 tabs", "default 直拍", "摇摆 + 轻摆 persist", "score unchanged", "back to 直拍", "390 44px"],
    }));
  } finally {
    await browser.close();
  }
}
