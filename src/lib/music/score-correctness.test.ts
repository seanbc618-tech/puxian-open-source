import test from "node:test";
import assert from "node:assert/strict";
import abcjs from "abcjs";
import { engraveAbc } from "./score-engraving.ts";
import { EXAMPLES, scoreFromExample } from "./examples.ts";
import { formatJianpu } from "./notation.ts";
import { loadExampleScore } from "./examples-load.ts";
import { RestModel, scoreToJianpu } from "./jianpu-render.ts";

test("ABC preserves short binary durations and isolated tuplets without parser warnings", () => {
  for (const dur of [1 / 8, 1 / 16, 3 / 16, 1 / 3, 1 / 5, 1 / 7]) {
    for (const changes of [undefined, [{ at: 0, bpm: 90 }]]) {
      const score = {
        ...scoreFromExample(EXAMPLES[0]),
        notes: [
          { pitches: [60], dur },
          { pitches: [62], dur: 1 },
        ],
        changes,
      };
      const { abc } = engraveAbc(score);
      const tune = abcjs.parseOnly(abc)[0];
      assert.deepEqual(tune.warnings ?? [], [], abc);
      const notes = tune.lines
        .flatMap((l) => l.staff ?? [])
        .flatMap((s) => s.voices)
        .flat()
        .filter((n) => n?.el_type === "note");
      const first = notes[0] as unknown as { duration: number; tripletMultiplier?: number };
      assert.ok(Math.abs(first.duration * 4 * (first.tripletMultiplier ?? 1) - dur) < 1e-7, abc);
    }
  }
});

test("numbered notation never draws a nonstandard tail as a normal sixty-fourth", () => {
  const score = { ...scoreFromExample(EXAMPLES[0]), notes: [{ pitches: [60], dur: 1 / 3 }] };
  const model = new RestModel(scoreToJianpu(score)[0].info);
  const tail = [...model.jianpuBlockMap.values()].at(-1)!;
  assert.equal(tail.durationLines, undefined);
});

test("source pickup bars end at the first strong beat in classic examples", async () => {
  for (const [id, pad] of [
    ["elise", 1],
    ["alla-turca", 1],
    ["nocturne", 5.5],
  ] as const) {
    const score = await loadExampleScore(id);
    assert.deepEqual(score.notes[0], { pitches: [], dur: pad }, id);
  }
});

test("SVG and print explicitly label the exact irregular duration, including redraws", async () => {
  const { createRequire } = await import("node:module");
  const { JSDOM } = createRequire(import.meta.url)("jsdom");
  const { renderJianpu } = await import("./jianpu-render.ts");
  const { jianpuPrint } = await import("./jianpu-print.ts");
  const { DEFAULT_PRINT_SETTINGS } = await import("./print-layout.ts");
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
    Object.defineProperty(globalThis, name, { configurable: true, value: dom.window[name] });
  }
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
    const score = { ...scoreFromExample(EXAMPLES[0]), notes: [{ pitches: [60], dur: 1 / 3 }] };
    const host = dom.window.document.querySelector("#score") as HTMLDivElement;
    const view = renderJianpu(host, scoreToJianpu(score)[0]);
    assert.match(host.textContent ?? "", /\[1\/48拍\]/);
    view.clear();
    view.redraw();
    assert.equal(host.querySelectorAll("[data-rhythm-duration]").length, 1);
    const printed = jianpuPrint(score, DEFAULT_PRINT_SETTINGS);
    assert.match(printed.markup, /\[1\/3拍\]/);
    view.destroy();
  } finally {
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
    dom.window.close();
  }
});

test("Frère Jacques closing phrase uses the dominant below the tonic", () => {
  const score = scoreFromExample(EXAMPLES.find((e) => e.id === "tigers")!);
  assert.deepEqual(
    score.notes.slice(-6).map((n) => [n.pitches[0], n.dur]),
    [
      [60, 1],
      [55, 1],
      [60, 2],
      [60, 1],
      [55, 1],
      [60, 2],
    ],
  );
});

