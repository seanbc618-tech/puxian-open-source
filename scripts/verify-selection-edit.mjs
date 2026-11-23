import assert from "node:assert/strict";
import { encodeSharePayload } from "../src/lib/music/share-link.ts";

/**
 * r15 选段编辑 (Sibelius-style): pick a bar, 重复一遍 / R repeats it after itself (chord
 * symbols follow), ↑/↓ moves it a scale step, Ctrl+↑/↓ an octave, 改成休止 keeps the rhythm,
 * and each edit is one undo step. Buttons work on a phone, keys on a computer.
 */
export async function verifySelectionEdit(port) {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    for (const [name, viewport] of [["phone", { width: 390, height: 844 }], ["desktop", { width: 1280, height: 800 }]]) {
      const page = await browser.newPage({ viewport });
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      const score = {
        title: "选段编辑", bpm: 96, beats: 4, beatUnit: 4, key: "C", mode: "major", clef: "treble", tonicOctave: 4,
        notes: [60, 62, 64, 65, 67, 69, 71, 72].map((p) => ({ pitches: [p], dur: 1 })),
        chordSymbols: [{ at: 0, symbol: "C" }, { at: 4, symbol: "G" }],
      };
      await page.goto(`http://127.0.0.1:${port}/#s=${encodeSharePayload(score)}`);
      await page.getByRole("button", { name: "在编辑器中打开副本", exact: true }).click();
      const bar = page.getByRole("tablist", { name: "编辑器功能栏" });
      await bar.waitFor();
      assert.equal(await bar.getByRole("tab").count(), 8, "still 8 feature-bar items");
      await page.getByRole("button", { name: "简谱", exact: true }).click();
      await bar.getByRole("tab", { name: "表情记号", exact: true }).click();
      const group = page.getByRole("group", { name: "选段编辑" });
      await group.waitFor();
      assert.equal(await group.getByRole("button", { name: "重复一遍", exact: true }).isDisabled(), true, "nothing selected yet");
      const stored = () => page.evaluate(() => {
        const raw = JSON.parse(localStorage.getItem("puxian-score-v1") ?? "null");
        return raw?.notes ? raw : raw?.score;
      });
      const pitches = async () => (await stored()).notes.map((n) => n.pitches[0] ?? 0);
      const until = async (expected, label) => {
        for (let i = 0; i < 60; i += 1) {
          if (JSON.stringify(await pitches()) === JSON.stringify(expected)) return;
          await page.waitForTimeout(100);
        }
        assert.deepEqual(await pitches(), expected, label);
      };
      const pick = (i) => page.locator(".score-stage .jianpu-note-target").nth(i).click({ force: true });
      await page.getByRole("button", { name: "选一段", exact: true }).click();
      await pick(0);
      await pick(3);
      await group.getByRole("button", { name: "重复一遍", exact: true }).click();
      await until([60, 62, 64, 65, 60, 62, 64, 65, 67, 69, 71, 72], `${name}: bar 1 repeated after itself`);
      assert.deepEqual((await stored()).chordSymbols, [{ at: 0, symbol: "C" }, { at: 4, symbol: "C" }, { at: 8, symbol: "G" }], "chord symbols follow");
      await page.getByText("已重复一遍（4 个音），新的一遍已选中", { exact: false }).first().waitFor();
      if (name === "desktop") {
        await page.keyboard.press("ArrowUp");
        await until([60, 62, 64, 65, 62, 64, 65, 67, 67, 69, 71, 72], "↑ moves the new copy a scale step");
        await page.keyboard.press("Control+ArrowDown");
        await until([60, 62, 64, 65, 50, 52, 53, 55, 67, 69, 71, 72], "Ctrl+↓ an octave");
        await page.keyboard.press("r");
        await until([60, 62, 64, 65, 50, 52, 53, 55, 50, 52, 53, 55, 67, 69, 71, 72], "R repeats again");
        await page.keyboard.press("Control+z");
        await until([60, 62, 64, 65, 50, 52, 53, 55, 67, 69, 71, 72], "one undo step per edit");
        // Keys never fire while typing.
        const title = page.getByRole("textbox", { name: "曲名" });
        await title.focus();
        await page.keyboard.press("ArrowUp");
        await page.waitForTimeout(300);
        assert.deepEqual(await pitches(), [60, 62, 64, 65, 50, 52, 53, 55, 67, 69, 71, 72]);
      } else {
        await group.getByRole("button", { name: "上移一级", exact: true }).click();
        await until([60, 62, 64, 65, 62, 64, 65, 67, 67, 69, 71, 72], "上移一级");
        await group.getByRole("button", { name: "高八度", exact: true }).click();
        await until([60, 62, 64, 65, 74, 76, 77, 79, 67, 69, 71, 72], "高八度");
        await group.getByRole("button", { name: "改成休止", exact: true }).click();
        await until([60, 62, 64, 65, 0, 0, 0, 0, 67, 69, 71, 72], "改成休止");
        assert.deepEqual((await stored()).notes.slice(4, 8).map((n) => n.dur), [1, 1, 1, 1], "rhythm kept");
        await group.getByRole("button", { name: "改成休止", exact: true }).click();
        await page.getByText("选中的已经是休止。", { exact: true }).waitFor();
        const small = await group.evaluate((el) => [...el.querySelectorAll("button")].filter((b) => {
          const r = b.getBoundingClientRect();
          return r.width < 44 || r.height < 44;
        }).length);
        assert.equal(small, 0, "390: selection buttons are 44 px targets");
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "390: no sideways scroll");
      }
      assert.deepEqual(errors, []);
      await page.close();
    }
    console.log(JSON.stringify({ selectionEdit: "passed", checks: ["重复一遍 + chord symbols", "↑ scale step", "Ctrl+↓ octave", "R again", "undo", "keys ignored while typing", "改成休止", "390 targets"] }));
  } finally {
    await browser.close();
  }
}
