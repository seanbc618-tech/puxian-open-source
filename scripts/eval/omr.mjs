import { readFileSync, appendFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { JSDOM } from "jsdom";
import { browserSession, output, save, events, compare } from "./common.mjs";
import { musicXmlToScore } from "../../src/lib/music/musicxml.ts";
import { compileRecognition } from "../../src/lib/omr/recognition.ts";
globalThis.DOMParser = new JSDOM("").window.DOMParser;
mkdirSync(output, { recursive: true });
const cases = JSON.parse(readFileSync("eval/generated/cases.json", "utf8"));
const limit = Number(process.env.EVAL_CASE_SECONDS || 150);
const { page, close } = await browserSession();
const previous =
  process.env.EVAL_RESUME && existsSync(resolve(output, "omr.jsonl"))
    ? readFileSync(resolve(output, "omr.jsonl"), "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map(JSON.parse)
    : [];
if (!process.env.EVAL_RESUME)
  await import("node:fs").then((fs) => fs.writeFileSync(resolve(output, "omr.jsonl"), ""));
const priorEnvironment =
  process.env.EVAL_RESUME && existsSync(resolve(output, "omr-environment.json"))
    ? JSON.parse(readFileSync(resolve(output, "omr-environment.json"), "utf8"))
    : null;
const rows = [...previous];
// Never leave a stale complete JSON result after an interrupted new run.
save("omr-results.json", rows);
const wall = performance.now();
try {
  for (const row of previous) {
    const item = cases.find((c) => c.id === row.id && c.variant === row.variant);
    if (!item || item.sha256 !== row.sha256)
      throw Error("Resume fixture changed: " + row.id + "/" + row.variant);
  }
  await page.evaluate(async () => {
    const { default: WorkerClass } = await import("/src/lib/omr/omr.worker.ts?worker");
    window.EvalWorker = WorkerClass;
  });
  for (const item of cases) {
    if (rows.some((row) => row.id === item.id && row.variant === item.variant)) continue;
    if (performance.now() - wall > 3300e3)
      throw new Error("OMR suite budget exceeded; resume explicitly using EVAL_RESUME=1");
    console.log("START", item.id, item.variant);
    const raw = await page.evaluate(
      async ({ base64, limit }) => {
        const blob = await (await fetch("data:image/jpeg;base64," + base64)).blob();
        const bitmap = await createImageBitmap(blob);
        const start = performance.now();
        window.omrWorker ??= new window.EvalWorker();
        const worker = window.omrWorker;
        return await new Promise((resolve) => {
          const messages = [];
          const done = (timeout = false) => {
            clearTimeout(timer);
            worker.onmessage = null;
            if (timeout) {
              worker.terminate();
              window.omrWorker = null;
            }
            resolve({ messages, seconds: (performance.now() - start) / 1000, timeout });
          };
          const timer = setTimeout(() => done(true), limit * 1000);
          worker.onmessage = (e) => {
            messages.push(e.data);
            if (["result", "error"].includes(e.data.kind)) done();
          };
          worker.onerror = (e) => {
            messages.push({ kind: "error", message: e.message });
            done(true);
          };
          worker.postMessage({ bitmap, base: location.origin + "/models/omr/" }, [bitmap]);
        });
      },
      { base64: readFileSync(item.path).toString("base64"), limit },
    );
    const fragments = raw.messages
      .filter((m) => m.kind === "system")
      .map((m) => ({
        page: 1,
        system: m.index,
        text: m.text,
        complete: m.complete,
        error: m.error,
      }));
    const progress = raw.messages.filter((m) => m.kind === "progress" && m.text).at(-1);
    if (raw.timeout && progress?.text && !fragments.some((f) => f.system === progress.system))
      fragments.push({
        page: 1,
        system: progress.system,
        text: progress.text,
        complete: false,
        error: "eval per-case timeout",
      });
    const result = compileRecognition(
      fragments,
      [
        {
          page: 1,
          done: !raw.timeout,
          error: raw.messages.find((m) => m.kind === "error")?.message,
          warnings: raw.messages.find((m) => m.kind === "page")?.warnings || [],
        },
      ],
      item.id,
      musicXmlToScore,
    );
    const predicted = result.draft ? events(result.draft.score) : [];
    let metrics = null;
    if (item.truth)
      metrics = compare(
        events(musicXmlToScore(readFileSync(item.truth, "utf8"), item.id).score),
        predicted,
        item.ends,
      );
    if (metrics && !result.draft)
      metrics.bars.forEach((b) => {
        b.strict = false;
        b.usable = false;
      });
    const row = {
      ...item,
      ...raw,
      draft: !!result.draft,
      partial: result.draft?.partial,
      issues: result.issues,
      losses: result.draft?.losses,
      predicted,
      metrics,
    };
    rows.push(row);
    appendFileSync(resolve(output, "omr.jsonl"), JSON.stringify(row) + "\n");
    save("omr-results.json", rows);
    console.log(
      "DONE",
      item.id,
      item.variant,
      JSON.stringify({
        seconds: raw.seconds,
        draft: row.draft,
        timeout: raw.timeout,
        usable: metrics?.bars.filter((b) => b.usable).length,
        bars: metrics?.bars.length,
        issues: row.issues,
      }),
    );
  }
  save("omr-environment.json", {
    date: new Date().toISOString(),
    node: process.version,
    wallSeconds: (priorEnvironment?.wallSeconds || 0) + (performance.now() - wall) / 1000,
    sessionWallSeconds: (performance.now() - wall) / 1000,
    priorRunWallSeconds: priorEnvironment?.wallSeconds || 0,
    reusedCases: previous.length,
    validCaseSeconds: rows.reduce((sum, row) => sum + row.seconds, 0),
    perCaseSeconds: limit,
    seed: 20261114,
    model: JSON.parse(readFileSync("src/lib/omr/manifest.json", "utf8")),
    cases: rows.length,
  });
} finally {
  await close();
}
