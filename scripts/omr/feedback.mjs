import assert from "node:assert/strict";
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const source = process.env.OMR_FEEDBACK_DIR || "eval/reference";
const output = process.env.OMR_LOG_DIR || "logs/omr-feedback";
for (const file of ["c_major_simple.png", "bach_prelude_c_p-1.png", "bach_prelude_c_a4.pdf"])
  assert.ok(existsSync(join(source, file)), `local feedback fixture required: ${file}`);
mkdirSync(output, { recursive: true });
const uptime = () => Number(readFileSync("/proc/uptime", "utf8").split(" ")[0]);
const server = spawn(
  "timeout",
  [
    "1800",
    "python3",
    "-m",
    "http.server",
    "8097",
    "--bind",
    "127.0.0.1",
    "--directory",
    "dist-static",
  ],
  { stdio: "ignore" },
);
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1500 } });
  const page = await context.newPage();
  const events = [],
    requests = [],
    errors = [];
  let label = "";
  page.on("request", (r) => requests.push({ method: r.method(), url: r.url() }));
  page.on("pageerror", (e) => errors.push(e.message));
  await context.route("**/*", (route) => {
    const url = route.request().url();
    return url.startsWith("http://127.0.0.1:8097/") || url.startsWith("blob:")
      ? route.continue()
      : route.abort();
  });
  await page.exposeFunction("recordOmr", (m) => {
    events.push({ file: label, ...m });
    writeFileSync(join(output, "worker-events.json"), JSON.stringify(events, null, 2));
    if (m.kind !== "progress" || /生成 (0|128|256|384|512|640|768|896) 个/.test(m.message))
      console.log(label, JSON.stringify(m));
  });
  await page.addInitScript(() => {
    const Original = window.Worker;
    window.Worker = class extends Original {
      page = 0;
      constructor(...args) {
        super(...args);
        this.addEventListener("message", (e) => {
          if (["progress", "page", "system", "result", "error"].includes(e.data?.kind))
            window.recordOmr({ ...e.data, page: this.page });
        });
      }
      postMessage(message, ...args) {
        if (message?.bitmap) this.page++;
        return super.postMessage(message, ...args);
      }
    };
  });
  await page.goto("http://127.0.0.1:8097");
  const title = page.getByRole("textbox", { name: "曲名", exact: true });
  const stored = () =>
    page.evaluate(() => {
      const value = JSON.parse(localStorage.getItem("puxian-score-v1") || "null");
      return value?.notes ? value : value?.score;
    });
  const until = async (check) => {
    for (let i = 0; i < 80; i++) {
      const score = await stored();
      if (score && check(score)) return score;
      await page.waitForTimeout(100);
    }
    assert.fail("main score did not reach expected state");
  };
  for (const file of ["c_major_simple.png", "bach_prelude_c_p-1.png", "bach_prelude_c_a4.pdf"]) {
    label = file;
    const start = uptime();
    await page.getByLabel("上传谱子图片文件", { exact: true }).setInputFiles(join(source, file));
    const panel = page.locator(".omr-panel");
    await panel.getByRole("button", { name: "识别此页", exact: true }).waitFor();
    const original = await title.inputValue();
    if (file.endsWith("pdf")) await page.getByText("第 1 页 / 共 2 页", { exact: true }).waitFor();
    await panel
      .getByRole("button", {
        name: file.endsWith("pdf") ? "识别全部页并合并预览" : "识别此页",
        exact: true,
      })
      .click();
    const cancel = panel.getByRole("button", { name: "取消识别", exact: true });
    await cancel.waitFor();
    await cancel.waitFor({ state: "hidden", timeout: 1500000 });
    const confirm = panel.getByRole("button", {
      name: "编辑识别草稿（主谱保持不变）",
      exact: true,
    });
    await confirm.waitFor();
    await panel.locator(".omr-notation svg").first().waitFor();
    assert.equal(
      await title.inputValue(),
      original,
      "recognition/partial preview must not replace score",
    );
    const text = await panel.innerText();
    assert.ok(!text.includes("未找到成对的钢琴五线谱"));
    if (file.endsWith("pdf")) {
      const reports = await panel.getByRole("list", { name: "逐页识别结果" }).innerText();
      assert.match(
        reports,
        /第 2 页：(已尝试全部系统|未完整识别)/,
        "page 2 must be attempted with an explicit outcome",
      );
      assert.ok(
        events.some((e) => e.file === file && e.page === 2),
        "real worker must process page 2",
      );
    } else if (file === "c_major_simple.png") assert.match(text, /节奏冲突.*顺延/, "the actual rhythm recovery must be disclosed");
    await panel.scrollIntoViewIfNeeded();
    await panel.screenshot({ path: join(output, `${file}.preview.png`) });
    writeFileSync(join(output, `${file}.status.txt`), text);
    await panel.locator(".omr-raw summary").click();
    await panel.locator(".omr-raw").screenshot({ path: join(output, `${file}.symbols.png`) });
    await confirm.click();
    const draft = page.getByRole("dialog", { name: "识别草稿", exact: true });
    await draft.locator("svg g[data-id] text").filter({ hasText: /^[1-7]$/ }).first().click({ force: true });
    await draft.getByRole("button", { name: "升一级", exact: true }).click();
    assert.equal(await title.inputValue(), original, "real-image draft edit preserves main score");
    await draft.screenshot({ path: join(output, `${file}.editable-draft.png`) });
    await draft.getByRole("button", { name: "写入主谱", exact: true }).click();
    const imported = await until((s) => s.title.includes("识谱草稿"));
    assert.ok(imported.notes.length && imported.measureEnds?.length);
    writeFileSync(join(output, `${file}.score.json`), JSON.stringify(imported, null, 2));
    await page.locator(".score-stage").screenshot({ path: join(output, `${file}.main.png`) });
    const reference = page.getByRole("complementary", { name: "谱子图片对照" });
    await reference.getByRole("button", { name: "去移调与乐器（整首移调）", exact: true }).click();
    await page.getByRole("button", { name: "高半音", exact: true }).click();
    const shifted = await until((s) => s.key !== imported.key);
    const voices = (s) => [s.notes, ...(s.voice2 ? [s.voice2] : []), ...(s.extraVoices || [])];
    assert.deepEqual(
      voices(shifted).map((v) => v.map((n) => n.pitches)),
      voices(imported).map((v) => v.map((n) => n.pitches.map((p) => p + 1))),
    );
    await page.locator(".score-stage").screenshot({ path: join(output, `${file}.transposed.png`) });
    await page.getByRole("button", { name: "撤销", exact: true }).click();
    await page.getByRole("button", { name: "撤销", exact: true }).click();
    assert.equal(await title.inputValue(), original);
    console.log(
      JSON.stringify({
        file,
        seconds: uptime() - start,
        key: imported.key,
        meter: `${imported.beats}/${imported.beatUnit}`,
        voices: voices(imported).length,
        measures: imported.measureEnds.length,
        preview: true,
        confirm: true,
        draftEdited: true,
        transpose: true,
        undo: true,
      }),
    );
    await reference.getByRole("button", { name: "关闭图片", exact: true }).click();
  }
  assert.deepEqual(errors, []);
  assert.ok(
    requests.every(
      (r) =>
        r.method === "GET" &&
        (r.url.startsWith("http://127.0.0.1:8097/") || r.url.startsWith("blob:")),
    ),
    "no image upload or external network access",
  );
  writeFileSync(join(output, "requests.json"), JSON.stringify(requests, null, 2));
} finally {
  await browser.close();
  server.kill();
}
