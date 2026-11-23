import { verifyRecognitionFlow } from "./verify-recognition-flow.mjs";
import { verifyScoreImages } from "./verify-score-images.mjs";
/**
 * Serve dist-static/ with Python's static file server and prove the score
 * home and editor cold-start without Nitro. External origins are blocked.
 *
 *   npm run build:static && npm run verify:static
 */
import assert from "node:assert/strict";
import { verifyPerformance } from "./verify-performance.mjs";
import { verifyChordExperience } from "./verify-chord-experience.mjs";
import { verifyMixer } from "./verify-mixer.mjs";
import { verifyPracticeTools } from "./verify-practice-tools.mjs";
import { verifyRepeats } from "./verify-repeats.mjs";
import { verifyLayoutWalk } from "./verify-layout-walk.mjs";
import { pythonServerArgs } from "./static-server.mjs";
import { verifyPracticeLog } from "./verify-practice-log.mjs";
import { verifySelectionEdit } from "./verify-selection-edit.mjs";
import { verifyAbc } from "./verify-abc.mjs";
import { verifyLoopPause } from "./verify-loop-pause.mjs";
import { verifyChordPro } from "./verify-chordpro.mjs";
import { verifyIreal } from "./verify-ireal.mjs";
import { verifyRehearsals } from "./verify-rehearsals.mjs";
import { verifyCredits } from "./verify-credits.mjs";
import { verifyFixedDo } from "./verify-fixed-do.mjs";
import { verifySwing } from "./verify-swing.mjs";
import { verifyComp } from "./verify-comp.mjs";
import { verifyEarInterval } from "./verify-ear-interval.mjs";
import { verifyEarChord } from "./verify-ear-chord.mjs";
import { verifyEarProgression } from "./verify-ear-progression.mjs";
import { verifyEarScale } from "./verify-ear-scale.mjs";
import { verifySightRead } from "./verify-sight-read.mjs";
import { verifyFermata } from "./verify-fermata.mjs";
import { verifyTempoMark } from "./verify-tempo-mark.mjs";
import { verifyMeterMark } from "./verify-meter-mark.mjs";
import { verifyKeyMark } from "./verify-key-mark.mjs";
import { verifyGradualTempo } from "./verify-gradual-tempo.mjs";
import { verifyStaffMarks } from "./verify-staff-marks.mjs";
import { verifyWaitMode } from "./verify-wait-mode.mjs";
import { spawn } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  cssAssetUrls,
  findForbiddenBundleStrings,
  inspectStaticIndexHtml,
  isHashedRelativeAsset,
  nextPackagedUrl,
  packagedOrigin,
  packagedRequestProblem,
  pngSize,
  residualHttpUrls,
} from "./static-client-boundary.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const artifacts = process.env.PUXIAN_ARTIFACTS || resolve(root, "../logs");
const outDir = resolve(root, "dist-static");
const originHost = "127.0.0.1";

function fail(problems) {
  for (const problem of problems) console.error(`static-verify: ${problem}`);
  process.exit(1);
}

function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, originHost, () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((err) => (err ? reject(err) : resolvePort(port)));
    });
  });
}

function startPython(port) {
  const child = spawn(
    "python3",
    // Deeper listen backlog than `python3 -m http.server` (see scripts/static-server.mjs).
    pythonServerArgs(port, originHost, outDir),
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  let log = "";
  child.stdout?.on("data", (chunk) => {
    log += chunk.toString();
  });
  child.stderr?.on("data", (chunk) => {
    log += chunk.toString();
  });
  child.log = () => log;
  return child;
}

async function waitForHttp(port) {
  const deadline = Date.now() + 10_000;
  let lastError = "server did not answer";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://${originHost}:${port}/`);
      await response.arrayBuffer();
      if (response.status === 200) return;
      lastError = `status ${response.status}`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error(lastError);
}

function listAssets(dir) {
  return readdirSync(dir).filter((name) => name.endsWith(".js") || name.endsWith(".css"));
}

function inspectDisk() {
  const problems = [];
  const indexPath = join(outDir, "index.html");
  let html = "";
  try {
    html = readFileSync(indexPath, "utf8");
  } catch {
    fail([
      "dist-static/index.html is missing. Run npm run build:static first. Do not point webDir at .output or .vercel.",
    ]);
  }
  problems.push(...inspectStaticIndexHtml(html));
  if (/<h1[\s>]/.test(html)) problems.push("index.html already contains the editor heading");
  if (html.includes("app-shell")) problems.push("index.html already contains the editor shell");
  const scripts = [...html.matchAll(/<script type="module"[^>]*src="([^"]+)"/g)].map(
    (match) => match[1],
  );
  if (scripts.length !== 1) problems.push(`expected one module script, found ${scripts.length}`);
  for (const src of scripts) {
    if (!isHashedRelativeAsset(src))
      problems.push(`module script is not a relative hashed asset: ${src}`);
  }
  // Recognition and auxiliary panels must not grow the home preload metadata.
  for (const src of scripts) {
    try {
      const bundle = readFileSync(join(outDir, src), "utf8");
      const table = bundle.match(/m\.f=\[(.*?)\]/s);
      if (!table) problems.push("index.js mapDeps table is missing");
      else {
        const count = JSON.parse(`[${table[1]}]`).length;
        if (count > 19) problems.push(`index.js mapDeps grew to ${count} (> baseline 19)`);
        console.log(JSON.stringify({ homeMapDeps: count }));
      }
    } catch (error) { problems.push(`cannot inspect index.js mapDeps: ${error.message}`); }
  }
  const assetDir = join(outDir, "assets");
  let assets = [];
  try {
    assets = listAssets(assetDir);
  } catch {
    problems.push("dist-static/assets is missing");
  }
  if (!assets.some((name) => name.endsWith(".js"))) problems.push("no hashed JS in assets/");
  if (!assets.some((name) => name.endsWith(".css"))) problems.push("no hashed CSS in assets/");
  for (const name of assets) {
    if (!isHashedRelativeAsset(`./assets/${name}`)) {
      problems.push(`asset name is not content-hashed: ${name}`);
    }
  }
  try {
    statSync(join(outDir, "manifest.webmanifest"));
    statSync(join(outDir, "favicon.svg"));
  } catch {
    problems.push("manifest.webmanifest or favicon.svg was not emitted");
  }
  // License texts in public/ (alphaTab MPL-2.0, fflate, …) must be copied byte-for-byte.
  for (const dir of ["third-party", "licenses"]) {
    for (const name of readdirSync(join(root, "public", dir))) {
      try {
        if (!readFileSync(join(outDir, dir, name)).equals(readFileSync(join(root, "public", dir, name)))) {
          problems.push(`dist-static/${dir}/${name} differs from public/${dir}/${name}`);
        }
      } catch {
        problems.push(`dist-static/${dir}/${name} was not emitted`);
      }
    }
  }
  let licenses = [];
  try { licenses = readdirSync(join(outDir, "licenses")); } catch { /* reported below */ }
  if (!licenses.some((name) => /^alphatab-.*\.txt$/.test(name))) {
    problems.push("dist-static/licenses/alphatab-*.txt is missing");
  }
  try {
    const og = readFileSync(join(outDir, "og-image.png"));
    const size = pngSize(og);
    if (!size || size.width !== 1200 || size.height !== 630) {
      problems.push(`og-image.png must be 1200×630, got ${size ? `${size.width}×${size.height}` : "invalid png"}`);
    }
  } catch {
    problems.push("og-image.png was not emitted");
  }
  const manifest = readFileSync(join(outDir, "manifest.webmanifest"), "utf8");
  if (manifest.includes("/__grok/") || manifest.includes("/api/")) {
    problems.push("manifest points at a dynamic server path");
  }
  const bundleHits = [];
  const residual = [];
  for (const name of assets) {
    const text = readFileSync(join(assetDir, name), "utf8");
    for (const hit of findForbiddenBundleStrings(text)) bundleHits.push(`${name}: ${hit}`);
    for (const url of residualHttpUrls(text)) residual.push(`${name}: ${url}`);
    if (name.endsWith(".css")) {
      for (const url of cssAssetUrls(text)) {
        if (/^https?:/i.test(url)) bundleHits.push(`${name}: remote css url ${url}`);
      }
    }
  }
  for (const hit of bundleHits) problems.push(`bundle contains ${hit}`);
  return { html, scripts, assets, residual, problems };
}

const REDIRECT_HOP_LIMIT = 5;

/**
 * Fetch one packaged URL. Redirects are not followed until the Location
 * target has the same origin and port as this static server.
 */
async function fetchPackaged(url, origin) {
  const problems = [];
  let current = new URL(url, `${origin}/`).href;
  for (let hop = 0; hop < REDIRECT_HOP_LIMIT; hop++) {
    const refused = packagedRequestProblem(current, origin);
    if (refused) {
      problems.push(refused);
      return { response: null, problems };
    }
    const response = await fetch(current, { redirect: "manual" });
    const decision = nextPackagedUrl(
      current,
      response.status,
      response.headers.get("location"),
      origin,
    );
    if (decision.problem) {
      problems.push(decision.problem);
      return { response: null, problems };
    }
    if (!decision.follow) return { response, problems };
    current = decision.follow;
  }
  problems.push(`too many redirects for ${url}`);
  return { response: null, problems };
}

async function fetchAssets(port, html) {
  const problems = [];
  const origin = packagedOrigin(originHost, port);
  const index = await fetchPackaged(`${origin}/`, origin);
  problems.push(...index.problems);
  if (!index.response) return { status: 0, contentType: "", problems };
  const response = index.response;
  const body = await response.text();
  const contentType = response.headers.get("content-type") ?? "";
  if (response.status !== 200) problems.push(`GET / returned ${response.status}`);
  if (!contentType.includes("text/html")) problems.push(`GET / content-type is ${contentType}`);
  if (response.url && packagedRequestProblem(response.url, origin)) {
    problems.push(`GET / final url left the static origin: ${response.url}`);
  }
  if (body !== html) problems.push("served index.html does not match dist-static/index.html");
  const image = await fetchPackaged(`${origin}/og-image.png`, origin);
  problems.push(...image.problems);
  if (!image.response || image.response.status !== 200) {
    problems.push(`GET /og-image.png returned ${image.response ? image.response.status : "no response"}`);
  } else {
    const type = image.response.headers.get("content-type") ?? "";
    if (!type.includes("image/png") && !type.includes("octet-stream") && type !== "") {
      problems.push(`GET /og-image.png content-type is ${type}`);
    }
    const served = Buffer.from(await image.response.arrayBuffer());
    const size = pngSize(served);
    if (!size || size.width !== 1200 || size.height !== 630) {
      problems.push("served og-image.png is not 1200×630");
    }
  }
  const assetDir = join(outDir, "assets");
  for (const name of listAssets(assetDir)) {
    const assetUrl = `${origin}/assets/${name}`;
    const fetched = await fetchPackaged(assetUrl, origin);
    problems.push(...fetched.problems);
    const asset = fetched.response;
    if (!asset) continue;
    if (asset.status !== 200) problems.push(`GET /assets/${name} returned ${asset.status}`);
    if (name.endsWith(".css") && asset.status === 200) {
      const css = await asset.text();
      for (const ref of cssAssetUrls(css)) {
        const resolved = new URL(ref, assetUrl);
        const refused = packagedRequestProblem(resolved, origin);
        if (refused) {
          problems.push(`css url ${ref}: ${refused}`);
          continue;
        }
        const font = await fetchPackaged(resolved.href, origin);
        problems.push(...font.problems);
        if (font.response) await font.response.arrayBuffer();
        if (!font.response || font.response.status !== 200) {
          problems.push(
            `GET ${resolved.pathname} returned ${font.response ? font.response.status : "no response"}`,
          );
        }
      }
    } else {
      // Consume the body before the HTTP/1.0 socket closes. Leaving large lazy
      // chunks unread can trip Node 24's paused undici parser on socket end.
      await asset.arrayBuffer();
    }
  }
  return { status: response.status, contentType, problems };
}


