import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { JSDOM } = createRequire(import.meta.url)("jsdom") as {
  JSDOM: new (
    html: string,
    options?: object,
  ) => { window: Window & typeof globalThis & { close(): void } };
};
import { EXAMPLES, scoreFromExample } from "./examples.ts";
import {
  scoreToJianpu,
  RestModel,
  renderJianpu,
  jianpuHitAt,
  paintJianpu,
  markLoop,
  markBarlines,
  markNoteHits,
  jianpuTargetOf,
  markChordSymbols,
  overlayHeaderBox,
  HEADER_CHORD_GAP,
  CHORD_MARK_LIFT,
  CHORD_MARK_SIZE,
} from "./jianpu-render.ts";

const twinkle = () => scoreFromExample(EXAMPLES[0]);

test("小星星：四分音符时间、拍号、歌词、和弦与移调，保持 Score 不变", () => {
  const score = twinkle();
  score.notes[0] = { pitches: [60, 64], dur: 1.5, lyric: { text: "星", syllabic: "single" } };
  const before = JSON.stringify(score);
  const [voice] = scoreToJianpu(score, 2);
  assert.deepEqual(voice.info.notes.slice(0, 2), [
    { start: 0, length: 1.5, pitch: 62, intensity: 100 },
    { start: 0, length: 1.5, pitch: 66, intensity: 100 },
  ]);
  assert.equal(voice.hits[1].start, 1.5);
  assert.equal(voice.info.keySignatures![0].key, 2);
  assert.equal(voice.info.lyrics![0].text, "星");
  assert.equal(voice.info.timeSignatures![0].numerator, 4);
  assert.ok(new RestModel(voice.info).jianpuBlockMap.size > 0);
  assert.equal(JSON.stringify(score), before);
});

test("休止：首部、中间、尾部、全休止和空谱保留正确时值，无假音", () => {
  for (const notes of [
    [
      { pitches: [], dur: 1 },
      { pitches: [60], dur: 1 },
      { pitches: [], dur: 2 },
    ],
    [
      { pitches: [60], dur: 1 },
      { pitches: [], dur: 1 },
      { pitches: [62], dur: 1 },
    ],
    [{ pitches: [], dur: 3 }],
    [],
  ]) {
    const score = { ...twinkle(), notes };
    const [voice] = scoreToJianpu(score);
    const model = new RestModel(voice.info);
    const blocks = [...model.jianpuBlockMap.values()];
    const duration = notes.reduce((sum, n) => sum + n.dur, 0);
    assert.ok(Math.abs(model.getTotalDuration() - duration) < 0.00001);
    assert.ok(Math.abs(blocks.reduce((sum, b) => sum + b.length, 0) - duration) < 1e-6);
    assert.ok(blocks.every((b) => b.notes.every((n) => n.intensity > 0)));
    for (const hit of voice.hits.filter((hit) => !hit.pitches.length)) {
      assert.ok(
        blocks
          .filter((b) => b.start >= hit.start && b.start < hit.end)
          .every((b) => !b.notes.length),
      );
    }
  }
});

test("voice2 独立时间线；跨拍连音仍映射到原始 note index", () => {
  const score = {
    ...twinkle(),
    voice2: [
      { pitches: [48], dur: 3 },
      { pitches: [], dur: 1 },
    ],
  };
  const voices = scoreToJianpu(score);
  assert.equal(voices.length, 2);
  assert.equal(voices[1].hits[1].start, 3);
  assert.equal(voices[0].hits[1].start, 1);
  assert.equal(jianpuHitAt(voices[1].hits, 2, 48)?.index, 0);
  assert.equal(jianpuHitAt(voices[1].hits, 3, 48), undefined);
  assert.equal(scoreToJianpu({ ...twinkle(), voice2: [] }).length, 2);
  assert.equal(scoreToJianpu(twinkle()).length, 1);
});

