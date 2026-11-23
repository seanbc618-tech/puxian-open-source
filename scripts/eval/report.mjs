import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import os from "node:os";
import { chromium } from "playwright";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { JSDOM } from "jsdom";
import { output, browserSession } from "./common.mjs";
import { compileRecognition } from "../../src/lib/omr/recognition.ts";
import { musicXmlToScore } from "../../src/lib/music/musicxml.ts";
import { exportAbc } from "../../src/lib/music/abc.ts";
import { voiceClef } from "../../src/lib/music/voices.ts";
globalThis.DOMParser = new JSDOM("").window.DOMParser;
const read = (name) => JSON.parse(readFileSync(`${output}/${name}`, "utf8"));
const omr = read("omr-results.json"),
  audio = read("dictation-results.json"),
  env = read("omr-environment.json");
const expected = JSON.parse(readFileSync("eval/generated/cases.json", "utf8"));
if (omr.length !== expected.length || audio.length !== 24)
  throw Error("Incomplete suite; do not publish partial totals");
for (const item of expected) {
  const row = omr.find((r) => r.id === item.id && r.variant === item.variant);
  if (!row || row.sha256 !== item.sha256)
    throw Error("Stale or missing OMR fixture: " + item.id + " " + item.variant);
}
const pct = (n, d) => (d ? `${((100 * n) / d).toFixed(1)}% (${n}/${d})` : "—");
function aggregate(rows, field = "metrics") {
  const m = rows.map((r) => r[field]).filter(Boolean),
    bars = m.flatMap((x) => x.bars);
  return {
    notes: m.reduce((s, x) => s + x.denominator, 0),
    pitch: m.reduce((s, x) => s + x.pitchCorrect, 0),
    onset: m.reduce((s, x) => s + (x.onsetCorrect || 0), 0),
    duration: m.reduce((s, x) => s + x.durationCorrect, 0),
    strict: bars.filter((b) => b.strict).length,
    usable: bars.filter((b) => b.usable).length,
    bars: bars.length,
    drafts: rows.filter((r) => r.draft).length,
    partial: rows.filter((r) => r.partial).length,
    timeouts: rows.filter((r) => r.timeout).length,
    pages: rows.length,
    allUsable: rows.filter((r) => r.draft && r[field]?.bars.every((b) => b.usable)).length,
    seconds: rows.reduce((s, r) => s + r.seconds, 0),
  };
}
const scored = omr.filter((r) => r.metrics),
  o = aggregate(scored),
  a = aggregate(audio, "draftMetrics"),
  ar = aggregate(audio);
