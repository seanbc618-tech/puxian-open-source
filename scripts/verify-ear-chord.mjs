import assert from "node:assert/strict";
import { encodeSharePayload } from "../src/lib/music/share-link.ts";

/**
 * r31 Teoria-style chord-quality identification inside 听音练耳.
 * Default remains 认级数 so the Functional Ear Trainer and 认音程 asserts stay intact.
 */
export async function verifyEarChord(port) {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript(() => {
      window.earTones = [];
      const Base = window.AudioContext;
      window.AudioContext = class extends Base {
        createOscillator() {
          const osc = super.createOscillator();
          const start = osc.start.bind(osc);
          osc.start = (...a) => {
            window.earTones.push(Math.round(osc.frequency.value));
            return start(...a);
          };
          return osc;
        }
      };
    });
    const score = {
      title: "练耳",
      bpm: 96,
      beats: 4,
      beatUnit: 4,
      key: "C",
      mode: "major",
      clef: "treble",
      tonicOctave: 4,
      notes: [{ pitches: [60], dur: 4 }],
    };
    await page.goto(`http://127.0.0.1:${port}/#s=${encodeSharePayload(score)}`);
    await page.getByRole("button", { name: "在编辑器中打开副本", exact: true }).click();
    const bar = page.getByRole("tablist", { name: "编辑器功能栏" });
    await bar.waitFor();
    assert.equal(await bar.getByRole("tab").count(), 8, "still 8 feature-bar items");
    await page.getByRole("navigation", { name: "播放与编辑" }).getByRole("button", { name: /^练习/ }).click();
    await page.getByRole("button", { name: "听音练耳（先定调，再认级数）", exact: true }).click();
    const ear = page.locator("[data-ear-trainer]");
    await ear.waitFor();
    assert.equal(await ear.getAttribute("data-ear-drill"), "degree");
    assert.equal(await ear.getByRole("radio", { name: "认级数", exact: true }).getAttribute("aria-checked"), "true");

    await ear.getByRole("radio", { name: "认和弦", exact: true }).click();
    assert.equal(await ear.getAttribute("data-ear-drill"), "chord");
    const answers = ear.getByRole("group", { name: "选和弦" }).getByRole("button");
    assert.deepEqual(await answers.allTextContents(), ["大三", "小三", "减三", "增三"]);
    const small = await answers.evaluateAll((els) =>
      els.filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && (r.width < 44 || r.height < 44);
      }).map((el) => (el.textContent ?? "").trim()),
    );
    assert.deepEqual(small, [], "选和弦 buttons must stay 44px");
    assert.equal(await answers.first().isDisabled(), true, "no answers before a question");

    await page.evaluate(() => { Math.random = () => 0; window.earTones = []; });
    await ear.getByRole("button", { name: "开始练耳", exact: true }).click();
    await ear.locator("[data-ear-status]").filter({ hasText: "听好了：几个音一起响" }).waitFor();
    const tones = await page.evaluate(() => window.earTones.slice());
    assert.deepEqual(tones, [262, 330, 392], "block C major triad from C4");
    await ear.getByRole("button", { name: "小三和弦", exact: true }).click();
    await ear.locator("[data-ear-status]").filter({ hasText: "不是 小三和弦，再听听" }).waitFor();
    await ear.getByRole("button", { name: "大三和弦", exact: true }).click();
    await ear.locator("[data-ear-status]").filter({ hasText: "对了：大三和弦。" }).waitFor();
    assert.deepEqual(
      await page.evaluate(() => JSON.parse(localStorage.getItem("puxian-ear-chord-v1"))),
      { maj: { right: 0, total: 1 } },
    );
    assert.equal(await page.evaluate(() => localStorage.getItem("puxian-ear-v1")), null, "degree stats stay untouched");
    assert.equal(await page.evaluate(() => localStorage.getItem("puxian-ear-interval-v1")), null, "interval stats stay untouched");

    await page.evaluate(() => { window.earTones = []; });
    await ear.getByRole("button", { name: "下一题", exact: true }).click();
    await ear.getByRole("button", { name: "小三和弦", exact: true }).click();
    await ear.locator("[data-ear-status]").filter({ hasText: "答对了：小三和弦。" }).waitFor();
    assert.match(await ear.locator("[data-ear-summary]").textContent(), /^本次 1\/2 一次答对。和弦累计 2 题/);

    await ear.getByRole("radio", { name: "分解", exact: true }).click();
    await page.evaluate(() => { window.earTones = []; });
    await ear.getByRole("button", { name: "再听一次", exact: true }).click();
    await page.waitForFunction(() => window.earTones.length >= 3);
    const broken = await page.evaluate(() => window.earTones.slice(-3));
    assert.deepEqual(broken, [262, 311, 392], "arpeggio replay keeps the written minor triad");

    await ear.getByRole("radio", { name: "认级数", exact: true }).click();
    assert.equal(await ear.getAttribute("data-ear-drill"), "degree");
    assert.equal(await ear.getByRole("group", { name: "选级数" }).count(), 1);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "390: no sideways scroll");
    assert.deepEqual(errors, []);
    await page.close();
    console.log(JSON.stringify({
      earChord: "passed",
      checks: ["8 tabs", "default 认级数", "认和弦 大三 then 小三", "degree/interval stats untouched", "arpeggio replay", "390 44px"],
    }));
  } finally {
    await browser.close();
  }
}
