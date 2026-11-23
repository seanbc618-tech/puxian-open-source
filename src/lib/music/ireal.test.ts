import assert from "node:assert/strict";
import test from "node:test";
import { importIreal, irealBars, irealChordName, parseIrealLink, scrambleIreal, unscrambleIreal, voiceChord } from "./ireal.ts";
import { detectTextFormat, importTextScoreFromPaste } from "./text-formats.ts";

/** Build an iReal-style link: title=composer==style=key==1r34LbKcu7<scrambled chart>==comp=bpm=repeats. */
function link(chart: string, opts: { title?: string; key?: string; bpm?: number; more?: string[]; playlist?: string } = {}) {
  const song = (c: string, t: string) => `${t}=Last First==Medium Swing=${opts.key ?? "C"}==1r34LbKcu7${scrambleIreal(c)}==Jazz-Swing=${opts.bpm ?? 0}=3`;
  const songs = [song(chart, opts.title ?? "测试曲"), ...(opts.more ?? []).map((c, i) => song(c, `第${i + 2}首`))];
  const body = songs.join("===") + (opts.playlist ? `===${opts.playlist}` : "");
  return `irealb://${encodeURIComponent(body)}`;
}

test("解扰：50 字一块的对换可逆，最后不满两字的块原样保留", () => {
  const plain = Array.from({ length: 151 }, (_, i) => String.fromCharCode(33 + (i % 90))).join("");
  const mixed = scrambleIreal(plain);
  assert.notEqual(mixed, plain);
  assert.equal(unscrambleIreal(mixed), plain);
  // 51 chars: the first block is followed by one char only, so it stays as is.
  const short = plain.slice(0, 51);
  assert.equal(unscrambleIreal(short), short);
  assert.equal(mixed.slice(0, 5), plain.slice(45, 50).split("").reverse().join(""));
});

test("链接：百分号编码、歌单名、多首曲子、导出的 HTML 里也能找到", () => {
  const url = link("[T44C^7XyQ|A-7XyQ|D-7XyQ|G7XyQZ", { title: "Autumn's Song", bpm: 140, more: ["[T34FXyQZ"], playlist: "我的歌单" });
  const { songs, playlist } = parseIrealLink(`<html><a href="${url}">歌单</a></html>`);
  assert.equal(playlist, "我的歌单");
  assert.equal(songs.length, 2);
  assert.deepEqual([songs[0].title, songs[0].composer, songs[0].style, songs[0].key, songs[0].bpm], ["Autumn's Song", "Last First", "Medium Swing", "C", 140]);
  assert.equal(songs[0].chart, "[T44C^7XyQ|A-7XyQ|D-7XyQ|G7XyQZ");
  assert.throws(() => parseIrealLink("随便一段字"), /没找到 irealb/);
  assert.throws(() => parseIrealLink("irealbook://Foo=Bar=C=n=C"), /旧版 irealbook/);
  assert.throws(() => parseIrealLink("irealb://%E4%"), /编码不完整/);
});

test("和弦名：iReal 写法换成编辑器的和弦名，柱式和弦落在 G3–F#4 起", () => {
  assert.equal(irealChordName("C^7"), "Cmaj7");
  assert.equal(irealChordName("C^"), "Cmaj7");
  assert.equal(irealChordName("D-7"), "Dm7");
  assert.equal(irealChordName("Bh7"), "Bm7b5");
  assert.equal(irealChordName("Bh"), "Bm7b5");
  assert.equal(irealChordName("C#o7"), "C#dim7");
  assert.equal(irealChordName("Eb-^7"), "EbmMaj7");
  assert.equal(irealChordName("D*m*"), "Dm");
  assert.equal(irealChordName("C7/E"), "C7/E");
  assert.deepEqual(voiceChord("Cmaj7"), [60, 64, 67, 71]);
  assert.deepEqual(voiceChord("G7"), [55, 59, 62, 65]);
  assert.deepEqual(voiceChord("F#m"), [66, 69, 73]);
  assert.deepEqual(voiceChord("C/E"), [52, 60, 64, 67], "slash bass goes under the chord");
  assert.equal(voiceChord("H7"), null);
});

test("小节：格子数定时值，x/Kcl/r 重复，n 停顿，行尾补位的空格不成小节", () => {
  const { bars } = irealBars("{*AT44C7 F7 LZC7XyQKcl LZr|XyQ|nXyQ}XyQXyQ LZ");
  assert.equal(bars.length, 6);
  assert.deepEqual(bars[0].cells.map((c) => c.chord ?? "_"), ["C7", "_", "F7", "_"]);
  assert.equal(bars[2].copyOf, 1, "Kcl repeats the previous bar");
  assert.deepEqual([bars[3].copyOf, bars[4].copyOf], [1, 2], "r repeats the previous two bars");
  assert.equal(bars[5].cells[0].nc, true);
  assert.equal(bars[5].closeRepeat, true);
  const r = importIreal(link("[T44C7 F7 LZC7XyQKcl LZr|XyQ|nXyQZ"));
  assert.deepEqual(r.score.notes.map((n) => n.dur), [2, 2, 4, 4, 4, 4, 4]);
  assert.deepEqual(r.score.notes.map((n) => n.pitches[0] ?? null), [60, 65, 60, 60, 60, 60, null]);
  assert.deepEqual(r.score.chordSymbols, [{ at: 0, symbol: "C7" }, { at: 2, symbol: "F7" }, { at: 4, symbol: "C7" }], "repeated bars add no new symbol");
  // Three chords in four cells (commas only separate): the one followed by an empty cell lasts twice as long.
  const three = importIreal(link("[T44C,D,E |GXyQZ"));
  assert.deepEqual(three.score.notes.map((n) => n.dur), [1, 1, 2, 4]);
  // Leading empty cell keeps the previous chord sounding (no new symbol).
  const lead = importIreal(link("[T44CXyQ| D-7  Z"));
  assert.deepEqual(lead.score.notes.map((n) => [n.dur, n.pitches[0]]), [[4, 60], [1, 60], [3, 62]]);
});