test("jsdom：真实 SVG、休止数字、和弦竖排、A-B 循环底色、高亮与清除、销毁", () => {
  const dom = new JSDOM('<div id="score"></div>', { pretendToBeVisual: true });
  const saved = new Map<string, PropertyDescriptor | undefined>();
  for (const name of [
    "window",
    "document",
    "HTMLElement",
    "SVGElement",
    "SVGSVGElement",
    "Element",
  ]) {
    saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, {
      configurable: true,
      value: (dom.window as unknown as Record<string, unknown>)[name],
    });
  }
  // jsdom does not implement SVG text measurement or SMIL lifecycle.
  Object.assign(dom.window.SVGElement.prototype, {
    getBBox() {
      return { x: 0, y: 0, width: 12, height: 24 };
    },
    beginElement() {},
    endElement() {},
    getCTM() {
      return { e: 0 };
    },
  });
  try {
    const score = {
      ...twinkle(),
      notes: [
        { pitches: [60, 64], dur: 2 },
        { pitches: [], dur: 1 },
      ],
    };
    const [voice] = scoreToJianpu(score);
    const host = dom.window.document.querySelector<HTMLDivElement>("#score")!;
    const view = renderJianpu(host, voice);
    assert.ok(host.querySelector("svg"));
    assert.ok([...host.querySelectorAll("text")].some((el) => el.textContent === "0"));
    paintJianpu(host, voice, [0], []);
    const groups = [...host.querySelectorAll<SVGGElement>("g[data-id]")].filter((el) =>
      /^(\d+(?:\.\d+)?)-(60|64)$/.test(el.dataset.id ?? ""),
    );
    assert.ok(groups.length >= 1);
    // Chords stack like the print: lowest (60 → 1) on the baseline, 64 (→ 3) above it in the same group.
    assert.ok(groups.every((el) => el.dataset.id?.endsWith("-60")));
    assert.equal(host.querySelector('g[data-id="0-64"]'), null);
    const stacked = host.querySelector('g[data-id="0-60"] text[data-chord-tone="64"]');
    assert.equal(stacked?.textContent, "3");
    assert.ok(Number(stacked?.getAttribute("y")) < 0, "upper chord tone sits above the baseline");
    assert.ok(Number(host.dataset.chordShift) > 0, "the line grows to make room");
    assert.ok(groups.every((el) => el.style.color === "rgb(164, 72, 37)"));
    assert.equal(stacked?.getAttribute("fill"), "currentColor", "follow colour covers the whole chord");
    paintJianpu(host, voice, [], []);
    assert.ok(groups.every((el) => el.style.color === "rgb(28, 25, 22)"));
    // A-B loop: shaded band + brackets behind the looped notes only; cleared with null.
    assert.equal(markLoop(host, voice, { from: 2, to: 3 }), true);
    const band = host.querySelector("[data-loop-band]");
    assert.ok(band?.querySelector("rect"));
    assert.equal(band?.getAttribute("pointer-events"), "none");
    assert.equal(band?.querySelectorAll("[data-loop-edge]").length, 2);
    assert.equal(band?.parentElement?.getAttribute("data-id"), "main-content");
    assert.equal(markLoop(host, voice, { from: 0, to: 4 }, 3), true, "loop continuing past the line");
    assert.equal(host.querySelectorAll("[data-loop-band]").length, 1, "redraw replaces the band");
    assert.deepEqual([...host.querySelectorAll("[data-loop-edge]")].map((el) => el.getAttribute("data-loop-edge")), ["start"]);
    assert.equal(markLoop(host, voice, { from: 8, to: 9 }), false, "nothing looped on this line");
    assert.equal(markLoop(host, voice, null), false);
    assert.equal(host.querySelector("[data-loop-band]"), null);
    view.destroy();
    assert.equal(host.childElementCount, 0);
    const changing = { ...twinkle(), notes: [{ pitches: [60], dur: 4 }], changes: [{ at: 1.5, bpm: 60, beats: 3, beatUnit: 8, key: 'G' as const, mode: 'major' as const }] };
    const changeView = renderJianpu(host, scoreToJianpu(changing)[0]);
    const labels = [...host.querySelectorAll('text')].map(el => el.textContent).join(' ');
    assert.match(labels, /1=G/);
    assert.match(labels, /60/);
    assert.match(labels, /3/);
    assert.match(labels, /8/);
    changeView.destroy();
    const continued = renderJianpu(host, scoreToJianpu(twinkle())[0], { header: false });
    assert.ok(![...host.querySelectorAll("text")].some((el) => /^1=/.test(el.textContent ?? "")), "continued line has no 1=X header");
    assert.equal(host.querySelectorAll("svg")[1].style.marginTop, "-30px");
    assert.ok(host.querySelector("g[data-id]:not([data-id=overlay])"), "notes still drawn");
    continued.destroy();
    const opening = renderJianpu(host, scoreToJianpu(twinkle())[0]);
    assert.ok([...host.querySelectorAll("text")].some((el) => el.textContent === "1=C"));
    opening.destroy();
  } finally {
    dom.window.close();
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
});

