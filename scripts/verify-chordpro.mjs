import assert from "node:assert/strict";
import { encodeSharePayload } from "../src/lib/music/share-link.ts";

/**
 * r19 ChordPro (OnSong / SongbookPro lead-sheet text): the panel loads only with 歌词;
 * pasting "[C]一闪…" puts words and chords on the written melody in one undo step, and
 * 导出 ChordPro writes them back as .cho text.
 */
export async function verifyChordPro(port) {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const score = {
      title: "小星星", bpm: 96, beats: 4, beatUnit: 4, key: "C", mode: "major", clef: "treble", tonicOctave: 4,
      notes: [60, 60, 67, 67, 69, 69, 67, 67].map((p, i) => ({ pitches: [p], dur: i === 7 ? 1 : 1 })),
    };
    await page.goto(`http://127.0.0.1:${port}/#s=${encodeSharePayload(score)}`);
    await page.getByRole("button", { name: "在编辑器中打开副本", exact: true }).click();
    const bar = page.getByRole("tablist", { name: "编辑器功能栏" });
    await bar.waitFor();
    assert.equal(await bar.getByRole("tab").count(), 8, "still 8 feature-bar items");
    const chunk = () => page.evaluate(() => performance.getEntriesByType("resource").some((e) => /\/assets\/chordpro-panel-[\w-]+\.js$/.test(new URL(e.name).pathname)));
    assert.equal(await chunk(), false, "ChordPro panel not loaded before 歌词");
    const stored = () => page.evaluate(() => {
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
    await until((s) => s.title === "小星星" && s.notes.length === 8, "draft saved");
    await bar.getByRole("tab", { name: "歌词", exact: true }).click();
    const panel = page.locator("[data-chordpro]");
    await panel.waitFor();
    assert.equal(await chunk(), true, "loaded with 歌词");
    const apply = panel.getByRole("button", { name: "套到旋律上", exact: true });
    assert.equal(await apply.isDisabled(), true, "nothing pasted yet");
    await page.locator("#chordpro-paste").fill("{title: 小星星}\n{key: C}\n[C]一闪一闪[F]亮晶[C]晶\n");
    await apply.click();
    await page.getByText("已套上 7 个字、3 个和弦名，可撤销。").first().waitFor();
    const applied = await until((s) => s.notes[0].lyric?.text === "一", "words applied");
    assert.deepEqual(applied.notes.map((n) => n.lyric?.text ?? ""), ["一", "闪", "一", "闪", "亮", "晶", "晶", ""]);
    assert.deepEqual(applied.chordSymbols, [{ at: 0, symbol: "C" }, { at: 4, symbol: "F" }, { at: 6, symbol: "C" }]);
    await panel.locator("[data-chordpro-report]").filter({ hasText: "还有 1 个音没配到字" }).waitFor();
    const download = page.waitForEvent("download");
    await panel.getByRole("button", { name: "导出 ChordPro（.cho）", exact: true }).click();
    const file = await download;
    assert.equal(file.suggestedFilename().endsWith(".cho"), true);
    const text = await (await import("node:fs/promises")).readFile(await file.path(), "utf8");
    assert.equal(text, "{title: 小星星}\n{key: C}\n{time: 4/4}\n{tempo: 96}\n\n[C]一闪一闪[F]亮晶[C]晶\n");
    await page.getByRole("button", { name: "撤销", exact: true }).click();
    await until((s) => !s.notes.some((n) => n.lyric) && !s.chordSymbols?.length, "one undo step");
    const fits = await panel.evaluate((el) => el.getBoundingClientRect().right <= innerWidth + 0.5 && document.documentElement.scrollWidth <= innerWidth);
    assert.ok(fits, "390: panel fits");
    const small = await panel.evaluate((el) => [...el.querySelectorAll("button")].filter((b) => b.getBoundingClientRect().height < 44).length);
    assert.equal(small, 0, "44 px buttons");
    assert.deepEqual(errors, []);
    await page.close();
    console.log(JSON.stringify({ chordPro: "passed", checks: ["lazy with 歌词", "paste → words + chords", "report", "export .cho", "one undo", "390 fits"] }));
  } finally {
    await browser.close();
  }
}