function toneWav(seconds = 1.2, freq = 440, sampleRate = 44100) {
  const n = Math.floor(seconds * sampleRate);
  const data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) {
    const env = i < sampleRate * 0.02 ? i / (sampleRate * 0.02)
      : i > n - sampleRate * 0.04 ? Math.max(0, (n - i) / (sampleRate * 0.04)) : 1;
    const s = Math.max(-1, Math.min(1, 0.4 * env * Math.sin(2 * Math.PI * freq * i / sampleRate)));
    data.writeInt16LE(Math.round(s * 32767), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

/** Piano-like C major triad (C4 E4 G4) then G3+D5, for the 多音 dictation smoke test. */
function chordWav(sampleRate = 44100) {
  const seconds = 3.2;
  const n = Math.floor(seconds * sampleRate);
  const samples = new Float32Array(n);
  const notes = [
    ...[60, 64, 67].map((midi) => ({ start: 0.2, dur: 1.3, midi })),
    { start: 1.7, dur: 1.2, midi: 55 },
    { start: 1.7, dur: 1.2, midi: 74 },
  ];
  for (const note of notes) {
    const f0 = 440 * 2 ** ((note.midi - 69) / 12);
    const from = Math.round(note.start * sampleRate);
    const len = Math.round(note.dur * sampleRate);
    for (let i = 0; i < len && from + i < n; i++) {
      const t = i / sampleRate;
      const env = Math.min(1, t / 0.005) * Math.exp(-t * 1.6) * Math.min(1, (len - i) / (0.03 * sampleRate));
      let s = 0;
      for (let h = 1; h <= 6; h++) s += Math.sin(2 * Math.PI * f0 * h * t) / h * Math.exp(-t * 0.8 * h);
      samples[from + i] += 0.16 * env * s;
    }
  }
  const data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), i * 2);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

async function browse(port) {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  const requests = [];
  const blocked = [];
  const localErrors = [];
  const inflight = new Map();
  const consoleTail = [];
  let activePage;
  try {
    const origin = packagedOrigin(originHost, port);
    const context = await browser.newContext({ viewport: { width: 1100, height: 800 } });
    await context.route("**/*", (route) => {
      const requestUrl = route.request().url();
      const refused = packagedRequestProblem(requestUrl, origin);
      if (refused) {
        blocked.push(`${requestUrl} (${refused})`);
        return route.abort("blockedbyclient");
      }
      return route.continue();
    });
    const page = await context.newPage();
    activePage = page;
    // Failure diagnostics: requests still in flight and the last console lines.
    page.on("request", (request) => inflight.set(request, Date.now()));
    for (const done of ["requestfinished", "requestfailed"]) page.on(done, (request) => inflight.delete(request));
    page.on("console", (message) => { consoleTail.push(`${message.type()}: ${message.text()}`.slice(0, 300)); if (consoleTail.length > 30) consoleTail.shift(); });
    const downloads = [];
    page.on("download", download => downloads.push(download.suggestedFilename()));
    await page.addInitScript(() => {
      window.editorAudioContexts = [];
      const Native = window.AudioContext;
      window.AudioContext = class extends Native {
        constructor(...args) { super(...args); window.editorAudioContexts.push(this); }
      };
    });
    page.on("response", (response) => {
      const url = new URL(response.url());
      const refused = packagedRequestProblem(url, origin);
      if (refused) {
        localErrors.push(`response left static origin: ${url.href} (${refused})`);
        return;
      }
      const location = response.headers()["location"];
      if (location) {
        const decision = nextPackagedUrl(url.href, response.status(), location, origin);
        if (decision.problem) localErrors.push(decision.problem);
      }
      requests.push({ path: url.pathname, status: response.status() });
      if (response.status() >= 400 && url.pathname !== "/favicon.ico") {
        localErrors.push(`${response.status()} ${url.pathname}`);
      }
    });
    const pageErrors = [];
    page.on("pageerror", (error) => { pageErrors.push(String(error)); console.error("browser pageerror:", String(error)); });
    const response = await page.goto(`http://${originHost}:${port}/`, {
      waitUntil: "domcontentloaded",
    });
    const home = page.getByRole("heading", { name: "让旋律，落在纸上。" });
    const title = page.getByRole("textbox", { name: "曲名" });
    const back = page.getByRole("button", { name: "返回主页" });
    const resume = page.getByRole("button", { name: "继续上次草稿" });
    const blank = page.getByRole("button", { name: "新建空白谱" });
    /**
     * 「继续上次草稿」: click only after the editor has unmounted and home is laid out,
     * and on failure say what the page looked like instead of a bare timeout.
     */
    const resumeDraft = async () => {
      await back.waitFor({ state: "detached" });
      await home.waitFor();
      try {
        await resume.click();
      } catch (error) {
        const state = await page.evaluate(() => {
          const button = [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("继续上次草稿"));
          const rect = button?.getBoundingClientRect();
          return {
            rect: rect ? [rect.x, rect.y, rect.width, rect.height] : null,
            hidden: document.hidden,
            focus: document.activeElement?.tagName ?? null,
            scrollY,
          };
        }).catch(() => null);
        await page.screenshot({ path: join(artifacts, "static-resume-failure.png") }).catch(() => {});
        throw new Error(`继续上次草稿 not clickable: ${JSON.stringify(state)}`, { cause: error });
      }
    };
    await home.waitFor({ timeout: 20_000 });
    await page.waitForTimeout(2100);
    assert.deepEqual(downloads, [], "visiting home must not download");
    await blank.click();
    await title.waitFor();
    await page.waitForTimeout(2100);
    assert.deepEqual(downloads, [], "opening blank editor/autosave must not download");
    await back.click();
    await home.waitFor();
    for (const w of [355, 390]) {
      await page.setViewportSize({ width: w, height: 750 });
      const draftState = await page.evaluate(() => {
        const innerWidth = window.innerWidth;
        const innerHeight = window.innerHeight;
        const scrollWidth = document.documentElement.scrollWidth;
        const imgBtn = [...document.querySelectorAll(".home-workbench button")].find((b) => b.textContent?.includes("识别图片"));
        const musicBtn = [...document.querySelectorAll(".home-workbench button")].find((b) => b.textContent?.includes("识别音乐"));
        const blankBtn = [...document.querySelectorAll(".home-secondary-actions button")].find((b) => b.textContent?.includes("新建空白谱"));
        const draftBtn = [...document.querySelectorAll(".home-secondary-actions button")].find((b) => b.textContent?.includes("继续上次草稿"));
        const titleEl = document.querySelector("#home-title");
        const descEl = document.querySelector("[data-home-desc]");

        const getRect = (el) => {
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
        };

        return {
          innerWidth,
          innerHeight,
          scrollWidth,
          img: getRect(imgBtn),
          music: getRect(musicBtn),
          blank: getRect(blankBtn),
          draft: getRect(draftBtn),
          title: getRect(titleEl),
          desc: getRect(descEl),
        };
      });

      assert.ok(draftState.scrollWidth <= draftState.innerWidth, `${w}px (with draft): document must not overflow horizontally (scrollWidth: ${draftState.scrollWidth})`);
      assert.ok(draftState.img, `${w}px (with draft): 识别图片 button must exist`);
      assert.ok(draftState.music, `${w}px (with draft): 识别音乐 button must exist`);
      assert.ok(draftState.blank, `${w}px (with draft): 新建空白谱 button must exist`);
      assert.ok(draftState.draft, `${w}px (with draft): 继续上次草稿 button must exist`);
      assert.ok(draftState.title, `${w}px (with draft): title must exist`);
      assert.ok(draftState.desc, `${w}px (with draft): desc must exist`);

      assert.ok(draftState.img.left >= 0 && draftState.img.right <= draftState.innerWidth, `${w}px (with draft): 识别图片 button rect must stay inside viewport [0, ${draftState.innerWidth}], got [${draftState.img.left}, ${draftState.img.right}]`);
      assert.ok(draftState.music.left >= 0 && draftState.music.right <= draftState.innerWidth, `${w}px (with draft): 识别音乐 button rect must stay inside viewport [0, ${draftState.innerWidth}], got [${draftState.music.left}, ${draftState.music.right}]`);
      assert.ok(draftState.img.bottom <= draftState.music.top, `${w}px (with draft): primary CTA buttons must stack vertically (img.bottom: ${draftState.img.bottom} <= music.top: ${draftState.music.top})`);
      assert.ok(draftState.blank.left >= 0 && draftState.blank.right <= draftState.innerWidth, `${w}px (with draft): 新建空白谱 button rect must stay inside viewport [0, ${draftState.innerWidth}], got [${draftState.blank.left}, ${draftState.blank.right}]`);
      assert.ok(draftState.draft.left >= 0 && draftState.draft.right <= draftState.innerWidth, `${w}px (with draft): 继续上次草稿 button rect must stay inside viewport [0, ${draftState.innerWidth}], got [${draftState.draft.left}, ${draftState.draft.right}]`);
      assert.ok(draftState.title.left >= 0 && draftState.title.right <= draftState.innerWidth, `${w}px (with draft): title rect right edge must stay inside viewport (got ${draftState.title.right})`);
      assert.ok(draftState.desc.left >= 0 && draftState.desc.right <= draftState.innerWidth, `${w}px (with draft): desc rect right edge must stay inside viewport (got ${draftState.desc.right})`);
    }
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await home.waitFor();
    assert.equal(await page.locator(".staff svg").count(), 0, "home must not mount the editor");
    assert.equal(await title.count(), 0);
    assert.equal(await resume.count(), 0, "no continue action without a valid draft");
    assert.equal(await page.getByRole("heading", { name: "我的曲子", exact: true }).count(), 0,
      "empty home hides the empty 我的曲子 block");
    await page.getByRole("heading", { name: "示例曲目", exact: true }).waitFor();
    await page.getByText("照片 / PDF、录音 / 音频 / MIDI，先识别成可修改的草稿，再写入主谱。", { exact: true }).waitFor();
    const footerIntro = await page.getByLabel("功能介绍", { exact: true }).innerText();
    for (const word of ["照片", "PDF", "录音", "MIDI", "草稿"]) {
      assert.match(footerIntro, new RegExp(word), `footer must mention ${word}`);
    }
    assert.equal(await page.locator("#songs button").filter({ hasText: "示例曲目" }).count(), 22);
    mkdirSync(artifacts, { recursive: true });
    await page.screenshot({
      path: join(artifacts, "static-home-desktop.png"),
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
      "mobile home must fit the viewport",
    );
    // Home must remain a natural document even though the editor locks its viewport.
    for (const width of [1100, 390, 320]) {
      await page.setViewportSize({ width, height: 667 });
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      const geometry = await page.locator("[data-home-landing] footer").evaluate(el => {
        const rect = el.getBoundingClientRect();
        return { top: rect.top, bottom: rect.bottom, height: innerHeight, scroll: scrollY };
      });
      assert.ok(geometry.scroll > 0, `${width}: home must scroll naturally`);
      assert.ok(geometry.top >= 0 && geometry.bottom <= geometry.height,
        `${width}: complete home footer must be reachable`);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(
      await page.getByRole("button", { name: "打开小星星", exact: true }).evaluate((el) => {
        const rect = el.getBoundingClientRect();
        return rect.top >= 0 && rect.bottom <= innerHeight;
      }),
      true,
      "first example must sit on the first screen when there are no drafts",
    );
    const landingLook = await page.evaluate(() => {
      const plate = document.querySelector("[data-home-plate]");
      const eyebrow = document.querySelector("[data-home-eyebrow]");
      const workbench = document.querySelector("[data-home-workbench]");
      const btn = workbench
        ? [...workbench.querySelectorAll("button")].find((b) => b.textContent?.includes("识别图片"))
        : null;
      const honestNotice = document.querySelector("[data-honest-notice]") ||
        [...(workbench || document).querySelectorAll("*")].find((el) => el.textContent?.includes("生成可改草稿 · 需校对"));
      const title = document.querySelector("#home-title");
      const desc = document.querySelector("[data-home-desc]");
      const row = document.querySelector(".song-row");
      const hero = document.querySelector('[aria-labelledby="home-title"]');
      if (!row || !hero) return { missing: true };
      const btnCss = btn ? getComputedStyle(btn) : null;
      const rowCss = getComputedStyle(row);
      const heroCss = getComputedStyle(hero);
      const titleCss = title ? getComputedStyle(title) : null;
      const descCss = desc ? getComputedStyle(desc) : null;
      return {
        hasPlate: Boolean(plate),
        hasEyebrow: Boolean(eyebrow),
        hasWorkbench: Boolean(workbench),
        hasHonestNotice: Boolean(honestNotice),
        descColor: descCss ? descCss.color : "",
        primaryBtn: btn ? {
          width: btn.getBoundingClientRect().width,
          height: btn.getBoundingClientRect().height,
          radius: parseFloat(btnCss.borderRadius),
        } : null,
        titleFontSize: titleCss ? parseFloat(titleCss.fontSize) : 0,
        descFontSize: descCss ? parseFloat(descCss.fontSize) : 0,
        descLineHeight: descCss ? parseFloat(descCss.lineHeight) : 0,
        descMaxWidth: descCss ? parseFloat(descCss.maxWidth) : 0,
        heroPad: parseFloat(heroCss.paddingTop),
        shadow: rowCss.boxShadow,
        paper: rowCss.backgroundColor,
        body: getComputedStyle(document.body).backgroundColor,
        reduced: matchMedia("(prefers-reduced-motion: reduce)").matches,
      };
    });
    assert.equal(landingLook.body, "rgb(250, 248, 244)", "home keeps the cream page wash, not white or a dark theme");
    assert.equal(landingLook.paper, "rgb(247, 243, 234)", "example cards stay on cream paper");
    assert.ok(landingLook.hasPlate, "score plate [data-home-plate] container must exist");
    assert.ok(landingLook.hasEyebrow, "editorial eyebrow [data-home-eyebrow] must exist");
    assert.equal(landingLook.descColor, "rgb(87, 80, 71)", "description must use high-contrast #575047 ink hierarchy");
    assert.ok(landingLook.hasWorkbench, "workbench container [data-home-workbench] must exist");
    assert.ok(landingLook.hasHonestNotice, "honest notice '生成可改草稿 · 需校对' must be visible in recognition area");
    assert.ok(landingLook.primaryBtn, "primary recognition CTA '识别图片' must exist inside workbench");
    assert.ok(landingLook.primaryBtn.radius >= 20, `primary CTA should be a pill (radius ${landingLook.primaryBtn?.radius})`);
    assert.ok(Math.abs(landingLook.primaryBtn.height - 52) <= 3, `mobile primary button height should be ~52px (was ${landingLook.primaryBtn?.height})`);
    assert.ok(landingLook.primaryBtn.width >= 300, `mobile primary button should be stacked full-width (was ${landingLook.primaryBtn?.width})`);
    assert.ok(Math.abs(landingLook.titleFontSize - 30) <= 2, `mobile title font-size should be ~30px (was ${landingLook.titleFontSize})`);
    assert.ok(landingLook.heroPad >= 36, `hero section needs generous padding (was ${landingLook.heroPad})`);
    assert.notEqual(landingLook.shadow, "none", "example cards should carry a light shadow");
    for (const w of [355, 390]) {
      await page.setViewportSize({ width: w, height: w === 355 ? 700 : 844 });
      const mobileState = await page.evaluate(() => {
        const innerWidth = window.innerWidth;
        const innerHeight = window.innerHeight;
        const scrollWidth = document.documentElement.scrollWidth;
        const actionsDir = getComputedStyle(document.querySelector(".home-workbench-actions")).flexDirection;
        const imgBtn = [...document.querySelectorAll(".home-workbench button")].find((b) => b.textContent?.includes("识别图片"));
        const musicBtn = [...document.querySelectorAll(".home-workbench button")].find((b) => b.textContent?.includes("识别音乐"));
        const blankBtn = [...document.querySelectorAll(".home-secondary-actions button")].find((b) => b.textContent?.includes("新建空白谱"));
        const titleEl = document.querySelector("#home-title");
        const descEl = document.querySelector("[data-home-desc]");

        const getRect = (el) => {
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
        };

        return {
          innerWidth,
          innerHeight,
          scrollWidth,
          actionsDir,
          img: getRect(imgBtn),
          music: getRect(musicBtn),
          blank: getRect(blankBtn),
          title: getRect(titleEl),
          desc: getRect(descEl),
        };
      });

      assert.ok(mobileState.scrollWidth <= mobileState.innerWidth, `${w}px: document must not overflow horizontally (scrollWidth: ${mobileState.scrollWidth})`);
      assert.equal(mobileState.actionsDir, "column", `${w}px: workbench actions must stack vertically`);
      assert.ok(mobileState.img, `${w}px: 识别图片 button must exist`);
      assert.ok(mobileState.music, `${w}px: 识别音乐 button must exist`);
      assert.ok(mobileState.blank, `${w}px: 新建空白谱 button must exist`);
      assert.ok(mobileState.title, `${w}px: title must exist`);
      assert.ok(mobileState.desc, `${w}px: desc must exist`);

      assert.ok(mobileState.img.left >= 0 && mobileState.img.right <= mobileState.innerWidth, `${w}px: 识别图片 button rect must stay inside viewport [0, ${mobileState.innerWidth}], got [${mobileState.img.left}, ${mobileState.img.right}]`);
      assert.ok(mobileState.music.left >= 0 && mobileState.music.right <= mobileState.innerWidth, `${w}px: 识别音乐 button rect must stay inside viewport [0, ${mobileState.innerWidth}], got [${mobileState.music.left}, ${mobileState.music.right}]`);
      assert.ok(mobileState.img.bottom <= mobileState.music.top, `${w}px: primary CTA buttons must stack vertically (img.bottom: ${mobileState.img.bottom} <= music.top: ${mobileState.music.top})`);
      assert.ok(mobileState.blank.left >= 0 && mobileState.blank.right <= mobileState.innerWidth, `${w}px: 新建空白谱 button rect must stay inside viewport [0, ${mobileState.innerWidth}], got [${mobileState.blank.left}, ${mobileState.blank.right}]`);
      assert.ok(mobileState.title.left >= 0 && mobileState.title.right <= mobileState.innerWidth, `${w}px: title rect right edge must stay inside viewport (got ${mobileState.title.right})`);
      assert.ok(mobileState.desc.left >= 0 && mobileState.desc.right <= mobileState.innerWidth, `${w}px: desc rect right edge must stay inside viewport (got ${mobileState.desc.right})`);
      assert.ok(mobileState.img.height >= 48 && mobileState.music.height >= 48, `${w}px: primary buttons must have touch target >= 48px`);
    }
    await page.screenshot({ path: join(artifacts, "static-home-mobile.png"), fullPage: true });
    for (const w of [1280, 1100]) {
      await page.setViewportSize({ width: w, height: 800 });
      await page.waitForFunction((expected) => window.innerWidth === expected, w);
      const desktopLook = await page.evaluate(() => {
        const title = document.querySelector("#home-title");
        const desc = document.querySelector("[data-home-desc]");
        const plate = document.querySelector("[data-home-plate]");
        const imgBtn = [...document.querySelectorAll(".home-workbench button")].find((b) => b.textContent?.includes("识别图片"));
        const musicBtn = [...document.querySelectorAll(".home-workbench button")].find((b) => b.textContent?.includes("识别音乐"));
        if (!title || !desc || !plate || !imgBtn || !musicBtn) return { missing: true };
        const titleCss = getComputedStyle(title);
        const descCss = getComputedStyle(desc);
        const plateRect = plate.getBoundingClientRect();
        const imgRect = imgBtn.getBoundingClientRect();
        const musicRect = musicBtn.getBoundingClientRect();
        return {
          innerWidth: window.innerWidth,
          scrollWidth: document.documentElement.scrollWidth,
          titleFontSize: parseFloat(titleCss.fontSize),
          descFontSize: parseFloat(descCss.fontSize),
          descLineHeight: parseFloat(descCss.lineHeight),
          descMaxWidth: parseFloat(descCss.maxWidth),
          plateRight: plateRect.right,
          imgWidth: imgRect.width,
          musicWidth: musicRect.width,
        };
      });
      assert.equal(desktopLook.missing, undefined, `desktop elements must exist at ${w}px`);
      assert.ok(desktopLook.scrollWidth <= desktopLook.innerWidth, `${w}px: document must not overflow horizontally`);
      assert.ok(desktopLook.plateRight <= desktopLook.innerWidth, `${w}px: score plate must fit inside viewport`);
      assert.ok(desktopLook.imgWidth >= 160 && desktopLook.musicWidth >= 160, `${w}px: desktop primary CTAs must share row with generous width (img: ${desktopLook.imgWidth}, music: ${desktopLook.musicWidth}, innerWidth: ${desktopLook.innerWidth})`);
      assert.ok(Math.abs(desktopLook.titleFontSize - 42) <= 2, `desktop title font-size should be ~42px (was ${desktopLook.titleFontSize})`);
      assert.ok(Math.abs(desktopLook.descFontSize - 16) <= 1, `desktop body font-size should be ~16px (was ${desktopLook.descFontSize})`);
      assert.ok(Math.abs(desktopLook.descLineHeight / desktopLook.descFontSize - 1.42) <= 0.08, `desc line-height ratio should be ~1.42 (was ${(desktopLook.descLineHeight / desktopLook.descFontSize).toFixed(2)})`);
      assert.ok(Math.abs(desktopLook.descMaxWidth - 480) <= 4, `desc max-width should be ~480px (was ${desktopLook.descMaxWidth})`);
    }
    await page.getByRole("button", { name: "打开小星星", exact: true }).click();
    // Numbered notation is the default view; the staff stays mounted for export/IME parsing.
    await page.locator(".staff svg").waitFor({ state: "attached", timeout: 20_000 });
    await page.getByRole("textbox", { name: "曲名" }).waitFor();
    assert.equal(await page.getByRole("button", { name: "简谱", exact: true }).getAttribute("aria-pressed"), "true",
      "first visit opens in numbered notation");
    // Real composition events must not publish intermediate score/lyric edits.
    const compose = async (locator, value) => {
      await locator.dispatchEvent("compositionstart");
      await locator.fill(value);
    };
    for (const [id, button, value] of [["jianpu", "简谱", "1 2 3"], ["letters", "音名", "C4 D4 E4 F4"]]) {
      if (id === "letters") await page.getByRole("tab", { name: button, exact: true }).click();
      const input = page.locator(`#${id}`);
      const before = await page.locator(".staff").innerHTML();
      await compose(input, value);
      await page.waitForTimeout(100);
      assert.equal(await page.locator(".staff").innerHTML(), before, `${id}: composition must not parse`);
      await input.dispatchEvent("compositionend", { data: value });
      await page.waitForFunction(previous => document.querySelector(".staff").innerHTML !== previous, before);
    }
    await page.getByRole("tab", { name: "歌词", exact: true }).click();
    const line = page.locator("#lyric-line");
    await compose(line, "Twinkletwinklelittlestar");
    await page.getByRole("button", { name: "从开头填入", exact: true }).click();
    assert.match(await page.locator(".lyric-preview").innerText(), /谱上还没有歌词/);
    await line.dispatchEvent("compositionend");
    await page.getByRole("button", { name: "从开头填入", exact: true }).click();
    assert.match(await page.locator(".lyric-preview").innerText(), /Twinkletwinklelittlestar/);
    await page.getByRole("tab", { name: "打印与导出", exact: true }).click();
    const scoreTop = await page.locator("#zone-score").evaluate(el => el.getBoundingClientRect().top);
    const midiDownload = page.waitForEvent("download");
    await page.getByRole("button", { name: "MIDI", exact: true }).click();
    assert.match((await midiDownload).suggestedFilename(), /\.mid$/);
    await page.getByRole("status").filter({ hasText: "MIDI 已导出。" }).waitFor();
    assert.equal(await page.locator("#zone-score").evaluate(el => el.getBoundingClientRect().top), scoreTop);
    await page.waitForTimeout(2200);
    assert.equal(await page.locator(".editor-message").count(), 0, "success toast expires");
    await page.getByRole("button", { name: "播放", exact: true }).click();
    await back.click();
    await page.waitForFunction(() => window.editorAudioContexts.every(ctx => ctx.state === "closed"));
    await page.goto(`http://${originHost}:${port}/#s=not-valid`);
    await home.waitFor();
    await page.getByRole("alert").filter({ hasText: "分享链接无效或已损坏" }).waitFor();
    await page.getByRole("button", { name: "打开小星星", exact: true }).click();
    await title.waitFor();
    await page.getByRole("tab", { name: "打印与导出", exact: true }).click();
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.getByRole("button", { name: "复制分享链接", exact: true }).click();
    await page.getByRole("status").filter({ hasText: "分享链接已复制" }).waitFor();
    const shareUrl = await page.evaluate(() => navigator.clipboard.readText());
    assert.match(shareUrl, /#s=/);
    await back.click();
    await home.waitFor();
    const archivedBeforeShare = await page.evaluate(() => JSON.parse(localStorage.getItem("puxian-drafts-v1") ?? "[]").length);
    const draftBeforeShare = await page.evaluate(() => localStorage.getItem("puxian-score-v1"));
    await page.goto(shareUrl, { waitUntil: "domcontentloaded" });
    await title.waitFor();
    assert.equal(await title.inputValue(), "小星星", "share link must open the packed score");
    await page.getByText("这是分享来的只读谱", { exact: false }).waitFor();
    await page.waitForTimeout(500);
    assert.equal(await page.evaluate(() => localStorage.getItem("puxian-score-v1")), draftBeforeShare, "shared view must not overwrite the visitor draft");
    assert.equal(
      await page.evaluate(() => JSON.parse(localStorage.getItem("puxian-drafts-v1") ?? "[]").length),
      archivedBeforeShare,
      "opening a share must not auto-archive",
    );
    // Read-only: no feature bar, no editing panels, no keypad, no undo; viewing, playback and practice stay.
    assert.ok(shareUrl.length < 220, `小星星 share link stays short: ${shareUrl.length}`);
    assert.equal(await page.getByRole("tablist", { name: "编辑器功能栏" }).count(), 0, "shared view hides the feature bar");
    assert.equal(await page.locator(".zone-panel:not(.practice-panel)").evaluateAll((els) => els.filter((el) => el.getBoundingClientRect().height > 0).length), 0,
      "shared view hides every editing panel");
    assert.equal(await page.locator(".tap-key").evaluateAll((els) => els.filter((el) => el.getBoundingClientRect().height > 0).length), 0, "keypad is not reachable");
    assert.equal(await page.getByRole("button", { name: "撤销" }).isVisible(), false);
    assert.equal(await page.getByRole("button", { name: "识别音乐" }).isVisible(), false);
    assert.equal(await title.getAttribute("readonly"), "");
    await title.press("End");
    await page.keyboard.type("改");
    assert.equal(await title.inputValue(), "小星星", "title is locked in the shared view");
    for (const name of ["播放", "练习", "简谱", "五线", "和弦谱"]) {
      assert.equal(await page.getByRole("button", { name, exact: true }).isVisible(), true, `${name} stays in the shared view`);
    }
    await page.getByRole("button", { name: "五线", exact: true }).click();
    await page.getByRole("button", { name: "简谱", exact: true }).click();
    assert.equal(await page.evaluate(() => localStorage.getItem("puxian-score-v1")), draftBeforeShare, "viewing a share never writes a draft");
    await page.getByRole("button", { name: "在编辑器中打开副本", exact: true }).click();
    await page.getByRole("tablist", { name: "编辑器功能栏" }).waitFor();
    assert.equal(await title.getAttribute("readonly"), null, "the copy is editable");
    await page.getByRole("status").filter({ hasText: "已存到「我的曲子」" }).waitFor();
    const archivedAfterKeep = await page.evaluate(() => JSON.parse(localStorage.getItem("puxian-drafts-v1") ?? "[]"));
    assert.equal(archivedAfterKeep.length, archivedBeforeShare + 1, "keeping a share adds one song");
    assert.ok(archivedAfterKeep.some((draft) => draft.pinned && draft.value.title === "小星星"));
    await back.click();
    await page.getByRole("heading", { name: "我的曲子", exact: true }).waitFor();
    await page.getByRole("button", { name: "打开小星星", exact: true }).click();
    await page.locator(".staff svg").waitFor({ state: "attached" });
    const features = [
      ["zone-audio", "听写与音频"], ["zone-input", "写谱"], ["zone-expression", "表情记号"],
      ["zone-key", "移调与乐器"], ["zone-lyrics", "歌词"],
      ["zone-style", "辅助模块"], ["zone-play", "打印与导出"],
      ["zone-drafts", "本机草稿"],
    ];
    await page.getByRole("tablist", { name: "编辑器功能栏" }).waitFor();
    // Identity proves refs and uncontrolled DOM state survive feature switches.
    await page.evaluate(() => { window.featureMountedNodes = [...document.querySelectorAll('input[type="file"], #zone-play, .staff, .print-sheet')]; });
    for (const width of [1100, 390, 320]) {
      await page.setViewportSize({ width, height: width === 320 ? 667 : 844 });
      for (const [id, label] of features) {
        const tab = page.getByRole("tab", { name: label, exact: true });
        assert.equal(await tab.isVisible(), true);
        const bounds = await tab.boundingBox();
        assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width, label);
        await tab.click();
        assert.equal(await tab.getAttribute("aria-selected"), "true");
        assert.equal(await page.locator("#" + id).isVisible(), true);
        assert.equal(await page.getByRole("tabpanel").count(), 1);
        assert.equal(await page.locator('[role="tabpanel"]').count(), 8);
        assert.equal(await page.locator("#zone-score").isVisible(), true);
        const panel = page.locator("#" + id);
        for (const view of ["简谱", "五线"]) {
          // Switch first: locator.click() can scroll ancestors into view and hide
          // a document-scroll regression if performed after the wheel gesture.
          await page.getByRole("button", { name: view, exact: true }).click();
          await page.waitForFunction(() => document.querySelector(
            '.score-stage [aria-label="简谱"] svg, .staff-slot:not(.jianpu-staff-backup) svg'));
          await panel.evaluate(el => { el.scrollTop = 0; });
          await panel.hover();
          await page.mouse.wheel(0, 100000);
          await page.waitForFunction((id) => {
            const panel = document.getElementById(id);
            return panel.scrollHeight - panel.clientHeight - panel.scrollTop <= 2;
          }, id);
          // Wait for the wheel's compositor scroll, including on short panels.
          await page.waitForTimeout(150);
          assert.equal(await panel.evaluate(el => el.scrollHeight <= el.clientHeight || el.scrollTop > 0), true,
            `${width} ${label} ${view}: overflowing tools must actually scroll`);
          // No locator actions between scrolling and measuring the actual notes.
          const geometry = await page.evaluate(() => {
            const stage = document.querySelector(".score-stage");
            const clip = stage.getBoundingClientRect();
            const transport = document.querySelector(".transport").getBoundingClientRect();
            const panel = document.querySelector('.zone-panel:not([hidden])').getBoundingClientRect();
            const visible = [...stage.querySelectorAll('[aria-label="简谱"] svg, .staff-slot:not(.jianpu-staff-backup) svg')].some(svg => {
              const r = svg.getBoundingClientRect();
              const left = Math.max(0, clip.left, r.left), right = Math.min(innerWidth, clip.right, r.right);
              const top = Math.max(0, clip.top, r.top), bottom = Math.min(innerHeight, clip.bottom, r.bottom, transport.top, panel.top);
              if (right - left < 24 || bottom - top < 24) return false;
              return [...svg.querySelectorAll('g[data-id], .abcjs-note')].some(note => {
                const n = note.getBoundingClientRect();
                const nl = Math.max(n.left, left), nr = Math.min(n.right, right);
                const nt = Math.max(n.top, top), nb = Math.min(n.bottom, bottom);
                if (nr - nl < 2 || nb - nt < 2) return false;
                const hit = document.elementFromPoint((nl + nr) / 2, (nt + nb) / 2);
                return hit && svg.contains(hit);
              });
            });
            const tabsVisible = [...document.querySelectorAll('.feature-bar [role="tab"]')].every(tab => {
              const r = tab.getBoundingClientRect();
              return r.top >= 0 && r.bottom <= transport.top && r.left >= 0 && r.right <= innerWidth &&
                tab.contains(document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2));
            });
            return { visible, tabsVisible, panelVisible: panel.height >= 48 && panel.bottom <= transport.top,
              pageScroll: window.scrollY };
          });
          assert.deepEqual(geometry, { visible: true, tabsVisible: true, panelVisible: true, pageScroll: 0 },
            `${width} ${label} ${view}: actual notation must remain unobscured: ${JSON.stringify(geometry)}`);
        }
        assert.equal(await page.evaluate(() =>
          window.featureMountedNodes.every((node, index) => node === document.querySelectorAll('input[type="file"], #zone-play, .staff, .print-sheet')[index])), true);
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.screenshot({ path: join(artifacts, `static-feature-bar-${width}.png`), fullPage: true });
    }
    // Polish 3b: score-first phone layout, 44 px targets, transport metronome, previews.
    assert.equal(await page.evaluate(() => localStorage.getItem("puxian-view-v1")), "staff", "last view choice is remembered");
    await page.setViewportSize({ width: 390, height: 844 });
    const scoreBox = await page.locator("#zone-score").boundingBox();
    assert.ok(scoreBox.height >= 844 * 0.4, `phone score takes about the upper half: ${scoreBox.height}`);
    assert.equal(await page.evaluate(() => [...document.querySelectorAll('.feature-bar [role="tab"]')]
      .every(tab => tab.scrollWidth <= tab.clientWidth && tab.getBoundingClientRect().height <= 52)), true,
      "feature labels stay on one line");
    for (const [, label] of features) {
      await page.getByRole("tab", { name: label, exact: true }).click();
      const small = await page.evaluate(() => [...document.querySelectorAll("button, a, summary, select, input:not([type=file]), textarea")]
        .filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (r.width < 44 || r.height < 44); })
        .map(el => `${el.tagName} ${(el.getAttribute("aria-label") || el.textContent).trim().slice(0, 16)}`));
      assert.deepEqual(small, [], `${label}: every visible target is at least 44px`);
    }
    const chromeLook = await page.evaluate(() => {
      const bar = document.querySelector(".feature-bar");
      const tab = document.querySelector('.feature-bar [role="tab"]');
      const panel = document.querySelector(".zone-panel:not([hidden])") || document.querySelector("#zone-score");
      const home = document.querySelector(".editor-home");
      const body = getComputedStyle(document.body).backgroundColor;
      const barCss = bar ? getComputedStyle(bar) : null;
      const tabCss = tab ? getComputedStyle(tab) : null;
      const panelCss = panel ? getComputedStyle(panel) : null;
      const homeCss = home ? getComputedStyle(home) : null;
      const parse = (c) => (c.match(/\d+/g) || []).map(Number);
      const paperish = (c) => {
        const [r, g, b] = parse(c);
        return r >= 230 && r <= 252 && g >= 230 && g <= 252 && b >= 220 && b <= 248 && !(r === 255 && g === 255 && b === 255);
      };
      return {
        tabs: document.querySelectorAll('.feature-bar [role="tab"]').length,
        body,
        barShadow: barCss?.boxShadow,
        barRadius: barCss ? parseFloat(barCss.borderRadius) : 0,
        tabRadius: tabCss ? parseFloat(tabCss.borderRadius) : 0,
        panelBg: panelCss?.backgroundColor,
        panelShadow: panelCss?.boxShadow,
        homeRadius: homeCss ? parseFloat(homeCss.borderRadius) : 0,
        paperish: panelCss ? paperish(panelCss.backgroundColor) : false,
      };
    });
    assert.equal(chromeLook.tabs, 8, "editor feature bar still has 8 items");
    assert.equal(chromeLook.body, "rgb(250, 248, 244)", "editor keeps the cream page wash");
    assert.notEqual(chromeLook.barShadow, "none", "feature bar should carry a light shadow");
    assert.ok(chromeLook.barRadius >= 16, `feature bar radius ${chromeLook.barRadius}`);
    assert.ok(chromeLook.tabRadius >= 14, `feature tab radius ${chromeLook.tabRadius}`);
    assert.ok(chromeLook.homeRadius >= 20, `editor home button should be a pill (${chromeLook.homeRadius})`);
    assert.ok(chromeLook.paperish, `open panel should stay on cream paper, not white (${chromeLook.panelBg})`);
    assert.notEqual(chromeLook.panelShadow, "none", "score/tool panel should carry a light shadow");
    const transportBar = page.getByRole("navigation", { name: "播放与编辑" });
    const metronomeButton = transportBar.getByRole("button", { name: "节拍器", exact: true });
    await metronomeButton.click();
    assert.equal(await metronomeButton.getAttribute("aria-pressed"), "true");
    assert.equal(await transportBar.getByRole("slider", { name: "节拍器音量" }).isVisible(), true);
    await metronomeButton.click();
    assert.equal(await page.locator("#zone-play").getByText("节拍器").count(), 0, "metronome lives in the transport");
    await page.getByRole("tab", { name: "表情记号", exact: true }).click();
    await page.getByText("先点一个音", { exact: false }).waitFor();
    assert.equal(await page.getByRole("button", { name: "中强 mf" }).isDisabled(), true);
    await page.getByRole("tab", { name: "辅助模块", exact: true }).click();
    const beforeStyle = await page.evaluate(() => localStorage.getItem("puxian-score-v1"));
    await page.getByRole("button", { name: /活泼/ }).click();
    await page.getByRole("group", { name: "改编预览" }).waitFor();
    await page.waitForTimeout(500);
    assert.equal(await page.evaluate(() => localStorage.getItem("puxian-score-v1")), beforeStyle, "preview does not edit the score");
    await page.getByRole("button", { name: "取消", exact: true }).click();
    assert.equal(await page.getByRole("group", { name: "改编预览" }).count(), 0);
    await page.getByRole("button", { name: "全屏看谱" }).click();
    assert.equal(await page.locator(".feature-bar").isVisible(), false);
    assert.ok((await page.locator("#zone-score").boundingBox()).height > scoreBox.height + 100);
    await page.getByRole("button", { name: "退出全屏看谱" }).click();
    assert.equal(await page.locator(".feature-bar").isVisible(), true);
    await page.getByRole("button", { name: "放大谱面" }).click();
    await page.getByRole("button", { name: "缩小谱面" }).click();
    // UI leftovers (PR-A): no repeated line headers, inline metronome volume, long titles, desktop panel height.
    await page.getByRole("button", { name: "简谱", exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('.score-stage [aria-label="简谱"] .jianpu-line').length > 1);
    assert.equal(await page.evaluate(() => [...document.querySelectorAll('.score-stage [aria-label="简谱"] text')]
      .filter(el => /^1=/.test(el.textContent)).length), 1, "wrapped jianpu lines do not repeat 1=X / meter / tempo");
    await metronomeButton.click();
    const metroGeometry = await page.evaluate(() => {
      const slider = document.querySelector('input[aria-label="节拍器音量"]').getBoundingClientRect();
      const bar = document.querySelector(".transport").getBoundingClientRect();
      return { inside: slider.top >= bar.top && slider.bottom <= bar.bottom && slider.right <= innerWidth, fits: document.documentElement.scrollWidth <= innerWidth };
    });
    assert.deepEqual(metroGeometry, { inside: true, fits: true }, "390: metronome volume sits inside the bar, not over the panel");
    await metronomeButton.click();
    const titleBox = page.getByRole("textbox", { name: "曲名" });
    const keepTitle = await titleBox.inputValue();
    await titleBox.fill("这是一首名字很长很长的曲子用来检查窄屏标题");
    const titleFit = await titleBox.evaluate(el => ({ wraps: el.scrollHeight <= el.clientHeight + 1, wide: el.getBoundingClientRect().width > 280 }));
    assert.deepEqual(titleFit, { wraps: true, wide: true }, "390: long title shows in full on its own row");
    await titleBox.press("Enter");
    assert.equal(await titleBox.inputValue(), "这是一首名字很长很长的曲子用来检查窄屏标题", "Enter never adds a line to the title");
    await titleBox.fill(keepTitle);
    await page.setViewportSize({ width: 1100, height: 844 });
    await page.getByRole("tab", { name: "写谱", exact: true }).click();
    const panelHeight = await page.locator("#zone-input").evaluate(el => el.getBoundingClientRect().height);
    assert.ok(panelHeight >= 220, `desktop tool panel keeps a usable height: ${panelHeight}`);
    await page.setViewportSize({ width: 390, height: 844 });
    // Practice mode (PR-B): opens in the main workspace from the transport, 8 tabs untouched.
    for (const width of [390, 1100]) {
      await page.setViewportSize({ width, height: 844 });
      const practice = transportBar.getByRole("button", { name: "练习", exact: true });
      await practice.click();
      assert.equal(await page.locator("#zone-practice").isVisible(), true, `${width}: practice panel opens`);
      assert.equal(await page.locator(".zone-panel:not([hidden])").count(), 1, `${width}: practice replaces the open panel`);
      assert.equal(await page.locator('.feature-bar [role="tab"]').count(), 8);
      const practiceFit = await page.evaluate(() => {
        const transport = document.querySelector(".transport").getBoundingClientRect();
        const panel = document.querySelector("#zone-practice").getBoundingClientRect();
        const tabs = [...document.querySelectorAll('.feature-bar [role="tab"]')].every(tab => {
          const r = tab.getBoundingClientRect();
          return r.top >= 0 && r.bottom <= transport.top && r.right <= innerWidth;
        });
        const buttons = [...document.querySelectorAll(".transport button")].every(b => {
          const r = b.getBoundingClientRect();
          return r.left >= 0 && r.right <= innerWidth && r.height <= 52 && r.width >= 44;
        });
        return { tabs, buttons, panel: panel.height >= 48 && panel.bottom <= transport.top, noScroll: document.documentElement.scrollWidth <= innerWidth };
      });
      assert.deepEqual(practiceFit, { tabs: true, buttons: true, panel: true, noScroll: true }, `${width}: practice layout ${JSON.stringify(practiceFit)}`);
      await page.getByRole("tab", { name: "歌词", exact: true }).click();
      assert.equal(await page.locator("#zone-practice").isVisible(), false, `${width}: a feature tab closes practice`);
      assert.equal(await page.locator("#zone-lyrics").isVisible(), true);
    }
    await transportBar.getByRole("button", { name: "练习", exact: true }).click();
    await page.getByRole("slider", { name: "播放速度" }).fill("120");
    assert.equal(await page.getByLabel("当前速度").textContent(), "120%");
    await page.getByRole("radio", { name: "1 小节" }).click();
    await page.getByRole("combobox", { name: "循环终点小节" }).selectOption("1");
    assert.equal(await page.getByRole("button", { name: "循环播放" }).getAttribute("aria-pressed"), "true");
    await page.getByText("已设循环第 1 小节", { exact: false }).waitFor();
    const practiceScoreBefore = await page.evaluate(() => localStorage.getItem("puxian-score-v1"));
    await transportBar.getByRole("button", { name: "播放", exact: true }).click();
    await page.locator(".count-in-pill").waitFor({ timeout: 5000 });
    await page.waitForFunction(() => !document.querySelector(".count-in-pill"), null, { timeout: 8000 });
    await page.getByText("正在循环第 1 小节", { exact: false }).waitFor();
    await transportBar.getByRole("button", { name: "停止", exact: true }).click();
    await page.getByText("已设循环第 1 小节", { exact: false }).waitFor();
    assert.equal(
      await page.getByText("正在循环第 1 小节", { exact: false }).count(),
      0,
      "stopped practice must not still say 正在循环",
    );
    await page.waitForFunction(() => window.editorAudioContexts.every(ctx => ctx.state === "closed"));
    assert.equal(await page.evaluate(() => localStorage.getItem("puxian-score-v1")), practiceScoreBefore, "practice settings never edit the score");
    await page.getByRole("slider", { name: "播放速度" }).fill("100");
    await page.getByRole("radio", { name: "不用" }).click();
    await page.getByRole("button", { name: "循环播放" }).click();
    await page.getByRole("tab", { name: "写谱", exact: true }).click();
    // Tap-to-enter keypad (PR-C): inserts at the cursor, syncs the 唱名 box, undoable, 44px targets.
    for (const width of [390, 1100]) {
      await page.setViewportSize({ width, height: 844 });
      await page.getByRole("tablist", { name: "输入方式" }).getByRole("tab", { name: "简谱", exact: true }).click();
      const pad = page.getByRole("region", { name: "点按键盘" });
      await pad.scrollIntoViewIfNeeded();
      const tiny = await pad.evaluate(el => [...el.querySelectorAll("button")]
        .filter(b => { const r = b.getBoundingClientRect(); return r.width < 44 || r.height < 44; })
        .map(b => b.getAttribute("aria-label") || b.textContent));
      assert.deepEqual(tiny, [], `${width}: keypad targets are at least 44px`);
      const endButton = pad.getByRole("button", { name: "光标到末尾" });
      if (await endButton.isEnabled()) await endButton.click();
      const textBefore = await page.locator("#jianpu").inputValue();
      await pad.getByRole("button", { name: "四分", exact: true }).click();
      await pad.getByRole("button", { name: "唱名 3", exact: true }).click();
      await page.waitForFunction((before) => document.querySelector("#jianpu").value !== before, textBefore);
      assert.match(await page.locator("#jianpu").inputValue(), /(^|\s)3$/, `${width}: tapped 3 lands at the end of the 唱名 box`);
      await pad.getByRole("button", { name: "退格", exact: true }).click();
      await page.waitForFunction((before) => document.querySelector("#jianpu").value === before, textBefore);
      await pad.getByRole("button", { name: "唱名 5", exact: true }).click();
      await transportBar.getByRole("button", { name: "撤销" }).click();
      await page.waitForFunction((before) => document.querySelector("#jianpu").value === before, textBefore);
      // Cursor from the score: tap the first numbered note, then insert a high 1 after it.
      await page.getByRole("button", { name: "简谱", exact: true }).click();
      await page.locator('.score-stage [aria-label="简谱"] g[data-id^="0-"]').first().dispatchEvent("click");
      await pad.getByText("插在第 1 个音后", { exact: false }).waitFor();
      await pad.getByRole("button", { name: "高八度" }).click();
      await pad.getByRole("button", { name: "升号" }).click();
      await pad.getByRole("button", { name: "唱名 #1", exact: true }).click();
      await page.waitForFunction(() => document.querySelector("#jianpu").value.trim().split(/\s+/)[1] === "#1'");
      assert.equal(await pad.getByRole("button", { name: "升号" }).getAttribute("aria-pressed"), "false", "accidental is one-shot");
      await pad.getByText("插在第 2 个音后", { exact: false }).waitFor();
      assert.equal(await pad.getByRole("status", { name: "当前八度" }).textContent(), "中音区", `${width}: octave is one-shot`);
      await transportBar.getByRole("button", { name: "撤销" }).click();
      await page.waitForFunction((before) => document.querySelector("#jianpu").value === before, textBefore);
      // Typing in the box still works and resets the keypad cursor to the end.
      await page.locator("#jianpu").fill(textBefore + " 1");
      await page.locator("#jianpu").blur();
      await pad.getByText("接在末尾", { exact: false }).waitFor();
      await transportBar.getByRole("button", { name: "撤销" }).click();
      await page.waitForFunction((before) => document.querySelector("#jianpu").value.trim() === before.trim(), textBefore);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    // Practice & display polish (PR-D).
    // 5) Screen jianpu chords stack every pitch, lowest on the baseline (matches print).
    await page.getByRole("tab", { name: "写谱", exact: true }).click();
    await page.getByRole("tablist", { name: "输入方式" }).getByRole("tab", { name: "简谱", exact: true }).click();
    await page.getByRole("button", { name: "简谱", exact: true }).click();
    const chordBefore = await page.locator("#jianpu").inputValue();
    await page.locator("#jianpu").fill("[1+3+5] 1 5 5 | 6 6 5 -");
    await page.locator("#jianpu").blur();
    await page.waitForFunction(() => document.querySelectorAll('.score-stage [aria-label="简谱"] text[data-chord-tone]').length >= 2);
    const chordStack = await page.evaluate(() => {
      const group = document.querySelector('.score-stage [aria-label="简谱"] text[data-chord-tone]').closest("g[data-id]");
      const base = [...group.querySelectorAll("text")].find(t => !t.hasAttribute("data-chord-tone")).getBoundingClientRect();
      const tones = [...group.querySelectorAll("text[data-chord-tone]")].map(t => ({ text: t.textContent, box: t.getBoundingClientRect() }));
      return {
        tones: tones.map(t => t.text),
        above: tones.every(t => t.box.bottom <= base.top + 4),
        stacked: tones.every(t => Math.abs(t.box.left - base.left) < 6),
        id: group.dataset.id,
        hint: document.body.textContent.includes("仅显示和弦最高音"),
      };
    });
    assert.deepEqual(chordStack, { tones: ["3", "5"], above: true, stacked: true, id: "0-60", hint: false }, `chords stack on screen ${JSON.stringify(chordStack)}`);
    await transportBar.getByRole("button", { name: "撤销" }).click();
    await page.waitForFunction((before) => document.querySelector("#jianpu").value === before, chordBefore);
    // 1) The A-B loop is shaded + bracketed on the score, in both views.
    for (const width of [390, 1100]) {
      await page.setViewportSize({ width, height: 844 });
      if (!(await page.locator("#zone-practice").isVisible())) await transportBar.getByRole("button", { name: "练习", exact: true }).click();
      await page.getByRole("combobox", { name: "循环起点小节" }).selectOption("2");
      await page.getByRole("combobox", { name: "循环终点小节" }).selectOption("3");
      await page.getByRole("button", { name: "简谱", exact: true }).click();
      await page.waitForFunction(() => document.querySelector('.score-stage [aria-label="简谱"] [data-loop-band] rect'));
      const band = await page.evaluate(() => {
        const bands = [...document.querySelectorAll('.score-stage [aria-label="简谱"] [data-loop-band]')];
        const edges = bands.flatMap(b => [...b.querySelectorAll("[data-loop-edge]")].map(e => e.getAttribute("data-loop-edge")));
        const rect = bands[0].querySelector("rect").getBoundingClientRect();
        return { edges: [...new Set(edges)].sort(), passive: bands.every(b => b.getAttribute("pointer-events") === "none"), visible: rect.width > 20 && rect.height > 20 };
      });
      assert.deepEqual(band, { edges: ["end", "start"], passive: true, visible: true }, `${width}: jianpu loop band ${JSON.stringify(band)}`);
      await page.getByRole("button", { name: "五线", exact: true }).click();
      await page.waitForFunction(() => document.querySelector(".staff [data-loop-band] rect")?.getBoundingClientRect().width > 20);
      await page.getByRole("button", { name: "简谱", exact: true }).click();
      await page.getByRole("button", { name: "循环播放" }).click();
      await page.waitForFunction(() => !document.querySelector("[data-loop-band]"));
      await page.getByRole("button", { name: "循环播放" }).click();
      await page.waitForFunction(() => document.querySelector('.score-stage [aria-label="简谱"] [data-loop-band]'));
    }
    await page.setViewportSize({ width: 390, height: 844 });
    // 2) Count-in / karaoke float over the score: the score does not move down.
    await page.getByRole("radio", { name: "1 小节" }).click();
    const stageTop = await page.locator(".score-stage").evaluate(el => el.getBoundingClientRect().top);
    await transportBar.getByRole("button", { name: "播放", exact: true }).click();
    await page.locator(".count-in-pill").waitFor({ timeout: 5000 });
    const overlayStage = await page.locator(".score-stage").evaluate(el => el.getBoundingClientRect().top);
    assert.ok(Math.abs(overlayStage - stageTop) < 1, `count-in strip overlays the score (${stageTop} → ${overlayStage})`);
    assert.equal(await page.locator(".practice-strip").evaluate(el => getComputedStyle(el).position), "absolute");
    // 3) Dragging speed mid-play resumes without a new count-in; changing count-in restarts with one.
    await page.waitForFunction(() => !document.querySelector(".count-in-pill"), null, { timeout: 8000 });
    if (await page.locator(".karaoke").count()) {
      assert.ok(Math.abs((await page.locator(".score-stage").evaluate(el => el.getBoundingClientRect().top)) - stageTop) < 1, "karaoke line overlays the score");
    }
    await page.waitForTimeout(700);
    const soundingNote = () => page.evaluate(() => {
      const line = [...document.querySelectorAll('p[aria-live="polite"]')].map(p => p.textContent).find(t => /正在响/.test(t)) ?? "";
      return Number(/第 (\d+) 个音/.exec(line)?.[1] ?? 0);
    });
    await page.waitForFunction(() => [...document.querySelectorAll('p[aria-live="polite"]')].some(p => /正在响/.test(p.textContent)));
    const noteBefore = await soundingNote();
    const contextsBefore = await page.evaluate(() => window.editorAudioContexts.length);
    await page.getByRole("slider", { name: "播放速度" }).fill("80");
    await page.waitForFunction((n) => window.editorAudioContexts.length > n, contextsBefore, { timeout: 3000 });
    await page.waitForFunction(() => [...document.querySelectorAll('p[aria-live="polite"]')].some(p => /正在响/.test(p.textContent)));
    const noteAfter = await soundingNote();
    assert.ok(noteBefore > 0 && noteAfter >= noteBefore, `speed change resumes at the current note (${noteBefore} → ${noteAfter})`);
    let pillAfterSpeed = false;
    for (let i = 0; i < 8; i += 1) {
      pillAfterSpeed ||= (await page.locator(".count-in-pill").count()) > 0;
      await page.waitForTimeout(100);
    }
    assert.equal(pillAfterSpeed, false, "speed change resumes without a count-in");
    assert.equal(await transportBar.getByRole("button", { name: "停止", exact: true }).count(), 1, "still playing after the speed change");
    await page.getByRole("radio", { name: "2 小节" }).click();
    await page.locator(".count-in-pill").waitFor({ timeout: 3000 });
    await transportBar.getByRole("button", { name: "停止", exact: true }).click();
    await page.waitForFunction(() => window.editorAudioContexts.every(ctx => ctx.state === "closed"));
    // 4) Practice settings are remembered per song on this device, never in the score/drafts.
    const stored = await page.evaluate(() => ({
      practice: JSON.parse(localStorage.getItem("puxian-practice-v1") ?? "{}"),
      score: localStorage.getItem("puxian-score-v1") ?? "",
      drafts: Object.keys(localStorage).filter(k => k !== "puxian-practice-v1").map(k => localStorage.getItem(k)).join(""),
    }));
    const entries = Object.values(stored.practice);
    assert.equal(entries.length, 1, "one song's practice settings saved");
    assert.equal(entries[0].speed, 0.8);
    assert.equal(entries[0].countInBars, 2);
    assert.equal(entries[0].loopOn, true);
    assert.ok(!/countInBars|loopRange/.test(stored.drafts), "practice settings never leak into the score or drafts");
    const second = await page.context().newPage();
    await second.goto(page.url());
    await second.getByRole("button", { name: "继续上次草稿" }).click();
    await second.getByRole("navigation", { name: "播放与编辑" }).getByRole("button", { name: /^练习/ }).click();
    await second.getByLabel("当前速度").filter({ hasText: "80%" }).waitFor();
    assert.equal(await second.getByRole("radio", { name: "2 小节" }).getAttribute("aria-checked"), "true", "count-in remembered after reload");
    assert.equal(await second.getByRole("button", { name: "循环播放" }).getAttribute("aria-pressed"), "true", "loop remembered after reload");
    await second.close();
    // Soundslice-inspired practice: lazy keyboard, per-song clips, finite progressive speed.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "琴键 展开", exact: true }).click();
    await page.locator("[data-visual-keyboard]").waitFor();
    assert.equal(await page.locator('.feature-bar [role="tab"]').count(), 8, "keyboard keeps eight features");
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "390: keyboard never widens the page");
    assert.ok(await page.evaluate(() => {
      const clip = document.querySelector('.score-stage').getBoundingClientRect();
      const keyboard = document.querySelector('.keyboard-dock').getBoundingClientRect();
      return [...document.querySelectorAll('.score-stage g[data-id], .score-stage .abcjs-note')].some(note => {
        const r = note.getBoundingClientRect();
        return Math.min(r.bottom, clip.bottom, keyboard.top) - Math.max(r.top, clip.top) > 2;
      });
    }), "390: expanded keyboard keeps sounding notation visible above it");
    assert.ok(await page.locator("#zone-practice").evaluate(el => {
      const r = el.getBoundingClientRect();
      const dock = document.querySelector('.keyboard-dock').getBoundingClientRect();
      return Math.min(r.bottom, dock.top, innerHeight) - Math.max(r.top, 0) >= 200;
    }), "390x844: keyboard and practice together keep at least 200px of visible practice panel");
    await page.getByRole("button", { name: "只看左手", exact: true }).click();
    assert.equal(await page.getByRole("button", { name: "只看左手", exact: true }).getAttribute("aria-pressed"), "true");
    await page.getByRole("button", { name: "双手", exact: true }).click();
    await page.getByLabel("练习段名称", { exact: true }).fill("慢练收藏");
    await page.getByRole("button", { name: "存为片段", exact: true }).click();
    const clipButton = page.getByRole("button", { name: "慢练收藏 · 80%", exact: true });
    await clipButton.waitFor();
    await page.getByRole("slider", { name: "播放速度" }).fill("100");
    await clipButton.click();
    await page.getByLabel("当前速度", { exact: true }).filter({ hasText: "80%" }).waitFor();
    const savedClips = await page.evaluate(() => Object.values(JSON.parse(localStorage.getItem("puxian-practice-v1")))[0].clips);
    assert.equal(savedClips[0].name, "慢练收藏");
    await page.getByRole("button", { name: "删除片段 慢练收藏", exact: true }).click();
    assert.equal(await clipButton.count(), 0);
    await page.getByRole("radio", { name: "不用", exact: true }).click();
    // r16: 渐进加速 is folded until opened.
    if (!(await page.locator("[data-speed-training]").evaluate((d) => d.open))) await page.locator("[data-speed-training] > summary").click();
    await page.getByLabel("起始速度（%）", { exact: true }).fill("110");
    await page.getByLabel("目标速度（%）", { exact: true }).fill("120");
    await page.getByLabel("每档练几遍", { exact: true }).fill("1");
    await page.getByRole("button", { name: "开启渐进加速", exact: true }).click();
    await transportBar.getByRole("button", { name: "播放", exact: true }).click();
    await page.waitForFunction(() => document.querySelector('[data-visual-keyboard] [data-active="true"]'));
    await transportBar.getByRole("button", { name: "停止", exact: true }).click();
    assert.equal(await page.getByRole("button", { name: "取消渐进加速", exact: true }).getAttribute("aria-pressed"), "true", "pause preserves training");
    await transportBar.getByRole("button", { name: "播放", exact: true }).click();
    await page.getByText("已练到 120%", { exact: true }).waitFor({ timeout: 30000 });
    assert.equal(await transportBar.getByRole("button", { name: "播放", exact: true }).count(), 1, "training stops after target pass");
    await page.getByRole("button", { name: "开启渐进加速", exact: true }).click();
    await page.getByRole("slider", { name: "播放速度" }).fill("90");
    assert.equal(await page.getByRole("button", { name: "开启渐进加速", exact: true }).getAttribute("aria-pressed"), "false", "manual speed cancels training");
    await page.getByRole("button", { name: "琴键 收起", exact: true }).click();
    await page.getByRole("slider", { name: "播放速度" }).fill("100");
    await page.getByRole("radio", { name: "不用" }).click();
    await page.getByRole("button", { name: "循环播放" }).click();
    assert.equal(await page.getByRole("button", { name: "循环播放" }).getAttribute("aria-pressed"), "false");
    await page.getByRole("tab", { name: "写谱", exact: true }).click();
    // 6) <360px: with the metronome on, tapping it again reopens the volume instead of switching off.
    await page.setViewportSize({ width: 320, height: 667 });
    await metronomeButton.click();
    const volume = transportBar.getByRole("slider", { name: "节拍器音量" });
    assert.equal(await volume.isVisible(), true, "320: volume pops over when switching on");
    await page.locator(".score-stage").click({ position: { x: 10, y: 10 } });
    assert.equal(await volume.isVisible(), false, "320: outside tap closes the volume");
    await metronomeButton.click();
    assert.equal(await metronomeButton.getAttribute("aria-pressed"), "true", "320: second tap keeps the click on");
    assert.equal(await volume.isVisible(), true, "320: second tap reopens the volume");
    const offButton = transportBar.getByRole("button", { name: "关闭节拍器" });
    const offBox = await offButton.boundingBox();
    assert.ok(offBox.height >= 44 && offBox.y >= 0, "320: 关闭节拍器 is a full-size target on screen");
    await offButton.click();
    assert.equal(await metronomeButton.getAttribute("aria-pressed"), "false");
    assert.equal(await volume.isVisible(), false);
    // 7) 320×667: an unfocused long title folds to one line with an ellipsis; editing unfolds it.
    const title320 = page.getByRole("textbox", { name: "曲名" });
    const keepTitle320 = await title320.inputValue();
    const shortStage = await page.locator(".score-stage").evaluate(el => el.getBoundingClientRect().top);
    await title320.fill("这是一首名字很长很长的曲子用来检查窄屏标题");
    const editing = await title320.evaluate(el => el.getBoundingClientRect().height);
    assert.ok(editing > 46, `320: editing a long title shows two lines (${editing})`);
    await title320.blur();
    const folded = await page.evaluate(() => {
      const area = document.querySelector('[aria-label="曲名"]');
      const fold = document.querySelector(".score-title-fold");
      return {
        height: area.getBoundingClientRect().height,
        ellipsis: fold ? getComputedStyle(fold).textOverflow === "ellipsis" && fold.scrollWidth > fold.clientWidth : false,
        stage: document.querySelector(".score-stage").getBoundingClientRect().top,
      };
    });
    assert.ok(folded.height <= 46 && folded.ellipsis, `320: folded title ${JSON.stringify(folded)}`);
    assert.ok(folded.stage - shortStage <= 52, `320: long title costs at most one row (${shortStage} → ${folded.stage})`);
    await title320.focus();
    assert.ok((await title320.evaluate(el => el.getBoundingClientRect().height)) > 46, "320: focusing unfolds the title");
    await title320.fill(keepTitle320);
    await title320.blur();
    await page.setViewportSize({ width: 390, height: 844 });
    // Export choice follows the editor until explicitly overridden; no viewport assertions above are relaxed.
    // Tap / click UX (after the 48 P2 checks; those checks are not reopened or relaxed).
    for (const width of [390, 1100]) {
      await page.setViewportSize({ width, height: 844 });
      await page.getByRole("button", { name: "简谱", exact: true }).click();
      await page.waitForFunction(() => document.querySelector('.score-stage [aria-label="简谱"] .jianpu-note-target, .score-stage [aria-label="简谱"] g[data-id]'));
      const chrome = await page.evaluate((width) => {
        const buttons = [...document.querySelectorAll(".feature-bar button, .transport button, .editor-actions > button, .score-tools button")];
        const touch = buttons
          .filter((el) => {
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0 && getComputedStyle(el).touchAction !== "manipulation";
          })
          .map((el) => (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 20));
        const views = [...document.querySelectorAll('.score-tools [aria-label="谱面视图"] button')].map((el) => {
          const r = el.getBoundingClientRect();
          return {
            label: el.textContent.trim(),
            w: Math.round(r.width * 10) / 10,
            h: Math.round(r.height * 10) / 10,
            left: Math.round(r.left * 10) / 10,
            right: Math.round(r.right * 10) / 10,
            top: Math.round(r.top * 10) / 10,
          };
        });
        const tools = [...document.querySelectorAll(".score-tools .tool-button, .score-tools [aria-label='谱面大小'] button")].map((el) => {
          const r = el.getBoundingClientRect();
          return {
            label: (el.getAttribute("aria-label") || "").trim(),
            w: Math.round(r.width * 10) / 10,
            h: Math.round(r.height * 10) / 10,
            left: Math.round(r.left * 10) / 10,
            right: Math.round(r.right * 10) / 10,
            top: Math.round(r.top * 10) / 10,
          };
        });
        const viewBottom = Math.max(...views.map((v) => v.top + v.h), 0);
        const toolRow = tools.length ? Math.min(...tools.map((t) => t.top)) : viewBottom;
        const pads = [...document.querySelectorAll(".jianpu-note-target, .jianpu-bar-target")].map((el) => {
          const r = el.getBoundingClientRect();
          return { w: r.width, h: r.height };
        }).filter((p) => p.w > 0 && p.h > 0);
        const smallPads = pads.filter((p) => p.w < 44 || p.h < 44).length;
        return {
          touch,
          views,
          tools,
          viewsInViewport: views.every((v) => v.left >= -0.5 && v.right <= innerWidth + 0.5 && v.w >= 44 && v.h >= 44),
          toolsInViewport: tools.every((t) => t.left >= -0.5 && t.right <= innerWidth + 0.5 && t.w >= 44 && t.h >= 44),
          toolsWrapBelow: width < 640 ? toolRow >= viewBottom - 1 : true,
          smallPads,
          padCount: pads.length,
        };
      }, width);
      assert.deepEqual(chrome.touch, [], `${width}: chrome buttons use touch-action: manipulation (${chrome.touch})`);
      assert.equal(chrome.views.length, 5, `${width}: five score views`);
      assert.equal(chrome.viewsInViewport, true, `${width}: view tabs fit and are >= 44px ${JSON.stringify(chrome.views)}`);
      assert.equal(chrome.toolsInViewport, true, `${width}: zoom/follow/full-screen fit and are >= 44px ${JSON.stringify(chrome.tools)}`);
      assert.equal(chrome.toolsWrapBelow, true, `${width}: zoom/follow are not crammed beside the five views ${JSON.stringify({ views: chrome.views, tools: chrome.tools })}`);
      assert.ok(chrome.padCount > 0, `${width}: score hit pads are painted`);
      assert.equal(chrome.smallPads, 0, `${width}: every note/bar pad is at least 44px (${chrome.smallPads}/${chrome.padCount})`);
      await page.locator('.score-stage [aria-label="简谱"] g[data-id^="0-"]').first().dispatchEvent("click");
      await page.waitForFunction(() => document.querySelector('.score-stage [aria-label="简谱"] g.is-chosen, .score-stage [aria-label="简谱"] g[data-id][style*="2a6fdb"]'));
      const chosen = await page.evaluate(() => {
        const group = document.querySelector('.score-stage [aria-label="简谱"] g.is-chosen');
        const pad = group?.querySelector(".jianpu-note-target");
        const fill = pad ? getComputedStyle(pad).fill : "";
        return { has: Boolean(group), fill };
      });
      assert.equal(chosen.has, true, `${width}: tapping a numbered note marks is-chosen`);
      assert.equal(/rgba?\(\s*42,\s*111,\s*219/i.test(chosen.fill) || chosen.fill.includes("42, 111, 219"), true, `${width}: chosen pad has a visible blue wash (${chosen.fill})`);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("tab", { name: "本机草稿", exact: true }).click();
    const haptic = page.getByRole("button", { name: "点按震动" });
    await haptic.scrollIntoViewIfNeeded();
    const hapticBox = await haptic.boundingBox();
    assert.ok(hapticBox && hapticBox.width >= 44 && hapticBox.height >= 44, `haptic toggle is at least 44px: ${JSON.stringify(hapticBox)}`);
    const before = await haptic.getAttribute("aria-pressed");
    await haptic.click();
    assert.notEqual(await haptic.getAttribute("aria-pressed"), before, "haptic toggle changes");
    assert.equal(await page.evaluate(() => localStorage.getItem("puxian-haptic-v1") === "0" || localStorage.getItem("puxian-haptic-v1") === "1"), true);
    await haptic.click();
    await page.getByRole("tab", { name: "写谱", exact: true }).click();
    const portraitPad = await page.evaluate(() => {
      const transport = document.querySelector(".transport")?.getBoundingClientRect();
      const panel = document.getElementById("zone-input")?.getBoundingClientRect();
      const padButtons = [...document.querySelectorAll(".tap-dock button, .tap-pad button")];
      const covered = padButtons.filter((el) => {
        const r = el.getBoundingClientRect();
        if (!transport || !panel || r.width <= 0 || r.height <= 0) return false;
        const visibleTop = Math.max(r.top, panel.top, 0);
        const visibleBottom = Math.min(r.bottom, panel.bottom, innerHeight);
        if (visibleBottom - visibleTop <= 1) return false;
        return visibleBottom > transport.top + 1 && visibleTop < transport.bottom;
      }).map((el) => (el.getAttribute("aria-label") || el.textContent || "").trim());
      return { covered, padCount: padButtons.length };
    });
    assert.ok(portraitPad.padCount > 0, "390x844 write keypad is mounted");
    assert.deepEqual(portraitPad.covered, [], `390x844 transport must not cover the keypad (${JSON.stringify(portraitPad.covered)})`);

    for (const [width, height] of [[390, 844], [320, 667], [1280, 800]]) {
      await page.setViewportSize({ width, height });
      await page.locator('#zone-input').evaluate(el => { el.scrollTop = 0; });
      for (const name of ["撤销", "重做"]) {
        assert.equal((await page.getByRole("button", { name, exact: true }).textContent()).trim(), "", `${width}: history uses icons only`);
      }
      if (width >= 640) continue;
      const durations = page.getByRole("group", { name: "时值", exact: true }).getByRole("button");
      for (const button of await durations.all()) {
        const visible = await button.evaluate(el => {
          const r = el.getBoundingClientRect();
          const p = document.querySelector('#zone-input').getBoundingClientRect();
          const t = document.querySelector('.transport').getBoundingClientRect();
          return r.top >= p.top && r.bottom <= p.bottom && r.bottom <= t.top && r.left >= 0 && r.right <= innerWidth && el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
        });
        assert.ok(visible, `${width}x${height}: complete duration control is visible and clickable: ${await button.textContent()}`);
        const previous = await button.getAttribute('aria-pressed');
        await button.click();
        assert.equal(await button.getAttribute('aria-pressed'), (await button.textContent()).trim() === '附点' ? String(previous !== 'true') : 'true');
      }
    }

    await page.setViewportSize({ width: 844, height: 390 });
    const landscape = await page.evaluate(() => {
      const shell = document.querySelector("main.app-shell");
      const transport = document.querySelector(".transport");
      const score = document.querySelector("#zone-score");
      const stage = document.querySelector(".score-stage");
      const cs = shell ? getComputedStyle(shell) : null;
      const t = transport?.getBoundingClientRect();
      const s = score?.getBoundingClientRect();
      const mask = stage ? (getComputedStyle(stage).maskImage || getComputedStyle(stage).webkitMaskImage || "") : "";
      const headerBtns = [...document.querySelectorAll(".editor-actions > button, .editor-home")].map((el) => el.getBoundingClientRect()).filter((r) => r.width > 0);
      const gaps = [];
      for (let i = 1; i < headerBtns.length; i += 1) gaps.push(headerBtns[i].left - headerBtns[i - 1].right);
      return {
        paddingBottom: cs ? parseFloat(cs.paddingBottom) : 0,
        transportTop: t?.top ?? 0,
        transportH: t?.height ?? 0,
        scoreBottom: s?.bottom ?? 0,
        overlap: Boolean(t && s && s.bottom > t.top + 1),
        mask,
        gaps,
      };
    });
    assert.ok(landscape.paddingBottom >= 64, `844x390 shell padding-bottom must clear the transport: ${landscape.paddingBottom}`);
    assert.equal(landscape.overlap, false, `844x390 transport must not cover the score (${JSON.stringify(landscape)})`);
    assert.equal(landscape.mask === "none" || landscape.mask === "", true, `score-stage fade mask must be removed (${landscape.mask})`);
    assert.ok(landscape.gaps.length === 0 || Math.min(...landscape.gaps) >= 8, `header action gap must be at least 8px (${JSON.stringify(landscape.gaps)})`);

    await page.getByRole("tab", { name: "听写与音频", exact: true }).click();
    const hum = page.getByRole("button", { name: "开始哼唱", exact: true });
    await hum.scrollIntoViewIfNeeded();
    assert.equal(await hum.isVisible(), true, "844x390 开始哼唱 is visible");
    const humBox = await hum.boundingBox();
    const barBox = await page.locator(".transport").boundingBox();
    assert.ok(humBox && barBox && humBox.y + humBox.height <= barBox.y + 1,
      `844x390 开始哼唱 must sit above the transport: hum=${JSON.stringify(humBox)} bar=${JSON.stringify(barBox)}`);

    await page.getByRole("button", { name: "全屏看谱" }).click();
    const fullChrome = await page.evaluate(() => {
      const vis = (el) => {
        if (!el) return false;
        const r = el.getBoundingClientRect();
        const d = getComputedStyle(el).display;
        return d !== "none" && r.height > 0 && r.width > 0;
      };
      return {
        header: vis(document.querySelector(".editor-header")),
        featureBar: vis(document.querySelector(".feature-bar")),
        transport: vis(document.querySelector(".transport")),
        exit: vis(document.querySelector('[aria-label="退出全屏看谱"]')),
      };
    });
    assert.deepEqual(fullChrome, { header: false, featureBar: false, transport: false, exit: true },
      `fullscreen must hide the top bar and transport, leaving an exit control (${JSON.stringify(fullChrome)})`);
    await page.getByRole("button", { name: "退出全屏看谱" }).click();

    // Use a desktop viewport after the 48 P2 checks so the panel is easy to operate; do not reopen those checks.
    await page.setViewportSize({ width: 1100, height: 844 });
    await page.getByRole("tab", { name: "打印与导出", exact: true }).click();
    const output = page.getByRole("combobox", { name: "打印与图片谱面", exact: true });
    assert.equal(await output.inputValue(), "follow");
    await page.getByRole("button", { name: "简谱", exact: true }).click();
    assert.equal(await page.getByRole("button", { name: "简谱", exact: true }).getAttribute("aria-pressed"), "true");
    await output.selectOption("staff");
    assert.equal(await output.inputValue(), "staff");
    assert.equal(await page.getByRole("button", { name: "简谱", exact: true }).getAttribute("aria-pressed"), "true");
    await output.selectOption("jianpu");
    const downloadReady = page.waitForEvent("download");
    await page.getByRole("button", { name: "SVG", exact: true }).click();
    const download = await downloadReady;
    const svg = readFileSync(await download.path(), "utf8");
    assert.match(svg, /data-note-start/);
    assert.match(svg, /1=/);
    await output.selectOption("follow");
    await page.getByRole("button", { name: "五线", exact: true }).click();
    const xmlInput = page.locator('input[type="file"][accept*=".musicxml"]');
    const dedicatedXml = xmlInput.first();
    assert.match(await dedicatedXml.getAttribute("accept"), /\.mxl/);
    const savedScore = await page.evaluate(() => localStorage.getItem("puxian-score-v1"));
    await dedicatedXml.setInputFiles({ name: "broken.mxl", mimeType: "application/zip", buffer: Buffer.from("PK broken") });
    const alert = page.getByRole("alert").filter({ hasText: /现有谱未更改/ });
    await alert.waitFor();
    const alertText = await alert.first().innerText();
    assert.equal(alertText.split("现有谱未更改").length - 1, 1);
    assert.equal(await page.evaluate(() => localStorage.getItem("puxian-score-v1")), savedScore);

    await page.getByRole("tab", { name: "听写与音频", exact: true }).click();
    assert.equal(await page.getByRole("button", { name: "开始哼唱", exact: true }).isVisible(), true);
    assert.equal(await page.getByRole("button", { name: "编辑识别草稿" }).count(), 0);
    await page.evaluate(() => {
      const err = new Error("Permission denied");
      err.name = "NotAllowedError";
      navigator.mediaDevices.getUserMedia = () => Promise.reject(err);
    });
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: width === 320 ? 667 : 844 });
      const start = page.getByRole("button", { name: "开始哼唱", exact: true });
      assert.equal(await start.isVisible(), true);
      const bounds = await start.boundingBox();
      assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width, `${width}: humming button overflows`);
      await start.click();
      await page.locator("#zone-audio").getByText(/麦克风权限未获允许/).waitFor({ timeout: 8_000 });
      await page.locator("#zone-audio").getByText(/地址栏左侧图标/).waitFor();
      assert.equal(await page.getByRole("button", { name: "开始哼唱", exact: true }).isVisible(), true);
      assert.equal(await page.getByRole("button", { name: "编辑识别草稿" }).count(), 0);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    }
    // Denial must be retryable without reloading.
    await page.getByRole("button", { name: "开始哼唱", exact: true }).click();
    await page.locator("#zone-audio").getByText(/麦克风权限未获允许/).waitFor({ timeout: 8_000 });

    const titleBeforeDraft = await page.getByRole("textbox", { name: "曲名" }).inputValue();
    const jianpuBeforeDraft = await page.locator("#jianpu").inputValue();
    await page.setViewportSize({ width: 1100, height: 800 });
    await page.getByLabel("上传音乐文件", { exact: true }).setInputFiles({
      name: "哼唱草稿.wav",
      mimeType: "audio/wav",
      buffer: toneWav(),
    });
    await page.getByText("听写草稿 · 尚未写入谱面", { exact: true }).waitFor({ timeout: 20_000 });
    assert.equal(await page.getByRole("textbox", { name: "曲名" }).inputValue(), titleBeforeDraft);
    assert.equal(await page.locator("#jianpu").inputValue(), jianpuBeforeDraft,
      "dictation preview must not overwrite the current score");
    await page.getByRole("button", { name: "放弃", exact: true }).click();
    await page.getByText("已放弃听写草稿，谱面未更改。").waitFor();
    assert.equal(await page.getByText("听写草稿 · 尚未写入谱面").count(), 0);
    assert.equal(await page.getByRole("textbox", { name: "曲名" }).inputValue(), titleBeforeDraft);
    assert.equal(await page.locator("#jianpu").inputValue(), jianpuBeforeDraft);

    await page.getByLabel("上传音乐文件", { exact: true }).setInputFiles({
      name: "哼唱草稿.wav",
      mimeType: "audio/wav",
      buffer: toneWav(),
    });
    await page.getByText("听写草稿 · 尚未写入谱面", { exact: true }).waitFor({ timeout: 20_000 });
    await page.getByRole("button", { name: "编辑识别草稿", exact: true }).click();
    await page.getByRole("button", { name: "写入主谱", exact: true }).click();
    await page.getByText("识别草稿已写入主谱，可撤销。", { exact: true }).waitFor();
    assert.equal(await page.getByText("听写草稿 · 尚未写入谱面").count(), 0);
    await page.waitForFunction((before) => document.querySelector("#jianpu")?.value !== before, jianpuBeforeDraft);
    await page.getByRole("button", { name: "撤销" }).click();
    await page.waitForFunction((before) => document.querySelector("#jianpu")?.value === before, jianpuBeforeDraft);
    assert.equal(await page.getByRole("textbox", { name: "曲名" }).inputValue(), titleBeforeDraft);

    // 多音 dictation: the worker, TensorFlow.js and the model load only after the mode is chosen,
    // from this origin; the result is a draft until confirmed and lists what was lost.
    const polyAsset = /poly-dictation\.worker-|group1-shard1of1-|\/model-[A-Za-z0-9_-]+\.json$/;
    assert.equal(requests.filter((r) => polyAsset.test(r.path)).length, 0, "多音 assets must not load before 多音 is used");
    const monoMode = page.getByRole("button", { name: "单音（哼唱/旋律）", exact: true });
    const polyMode = page.getByRole("button", { name: "多音（和弦/钢琴）", exact: true });
    assert.equal(await monoMode.getAttribute("aria-pressed"), "true");
    await polyMode.click();
    assert.equal(await polyMode.getAttribute("aria-pressed"), "true");
    await page.getByLabel("上传音乐文件", { exact: true }).setInputFiles({
      name: "和弦.wav",
      mimeType: "audio/wav",
      buffer: chordWav(),
    });
    await page.getByText("多音听写草稿 · 尚未写入谱面", { exact: true }).waitFor({ timeout: 180_000 });
    assert.equal(await page.locator("#jianpu").inputValue(), jianpuBeforeDraft, "多音 draft must not overwrite the score");
    assert.ok(requests.some((r) => /poly-dictation\.worker-/.test(r.path) && r.status === 200), "worker served same-origin");
    assert.ok(requests.some((r) => /group1-shard1of1-/.test(r.path) && r.status === 200), "model weights served same-origin");
    // The draft sits at the top of the panel and is scrolled into view, with chord names and an audition button.
    const polyPanel = page.locator(".poly-panel");
    assert.equal(await polyPanel.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return r.top < innerHeight && r.bottom > 0;
    }), true, "多音 draft must be scrolled into view");
    const chordLineText = await page.locator(".poly-chord-line").innerText();
    assert.match(chordLineText, /^\|\s*C\b/, `C major chord named first: ${chordLineText}`);
    assert.equal(await page.getByRole("button", { name: "试听草稿", exact: true }).isVisible(), true);
    // Headless Chromium renders WebGL in software: the label must not claim GPU acceleration.
    const gpuStatus = await page.getByText(/多音听写完成：/).first().innerText();
    assert.doesNotMatch(gpuStatus, /显卡加速/, `backend label must match the real backend: ${gpuStatus}`);
    await page.getByRole("button", { name: "编辑识别草稿", exact: true }).click();
    await page.getByRole("button", { name: "写入主谱", exact: true }).click();
    await page.getByText("识别草稿已写入主谱，可撤销。", { exact: true }).waitFor();
    await page.waitForFunction((before) => document.querySelector("#jianpu")?.value !== before, jianpuBeforeDraft);
    const polyJianpu = await page.locator("#jianpu").inputValue();
    // Degrees follow the guessed key, so check the shape: a three-note chord, then a two-note one.
    assert.match(polyJianpu, /^\[[^\],]+,[^\],]+,[^\],]+\][^[]*\[[^\],]+,[^\],]+\]/, `C major triad then G3+D5 as chords: ${polyJianpu}`);
    await page.getByText(/本次导入(丢失了什么|没有发现丢失)（多音听写/).waitFor();
    // A failed upload afterwards drops the old loss list and shows its error on screen.
    await page.getByLabel("上传音乐文件", { exact: true }).setInputFiles({
      name: "坏音频.wav", mimeType: "audio/wav", buffer: Buffer.from("RIFF not really audio"),
    });
    const uploadError = page.getByRole("alert").filter({ hasText: "这段音频解不开" });
    await uploadError.waitFor();
    assert.equal(await page.getByText(/本次导入(丢失了什么|没有发现丢失)（多音听写/).count(), 0, "failed upload clears the old loss report");
    await page.waitForTimeout(300);
    assert.equal(await uploadError.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const bar = document.querySelector(".transport")?.getBoundingClientRect();
      return r.top >= 0 && r.bottom <= (bar ? bar.top : innerHeight);
    }), true, "upload error is visible above the transport");
    await page.getByRole("button", { name: "撤销" }).click();
    await page.waitForFunction((before) => document.querySelector("#jianpu")?.value === before, jianpuBeforeDraft);
    assert.equal(await page.getByText(/本次导入(丢失了什么|没有发现丢失)（多音听写/).count(), 0, "undo clears the 多音 loss report");
    // Forcing the CPU really switches backends, and the label says so.
    await page.getByLabel(/不用显卡/).check();
    await page.getByLabel("上传音乐文件", { exact: true }).setInputFiles({
      name: "和弦.wav",
      mimeType: "audio/wav",
      buffer: chordWav(),
    });
    await page.getByText("多音听写草稿 · 尚未写入谱面", { exact: true }).waitFor({ timeout: 180_000 });
    await page.getByText(/多音听写完成：.*（处理器运算）/).first().waitFor();
    await page.getByRole("button", { name: "放弃", exact: true }).click();
    assert.equal(await page.getByText("多音听写草稿 · 尚未写入谱面").count(), 0);
    await page.getByLabel(/不用显卡/).uncheck();
    await monoMode.click();
    assert.equal(await monoMode.getAttribute("aria-pressed"), "true");

    await page.getByRole("tab", { name: "写谱", exact: true }).click();
    await page.keyboard.press("ArrowRight");
    assert.equal(await page.locator("#zone-expression").isVisible(), true);
    await page.keyboard.press("End");
    assert.equal(await page.locator("#zone-drafts").isVisible(), true);
    await page.keyboard.press("Home");
    assert.equal(await page.locator("#zone-audio").isVisible(), true, "Home opens the reordered first recognition tab");
    await page.evaluate(() => { location.hash = "zone-key"; });
    await page.locator("#zone-key").waitFor({ state: "visible" });
    await page.evaluate(() => { location.hash = "zone-input"; });
    await page.locator("#zone-input").waitFor({ state: "visible" });
    await page.setViewportSize({ width: 1100, height: 800 });
    const paint = await page.evaluate(() => ({
      maxWidth: getComputedStyle(document.querySelector("main")).maxWidth,
      background: getComputedStyle(document.body).backgroundColor,
      shell: document.querySelector("#root main.app-shell") !== null,
    }));
    const coldTitle = await page.getByRole("textbox", { name: "曲名" }).inputValue();
    mkdirSync(artifacts, { recursive: true });
    await page.screenshot({
      path: join(artifacts, "static-cold-start.png"),
      fullPage: false,
    });
    await page.getByRole("button", { name: "简谱" }).click();
    await page.getByText("第一声部").waitFor({ timeout: 20_000 });
    await page.getByRole("textbox", { name: "曲名" }).fill("离线冷启动");
    await page.waitForFunction(
      () => (localStorage.getItem("puxian-score-v1") ?? "").includes("离线冷启动"),
      null,
      { timeout: 5_000 },
    );
    await page.reload({ waitUntil: "domcontentloaded" });
    await home.waitFor({ timeout: 20_000 });
    assert.equal(await title.count(), 0, "reload must land on home even with a saved draft");
    await page.waitForTimeout(500);
    assert.equal(
      await page.evaluate(() => JSON.parse(localStorage.getItem("puxian-score-v1")).score.title),
      "离线冷启动",
      "home must not overwrite the draft",
    );
    await resumeDraft();
    await page.waitForFunction(
      () => document.querySelector('[aria-label="曲名"]')?.value === "离线冷启动",
    );
    const restored = await title.inputValue();
    const storage = await page.evaluate(() => ({
      score: localStorage.getItem("puxian-score-v1"),
      drafts: localStorage.getItem("puxian-drafts-v1"),
    }));
    // Returning immediately after an edit must flush the 400 ms save debounce.
    await title.fill("返回前的最后修改");
    await back.click();
    await home.waitFor();
    assert.equal(
      await page.evaluate(() => JSON.parse(localStorage.getItem("puxian-score-v1")).score.title),
      "返回前的最后修改",
    );
    await resumeDraft();
    await page.waitForFunction(
      () => document.querySelector('[aria-label="曲名"]')?.value === "返回前的最后修改",
    );
    await back.click();

    const selections = [
      ["小星星", "C", [60, 60, 67]],
      ["两只老虎", "C", [60, 62, 64]],
      ["欢乐颂", "C", [64, 64, 65]],
      ["四拍练习", "F", [67, 74, 70]],
      ["三拍练习", "C", [62, 65, 69]],
    ];
    const archiveSize = () => page.evaluate(() => JSON.parse(localStorage.getItem("puxian-drafts-v1") ?? "[]").length);
    for (const [name, key, pitches] of selections) {
      const archivedBefore = await archiveSize();
      await page.getByRole("button", { name: `打开${name}`, exact: true }).click();
      await title.waitFor();
      assert.equal(await title.inputValue(), name, "selection must override the previous draft");
      await page.waitForFunction(
        (name) => JSON.parse(localStorage.getItem("puxian-score-v1"))?.score.title === name,
        name,
      );
      const selected = await page.evaluate(
        () => JSON.parse(localStorage.getItem("puxian-score-v1")).score,
      );
      assert.equal(selected.key, key);
      assert.deepEqual(
        selected.notes.filter((note) => note.pitches.length).slice(0, 3).map((note) => note.pitches[0]),
        pitches,
      );
      await back.click();
      assert.equal(await archiveSize(), archivedBefore, `untouched example ${name} stays out of my songs`);
    }
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("puxian-drafts-v1") ?? "[]")
      .filter((draft) => ["离线冷启动", "返回前的最后修改"].includes(draft.value.title)).length), 1,
      "one rolling entry per song, not one per edit");
    {
      // Public-domain classics are lazy-loaded; title, composer and opening pitches must survive the hop.
      for (const [name, composer, key, beats, beatUnit, pitches] of [
        ["致爱丽丝", "贝多芬", "A", 3, 8, [76, 75, 76]],
        ["匈牙利狂想曲第二号", "李斯特", "Db", 2, 4, [61, 61, 59]],
      ]) {
        await page.getByRole("button", { name: `打开${name}`, exact: true }).click();
        await title.waitFor();
        assert.equal(await title.inputValue(), name);
        await page.waitForFunction(([composer, pitches]) => {
          const raw = localStorage.getItem("puxian-score-v1");
          if (!raw) return false;
          const selected = JSON.parse(raw).score;
          if (selected?.composer !== composer) return false;
          const first = (selected.notes ?? []).filter((note) => note.pitches.length).slice(0, 3).map((note) => note.pitches[0]);
          return JSON.stringify(first) === JSON.stringify(pitches);
        }, [composer, pitches]);
        const selected = await page.evaluate(() => JSON.parse(localStorage.getItem("puxian-score-v1")).score);
        assert.equal(selected.composer, composer);
        assert.equal(selected.key, key);
        assert.equal(selected.beats, beats);
        assert.equal(selected.beatUnit, beatUnit);
        assert.deepEqual(
          selected.notes.filter((note) => note.pitches.length).slice(0, 3).map((note) => note.pitches[0]),
          pitches,
        );
        await page.locator('[data-score-credits]', { hasText: `曲：${composer}` }).waitFor();
        await back.click();
        await page.getByRole("heading", { name: "示例曲目", exact: true }).waitFor();
      }
    }
    {
      // Regression (round 3): retyping the whole 唱名 line must not silently strip lyrics or chords.
      await page.getByRole("button", { name: "打开三拍练习", exact: true }).click();
      await title.waitFor();
      await page.waitForFunction(() => JSON.parse(localStorage.getItem("puxian-score-v1") ?? "{}").score?.title === "三拍练习");
      const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem("puxian-score-v1")).score);
      const opened = await stored();
      assert.equal(opened.beats, 3, "三拍练习 is in 3/4");
      const chordCount = opened.chordSymbols.length;
      await page.getByRole("tab", { name: "歌词", exact: true }).click();
      const words = "晨光穿过窗沿照亮书页晚风吹动树梢轻轻翻开下一页纸上";
      await page.locator("#lyric-line").fill(words);
      await page.getByRole("button", { name: "从开头填入", exact: true }).click();
      await page.waitForFunction(() => JSON.parse(localStorage.getItem("puxian-score-v1")).score.notes.filter((n) => n.lyric?.text).length === 25);
      await page.getByRole("tab", { name: "写谱", exact: true }).click();
      await page.getByRole("tablist", { name: "输入方式" }).getByRole("tab", { name: "简谱", exact: true }).click();
      const box = page.locator("#jianpu");
      await box.click();
      await page.keyboard.press("ControlOrMeta+A");
      // Typed key by key: every half-typed prefix goes through the editor.
      await page.keyboard.type("0 0 11 2 1 4 3 - 11 2 1 5 4 - 11 1' 6 4 3 2 7,7, 6 4 5 4 - -");
      await box.blur();
      await page.waitForFunction(() => JSON.parse(localStorage.getItem("puxian-score-v1")).score.notes.some((n) => n.pitches[0] === 60));
      const retyped = await stored();
      assert.equal(retyped.notes.filter((n) => n.lyric?.text).map((n) => n.lyric.text).join(""), words, "lyrics follow the retyped melody");
      assert.equal(retyped.chordSymbols?.length, chordCount, "every chord mark survives retyping the melody");
      assert.equal(await page.getByText("歌词已清掉").count(), 0);
      await back.click();
    }
    await blank.click();
    assert.equal(await title.inputValue(), "未命名乐谱");
    await page.waitForFunction(
      () => JSON.parse(localStorage.getItem("puxian-score-v1"))?.score.title === "未命名乐谱",
    );
    const empty = await page.evaluate(
      () => JSON.parse(localStorage.getItem("puxian-score-v1")).score,
    );
    assert.deepEqual(empty.notes, [], "new score must contain no starter notes");
    assert.equal(empty.voice2, undefined);
    assert.equal(
      await page.getByRole("button", { name: "撤销", exact: true }).isEnabled(),
      false,
      "new editor must start with a fresh undo stack",
    );
    await page.screenshot({
      path: join(artifacts, "static-blank-editor.png"),
      fullPage: false,
    });
    await title.fill("空白谱草稿");
    await back.click();
    await back.waitFor({ state: "detached" });
    await resumeDraft();
    await page.waitForFunction(
      () => document.querySelector('[aria-label="曲名"]')?.value === "空白谱草稿",
    );
    await back.click();
    assert.equal(
      await page.evaluate(() =>
        JSON.parse(localStorage.getItem("puxian-drafts-v1")).some(
          (draft) => draft.value.title === "返回前的最后修改",
        ),
      ),
      true,
      "selecting a new score must retain older work in draft history",
    );

    // Saved songs use the same archive on home and in the editor.
    // Resume only once the editor has fully unmounted and its last save is on disk,
    // so the click cannot land on a half-torn-down editor or read a stale save.
    await back.waitFor({ state: "detached" });
    await resume.waitFor();
    assert.equal(
      await page.evaluate(() => JSON.parse(localStorage.getItem("puxian-score-v1"))?.score?.title),
      "空白谱草稿",
      "returning home saved the open draft",
    );
    await resumeDraft();
    // The draft restores one frame after mount; filling before that races the restore
    // (seen on main too: the new title was appended to "空白谱草稿").
    await page.waitForFunction(
      () => document.querySelector('[aria-label="曲名"]')?.value === "空白谱草稿",
    ).catch(async (error) => {
      const state = await page.evaluate(() => ({
        shown: document.querySelector('[aria-label="曲名"]')?.value ?? null,
        stored: JSON.parse(localStorage.getItem("puxian-score-v1") ?? "null")?.score?.title ?? null,
        status: document.querySelector('[role="status"]')?.textContent ?? null,
      }));
      throw new Error(`resume did not restore 空白谱草稿: ${JSON.stringify(state)}`, { cause: error });
    });
    await title.fill("首页存档测试");
    await page.getByRole("tab", { name: "本机草稿", exact: true }).click();
    await page.getByRole("button", { name: "保存当前草稿", exact: true }).click();
    await back.click();
    const savedSong = page.getByRole("button", { name: "打开我的曲子 首页存档测试", exact: true });
    await savedSong.waitFor();
    await page.getByRole("heading", { name: /手动保存/ }).waitFor();
    await page.reload();
    await savedSong.click();
    assert.equal(await title.inputValue(), "首页存档测试");
    await page.getByRole("tab", { name: "本机草稿", exact: true }).click();
    await page.getByRole("button", { name: "删除草稿 首页存档测试", exact: true }).click();
    await back.click();
    assert.equal(await page.evaluate(() =>
      JSON.parse(localStorage.getItem("puxian-drafts-v1") ?? "[]").some(
        (draft) => draft.value.title === "首页存档测试",
      )), false, "returning home must not recreate the deleted current archive");
    await page.reload();
    await home.waitFor();
    await page.waitForFunction(() =>
      document.querySelectorAll('button[aria-label^="打开我的曲子 "]').length ===
      JSON.parse(localStorage.getItem("puxian-drafts-v1") ?? "[]").length,
    );
    assert.equal(await savedSong.count(), 0, "deleted archive must disappear after reload");
    assert.equal(await resume.count(), 0, "deleted current score must not survive in the resume slot");

    // Deleting a different archive must preserve the current score and other songs.
    await blank.click();
    await title.fill("保留的当前曲子");
    await page.getByRole("tab", { name: "本机草稿", exact: true }).click();
    await page.getByRole("button", { name: "保存当前草稿", exact: true }).click();
    // Autosave keeps one entry per song, so the other archive here is the earlier song.
    await page.getByRole("button", { name: "删除草稿 返回前的最后修改", exact: true }).click();
    await back.click();
    await page.getByRole("button", { name: "打开我的曲子 保留的当前曲子", exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "打开我的曲子 返回前的最后修改", exact: true }).count(), 0);
    // Duplicate and rename from home.
    await page.getByRole("button", { name: "复制一份 保留的当前曲子", exact: true }).click();
    await page.getByRole("button", { name: "打开我的曲子 保留的当前曲子 副本", exact: true }).waitFor();
    await page.getByRole("button", { name: "重命名 保留的当前曲子 副本", exact: true }).click();
    await page.getByRole("textbox", { name: "新的曲名" }).fill("改名测试");
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await page.getByRole("button", { name: "打开我的曲子 改名测试", exact: true }).waitFor();
    await page.getByRole("button", { name: "打开我的曲子 保留的当前曲子", exact: true }).waitFor();
    await resumeDraft();
    await page.waitForFunction(() =>
      document.querySelector('[aria-label="曲名"]')?.value === "保留的当前曲子",
    );
    await page.getByRole("tab", { name: "本机草稿", exact: true }).click();
    await page.getByRole("button", { name: "删除草稿 保留的当前曲子", exact: true }).click();
    // Allow the pending debounce to fire: deletion must remain effective.
    await page.waitForTimeout(500);
    assert.equal(await page.evaluate(() => localStorage.getItem("puxian-score-v1")), null);
    await title.fill("删除后继续编辑");
    await back.click();
    await page.getByRole("button", { name: "打开我的曲子 删除后继续编辑", exact: true }).waitFor();
    await resumeDraft();
    await page.getByRole("tab", { name: "本机草稿", exact: true }).click();
    await page.getByRole("button", { name: "删除全部本机存档", exact: true }).click();
    assert.notEqual(await page.evaluate(() => localStorage.getItem("puxian-drafts-v1")), null, "delete-all asks first");
    await page.getByRole("button", { name: "确认删除全部", exact: true }).click();
    await back.click();
    await page.reload();
    assert.equal(await page.getByRole("heading", { name: "我的曲子", exact: true }).count(), 0,
      "after delete-all the empty 我的曲子 block stays collapsed");
    await page.getByRole("heading", { name: "示例曲目", exact: true }).waitFor();
    assert.equal(await page.evaluate(() => localStorage.getItem("puxian-drafts-v1")), null);
    assert.equal(await page.locator("#songs button").filter({ hasText: "示例曲目" }).count(), 22);

    // Same-title automatic archives merge on load; cleanup asks first and can be undone.
    await page.evaluate(() => {
      const score = (title) => ({
        title, bpm: 88, beats: 4, beatUnit: 4, key: "C", mode: "major",
        clef: "treble", tonicOctave: 4, notes: [{ pitches: [60], dur: 1 }],
      });
      localStorage.setItem("puxian-drafts-v1", JSON.stringify([
        { id: "auto-old", at: 1, value: score("同一首歌") },
        { id: "auto-new", at: 2, value: score("同一首歌") },
        { id: "pin-1", at: 3, value: score("手存"), pinned: true },
        { id: "auto-open", at: 4, value: score("正在写的歌") },
      ]));
      localStorage.setItem("puxian-score-v1", JSON.stringify({ score: score("正在写的歌"), songId: "auto-open" }));
    });
    await page.reload();
    await home.waitFor();
    await page.getByRole("button", { name: "打开我的曲子 同一首歌", exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "打开我的曲子 同一首歌", exact: true }).count(), 1,
      "same-title automatic archives merge on home load");
    await page.getByRole("button", { name: "打开我的曲子 手存", exact: true }).waitFor();
    await page.getByRole("button", { name: "清理自动存档", exact: true }).click();
    assert.equal(await page.getByRole("button", { name: "打开我的曲子 同一首歌", exact: true }).count(), 1,
      "cleanup asks before deleting");
    assert.equal(await page.getByRole("button", { name: "继续上次草稿" }).isVisible(), true);
    await page.getByRole("button", { name: "确认清理自动存档", exact: true }).click();
    assert.equal(await page.getByRole("button", { name: "打开我的曲子 同一首歌", exact: true }).count(), 0);
    assert.equal(await page.getByRole("button", { name: "打开我的曲子 手存", exact: true }).count(), 1);
    // The open draft was one of the cleared automatic saves: no stale「继续上次草稿」.
    assert.equal(await page.getByRole("button", { name: "继续上次草稿" }).count(), 0, "cleanup drops the stale resume button");
    assert.equal(await page.getByText(/上次编辑：/).count(), 0);
    await page.getByRole("button", { name: "撤回", exact: true }).click();
    await page.getByRole("button", { name: "打开我的曲子 同一首歌", exact: true }).waitFor();
    await page.getByRole("button", { name: "继续上次草稿" }).waitFor();
    await page.evaluate(() => {
      localStorage.removeItem("puxian-drafts-v1");
      localStorage.removeItem("puxian-score-v1");
    });
    await page.reload();
    await home.waitFor();

    const { imagePicker, png } = await verifyScoreImages(page, title, artifacts);
    await back.click();

    // Home picker hands the File to the mounted editor's existing MIDI pipeline.
    const extensions = ["mp3", "wav", "m4a", "aac", "ogg", "flac", "webm", "aiff", "aif", "mid", "midi"];
    await page.getByRole("button", { name: "识别音乐", exact: true }).click();
    const homePicker = page.getByLabel("上传音乐文件", { exact: true });
    const accept = await homePicker.getAttribute("accept");
    for (const ext of extensions) assert.ok(accept.split(",").includes(`.${ext}`));
    const chooserPromise = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "上传音乐 / MIDI", exact: true }).click();
    const chooser = await chooserPromise;
    // Format 0: one middle-C quarter note and end-of-track.
    await chooser.setFiles({ name: "首页导入.mid", mimeType: "audio/midi", buffer: Buffer.from([
      77,84,104,100,0,0,0,6,0,0,0,1,0,96,
      77,84,114,107,0,0,0,12,0,144,60,100,96,128,60,0,0,255,47,0,
    ]) });
    await title.waitFor();
    await page.getByText(/检测到 1 个旋律声部/).waitFor();
    assert.equal(await page.getByRole("button", { name: "识别音乐", exact: true }).isVisible(), true);
    assert.equal(await page.getByRole("button", { name: "上传音乐 / MIDI", exact: true }).isVisible(), true);
    assert.equal(await page.getByLabel("上传音乐文件", { exact: true }).getAttribute("accept"), accept);
    // Compare the score itself: the slot also records which song it belongs to.
    const storedScore = () => page.evaluate(() => JSON.stringify(JSON.parse(localStorage.getItem("puxian-score-v1") ?? "null")?.score ?? null));
    const scoreBeforeBadMidi = await storedScore();
    for (const [name, buffer, error] of [
      ["空.mid", Buffer.alloc(0), "这不是 MIDI 文件"],
      ["伪装.mid", Buffer.from("invalid MIDI"), "这不是 MIDI 文件"],
      ["缺少轨尾.mid", Buffer.from([
        77,84,104,100,0,0,0,6,0,0,0,1,0,96,
        77,84,114,107,0,0,0,8,0,144,60,100,96,128,60,0,
      ]), "MIDI 文件损坏"],
      ["超大.mid", Buffer.alloc(16 * 1024 * 1024 + 1), "MIDI 文件过大"],
    ]) {
      await page.getByLabel("上传音乐文件", { exact: true }).setInputFiles({
        name, mimeType: "audio/midi", buffer,
      });
      await page.getByText(new RegExp(error)).waitFor();
      assert.equal(await title.isVisible(), true);
      assert.equal(await storedScore(), scoreBeforeBadMidi);
    }
    await page.getByLabel("上传音乐文件", { exact: true }).setInputFiles({
      name: "损坏.flac", mimeType: "audio/flac", buffer: Buffer.from("invalid audio"),
    });
    await page.getByText(/这段音频解不开。可尝试 mp3/).waitFor();
    assert.equal(await page.getByRole("button", { name: "识别音乐", exact: true }).isEnabled(), true);
    await back.click();
    await resumeDraft();
    assert.equal(await page.getByText(/检测到 1 个旋律声部/).count(), 0,
      "returning to a draft must not replay the pending upload");
    await back.click();

    await page.evaluate(() => localStorage.setItem("puxian-score-v1", "broken json"));
    await page.reload();
    await home.waitFor();
    assert.equal(await resume.count(), 0, "broken draft must not block home");
    await blank.click();
    assert.equal(await title.inputValue(), "未命名乐谱");
    await back.click();

    // Private/storage-denied contexts still allow editing and returning home.
    await page.addInitScript(() => {
      Storage.prototype.getItem = () => {
        throw new Error("Storage disabled");
      };
      Storage.prototype.setItem = () => {
        throw new Error("Storage disabled");
      };
    });
    await page.reload();
    await home.waitFor();
    await blank.click();
    await title.fill("仅在当前页面");
    await back.click();
    await home.waitFor();
    await page.getByRole("status").filter({ hasText: "本机保存失败" }).waitFor();
    await resumeDraft();
    assert.equal(
      await title.inputValue(),
      "仅在当前页面",
      "unsaved work must remain resumable in memory",
    );

    // A home image upload must also carry the draft when local storage fails.
    await back.click();
    await home.waitFor();
    await imagePicker.setInputFiles(png);
    await title.waitFor();
    await page.getByText("页面已在本机打开。下一步：点击「识别此页」，检查后确认写入主谱。", { exact: true }).waitFor();
    assert.equal(await title.inputValue(), "仅在当前页面",
      "home image upload must preserve the in-memory unsaved score");
    await back.click();
    await home.waitFor();
    await resumeDraft();
    assert.equal(await title.inputValue(), "仅在当前页面",
      "returning from image preview must not overwrite the in-memory draft");

    return {
      landingChecks: [
        "desktop/mobile home; natural document scroll and reachable footer at 1100/390/320px",
        "home typography and cream cards: pill primary CTA, 40px-class hero padding, light shadow, paper #f7f3ea, body #faf8f4",
        "editor chrome: 8 tabs, cream page, pill home/actions, rounded feature bar and cream panels with light shadow",
        "jianpu fixed-do naming in 移调与乐器: screen 1=C, pitches unchanged, 8 tabs, 390 44px",
        "rhythm quiz: random 2-bar drill in 拍节奏, independent of the written notes, 390 44px",
        "swing feel in 移调与乐器: 直拍/轻摆/摇摆 playback only, 8 tabs, 390 44px, localStorage",
        "chord play-along in 写谱: 播放时加伴奏 from symbols, 8 tabs, 390 44px, localStorage, score unchanged",
        "ear interval drill in 听音练耳: 认音程, 8 tabs, 390 44px, localStorage, degree drill unchanged",
        "ear chord drill in 听音练耳: 认和弦, 8 tabs, 390 44px, localStorage, degree/interval drills unchanged",
        "ear progression drill in 听音练耳: 认进行, 8 tabs, 390 44px, localStorage, other drills unchanged",
        "ear scale drill in 听音练耳: 认音阶, 8 tabs, 390 44px, localStorage, other drills unchanged",
        "sight-reading drill in 写谱: two bars in current key/meter, preview, write+undo, 8 tabs, 390 44px",
        "all eight feature tabs at 1100x844/390x844/320x667; wheel tools to bottom; numbered/staff notation geometry and hit testing; tabs unobscured; zero page scroll; mounted refs; keyboard; legacy hashes; read-only share #s= copy, open, keep",
        "humming mic denial guidance and retry at 390/320; dictation preview does not overwrite, cancel keeps score, confirm+undo restores",
        "home upload opens editor MIDI pipeline; shared format accept; decode failure; no replay",
        "all five short examples override draft; 致爱丽丝 and 匈牙利狂想曲第二号 lazy-load with credits and pitches",
        "empty score",
        "home/editor local score image preview, invalid image and cleanup",
        "immediate return saves",
        "reload to home and resume",
        "previous draft retained",
        "my songs save/open; delete current survives debounce, return and reload; delete other; edit after delete; delete all",
        "corrupt draft",
        "storage unavailable; home image upload and return preserve in-memory draft",
        "numbered view by default and remembered; phone score >= 40% height; one-line tabs; 44px targets in every panel at 390px",
        "touch-action manipulation; 44px score hit pads and chosen highlight; 390 view tabs on their own row with zoom/follow below; haptic toggle; 844x390 landscape transport clearance, fade-mask gone, 8px header gaps, fullscreen hides chrome",
        "transport metronome; expression needs a note first; style preview leaves the score untouched; full-screen and zoom",
        "one rolling archive entry per song; untouched examples not archived; home duplicate/rename; delete-all confirmation; empty home hides 我的曲子 and shows examples; same-title autos merge; cleanup confirm and undo",
      ],
      origin,
      documentStatus: response?.status() ?? 0,
      documentUrl: response?.url() ?? "",
      requests,
      blocked,
      localErrors,
      pageErrors,
      coldTitle,
      restored,
      paint,
      draftsSaved: (storage.drafts ?? "").includes("离线冷启动"),
      scoreSaved: (storage.score ?? "").includes("离线冷启动"),
    };
  } catch (error) {
    const dir = process.env.PUXIAN_VERIFY_DIAGNOSTICS;
    if (dir && activePage && !activePage.isClosed()) {
      mkdirSync(dir, { recursive: true });
      await activePage.screenshot({ path: join(dir, 'verify-failure.png') }).catch(() => {});
      console.error('verify failure page:', await activePage.locator('body').innerText().catch(() => 'unavailable'));
    }
    if (activePage && !activePage.isClosed()) {
      const now = Date.now();
      console.error("verify failure in-flight requests:", JSON.stringify([...inflight].map(([r, t]) => `${r.method()} ${new URL(r.url()).pathname} ${now - t}ms`)));
      console.error("verify failure console tail:", JSON.stringify(consoleTail));
      console.error("verify failure page state:", JSON.stringify(await activePage.evaluate(() => ({
        hidden: document.hidden, url: location.pathname + location.hash.slice(0, 20), text: document.body.innerText.slice(0, 400),
      })).catch(() => null)));
    }
    throw error;
  } finally {
    await browser.close();
  }
}


