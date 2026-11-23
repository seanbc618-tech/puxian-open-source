import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { EXAMPLES, HOME_EXAMPLES, PD_EXAMPLES, exampleScoreUrl, scoreFromExample } from "./examples.ts";
import { loadExampleScore } from "./examples-load.ts";

const OPENING: Record<string, { key: string; mode: string; beats: number; beatUnit: number; pitches: number[] }> = {
  hr2: { key: "Db", mode: "minor", beats: 2, beatUnit: 4, pitches: [61, 61, 59] },
  elise: { key: "A", mode: "minor", beats: 3, beatUnit: 8, pitches: [76, 75, 76] },
  moonlight: { key: "Db", mode: "minor", beats: 2, beatUnit: 2, pitches: [56, 61, 64] },
  "alla-turca": { key: "A", mode: "minor", beats: 2, beatUnit: 4, pitches: [71, 69, 68] },
  nachtmusik: { key: "G", mode: "major", beats: 4, beatUnit: 4, pitches: [62, 74, 79] },
  "wtc-prelude": { key: "C", mode: "major", beats: 4, beatUnit: 4, pitches: [67, 72, 76] },
  canon: { key: "D", mode: "major", beats: 4, beatUnit: 4, pitches: [78, 76, 74] },
  nocturne: { key: "Eb", mode: "major", beats: 12, beatUnit: 8, pitches: [70, 79, 77] },
  gymnopedie: { key: "D", mode: "major", beats: 3, beatUnit: 4, pitches: [78, 81, 79] },
  "clair-de-lune": { key: "Db", mode: "major", beats: 9, beatUnit: 8, pitches: [77, 73, 72] },
  lullaby: { key: "Eb", mode: "major", beats: 3, beatUnit: 4, pitches: [67, 67, 70] },
  "blue-danube": { key: "A", mode: "major", beats: 6, beatUnit: 8, pitches: [73, 69, 73] },
  radetzky: { key: "D", mode: "major", beats: 4, beatUnit: 4, pitches: [74, 74, 74] },
  arabesque: { key: "E", mode: "major", beats: 4, beatUnit: 4, pitches: [73, 76, 78] },
  fille: { key: "F#", mode: "major", beats: 3, beatUnit: 4, pitches: [73, 70, 66] },
  barcarolle: { key: "D", mode: "major", beats: 6, beatUnit: 8, pitches: [69, 71, 71] },
  "minute-waltz": { key: "Db", mode: "major", beats: 3, beatUnit: 4, pitches: [68, 67, 68] },
};