test("screen numbered notation wraps at whole bars and keeps voice-wide note indexes", async () => {
  const { scoreToJianpuLines, jianpuBarsPerLine } = await import("./jianpu-render.ts");
  const q = (midi: number) => ({ pitches: [midi], dur: 1 });
  const base = { title: "t", bpm: 88, beats: 4, beatUnit: 4, key: "C" as const, mode: "major" as const, clef: "treble" as const, tonicOctave: 4 };
  const score = { ...base, notes: Array.from({ length: 16 }, (_, i) => q(60 + (i % 7))), voice2: Array.from({ length: 8 }, () => ({ pitches: [48], dur: 2 })) };
  const lines = scoreToJianpuLines(score, 0, 2);
  assert.equal(lines.length, 2);
  assert.equal(lines[0].length, 2, "both voices on every line");
  assert.deepEqual(lines[1][0].hits.map((hit) => hit.index), [8, 9, 10, 11, 12, 13, 14, 15]);
  assert.equal(lines[1][0].hits[0].start, 0, "times restart per line");
  assert.equal(lines[1][1].hits[0].index, 4);
  assert.equal(lines[1][0].info.notes[0].start, 0);
  assert.equal(jianpuBarsPerLine(base, 320), 2);
  assert.equal(jianpuBarsPerLine(base, 1000), 8);
  assert.equal(jianpuBarsPerLine(base, 120), 1);
});

test("a page with no tempo mark does not engrave an opening ♩=", async () => {
  const { scoreToJianpuLines } = await import("./jianpu-render.ts");
  const note = { pitches: [60], dur: 1 };
  const base = { title: "t", bpm: 96, beats: 4, beatUnit: 4, key: "C" as const, mode: "major" as const, clef: "treble" as const, tonicOctave: 4, tempoMarked: false as const };
  const lines = scoreToJianpuLines({ ...base, notes: Array.from({ length: 8 }, () => note) }, 0, 4);
  assert.equal(lines[0][0].tempoMark, false);
  assert.deepEqual(lines[0][0].info.tempos, []);
  const marked = scoreToJianpuLines({ ...base, tempoMarked: undefined, notes: Array.from({ length: 4 }, () => note) }, 0, 4);
  assert.equal(marked[0][0].tempoMark, true);
  assert.deepEqual(marked[0][0].info.tempos, [{ start: 0, qpm: 96 }]);
});

test("wrapped lines restate key/meter/tempo only on the first line and where they change", async () => {
  const { scoreToJianpuLines } = await import("./jianpu-render.ts");
  const q = (midi: number) => ({ pitches: [midi], dur: 1 });
  const base = { title: "t", bpm: 88, beats: 4, beatUnit: 4, key: "C" as const, mode: "major" as const, clef: "treble" as const, tonicOctave: 4 };
  const plain = scoreToJianpuLines({ ...base, notes: Array.from({ length: 24 }, (_, i) => q(60 + (i % 7))) }, 0, 2);
  assert.deepEqual(plain.map((line) => line[0].header), [true, false, false]);
  assert.deepEqual(plain.map((line) => line[0].tempoMark), [true, false, false]);

  // Key + tempo change exactly at the start of line 2; key change again inside line 3.
  const changing = {
    ...base,
    notes: Array.from({ length: 24 }, (_, i) => q(60 + (i % 7))),
    changes: [
      { at: 8, bpm: 120, key: "G" as const, mode: "major" as const },
      { at: 20, key: "D" as const, mode: "major" as const },
    ],
  };
  const lines = scoreToJianpuLines(changing, 0, 2);
  assert.deepEqual(lines.map((line) => line[0].header), [true, true, false]);
  assert.deepEqual(lines.map((line) => line[0].tempoMark), [true, true, false]);
  const second = lines[1][0].info;
  assert.deepEqual(second.keySignatures, [{ start: 0, key: 7 }], "line-relative key at line start");
  assert.deepEqual(second.tempos, [{ start: 0, qpm: 120 }]);
  const third = lines[2][0].info;
  assert.deepEqual(third.keySignatures, [{ start: 0, key: 7 }, { start: 4, key: 2 }], "mid-line change keeps its in-line position");
  assert.deepEqual(third.tempos, [{ start: 0, qpm: 120 }]);
  assert.deepEqual(third.timeSignatures, [{ start: 0, numerator: 4, denominator: 4 }]);
});

