#!/usr/bin/env node
/**
 * End-to-end: upload each frozen sample to the local geom preview, open the
 * recognition draft editor, and score editor events vs frozen truth
 * (pitch exact, onset 0.08, duration 0.12; window-clip ties at the barline).
 */
import { chromium } from "playwright";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = existsSync(join(here, "../samples")) ? resolve(here, "..") : resolve(here, "../..");
// When installed at ~/puxian-geom-preview, script lives in preview/, samples/ and truth/ sit at root.
const samplesDir = process.env.GEOM_SAMPLES || join(root, "samples");
const truthPath = process.env.GEOM_E2E_CASES || join(root, "truth", "e2e-cases.json");
const baseURL = process.env.GEOM_URL || "http://127.0.0.1:18095/";
const outPath = process.env.GEOM_E2E_OUT || join(root, "logs", "e2e-editor-scores.json");
const headed = process.env.GEOM_E2E_HEADED === "1";
const timeoutMs = Number(process.env.GEOM_E2E_TIMEOUT_MS || 8 * 60 * 1000);

const suite = JSON.parse(readFileSync(truthPath, "utf8"));
const onsetTol = suite.onsetTol ?? 0.08;
const durTol = suite.durTol ?? 0.12;

function windowEvents(events, start, end) {
  const lo = start ?? 0;
  const hi = end == null ? Infinity : end;
  const out = [];
  for (const e of events) {
    if (e.start < lo - 1e-9 || e.start >= hi - 1e-9) continue;
    let dur = e.dur;
    if (Number.isFinite(hi) && e.start + dur > hi + 1e-9) dur = hi - e.start;
    out.push({ pitch: e.pitch, start: e.start - lo, dur });
  }
  return out;
}

function eventsFromScore(score) {
  const voices = [score.notes ?? [], ...(score.voice2 ? [score.voice2] : []), ...(score.extraVoices ?? [])];
  const ev = [];
  for (const voice of voices) {
    let t = 0;
    for (const note of voice) {
      for (const pitch of note.pitches ?? []) ev.push({ pitch, start: t, dur: note.dur });
      t += note.dur;
    }
  }
  ev.sort((a, b) => a.start - b.start || a.pitch - b.pitch);
  return ev;
}

function compare(truth, pred) {
  const t = [...truth].sort((a, b) => a.start - b.start || a.pitch - b.pitch);
  const p = [...pred].sort((a, b) => a.start - b.start || a.pitch - b.pitch);
  const used = p.map(() => false);
  let exact = 0;
  const missed = [];
  for (const ev of t) {
    let hit = -1;
    for (let i = 0; i < p.length; i++) {
      if (used[i]) continue;
      if (p[i].pitch !== ev.pitch) continue;
      if (Math.abs(p[i].start - ev.start) <= onsetTol && Math.abs(p[i].dur - ev.dur) <= durTol) {
        hit = i;
        break;
      }
    }
    if (hit < 0) missed.push(ev);
    else {
      used[hit] = true;
      exact++;
    }
  }
  const extra = p.filter((_, i) => !used[i]);
  return {
    truthN: t.length,
    predN: p.length,
    exact,
    missed: missed.length,
    extra: extra.length,
    allExact: missed.length === 0 && extra.length === 0,
    missedEvents: missed,
    extraEvents: extra,
  };
}

async function waitForHome(page) {
  await page.goto(baseURL, { waitUntil: "domcontentloaded", timeout: 60_000 });
  // The product home has 识别图片. Be patient with first JS load.
  const trigger = page.getByRole("button", { name: /识别图片/ }).or(page.locator('[aria-label="上传谱子图片文件"]'));
  await trigger.first().waitFor({ timeout: 60_000 });
}