describe("public-domain example catalog", () => {
  it("keeps the five short tunes unchanged and lists classics after them", () => {
    assert.equal(EXAMPLES.length, 5);
    assert.deepEqual(EXAMPLES.map((item) => item.id), ["twinkle", "tigers", "ode", "four-four-study", "three-four-study"]);
    assert.equal(PD_EXAMPLES.length, 17);
    assert.equal(HOME_EXAMPLES.length, 22);
    assert.deepEqual(HOME_EXAMPLES.filter((item) => item.group === "short").map((item) => item.id), EXAMPLES.map((item) => item.id));
    assert.deepEqual(HOME_EXAMPLES.filter((item) => item.group === "classics").map((item) => item.id), PD_EXAMPLES.map((item) => item.id));
    assert.ok(PD_EXAMPLES.every((item) => item.lazy && item.composer));
    for (const example of EXAMPLES) scoreFromExample(example);
  });

  it("resolves classic JSON from both the site root and /index.html", () => {
    assert.equal(exampleScoreUrl("elise", "https://818189.xyz/"), "https://818189.xyz/examples-pd/elise.json");
    assert.equal(exampleScoreUrl("elise", "https://818189.xyz/index.html"), "https://818189.xyz/examples-pd/elise.json");
    assert.equal(
      exampleScoreUrl("alla-turca", "https://818189.xyz/"),
      "https://818189.xyz/examples-pd/alla-turca.json",
    );
  });

  it("rejects unknown catalog ids", async () => {
    await assert.rejects(() => loadExampleScore("croatian-rhapsody"), /没有这首示例曲：croatian-rhapsody/);
  });

  it("keeps attribution headers and extractable score JSON on every classic file", () => {
    for (const meta of PD_EXAMPLES) {
      const text = readFileSync(new URL(`./examples-pd/${meta.id}.ts`, import.meta.url), "utf8");
      assert.ok(text.includes(meta.title), meta.id);
      assert.ok(text.includes(meta.composer!), meta.id);
      assert.match(text, /export const score = /, meta.id);
      assert.ok(text.includes("export const score = ") && text.trimEnd().endsWith(" as Score;"), meta.id);
    }
    const moonlight = readFileSync(new URL("./examples-pd/moonlight.ts", import.meta.url), "utf8");
    assert.match(moonlight, /CC BY-SA 4\.0/);
    assert.match(moonlight, /Stewart Holmes \/ Mutopia Project/);
    const nocturne = readFileSync(new URL("./examples-pd/nocturne.ts", import.meta.url), "utf8");
    assert.match(nocturne, /CC BY-SA 4\.0/);
    assert.match(nocturne, /Renato Biolcati Rinaldi \/ Mutopia Project/);
    const canon = readFileSync(new URL("./examples-pd/canon.ts", import.meta.url), "utf8");
    assert.match(canon, /CC BY 4\.0/);
    assert.match(canon, /须署名 Noctave/);
  });

  it("keeps full scores and CC BY-SA editions out of the home catalog and editor entry", () => {
    const catalog = readFileSync(new URL("./examples.ts", import.meta.url), "utf8");
    assert.doesNotMatch(catalog, /examples-load|CC BY-SA|from ["'][^"']*examples-pd/);
    assert.match(catalog, /examples-pd\/\$\{/);
    const home = readFileSync(new URL("../../components/home-landing.tsx", import.meta.url), "utf8");
    assert.doesNotMatch(home, /examples-pd|examples-load|CC BY-SA/);
    assert.doesNotMatch(home, /HOME_EXAMPLES\.map/);
    assert.match(home, /example\.group === group\.id/);
    const app = readFileSync(new URL("../../components/staffline-app.tsx", import.meta.url), "utf8");
    assert.match(app, /\{EXAMPLES\.map\(\(example\) =>/);
    assert.doesNotMatch(app, /HOME_EXAMPLES\.map/);
    assert.match(app, /exampleScoreUrl\(/);
    assert.doesNotMatch(app, /from ["']@\/lib\/music\/examples-load/);
  });

  it("documents skipped works and reserved licenses", () => {
    const docs = readFileSync(new URL("../../../docs/pd-examples.md", import.meta.url), "utf8");
    for (const name of [
      "克罗地亚狂想曲",
      "春（维瓦尔第",
      "自新大陆",
      "G 弦上的咏叹调",
      "匈牙利舞曲第五号",
      "天鹅",
      "天鹅湖",
      "花之圆舞曲",
      "二泉映月",
      "梁祝",
      "义勇军进行曲",
      "拉赫玛尼诺夫",
      "西贝柳斯",
      "芬兰颂",
      "Piazzolla",
      "Gershwin",
      "CC BY-SA",
    ]) {
      assert.ok(docs.includes(name), name);
    }
  });

  it("loads every classic with the expected title, composer, meter, and opening pitches", async () => {
    for (const meta of PD_EXAMPLES) {
      const expect = OPENING[meta.id];
      assert.ok(expect, meta.id);
      const score = await loadExampleScore(meta.id);
      assert.equal(score.title, meta.title, meta.id);
      assert.equal(score.composer, meta.composer, meta.id);
      assert.equal(score.key, expect.key, meta.id);
      assert.equal(score.mode, expect.mode, meta.id);
      assert.equal(score.beats, expect.beats, meta.id);
      assert.equal(score.beatUnit, expect.beatUnit, meta.id);
      const first = score.notes.filter((note) => note.pitches.length).slice(0, 3).map((note) => note.pitches[0]);
      assert.deepEqual(first, expect.pitches, meta.id);
      const voices = [score.notes, score.voice2, ...(score.extraVoices ?? [])].filter(Boolean);
      assert.ok(voices.some((voice) => voice!.some((note) => note.pitches.length)), `${meta.id} has sounding notes`);
    }
  });
});
