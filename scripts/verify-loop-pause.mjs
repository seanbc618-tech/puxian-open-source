import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const uptime = () => Number(readFileSync("/proc/uptime", "utf8").split(" ")[0]);
import { encodeSharePayload } from "../src/lib/music/share-link.ts";

/**
 * r18 段落循环 (Amazing Slow Downer-style): a pause after each pass and a pass count.
 * One 4/4 bar at ♩=240 is 1 s; with 停 1 秒 and 练 3 遍 the run is pass, pause, pass, pause,
 * pass, then it stops by itself and says so. Settings are kept per song.
 */
export async function verifyLoopPause(port) {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const score = {
      title: "循环停顿", bpm: 240, beats: 4, beatUnit: 4, key: "C", mode: "major", clef: "treble", tonicOctave: 4,
      notes: [60, 62, 64, 65, 67, 69, 71, 72].map((p) => ({ pitches: [p], dur: 1 })),
    };
    await page.goto(`http://127.0.0.1:${port}/#s=${encodeSharePayload(score)}`);
    await page.getByRole("button", { name: "在编辑器中打开副本", exact: true }).click();
    const transport = page.getByRole("navigation", { name: "播放与编辑" });
    await transport.getByRole("button", { name: /^练习/ }).click();
    assert.equal(await page.locator("[data-loop-pause]").count(), 0, "loop extras hidden until looping");
    await page.getByLabel("循环终点小节", { exact: true }).selectOption("1");
    const pause = page.getByLabel("每遍之间停顿", { exact: true });
    await pause.waitFor();
    assert.deepEqual(await pause.locator("option").allTextContents(), ["不停", "1 秒", "2 秒", "4 秒"]);
    await pause.selectOption("1");
    await page.getByLabel("循环遍数", { exact: true }).selectOption("3");
    const status = page.locator("[data-loop-pause] + p[role=status]");
    assert.match(await status.textContent(), /练 3 遍后停。$/);
    const row = await page.locator("[data-loop-pause]").evaluate((el) => ({ fits: el.scrollWidth <= el.clientWidth, selects: [...el.querySelectorAll("select")].map((s) => s.getBoundingClientRect().height) }));
    assert.ok(row.fits && row.selects.every((h) => h >= 44), `390: loop row fits, 44 px selects (${JSON.stringify(row)})`);
    const t0 = uptime();
    await transport.getByRole("button", { name: "播放", exact: true }).click();
    await status.filter({ hasText: "第 1 / 3 遍，" }).waitFor();
    await status.filter({ hasText: "第 1 / 3 遍练完，停 1 秒再来。" }).waitFor();
    await status.filter({ hasText: "第 2 / 3 遍，" }).waitFor();
    await status.filter({ hasText: "第 3 / 3 遍，" }).waitFor();
    await page.getByText("已循环练完 3 遍。", { exact: true }).waitFor({ timeout: 8000 });
    const took = uptime() - t0;
    assert.ok(took >= 4.5 && took <= 8, `3 passes + 2 pauses ≈ 5 s (took ${took.toFixed(1)} s)`);
    await transport.getByRole("button", { name: "播放", exact: true }).waitFor();
    const saved = await page.evaluate(() => Object.values(JSON.parse(localStorage.getItem("puxian-practice-v1")))[0]);
    assert.equal(saved.loopPause, 1);
    assert.equal(saved.loopTimes, 3);
    // Back to the defaults: endless, no pause — a plain loop keeps going past three passes.
    await pause.selectOption("0");
    await page.getByLabel("循环遍数", { exact: true }).selectOption("0");
    await transport.getByRole("button", { name: "播放", exact: true }).click();
    await status.filter({ hasText: "第 4 遍，" }).waitFor({ timeout: 8000 });
    assert.equal(await status.filter({ hasText: "秒再来" }).count(), 0, "no pause text");
    await transport.getByRole("button", { name: "停止", exact: true }).click();
    assert.deepEqual(errors, []);
    await page.close();
    console.log(JSON.stringify({ loopPause: "passed", checks: ["hidden until looping", "pause + count options", "pass / pause status", "stops after 3 passes", "kept per song", "endless loop unchanged", "390 targets"] }));
  } finally {
    await browser.close();
  }
}
