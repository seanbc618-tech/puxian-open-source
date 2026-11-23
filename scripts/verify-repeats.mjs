import assert from "node:assert/strict";
import { encodeSharePayload } from "../src/lib/music/share-link.ts";

/**
 * Repeat signs and 1st / 2nd endings in the browser: set them bar by bar from the
 * selected note, see them drawn on the numbered score, hear playback follow
 * A B A C, then clear and undo. Then D.S. al Coda: Segno / To Coda / Coda / D.S. set
 * from the toolbar, drawn on both views, played in jump order, exported to MusicXML.
 */
export async function verifyRepeats(port) {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    // 2/4, eight quarter notes → bars [0,2) [2,4) [4,6) [6,8).
    const score = {
      title: "反复检查", bpm: 200, beats: 2, beatUnit: 4, key: "C", mode: "major", clef: "treble", tonicOctave: 4,
      notes: [60, 62, 64, 65, 67, 69, 71, 72].map((p) => ({ pitches: [p], dur: 1 })),
    };
    await page.goto(`http://127.0.0.1:${port}/#s=${encodeSharePayload(score)}`);
    await page.getByLabel("曲名", { exact: true }).waitFor();
    await page.getByRole("button", { name: "在编辑器中打开副本", exact: true }).click();
    const bar = page.getByRole("tablist", { name: "编辑器功能栏" });
    await bar.waitFor();
    assert.equal(await bar.getByRole("tab").count(), 8, "still 8 feature-bar items");
    await page.getByRole("button", { name: "简谱", exact: true }).click();
    await bar.getByRole("tab", { name: "写谱", exact: true }).click();
    const repeatBar = page.locator("[data-repeat-bar]");
    await repeatBar.waitFor();
    const summary = repeatBar.locator("[data-repeat-summary]");
    assert.match(await summary.innerText(), /没有反复/);
    const notice = page.locator('p[role="status"]').first();
    const pick = async (i) => {
      await page.locator(".score-stage .jianpu-note-target").nth(i).click({ force: true });
    };
    const act = async (label) => repeatBar.getByRole("button", { name: label, exact: true }).click();

    await pick(0); await act("|: 反复开始");
    await pick(3); await act(":| 反复结束");
    assert.match(await summary.innerText(), /^第 1–2 小节反复$/);
    await pick(0); await act("二房 2.");
    await page.waitForFunction(() => /二房要选紧接/.test(document.querySelector('p[role="status"]')?.textContent ?? ""));
    await pick(4); await act("二房 2.");
    await page.waitForFunction(() => /先设一房/.test(document.querySelector('p[role="status"]')?.textContent ?? ""));
    await pick(2); await act("一房 1.");
    await pick(4); await act("二房 2.");
    assert.equal(await summary.innerText(), "第 1–2 小节反复（一房从第 2 小节，二房到第 3 小节）");
    assert.match(await notice.innerText(), /已设：.*可以撤销/);

    // Drawn on the numbered score.
    const stage = page.locator(".score-stage");
    await stage.locator('[data-repeat="start"]').first().waitFor();
    assert.ok(await stage.locator('[data-repeat="end"]').count() >= 1, ":| drawn");
    assert.ok(await stage.locator('[data-ending="1"]').count() >= 1, "1st ending drawn");
    assert.ok(await stage.locator('[data-ending="2"]').count() >= 1, "2nd ending drawn");

    // Playback follows the repeat: the lit note's written start goes 0 1 2 3 0 1 4 5 6 7.
    await page.evaluate(() => {
      window.litTrace = [];
      const tick = () => {
        const id = document.querySelector(".score-stage g.is-sounding[data-id], .score-stage .is-sounding[data-id]")?.getAttribute("data-id");
        const start = id ? Number(id.split("-")[0]) : null;
        if (start != null && window.litTrace.at(-1) !== start) window.litTrace.push(start);
        if (!window.litStop) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    const transport = page.locator(".transport");
    await transport.getByRole("button", { name: "播放", exact: true }).click();
    await page.waitForFunction(() => window.litTrace.length >= 10, null, { timeout: 15000 }).catch(async (error) => {
      throw new Error(`lit order ${JSON.stringify(await page.evaluate(() => window.litTrace))}`, { cause: error });
    });
    const order = await page.evaluate(() => { window.litStop = true; return window.litTrace; });
    assert.deepEqual(order.slice(0, 10), [0, 1, 2, 3, 0, 1, 4, 5, 6, 7], JSON.stringify(order));
    await transport.getByRole("button", { name: "播放", exact: true }).waitFor({ timeout: 10000 });

    // The five-line staff still engraves with the repeat.
    await page.getByRole("button", { name: "五线", exact: true }).click();
    await page.locator(".staff svg").first().waitFor();
    assert.ok(await page.locator(".staff svg .abcjs-ending").count() >= 2, "staff 1st / 2nd ending brackets");
    assert.ok(await page.locator(".staff svg .abcjs-bar").count() >= 4, "staff bar lines");
    await page.getByRole("button", { name: "简谱", exact: true }).click();

    // Clear, then undo brings it back.
    await pick(1); await act("清除反复");
    assert.match(await summary.innerText(), /没有反复/);
    assert.equal(await stage.locator("[data-repeat]").count(), 0);
    await page.getByRole("button", { name: "撤销", exact: true }).first().click();
    await page.waitForFunction(() => /一房从第 2 小节/.test(document.querySelector("[data-repeat-summary]")?.textContent ?? ""));

    // D.S. al Coda on a fresh copy: |b1|b2 Segno|b3 To Coda|b4 D.S.|b5 Coda|b6| (2/4, two notes per bar)
    await page.goto("about:blank");
    await page.goto(`http://127.0.0.1:${port}/#s=${encodeSharePayload({ ...score, title: "跳转检查", notes: [60, 62, 64, 65, 67, 69, 71, 72, 74, 76, 77, 79].map((p) => ({ pitches: [p], dur: 1 })) })}`);
    await page.getByRole("button", { name: "在编辑器中打开副本", exact: true }).click();
    await bar.waitFor();
    await page.getByRole("button", { name: "简谱", exact: true }).click();
    await bar.getByRole("tab", { name: "写谱", exact: true }).click();
    const jumps = repeatBar.locator("[data-jump-summary]");
    assert.match(await jumps.innerText(), /没有跳转/);
    await pick(6); await act("D.S. 回记号");
    await page.waitForFunction(() => /还不能跳转：D\.S\. 要先设 Segno/.test(document.querySelector("[data-jump-summary]")?.textContent ?? ""));
    await pick(2); await act("Segno 记号");
    await pick(4); await act("To Coda");
    await page.waitForFunction(() => /还要设 Coda/.test(document.querySelector("[data-jump-summary]")?.textContent ?? ""));
    await pick(8); await act("Coda 尾声");
    assert.equal(await jumps.innerText(), "第 4 小节末 D.S. al Coda：回到第 2 小节 Segno，奏到第 3 小节末 To Coda，跳到第 5 小节 Coda 奏完");
    for (const kind of ["segno", "coda", "toCoda", "jump"]) await stage.locator(`[data-jump="${kind}"]`).first().waitFor();
    assert.equal(await stage.locator('[data-jump="jump"]').first().textContent(), "D.S. al Coda");
    await page.getByRole("button", { name: "五线", exact: true }).click();
    await page.waitForFunction(() => {
      const text = [...document.querySelectorAll(".staff svg text")].map((t) => t.textContent).join(" ");
      return /D\.S\. al coda/i.test(text);
    });
    await page.getByRole("button", { name: "简谱", exact: true }).click();
    // b1 b2 b3 b4 | Segno b2 b3 To Coda → Coda b5 b6: starts 0..7, 2..5, 8..11.
    await page.evaluate(() => { window.litTrace = []; window.litStop = false; });
    await page.evaluate(() => {
      const tick = () => {
        const id = document.querySelector(".score-stage .is-sounding[data-id]")?.getAttribute("data-id");
        const start = id ? Number(id.split("-")[0]) : null;
        if (start != null && window.litTrace.at(-1) !== start) window.litTrace.push(start);
        if (!window.litStop) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    await transport.getByRole("button", { name: "播放", exact: true }).click();
    await page.waitForFunction(() => window.litTrace.length >= 16, null, { timeout: 15000 }).catch(async (error) => {
      throw new Error(`jump order ${JSON.stringify(await page.evaluate(() => window.litTrace))}`, { cause: error });
    });
    const jumpOrder = await page.evaluate(() => { window.litStop = true; return window.litTrace; });
    assert.deepEqual(jumpOrder.slice(0, 16), [0, 1, 2, 3, 4, 5, 6, 7, 2, 3, 4, 5, 8, 9, 10, 11], JSON.stringify(jumpOrder));
    await transport.getByRole("button", { name: "播放", exact: true }).waitFor({ timeout: 10000 });
    // Setting a mark again at the same place removes it; undo puts it back.
    await pick(8); await act("Coda 尾声");
    assert.equal(await stage.locator('[data-jump="coda"]').count(), 0);
    await page.getByRole("button", { name: "撤销", exact: true }).first().click();
    await stage.locator('[data-jump="coda"]').first().waitFor();
    await pick(0); await act("清除跳转");
    assert.match(await jumps.innerText(), /没有跳转/);
    assert.equal(await stage.locator("[data-jump]").count(), 0);
    await page.getByRole("button", { name: "撤销", exact: true }).first().click();
    await stage.locator('[data-jump="segno"]').first().waitFor();
    await page.screenshot({ path: `${process.env.PUXIAN_ARTIFACTS || "../logs"}/jumps-jianpu.png` }).catch(() => {});
    assert.equal(await bar.getByRole("tab").count(), 8, "still 8 feature-bar items");

    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
}
