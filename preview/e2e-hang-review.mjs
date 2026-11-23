#!/usr/bin/env node
/** Smoke: opening a 200+ event / last-upload review must not freeze the page. */
import { chromium } from "playwright";
import { existsSync } from "node:fs";

const baseURL = process.env.GEOM_PREVIEW_URL || "http://127.0.0.1:18095";
const imagePath = process.argv[2] || process.env.GEOM_HANG_IMAGE || "";
if (!imagePath || !existsSync(imagePath)) {
  console.error("usage: node e2e-hang-review.mjs /path/to/upload.jpeg");
  process.exit(2);
}

const browser = await chromium.launch({
  headless: process.env.GEOM_E2E_HEADED === "1" ? false : true,
  channel: process.env.GEOM_E2E_CHANNEL || "chrome",
});
const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
page.setDefaultTimeout(120_000);

const marks = [];
const mark = (label) => marks.push({ label, t: Date.now() });

try {
  const status = await (await page.request.get(new URL("/api/geom-omr/status", baseURL).href)).json();
  console.log("api", JSON.stringify({ ok: status?.ok, device: status?.device, bind: status?.bind || status?.host }));
  if (!status?.ok) throw new Error("geom API is not ready");

  await page.goto(baseURL, { waitUntil: "domcontentloaded" });
  const homeUpload = page.getByRole("button", { name: /识别图片/ }).or(page.locator('[aria-label="上传谱子图片文件"]'));
  await homeUpload.first().waitFor({ timeout: 60_000 });
  mark("home");

  const inputs = page.locator('input[type="file"]');
  const count = await inputs.count();
  let attached = false;
  for (let i = 0; i < count; i++) {
    const inp = inputs.nth(i);
    const accept = (await inp.getAttribute("accept")) || "";
    const label = (await inp.getAttribute("aria-label")) || "";
    if (accept.includes("image") || /谱|图片|png|jpeg/i.test(label) || count === 1) {
      await inp.setInputFiles(imagePath);
      attached = true;
      break;
    }
  }
  if (!attached) {
    const chooserPromise = page.waitForEvent("filechooser", { timeout: 10_000 });
    await page.getByRole("button", { name: /识别图片/ }).click();
    const chooser = await chooserPromise;
    await chooser.setFiles(imagePath);
  }

  const recognizeBtn = page.getByRole("button", { name: /识别全部页并合并预览/ });
  await recognizeBtn.waitFor({ timeout: 30_000 });
  mark("ready-to-recognize");
  await recognizeBtn.click();

  const dialog = page.getByRole("dialog", { name: /识别草稿/ });
  await dialog.waitFor({ timeout: 180_000 });
  mark("review-open");

  const closeBtn = dialog.getByRole("button", { name: /放弃识别草稿/ });
  await closeBtn.waitFor({ state: "visible", timeout: 3_000 });
  const closeReadyMs = Date.now() - marks.at(-1).t;
  mark("close-visible");

  const hook = await page.evaluate(() => window.__PUXIAN_GEOM_PREVIEW__ || null);
  const nEvents = hook?.events?.length || hook?.editorScore?.notes?.length || null;
  const listVisible = await dialog.getByRole("list", { name: /识别事件列表/ }).isVisible();
  const panes = {
    image: await dialog.getByRole("region", { name: /原图/ }).count()
      || await dialog.locator(".geom-review-image").count(),
    score: await dialog.locator(".geom-review-score").count(),
  };

  // Close must work immediately; then the editor remains usable.
  const closeStart = Date.now();
  await closeBtn.click({ timeout: 3_000 });
  await dialog.waitFor({ state: "hidden", timeout: 5_000 });
  const closeMs = Date.now() - closeStart;
  mark("review-closed");

  await page.getByRole("button", { name: "识别图片", exact: true }).click({ timeout: 5_000 });
  mark("editor-usable");

  const result = {
    ok: true,
    closeReadyMs,
    closeMs,
    nEvents,
    listVisible,
    panes,
    usedGeom: Boolean(hook?.usedGeom) || hook?.engine === "copisteria-geom",
    marks: marks.map((m, i) => ({ ...m, dt: i ? m.t - marks[0].t : 0 })),
  };
  console.log(JSON.stringify(result, null, 2));
  if (closeReadyMs > 2000) {
    console.error("WARN: close button took more than 2s to appear after review opened");
  }
  if (!listVisible && (nEvents ?? 0) > 48) {
    console.error("WARN: heavy score list was not visible");
  }
} catch (err) {
  console.error("FAIL", err);
  process.exitCode = 1;
} finally {
  await browser.close();
}