const hash = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");
mkdirSync("eval/results", { recursive: true });
const baseline = {
  seed: 20261114,
  hardware: {
    cpu: os.cpus()[0]?.model,
    logicalCpus: os.cpus().length,
    memoryBytes: os.totalmem(),
    platform: os.platform(),
    arch: os.arch(),
  },
  browser: execFileSync("timeout", ["10", chromium.executablePath(), "--version"], {
    encoding: "utf8",
  }).trim(),
  sourceHead: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  codeHashes: Object.fromEntries(
    [
      "src/lib/omr/omr.worker.ts",
      "src/lib/omr/kern.ts",
      "src/lib/omr/recognition.ts",
      "src/lib/music/musicxml.ts",
      "src/lib/music/audio.ts",
      "eval/transform.mjs",
      "eval/synthesis.mjs",
      "scripts/eval/common.mjs",
      "scripts/eval/generate.mjs",
      "scripts/eval/omr.mjs",
      "scripts/eval/dictation.mjs",
      "scripts/eval/compare.mjs",
    ].map((p) => [p, hash(p)]),
  ),
  environment: env,
  audioEnvironment: read("dictation-environment.json"),
  summary: { omrScored: o, omrAll: aggregate(omr), audioDraft: a, audioRaw: ar },
  omr: omr.map(
    ({
      id,
      kind,
      variant,
      path,
      sha256,
      sample,
      draft,
      partial,
      seconds,
      timeout,
      metrics,
      issues,
      losses,
    }) => ({
      id,
      kind,
      variant,
      path,
      sha256,
      sample,
      draft,
      partial,
      seconds,
      timeout,
      metrics,
      issues,
      losses,
    }),
  ),
  dictation: audio.map(
    ({ id, variant, sha256, midiSha256, draft, bpm, quarter, seconds, metrics, draftMetrics }) => ({
      id,
      variant,
      sha256,
      midiSha256,
      draft,
      bpm,
      quarter,
      seconds,
      metrics,
      draftMetrics,
    }),
  ),
};
writeFileSync("eval/results/baseline-2026-11-14.json", JSON.stringify(baseline, null, 2) + "\n");
const variants = ["clean", "perspective", "lighting", "low-quality", "combined"];
let text = `# 谱线识别可用率实测（2026-11-14）\n\n目前这套**固定小样本**，图片有真值的 ${o.bars} 个衍生小节中，${pct(o.usable, o.bars)} 达到“至多改一个单音事件”，约 ${((o.usable / o.bars) * 10).toFixed(1)} 成；严格全对 ${pct(o.strict, o.bars)}。默认单音听写自动 BPM／量化草稿的可用率为 ${pct(a.usable, a.bars)}，约 ${((a.usable / a.bars) * 10).toFixed(1)} 成。它们不是面向所有真实照片／真实演奏的总体概率，也不应合并成一个营销数字。\n\n本次生成 ${omr.length} 个图片输入、${audio.length} 个音频输入，串行运行真实本机代码，无 mock、无云 AI、无上传、无算法改动。图像是自制／PD 刻谱和手机拍照式变形，音频是已知 MIDI 本地合成及录音式变形，**没有采集现实手机照片或真人演奏**。对未来模型的回归比较有用，对真实用户成功率的外推有限。\n\n## 样本、许可与复现\n\n- 四首新增曲目：巴赫前奏曲、致爱丽丝、土耳其进行曲、勃拉姆斯摇篮曲，每首固定两小节；两首两声部练习改编，两首主声部旋律。真值是本次刻谱使用的 MusicXML，来自仓库 PD／CC0 源数据。没有选用 CC BY／CC BY-SA 的其他示例。\n- 必须包含的 C 大调原图、巴赫两页 PNG／原 PDF、单行小星星、简谱小星星均已纳入。巴赫 PNG 为控制时长，只对固定首系统（第 1–3、19–21 小节）做逐音计分；两张完整 PNG 与经现有 PDF.js 导入的两页各另测一次，记草稿和耗时。完整页没有逐音金标准，绝不把裁图分数写成整页准确率。\n- 反馈小星星两图没有可靠 MusicXML，逐音项记“无真值／不支持”；整图可用按 0 记，保留失败消息。模型只支持成对钢琴谱表，多行单谱表也可能被错误配对后产生幻觉草稿。\n- 参数、源许可和精确定义见 [eval/README](../eval/README.md)、[素材清单](../eval/manifest.json)、[可审计基线 JSON](../eval/results/baseline-2026-11-14.json)。原始日志在 \`${output}/\`；预检、旧 JPEG 试跑和裁框修正前试跑单独存档，不进入最终统计。裁框修正后 10 例重跑，其余 39 例核对输入哈希完全相同后复用真实结果；最终 JSON 含全部 49 例。\n\n\`timeout 200 npm run eval:generate\` → \`timeout 3550 npm run eval:omr\` → \`timeout 300 npm run eval:dictation\` → \`timeout 90 npm run eval:report\`。原始小型反馈谱已存档于 eval/reference；需另备本地 SMT 权重，批量派生媒体与模型不提交，固定 seed=20261114，可按哈希核对。P4 运行 generate／omr／dictation 后用 \`timeout 30 npm run eval:compare\` 输出前后差异，不覆盖本次基线；素材或计分器哈希变更时会拒绝比较。Worker 与线上同一份源码、同一 SMT/ONNX WASM 路径，通过隔离 Vite 评测宿主运行。模型 ${env.model.id}；模型逐文件哈希保存在基线 JSON。\n\n## 可用的定义\n\n音符事件为“起始＋实际 MIDI 音高＋时长”，和弦拆为单音、声部合并。用真值小节边界对齐，不平移寻找最佳答案；最大二分匹配避免漏一个音导致整段错位。音符分母是 max(真值数, 输出数)，多余尾部也扣分。音高正确要求起始与音高，时值正确要求起始与时长；两者独立。小节严格正确为全部事件全对；小节可用为至多改／补／删一个单音事件，且必须确实产出识别草稿。这还未惩罚错误谱号、声部身份、表情与排版，已经是偏乐观的“能编辑”口径。\n\nOMR 容差为起始／时长各 0.0001 个四分拍；原始音频为起始 80ms、时长 120ms；自动量化草稿为各 0.05 个四分拍。声音比较包含真实 MIDI note-off，不消除合成包络差异。没有用真值 BPM 替换产品自动估速，没有针对每首曲子调阈值。\n\n## 图片结果\n\nclean 为无损原像素；perspective 为透视＋0.9°倾斜；lighting 为纸弯曲＋阴影／渐变光；low-quality 为长边至多 1000px＋轻模糊噪声＋JPEG 0.52；combined 为组合。巴赫变形均作用于同一固定裁图。\n\n| 素材（可计分小节／版） | clean | perspective | lighting | low-quality | combined |\n|---|---|---|---|---|---|\n`;
for (const id of [...new Set(scored.map((r) => r.id))]) {
  const rs = scored.filter((r) => r.id === id);
  text +=
    `| ${id}（${rs[0].metrics.bars.length}） | ` +
    variants
      .map((v) => {
        const x = aggregate(rs.filter((r) => r.variant === v));
        return pct(x.usable, x.bars);
      })
      .join(" | ") +
    " |\n";
}
text +=
  "| 单行小星星原图 | 不支持／无逐音真值 | 不支持／无逐音真值 | 不支持／无逐音真值 | 不支持／无逐音真值 | 不支持／无逐音真值 |\n| 简谱小星星原图 | 不支持 | 不支持 | 不支持 | 不支持 | 不支持 |\n";
