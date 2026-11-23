// Compare new local results with the committed P3 baseline, without overwriting it.
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
const dir = resolve(process.env.EVAL_LOG_DIR || "../r");
const baseline = JSON.parse(
  readFileSync(process.argv[2] || "eval/results/baseline-2026-11-14.json", "utf8"),
);
const current = {
  omr: JSON.parse(readFileSync(`${dir}/omr-results.json`, "utf8")),
  dictation: JSON.parse(readFileSync(`${dir}/dictation-results.json`, "utf8")),
};
const hash = createHash("sha256").update(readFileSync("scripts/eval/common.mjs")).digest("hex");
if (hash !== baseline.codeHashes["scripts/eval/common.mjs"])
  throw Error("Metric implementation differs; restore the baseline metric before comparing.");
for (const mode of ["omr", "dictation"]) {
  if (current[mode].length !== baseline[mode].length) throw Error(`Incomplete ${mode} suite`);
  for (const old of baseline[mode]) {
    const row = current[mode].find((r) => r.id === old.id && r.variant === old.variant);
    if (
      !row ||
      row.sha256 !== old.sha256 ||
      (mode === "dictation" && row.midiSha256 !== old.midiSha256)
    )
      throw Error(`Changed fixture ${mode}/${old.id}/${old.variant}`);
  }
}
const summary = (rows, key) => {
  const metrics = rows.map((r) => r[key]).filter(Boolean),
    bars = metrics.flatMap((m) => m.bars);
  return {
    pitch:
      metrics.reduce((s, m) => s + m.pitchCorrect, 0) /
      Math.max(
        1,
        metrics.reduce((s, m) => s + m.denominator, 0),
      ),
    duration:
      metrics.reduce((s, m) => s + m.durationCorrect, 0) /
      Math.max(
        1,
        metrics.reduce((s, m) => s + m.denominator, 0),
      ),
    usable: bars.filter((b) => b.usable).length / Math.max(1, bars.length),
    strict: bars.filter((b) => b.strict).length / Math.max(1, bars.length),
    draft: rows.filter((r) => r.draft).length / rows.length,
    seconds: rows.reduce((s, r) => s + r.seconds, 0),
  };
};
let markdown = "| 流程 × 变形 | 指标 | P3 | 本次 | 变化 |\n|---|---|---|---|---|\n";
for (const [mode, key] of [
  ["omr", "metrics"],
  ["dictation", "draftMetrics"],
])
  for (const variant of [...new Set(baseline[mode].map((r) => r.variant))]) {
    const select = (rows) => rows.filter((r) => r.variant === variant);
    const old = summary(select(baseline[mode]), key),
      now = summary(select(current[mode]), key);
    for (const metric of ["pitch", "duration", "strict", "usable", "draft", "seconds"]) {
      const percent = metric !== "seconds",
        format = (n) => (percent ? `${(100 * n).toFixed(1)}%` : `${n.toFixed(2)}s`);
      markdown += `| ${mode} × ${variant} | ${metric} | ${format(old[metric])} | ${format(now[metric])} | ${((now[metric] - old[metric]) * (percent ? 100 : 1)).toFixed(2)} ${percent ? "百分点" : "秒"} |\n`;
    }
  }
writeFileSync(`${dir}/comparison.md`, markdown);
console.log(markdown);
