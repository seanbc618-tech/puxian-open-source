import assert from "node:assert/strict";
import { encodeSharePayload } from "../src/lib/music/share-link.ts";
import { scrambleIreal } from "../src/lib/music/ireal.ts";

/**
 * r20 iReal Pro chord charts: paste an irealb:// share link into the text-score box, it
 * replaces the score with block chords + chord symbols + repeats, lists what was lost, and is
 * one undo step. The iReal reader is its own chunk, not fetched for other pastes.
 */
export async function verifyIreal(port) {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const score = {
      title: "原谱", bpm: 96, beats: 4, beatUnit: 4, key: "C", mode: "major", clef: "treble", tonicOctave: 4,
      notes: [60, 62, 64, 65].map((p) => ({ pitches: [p], dur: 1 })),
    };
    await page.goto(`http://127.0.0.1:${port}/#s=${encodeSharePayload(score)}`);
    await page.getByRole("button", { name: "在编辑器中打开副本", exact: true }).click();
    const bar = page.getByRole("tablist", { name: "编辑器功能栏" });
    await bar.waitFor();
    assert.equal(await bar.getByRole("tab").count(), 8, "still 8 feature-bar items");
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
      assert.fail(`${label}: ${JSON.stringify((await stored())?.notes?.map((n) => n.pitches))}`);
    };
    await until((s) => s.title === "原谱", "draft saved");
    const irealChunk = () => page.evaluate(() => performance.getEntriesByType("resource").some((e) => /\/assets\/ireal-[\w-]+\.js$/.test(new URL(e.name).pathname)));
    const paste = page.locator("#text-score-paste");
    await paste.fill("%123-1.0\nK:1=C\n1 2 3 4 |");
    await page.getByRole("button", { name: "导入粘贴的文本", exact: true }).click();
    await until((s) => s.notes.length === 4 && s.title !== "原谱", "123 paste imports");
    assert.equal(await irealChunk(), false, "iReal chunk not loaded for a 123 paste");
    const chart = "{*AT44C^7XyQ|A-7XyQ|N1D-7 G7 }XyQXyQ LZN2D-7XyQ|G7XyQ Z<Solo break>";
    const body = `周末布鲁斯=Doe John==Medium Swing=C==1r34LbKcu7${scrambleIreal(chart)}==Jazz-Swing=132=3===小歌单`;
    await paste.fill(`irealb://${encodeURIComponent(body)}`);
    await page.getByRole("button", { name: "导入粘贴的文本", exact: true }).click();
    await page.getByText("已整谱导入iReal Pro 和弦谱。", { exact: true }).waitFor();
    assert.equal(await irealChunk(), true, "iReal chunk loaded on an iReal paste");
    const imported = await until((s) => s.title === "周末布鲁斯", "iReal replaces the score");
    assert.deepEqual([imported.beats, imported.beatUnit, imported.bpm, imported.key], [4, 4, 132, "C"]);
    assert.deepEqual(imported.chordSymbols.map((c) => c.symbol), ["Cmaj7", "Am7", "Dm7", "G7", "Dm7", "G7"]);
    assert.deepEqual(imported.notes[0].pitches, [60, 64, 67, 71], "block chord in voice 1");
    assert.deepEqual(imported.repeats, [{ from: 0, to: 12, ending: 8, endingEnd: 20 }]);
    await page.getByText("iReal 和弦谱会替换整谱：声部 1 写成柱式和弦，和弦名保留为和弦标记").first().waitFor();
    await page.getByText(/注释文字（Solo break）/).first().waitFor();
    // One undo step back to the 123 paste.
    await page.getByRole("button", { name: "撤销", exact: true }).click();
    await until((s) => s.title !== "周末布鲁斯" && s.notes.length === 4, "undo the iReal import");
    // A link that cannot be read leaves the score alone.
    await paste.fill("irealb://%E4%");
    await page.getByRole("button", { name: "导入粘贴的文本", exact: true }).click();
    await page.getByText(/编码不完整/).first().waitFor();
    const after = await stored();
    assert.equal(after.notes.length, 4, "bad link changes nothing");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "390: no sideways scroll");
    assert.deepEqual(errors, []);
    await page.close();
    console.log(JSON.stringify({ ireal: "passed", checks: ["iReal chunk only on demand", "paste link → block chords + symbols + repeats", "loss list", "undo per import", "bad link refused", "390 fits"] }));
  } finally {
    await browser.close();
  }
}