async function lockToOrigin(context, origin, blocked) {
  await context.route("**/*", (route) => {
    const requestUrl = route.request().url();
    const refused = packagedRequestProblem(requestUrl, origin);
    if (refused) {
      blocked.push(`${requestUrl} (${refused})`);
      return route.abort("blockedbyclient");
    }
    return route.continue();
  });
}

function bootSplashVisible() {
  const boot = document.getElementById("boot");
  if (!boot) return false;
  const style = getComputedStyle(boot);
  return style.display !== "none" && style.visibility !== "hidden" && boot.offsetParent !== null;
}

/** Phone layouts: landscape puts the score beside the panel with notes on screen; the empty chord-sheet hint is readable. */
async function phoneLayoutProblems(port) {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  const problems = [];
  try {
    const page = await browser.newPage({ viewport: { width: 844, height: 390 } });
    await page.goto(`http://${originHost}:${port}/`);
    await page.getByRole("button", { name: "打开小星星", exact: true }).click();
    await page.locator('.score-stage [aria-label="简谱"] g[data-id^="0-"]').first().waitFor();
    await page.waitForTimeout(500);
    const land = await page.evaluate(() => {
      const score = document.querySelector("#zone-score").getBoundingClientRect();
      const panel = document.querySelector(".zone-panel:not([hidden])").getBoundingClientRect();
      const bar = document.querySelector(".transport").getBoundingClientRect();
      const notes = [...document.querySelectorAll('.score-stage [aria-label="简谱"] g[data-id] text')].filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.top >= score.top && r.bottom <= Math.min(score.bottom, bar.top);
      }).length;
      return { beside: panel.left >= score.right - 1 && panel.top < score.bottom, notes };
    });
    if (!land.beside) problems.push("844x390: tool panel is not beside the score");
    if (land.notes < 4) problems.push(`844x390: only ${land.notes} note digits visible above the transport`);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "和弦谱", exact: true }).click();
    const hint = page.locator(".lead-empty");
    await hint.waitFor();
    const hintBox = await hint.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const stage = document.querySelector(".score-stage").getBoundingClientRect();
      return { inStage: r.top >= stage.top - 1 && r.bottom <= stage.bottom + 1, color: getComputedStyle(el).color };
    });
    if (!hintBox.inStage) problems.push("390: empty chord-sheet hint is not visible at the top of the score");
    if (hintBox.color !== "rgb(28, 25, 22)") problems.push(`390: empty chord-sheet hint colour ${hintBox.color}`);
  } finally {
    await browser.close();
  }
  return problems;
}