test("wrapped lines break on real barlines after a meter change", async () => {
  const { scoreToJianpuLines } = await import("./jianpu-render.ts");
  const base = { title: "t", bpm: 88, beats: 4, beatUnit: 4, key: "C" as const, mode: "major" as const, clef: "treble" as const, tonicOctave: 4 };
  // Two 4/4 bars, then 3/4: bars start at 0, 4, 8, 11, 14, 17.
  const score = { ...base, notes: Array.from({ length: 20 }, () => ({ pitches: [60], dur: 1 })), changes: [{ at: 8, beats: 3, beatUnit: 4 }] };
  const lines = scoreToJianpuLines(score, 0, 2);
  assert.deepEqual(lines.map((line) => line[0].hits[0].index), [0, 8, 14]);
  assert.deepEqual(lines[1][0].info.timeSignatures, [{ start: 0, numerator: 3, denominator: 4 }]);
  assert.deepEqual(lines.map((line) => line[0].header), [true, true, false]);
  assert.equal(lines[1][0].tempoMark, false, "a meter change does not restate an unchanged tempo");
});

function withDom<T>(run: (doc: Document) => T): T {
  const dom = new JSDOM('<div id="score"></div>', { pretendToBeVisual: true });
  const saved = new Map<string, PropertyDescriptor | undefined>();
  for (const name of ["window", "document", "HTMLElement", "SVGElement", "SVGSVGElement", "Element"]) {
    saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, value: (dom.window as unknown as Record<string, unknown>)[name] });
  }
  Object.assign(dom.window.SVGElement.prototype, {
    getBBox() { return { x: 0, y: 0, width: 12, height: 24 }; },
    beginElement() {},
    endElement() {},
    getCTM() { return { e: 0 }; },
  });
  try {
    return run(dom.window.document);
  } finally {
    dom.window.close();
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
}

test("jsdom：休止可点选、按选中着色；小节线有点按区并给出下一小节开头的插入位置", () => {
  withDom((doc) => {
    const score = {
      ...twinkle(),
      notes: [
        { pitches: [60], dur: 1 }, { pitches: [], dur: 1 }, { pitches: [62], dur: 1 }, { pitches: [64], dur: 1 },
        { pitches: [], dur: 2 }, { pitches: [67], dur: 1 }, { pitches: [67], dur: 1 },
      ],
    };
    const [voice] = scoreToJianpu(score);
    const host = doc.querySelector<HTMLDivElement>("#score")!;
    const view = renderJianpu(host, voice);
    const rests = [...host.querySelectorAll<SVGGElement>("g[data-id^='block-']")].filter(
      (g) => !g.querySelector("g[data-id]") && [...g.querySelectorAll("text")].some((t) => t.textContent === "0"),
    );
    assert.ok(rests.length >= 2, "rest digits are drawn");
    const targets = rests.map((g) => jianpuTargetOf(voice, g.querySelector("text")));
    assert.deepEqual(targets[0], { kind: "note", index: 1 });
    // The two-beat rest prints 0 0; both digits pick the same rest.
    assert.ok(targets.slice(1).every((t) => t?.kind === "note" && t.index === 4));
    assert.deepEqual(jianpuTargetOf(voice, host.querySelector('g[data-id="0-60"] text')), { kind: "note", index: 0 });
    assert.equal(jianpuTargetOf(voice, host.querySelector("svg")), undefined);

    assert.equal(markBarlines(host, voice), 2);
    const bars = [...host.querySelectorAll("[data-bar-cursor]")];
    assert.deepEqual(bars.map((el) => el.getAttribute("data-bar-cursor")), ["4", "7"]);
    assert.deepEqual(jianpuTargetOf(voice, bars[0]), { kind: "cursor", cursor: 4 });
    for (const bar of bars) {
      const width = Number(bar.getAttribute("width"));
      const height = Number(bar.getAttribute("height"));
      assert.ok(width >= 44 && height >= 44, `bar pad ${width}x${height}`);
    }
    assert.equal(markBarlines(host, voice), 2, "redraw replaces the targets");
    assert.equal(host.querySelectorAll("[data-bar-cursor]").length, 2);

    const pads = markNoteHits(host);
    assert.ok(pads >= 7, `note/rest pads: ${pads}`);
    assert.equal(markNoteHits(host), pads, "redraw replaces note pads");
    for (const pad of host.querySelectorAll(".jianpu-note-target")) {
      const width = Number(pad.getAttribute("width"));
      const height = Number(pad.getAttribute("height"));
      assert.ok(width >= 44 && height >= 44, `note pad ${width}x${height}`);
    }

    paintJianpu(host, voice, [4], [1], 4);
    assert.equal(rests[0].style.color, "rgb(42, 111, 219)", "selected rest is blue");
    assert.ok(rests[0].classList.contains("is-chosen"));
    assert.ok(rests.slice(1).every((g) => g.classList.contains("is-sounding")));
    assert.ok(host.querySelector('[data-bar-cursor="4"]')?.classList.contains("is-cursor"));
    assert.ok(!host.querySelector('[data-bar-cursor="7"]')?.classList.contains("is-cursor"));
    paintJianpu(host, voice, [], [], null);
    assert.equal(host.querySelectorAll(".is-cursor, .is-sounding, .is-chosen").length, 0);
    view.destroy();
  });
});