text +=
  "\n| 输入类别 × 变形 | 音高正确 | 时值正确 | 小节严格全对 | 小节可用 | 草稿产出 | 平均秒 |\n|---|---|---|---|---|---|---|\n";
for (const kind of ["piano", "melody", "jianpu"])
  for (const v of variants) {
    const rs = omr.filter(
      (r) =>
        r.kind === kind &&
        r.variant === v &&
        !r.id.includes("-whole") &&
        !r.id.startsWith("bach-pdf"),
    );
    const x = aggregate(rs);
    text += `| ${kind} × ${v} | ${pct(x.pitch, x.notes)} | ${pct(x.duration, x.notes)} | ${pct(x.strict, x.bars)} | ${pct(x.usable, x.bars)} | ${pct(x.drafts, x.pages)} | ${(x.seconds / x.pages).toFixed(2)} |\n`;
  }
text += `\n有真值输入的“整张所有计分小节均可用”率：${pct(o.allUsable, o.pages)}；全部 ${omr.length} 个输入草稿产出率 ${pct(omr.filter((r) => r.draft).length, omr.length)}。前者包含裁图，不能称为真实整页正确率。两个无真值的小星星各 5 版的整图可用数均为 0。\n\n完整巴赫页只报告产出：\n\n| 整页输入 | 草稿 | 部分草稿 | 超时 | 秒 |\n|---|---|---|---|---|\n`;
for (const r of omr.filter((r) => r.id.includes("-whole") || r.id.startsWith("bach-pdf")))
  text += `| ${r.id} | ${r.draft ? "是" : "否"} | ${r.partial ? "是" : "否"} | ${r.timeout ? "是" : "否"} | ${r.seconds.toFixed(2)} |\n`;