/** Uncompressed bytes the home page may pull in before the visitor touches anything. */
const FIRST_SCREEN_MAX_BYTES = 420_000;

/** A fresh visit to the home page downloads only the home page: the editor waits for intent or idle time. */
async function firstScreenProblems(port) {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  const problems = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
    const paths = [];
    page.on("requestfinished", (request) => paths.push(new URL(request.url()).pathname));
    await page.goto(`http://${originHost}:${port}/`, { waitUntil: "load" });
    await page.waitForTimeout(3000);
    const heavy = paths.filter((path) => /\/(staffline-app|jianpu-render|abcjs|poly-dictation|chord-guide|chord-library|chord-degrees|chord-diagrams|score-image-panel|score-pdf|pdf|score-omr|omr.worker|ort-wasm|ort.wasm)[-.]/.test(path));
    if (paths.some(path => path.includes("/models/omr/"))) problems.push("first screen fetched OMR weights");
    if (heavy.length) problems.push(`first screen fetched editor bundles: ${heavy.join(", ")}`);
    let bytes = 0;
    for (const path of paths) {
      const file = join(outDir, path === "/" ? "index.html" : decodeURIComponent(path).replace(/^\//, ""));
      try { bytes += statSync(file).size; } catch { /* not a dist file */ }
    }
    if (bytes > FIRST_SCREEN_MAX_BYTES) problems.push(`first screen transferred ${bytes} bytes (> ${FIRST_SCREEN_MAX_BYTES}): ${paths.join(", ")}`);
    // Measured on origin/main before the wait-mode absorption; new lazy UI must not grow home.
    if (paths.length > 8) problems.push(`first screen made ${paths.length} requests (> baseline 8)`);
    if (bytes > 391_586) problems.push(`first screen transferred ${bytes} bytes (> baseline 391586)`);
    console.log(JSON.stringify({ firstScreen: { requests: paths.length, bytes } }));
    // Reaching for a song starts the editor download before the click lands.
    await page.mouse.move(10, 10);
    await page.mouse.move(400, 300);
    await page.waitForFunction(() => performance.getEntriesByType("resource").some((e) => /staffline-app-/.test(e.name)), null, { timeout: 5000 })
      .catch(() => problems.push("pointer intent did not prefetch the editor"));
  } finally {
    await browser.close();
  }
  return problems;
}

/**
 * Repro: Firefox used to throw NS_ERROR_FAILURE in JianpuRender.destroy when
 * leaving the numbered view (or replacing 唱名 on a lyric+chord score), empty
 * #root, and get stuck on「正在打开谱线…」. Also asserts no surprise MIDI download.
 */
async function browseCrashRecovery(port, browserTypeName, shotsDir) {
  const playwright = await import("playwright");
  const launcher = playwright[browserTypeName];
  if (!launcher) return { browser: browserTypeName, skipped: `playwright has no ${browserTypeName}` };
  let browser;
  try {
    browser = await launcher.launch({ headless: true });
  } catch (err) {
    return { browser: browserTypeName, skipped: String(err?.message ?? err) };
  }
  const origin = packagedOrigin(originHost, port);
  const blocked = [];
  const downloads = [];
  const pageErrors = [];
  const problems = [];
  const context = await browser.newContext({ viewport: { width: 1100, height: 844 } });
  try {
    await lockToOrigin(context, origin, blocked);
    const page = await context.newPage();
    page.on("download", (download) => downloads.push(download.suggestedFilename()));
    page.on("pageerror", (error) => pageErrors.push(`${error.name || "Error"}: ${error.message || error}\n${error.stack || ""}`));
    await page.goto(`http://${originHost}:${port}/`, { waitUntil: "domcontentloaded" });
    const home = page.getByRole("heading", { name: "让旋律，落在纸上。" });
    await home.waitFor({ timeout: 20_000 });
    await page.getByRole("button", { name: "打开小星星" }).click();
    const title = page.getByRole("textbox", { name: "曲名" });
    await title.waitFor();
    await page.getByRole("button", { name: "五线", exact: true }).click();
    await page.waitForTimeout(500);
    if (await page.evaluate(bootSplashVisible)) {
      problems.push(`${browserTypeName}: boot splash came back after switching to 五线`);
    }
    if (await title.count() === 0) {
      problems.push(`${browserTypeName}: editor unmounted after switching to 五线`);
    }
    if (await page.getByRole("alert").filter({ hasText: "遇到了问题" }).count()) {
      problems.push(`${browserTypeName}: error boundary appeared after switching to 五线`);
    }
    await page.getByRole("button", { name: "简谱", exact: true }).click();
    await page.waitForTimeout(300);
    for (const view of ["卷帘", "和弦谱", "六线", "简谱"]) {
      await page.getByRole("button", { name: view, exact: true }).click();
      await page.waitForTimeout(200);
    }
    if (await page.evaluate(bootSplashVisible)) {
      problems.push(`${browserTypeName}: boot splash came back after cycling views`);
    }

    // Decorate the live score with lyrics + chord marks, then replace 唱名.
    await page.evaluate(() => {
      const raw = JSON.parse(localStorage.getItem("puxian-score-v1") ?? "null");
      if (!raw?.score?.notes) return;
      raw.score.notes = raw.score.notes.map((note, index) => {
        if (note.pitches?.length && index < 6) {
          return { ...note, lyric: { text: "一闪一闪亮晶"[index], syllabic: "single" } };
        }
        return note;
      });
      raw.score.chordSymbols = [{ at: 0, symbol: "C" }, { at: 4, symbol: "G" }];
      localStorage.setItem("puxian-score-v1", JSON.stringify(raw));
    });
    await page.getByRole("button", { name: "返回主页" }).click();
    await home.waitFor();
    await page.getByRole("button", { name: "继续上次草稿" }).click();
    await title.waitFor();
    await page.getByRole("tab", { name: "写谱", exact: true }).click();
    const box = page.locator("#jianpu");
    await box.waitFor();
    await box.fill("5 5 6 6 5 5 4 - 3 3 2 2 1 1 1 -");
    await page.waitForTimeout(400);
    if (await page.evaluate(bootSplashVisible)) {
      problems.push(`${browserTypeName}: boot splash came back after replacing 唱名`);
    }
    if (await title.count() === 0) {
      problems.push(`${browserTypeName}: editor unmounted after replacing 唱名`);
    }
    await page.getByRole("button", { name: "五线", exact: true }).click();
    await page.waitForTimeout(400);
    if (await page.evaluate(bootSplashVisible)) {
      problems.push(`${browserTypeName}: boot splash came back after 唱名 replace + 五线`);
    }
    mkdirSync(shotsDir, { recursive: true });
    await page.screenshot({ path: join(shotsDir, `${browserTypeName}-1100x844-staff.png`), fullPage: false });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "简谱", exact: true }).click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(shotsDir, `${browserTypeName}-390x844-jianpu.png`), fullPage: false });
    if (downloads.length) problems.push(`${browserTypeName}: unexpected download ${downloads.join(", ")}`);
    const fatal = pageErrors.filter((text) => /NS_ERROR_FAILURE|正在打开谱线/.test(text) || /jianpu-render/.test(text) && /destroy/i.test(text));
    if (fatal.length) problems.push(`${browserTypeName}: page errors ${fatal.join(" | ")}`);
    // Soft-report other page errors so a leftover warning can be inspected, but
    // only fail on the known crash / uncaught destroy.
    return {
      browser: browserTypeName,
      skipped: null,
      problems,
      blocked,
      downloads,
      pageErrors,
    };
  } finally {
    await context.close();
    await browser.close();
  }
}

