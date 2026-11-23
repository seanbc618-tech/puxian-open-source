import assert from "node:assert/strict";
import { encodeSharePayload } from "../src/lib/music/share-link.ts";

/**
 * r25 EarMaster-style fixed-do vs movable-do naming on screen jianpu.
 * The toggle lives in 移调与乐器; first screen and score-core stay untouched.
 */
export async function verifyFixedDo(port) {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const score = {
      title: "小星星",
      bpm: 88,
      beats: 4,
      beatUnit: 4,
      key: "G",
      mode: "major",
      clef: "treble",
      tonicOctave: 4,
      notes: [67, 67, 74, 74, 76, 76, 74].map((p) => ({ pitches: [p], dur: 1 })),
    };
    await page.goto(`http://127.0.0.1:${port}/#s=${encodeSharePayload(score)}`);
    await page.getByRole("button", { name: "在编辑器中打开副本", exact: true }).click();
    const bar = page.getByRole("tablist", { name: "编辑器功能栏" });
    await bar.waitFor();
    assert.equal(await bar.getByRole("tab").count(), 8, "still 8 feature-bar items");
    await page.getByRole("button", { name: "简谱", exact: true }).click();
    await page.locator(".jianpu-line").first().waitFor({ timeout: 8000 });

    const digits = async () =>
      page.evaluate(() =>
        [...document.querySelectorAll(".jianpu-line text")]
          .map((el) => (el.textContent ?? "").trim())
          .filter((text) => /^[1-7]$/.test(text)),
      );
    const header = async () =>
      page.evaluate(() =>
        [...document.querySelectorAll(".jianpu-line text")]
          .map((el) => el.textContent ?? "")
          .filter((text) => text.startsWith("1="))
          .join(" "),
      );

    await page.waitForFunction(() =>
      [...document.querySelectorAll(".jianpu-line text")].some((el) => (el.textContent ?? "").startsWith("1=G")),
    );
    const movableDigits = await digits();
    assert.equal(movableDigits[0], "1", `movable should start on 1: ${JSON.stringify(movableDigits.slice(0, 6))}`);
    assert.equal(await header(), "1=G");

    await page.getByRole("tab", { name: "移调与乐器", exact: true }).click();
    const naming = page.getByRole("radiogroup", { name: "简谱唱名" });
    await naming.waitFor();
    const movableBtn = naming.getByRole("button", { name: "首调", exact: true });
    const fixedBtn = naming.getByRole("button", { name: "固定调", exact: true });
    assert.equal(await movableBtn.getAttribute("aria-checked"), "true");
    const small = await page.evaluate(() =>
      [...document.querySelectorAll('[aria-label="简谱唱名"] button')]
        .filter((el) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && (r.width < 44 || r.height < 44);
        })
        .map((el) => (el.textContent ?? "").trim()),
    );
    assert.deepEqual(small, [], "简谱唱名 buttons must stay 44px");

    await fixedBtn.click();
    await page.getByText("简谱固定调（1=C）").first().waitFor();
    await page.waitForFunction(() =>
      [...document.querySelectorAll(".jianpu-line text")].some((el) => (el.textContent ?? "").startsWith("1=C")),
    );
    const fixedDigits = await digits();
    assert.equal(fixedDigits[0], "5", `fixed-do G tonic should read as 5: ${JSON.stringify(fixedDigits.slice(0, 6))}`);
    assert.equal(await header(), "1=C");
    assert.equal(
      await page.evaluate(() => {
        const raw = JSON.parse(localStorage.getItem("puxian-score-v1") ?? "null");
        const score = raw?.notes ? raw : raw?.score;
        return score?.key;
      }),
      "G",
      "fixed-do must not rewrite the stored key",
    );

    await movableBtn.click();
    await page.waitForFunction(() =>
      [...document.querySelectorAll(".jianpu-line text")].some((el) => (el.textContent ?? "").startsWith("1=G")),
    );
    const restored = await digits();
    assert.equal(restored[0], "1", `back to movable: ${JSON.stringify(restored.slice(0, 6))}`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "390: no sideways scroll");
    assert.deepEqual(errors, []);
    await page.close();
    console.log(JSON.stringify({
      fixedDo: "passed",
      checks: ["8 tabs", "movable 1=G", "fixed 1=C starts on 5", "stored key unchanged", "back to 首调", "390 44px"],
    }));
  } finally {
    await browser.close();
  }
}
