import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawn, execFileSync } from "node:child_process";
import { chromium } from "playwright";
import { kernSystemsToScore as convertKern } from "../../src/lib/omr/kern.ts";
import { voiceList } from "../../src/lib/music/voices.ts";
import { musicXmlToScore } from "../../src/lib/music/musicxml.ts";
const kernSystemsToScore = (systems, title) => convertKern(systems, title, musicXmlToScore);
const logDir = process.env.OMR_LOG_DIR || "logs/omr";
mkdirSync(logDir, { recursive: true });
const uptime = () => Number(readFileSync("/proc/uptime", "utf8").split(" ")[0]);
const server = spawn(
  "timeout",
  [
    "235",
    "python3",
    "-m",
    "http.server",
    "8093",
    "--bind",
    "127.0.0.1",
    "--directory",
    "dist-static",
  ],
  { stdio: "ignore" },
);
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  const page = await context.newPage();
  const requests = [];
  const results = [];
  page.on("request", (r) => {
    requests.push({ url: r.url(), method: r.method() });
    assert.equal(r.method(), "GET");
    assert.ok(r.url().startsWith("http://127.0.0.1:8093/") || r.url().startsWith("blob:"));
  });
  page.on("console", (m) => {
    if (m.text().startsWith("OMR_RESULT ")) results.push(JSON.parse(m.text().slice(11)));
  });
  await page.addInitScript(() => {
    const Original = window.Worker;
    window.Worker = class extends Original {
      constructor(...args) {
        super(...args);
        this.addEventListener("message", (e) => {
          if (e.data.kind === "result") console.log("OMR_RESULT " + JSON.stringify(e.data.systems));
        });
      }
    };
  });
  for (let i = 0; i < 40; i++) {
    try {
      await page.goto("http://127.0.0.1:8093");
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  await page.getByRole("button", { name: "识别图片", exact: true }).waitFor();
  assert.ok(
    !requests.some((r) =>
      /omr|onnx|ort-wasm|models\/|score-image-panel|score-pdf|pdf[.-]/.test(
        new URL(r.url).pathname,
      ),
    ),
    "no OMR runtime or models on first screen",
  );
  execFileSync("timeout", ["30", "node", "scripts/omr/fixture.mjs"]);
  await page.getByLabel("上传谱子图片文件", { exact: true }).setInputFiles(".omr-dev/scale.png");
  const panel = page.locator(".omr-panel");
  await panel.getByRole("button", { name: "识别此页", exact: true }).waitFor();
  const title = page.getByRole("textbox", { name: "曲名", exact: true });
  // App exposes title as an input with aria-label; resolve its actual selector if needed.
  const titleInput = (await title.count()) ? title : page.locator("input[aria-label=乐谱标题]");
  const current = await titleInput.inputValue();
  await page.getByRole("complementary", { name: "谱子图片对照" }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${logDir}/omr-before-desktop.png`, fullPage: true });
  // A failed/unfinished download must remain a failure; never expose confirm.
  await context.route("**/models/omr/**", (route) =>
    route.fulfill({ status: 503, body: "unavailable" }),
  );
  await panel.getByRole("button", { name: "识别此页", exact: true }).click();
  await panel
    .getByRole("list", { name: "逐页识别结果" })
    .getByText(/模型尚未下载完成：本站模型文件暂不可用/)
    .waitFor({ timeout: 20000 });
  assert.equal(
    await panel.getByRole("button", { name: "编辑识别草稿（主谱保持不变）" }).count(),
    0,
  );
  assert.equal(await titleInput.inputValue(), current);
  await context.unroute("**/models/omr/**");
  await context.route("**/models/omr/**", async (route) => {
    await new Promise((r) => setTimeout(r, 1500));
    await route.abort().catch(() => {});
  });
  await panel.getByRole("button", { name: "识别此页", exact: true }).click();
  await panel.getByRole("button", { name: "取消识别", exact: true }).click();
  await panel.getByText(/已取消后续识别/).waitFor();
  assert.equal(await titleInput.inputValue(), current);
  assert.equal(
    await panel.getByRole("button", { name: "编辑识别草稿（主谱保持不变）" }).count(),
    0,
  );
  await context.unroute("**/models/omr/**");
  const weights =
    existsSync("public/models/omr/encoder.onnx") && existsSync("public/models/omr/decoder.onnx");
  if (!weights) {
    console.log(
      "SKIP: browser inference integration: weights absent; download/cancel safeguards passed.",
    );
  } else {
    const start = uptime();
    await panel.getByRole("button", { name: "识别此页", exact: true }).click();
    await panel.getByRole("button", { name: "取消识别", exact: true }).waitFor();
    await page.screenshot({ path: `${logDir}/omr-progress-desktop.png`, fullPage: true });
    const confirm = panel.getByRole("button", {
      name: "编辑识别草稿（主谱保持不变）",
      exact: true,
    });
    await confirm.waitFor({ timeout: 90000 });
    await panel
      .getByRole("button", { name: "取消识别", exact: true })
      .waitFor({ state: "hidden", timeout: 90000 });
    console.log("real worker seconds", uptime() - start);
    assert.equal(await titleInput.inputValue(), current, "preview does not overwrite score");
    assert.ok(results.length);
    writeFileSync(`${logDir}/recognized-browser.krn`, results[0].join("\n\n"));
    const converted = kernSystemsToScore(results[0], "integration");
    assert.equal(converted.score.clef, "treble");
    assert.ok(
      converted.score.notes.some((n) => n.pitches.length),
      "upper staff remains the primary pitched voice",
    );
    assert.equal(converted.score.key, "C");
    assert.equal(converted.score.beats, 4);
    assert.equal(converted.score.beatUnit, 4);
    assert.deepEqual(
      converted.score.voice2.map((n) => [n.pitches, n.dur]),
      [
        [[48], 4],
        [[50], 4],
        [[52], 4],
        [[53], 4],
      ],
    );
    await panel.locator(".omr-notation svg").waitFor();
    await page.getByRole("complementary", { name: "谱子图片对照" }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${logDir}/omr-preview-desktop.png`, fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await confirm.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${logDir}/omr-preview-mobile.png`, fullPage: true });
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
      false,
    );
    await page.setViewportSize({ width: 1440, height: 1100 });
    await confirm.click();
    const draftDialog = page.getByRole("dialog", { name: "识别草稿", exact: true });
    await draftDialog.getByRole("button", { name: "写入主谱", exact: true }).click();
    await page.waitForFunction(() =>
      /识谱草稿/.test(document.querySelector('[aria-label="曲名"]')?.value || ""),
    );
    assert.match(await titleInput.inputValue(), /识谱草稿/);
    await page.getByRole("button", { name: "五线", exact: true }).click();
    await titleInput.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${logDir}/omr-confirmed-desktop.png`, fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: `${logDir}/omr-confirmed-mobile.png`, fullPage: true });
    // Actual offline inference in the same editor session, through cached model/runtime.
    await context.setOffline(true);
    const offlineStart = uptime();
    await panel.getByRole("button", { name: "识别此页", exact: true }).click();
    await confirm.waitFor({ timeout: 90000 });
    await panel
      .getByRole("button", { name: "取消识别", exact: true })
      .waitFor({ state: "hidden", timeout: 90000 });
    console.log("cached offline seconds", uptime() - offlineStart);
    assert.match(await titleInput.inputValue(), /识谱草稿/);
    await panel.getByRole("button", { name: "放弃此草稿", exact: true }).click();
    await context.setOffline(false);
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.getByRole("button", { name: "撤销", exact: true }).click();
    assert.equal(await titleInput.inputValue(), current);
    const reference = page.getByRole("complementary", { name: "谱子图片对照" });
    await page.getByLabel("上传谱子图片文件", { exact: true }).setInputFiles(".omr-dev/scale.pdf");
    await reference.getByText("第 1 页 / 共 2 页", { exact: true }).waitFor();
    await reference.getByRole("button", { name: "下一页", exact: true }).click();
    await reference
      .getByRole("img", { name: "谱子图片：scale.pdf · 第 1 页", exact: true })
      .waitFor();
    await panel.getByRole("button", { name: "识别此页", exact: true }).click();
    await reference.getByRole("button", { name: "上一页", exact: true }).click();
    await reference.getByRole("img", { name: "谱子图片：scale.png", exact: true }).waitFor();
    assert.equal(
      await panel
        .getByRole("button", { name: "编辑识别草稿（主谱保持不变）", exact: true })
        .count(),
      0,
      "switching away cancels the old page result",
    );
    assert.equal(await titleInput.inputValue(), current);
    await reference.getByRole("button", { name: "下一页", exact: true }).click();
    await reference
      .getByRole("img", { name: "谱子图片：scale.pdf · 第 1 页", exact: true })
      .waitFor();
    await panel.getByRole("button", { name: "识别此页", exact: true }).click();
    await confirm.waitFor({ timeout: 90000 });
    await panel
      .getByRole("button", { name: "取消识别", exact: true })
      .waitFor({ state: "hidden", timeout: 90000 });
    assert.equal(results.at(-1).length, 1, "current PDF page alone is recognized");
    const pdfScore = kernSystemsToScore(results.at(-1), "PDF page").score;
    assert.deepEqual(
      pdfScore.voice2.map((n) => [n.pitches, n.dur]),
      [
        [[48], 4],
        [[50], 4],
        [[52], 4],
        [[53], 4],
      ],
    );
    assert.equal(await titleInput.inputValue(), current);
    await panel.locator(".omr-notation svg").waitFor();
    await page.setViewportSize({ width: 1440, height: 2200 });
    await reference.scrollIntoViewIfNeeded();
    await reference.screenshot({ path: `${logDir}/integ-multipage-omr.png` });
    await page.setViewportSize({ width: 1440, height: 1100 });
    await panel.getByRole("button", { name: "放弃此草稿", exact: true }).click();
    await context.setOffline(true);
    await reference.getByRole("button", { name: "上一页", exact: true }).click();
    await reference.getByRole("img", { name: "谱子图片：scale.png", exact: true }).waitFor();
    await panel.getByRole("button", { name: "识别此页", exact: true }).click();
    await confirm.waitFor({ timeout: 90000 });
    await panel
      .getByRole("button", { name: "取消识别", exact: true })
      .waitFor({ state: "hidden", timeout: 90000 });
    assert.equal(results.at(-1).length, 1);
    assert.equal(await titleInput.inputValue(), current);
    await panel.getByRole("button", { name: "放弃此草稿", exact: true }).click();
    await reference.getByRole("button", { name: "下一页", exact: true }).click();
    await context.setOffline(false);
    console.log("PASS: offline page switching reuses the loaded local model.");
    const beforeAll = results.length;
    await panel.getByRole("button", { name: "识别全部页并合并预览", exact: true }).click();
    await confirm.waitFor({ timeout: 120000 });
    await panel
      .getByRole("button", { name: "取消识别", exact: true })
      .waitFor({ state: "hidden", timeout: 120000 });
    assert.equal(
      results.length - beforeAll,
      2,
      "one real Worker result per page in the serial queue",
    );
    const all = kernSystemsToScore(results.slice(beforeAll).flat(), "ordered pages").score;
    assert.deepEqual(all.measureEnds, [4, 8, 12, 16, 20, 24, 28, 32]);
    assert.deepEqual(
      all.voice2.map((n) => n.pitches[0]),
      [48, 50, 52, 53, 48, 50, 52, 53],
    );
    assert.equal(await titleInput.inputValue(), current);
    await confirm.click();
    await page
      .getByRole("dialog", { name: "识别草稿", exact: true })
      .getByRole("button", { name: "写入主谱", exact: true })
      .click();
    assert.match(await titleInput.inputValue(), /识谱草稿/);
    const readScore = () =>
      page.evaluate(() => {
        const value = JSON.parse(localStorage.getItem("puxian-score-v1") || "null");
        return value?.notes ? value : value?.score;
      });
    await page.waitForFunction(() => {
      const value = JSON.parse(localStorage.getItem("puxian-score-v1") || "null");
      return (value?.score ?? value)?.measureEnds?.length === 8;
    });
    const imported = await readScore();
    assert.deepEqual(imported.measureEnds, all.measureEnds);
    await page.locator(".score-stage").screenshot({ path: `${logDir}/real-merged-main-score.png` });
    await reference.getByRole("button", { name: "去移调与乐器（整首移调）", exact: true }).click();
    await page.getByRole("button", { name: "高半音", exact: true }).click();
    await page.waitForFunction(() => {
      const value = JSON.parse(localStorage.getItem("puxian-score-v1") || "null");
      return (value?.score ?? value)?.key === "Db";
    });
    const transposed = await readScore();
    assert.deepEqual(
      voiceList(transposed).map((v) => v.map((n) => n.pitches)),
      voiceList(imported).map((v) => v.map((n) => n.pitches.map((p) => p + 1))),
      "every recognized voice transposes",
    );
    await page
      .locator(".score-stage")
      .screenshot({ path: `${logDir}/real-transposed-main-score.png` });
    await page.getByRole("button", { name: "撤销", exact: true }).click();
    await page.getByRole("button", { name: "撤销", exact: true }).click();
    assert.equal(await titleInput.inputValue(), current);
    console.log(
      "PASS: current rendered PDF page, multipage serial recognition, ordered measures, main score, transposition of every voice and undo.",
    );
    await page
      .getByLabel("上传谱子图片文件", { exact: true })
      .setInputFiles(".omr-dev/two-systems.png");
    await reference.getByText("第 2 页 / 共 3 页", { exact: true }).waitFor();
    await reference.getByRole("button", { name: "下一页", exact: true }).click();
    await reference.getByRole("img", { name: "谱子图片：two-systems.png", exact: true }).waitFor();
    await panel.getByRole("button", { name: "识别此页", exact: true }).click();
    await confirm.waitFor({ timeout: 90000 });
    await panel
      .getByRole("button", { name: "取消识别", exact: true })
      .waitFor({ state: "hidden", timeout: 90000 });
    const multi = results.at(-1);
    assert.equal(
      multi.length,
      2,
      "full-page system segmentation must actually recognize both systems",
    );
    const multiScore = kernSystemsToScore(multi, "two systems").score;
    assert.deepEqual(multiScore.measureEnds, [4, 8, 12, 16, 20, 24, 28, 32]);
    assert.deepEqual(
      multiScore.voice2.map((n) => n.pitches[0]),
      [48, 50, 52, 53, 48, 50, 52, 53],
    );
    await page.screenshot({ path: `${logDir}/omr-two-systems.png`, fullPage: true });
    await panel.getByRole("button", { name: "放弃此草稿", exact: true }).click();
    assert.equal(await titleInput.inputValue(), current);
    console.log("PASS: actual two-system page segmentation and ordered Score merge.");
  }
  // Blank layouts fail in Chinese and do not offer a confirm button.
  await page.getByLabel("上传谱子图片文件", { exact: true }).setInputFiles(".omr-dev/blank.png");
  await page.waitForFunction(
    (count) => document.querySelectorAll('nav[aria-label="对照页码"] button').length === count,
    weights ? 4 : 2,
  );
  const last = page.getByRole("navigation", { name: "对照页码" }).getByRole("button").last();
  await last.click();
  await page.getByRole("img", { name: "谱子图片：blank.png", exact: true }).waitFor();
  await panel.getByRole("button", { name: "识别此页", exact: true }).click();
  await panel
    .getByRole("list", { name: "逐页识别结果" })
    .getByText(/本页谱表定位失败/)
    .waitFor();
  assert.equal(
    await panel.getByRole("button", { name: "编辑识别草稿（主谱保持不变）" }).count(),
    0,
  );
  console.log(
    "PASS: local privacy, lazy loading, failed/unfinished download, cancellation, preview isolation, real score confirmation, cached offline inference and invalid image safeguards.",
  );
  await context.close();
} finally {
  await browser.close();
  server.kill("SIGTERM");
}
