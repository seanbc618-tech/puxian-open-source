import assert from "node:assert/strict";
import { join } from "node:path";

export async function verifyRecognitionFlow(port, artifacts) {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = [],
      requests = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("request", (r) => requests.push(r.url()));
    await page.goto(`http://127.0.0.1:${port}/`);
    await page.getByRole("button", { name: "识别图片", exact: true }).waitFor();
    await page.getByRole("button", { name: "识别音乐", exact: true }).click();
    await page.getByRole("button", { name: "开始哼唱", exact: true }).waitFor();
    assert.ok(
      !requests.some((url) =>
        /\/(arrange|simplify|chord-symbols-panel|fingering-panel|mixer-panel|sight-read-panel)-/.test(
          url,
        ),
      ),
      "auxiliary chunks wait for insertion",
    );
    const stored = () =>
      page.evaluate(() =>
        JSON.stringify(JSON.parse(localStorage.getItem("puxian-score-v1") || "null")?.score),
      );
    await page.waitForFunction(
      () => !!JSON.parse(localStorage.getItem("puxian-score-v1") || "null")?.score,
    );
    const before = await stored();
    await page.getByLabel("上传音乐文件", { exact: true }).setInputFiles({
      name: "草稿.mid",
      mimeType: "audio/midi",
      buffer: Buffer.from([
        77, 84, 104, 100, 0, 0, 0, 6, 0, 0, 0, 1, 0, 96, 77, 84, 114, 107, 0, 0, 0, 12, 0, 144, 60,
        100, 96, 128, 60, 0, 0, 255, 47, 0,
      ]),
    });
    await page
      .getByRole("radiogroup", { name: "选择声部", exact: true })
      .getByRole("radio")
      .first()
      .click();
    const draft = page.getByRole("dialog", { name: "识别草稿", exact: true });
    await draft
      .locator("svg g[data-id] text")
      .filter({ hasText: /^[1-7]$/ })
      .first()
      .click({ force: true });
    await draft.getByRole("button", { name: "升一级", exact: true }).click();
    await draft.getByLabel("草稿音符时值", { exact: true }).selectOption("2");
    assert.equal(await stored(), before, "draft edits must not change main score or autosave");
    await draft.screenshot({ path: join(artifacts, "music-recognition-draft-mobile.png") });
    await draft.getByRole("button", { name: "写入主谱", exact: true }).click();
    await page.waitForFunction(() => {
      const score = JSON.parse(localStorage.getItem("puxian-score-v1") || "null")?.score;
      return score?.notes?.[0]?.pitches[0] === 62 && score.notes[0].dur === 2;
    });
    await page.getByRole("button", { name: "撤销", exact: true }).click();
    await page.waitForFunction(
      (before) =>
        JSON.stringify(JSON.parse(localStorage.getItem("puxian-score-v1") || "null")?.score) ===
        before,
      before,
    );
    // A real, silent PCM file exercises the no-pitch path rather than a mocked detector.
    const wav = Buffer.alloc(44 + 44100 * 2);
    wav.write("RIFF");
    wav.writeUInt32LE(wav.length - 8, 4);
    wav.write("WAVEfmt ", 8);
    wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20);
    wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(44100, 24);
    wav.writeUInt32LE(88200, 28);
    wav.writeUInt16LE(2, 32);
    wav.writeUInt16LE(16, 34);
    wav.write("data", 36);
    wav.writeUInt32LE(wav.length - 44, 40);
    await page
      .getByLabel("上传音乐文件", { exact: true })
      .setInputFiles({ name: "静音.wav", mimeType: "audio/wav", buffer: wav });
    await draft.waitFor();
    await draft.getByText(/待校对 \/ 缺口/).waitFor();
    await draft.getByRole("button", { name: "补一个音", exact: true }).click();
    assert.equal(await stored(), before, "failed recognition leaves main score intact");
    await draft.getByRole("button", { name: "放弃识别草稿", exact: true }).click();
    await page.getByLabel("上传音乐文件", { exact: true }).setInputFiles({
      name: "损坏.wav",
      mimeType: "audio/wav",
      buffer: Buffer.from("invalid audio"),
    });
    await page.getByRole("button", { name: "打开可修改的音乐草稿", exact: true }).click();
    await draft.waitFor();
    await draft.getByText(/这段音频解不开/).waitFor();
    assert.equal(await stored(), before, "decode failure also offers an isolated repair draft");
    await draft.getByRole("button", { name: "放弃识别草稿", exact: true }).click();
    await page.getByRole("tab", { name: "辅助模块", exact: true }).click();
    await page.getByRole("group", { name: "风格改编", exact: true }).waitFor();
    await page.getByRole("button", { name: "练习工具与混音", exact: true }).click();
    await page.locator("#zone-practice").waitFor();
    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify({
        recognitionFlow: "passed",
        checks: [
          "two primary entries",
          "music opens recording",
          "auxiliary lazy loading",
          "MIDI draft pitch/duration",
          "main score isolation",
          "write/undo",
          "silent audio editable fallback",
          "decode failure repair draft",
          "auxiliary practice/mixer",
        ],
      }),
    );
  } finally {
    await browser.close();
  }
}
