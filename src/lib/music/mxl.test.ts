import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { zipSync, strToU8 } from "fflate";
import { importMusicXmlSource, unpackMxl, formatImportError, MAX_MXL_BYTES } from "./mxl.ts";
import { musicXmlToScore, scoreToMusicXml } from "./musicxml.ts";
import { EXAMPLES, scoreFromExample } from "./examples.ts";
const { JSDOM } = createRequire(import.meta.url)("jsdom");
const dom = new JSDOM("");
Object.defineProperty(globalThis, "DOMParser", { value: dom.window.DOMParser, configurable: true });
const xml = scoreToMusicXml(scoreFromExample(EXAMPLES[0]));
const container = (path = "score.musicxml") =>
  `<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="${path}" media-type="application/vnd.recordare.musicxml+xml"/></rootfiles></container>`;
const pack = (c = container(), root = xml) =>
  zipSync({ "META-INF/container.xml": strToU8(c), "score.musicxml": strToU8(root) });
test("mxl 与直接 XML 的音高、时值、标题和 notice 一致", () => {
  assert.deepEqual(importMusicXmlSource(pack(), "fallback"), musicXmlToScore(xml, "fallback"));
  assert.deepEqual(
    importMusicXmlSource(strToU8(xml), "fallback"),
    musicXmlToScore(xml, "fallback"),
  );
});
test("多个 rootfile 优先 MusicXML 媒体类型", () => {
  const c = container().replace(
    "<rootfiles>",
    '<rootfiles><rootfile full-path="preview.pdf" media-type="application/pdf"/>',
  );
  assert.equal(unpackMxl(pack(c)), xml);
});
test("坏包、损坏、缺文件、逃逸、嵌套和非 MusicXML 均中文拒绝", () => {
  const corrupt = pack();
  corrupt[40] ^= 255;
  const bad = [
    strToU8("bad"),
    strToU8("PK\x03\x04 broken"),
    corrupt,
    pack().slice(0, -6),
    zipSync({ "score.musicxml": strToU8(xml) }),
    pack("<container/>"),
    pack(container("missing.xml")),
    ...["../x", "/x", "C:/x", "a/../x", "a\\x"].map((p) => pack(container(p))),
    pack(container(), "not XML"),
    pack(container(), "PK nested"),
  ];
  for (const bytes of bad)
    assert.throws(() => importMusicXmlSource(bytes, "fallback", true), /现有谱未更改/);
  assert.throws(() => musicXmlToScore("PK\x03\x04 compressed", "x"), /mxl/);
});
test("压缩包体积、声明展开体积、总展开大小、压缩比、条目数有上限", () => {
  assert.throws(() => unpackMxl(new Uint8Array(MAX_MXL_BYTES + 1)), /16 MB/);
  const declared = pack();
  for (let p = 0; p < declared.length - 46; p++)
    if (new DataView(declared.buffer).getUint32(p, true) === 0x02014b50) {
      new DataView(declared.buffer).setUint32(p + 24, MAX_MXL_BYTES + 1, true);
      break;
    }
  assert.throws(() => unpackMxl(declared), /解压后过大/);
  assert.throws(() => unpackMxl(pack(container(), "x".repeat(100000))), /压缩比/);
  const files: Record<string, Uint8Array> = {};
  for (let i = 0; i < 257; i++) files[`f${i}`] = strToU8("a");
  assert.throws(() => unpackMxl(zipSync(files)), /现有谱未更改/);
});
test("伪造小尺寸的 deflate 不能逃过固定输出缓冲校验", () => {
  const bytes = pack(container(), xml.repeat(5)),
    v = new DataView(bytes.buffer);
  for (let p = 0; p < bytes.length - 46; p++)
    if (v.getUint32(p, true) === 0x02014b50) v.setUint32(p + 24, 10, true);
  assert.throws(() => unpackMxl(bytes), /现有谱未更改/);
});

test("失败文案只出现一次「现有谱未更改」", () => {
  const once = (fn: () => void) => {
    let thrown: unknown;
    try { fn(); } catch (err) { thrown = err; }
    assert.ok(thrown instanceof Error);
    assert.equal(thrown.message.split("现有谱未更改").length - 1, 1);
    assert.match(thrown.message, /现有谱未更改/);
  };
  once(() => importMusicXmlSource(strToU8("PK\x03\x04 broken"), "x", true));
  once(() => importMusicXmlSource(pack(container(), "not XML"), "x", true));
  once(() => unpackMxl(new Uint8Array(MAX_MXL_BYTES + 1)));
  assert.equal(
    formatImportError(new Error("这不是有效的压缩 MusicXML（.mxl），现有谱未更改。")).split("现有谱未更改").length - 1,
    1,
  );
  assert.match(formatImportError(new Error("MusicXML 读不了")), /MusicXML 读不了，现有谱未更改。/);
});
