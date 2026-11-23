import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { JSDOM } from "jsdom";
import { browserSession } from "./common.mjs";
import { scoreToMusicXml, musicXmlToScore } from "../../src/lib/music/musicxml.ts";
import { exportAbc } from "../../src/lib/music/abc.ts";
import { scoreToMidi } from "../../src/lib/music/midi.ts";
globalThis.DOMParser = new JSDOM("").window.DOMParser;
mkdirSync("eval/generated", { recursive: true });
mkdirSync("eval/truth", { recursive: true });
const manifest = [];
const { page, close } = await browserSession();
try {
  await page.addScriptTag({ path: "node_modules/abcjs/dist/abcjs-basic-min.js" });
  for (const [id, kind] of [
    ["wtc-prelude", "piano"],
    ["elise", "piano"],
    ["alla-turca", "melody"],
    ["lullaby", "melody"],
  ]) {
    const source = readFileSync(`src/lib/music/examples-pd/${id}.ts`, "utf8");
    const original = JSON.parse(source.split("export const score = ")[1].split(" as Score;")[0]);
    const bar = (original.beats * 4) / original.beatUnit,
      end = bar * 2;
    const offset = id === "lullaby" ? 6 : id === "elise" ? 3 : 0;
    function trim(notes = []) {
      let at = 0;
      return notes.flatMap((n) => {
        const start = at;
        at += n.dur;
        const dur = Math.min(at, offset + end) - Math.max(start, offset);
        return dur > 1e-6 ? [{ pitches: n.pitches, dur }] : [];
      });
    }
    const score = {
      ...original,
      notes: trim(original.notes),
      voice2: kind === "piano" ? trim(original.voice2) : undefined,
      extraVoices: undefined,
      changes: [],
      measureEnds: [bar, end],
      repeats: [],
      jumps: {},
    };
    // Canonical truth is the exported MusicXML of this exact excerpt, not recognition output.
    const xml = scoreToMusicXml(score);
    writeFileSync(`eval/truth/${id}.musicxml`, xml);
    const truth = musicXmlToScore(xml, id).score;
    writeFileSync(`eval/generated/${id}.mid`, scoreToMidi(truth));
    const abcParts = [truth.notes, ...(truth.voice2 ? [truth.voice2] : [])].map(
      (notes, i) =>
        exportAbc({
          ...truth,
          notes,
          voice2: undefined,
          extraVoices: undefined,
          clef: i ? "bass" : "treble",
        }).text,
    );
    const body = (text) =>
      text
        .split("\n")
        .filter((line) => line.trim() && !/^([A-Z]:|%)/.test(line))
        .join("\n");
    const head = abcParts[0]
      .split("\n")
      .filter((line) => /^([A-Z]:)/.test(line))
      .join("\n");
    const abc = truth.voice2
      ? head.replace(/K:/, "%%score { RH | LH }\nK:") +
        "\nV:RH clef=treble\n" +
        body(abcParts[0]) +
        "\nV:LH clef=bass\n" +
        body(abcParts[1])
      : abcParts[0];
    writeFileSync(`eval/generated/${id}.abc`, abc);
    await page.evaluate((abc) => {
      document.body.innerHTML = '<div id="score" style="background:white;width:1000px"></div>';
      ABCJS.renderAbc("score", abc, {
        staffwidth: 900,
        stretchlast: true,
        paddingtop: 20,
        paddingbottom: 20,
      });
    }, abc);
    await page.locator("#score").screenshot({ path: `eval/generated/${id}.png` });
    manifest.push({
      id,
      kind,
      source: `eval/generated/${id}.png`,
      truth: `eval/truth/${id}.musicxml`,
      ends: [bar, end],
      license: source.slice(0, source.indexOf("import type")).trim(),
    });
  }
} finally {
  await close();
}
const root = process.env.EVAL_FEEDBACK_DIR || "eval/reference";
for (const [id, kind, file, truth, ends, crop] of [
  ["c-major", "piano", "c_major_simple.png", "eval/truth/c-major.musicxml", [4, 8, 12, 16]],
  [
    "bach-p1",
    "piano",
    "bach_prelude_c_p-1.png",
    "eval/truth/bach-p1.musicxml",
    [4, 8, 12],
    [0, 235, 1654, 540],
  ],
  [
    "bach-p2",
    "piano",
    "bach_prelude_c_p-2.png",
    "eval/truth/bach-p2.musicxml",
    [4, 8, 12],
    [0, 65, 1654, 340],
  ],
  ["twinkle-treble", "melody", "xiaoxingxing_treble.png", null, null],
  ["twinkle-jianpu", "jianpu", "jianpu_twinkle.png", null, null],
]) {
  copyFileSync(`${root}/${file}`, `eval/generated/${file}`);
  manifest.push({
    id,
    kind,
    source: `eval/generated/${file}`,
    truth,
    ends,
    crop,
    license:
      "feedback-r4 自制测试图；巴赫 PDF/PNG：Mutopia Tobias Erbsland 2011/09/12-5 Public Domain，见页脚与 GROUND_TRUTH.md",
  });
}
copyFileSync(`${root}/c_major_simple.musicxml`, "eval/truth/c-major.musicxml");
copyFileSync(`${root}/bach_prelude_c_a4.pdf`, "eval/generated/bach_prelude_c_a4.pdf");
// The page-1 first system is measures 1–3 of the same PD source score.
const source = JSON.parse(
  readFileSync("src/lib/music/examples-pd/wtc-prelude.ts", "utf8")
    .split("export const score = ")[1]
    .split(" as Score;")[0],
);
const trim = (notes) => {
  let at = 0;
  return notes.flatMap((n) => {
    if (at >= 12) return [];
    const dur = Math.min(n.dur, 12 - at);
    at += dur;
    return [{ pitches: n.pitches, dur }];
  });
};
writeFileSync(
  "eval/truth/bach-p1.musicxml",
  scoreToMusicXml({
    ...source,
    notes: trim(source.notes),
    voice2: trim(source.voice2),
    extraVoices: source.extraVoices?.map(trim),
    changes: [],
    measureEnds: [4, 8, 12],
  }),
);
const slice = (notes) => {
  let at = 0;
  return notes.flatMap((n) => {
    const from = at;
    at += n.dur;
    const dur = Math.min(at, 84) - Math.max(from, 72);
    return dur > 1e-6 ? [{ pitches: n.pitches, dur }] : [];
  });
};
writeFileSync(
  "eval/truth/bach-p2.musicxml",
  scoreToMusicXml({
    ...source,
    notes: slice(source.notes),
    voice2: slice(source.voice2),
    extraVoices: source.extraVoices?.map(slice),
    changes: [],
    measureEnds: [4, 8, 12],
  }),
);
writeFileSync(
  "eval/manifest.json",
  JSON.stringify({ seed: 20261114, items: manifest }, null, 2) + "\n",
);
execFileSync("timeout", ["150", "node", "eval/transform.mjs"], { stdio: "inherit" });
