import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { TEXT_FORMATS, TEXT_FORMAT_ACCEPT, detectTextFormat, importTextScore, importTextScoreFromPaste, MAX_TEXT_SCORE_BYTES } from "./text-formats.ts";

const utf8 = (s: string) => new TextEncoder().encode(s);
const jpw = readFileSync(new URL("./fixtures/jpwabc/basic.jpwabc.txt", import.meta.url), "utf8");
const utf16 = (s: string) => new Uint8Array(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(s, "utf16le")]));

test("登记表声明扩展名、编码与读写能力", () => {
  assert.deepEqual(TEXT_FORMATS.map((f) => f.id), ["jpwabc", "123", "fanqie", "abc", "ireal"]);
  assert.ok(TEXT_FORMATS.every((f) => f.encoding && f.exts.length && f.read));
  assert.ok(TEXT_FORMATS.find((f) => f.id === "jpwabc")!.write);
  assert.ok(TEXT_FORMATS.find((f) => f.id === "abc")!.write);
  assert.ok(TEXT_FORMATS.find((f) => f.id === "123")!.write);
  assert.equal(TEXT_FORMATS.find((f) => f.id === "fanqie")!.write, undefined, "fanqie is import-only");
  assert.equal(TEXT_FORMATS.find((f) => f.id === "ireal")!.write, undefined, "iReal is import-only");
  for (const ext of [".jpwabc", ".123", ".jps", ".abc", ".html", ".txt"]) assert.ok(TEXT_FORMAT_ACCEPT.split(",").includes(ext));
});

test("先看扩展名，.txt 再按内容嗅探", () => {
  assert.equal(detectTextFormat("a.123", utf8("1 2 3")).id, "123");
  assert.equal(detectTextFormat("a.txt", utf16(jpw)).id, "jpwabc");
  assert.equal(detectTextFormat("a.txt", utf8("%123-1.0\nK:1=C\n1 2 3 |")).id, "123");
  assert.equal(detectTextFormat("a.txt", utf8("V: 1.0\nB: x\nD: C\nQ: 1 2 3 |")).id, "fanqie");
  assert.throws(() => detectTextFormat("a.txt", utf8("hello world")), /认不出/);
});

test("统一入口返回谱、丢失清单与说明；默认值进说明不进丢失", async () => {
  const r = await importTextScore("a.jpwabc", utf16(jpw));
  assert.equal(r.format.id, "jpwabc");
  assert.ok(r.score.notes.length > 0);
  const bare = await importTextScore("b.jpwabc", utf16(".Voice\n1 2 3 4 |]\n"));
  assert.ok(bare.notes.some((n) => n.startsWith("缺少")));
  assert.ok(!bare.losses.some((n) => n.startsWith("缺少")));
});

test("超过 2 MB 拒绝", async () => {
  await assert.rejects(() => importTextScore("a.123", new Uint8Array(MAX_TEXT_SCORE_BYTES + 1)), /2 MB/);
});

test("粘贴文本按内容嗅探，与 .txt 文件同一入口", async () => {
  const r = await importTextScoreFromPaste("%123-1.0\nK:1=C\n1 2 3 |");
  assert.equal(r.format.id, "123");
  assert.ok(r.score.notes.length > 0);
  await assert.rejects(() => importTextScoreFromPaste("hello world"), /认不出/);
});
