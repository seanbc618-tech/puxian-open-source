import assert from "node:assert/strict";
import { encodeSharePayload } from "../src/lib/music/share-link.ts";

export async function verifyChordExperience(port) {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 900 } }),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const score = {
      title: "和弦体验验证",
      key: "Eb",
      mode: "major",
      bpm: 120,
      beats: 4,
      beatUnit: 4,
      clef: "treble",
      tonicOctave: 4,
      notes: Array.from({ length: 32 }, () => ({ pitches: [63], dur: 1 })),
      chordSymbols: [
        { at: 0, symbol: "Eb" },
        { at: 4, symbol: "Ab" },
        { at: 8, symbol: "Bb" },
      ],
    };
    await page.goto(`http://127.0.0.1:${port}/#s=${encodeSharePayload(score)}`);
    await page.getByRole("button", { name: "在编辑器中打开副本", exact: true }).click();
    await page.getByRole("tab", { name: "辅助模块", exact: true }).click();
    const guide = page.getByRole("region", { name: "和弦按法与级数", exact: true });
    // A section with an accessible name has region semantics.
    await guide.waitFor();
    await guide.locator("summary").first().click();
    await page.getByLabel("变调夹品位", { exact: true }).selectOption("3");
    await page.waitForFunction(() =>
      document.querySelector('[data-chord-position="current"] [data-shape="C"]'),
    );
    await page.getByRole("button", { name: "推荐", exact: true }).click();
    assert.ok(
      ["1", "3"].includes(await page.getByLabel("变调夹品位", { exact: true }).inputValue()),
    );
    await page.getByLabel("变调夹品位", { exact: true }).selectOption("3");
    await page.getByLabel("和弦图乐器", { exact: true }).selectOption("ukulele");
    assert.ok(await guide.getByRole("img", { name: /C 尤克里里指法/ }).count());
    await page.getByLabel("和弦图乐器", { exact: true }).selectOption("piano");
    assert.ok(await guide.getByRole("img", { name: /Eb 钢琴组成音/ }).count());
    await page.getByLabel("和弦主标签", { exact: true }).selectOption("degree");
    await page.getByLabel("级数格式", { exact: true }).selectOption("number");
    await page.waitForFunction(() =>
      document.querySelector(".score-stage").textContent.includes("1 · Eb"),
    );
    await page.waitForTimeout(500);
    const stored = () =>
      page.evaluate(() => JSON.parse(localStorage.getItem("puxian-score-v1")).score);
    const before = await stored();
    assert.deepEqual(
      before.chordSymbols,
      score.chordSymbols,
      "display labels and capo never write into chord symbols",
    );
    assert.deepEqual(before.notes, score.notes, "capo never changes score pitches");
    const transport = page.getByRole("navigation", { name: "播放与编辑" });
    await transport.getByRole("button", { name: "播放", exact: true }).click();
    await page.waitForFunction(
      () => document.querySelector('[data-chord-position="current"] [data-shape="Ab"]'),
      null,
      { timeout: 10000 },
    );
    await transport.getByRole("button", { name: "停止", exact: true }).click();
    await page.getByRole("tab", { name: "辅助模块", exact: true }).click();
    await page.getByRole("button", { name: "预览 I–V–vi–IV", exact: true }).click();
    await page.getByLabel("和弦进行预览", { exact: true }).waitFor();
    assert.deepEqual((await stored()).chordSymbols, score.chordSymbols, "preview never commits");
    await page.getByRole("button", { name: "应用进行", exact: true }).click();
    await page.waitForFunction(
      () => JSON.parse(localStorage.getItem("puxian-score-v1")).score.chordSymbols.length === 4,
    );
    assert.deepEqual(
      (await stored()).chordSymbols.slice(0, 3),
      score.chordSymbols,
      "existing marks retained by default",
    );
    await transport.getByRole("button", { name: "撤销", exact: true }).click();
    await page.waitForFunction(
      () => JSON.parse(localStorage.getItem("puxian-score-v1")).score.chordSymbols.length === 3,
    );
    await page.getByRole("button", { name: "预览 ii–V–I", exact: true }).click();
    await page.getByLabel("确认覆盖这些已有标记", { exact: true }).check();
    await page.getByRole("button", { name: "应用进行", exact: true }).click();
    await page.waitForFunction(
      () =>
        JSON.parse(localStorage.getItem("puxian-score-v1")).score.chordSymbols[0].symbol === "Fm",
    );
    assert.deepEqual(
      (await stored()).chordSymbols.map((s) => s.symbol),
      ["Fm", "Bb", "Eb"],
    );
    await transport.getByRole("button", { name: "撤销", exact: true }).click();
    await page.waitForFunction(
      () =>
        JSON.parse(localStorage.getItem("puxian-score-v1")).score.chordSymbols[0].symbol === "Eb",
    );
    await page.getByRole("button", { name: "返回主页", exact: true }).click();
    await page.getByRole("button", { name: "继续上次草稿", exact: true }).click();
    await page.getByRole("tab", { name: "辅助模块", exact: true }).click();
    await page.locator(".chord-guide summary").first().click();
    assert.equal(
      await page.getByLabel("变调夹品位", { exact: true }).inputValue(),
      "3",
      "capo remembered for this song",
    );
    assert.equal(await page.getByLabel("和弦图乐器", { exact: true }).inputValue(), "piano");
    await page.getByLabel("和弦图乐器", { exact: true }).selectOption("guitar");
    await page.locator(".chord-guide summary").first().click();
    await page.screenshot({ path: `${process.env.PUXIAN_ARTIFACTS || "../logs"}/chords-desktop.png` });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "练习", exact: true }).click();
    await page.getByRole("button", { name: "琴键 展开", exact: true }).click();
    await page.locator("[data-visual-keyboard]").waitFor();
    const geometry = await page.evaluate(() => {
      const panel = document.querySelector("#zone-practice").getBoundingClientRect(),
        dock = document.querySelector(".keyboard-dock").getBoundingClientRect();
      return {
        height: Math.min(panel.bottom, dock.top, innerHeight) - Math.max(panel.top, 0),
        overflow: document.documentElement.scrollWidth > innerWidth,
      };
    });
    assert.ok(geometry.height >= 200, JSON.stringify(geometry));
    assert.equal(geometry.overflow, false);
    await page.waitForTimeout(500);
    assert.ok(
      await page.evaluate(() => document.querySelector(".app-shell").scrollLeft === 0),
      "phone editor never scrolls sideways behind its clipped shell",
    );
    await page.screenshot({ path: `${process.env.PUXIAN_ARTIFACTS || "../logs"}/chords-phone-keyboard-practice.png` });
    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify({
        chordExperience: "passed",
        phonePracticeHeight: geometry.height,
        checks: [
          "instrument diagrams",
          "concert pitches",
          "capo recommendation",
          "local settings",
          "degree labels",
          "playback current/next",
          "preview",
          "preserve existing",
          "explicit overwrite",
          "undo",
          "390 keyboard practice",
        ],
      }),
    );
  } finally {
    await browser.close();
  }
}