test("简谱行首和弦标记与 1=C 谱头保持空隙，续行不加这段空位", () => {
  withDom((doc) => {
    const score = {
      ...twinkle(),
      chordSymbols: [
        { at: 0, symbol: "C" },
        { at: 4, symbol: "G" },
      ],
    };
    const [voice] = scoreToJianpu(score);
    const host = doc.querySelector<HTMLDivElement>("#score")!;
    const view = renderJianpu(host, voice, { header: true, height: 148 });
    assert.equal(markChordSymbols(host, voice, score.chordSymbols), true);
    const header = overlayHeaderBox(host);
    assert.ok(header, "first line has a 1= header");
    const content = host.querySelector('g[data-id="main-content"]')!;
    const mark = host.querySelector<SVGTextElement>('[data-chord-at="0"]')!;
    assert.equal(Number(mark.getAttribute("font-size")), CHORD_MARK_SIZE);
    assert.ok(CHORD_MARK_SIZE >= 22, "on-screen marks stay at least 12–13px after typical SVG scale");
    const markY = Number(mark.getAttribute("y")) + (() => {
      let y = 0;
      const re = /translate\(\s*([-\d.]+)[ ,]+([-\d.]+)\s*\)/g;
      const tf = content.getAttribute("transform") ?? "";
      for (let m = re.exec(tf); m; m = re.exec(tf)) y += Number(m[2]);
      return y;
    })();
    const markTop = markY - CHORD_MARK_SIZE;
    assert.ok(
      markTop >= header!.bottom + HEADER_CHORD_GAP - 0.5,
      `mark top ${markTop} should clear header bottom ${header!.bottom} by ${HEADER_CHORD_GAP}`,
    );
    // Stay over the first beat (nudged inward so a middle-anchored "C" is not clipped).
    const firstX = Number(host.querySelector('g[data-id="0-60"] text')?.getAttribute("x") ?? 0);
    const markX = Number(mark.getAttribute("x"));
    assert.ok(markX >= firstX, "mark is not left of the first beat");
    assert.ok(markX - firstX < 16, "mark is not shoved past the first beat");
    const padded = parseFloat(host.style.height || "0");
    const svgH = Number((host.querySelectorAll("svg")[1] ?? host.querySelector("svg"))?.getAttribute("height") ?? 0);
    assert.ok(padded + 0.5 >= svgH, "host grows so the lowered notes are not clipped");
    // A second pass must not stack another lift.
    const transform = content.getAttribute("transform");
    assert.equal(markChordSymbols(host, voice, score.chordSymbols), true);
    assert.equal(content.getAttribute("transform"), transform);
    view.destroy();

    const continued = renderJianpu(host, voice, { header: false, height: 96 });
    assert.equal(markChordSymbols(host, voice, score.chordSymbols), true);
    assert.equal(overlayHeaderBox(host), null);
    const lift = host.querySelector('g[data-id="main-content"]')?.getAttribute("transform") ?? "";
    const added = [...lift.matchAll(/translate\(\s*0[ ,]+(\d+(?:\.\d+)?)\s*\)/g)].map((m) => Number(m[1]));
    assert.equal(added.at(-1), CHORD_MARK_LIFT, "continued line only reserves room above the digits");
    continued.destroy();
  });
});