test("整首：调、拍号、速度、反复与两个结尾、换拍号", () => {
  const r = importIreal(link("{*AT34Eb^7XyQ|C-7XyQ|N1F-7XyQ|Bb7XyQ}XyQXyQ LZN2F-7XyQ|Bb7XyQ][*BT44Eb^7XyQZ", { title: "华尔兹", key: "Eb", bpm: 160 }));
  const s = r.score;
  assert.deepEqual([s.title, s.key, s.mode, s.beats, s.beatUnit, s.bpm], ["华尔兹", "Eb", "major", 3, 4, 160]);
  assert.equal(s.notes.length, 7);
  assert.deepEqual(s.repeats, [{ from: 0, to: 12, ending: 6, endingEnd: 18 }]);
  assert.deepEqual(s.changes, [{ at: 18, beats: 4, beatUnit: 4 }]);
  assert.equal(s.notes.reduce((q, n) => q + n.dur, 0), 22);
  assert.deepEqual(s.chordSymbols?.map((c) => c.symbol), ["Ebmaj7", "Cm7", "Fm7", "Bb7", "Fm7", "Bb7", "Ebmaj7"]);
  assert.deepEqual(r.losses, []);
  assert.ok(r.notes.some((n) => n.includes("柱式和弦")));
  assert.ok(r.notes.some((n) => n.includes("作曲：First Last")));
  const minor = importIreal(link("[T44C-XyQZ", { key: "C-" }));
  assert.deepEqual([minor.score.key, minor.score.mode], ["C", "minor"]);
  assert.ok(minor.notes.some((n) => n.includes("♩=120")));
  const fast = importIreal(link("[T44CXyQZ", { bpm: 300 }));
  assert.equal(fast.score.bpm, 220);
  assert.ok(fast.losses.some((l) => l.includes("速度 300")));
});

test("跳转：<D.C. al Fine> 与 <Fine>；有 Coda 没写 D.C. 时补一个 D.C. al Coda", () => {
  const fine = importIreal(link("[T44CXyQ|<Fine>GXyQ][FXyQ|<D.C. al Fine>G7XyQZ"));
  assert.deepEqual(fine.score.jumps, { fine: 8, dc: 16 });
  const coda = importIreal(link("[T44CXyQ|G7XyQ Q][QFXyQ|CXyQZ"));
  assert.deepEqual(coda.score.jumps, { toCoda: 8, coda: 8, dc: 8 });
  assert.ok(coda.notes.some((n) => n.includes("补一个 D.C. al Coda")));
  const segno = importIreal(link("[T44CXyQ|SFXyQ|G7XyQ Q|CXyQ|<D.S. al Coda>CXyQ][QFXyQZ"));
  assert.deepEqual(segno.score.jumps, { segno: 4, toCoda: 12, ds: 20, coda: 20 });
});

test("丢失清单：替代和弦、注释、读不懂的和弦都列出", () => {
  const r = importIreal(link("[T44C(A7)XyQ|<Solo break>F7XyQ|H7XyQZ", { more: ["[T44FXyQZ"], playlist: "表" }));
  assert.ok(r.losses.some((l) => l.includes("替代和弦 1 个")));
  assert.ok(r.losses.some((l) => l.includes("注释文字（Solo break）")));
  assert.ok(r.notes.some((n) => n.includes("歌单「表」共 2 首，只导入第一首《测试曲》")));
  assert.throws(() => importIreal(link("XyQXyQ")), /没有读得出的小节/);
});

test("文本格式：粘贴 irealb:// 链接或 .html 走 iReal，按需加载", async () => {
  const url = link("[T44C^7XyQ|G7XyQZ", { title: "贴进来" });
  assert.equal(detectTextFormat("pasted.txt", new TextEncoder().encode(url)).id, "ireal");
  assert.equal(detectTextFormat("Jazz.html", new TextEncoder().encode(`<a href="${url}">x</a>`)).id, "ireal");
  const r = await importTextScoreFromPaste(`  ${url}  `);
  assert.equal(r.format.id, "ireal");
  assert.equal(r.score.title, "贴进来");
  assert.deepEqual(r.score.chordSymbols?.map((c) => c.symbol), ["Cmaj7", "G7"]);
});
