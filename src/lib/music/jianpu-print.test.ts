import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { jianpuPrint, exportView, exportPipeline } from "./jianpu-print.ts";
import { DEFAULT_PRINT_SETTINGS } from "./print-layout.ts";
import { EXAMPLES, scoreFromExample } from "./examples.ts";
const { JSDOM } = createRequire(import.meta.url)("jsdom");
const fixture = () => ({
  ...scoreFromExample(EXAMPLES[0]),
  title: "春日和声",
  notes: [
    { pitches: [60, 64, 67], dur: 1, lyric: { text: "春", syllabic: "single" as const } },
    { pitches: [62], dur: 3 },
  ],
});
test("标题、记谱调、拍号、速度、歌词与纵向和弦；不改 Score", () => {
  const score = fixture(),
    before = JSON.stringify(score),
    out = jianpuPrint(score, DEFAULT_PRINT_SETTINGS, 2);
  const dom = new JSDOM(out.markup, { contentType: "image/svg+xml" }),
    doc = dom.window.document;
  assert.match(doc.documentElement.textContent, /春日和声/);
  assert.match(doc.documentElement.textContent, /1=D/);
  assert.match(doc.documentElement.textContent, /4\/4/);
  assert.match(doc.documentElement.textContent, new RegExp(`♩=${score.bpm}`));
  const chord = [...doc.querySelectorAll('[data-note-start="0"]')];
  assert.equal(chord.length, 3);
  assert.deepEqual(
    chord.map((n: any) => n.textContent),
    ["1", "3", "5"],
  );
  assert.equal(new Set(chord.map((n: any) => n.getAttribute("x"))).size, 1);
  assert.equal(new Set(chord.map((n: any) => n.getAttribute("y"))).size, 3);
  assert.equal(
    doc.querySelector('[data-lyric-start="0"]').getAttribute("x"),
    chord[0].getAttribute("x"),
  );
  assert.equal(JSON.stringify(score), before);
  dom.window.close();
});
test("长曲按完整小节系统分页，两声部共页，无额外尾页", () => {
  const score = fixture();
  score.notes = Array.from({ length: 160 }, () => fixture().notes).flat();
  const out = jianpuPrint({ ...score, voice2: score.notes }, DEFAULT_PRINT_SETTINGS);
  assert.ok(out.pages.length > 2);
  assert.equal(out.plans.at(-1)!.end, out.systems.length - 1);
  const seen = new Set<number>();
  out.plans.forEach((p, i) => {
    assert.ok(p.start <= p.end);
    for (let s = p.start; s <= p.end; s++) {
      assert.ok(!seen.has(s));
      seen.add(s);
      assert.match(out.pages[i], new RegExp(`data-system="${s}"`));
      assert.match(out.systems[s].markup, /data-voice="1"/);
      if (s > 0) assert.equal(out.systems[s].firstBar, out.systems[s - 1].lastBar + 1);
    }
  });
  assert.equal(seen.size, out.systems.length);
});
test("过高系统整体缩小；空谱一页；短曲用满宽度", () => {
  const score = fixture();
  score.notes[0].pitches = Array.from({ length: 60 }, (_, i) => i + 20);
  const out = jianpuPrint({ ...score, voice2: score.notes }, DEFAULT_PRINT_SETTINGS);
  assert.ok(out.plans[0].fit < 1);
  assert.equal(out.pages.length, 1);
  assert.equal(jianpuPrint({ ...score, notes: [] }, DEFAULT_PRINT_SETTINGS).pages.length, 1);
  assert.match(
    jianpuPrint(fixture(), DEFAULT_PRINT_SETTINGS).systems[0].markup,
    /data-measure="0"/,
  );
});
test("默认跟随编辑视图；手选不切编辑器；两种输出调用各自管线", () => {
  for (const v of ["staff", "jianpu"] as const) {
    assert.equal(exportView(v, null), v);
    assert.equal(exportView(v, "jianpu"), "jianpu");
    assert.equal(
      exportPipeline(
        v,
        () => "数字谱",
        () => "五线",
      ),
      v === "jianpu" ? "数字谱" : "五线",
    );
  }
});

test("曲中 1=调号、拍号、速度会出现在对应位置，移位后调号跟随", () => {
  const score = {
    ...fixture(),
    notes: [
      { pitches: [67], dur: 4 },
      { pitches: [69], dur: 3 },
      { pitches: [71], dur: 3 },
    ],
    changes: [{ at: 4, bpm: 60, beats: 3, beatUnit: 4, key: "G" as const, mode: "major" as const }],
  };
  const out = jianpuPrint(score as any, DEFAULT_PRINT_SETTINGS);
  const dom = new JSDOM(out.markup, { contentType: "image/svg+xml" });
  const mark = dom.window.document.querySelector('[data-change-at="4"]');
  assert.ok(mark);
  assert.match(mark.textContent ?? "", /1=G/);
  assert.match(mark.textContent ?? "", /3\/4/);
  assert.match(mark.textContent ?? "", /♩=60/);
  assert.equal(out.measures[0].end, 4);
  assert.equal(out.measures[1].end - out.measures[1].start, 3);
  assert.equal(out.measures[1].beats, 3);
  const shifted = jianpuPrint(score as any, DEFAULT_PRINT_SETTINGS, 2);
  const shiftedMark = new JSDOM(shifted.markup, { contentType: "image/svg+xml" }).window.document
    .querySelector('[data-change-at="4"]');
  assert.match(shiftedMark?.textContent ?? "", /1=A/);
  assert.doesNotMatch(shiftedMark?.textContent ?? "", /1=G/);
  dom.window.close();
});

test("打印简谱与屏幕使用相同的降号拼写，换调仍按原音高记谱", () => {
  const score = { ...fixture(), key: "Eb" as const, notes: [{ pitches: [63], dur: 4 }, { pitches: [68], dur: 4 }], changes: [{ at: 4, key: "Ab" as const }] };
  const out = jianpuPrint(score, DEFAULT_PRINT_SETTINGS);
  assert.ok(out.markup.includes("1=♭E"));
  assert.ok(out.markup.includes("1=♭A"));
  const dom = new JSDOM(out.markup, { contentType: "image/svg+xml" });
  assert.equal(dom.window.document.querySelector('[data-note-start="4"]').textContent, "1");
  dom.window.close();
  assert.ok(jianpuPrint(score, DEFAULT_PRINT_SETTINGS, 3).markup.includes("1=♭G"));
});