test("叠和弦上方的和弦名不压在上层数字上", () => {
  withDom((doc) => {
    const score = {
      ...twinkle(),
      notes: [
        { pitches: [60, 64, 67], dur: 2 },
        { pitches: [55, 71, 74], dur: 2 },
        { pitches: [65, 69, 72], dur: 4 },
      ],
      chordSymbols: [
        { at: 0, symbol: "C" },
        { at: 2, symbol: "G" },
        { at: 4, symbol: "F" },
      ],
    };
    const [voice] = scoreToJianpu(score);
    const host = doc.querySelector<HTMLDivElement>("#score")!;
    const view = renderJianpu(host, voice, { header: true, height: 148 });
    assert.equal(markChordSymbols(host, voice, score.chordSymbols), true);
    for (const at of [0, 2, 4]) {
      const mark = host.querySelector<SVGTextElement>(`[data-chord-at="${at}"]`)!;
      const group = [...host.querySelectorAll<SVGGElement>("g[data-id]")].find((g) => g.querySelector("[data-chord-tone]") &&
        Number(/^(\d+(?:\.\d+)?)-/.exec(g.dataset.id ?? "")?.[1]) === at)!;
      assert.ok(group, `stacked chord at ${at}`);
      let top = Infinity;
      for (const el of group.querySelectorAll("[data-chord-tone]")) {
        top = Math.min(top, el.tagName.toLowerCase() === "circle"
          ? Number(el.getAttribute("cy")) - 2
          : Number(el.getAttribute("y")) - 26 * 0.75);
      }
      assert.ok(Number(mark.getAttribute("y")) <= top, `mark ${mark.textContent} baseline sits above the stack top ${top}`);
    }
    view.destroy();
  });
});

 test("屏幕调名：升降号、移调与换调续行保留书写调名", async () => {
  const { scoreToJianpuLines } = await import("./jianpu-render.ts");
  const { writtenJianpuKey } = await import("./jianpu-key.ts");
  for (const key of ["F", "Bb", "Eb", "Ab", "Db", "F#", "D", "A", "E", "B"] as const) {
    for (const shift of [0, 1, 2, -2]) {
      const score = { ...twinkle(), key, changes: [{ at: 4, key: "Eb" as const }] };
      const lines = scoreToJianpuLines(score, shift, 1);
      assert.equal(lines[0][0].keyNames![0].name, writtenJianpuKey(key, shift));
      assert.equal(lines[1][0].keyNames![0].name, writtenJianpuKey("Eb", shift));
    }
  }
 });

test("SVG 头部与重绘、换调续行显示降号而非等音升号", async () => {
  const { scoreToJianpuLines } = await import("./jianpu-render.ts");
  const cases = [["F",0,"F"], ["Bb",0,"♭B"], ["Eb",0,"♭E"], ["Ab",0,"♭A"], ["Db",0,"♭D"], ["Eb",3,"♭G"], ["D",0,"D"], ["A",0,"A"], ["E",0,"E"], ["B",0,"B"], ["F#",0,"F#"]] as const;
  withDom(doc => {
    const host = doc.querySelector<HTMLDivElement>("#score")!;
    for (const [key, shift, expected] of cases) {
      const score = { ...twinkle(), key, changes: [{ at: 4, key: "Eb" as const }] };
      const lines = scoreToJianpuLines(score, shift, 1);
      for (const [index, line] of lines.slice(0,2).entries()) {
        const view = renderJianpu(host, line[0]);
        const label = index ? (shift === 3 ? "♭G" : line[0].keyNames![0].name) : expected;
        assert.ok(host.textContent!.includes(`1=${label}`), host.textContent!);
        view.redraw();
        assert.ok(host.textContent!.includes(`1=${label}`));
        view.destroy();
        host.replaceChildren();
      }
    }
  });
});

