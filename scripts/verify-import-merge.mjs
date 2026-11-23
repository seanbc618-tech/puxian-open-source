import assert from "node:assert/strict";
import { join } from "node:path";
import { makePdf } from "./verify-score-images.mjs";

// Deterministic Worker boundary fixture: exercises the real page queue, kern →
// MusicXML converter, preview, publish/history, editor and existing transposition UI.
// Real model inference is covered separately by scripts/omr/integration.mjs.
export async function verifyImportMerge(page, picker, png, title, artifacts) {
  const oldTitle = await title.inputValue();
  await page.evaluate(() => {
    window.__originalOmrWorker = window.Worker;
    window.__omrCalls = 0;
    window.Worker = class {
      onmessage;
      onerror;
      stopped = false;
      postMessage({ bitmap }) {
        bitmap.close();
        const call = ++window.__omrCalls;
        const text =
          "**kern\t**kern\n*clefF4\t*clefG2\n*k[]\t*k[]\n*M4/4\t*M4/4\n=1\t=1\n1C\t4c\n.\t4d\n.\t4e\n.\t4f\n==\t==\n*-\t*-";
        const emit = (data) => {
          if (!this.stopped) this.onmessage?.({ data });
        };
        setTimeout(() => {
          if (window.__omrStream && call === 1) {
            emit({ kind: "page", total: 3, warnings: [] });
            emit({ kind: "system", index: 1, total: 3, text, complete: true });
            emit({
              kind: "system",
              index: 2,
              total: 3,
              text: text.replace("*-\t*-", ""),
              complete: false,
              error: "模型长度限制，尾部未识别",
            });
            emit({ kind: "system", index: 3, total: 3, text, complete: true });
            emit({ kind: "result", systems: [text, text, text] });
          } else if (window.__omrCrash && call === 1) {
            emit({ kind: "page", total: 2, warnings: [] });
            emit({ kind: "progress", message: "生成谱符后运行时中断", text, system: 1, total: 2 });
            this.onerror?.(new Event("error"));
          } else if (window.__omrCancel && call === 1) {
            emit({ kind: "page", total: 2, warnings: [] });
            emit({ kind: "progress", message: "已生成谱符，尚未完成", text, system: 1, total: 2 });
          } else
            emit({
              kind: "result",
              systems: window.__omrFailAll || window.__omrFailPage === call ? [] : [text],
            });
        }, 20);
      }
      terminate() {
        this.stopped = true;
      }
    };
  });
  const panel = page.getByRole("complementary", { name: "谱子图片对照" });
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
    assert.fail(`score state did not match: ${JSON.stringify(await stored())}`);
  };
  try {
    await picker.setInputFiles([
      { ...png, name: "第一页.png" },
      { ...png, name: "第二页.png" },
      { name: "后两页.pdf", mimeType: "application/pdf", buffer: makePdf() },
    ]);
    await panel.getByText("第 1 页 / 共 4 页", { exact: true }).waitFor();
    await panel.getByRole("button", { name: "识别全部页并合并预览", exact: true }).click();
    const confirm = panel.getByRole("button", {
      name: "编辑识别草稿（主谱保持不变）",
      exact: true,
    });
    await confirm.waitFor();
    await panel.getByText(/共 4 页，按页码顺序拼接/).waitFor();
    assert.equal(await title.inputValue(), oldTitle, "preview preserves current score");
    await confirm.click();
    const draft = page.getByRole("dialog", { name: "识别草稿", exact: true });
    await draft
      .locator("svg g[data-id] text")
      .filter({ hasText: /^[1-7]$/ })
      .first()
      .click({ force: true });
    await draft.getByRole("button", { name: "升一级", exact: true }).click();
    await draft.getByLabel("草稿音符时值", { exact: true }).selectOption("2");
    await draft.getByRole("button", { name: "删除选中音", exact: true }).click();
    assert.equal(
      await title.inputValue(),
      oldTitle,
      "editing recognition draft preserves main score",
    );
    for (let i = 0; i < 3; i++)
      await draft.getByRole("button", { name: "撤销草稿修改", exact: true }).click();
    await draft.screenshot({ path: join(artifacts, "recognition-draft-editor.png") });
    await draft.getByRole("button", { name: "写入主谱", exact: true }).click();
    const merged = await until((s) => s.title.includes("识谱草稿"));
    assert.deepEqual(merged.measureEnds, [4, 8, 12, 16]);
    assert.deepEqual(
      merged.voice2.map((n) => n.pitches),
      [[48], [48], [48], [48]],
    );
    assert.equal(merged.notes.length, 16, "all four pages reach the main score");
    assert.equal(merged.clef, "treble");
    assert.deepEqual(
      merged.notes.map((n) => n.pitches),
      Array.from({ length: 4 }, () => [[60], [62], [64], [65]]).flat(),
    );
    const stage = page.locator(".score-stage");
    await stage.locator("svg").first().waitFor();
    await stage.screenshot({ path: join(artifacts, "import-merged-main-score.png") });
    await panel.getByRole("button", { name: "去移调与乐器（整首移调）", exact: true }).click();
    await page.getByRole("button", { name: "高半音", exact: true }).click();
    const shifted = await until((s) => s.key !== merged.key);
    assert.deepEqual(
      shifted.notes.map((n) => n.pitches),
      merged.notes.map((n) => n.pitches.map((p) => p + 1)),
    );
    assert.deepEqual(
      shifted.voice2.map((n) => n.pitches),
      merged.voice2.map((n) => n.pitches.map((p) => p + 1)),
    );
    await stage.screenshot({ path: join(artifacts, "import-transposed-main-score.png") });
    await page.getByRole("button", { name: "撤销", exact: true }).click();
    await until((s) => s.key === merged.key);
    await panel.getByRole("button", { name: "去主谱改音符 / 途中转调", exact: true }).click();
    const degrees = stage.locator("svg g[data-id] text").filter({ hasText: /^[1-7]$/ });
    // Primary upper staff has four quarters per bar; select bar 2 at beat 4.
    await degrees.nth(4).click({ force: true });
    await page.getByRole("combobox", { name: "途中转调", exact: true }).selectOption("G");
    await page.getByRole("button", { name: "设为从这小节换调", exact: true }).click();
    const marked = await until((s) => s.changes?.some((c) => c.at > 0 && c.key === "G"));
    assert.equal(marked.key, "C");
    await page.getByRole("button", { name: "撤销", exact: true }).click();
    await until((s) => !s.changes?.length);
    await page.getByRole("button", { name: "撤销", exact: true }).click();
    assert.equal(await title.inputValue(), oldTitle, "one undo restores score before import");
    await page.evaluate(() => {
      window.__omrCalls = 0;
      window.__omrFailPage = 2;
    });
    await panel.getByRole("button", { name: "识别全部页并合并预览", exact: true }).click();
    await panel
      .getByRole("list", { name: "逐页识别结果" })
      .getByText(/第 2 页：未完整识别/)
      .waitFor();
    await confirm.waitFor();
    await panel.getByText("部分合并预览 · 存在未识别区域", { exact: true }).waitFor();
    await panel.getByText(/仅包含第 1、3、4 页已恢复的 3 个系统/).waitFor();
    assert.equal(
      await page.evaluate(() => window.__omrCalls),
      4,
      "page failures do not stop later pages",
    );
    assert.equal(
      await title.inputValue(),
      oldTitle,
      "partial preview also preserves current score",
    );
    await confirm.click();
    await page.getByRole("button", { name: "写入主谱", exact: true }).click();
    await until((s) => s.title.includes("识谱草稿") && s.voice2.length === 3);
    await page.getByRole("button", { name: "撤销", exact: true }).click();
    assert.equal(await title.inputValue(), oldTitle);

    await page.evaluate(() => {
      window.__omrCalls = 0;
      window.__omrFailPage = 0;
      window.__omrStream = true;
    });
    await panel.getByRole("button", { name: "识别全部页并合并预览", exact: true }).click();
    await panel.getByText(/仅包含第 1、2、3、4 页已恢复的 6 个系统/).waitFor();
    await panel.locator(".omr-raw summary").click();
    assert.equal(await panel.locator(".omr-raw pre").count(), 6);
    await panel
      .locator(".omr-raw")
      .getByText(/第 1 页 \/ 第 2 个系统.*模型长度限制/)
      .waitFor();
    await confirm.click();
    await page.getByRole("button", { name: "写入主谱", exact: true }).click();
    await until((s) => s.title.includes("识谱草稿") && s.voice2.length === 6);
    await page.getByRole("button", { name: "撤销", exact: true }).click();
    assert.equal(await title.inputValue(), oldTitle);

    await page.evaluate(() => {
      window.__omrCalls = 0;
      window.__omrStream = false;
      window.__omrCrash = true;
    });
    await panel.getByRole("button", { name: "识别全部页并合并预览", exact: true }).click();
    await panel.getByText(/仅包含第 1、2、3、4 页已恢复的 4 个系统/).waitFor();
    await panel
      .getByRole("list", { name: "逐页识别结果" })
      .getByText(/本页本机运行时中断/)
      .waitFor();
    assert.equal(await page.evaluate(() => window.__omrCalls), 4);
    await confirm.click();
    await page.getByRole("button", { name: "写入主谱", exact: true }).click();
    await until((s) => s.title.includes("识谱草稿") && s.voice2.length === 4);
    await page.getByRole("button", { name: "撤销", exact: true }).click();
    assert.equal(await title.inputValue(), oldTitle);

    await page.evaluate(() => {
      window.__omrCalls = 0;
      window.__omrStream = false;
      window.__omrCrash = false;
      window.__omrCancel = true;
    });
    await panel.getByRole("button", { name: "识别全部页并合并预览", exact: true }).click();
    await panel.getByText(/已生成谱符，尚未完成/).waitFor();
    await panel.getByRole("button", { name: "取消识别", exact: true }).click();
    await confirm.click();
    await page.getByRole("button", { name: "写入主谱", exact: true }).click();
    await until((s) => s.title.includes("识谱草稿") && s.voice2.length === 1);
    await page.getByRole("button", { name: "撤销", exact: true }).click();
    assert.equal(
      await title.inputValue(),
      oldTitle,
      "cancel keeps recoverable symbols and undo works",
    );
    await page.evaluate(() => {
      window.__omrCancel = false;
      window.__omrFailAll = true;
    });
    await panel.getByRole("button", { name: "识别此页", exact: true }).click();
    await panel.getByRole("button", { name: "打开可修改的占位草稿", exact: true }).click();
    const fallback = page.getByRole("dialog", { name: "识别草稿", exact: true });
    await fallback.getByText(/整页未恢复可转换音符/).waitFor();
    await fallback.getByRole("button", { name: "补一个音", exact: true }).click();
    assert.equal(
      await title.inputValue(),
      oldTitle,
      "fully failed recognition still offers an editable draft",
    );
    await fallback.getByRole("button", { name: "放弃识别草稿", exact: true }).click();
    await panel.getByRole("button", { name: "关闭图片", exact: true }).click();
    console.log(
      JSON.stringify({
        importMerge: "passed",
        pages: 4,
        checks: [
          "images + PDF",
          "preview preserves score",
          "all pages in editor",
          "transpose both voices",
          "mid-score key",
          "undo",
          "partial page import with explicit omissions",
          "failed system keeps symbols and later systems",
          "cancel recovers generated prefix",
          "runtime failure keeps symbols and restarts for later pages",
        ],
      }),
    );
  } finally {
    await page.evaluate(() => {
      window.Worker = window.__originalOmrWorker;
      delete window.__originalOmrWorker;
      delete window.__omrCalls;
      delete window.__omrFailPage;
      delete window.__omrStream;
      delete window.__omrCancel;
      delete window.__omrCrash;
    });
  }
}