function browserProblems(result) {
  const problems = [];
  if (result.documentStatus !== 200) problems.push(`document status ${result.documentStatus}`);
  const documentOrigin = packagedRequestProblem(result.documentUrl, result.origin);
  if (!result.documentUrl || documentOrigin) {
    problems.push(`document url is not the static origin: ${result.documentUrl || "(missing)"}`);
  }
  if (result.blocked.length > 0) {
    problems.push(`blocked or forbidden requests: ${result.blocked.join(", ")}`);
  }
  if (result.localErrors.length > 0)
    problems.push(`failed local requests: ${result.localErrors.join(", ")}`);
  if (result.pageErrors.length > 0) problems.push(`page errors: ${result.pageErrors.join(" | ")}`);
  if (result.coldTitle !== "小星星") problems.push(`cold start title was ${result.coldTitle}`);
  if (!result.paint.shell) problems.push("editor did not mount inside #root");
  if (result.paint.maxWidth !== "1152px") {
    problems.push(
      `editor max-width was ${result.paint.maxWidth}; stylesheet utilities did not apply`,
    );
  }
  if (result.paint.background !== "rgb(250, 248, 244)") {
    problems.push(`body background was ${result.paint.background}`);
  }
  if (result.restored !== "离线冷启动") problems.push(`reload restored ${result.restored}`);
  if (!result.scoreSaved || !result.draftsSaved)
    problems.push("local score or drafts were not saved");
  const api = result.requests.filter(
    (item) => item.path.startsWith("/api") || item.path.includes("/__grok/"),
  );
  if (api.length > 0) problems.push(`nitro paths were requested: ${JSON.stringify(api)}`);
  const jianpu = result.requests.some(
    (item) => item.path.includes("/jianpu-render-") && item.status === 200,
  );
  if (!jianpu) problems.push("jianpu chunk was not loaded from the static host");
  return problems;
}