test("同一行多次换调只修正新头部，不覆盖较早的调号", () => {
  withDom(doc => {
    const host = doc.querySelector<HTMLDivElement>("#score")!;
    const score = { ...twinkle(), key: "Eb" as const, changes: [{ at: 4, key: "G" as const }, { at: 8, key: "Ab" as const }] };
    const view = renderJianpu(host, scoreToJianpu(score)[0]);
    assert.ok(host.textContent!.includes("1=♭E"));
    assert.ok(host.textContent!.includes("1=G"));
    assert.ok(host.textContent!.includes("1=♭A"));
    view.destroy();
  });
});

test("固定调只把 1= 改到 C，音高与首调相同", () => {
  const score = { ...twinkle(), key: "G" as const, notes: [
    { pitches: [67], dur: 1 },
    { pitches: [67], dur: 1 },
    { pitches: [74], dur: 1 },
    { pitches: [74], dur: 1 },
  ] };
  const [movable] = scoreToJianpu(score, 0, "movable");
  const [fixed] = scoreToJianpu(score, 0, "fixed");
  assert.equal(movable.info.keySignatures![0].key, 7);
  assert.equal(movable.keyNames![0].name, "G");
  assert.equal(fixed.info.keySignatures![0].key, 0);
  assert.equal(fixed.keyNames![0].name, "C");
  assert.deepEqual(fixed.info.notes, movable.info.notes);
  assert.deepEqual(fixed.hits.map((hit) => hit.pitches), movable.hits.map((hit) => hit.pitches));
  const [shifted] = scoreToJianpu(score, 2, "fixed");
  assert.equal(shifted.info.keySignatures![0].key, 0, "transposing instrument still displays 1=C");
  assert.deepEqual(shifted.info.notes.map((note) => note.pitch), movable.info.notes.map((note) => note.pitch + 2));
});

test("固定调画面头部是 1=C，曲中换调也保持 1=C", () => {
  withDom((doc) => {
    const host = doc.querySelector<HTMLDivElement>("#score")!;
    const score = { ...twinkle(), key: "G" as const, changes: [{ at: 4, key: "D" as const }] };
    const view = renderJianpu(host, scoreToJianpu(score, 0, "fixed")[0]);
    const labels = [...host.querySelectorAll("text")].map((el) => el.textContent ?? "").join(" ");
    assert.match(labels, /1=C/);
    assert.ok(!labels.includes("1=G") && !labels.includes("1=D"), labels);
    view.destroy();
  });
});

test("dense numbered notation gets enough room per note; plain songs keep the original spacing", async () => {
  const { jianpuSpacing, jianpuBarsPerLine } = await import("./jianpu-render.ts");
  const base = { title: "t", bpm: 88, beats: 4, beatUnit: 4, key: "C" as const, mode: "major" as const, clef: "treble" as const, tonicOctave: 4 };
  const plain = jianpuSpacing({ ...base, notes: [{ pitches: [60], dur: 1 }, { pitches: [62], dur: 2 }] });
  assert.deepEqual(plain, { pixelsPerTimeStep: 44 }, "quarter-note songs are unchanged");
  const dense = jianpuSpacing({ ...base, bpm: 120, notes: [{ pitches: [60], dur: 0.25 }, { pitches: [62], dur: 1 }], voice2: [{ pitches: [48], dur: 2 }] });
  assert.equal(dense.quarterPx, 88, "a sixteenth gets 22 px");
  assert.equal(dense.pixelsPerTimeStep, 176, "renderer spacing is pixels per second at the score tempo");
  assert.ok(jianpuBarsPerLine({ beats: 2, beatUnit: 4 }, 390, dense.quarterPx) < jianpuBarsPerLine({ beats: 2, beatUnit: 4 }, 390), "dense music wraps sooner");
  const tiny = jianpuSpacing({ ...base, notes: [{ pitches: [60], dur: 0.0625 }] });
  assert.equal(tiny.quarterPx, 96, "spacing is capped");
});
