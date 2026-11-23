import assert from "node:assert/strict";
import { encodeSharePayload } from "../src/lib/music/share-link.ts";

/**
 * r40 五线谱刻途中记号: mid-score ♩=, key and meter, fermata,
 * rit. words + dashed line all show on the staff; the score itself is unchanged;
 * 匈牙利狂想曲第二号 settles on the staff without a layout loop; 8 tabs; 390 fits.
 */
export async function verifyStaffMarks(port) {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const score = {
      title: "五线途中记号", bpm: 80, beats: 4, beatUnit: 4, key: "C", mode: "major", clef: "treble", tonicOctave: 4,
      notes: [60, 62, 64, 65, 67, 69, 71, 72, 72, 71, 69, 67, 65, 64, 62, 60, 62, 64, 66, 67].map((p) => ({ pitches: [p], dur: 1 })),
      changes: [{ at: 4, bpm: 120, key: "G", mode: "major" }, { at: 8, beats: 3, beatUnit: 4 }, { at: 11, bpm: 120 }],
      fermatas: [{ voice: 0, at: 13 }],
      gradualTempos: [{ from: 5, to: 8, kind: "rit" }],
    };
    await page.goto(`http://127.0.0.1:${port}/#s=${encodeSharePayload(score)}`);
    await page.getByRole("button", { name: "在编辑器中打开副本", exact: true }).click();
    const bar = page.getByRole("tablist", { name: "编辑器功能栏" });
    await bar.waitFor();
    assert.equal(await bar.getByRole("tab").count(), 8, "still 8 feature-bar items");
    await page.getByRole("button", { name: "五线", exact: true }).click();
    const staff = page.locator('[aria-label="五线谱，点符头可以选中"]');
    await staff.locator("[data-staff-gradual-line]").first().waitFor({ state: "attached", timeout: 15000 });
    const seen = await staff.evaluate((host) => ({
      tempos: [...host.querySelectorAll(".abcjs-tempo")].map((el) => el.textContent?.replace(/\s+/g, " ").trim()),
      keys: host.querySelectorAll(".abcjs-key-signature").length,
      keyTags: [...host.querySelectorAll(".abcjs-key-signature")].map((el) => (el.getAttribute("class") ?? "").split(/\s+/).filter((c) => /^abcjs-(l|m|mm|v)\d+$/.test(c)).sort().join(" ")),
      meters: host.querySelectorAll(".abcjs-time-signature").length,
      fermatas: [...host.querySelectorAll("path, text")].filter((el) => /fermata/.test(el.getAttribute("data-name") ?? "") || /abcjs-decoration/.test(el.getAttribute("class") ?? "")).length,
      rit: [...host.querySelectorAll("[data-staff-gradual-kind]")].map((el) => [el.textContent, el.getAttribute("data-staff-gradual-kind")]),
      dashes: host.querySelectorAll("[data-staff-gradual-line]").length,
      dashY: [...host.querySelectorAll("[data-staff-gradual-line]")].map((el) => Number(el.getAttribute("y1"))),
    }));
    assert.ok(seen.tempos.some((t) => /=\s*120/.test(t ?? "")), `mid-score ♩=120 missing: ${JSON.stringify(seen)}`);
    assert.equal(seen.tempos.filter((t) => /=\s*120/.test(t ?? "")).length, 1, `repeat ♩=120 drawn twice: ${JSON.stringify(seen)}`);
    assert.ok(seen.keys >= 1, `mid-score key signature missing: ${JSON.stringify(seen)}`);
    assert.equal(new Set(seen.keyTags).size, seen.keyTags.length, `key signature drawn twice: ${JSON.stringify(seen.keyTags)}`);
    assert.ok(seen.meters >= 2, `mid-score 3/4 missing: ${JSON.stringify(seen)}`);
    assert.ok(seen.fermatas >= 1, `fermata missing: ${JSON.stringify(seen)}`);
    assert.deepEqual(seen.rit, [["rit.", "rit"]], `rit. words missing: ${JSON.stringify(seen)}`);
    assert.ok(seen.dashes >= 1 && seen.dashY.every(Number.isFinite), `rit. dashes missing: ${JSON.stringify(seen)}`);
    const stored = await page.evaluate(() => {
      const raw = JSON.parse(localStorage.getItem("puxian-score-v1") ?? "null");
      return raw?.notes ? raw : raw?.score;
    });
    assert.equal(stored.changes.length, 3, "the score keeps its own change entries (the repeat ♩=120 is only hidden on the staff)");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "390: no sideways scroll");

    // 匈牙利狂想曲第二号: many mid-score changes; the staff must render once and settle.
    await page.goto(`http://127.0.0.1:${port}/`);
    await page.getByRole("button", { name: "打开匈牙利狂想曲第二号", exact: true }).click();
    await page.getByRole("tablist", { name: "编辑器功能栏" }).waitFor();
    await page.getByRole("button", { name: "五线", exact: true }).click();
    await staff.locator(".abcjs-tempo").nth(1).waitFor({ state: "attached", timeout: 30000 });
    const sample = () => staff.evaluate((host) => ({
      h: Math.round(host.getBoundingClientRect().height),
      svgs: host.querySelectorAll("svg").length,
      tempos: host.querySelectorAll(".abcjs-tempo").length,
      keyTags: [...host.querySelectorAll(".abcjs-key-signature")].map((el) => (el.getAttribute("class") ?? "").split(/\s+/).filter((c) => /^abcjs-(l|m|mm|v)\d+$/.test(c)).sort().join(" ")),
    }));
    await page.waitForTimeout(800);
    const a = await sample();
    await page.waitForTimeout(1200);
    const b = await sample();
    assert.deepEqual(a, b, `hr2 staff keeps changing (layout loop?) ${JSON.stringify([a, b])}`);
    assert.equal(new Set(a.keyTags).size, a.keyTags.length, "hr2: no key signature drawn twice");
    assert.ok(a.tempos >= 2 && a.svgs >= 1, `hr2 staff marks missing: ${JSON.stringify(a)}`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "hr2 390: no sideways scroll");
    assert.deepEqual(errors, []);
    await page.close();
    console.log(JSON.stringify({ staffMarks: "passed", checks: ["8 tabs", "♩= / key / meter", "fermata", "rit. + dashes", "score unchanged", "hr2 settles", "390 fits"], hr2: { h: a.h, tempos: a.tempos, keys: a.keyTags.length } }));
  } finally {
    await browser.close();
  }
}
