import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { encodeSharePayload } from "../src/lib/music/share-link.ts";

/**
 * Layout walk over the features added in rounds 1–8, at a 390 phone and a desktop:
 * score tools on screen, the collapsed chord guide leaves the stage to the notes,
 * jump / ending marks never print over chord names, the tuner row fits.
 */
export async function verifyLayoutWalk(port) {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  const shots = process.env.PUXIAN_WALK_SHOTS || "../logs/walk";
  mkdirSync(shots, { recursive: true });
  const score = {
    title: "布局走查", bpm: 96, beats: 4, beatUnit: 4, key: "G", mode: "major", clef: "treble", tonicOctave: 4,
    notes: Array.from({ length: 32 }, (_, i) => ({ pitches: [67 + [0, 2, 4, 5, 7, 5, 4, 2][i % 8]], dur: 1 })),
    voice2: Array.from({ length: 8 }, (_, i) => ({ pitches: [43 + [0, 7, 5, 2][i % 4]], dur: 4 })),
    chordSymbols: [0, 4, 8, 12, 16, 20, 24, 28].map((at, i) => ({ at, symbol: ["G", "D", "Em", "C", "G", "D7", "C", "G"][i] })),
    repeats: [{ from: 0, to: 12, ending: 8, endingEnd: 16 }],
    jumps: { segno: 16, toCoda: 20, ds: 24, coda: 24 },
  };
  try {
    for (const [name, viewport, guideMax] of [["phone", { width: 390, height: 844 }, 60], ["desktop", { width: 1280, height: 800 }, 70]]) {
      const page = await browser.newPage({ viewport });
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(`http://127.0.0.1:${port}/#s=${encodeSharePayload(score)}`);
      await page.getByRole("button", { name: "在编辑器中打开副本", exact: true }).click();
      const bar = page.getByRole("tablist", { name: "编辑器功能栏" });
      await bar.waitFor();
      await bar.getByRole("tab", { name: "辅助模块", exact: true }).click();
      await page.locator(".chord-guide").waitFor();
      await page.locator('.score-stage [data-jump="jump"]').first().waitFor();
      await page.locator(".score-stage [data-chord-symbol] text").first().waitFor();
      const geometry = await page.evaluate(() => {
        const box = (el) => el.getBoundingClientRect();
        const views = document.querySelector('.score-tools .segmented[aria-label="谱面视图"]');
        const tools = [...document.querySelectorAll(".score-tools button")].map(box);
        const guide = document.querySelector(".chord-guide");
        const marks = [...document.querySelectorAll(".score-stage [data-jump], .score-stage [data-ending]")].map(box).filter((r) => r.width && r.height);
        const chords = [...document.querySelectorAll(".score-stage [data-chord-symbol] text")].map(box);
        const hits = [];
        for (const m of marks) for (const c of chords)
          if (m.left < c.right - 1 && m.right > c.left + 1 && m.top < c.bottom - 1 && m.bottom > c.top + 1) hits.push([Math.round(m.left), Math.round(m.top), Math.round(c.left), Math.round(c.top)]);
        return {
          viewsRight: views ? box(views).right : null,
          toolsOff: tools.filter((r) => r.right > innerWidth + 0.5 || r.left < -0.5).length,
          guideHeight: guide ? box(guide).height : null,
          hits,
          overflow: document.documentElement.scrollWidth > innerWidth,
        };
      });
      assert.ok(geometry.viewsRight !== null && geometry.viewsRight <= viewport.width, `${name}: view switcher on screen ${JSON.stringify(geometry)}`);
      assert.equal(geometry.toolsOff, 0, `${name}: every score tool on screen`);
      assert.ok(geometry.guideHeight !== null && geometry.guideHeight <= guideMax, `${name}: collapsed chord guide ${geometry.guideHeight}px`);
      assert.deepEqual(geometry.hits, [], `${name}: jump / ending marks clear of chord names`);
      assert.equal(geometry.overflow, false, `${name}: no sideways scroll`);
      await page.screenshot({ path: `${shots}/${name}-score.png` });
      await bar.getByRole("tab", { name: "听写与音频", exact: true }).click();
      await page.getByRole("button", { name: "调音器", exact: true }).click();
      const tuner = page.locator("[data-tuner]");
      await tuner.waitFor();
      const fits = await tuner.evaluate((el) => [...el.querySelectorAll("button, select, label")].every((c) => c.getBoundingClientRect().right <= innerWidth + 0.5));
      assert.ok(fits, `${name}: tuner controls fit`);
      const label = await tuner.getByText(/A4 = \d+ Hz/).boundingBox();
      assert.ok(label && label.height < 30, `${name}: A4 label on one line`);
      await tuner.scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${shots}/${name}-tuner.png` });
      assert.deepEqual(errors, []);
      await page.close();
    }
    console.log(JSON.stringify({ layoutWalk: "passed", checks: ["score tools on screen", "compact chord guide", "marks clear of chord names", "tuner row fits", "390 + desktop"] }));
  } finally {
    await browser.close();
  }
}