test("an accidental cannot leak into a later natural note in the same bar", () => {
  const score = {
    ...scoreFromExample(EXAMPLES[0]),
    notes: [
      { pitches: [61], dur: 1 },
      { pitches: [60], dur: 1 },
      { pitches: [61], dur: 1 },
      { pitches: [60], dur: 1 },
    ],
  };
  const tune = abcjs.parseOnly(engraveAbc(score).abc)[0];
  const notes = tune.lines
    .flatMap((l) => l.staff ?? [])
    .flatMap((s) => s.voices)
    .flat()
    .filter((n) => n?.el_type === "note");
  assert.deepEqual(
    notes.map(
      (n) => (n as unknown as { pitches: { accidental?: string }[] }).pitches[0].accidental,
    ),
    ["sharp", "natural", "sharp", "natural"],
  );
});

test("independent MusicXML source fingerprints match every fully checked voice", async () => {
  const { readFileSync } = await import("node:fs");
  const { createHash } = await import("node:crypto");
  const sources = JSON.parse(
    readFileSync(new URL("./fixtures/score-audit/source-summary.json", import.meta.url), "utf8"),
  ) as Record<string, { voices?: { match: boolean; sourceDigest: string }[] }>;
  for (const [id, source] of Object.entries(sources)) {
    if (!source.voices) continue;
    const score = await loadExampleScore(id);
    const voices = [
      score.notes,
      ...(score.voice2 ? [score.voice2] : []),
      ...(score.extraVoices ?? []),
    ];
    assert.equal(voices.length, source.voices.length, id);
    for (const [index, expected] of source.voices.entries()) {
      if (!expected.match) continue; // Explicitly listed in docs/score-correctness-audit.md; not certified.
      const byPitch = new Map<number, [number, number][]>();
      let at = 0;
      for (const note of voices[index]) {
        for (const pitch of note.pitches) {
          const spans = byPitch.get(pitch) ?? [];
          spans.push([at, at + note.dur]);
          byPitch.set(pitch, spans);
        }
        at += note.dur;
      }
      const canonical: (number | string)[][] = [];
      for (const [pitch, spans] of [...byPitch].sort((a, b) => a[0] - b[0])) {
        const merged: [number, number][] = [];
        for (const [a, b] of spans.sort((a, b) => a[0] - b[0])) {
          const last = merged.at(-1);
          if (last && a <= last[1] + 1e-6) last[1] = Math.max(last[1], b);
          else merged.push([a, b]);
        }
        canonical.push(...merged.map(([a, b]) => [pitch, a.toFixed(5), b.toFixed(5)]));
      }
      assert.equal(
        createHash("sha256").update(JSON.stringify(canonical)).digest("hex"),
        expected.sourceDigest,
        `${id} voice ${index + 1}`,
      );
    }
  }
});

test("tied binary values preserve total time through a barline", () => {
  const score = {
    ...scoreFromExample(EXAMPLES[0]),
    notes: [
      { pitches: [60], dur: 2.125 },
      { pitches: [62], dur: 2.125 },
    ],
  };
  const tune = abcjs.parseOnly(engraveAbc(score).abc)[0];
  assert.deepEqual(tune.warnings ?? [], []);
  const notes = tune.lines
    .flatMap((l) => l.staff ?? [])
    .flatMap((s) => s.voices)
    .flat()
    .filter((n) => n?.el_type === "note") as unknown as {
    duration: number;
    tripletMultiplier?: number;
  }[];
  assert.ok(
    Math.abs(
      notes.reduce((sum, n) => sum + n.duration * 4 * (n.tripletMultiplier ?? 1), 0) - 4.25,
    ) < 1e-7,
  );
});

function staffAccidentals(score: Parameters<typeof engraveAbc>[0], shift = 0) {
  const abc = engraveAbc(score, shift).abc;
  const tune = abcjs.parseOnly(abc)[0];
  assert.deepEqual(tune.warnings ?? [], [], abc);
  return tune.lines.flatMap(l => l.staff ?? []).flatMap(s => s.voices).flat()
    .filter(n => n?.el_type === "note")
    .map(n => (n as unknown as { pitches?: { accidental?: string }[] }).pitches?.map(p => p.accidental));
}