text += `\nOMR 累计运行会话墙钟 ${env.wallSeconds.toFixed(1)} 秒（含裁框修正前试跑及重跑开销）；最终有效 ${omr.length} 例单例耗时合计 ${(env.validCaseSeconds || omr.reduce((s, r) => s + r.seconds, 0)).toFixed(1)} 秒；每例上限 ${env.perCaseSeconds} 秒。超时 ${omr.filter((r) => r.timeout).length} 例，保留实际已生成片段并计入失败／缺失，未删除难例。耗时含首次模型下载到本机缓存、校验与初始化；后续复用 Worker，发生超时会重建。图片单例不含文件读取／位图解码；音频单例包含 Web Audio 解码、检测与自动量化，不含合成。\n\n## 音乐结果\n\n默认单音上传流程，六段 MIDI 旋律（四首上述曲目＋自制音阶和小星星练习），每段 clean／noise／accompaniment-reverb／phone 四种版本。伴奏只是固定干扰，不是多音转录目标。未测另选的 Basic Pitch 多音模式。\n\n| 素材 × 变形 | 原始音高 | 原始起始 | 原始时值 | 原始小节可用 | 自动 BPM | 量化草稿小节可用 | 秒 |\n|---|---|---|---|---|---|---|---|\n`;
for (const r of audio) {
  const x = aggregate([r]),
    d = aggregate([r], "draftMetrics");
  text += `| ${r.id} × ${r.variant} | ${pct(x.pitch, x.notes)} | ${pct(x.onset, x.notes)} | ${pct(x.duration, x.notes)} | ${pct(x.usable, x.bars)} | ${r.bpm} | ${pct(d.usable, d.bars)} | ${r.seconds.toFixed(3)} |\n`;
}
text +=
  "\n| 音频版本汇总 | 原始音高 | 原始起始 | 原始时值 | 原始小节可用 | 草稿音高 | 草稿时值 | 草稿严格全对 | 草稿小节可用 | 草稿产出 |\n|---|---|---|---|---|---|---|---|---|---|\n";