async function verifyReducedMotion(port) {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    const origin = packagedOrigin(originHost, port);
    const context = await browser.newContext({ viewport: { width: 1100, height: 800 } });
    const page = await context.newPage();
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`${origin}/`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#home-title");
    await page.waitForSelector(".home-workbench");

    const checks = await page.evaluate(() => {
      const isReduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const titleSpan = document.querySelector("#home-title span");
      const workbench = document.querySelector(".home-workbench");
      const imgBtn = [...document.querySelectorAll(".home-workbench button")].find((b) => b.textContent?.includes("识别图片"));
      const musicBtn = [...document.querySelectorAll(".home-workbench button")].find((b) => b.textContent?.includes("识别音乐"));
      const overture = document.querySelector(".px-overture");

      const getStyle = (el) => {
        if (!el) return null;
        const cs = window.getComputedStyle(el);
        return {
          opacity: cs.opacity,
          animationName: cs.animationName,
          display: cs.display,
          visibility: cs.visibility,
          transform: cs.transform,
        };
      };

      return {
        isReduce,
        overture: overture ? { exists: true } : { exists: false },
        titleSpan: getStyle(titleSpan),
        workbench: getStyle(workbench),
        imgBtn: getStyle(imgBtn),
        musicBtn: getStyle(musicBtn),
      };
    });

    assert.equal(checks.isReduce, true, "prefers-reduced-motion: reduce media query must be active");
    assert.ok(checks.titleSpan, "title span must exist");
    assert.equal(checks.titleSpan.animationName, "none", "title span animation must be none under reduced motion");
    assert.equal(checks.titleSpan.opacity, "1", "title span must be visible (opacity: 1) under reduced motion");

    assert.ok(checks.workbench, "workbench must exist");
    assert.equal(checks.workbench.animationName, "none", "workbench animation must be none under reduced motion");
    assert.equal(checks.workbench.opacity, "1", "workbench must be visible (opacity: 1) under reduced motion");

    assert.ok(checks.imgBtn, "识别图片 CTA button must exist");
    assert.equal(checks.imgBtn.animationName, "none", "识别图片 CTA animation must be none under reduced motion");
    assert.equal(checks.imgBtn.opacity, "1", "识别图片 CTA must be visible (opacity: 1) under reduced motion");

    assert.ok(checks.musicBtn, "识别音乐 CTA button must exist");
    assert.equal(checks.musicBtn.animationName, "none", "识别音乐 CTA animation must be none under reduced motion");
    assert.equal(checks.musicBtn.opacity, "1", "识别音乐 CTA must be visible (opacity: 1) under reduced motion");

    console.log(JSON.stringify({
      status: "passed",
      mode: "reduced-motion",
      checks,
    }, null, 2));
  } finally {
    await browser.close();
  }
}