async function uploadAndRecognize(page, imagePath) {
  await waitForHome(page);
  const fileInput = page.locator('input[type="file"][accept*="image"], input[type="file"][aria-label*="谱"], input[type="file"]').first();
  // The visible control may be a label/button that opens a hidden file input.
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
    // Click 识别图片, then set the file chooser.
    const chooserPromise = page.waitForEvent("filechooser", { timeout: 10_000 });
    await page.getByRole("button", { name: /识别图片/ }).click();
    const chooser = await chooserPromise;
    await chooser.setFiles(imagePath);
  }
  // Wait for the OMR panel (lazy).
  const recognizeBtn = page.getByRole("button", { name: /识别全部页并合并预览/ });
  await recognizeBtn.waitFor({ timeout: 30_000 });
  // Banner should mention 几何 if the API is up.
  const banner = await page.locator("[data-geom-engine='copisteria-geom'], h3").first().textContent();
  await recognizeBtn.click();
  // Wait until the confirm-draft button appears, or an error status.
  const dialog = page.getByRole("dialog", { name: /识别草稿/ });
  const editBtn = page.getByRole("button", { name: /编辑识别草稿/ });
  try {
    await dialog.waitFor({ timeout: Math.min(15_000, timeoutMs) });
  } catch {
    await editBtn.waitFor({ timeout: timeoutMs });
    await editBtn.click();
    await dialog.waitFor({ timeout: 30_000 });
  }
  const hook = await page.evaluate(() => window.__PUXIAN_GEOM_PREVIEW__ || null);
  return { hook, banner };
}

async function closeDraft(page) {
  const abandon = page.getByRole("button", { name: /放弃识别草稿/ });
  if (await abandon.count()) {
    await abandon.click();
    // Also close the image panel if a close/cancel exists; otherwise reload.
  }
  await page.goto("about:blank");
}

const results = [];
const browser = await chromium.launch({
  headless: !headed,
  channel: process.env.GEOM_E2E_CHANNEL || undefined,
});
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
page.setDefaultTimeout(timeoutMs);

let allOk = true;
try {
  // Health check
  const statusRes = await page.request.get(new URL("/api/geom-omr/status", baseURL).href);
  const status = await statusRes.json();
  console.log("status", JSON.stringify(status));
  if (!status?.ok) {
    throw new Error("geom API status is not ok; refusing to run SMT fallback as acceptance");
  }
  for (const c of suite.cases) {
    const imagePath = join(samplesDir, c.image);
    if (!existsSync(imagePath)) {
      results.push({ id: c.id, error: `missing image ${imagePath}`, allExact: false });
      allOk = false;
      console.log("FAIL missing", c.id, imagePath);
      continue;
    }
    console.log(">>>", c.id, c.image);
    const started = Date.now();
    try {
      const { hook, banner } = await uploadAndRecognize(page, imagePath);
      const usedGeom = Boolean(hook?.usedGeom) || hook?.engine === "copisteria-geom";
      const editor = hook?.editorScore || hook?.score;
      if (!usedGeom) {
        allOk = false;
        results.push({ id: c.id, error: "editor did not use geom path", hook, banner, allExact: false });
        console.log("FAIL not geom", c.id, hook);
        await closeDraft(page);
        continue;
      }
      if (!editor) {
        allOk = false;
        results.push({ id: c.id, error: "no editorScore on hook", hook, allExact: false });
        console.log("FAIL no editor score", c.id);
        await closeDraft(page);
        continue;
      }
      const [w0, w1] = c.window ?? [0, null];
      const pred = windowEvents(eventsFromScore(editor), w0, w1);
      const sc = compare(c.truth, pred);
      sc.id = c.id;
      sc.expect = c.expect;
      sc.usedGeom = usedGeom;
      sc.engine = hook.engine;
      sc.elapsedMs = Date.now() - started;
      sc.banner = hook.banner || banner;
      results.push(sc);
      const flag = sc.allExact ? "OK" : "FAIL";
      if (!sc.allExact) allOk = false;
      console.log(flag, c.id, `${sc.exact}/${sc.truthN}`, "extra", sc.extra, "ms", sc.elapsedMs);
    } catch (err) {
      allOk = false;
      results.push({ id: c.id, error: String(err), allExact: false, elapsedMs: Date.now() - started });
      console.log("FAIL", c.id, err);
    }
    await closeDraft(page);
  }
} finally {
  await browser.close();
}

const summary = {
  ok: allOk,
  url: baseURL,
  scored: results.filter((r) => r.exact != null).length,
  allExactCount: results.filter((r) => r.allExact).length,
  n: results.length,
  results,
};
writeFileSync(outPath, JSON.stringify(summary, null, 2));
console.log("wrote", outPath);
console.log(allOk ? "E2E_ALL_EXACT" : "E2E_FAILED");
process.exit(allOk ? 0 : 1);
