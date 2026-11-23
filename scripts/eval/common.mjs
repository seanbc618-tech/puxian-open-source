import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { createServer } from "vite";
export const output = resolve(process.env.EVAL_LOG_DIR || "../r");
export const save = (name, value) => {
  mkdirSync(output, { recursive: true });
  writeFileSync(resolve(output, name), JSON.stringify(value, null, 2) + "\n");
};
export async function browserSession() {
  const server = await createServer({
    configFile: false,
    optimizeDeps: { noDiscovery: true, entries: [] },
    server: { host: "127.0.0.1", port: 8097, strictPort: true },
    appType: "custom",
  });
  server.middlewares.use("/eval-host", (_req, res) => {
    res.setHeader("Content-Type", "text/html");
    res.end("<!doctype html><html><body>Local recognition evaluation</body></html>");
  });
  await server.listen();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.route("**/*", (route) =>
    new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort(),
  );
  await page.goto("http://127.0.0.1:8097/eval-host");
  return {
    page,
    close: async () => {
      await browser.close();
      await server.close();
    },
  };
}
export function events(score) {
  return [score.notes, ...(score.voice2 ? [score.voice2] : []), ...(score.extraVoices || [])]
    .flatMap((voice) => {
      let at = 0;
      return voice.flatMap((n) => {
        const start = at;
        at += n.dur;
        return n.pitches.map((pitch) => ({ pitch, start, dur: n.dur }));
      });
    })
    .sort((a, b) => a.start - b.start || a.pitch - b.pitch || a.dur - b.dur);
}
// Maximum bipartite matching: an insertion must never make all later notes look wrong.
function matches(a, b, predicate) {
  const assigned = new Map();
  function visit(i, seen) {
    for (let j = 0; j < b.length; j++)
      if (!seen.has(j) && predicate(a[i], b[j])) {
        seen.add(j);
        if (!assigned.has(j) || visit(assigned.get(j), seen)) {
          assigned.set(j, i);
          return true;
        }
      }
    return false;
  }
  return a.reduce((n, _, i) => n + Number(visit(i, new Set())), 0);
}
export function compare(truth, predicted, ends, onset = 1e-4, duration = 1e-4) {
  const near = (a, b) => Math.abs(a.start - b.start) <= onset;
  const pitch = (a, b) => near(a, b) && a.pitch === b.pitch;
  const rhythm = (a, b) => near(a, b) && Math.abs(a.dur - b.dur) <= duration;
  const exact = (a, b) => pitch(a, b) && rhythm(a, b);
  const denominator = Math.max(truth.length, predicted.length, 1);
  let start = 0;
  const bars = ends.map((end, i) => {
    const t = truth.filter((n) => n.start >= start - 1e-6 && n.start < end - 1e-6);
    const p = predicted.filter((n) => n.start >= start - 1e-6 && n.start < end - 1e-6);
    const correct = matches(t, p, exact),
      edits = Math.max(t.length, p.length) - correct;
    start = end;
    // Extra tail events count against the final bar, as well as the note denominator.
    const tail = i === ends.length - 1 ? predicted.filter((n) => n.start >= end - 1e-6).length : 0;
    return {
      index: i + 1,
      truth: t.length,
      predicted: p.length,
      edits: edits + tail,
      strict: edits + tail === 0,
      usable: edits + tail <= 1,
    };
  });
  return {
    truthNotes: truth.length,
    predictedNotes: predicted.length,
    denominator,
    onsetCorrect: matches(truth, predicted, near),
    pitchCorrect: matches(truth, predicted, pitch),
    durationCorrect: matches(truth, predicted, rhythm),
    exactCorrect: matches(truth, predicted, exact),
    bars,
  };
}
