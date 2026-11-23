import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { EXAMPLES, scoreFromExample } from "./examples.ts";
import { applyJianpuText } from "./jianpu-edit.ts";
import { isScore } from "./score-storage.ts";
import { cleanScore } from "./expression.ts";
import { renderJianpu, scoreToJianpu, safeDestroy, markChordSymbols, markFingerings } from "./jianpu-render.ts";
import type { Score, ScoreNote } from "./theory.ts";
import { formatJianpu } from "./notation.ts";

const { JSDOM } = createRequire(import.meta.url)("jsdom") as {
  JSDOM: new (html: string, options?: object) => { window: Window & typeof globalThis & { close(): void } };
};

function decoratedTwinkle(): Score {
  const score = scoreFromExample(EXAMPLES[0]);
  const notes: ScoreNote[] = score.notes.map((note, index) => {
    const next: ScoreNote = { ...note, pitches: note.pitches.slice() };
    if (note.pitches.length && index < 6) {
      next.lyric = { text: "一闪一闪亮晶"[index]!, syllabic: "single" };
    }
    if (index === 0 && note.pitches.length) {
      next.pitches = [60, 64, 67];
      next.ornament = "arpeggio";
      next.fingers = [1, 3, 5];
    }
    return next;
  });
  return {
    ...score,
    notes,
    chordSymbols: [
      { at: 0, symbol: "C" },
      { at: 4, symbol: "G" },
      { at: 8, symbol: "C" },
    ],
  };
}

test("replacing 唱名 on a score with lyrics, chords, fingering and arpeggio does not throw", () => {
  const score = decoratedTwinkle();
  assert.equal(isScore(score), true);
  const replacement = "5 5 6 6 5 5 4 - 3 3 2 2 1 1 1 -";
  const result = applyJianpuText(score, replacement, 0);
  assert.equal(result.error, undefined);
  assert.equal(isScore(result.score), true);
  assert.equal(isScore(cleanScore(result.score)), true);
  assert.equal(result.lyricsDropped, false, "rewritten melody carries previous lyrics in order");
  assert.equal(result.lyricNotice, undefined);
  assert.deepEqual(
    result.score.notes.filter((note) => note.lyric).map((note) => note.lyric!.text).join(""),
    "一闪一闪亮晶",
  );
  // Chord marks are score-level times; they must survive without invalidating the score.
  assert.ok((result.score.chordSymbols ?? []).length >= 1);
  const arpeggioGone = result.score.notes.every((note) => note.ornament !== "arpeggio");
  assert.equal(arpeggioGone, true, "a rewritten melody does not keep the old arpeggio on a new pitch");
});

test("identical 唱名 rewrite keeps lyrics, arpeggio, fingering", () => {
  const score = decoratedTwinkle();
  const result = applyJianpuText(score, formatJianpu(score), 0);
  assert.equal(result.error, undefined);
  assert.equal(result.lyricsDropped, false);
  assert.equal(result.score.notes[0]?.ornament, "arpeggio");
  assert.deepEqual(result.score.notes[0]?.fingers, [1, 3, 5]);
  assert.equal(result.score.notes[0]?.lyric?.text, "一");
});

test("rewritten score with leftover chord marks still renders and destroys", () => {
  const dom = new JSDOM("<!doctype html><body></body>", { pretendToBeVisual: true });
  const names = ["window", "document", "HTMLElement", "SVGElement", "SVGSVGElement", "Element", "Node"] as const;
  const saved = names.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
  try {
    const win = dom.window;
    for (const name of names) {
      Object.defineProperty(globalThis, name, { configurable: true, value: (win as never)[name] });
    }
    Object.assign(win.SVGElement.prototype, {
      getBBox() { return { x: 0, y: 0, width: 12, height: 24 }; },
      beginElement() {},
      endElement() {},
      getCTM() { return { e: 0 }; },
    });
    const score = applyJianpuText(decoratedTwinkle(), "1 2 3 4 5 6 5 -", 0).score;
    const host = win.document.createElement("div") as HTMLDivElement;
    win.document.body.append(host);
    const voice = scoreToJianpu(score)[0];
    const view = renderJianpu(host, voice);
    assert.doesNotThrow(() => markChordSymbols(host, voice, score.chordSymbols));
    assert.doesNotThrow(() => markFingerings(host, voice, score.notes, true));
    assert.doesNotThrow(() => safeDestroy(view, host));
  } finally {
    dom.window.close();
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
});

test("applyJianpuText surfaces parse errors and leaves the score untouched", () => {
  const score = decoratedTwinkle();
  const before = JSON.stringify(score);
  const result = applyJianpuText(score, "1 = H\n1 2 3", 0);
  assert.ok(result.error);
  assert.equal(JSON.stringify(result.score), before);
});