const naturalBase = () => scoreFromExample(EXAMPLES.find(e => e.id === "tigers")!);

test("两只老虎 has zero natural signs in actual abcjs parsing", () => {
  const score = naturalBase();
  assert.equal(staffAccidentals(score).flat().filter(a => a === "natural").length, 0);
  assert.doesNotMatch(engraveAbc(score).abc, /=[A-Ga-g]/);
});

test("key signatures, bar resets and octave-specific cancellations", () => {
  const score = { ...naturalBase(), notes: [66, 65, 77, 65, 65].map(p => ({ pitches: [p], dur: 1 })) };
  assert.deepEqual(staffAccidentals(score), [["sharp"], ["natural"], [undefined], [undefined], [undefined]]);
  assert.deepEqual(staffAccidentals({ ...score, key: "G", notes: [{ pitches: [66], dur: 1 }] }), [[undefined]]);
  assert.deepEqual(staffAccidentals({ ...score, notes: [{ pitches: [65], dur: 1 }] }, 2), [[undefined]]);
});

test("inline keys reset accidental state using the new signature, including transposition", () => {
  const score = { ...naturalBase(), notes: [66, 66, 65, 65].map(p => ({ pitches: [p], dur: 1 })),
    changes: [{ at: 1, key: "G" as const, mode: "major" as const }, { at: 3, key: "C" as const, mode: "major" as const }] };
  assert.deepEqual(staffAccidentals(score), [["sharp"], [undefined], ["natural"], [undefined]]);
  assert.match(engraveAbc(score, 2).abc, /\[K:A\]/);
});

test("chords and grand-staff bass voice keep independent accidentals", () => {
  const score = { ...naturalBase(), notes: [
    { pitches: [60, 66], dur: 1 }, { pitches: [60, 65], dur: 1 }, { pitches: [60, 65], dur: 2 },
  ], voice2: [{ pitches: [65], dur: 1 }, { pitches: [66], dur: 1 }, { pitches: [65], dur: 2 }],
  clef: "treble" as const, staffInstrument: "piano" as const };
  assert.deepEqual(staffAccidentals(score), [
    [undefined, "sharp"], [undefined, "natural"], [undefined, undefined],
    [undefined], ["sharp"], ["natural"],
  ]);
});

test("grace notes update state before the decorated main note", () => {
  const score = { ...naturalBase(), notes: [{ pitches: [65], dur: 1, ornament: "appoggiatura" as const, gracePitch: 66 }] };
  assert.match(engraveAbc(score).abc, /\{\^F\}=F/);
});

test("tied continuations across bars omit repeated accidentals and leave the next attack explicit", () => {
  const score = { ...naturalBase(), notes: [{ pitches: [66], dur: 5 }, { pitches: [66], dur: 1 }, { pitches: [65], dur: 1 }] };
  assert.deepEqual(staffAccidentals(score), [["sharp"], [undefined], ["sharp"], ["natural"]]);
});

test("official 小星星 keeps both repeats of 5544|332- on the staff and in jianpu", () => {
  const score = scoreFromExample(EXAMPLES.find((item) => item.id === "twinkle")!);
  assert.equal(score.notes.reduce((sum, note) => sum + note.dur, 0), 48);
  const numbered = formatJianpu(score);
  assert.equal(numbered.split("5 5 4 4 | 3 3 2 -").length - 1, 2);
  const tune = abcjs.parseOnly(engraveAbc(score).abc)[0];
  let bars = 0;
  for (const line of tune.lines) {
    for (const staff of line.staff ?? []) {
      for (const voice of staff.voices ?? []) {
        let open = false;
        for (const el of voice) {
          if (el.el_type === "bar") {
            if (open) bars += 1;
            open = false;
          }
          if (el.el_type === "note") open = true;
        }
        if (open) bars += 1;
      }
    }
  }
  assert.equal(bars, 12);
});
