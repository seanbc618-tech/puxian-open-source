import assert from "node:assert/strict";
import { encodeSharePayload } from "../src/lib/music/share-link.ts";

/**
 * r16 ABC (EasyABC-style text in, sheet out, text back out): paste an ABC tune into the
 * text-score box, it replaces the score with a loss report and one undo step; 打印与导出
 * writes .abc that pastes back to the same notes.
 */
export async function verifyAbc(port) {
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
    const abc = 'X:1\nT:小步舞曲\nM:3/4\nL:1/8\nQ:1/4=108\nK:G\n|:"G"d2 G2 A2|B2 c2 d2|1"D"A6:|2"G"G6|]\nw:都 来 唱 歌 啊 哈 嘿\n';
    // The ABC reader/writer is its own chunk: not fetched until a paste or file is ABC.
    const abcChunk = () => page.evaluate(() => performance.getEntriesByType("resource").some((e) => /\/assets\/abc-[\w-]+\.js$/.test(new URL(e.name).pathname)));
    const paste = page.locator("#text-score-paste");
    await paste.fill("%123-1.0\nK:1=C\n1 2 3 4 |");
    await page.getByRole("button", { name: "导入粘贴的文本", exact: true }).click();
    await until((s) => s.notes.length === 4 && s.title !== "原谱", "123 paste imports");
    assert.equal(await abcChunk(), false, "ABC chunk not loaded for a 123 paste");
    await paste.fill(abc);
    await page.getByRole("button", { name: "导入粘贴的文本", exact: true }).click();
    await page.getByText("已整谱导入ABC。", { exact: true }).waitFor();
    assert.equal(await abcChunk(), true, "ABC chunk loaded on an ABC paste");
    const imported = await until((s) => s.title === "小步舞曲", "ABC replaces the score");
    assert.deepEqual(imported.notes.map((n) => n.pitches[0]), [74, 67, 69, 71, 72, 74, 69, 67]);
    assert.deepEqual([imported.beats, imported.beatUnit, imported.bpm, imported.key], [3, 4, 108, "G"]);
    assert.deepEqual(imported.repeats, [{ from: 0, to: 9, ending: 6, endingEnd: 12 }]);
    assert.deepEqual(imported.chordSymbols.map((c) => c.symbol), ["G", "D", "G"]);
    assert.equal(imported.notes[0].lyric.text, "都");
    await page.getByText("ABC 会替换整谱，只读第一首的第一个声部").first().waitFor();
    await page.getByRole("tab", { name: "打印与导出", exact: true }).click();
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "导出 ABC（.abc）", exact: true }).click();
    const file = await download;
    assert.match(file.suggestedFilename(), /\.abc$/);
    const text = await (await import("node:fs/promises")).readFile(await file.path(), "utf8");
    assert.match(text, /^X:1\nT:小步舞曲\nM:3\/4\nL:1\/8\nQ:1\/4=108\nK:G\n/);
    await page.getByRole("status").filter({ hasText: "ABC 已导出。" }).waitFor();
    // Pasting the export back gives the same music.
    await page.getByRole("tab", { name: "写谱", exact: true }).click();
    await paste.fill(text.replace("T:小步舞曲", "T:导回"));
    await page.getByRole("button", { name: "导入粘贴的文本", exact: true }).click();
    const back = await until((s) => s.title === "导回", "export pastes back");
    for (const field of ["notes", "repeats", "chordSymbols", "beats", "beatUnit", "bpm", "key"]) assert.deepEqual(back[field], imported[field], field);
    // Each import is one undo step.
    await page.getByRole("button", { name: "撤销", exact: true }).click();
    await until((s) => s.title === "小步舞曲", "undo the second import");
    await page.getByRole("button", { name: "撤销", exact: true }).click();
    await until((s) => s.title !== "小步舞曲" && s.notes.length === 4 && s.notes[3].pitches[0] === 65, "undo the ABC import");
    await page.getByRole("button", { name: "撤销", exact: true }).click();
    await until((s) => s.title === "原谱", "undo back to the original");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "390: no sideways scroll");
    assert.deepEqual(errors, []);
    await page.close();
    console.log(JSON.stringify({ abc: "passed", checks: ["ABC chunk only on demand", "paste ABC → score + repeats + chords + lyrics", "loss note", "export .abc", "export pastes back", "undo per import", "390 fits"] }));
  } finally {
    await browser.close();
  }
}
