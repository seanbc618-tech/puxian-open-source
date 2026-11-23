import assert from "node:assert/strict";

/** Local, deterministic performance/setlist checks; no device, audio input or network required. */
export async function verifyPerformance(port, shotsDir) {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    for (const viewport of [
      { width: 390, height: 844 },
      { width: 844, height: 390 },
    ]) {
      const page = await browser.newPage({ viewport });
      page.setDefaultTimeout(10000);
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.addInitScript(() => {
        const score = {
          title: "演出长谱",
          bpm: 240,
          beats: 4,
          beatUnit: 4,
          key: "Eb",
          mode: "major",
          clef: "treble",
          tonicOctave: 4,
          notes: Array.from({ length: 128 }, (_, i) => ({ pitches: [60 + (i % 7)], dur: 1 })),
        };
        localStorage.setItem(
          "puxian-drafts-v1",
          JSON.stringify([
            { id: "long", at: 1, pinned: true, value: score },
            {
              id: "short",
              at: 2,
              pinned: true,
              value: { ...score, title: "演出短谱", notes: score.notes.slice(0, 4) },
            },
          ]),
        );
      });
      await page.goto(`http://127.0.0.1:${port}/`);
      await page.getByRole("button", { name: "歌单", exact: true }).click();
      await page.getByRole("textbox", { name: "歌单名称", exact: true }).fill("周末演出");
      await page.getByRole("button", { name: "新建歌单", exact: true }).click();
      const add = page.getByLabel("添加曲子到 周末演出", { exact: true });
      await add.selectOption("short");
      await add.selectOption("long");
      await page.getByRole("button", { name: "上移第 2 首", exact: true }).click();
      assert.deepEqual(
        await page.evaluate(() => JSON.parse(localStorage.getItem("puxian-setlists-v1"))[0].songs),
        ["long", "short"],
      );
      assert.ok(
        await page.evaluate(() => document.documentElement.scrollHeight > innerHeight),
        "home remains scrollable",
      );
      await page.getByRole("button", { name: "打开歌单", exact: true }).click();
      await page.locator("[data-full-score] .jianpu-line svg").first().waitFor();
      await page.getByText("周末演出 · 1/2", { exact: true }).waitFor();
      assert.equal(
        await page.getByLabel("曲名", { exact: true }).getAttribute("readonly"),
        "",
        "performance title cannot be edited",
      );
      assert.ok(
        await page.locator(".score-stage").evaluate((stage) => stage.clientHeight > 100),
        "score stays usable in narrow and landscape layouts",
      );
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
      );
      const stage = page.locator(".score-stage");
      const metrics = () =>
        stage.evaluate((el) => ({
          top: el.scrollTop,
          height: el.clientHeight,
          max: el.scrollHeight - el.clientHeight,
        }));
      const start = await metrics();
      assert.ok(start.max > start.height);
      const before = await page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("puxian-drafts-v1")).find((song) => song.id === "long")
            .value.notes,
      );
      const box = await stage.boundingBox();
      await page.mouse.click(box.x + box.width * 0.86, box.y + box.height * 0.5);
      assert.ok(
        Math.abs((await metrics()).top - start.height * 0.85) <= 2,
        "right third advances one overlapping screen",
      );
      assert.equal(
        await page.locator(".is-chosen").count(),
        0,
        "performance tap cannot select notes",
      );
      await page.keyboard.press("ArrowLeft");
      assert.equal((await metrics()).top, 0);
      for (const key of ["ArrowRight", "PageDown", "Space"]) {
        await page.keyboard.press(key);
        assert.ok((await metrics()).top > 0, `${key} advances`);
        await page.keyboard.press("PageUp");
        assert.equal((await metrics()).top, 0);
      }
      await page.mouse.click(box.x + box.width * 0.86, box.y + box.height * 0.5);
      await page.mouse.click(box.x + box.width * 0.1, box.y + box.height * 0.5);
      assert.equal((await metrics()).top, 0, "left third goes back");
      await page.getByRole("button", { name: "按速度自动滚", exact: true }).click();
      await page.waitForTimeout(800);
      assert.ok((await metrics()).top > 0, "tempo scroll moves");
      await page.getByRole("button", { name: "暂停滚屏", exact: true }).click();
      const paused = (await metrics()).top;
      await page.waitForTimeout(300);
      assert.equal((await metrics()).top, paused, "pause stops animation");
      await page.getByLabel("自动滚屏速度", { exact: true }).fill("150");
      assert.equal(await page.getByLabel("自动滚屏速度", { exact: true }).inputValue(), "150");
      await page.screenshot({ path: `${shotsDir}/performance-${viewport.width}.png` });
      await stage.evaluate((el) => {
        el.scrollTop = el.scrollHeight;
      });
      await stage.focus();
      await page.keyboard.press("PageDown");
      await page.getByText("周末演出 · 2/2", { exact: true }).waitFor();
      assert.equal(await page.getByLabel("曲名", { exact: true }).inputValue(), "演出短谱");
      assert.equal((await metrics()).top, 0, "new song starts at the top");
      await page.keyboard.press("Escape");
      assert.equal(await page.getByLabel("曲名", { exact: true }).getAttribute("readonly"), null);
      await page.locator(".jianpu-note-target").first().click({ force: true });
      await page.waitForFunction(() => document.querySelector(".is-chosen"));
      await page.getByRole("button", { name: "五线", exact: true }).click();
      await page.getByRole("button", { name: "全屏看谱", exact: true }).click();
      await page.locator(".staff svg").first().waitFor();
      await page.screenshot({ path: `${shotsDir}/performance-staff-${viewport.width}.png` });
      await page.keyboard.press("Escape");
      assert.deepEqual(
        await page.evaluate(
          () =>
            JSON.parse(localStorage.getItem("puxian-drafts-v1")).find((song) => song.id === "long")
              .value.notes,
        ),
        before,
        "performance never edits score",
      );
      // Playback must suppress tempo scrolling while follow-scroll owns the stage.
      await page.getByRole("button", { name: "播放", exact: true }).click();
      await page.getByRole("button", { name: "全屏看谱", exact: true }).click();
      await page.getByText("播放中，跟随音符", { exact: true }).waitFor({ state: "attached" });
      assert.equal(
        await page.getByRole("button", { name: "按速度自动滚", exact: true }).isDisabled(),
        true,
      );
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "停止", exact: true }).click();
      await page.getByRole("button", { name: "返回主页", exact: true }).click();
      await page.getByRole("button", { name: "歌单", exact: true }).click();
      const list = page.getByRole("region", { name: "歌单 周末演出", exact: true });
      await list.getByRole("button", { name: "移出第 2 首", exact: true }).click();
      assert.deepEqual(
        await page.evaluate(() => JSON.parse(localStorage.getItem("puxian-setlists-v1"))[0].songs),
        ["long"],
      );
      await list.getByRole("button", { name: "删除歌单 周末演出", exact: true }).click();
      assert.deepEqual(
        await page.evaluate(() => JSON.parse(localStorage.getItem("puxian-setlists-v1"))),
        [],
      );
      assert.deepEqual(errors, []);
      console.log(
        JSON.stringify({
          performance: viewport,
          taps: true,
          keys: true,
          autoScroll: true,
          setlist: true,
          staff: true,
        }),
      );
      await page.close();
    }
  } finally {
    await browser.close();
  }
}