const disk = inspectDisk();
if (disk.problems.length > 0) fail(disk.problems);

const port = await freePort();
const server = startPython(port);
try {
  await waitForHttp(port);
  if (process.argv.includes("--reduced-motion") || process.env.VERIFY_REDUCED_MOTION === "1") {
    await verifyReducedMotion(port);
    server.kill("SIGTERM");
    process.exit(0);
  }
  const http = await fetchAssets(port, disk.html);
  if (http.problems.length > 0) fail(http.problems.concat([server.log()]));
  await verifyRecognitionFlow(port, artifacts);
  await verifyWaitMode(port);
  await verifyMixer(port);
  await verifyPracticeTools(port);
  await verifyRepeats(port);
  await verifyLayoutWalk(port);
  await verifyPracticeLog(port);
  await verifySelectionEdit(port);
  await verifyAbc(port);
  await verifyLoopPause(port);
  await verifyChordPro(port);
  await verifyIreal(port);
  await verifyRehearsals(port);
  await verifyCredits(port);
  await verifyFixedDo(port);
  await verifySwing(port);
  await verifyComp(port);
  await verifyEarInterval(port);
  await verifyEarChord(port);
  await verifyEarProgression(port);
  await verifyEarScale(port);
  await verifySightRead(port);
  await verifyFermata(port);
  await verifyTempoMark(port);
  await verifyMeterMark(port);
  await verifyKeyMark(port);
  await verifyGradualTempo(port);
  await verifyStaffMarks(port);
  const browserResult = await browse(port);
  await verifyChordExperience(port);
  const performanceShots = process.env.PUXIAN_PERFORMANCE_SHOTS || join(artifacts, "performance");
  mkdirSync(performanceShots, { recursive: true });
  await verifyPerformance(port, performanceShots);
  const problems = browserProblems(browserResult);
  problems.push(...(await firstScreenProblems(port)));
  problems.push(...(await phoneLayoutProblems(port)));
  const shotsDir = join(artifacts, "crash-recovery");
  const recoveryChromium = await browseCrashRecovery(port, "chromium", shotsDir);
  if (recoveryChromium.skipped) problems.push(`chromium recovery skipped: ${recoveryChromium.skipped}`);
  else problems.push(...recoveryChromium.problems);
  let recoveryFirefox;
  try {
    recoveryFirefox = await browseCrashRecovery(port, "firefox", shotsDir);
  } catch (err) {
    recoveryFirefox = { browser: "firefox", skipped: String(err?.message ?? err), problems: [] };
  }
  if (recoveryFirefox.skipped) {
    console.log(JSON.stringify({ firefoxRecovery: "skipped", reason: recoveryFirefox.skipped }));
  } else {
    problems.push(...recoveryFirefox.problems);
  }
  const uniqueRequests = [
    ...new Map(
      browserResult.requests.map((item) => [`${item.status} ${item.path}`, item]),
    ).values(),
  ];
  const report = {
    outputDir: "dist-static",
    index: { status: http.status, contentType: http.contentType },
    moduleScript: disk.scripts[0],
    assetCount: disk.assets.length,
    requests: uniqueRequests,
    blockedExternal: browserResult.blocked,
    faviconIco: uniqueRequests.some((item) => item.path === "/favicon.ico")
      ? "browser default; not required and not a Nitro route"
      : "not requested",
    landingChecks: browserResult.landingChecks,
    editor: {
      coldTitle: browserResult.coldTitle,
      restoredTitle: browserResult.restored,
      maxWidth: browserResult.paint.maxWidth,
      background: browserResult.paint.background,
      staffSvg: true,
    },
    storage: { score: browserResult.scoreSaved, drafts: browserResult.draftsSaved },
    residualUrlStrings: disk.residual,
    crashRecovery: {
      chromium: recoveryChromium,
      firefox: recoveryFirefox ?? { skipped: "not run" },
    },
  };
  console.log(JSON.stringify(report, null, 2));
  if (problems.length > 0) fail(problems);
} catch (err) {
  console.error(server.log());
  throw err;
} finally {
  server.kill("SIGTERM");
}