for (const v of ["clean", "noise", "accompaniment-reverb", "phone"]) {
  const rs = audio.filter((r) => r.variant === v),
    x = aggregate(rs),
    d = aggregate(rs, "draftMetrics");
  text += `| ${v} | ${pct(x.pitch, x.notes)} | ${pct(x.onset, x.notes)} | ${pct(x.duration, x.notes)} | ${pct(x.usable, x.bars)} | ${pct(d.pitch, d.notes)} | ${pct(d.duration, d.notes)} | ${pct(d.strict, d.bars)} | ${pct(d.usable, d.bars)} | ${pct(d.drafts, d.pages)} |\n`;
}
text += `\n默认听写有音符产出的比例 ${pct(a.drafts, a.pages)}，而量化草稿所有小节均可用的比例 ${pct(a.allUsable, a.pages)}。原始事件可用率 ${pct(ar.usable, ar.bars)}，与最终草稿的差距应结合 BPM 和量化检查，不能只展示“音高检测到了”。本次干净小星星练习真值为 16 个 MIDI 音符、120 BPM，实际只检出 8 个音并估为 60 BPM，量化后 0/4 小节可用；连续重复音被合并值得优先排查。现有 quantizeDetected 还以首个检测音为起点归零，巴赫等片段的前导休止不会保留，这是已记录给 P4 的流程问题，本项没有修复。\n\n## 最差类别与 P4 优先顺序\n\n1. 优先修图片定位：轻微旋转／透视／弯曲即破坏水平长线投影；检查页眉、空白宽度、单系统短谱对全图 inkWidth 阈值的影响。单行谱和简谱的支持边界明确存在，本次不通过裁剪或伪造大谱表绕过它。\n2. 再修大谱表符号与小节／声部转换：有草稿仍可能谱号、八度、声部和节奏冲突；本次 C 大调干净图第一小节两音被读成整小节休止，转换后音高只匹配 3/14；还报告声部节奏冲突，不能因为有草稿就算成功。原始 **kern、恢复损失、事件级差异均保留。先减少实际漏错音，再优化草稿展示。\n3. 听写先检查自动 BPM 和量化造成的草稿偏差，再对起音、重复音、伴奏抑制做前后对照；保持这套真值、时限与种子不变。扩展真实设备／真实演奏小样本后才能回答真实用户总体“几成能用”。\n\n这里只记录问题，不修改识别算法。样本很小，变体相关，不能把 5 个变体当 5 次独立实拍，也不能用 synthetic clean 的成绩代表真实钢琴录音。\n\n## 截图对照\n\n以下由真实结果重绘，显示输入、变形以及转换后草稿／失败信息；多声部这里只用各声部分行帮助审阅，不改变实际计分。\n\n![C 大调原图与草稿](assets/recognition-eval/c-major.png)\n\n![巴赫首系统与草稿](assets/recognition-eval/bach-p1.png)\n\n![短钢琴系统定位失败](assets/recognition-eval/elise.png)\n\n## 验收\n\n验收命令、退出码、首屏流量和 mapDeps 见本节最终记录。评测脚本不进入产品入口，没有设置 reducedMotion，没有放松验收断言，没有提交模型符号链接。\n`;
if (existsSync(`${output}/acceptance.json`)) {
  const checks = read("acceptance.json");
  baseline.acceptance = checks;
  text +=
    "\n| 验收命令 | 退出码 |\n|---|---|\n" +
    checks.commands.map((c) => `| \`${c.command}\` | ${c.exitCode} |`).join("\n") +
    "\n";
  text += `\n正常动效验收：首屏 ${checks.firstScreen.requests} 请求、${checks.firstScreen.bytes.toLocaleString("en-US")} B；mapDeps ${checks.homeMapDeps}。所有原断言保留。\n`;
  writeFileSync("eval/results/baseline-2026-11-14.json", JSON.stringify(baseline, null, 2) + "\n");
}
writeFileSync("docs/recognition-eval-2026-11-14.md", text);
// Static, reviewable screenshots. All image processing uses browser Canvas/DOM.
mkdirSync("docs/assets/recognition-eval", { recursive: true });
const { page, close } = await browserSession();
try {
  await page.addScriptTag({ path: "node_modules/abcjs/dist/abcjs-basic-min.js" });
  for (const id of ["c-major", "bach-p1", "elise"]) {
    const row = omr.find((r) => r.id === id && r.variant === "clean"),
      bad = omr.find((r) => r.id === id && r.variant === "combined");
    const fragments = row.messages
      .filter((m) => m.kind === "system")
      .map((m) => ({
        page: 1,
        system: m.index,
        text: m.text,
        complete: m.complete,
        error: m.error,
      }));
    const result = compileRecognition(
      fragments,
      [{ page: 1, done: !row.timeout, warnings: [] }],
      id,
      musicXmlToScore,
    );
    const score = result.draft?.score;
    const abc = score
      ? [score.notes, ...(score.voice2 ? [score.voice2] : []), ...(score.extraVoices || [])].map(
          (notes, i) =>
            exportAbc({
              ...score,
              notes,
              voice2: undefined,
              extraVoices: undefined,
              title: `Recognized voice ${i + 1}`,
              clef: voiceClef(score, i),
            }).text,
        )
      : [];
    await page.evaluate(
      ({ id, input, variant, abc, issues, losses }) => {
        document.body.style.cssText = "margin:0;background:#fff;color:#17212b;font:16px sans-serif";
        document.body.innerHTML =
          '<main style="padding:24px;width:1100px"><h1></h1><h2>原始输入／固定裁图</h2><img id="input" style="max-width:1100px;max-height:330px"><h2>组合拍照变形</h2><img id="variant" style="max-width:1100px;max-height:330px"><h2>真实 Worker 转换草稿</h2><div id="draft"></div><pre style="white-space:pre-wrap;line-height:1.5"></pre></main>';
        document.querySelector("h1").textContent = id;
        document.querySelector("#input").src = input;
        document.querySelector("#variant").src = variant;
        abc.forEach((text, i) => {
          const div = document.createElement("div");
          div.id = "v" + i;
          document.querySelector("#draft").append(div);
          ABCJS.renderAbc(div.id, text, { staffwidth: 1000 });
        });
        document.querySelector("pre").textContent = [...issues, ...(losses || [])].join("\n");
      },
      {
        id,
        input: "data:image/png;base64," + readFileSync(row.path).toString("base64"),
        variant: "data:image/jpeg;base64," + readFileSync(bad.path).toString("base64"),
        abc,
        issues: row.issues,
        losses: row.losses,
      },
    );
    await page.locator("#input").evaluate((img) => img.decode());
    await page.locator("#variant").evaluate((img) => img.decode());
    await page.locator("main").screenshot({ path: `docs/assets/recognition-eval/${id}.png` });
  }
} finally {
  await close();
}
console.log(JSON.stringify(baseline.summary, null, 2));
