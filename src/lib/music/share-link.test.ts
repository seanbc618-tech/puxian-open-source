import assert from "node:assert/strict";
import test from "node:test";
import { EXAMPLES, scoreFromExample } from "./examples.ts";
import { createBlankScore } from "./score-storage.ts";
import {
  decodeSharePayload,
  encodeSharePayload,
  MAX_SHARE_URL_LENGTH,
  parseShareHash,
  shareUrlOf,
} from "./share-link.ts";

test("share payload round-trips a built-in tune, including chords", () => {
  const threeFourStudy = scoreFromExample(EXAMPLES.find((item) => item.id === "three-four-study")!);
  const packed = encodeSharePayload(threeFourStudy);
  assert.doesNotMatch(packed, /[+/=]/);
  const restored = decodeSharePayload(packed);
  assert.deepEqual(restored, threeFourStudy);
  const fromHash = parseShareHash(`#s=${packed}`);
  assert.deepEqual(fromHash, threeFourStudy);
});

test("share hash ignores feature ids and rejects junk", () => {
  assert.equal(parseShareHash("#zone-input"), null);
  assert.equal(parseShareHash("#s="), null);
  assert.equal(parseShareHash("#s=%%%"), null);
  assert.equal(parseShareHash("#s=not-deflate"), null);
  const packed = encodeSharePayload(createBlankScore());
  const at = Math.min(24, packed.length - 2);
  const flip = packed[at] === "A" ? "B" : "A";
  assert.equal(decodeSharePayload(`${packed.slice(0, at)}${flip}${packed.slice(at + 1)}`), null);
});

test("share URL stays on the site origin and flags a score that will not fit", () => {
  const twinkle = scoreFromExample(EXAMPLES.find((item) => item.id === "twinkle")!);
  const link = shareUrlOf(twinkle, "https://818189.xyz/");
  assert.equal(link.ok, true);
  if (link.ok) {
    assert.match(link.url, /^https:\/\/818189\.xyz\/#s=/);
    assert.ok(link.url.length < MAX_SHARE_URL_LENGTH);
    assert.deepEqual(parseShareHash(new URL(link.url).hash), twinkle);
  }
  const huge = createBlankScore();
  huge.notes = Array.from({ length: 2_000 }, (_, i) => ({
    pitches: [21 + (i * 17) % 87],
    dur: 0.125 + (i % 7) * 0.125,
    lyric: { text: `${i.toString(36)}-${(i * 1_099_511_627).toString(36)}`, syllabic: "single" as const },
  }));
  const overflow = shareUrlOf(huge, "https://818189.xyz/");
  assert.equal(overflow.ok, false);
  if (!overflow.ok) assert.ok(overflow.length > MAX_SHARE_URL_LENGTH);
});

test("精简分享链接：所有示例原样还原，旧版 gzip 链接仍能打开，长度明显变短", async () => {
  const { gzipSync, strToU8 } = await import("fflate");
  for (const example of EXAMPLES) {
    const score = scoreFromExample(example);
    const packed = encodeSharePayload(score);
    assert.deepEqual(decodeSharePayload(packed), score, example.id);
    const legacy = Buffer.from(gzipSync(strToU8(JSON.stringify(score)), { level: 9 })).toString("base64url");
    assert.deepEqual(decodeSharePayload(legacy), score, `${example.id} legacy link`);
    assert.ok(packed.length <= legacy.length * 0.7, `${example.id}: ${packed.length} vs ${legacy.length}`);
  }
  const threeFourStudy = scoreFromExample(EXAMPLES.find((item) => item.id === "three-four-study")!);
  const link = shareUrlOf(threeFourStudy, "https://818189.xyz/");
  assert.ok(link.ok && link.url.length < 260, `三拍练习 link ${link.ok ? link.url.length : "-"}`);
});

test("精简分享链接保留歌词、表情、第二声部、非默认谱头和带空格的和弦名", () => {
  const score = {
    ...createBlankScore(),
    title: "测 试",
    bpm: 72,
    beats: 6,
    beatUnit: 8,
    key: "F",
    mode: "minor",
    clef: "bass",
    tonicOctave: 3,
    notes: [
      { pitches: [53, 57], dur: 1.5, lyric: { text: "啊", syllabic: "single" }, dynamic: "mf" },
      { pitches: [], dur: 0.5 },
      { pitches: [60], dur: 1 / 3, lyric: { text: "la", syllabic: "begin", extend: true }, articulations: ["staccato"] },
      { pitches: [62], dur: 1 / 3 },
    ],
    voice2: [{ pitches: [41], dur: 3 }],
    chordSymbols: [{ at: 0, symbol: "Fm" }, { at: 1.5, symbol: "C 7" }],
  } as unknown as Parameters<typeof encodeSharePayload>[0];
  assert.deepEqual(decodeSharePayload(encodeSharePayload(score)), score);
  const plainChords = { ...score, chordSymbols: [{ at: 0, symbol: "Fm" }, { at: 1.5, symbol: "C7/E" }] };
  assert.deepEqual(decodeSharePayload(encodeSharePayload(plainChords)), plainChords);
});
