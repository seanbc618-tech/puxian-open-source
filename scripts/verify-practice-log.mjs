import assert from "node:assert/strict";
import { encodeSharePayload } from "../src/lib/music/share-link.ts";
const FOLDED_MAX = 1300;

/**
 * r10: 练琴记录 (goal, week bars, streak, timed while playing), lazy chunks retried after a
 * dropped fetch, and full-screen page turns that never hide a line under the sticky chord guide.
 */
export async function verifyPracticeLog(port) {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  const origin = `http://127.0.0.1:${port}`;
  const melody = (length) => Array.from({ length }, (_, i) => ({ pitches: [67 + [0, 2, 4, 5, 7, 5, 4, 2][i % 8]], dur: 1 }));
  const chords = (bars) => Array.from({ length: bars }, (_, i) => ({ at: i * 4, symbol: ["G", "D", "Em", "C", "Am", "D7", "C", "Bm"][i % 8] }));
  try {
    // 1) A dropped editor chunk is fetched again instead of leaving 「正在打开乐谱…」 forever.
    {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      let editorFetches = 0;
      await page.route(/\/assets\/staffline-app-[^/]+\.js$/, (route) => {
        editorFetches += 1;
        return editorFetches === 1 ? route.abort("connectionreset") : route.continue();
      });
      await page.goto(`${origin}/`);
      await page.getByRole("heading", { name: "让旋律，落在纸上。" }).waitFor();
      // A DOM click: no pointer / key events, so the idle prefetch does not fetch the chunk first.
      await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("新建空白谱"))?.click());
      await page.getByRole("textbox", { name: "曲名" }).waitFor();
      assert.equal(editorFetches, 2, "editor chunk: dropped once, fetched again");
      // Inside the editor: the 练琴记录 card's chunk drops once and still opens.
      let cardFetches = 0;
      await page.route(/\/assets\/practice-log-card-[^/]+\.js$/, (route) => {
        cardFetches += 1;
        return cardFetches === 1 ? route.abort("connectionreset") : route.continue();
      });
      await page.getByRole("navigation", { name: "播放与编辑" }).getByRole("button", { name: /^练习/ }).click();
      await page.locator("[data-practice-log]").waitFor();
      assert.equal(cardFetches, 2, "practice log chunk: dropped once, fetched again");
      assert.equal(await page.locator("[data-app-error]").count(), 0);
      assert.deepEqual(errors, []);
      await page.close();
    }

    // 2) 练琴记录: seeded days read back as goal progress, week bars and a streak; playing adds time.
    {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
      const score = { title: "练琴记录", bpm: 240, beats: 4, beatUnit: 4, key: "C", mode: "major", clef: "treble", tonicOctave: 4, notes: melody(64) };
      await page.addInitScript(() => {
        if (sessionStorage.getItem("seeded")) return;
        sessionStorage.setItem("seeded", "1");
        const key = (offset) => {
          const d = new Date();
          d.setDate(d.getDate() + offset);
          return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        };
        localStorage.setItem("puxian-practice-log-v1", JSON.stringify({ goal: 10, days: { [key(-1)]: 600, [key(0)]: 240 } }));
      });
      await page.goto(`${origin}/#s=${encodeSharePayload(score)}`);
      await page.getByRole("button", { name: "在编辑器中打开副本", exact: true }).click();
      await page.getByRole("navigation", { name: "播放与编辑" }).getByRole("button", { name: /^练习/ }).click();
      const card = page.locator("[data-practice-log]");
      await card.waitFor();
      const summary = card.locator(".practice-log-summary");
      assert.equal(await summary.textContent(), "今天已练 4 分钟，离每日目标 10 分钟还差 6 分钟；已连续练习 2 天。");
      assert.equal(await card.getByRole("progressbar", { name: "今日目标进度" }).getAttribute("aria-valuenow"), "4");
      assert.equal(await card.getByRole("list", { name: "最近 7 天练习时长" }).getByRole("listitem").count(), 7);
      assert.equal(await card.getByRole("list", { name: "最近 7 天练习时长" }).getByRole("listitem").last().getAttribute("aria-label"), "今天 4 分钟");
      // r16: below the week chart the card starts folded; the goal, note and clear sit inside.
      const more = card.locator("[data-practice-log-more]");
      assert.equal(await more.evaluate((d) => d.open), false, "card folded below the week chart");
      assert.equal(await card.getByLabel("每日练琴目标").isVisible(), false);
      await more.locator("summary").click();
      await card.getByLabel("每日练琴目标").selectOption("0");
      assert.equal(await summary.textContent(), "今天已练 4 分钟；已连续练习 2 天。");
      assert.equal(await card.getByRole("progressbar").count(), 0, "no goal, no meter");
      await card.getByLabel("每日练琴目标").selectOption("5");
      assert.equal(await summary.textContent(), "今天已练 4 分钟，离每日目标 5 分钟还差 1 分钟；已连续练习 2 天。");
      const todaySeconds = () => page.evaluate(() => {
        const d = new Date();
        const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        return JSON.parse(localStorage.getItem("puxian-practice-log-v1")).days[k];
      });
      assert.equal(await todaySeconds(), 240);
      const transport = page.getByRole("navigation", { name: "播放与编辑" });
      await transport.getByRole("button", { name: "播放", exact: true }).click();
      await summary.filter({ hasText: "正在计时，停下后记入。" }).waitFor();
      await page.waitForTimeout(2500);
      await transport.getByRole("button", { name: "停止", exact: true }).click();
      await summary.filter({ hasNotText: "正在计时" }).waitFor();
      const after = await todaySeconds();
      assert.ok(after >= 242 && after <= 250, `playing ~2.5 s adds that much (got ${after - 240} s)`);
      assert.equal(JSON.parse(await page.evaluate(() => localStorage.getItem("puxian-practice-log-v1"))).goal, 5, "goal kept");
      // r11 (Andante-style): time per song, a note per song, the standalone metronome counts, 清空 asks first.
      const songLine = card.locator("[data-song-summary]");
      // Autosave may give the draft its id just after the stop; the title-keyed time moves over to it.
      await songLine.filter({ hasText: "累计" }).waitFor();
      assert.match(await songLine.textContent(), /^这首曲子：累计 不到 1 分钟 · 上次 \d+月\d+日$/);
      const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem("puxian-practice-log-v1")));
      const songs = Object.values((await stored()).songs);
      assert.equal(songs.length, 1);
      assert.equal(songs[0].title, "练琴记录");
      const beforeMetro = await todaySeconds();
      await page.getByRole("button", { name: /^独立节拍器/ }).click();
      await page.getByRole("button", { name: "开始节拍器", exact: true }).click();
      await summary.filter({ hasText: "正在计时，停下后记入。" }).waitFor();
      await page.waitForTimeout(2200);
      await page.getByRole("button", { name: "停止节拍器", exact: true }).click();
      await summary.filter({ hasNotText: "正在计时" }).waitFor();
      const metroAdded = (await todaySeconds()) - beforeMetro;
      assert.ok(metroAdded >= 2 && metroAdded <= 8, `standalone metronome counts (${metroAdded} s)`);
      await page.getByRole("button", { name: "收起节拍器", exact: true }).click();
      const noteBox = card.getByLabel("这首的练习笔记");
      await noteBox.fill("第 3 小节换气太急");
      await noteBox.blur();
      await card.locator("[data-log-notice]").filter({ hasText: "笔记已存在本机。" }).waitFor();
      assert.equal(Object.values((await stored()).songs)[0].note, "第 3 小节换气太急");
      // An edit still in the box when the panel closes is kept too.
      await noteBox.fill("第 3 小节换气太急，慢练");
      const practiceButton = page.getByRole("navigation", { name: "播放与编辑" }).getByRole("button", { name: /^练习/ });
      await practiceButton.click();
      await card.waitFor({ state: "detached" });
      assert.equal(Object.values((await stored()).songs)[0].note, "第 3 小节换气太急，慢练", "note saved when the panel closes");
      await practiceButton.click();
      await card.waitFor();
      assert.equal(await more.evaluate((d) => d.open), true, "the fold stays open after reopening the panel");
      assert.equal(await card.getByLabel("这首的练习笔记").inputValue(), "第 3 小节换气太急，慢练");
      await card.getByRole("button", { name: "清空记录", exact: true }).click();
      await card.getByText("将清空本机的练琴时长、连续天数、练耳时长和每首的笔记，每日目标保留。", { exact: true }).waitFor();
      await card.getByRole("button", { name: "取消", exact: true }).click();
      assert.ok((await todaySeconds()) > 240, "cancel keeps the log");
      await card.getByRole("button", { name: "清空记录", exact: true }).click();
      await card.getByRole("button", { name: "确认清空", exact: true }).click();
      await card.locator("[data-log-notice]").filter({ hasText: "练琴记录已清空。" }).waitFor();
      assert.deepEqual(await stored(), { goal: 5, days: {} }, "cleared; the goal stays");
      assert.equal(await summary.textContent(), "今天已练 0 分钟，离每日目标 5 分钟还差 5 分钟；今天练满 1 分钟就开始连续打卡。");
      assert.equal(await songLine.textContent(), "这首曲子还没有练琴记录。");
      assert.equal(await card.getByLabel("这首的练习笔记").inputValue(), "");
      const fits = await card.evaluate((el) => el.getBoundingClientRect().right <= innerWidth + 0.5 && document.documentElement.scrollWidth <= innerWidth);
      assert.ok(fits, "390: card fits");
      // r15: at 390 the four tools sit in a 2 × 2 grid, a one-voice mixer folds to one line, and the
      // whole panel (everything closed) stays well under the old 1956 px.
      const kit = await page.locator("[data-practice-kit] .practice-kit-grid > button").evaluateAll((buttons) => buttons.map((b) => {
        const r = b.getBoundingClientRect();
        return { left: Math.round(r.left), top: Math.round(r.top), h: r.height, w: r.width };
      }));
      assert.equal(kit.length, 4);
      assert.equal(new Set(kit.map((b) => b.top)).size, 2, "two rows");
      assert.equal(new Set(kit.map((b) => b.left)).size, 2, "two columns");
      assert.ok(kit.every((b) => b.h >= 44 && b.w >= 44), "44 px targets");
      assert.equal(await page.locator("[data-mixer-folded]").count(), 1, "one untouched voice: mixer folded");
      const panelHeight = await card.evaluate((el) => el.parentElement.getBoundingClientRect().height);
      assert.ok(panelHeight <= 1700, `390: practice panel ${Math.round(panelHeight)} px (was 1956)`);
      // r16: fold the card below the week chart and 渐进加速 too; the panel shrinks again.
      await more.locator("summary").click();
      const speedFold = page.locator("[data-speed-training]");
      assert.equal(await speedFold.evaluate((d) => d.open), false, "渐进加速 folded by default");
      assert.equal(await page.getByLabel("起始速度（%）", { exact: true }).isVisible(), false);
      const summaryBoxes = await page.locator("[data-practice-log-more] > summary, [data-speed-training] > summary").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
      assert.ok(summaryBoxes.length === 2 && summaryBoxes.every((h) => h >= 44), `fold headers are 44 px targets (${summaryBoxes})`);
      const foldedHeight = await card.evaluate((el) => el.parentElement.getBoundingClientRect().height);
      assert.ok(foldedHeight <= FOLDED_MAX, `390: folded practice panel ${Math.round(foldedHeight)} px (r15 was 1628)`);
      await speedFold.locator("summary").click();
      await page.getByRole("button", { name: "开启渐进加速", exact: true }).waitFor();
      await speedFold.locator("summary").click();
      await page.getByRole("button", { name: "展开混音台", exact: true }).click();
      await page.getByLabel("声部一音量", { exact: true }).waitFor();
      await page.close();
    }

    // 2b) r12 听音练耳 (Functional Ear Trainer idea): cadence + one note, answer by 简谱 degree.
    {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
      await page.addInitScript(() => {
        window.earTones = [];
        window.earContexts = [];
        const Base = window.AudioContext;
        window.AudioContext = class extends Base {
          constructor(...args) { super(...args); window.earContexts.push(this); }
          createOscillator() {
            const osc = super.createOscillator();
            const start = osc.start.bind(osc);
            osc.start = (...a) => { window.earTones.push(Math.round(osc.frequency.value)); return start(...a); };
            return osc;
          }
        };
      });
      const score = { title: "练耳", bpm: 96, beats: 4, beatUnit: 4, key: "G", mode: "major", clef: "treble", tonicOctave: 4, notes: melody(8) };
      await page.goto(`${origin}/#s=${encodeSharePayload(score)}`);
      await page.getByRole("button", { name: "在编辑器中打开副本", exact: true }).click();
      await page.getByRole("navigation", { name: "播放与编辑" }).getByRole("button", { name: /^练习/ }).click();
      await page.getByRole("button", { name: "听音练耳（先定调，再认级数）", exact: true }).click();
      const ear = page.locator("[data-ear-trainer]");
      await ear.waitFor();
      assert.match(await ear.locator(".tool-group-title").textContent(), /G 大调/);
      const status = ear.locator("[data-ear-status]");
      const answers = ear.getByRole("group", { name: "选级数" }).getByRole("button");
      assert.deepEqual(await answers.allTextContents(), ["1", "2", "3", "4"]);
      assert.equal(await answers.first().isDisabled(), true, "no answers before a question");
      await page.evaluate(() => { Math.random = () => 0; });
      await ear.getByRole("button", { name: "开始练耳", exact: true }).click();
      await status.filter({ hasText: "听好了" }).waitFor();
      const tones = await page.evaluate(() => window.earTones.slice());
      assert.equal(tones.length, 17, "four cadence chords of four notes, then the question");
      assert.deepEqual(tones.slice(0, 4), [196, 392, 494, 587], "G major cadence starts on G");
      assert.equal(tones.at(-1), 392, "question: degree 1 in G");
      assert.equal(await ear.getByRole("button", { name: "下一题", exact: true }).isDisabled(), true, "answer first");
      await ear.getByRole("button", { name: "级数 2", exact: true }).click();
      await status.filter({ hasText: "不是 2，再听听" }).waitFor();
      await ear.getByRole("button", { name: "级数 1", exact: true }).click();
      await status.filter({ hasText: "对了：1。回到主音：1" }).waitFor();
      assert.equal(await ear.locator("[data-ear-summary]").textContent(), "本次 0/1 一次答对。累计 1 题，一次答对 0%；最常错的是 1（0/1）。");
      assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem("puxian-ear-v1"))), { 1: { right: 0, total: 1 } });
      await ear.getByRole("button", { name: "下一题", exact: true }).click();
      await ear.getByRole("button", { name: "级数 2", exact: true }).click();
      await status.filter({ hasText: "答对了：2。回到主音：2 1" }).waitFor();
      const walk = await page.evaluate(() => window.earTones.slice(-2));
      assert.deepEqual(walk, [440, 392], "2 walks home to 1");
      assert.match(await ear.locator("[data-ear-summary]").textContent(), /^本次 1\/2 一次答对。累计 2 题，一次答对 50%/);
      await ear.getByRole("radio", { name: "5 6 7 1̇", exact: true }).click();
      assert.deepEqual(await answers.allTextContents(), ["5", "6", "7", "1̇"]);
      await status.filter({ hasText: "听好了" }).waitFor();
      assert.equal(await page.evaluate(() => window.earTones.at(-1)), 587, "upper level asks 5 (D) in G");
      const fits = await ear.evaluate((el) => el.getBoundingClientRect().right <= innerWidth + 0.5 && document.documentElement.scrollWidth <= innerWidth);
      assert.ok(fits, "390: ear trainer fits");
      // r13: ear practice counts toward the day, on its own 练耳 line (not this song).
      const card = page.locator("[data-practice-log]");
      await card.locator(".practice-log-summary").filter({ hasText: "正在计时，停下后记入。" }).waitFor();
      await page.waitForTimeout(1500);
      await ear.getByRole("button", { name: "收起练耳", exact: true }).click();
      await page.waitForFunction(() => window.earContexts.length > 0 && window.earContexts.every((c) => c.state === "closed"));
      if (!(await card.locator("[data-practice-log-more]").evaluate((d) => d.open))) await card.locator("[data-practice-log-more] > summary").click();
      await card.locator("[data-ear-time]").waitFor();
      assert.match(await card.locator("[data-ear-time]").textContent(), /^听音练耳累计 不到 1 分钟（算进每天时长，不记到曲子）$/);
      const earLog = await page.evaluate(() => JSON.parse(localStorage.getItem("puxian-practice-log-v1")));
      assert.ok(earLog.ear >= 1 && earLog.ear <= 30, `ear seconds banked (${earLog.ear})`);
      assert.equal(Object.values(earLog.days).reduce((a, b) => a + b, 0), earLog.ear, "the day total includes the ear time");
      assert.equal(earLog.songs, undefined, "not credited to the open song");
      await page.close();
    }

    // 2c) r13 拍节奏 (Complete Rhythm Trainer idea): count-in, tap the written rhythm, per-note 准/早/晚/漏.
    {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
      await page.addInitScript(() => {
        window.rhythmClicks = [];
        window.rhythmContexts = [];
        const Base = window.AudioContext;
        window.AudioContext = class extends Base {
          constructor(...args) { super(...args); window.rhythmContexts.push(this); }
          createOscillator() {
            const osc = super.createOscillator();
            const start = osc.start.bind(osc);
            osc.start = (...a) => { window.rhythmClicks.push(Math.round(osc.frequency.value)); return start(...a); };
            return osc;
          }
        };
      });
      const n = (dur, rest = false) => ({ pitches: rest ? [] : [67], dur });
      // ♩=120, two bars: 1 1 2 | ½ ½ 1 (rest 1) 1 → taps due at 0 .5 1 | 2 2.25 2.5 3.5 s.
      const score = { title: "拍节奏", bpm: 120, beats: 4, beatUnit: 4, key: "C", mode: "major", clef: "treble", tonicOctave: 4,
        notes: [n(1), n(1), n(2), n(0.5), n(0.5), n(1), n(1, true), n(1)] };
      await page.goto(`${origin}/#s=${encodeSharePayload(score)}`);
      await page.getByRole("button", { name: "在编辑器中打开副本", exact: true }).click();
      await page.getByRole("navigation", { name: "播放与编辑" }).getByRole("button", { name: /^练习/ }).click();
      await page.getByRole("button", { name: "拍节奏（跟着节拍点按）", exact: true }).click();
      const tapper = page.locator("[data-rhythm-tapper]");
      await tapper.waitFor();
      assert.equal(await tapper.locator(".tool-group-title > span").textContent(), "第 1–2 小节 · 7 个音 · 100%");
      const pad = tapper.locator("[data-rhythm-pad]");
      assert.equal(await pad.isDisabled(), true, "pad waits for the start");
      await tapper.getByRole("button", { name: "开始拍节奏", exact: true }).click();
      await pad.and(page.locator("[data-rhythm-start]")).waitFor();
      assert.deepEqual(JSON.parse(await pad.getAttribute("data-rhythm-targets")), [0, 0.5, 1, 2, 2.25, 2.5, 3.5]);
      // On time, on time, 150 ms late, (skip), on time ×3, and one stray tap at 3 s.
      await pad.evaluate((el) => {
        const start = Number(el.dataset.rhythmStart);
        for (const at of [0, 0.5, 1.15, 2.25, 2.5, 3, 3.5]) {
          setTimeout(() => el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })), start + at * 1000 - performance.now());
        }
      });
      const summary = tapper.locator("[data-rhythm-summary]");
      await summary.waitFor({ timeout: 15_000 });
      assert.match(await summary.textContent(), /^准 5 · 偏早 0 · 偏晚 1 · 漏拍 1 · 多拍 1；/);
      assert.deepEqual((await tapper.getByRole("list", { name: "每个音的结果" }).getByRole("listitem").allTextContents()).map((t) => t.split(" ")[0]),
        ["准", "准", "偏晚", "漏拍", "准", "准", "准"]);
      assert.equal(await tapper.locator("[data-rhythm-weak]").textContent(), "要再练：第 1、2 小节（可在上面设成 A-B 段落）。");
      assert.equal(await tapper.locator(".rhythm-lane circle").count(), 7, "six matched taps and one stray");
      const clicks = await page.evaluate(() => window.rhythmClicks.slice());
      assert.equal(clicks.length, 12, "one bar of count-in, then two bars of beats");
      assert.deepEqual(clicks.slice(0, 5), [1500, 1000, 1000, 1000, 1500]);
      assert.equal(await page.evaluate(() => window.rhythmContexts.every((c) => c.state === "closed")), true, "audio closed after the run");
      // Tapping is practice on this song.
      const log = await page.evaluate(() => JSON.parse(localStorage.getItem("puxian-practice-log-v1")));
      const songs = Object.values(log.songs ?? {});
      assert.equal(songs.length, 1);
      assert.equal(songs[0].title, "拍节奏");
      assert.ok(songs[0].seconds >= 4 && songs[0].seconds <= 12, `rhythm run timed on the song (${songs[0].seconds} s)`);
      assert.equal(await tapper.getByRole("button", { name: "再拍一次", exact: true }).isEnabled(), true);
      // r14 延迟补偿: manual ±10 ms steps are saved; 点按校准 measures a steady 200 ms lag.
      const latency = tapper.getByLabel("延迟补偿毫秒");
      assert.equal(await latency.textContent(), "0 毫秒");
      for (let i = 0; i < 3; i += 1) await tapper.getByRole("button", { name: "延迟补偿加 10 毫秒", exact: true }).click();
      assert.equal(await latency.textContent(), "30 毫秒");
      assert.equal(await page.evaluate(() => localStorage.getItem("puxian-rhythm-latency-v1")), "30");
      await tapper.getByRole("button", { name: "延迟补偿减 10 毫秒", exact: true }).click();
      assert.equal(await latency.textContent(), "20 毫秒");
      await tapper.getByRole("button", { name: "点按校准", exact: true }).click();
      await pad.and(page.locator("[data-rhythm-calibrating]")).waitFor();
      await pad.evaluate((el) => {
        const start = Number(el.dataset.rhythmStart);
        for (let i = 0; i < 8; i += 1) {
          setTimeout(() => el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })), start + i * 600 + 200 - performance.now());
        }
      });
      const calibration = tapper.locator("[data-rhythm-calibration]");
      await calibration.waitFor({ timeout: 15_000 });
      const measured = Number((await calibration.textContent()).match(/^已校准：延迟补偿 (\d+) 毫秒，存在本机。$/)?.[1]);
      assert.ok(measured >= 180 && measured <= 230, `calibration finds ~200 ms (${measured})`);
      assert.equal(await page.evaluate(() => localStorage.getItem("puxian-rhythm-latency-v1")), String(measured));
      assert.equal(await latency.textContent(), `${measured} 毫秒`);
      // Every tap 200 ms late now grades 准.
      await tapper.getByRole("button", { name: "再拍一次", exact: true }).click();
      await pad.and(page.locator("[data-rhythm-targets]")).waitFor();
      await pad.evaluate((el) => {
        const start = Number(el.dataset.rhythmStart);
        for (const at of JSON.parse(el.dataset.rhythmTargets)) {
          setTimeout(() => el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })), start + at * 1000 + 200 - performance.now());
        }
      });
      await summary.filter({ hasText: "准 7 · 偏早 0 · 偏晚 0 · 漏拍 0 · 多拍 0" }).waitFor({ timeout: 15_000 });
      // A short calibration with too few taps keeps the saved value.
      await tapper.getByRole("button", { name: "点按校准", exact: true }).click();
      await calibration.filter({ hasText: "点得太少，没校准成" }).waitFor({ timeout: 15_000 });
      assert.equal(await latency.textContent(), `${measured} 毫秒`);
      // r26 Rhythm Randomizer: a generated 2-bar drill, independent of the written notes.
      const writtenTargets = [0, 0.5, 1, 2, 2.25, 2.5, 3.5];
      const quizGroup = tapper.getByRole("radiogroup", { name: "拍节奏题目" });
      await quizGroup.getByRole("button", { name: "随机题", exact: true }).click();
      const quizRow = tapper.locator("[data-rhythm-quiz]");
      await quizRow.waitFor();
      const firstQuiz = await quizRow.getAttribute("data-rhythm-quiz");
      assert.match(firstQuiz ?? "", /拍/);
      assert.equal(await quizRow.getAttribute("data-rhythm-quiz-seed"), "1");
      assert.match(await tapper.locator(".tool-group-title > span").textContent(), /^随机题 · 2 小节 · \d+ 个音 · 100%$/);
      const smallQuiz = await tapper.evaluate((el) =>
        [...el.querySelectorAll('[aria-label="拍节奏题目"] button, button')]
          .filter((btn) => /^(按谱拍|随机题|换一题)$/.test((btn.textContent ?? "").trim()))
          .filter((btn) => {
            const r = btn.getBoundingClientRect();
            return r.width > 0 && r.height > 0 && (r.width < 44 || r.height < 44);
          })
          .map((btn) => (btn.textContent ?? "").trim()),
      );
      assert.deepEqual(smallQuiz, [], "quiz mode targets stay 44px");
      await tapper.getByRole("button", { name: "换一题", exact: true }).click();
      assert.equal(await quizRow.getAttribute("data-rhythm-quiz-seed"), "2");
      await tapper.getByRole("button", { name: "开始拍节奏", exact: true }).click();
      await pad.and(page.locator("[data-rhythm-targets]")).waitFor();
      const quizTargets = JSON.parse(await pad.getAttribute("data-rhythm-targets"));
      assert.ok(Array.isArray(quizTargets) && quizTargets.length >= 4, `quiz has enough notes: ${JSON.stringify(quizTargets)}`);
      assert.notDeepEqual(quizTargets, writtenTargets, "random drill must not reuse the written rhythm");
      await pad.evaluate((el) => {
        const start = Number(el.dataset.rhythmStart);
        for (const at of JSON.parse(el.dataset.rhythmTargets)) {
          setTimeout(() => el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })), start + at * 1000 + 200 - performance.now());
        }
      });
      await summary.filter({ hasText: /准 \d+ · 偏早 0 · 偏晚 0 · 漏拍 0 · 多拍 0/ }).waitFor({ timeout: 15_000 });
      await quizGroup.getByRole("button", { name: "按谱拍", exact: true }).click();
      assert.equal(await tapper.locator(".tool-group-title > span").textContent(), "第 1–2 小节 · 7 个音 · 100%");
      const fits = await tapper.evaluate((el) => el.getBoundingClientRect().right <= innerWidth + 0.5 && document.documentElement.scrollWidth <= innerWidth);
      assert.ok(fits, "390: rhythm tapper fits");
      await page.close();
    }

    // 2d) r14 持续音 (Tonal Energy idea): key-following drone, root + fifth / triad, 纯律 option.
    {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
      await page.addInitScript(() => {
        window.droneSets = [];
        window.droneContexts = [];
        const Base = window.AudioContext;
        window.AudioContext = class extends Base {
          constructor(...args) {
            super(...args);
            window.droneContexts.push(this);
            this.tones = [];
            window.droneSets.push(this.tones);
          }
          createOscillator() {
            const osc = super.createOscillator();
            const start = osc.start.bind(osc);
            osc.start = (...a) => { this.tones.push(Math.round(osc.frequency.value * 10) / 10); return start(...a); };
            return osc;
          }
        };
      });
      const score = { title: "持续音", bpm: 240, beats: 4, beatUnit: 4, key: "G", mode: "major", clef: "treble", tonicOctave: 4, notes: melody(32) };
      await page.goto(`${origin}/#s=${encodeSharePayload(score)}`);
      await page.getByRole("button", { name: "在编辑器中打开副本", exact: true }).click();
      await page.getByRole("navigation", { name: "播放与编辑" }).getByRole("button", { name: /^练习/ }).click();
      await page.getByRole("button", { name: "持续音（对着长音练音准）", exact: true }).click();
      const drone = page.locator("[data-drone]");
      await drone.waitFor();
      assert.match(await drone.locator(".tool-group-title").textContent(), /G 大调/);
      const last = () => page.evaluate(() => window.droneSets.at(-1));
      const open = () => page.evaluate(() => window.droneContexts.filter((c) => c.state !== "closed").length);
      await drone.getByRole("button", { name: "开始持续音", exact: true }).click();
      await page.waitForFunction(() => window.droneSets.length === 1 && window.droneSets[0].length === 4);
      // r15 (Sean): drone time counts on this song, like the standalone metronome — and one clock
      // runs when both sound at once.
      const practiceSummary = page.locator("[data-practice-log] .practice-log-summary");
      await practiceSummary.filter({ hasText: "正在计时，停下后记入。" }).waitFor();
      await page.getByRole("button", { name: "独立节拍器（不播谱练拍子）", exact: true }).click();
      await page.getByRole("button", { name: "开始节拍器", exact: true }).click();
      await page.waitForTimeout(2200);
      await page.getByRole("button", { name: "停止节拍器", exact: true }).click();
      await page.getByRole("button", { name: "收起节拍器", exact: true }).click();
      await drone.getByRole("button", { name: "停止持续音", exact: true }).click();
      await practiceSummary.filter({ hasNotText: "正在计时" }).waitFor();
      const droneLog = await page.evaluate(() => JSON.parse(localStorage.getItem("puxian-practice-log-v1")));
      const droneSong = Object.values(droneLog.songs ?? {});
      const dayTotal = Object.values(droneLog.days).reduce((a, b) => a + b, 0);
      assert.equal(droneSong.length, 1);
      assert.equal(droneSong[0].title, "持续音");
      assert.ok(droneSong[0].seconds >= 2 && droneSong[0].seconds <= 8, `drone + metronome timed once on the song (${droneSong[0].seconds} s)`);
      assert.equal(dayTotal, droneSong[0].seconds, "not counted twice");
      await drone.getByRole("button", { name: "开始持续音", exact: true }).click();
      await page.waitForFunction(() => window.droneSets.at(-1)?.length === 4 && window.droneSets.at(-1)[0] === 196);
      assert.deepEqual(await last(), [196, 392, 293.7, 587.3], "G3 + fifth D4, each with a soft octave");
      await drone.getByRole("radio", { name: "三和弦", exact: true }).click();
      await drone.getByRole("radio", { name: "纯律（无拍音）", exact: true }).click();
      await page.waitForFunction(() => window.droneSets.at(-1)?.length === 6 && window.droneSets.at(-1)[2] === 245);
      assert.deepEqual(await last(), [196, 392, 245, 490, 294, 588], "just triad: 5/4 and 3/2 over G");
      assert.equal(await drone.locator("[data-drone-hint]").textContent(), "纯律：大三度 -14 音分，纯五度 +2 音分（相对平均律），和音不打拍。");
      await drone.getByRole("radio", { name: "根音 2 级", exact: true }).click();
      await page.waitForFunction(() => window.droneSets.at(-1)?.[0] === 220);
      assert.deepEqual(await last(), [220, 440, 264, 528, 330, 660], "ii in G is A minor: 6/5 third");
      await page.waitForFunction(() => window.droneContexts.filter((c) => c.state !== "closed").length === 1);
      assert.deepEqual(JSON.parse(await page.evaluate(() => localStorage.getItem("puxian-drone-v1"))), { voicing: "triad", tuning: "just", volume: 0.5 });
      // The score's playback takes over: the drone stops.
      await page.getByRole("navigation", { name: "播放与编辑" }).getByRole("button", { name: "播放", exact: true }).click();
      await drone.getByRole("button", { name: "开始持续音", exact: true }).waitFor();
      await page.waitForFunction(() => window.droneContexts.slice(0, -1).every((c) => c.state === "closed"));
      await page.getByRole("navigation", { name: "播放与编辑" }).getByRole("button", { name: "停止", exact: true }).click();
      await drone.getByRole("button", { name: "开始持续音", exact: true }).click();
      await page.waitForFunction(() => window.droneSets.at(-1)?.[0] === 220);
      const fits = await drone.evaluate((el) => el.getBoundingClientRect().right <= innerWidth + 0.5 && document.documentElement.scrollWidth <= innerWidth);
      assert.ok(fits, "390: drone fits");
      await drone.getByRole("button", { name: "收起持续音", exact: true }).click();
      await drone.waitFor({ state: "detached" });
      await page.waitForFunction(() => window.droneContexts.every((c) => c.state === "closed"));
      assert.equal(await open(), 0);
      await page.close();
    }

    // 3) Full screen with the chord guide: every note is fully seen on some screen, none skipped under the guide.
    const long = { title: "全屏和弦", bpm: 96, beats: 4, beatUnit: 4, key: "G", mode: "major", clef: "treble", tonicOctave: 4, notes: melody(160), chordSymbols: chords(40) };
    for (const [name, viewport] of [["phone", { width: 390, height: 844 }], ["desktop", { width: 1280, height: 800 }]]) {
      const page = await browser.newPage({ viewport });
      await page.goto(`${origin}/#s=${encodeSharePayload(long)}`);
      await page.getByRole("button", { name: "在编辑器中打开副本", exact: true }).click();
      await page.locator(".score-stage [data-chord-symbol] text").first().waitFor();
      await page.getByRole("tab", { name: "辅助模块", exact: true }).click();
      await page.locator(".chord-guide").waitFor();
      await page.getByRole("button", { name: "全屏看谱" }).click();
      await page.locator("[data-full-score]").waitFor();
      if (name === "phone") {
        // r11: the compact phone header leaves the notes most of the screen (523 px before).
        const room = await page.evaluate(() => ({ stage: document.querySelector(".score-stage").clientHeight, wide: document.documentElement.scrollWidth <= innerWidth }));
        assert.ok(room.stage >= 620 && room.wide, `phone full screen: stage ${room.stage}px, no sideways scroll`);
        const fit = await page.evaluate(() => [...document.querySelectorAll(".performance-bar button, .performance-bar input, .score-tools button")]
          .every((el) => { const r = el.getBoundingClientRect(); return r.right <= innerWidth + 0.5 && r.height >= 36; }));
        assert.ok(fit, "phone full screen: controls on screen and still tappable");
        // r12: the view tabs look 36 px but take taps over 44 px, without reaching another control.
        const hits = await page.evaluate(() => {
          const tabs = [...document.querySelectorAll('.score-tools .segmented[aria-label="谱面视图"] > button')];
          const others = [...document.querySelectorAll("#zone-score button, #zone-score input, #zone-score select, #zone-score textarea")].filter((el) => !tabs.includes(el));
          const bad = [];
          for (const tab of tabs) {
            const r = tab.getBoundingClientRect();
            const box = { left: r.left, right: r.right, top: r.top - 4, bottom: r.bottom + 4 };
            if (box.bottom - box.top < 44) bad.push(`${tab.textContent}: ${box.bottom - box.top}px`);
            for (const x of [r.left + 3, (r.left + r.right) / 2, r.right - 3])
              for (const y of [box.top + 0.5, r.top + 1, r.bottom - 1, box.bottom - 0.5])
                if (document.elementFromPoint(x, y)?.closest("button") !== tab) bad.push(`${tab.textContent} misses ${Math.round(x)},${Math.round(y)}`);
            for (const other of others) {
              const o = other.getBoundingClientRect();
              if (!o.width || !o.height) continue;
              const w = Math.min(box.right, o.right) - Math.max(box.left, o.left);
              const h = Math.min(box.bottom, o.bottom) - Math.max(box.top, o.top);
              if (w > 0.5 && h > 0.5) bad.push(`${tab.textContent} overlaps ${other.getAttribute("aria-label") || other.textContent}`);
            }
          }
          return { count: tabs.length, bad };
        });
        assert.deepEqual(hits, { count: 5, bad: [] }, "phone full screen: 44 px tap area per view tab, no overlap");
      }
      for (const open of [false, true]) {
        if (open) {
          await page.locator(".chord-guide > details > summary").click();
          await page.locator(".chord-guide > details[open]").waitFor();
          const cap = await page.evaluate(() => ({ h: document.querySelector(".chord-guide").getBoundingClientRect().height, max: Math.min(innerHeight * 0.28, 240) }));
          assert.ok(cap.h <= cap.max + 1, `${name}: open guide capped (${Math.round(cap.h)} > ${Math.round(cap.max)})`);
        }
        await page.locator(".score-stage").evaluate((el) => el.scrollTo({ top: 0 }));
        const seen = new Set();
        let total = 0;
        for (let turn = 0; turn < 60; turn += 1) {
          const shot = await page.evaluate(() => {
            const stage = document.querySelector(".score-stage");
            const s = stage.getBoundingClientRect();
            const g = document.querySelector(".chord-guide").getBoundingClientRect();
            const notes = [...stage.querySelectorAll('[aria-label="简谱"] .jianpu-note-target')];
            const from = Math.max(s.top, g.bottom);
            const bottom = s.top + stage.clientHeight;
            return {
              total: notes.length,
              seen: notes.flatMap((el, i) => { const r = el.getBoundingClientRect(); return r.top >= from - 0.5 && r.bottom <= bottom + 0.5 ? [i] : []; }),
              end: stage.scrollTop >= stage.scrollHeight - stage.clientHeight - 1,
            };
          });
          total = shot.total;
          for (const i of shot.seen) seen.add(i);
          if (shot.end) break;
          await page.getByRole("button", { name: "下一屏", exact: true }).click();
        }
        assert.ok(total >= 160, `${name}: notes rendered`);
        const missed = [...Array(total).keys()].filter((i) => !seen.has(i));
        assert.deepEqual(missed, [], `${name}${open ? " (guide open)" : ""}: page turns skip no note under the chord guide`);
      }
      await page.close();
    }
    console.log(JSON.stringify({ practiceLog: "passed", checks: ["lazy chunk retry (home + editor)", "goal / week / streak", "timed while playing", "390 fits", "full-screen turns clear of chord guide", "open guide capped", "per-song time + note", "metronome counts", "clear asks first", "phone full-screen room", "44 px view-tab taps", "ear trainer", "ear time on its own line", "rhythm tapping", "rhythm latency (manual + calibration)", "random rhythm quiz (2 bars, swap, grade, back to written, 44 px)", "drone (key, triad, just)", "drone timed on the song, once", "390 panel: 2 × 2 tools, folded mixer, ≤ 1700 px", "390 panel: log + 渐进加速 folded, 44 px headers"] }));
  } finally {
    await browser.close();
  }
}
