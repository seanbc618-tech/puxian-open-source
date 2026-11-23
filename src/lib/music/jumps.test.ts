import assert from "node:assert/strict";
import test from "node:test";
import { abcBarText, editJumps, fitJumps, hasPlayOrder, jumpMarks, jumpProblem, jumpsSummary, unrollScore, unrollSegments } from "./repeats.ts";
import type { Score } from "./theory.ts";
import { isScore } from "./score-storage.ts";

// 4/4, eight one-bar whole notes: bars start at 0,4,...,28; end 32. Bar n = pitch 59 + n.
const base = (extra: Partial<Score> = {}): Score => ({
  title: "跳转", bpm: 120, beats: 4, beatUnit: 4, key: "C", mode: "major", clef: "treble", tonicOctave: 4,
  notes: Array.from({ length: 8 }, (_, i) => ({ pitches: [60 + i], dur: 4 })),
  ...extra,
});
const played = (s: Score) => unrollScore(s).score.notes.map((n) => n.pitches[0]);

test("D.C. al Fine: back to the start, stop at Fine", () => {
  const s = base({ jumps: { dc: 16, fine: 8 } });
  assert.equal(jumpProblem(s), null);
  assert.ok(hasPlayOrder(s));
  assert.deepEqual(played(s), [60, 61, 62, 63, 60, 61]);
  assert.deepEqual(unrollScore(s).source[0], [0, 1, 2, 3, 0, 1]);
  assert.equal(unrollScore(s).score.jumps, undefined);
});

test("D.S. al Coda: back to the segno, To Coda jumps to the coda", () => {
  const s = base({ jumps: { segno: 4, toCoda: 12, ds: 20, coda: 20 } });
  assert.equal(jumpProblem(s), null);
  assert.deepEqual(unrollSegments(s), [{ from: 0, to: 20 }, { from: 4, to: 12 }, { from: 20, to: 32 }]);
  assert.deepEqual(played(s), [60, 61, 62, 63, 64, 61, 62, 65, 66, 67]);
  assert.equal(jumpsSummary(s), "第 5 小节末 D.S. al Coda：回到第 2 小节 Segno，奏到第 3 小节末 To Coda，跳到第 6 小节 Coda 奏完");
  assert.equal(jumpsSummary(base({ jumps: { dc: 16, fine: 8 } })), "第 4 小节末 D.C. al Fine：回到开头，奏到第 2 小节末 Fine 结束");
  assert.equal(jumpsSummary(base({ jumps: { dc: 16 } })), "第 4 小节末 D.C.：回到开头，奏到结尾");
  assert.equal(jumpsSummary(base({ jumps: { ds: 16 } })), "第 4 小节末 D.S.。还不能跳转：D.S. 要先设 Segno 记号。");
});

test("plain D.C. after a repeat: second time no repeat, last ending only", () => {
  // |: b1 [1 b2 :| [2 b3 | b4 D.C. | b5 …
  const s = base({ repeats: [{ from: 0, to: 8, ending: 4, endingEnd: 12 }], jumps: { dc: 16 } });
  assert.equal(jumpProblem(s), null);
  assert.deepEqual(played(s), [60, 61, 60, 62, 63, 60, 62, 63, 64, 65, 66, 67]);
});

test("incomplete or contradictory jumps are drawn but not played", () => {
  const cases: [Score["jumps"], RegExp][] = [
    [{ segno: 4 }, /还没有 D\.C\. 或 D\.S\./],
    [{ ds: 16 }, /先设 Segno 记号/],
    [{ segno: 20, ds: 16 }, /Segno 要在 D\.S\. 之前/],
    [{ dc: 16, ds: 20 }, /只能有一个/],
    [{ dc: 16, toCoda: 8 }, /还要设 Coda/],
    [{ dc: 16, coda: 20 }, /还要设 To Coda/],
    [{ dc: 16, toCoda: 8, coda: 12 }, /Coda 尾声要在/],
    [{ dc: 16, fine: 20 }, /Fine 要在/],
    [{ dc: 16, fine: 8, toCoda: 8, coda: 20 }, /只能选一种/],
    [{ dc: 15 }, /小节线/],
    [{ dc: 32, toCoda: 8, coda: 32 }, /Coda 后面还要有音/],
  ];
  for (const [jumps, reason] of cases) {
    const s = base({ jumps });
    assert.match(jumpProblem(s) ?? "", reason, JSON.stringify(jumps));
    assert.deepEqual(played(s), [60, 61, 62, 63, 64, 65, 66, 67], JSON.stringify(jumps));
  }
  const inRepeat = base({ repeats: [{ from: 0, to: 12 }], jumps: { dc: 8 } });
  assert.match(jumpProblem(inRepeat) ?? "", /反复段中间/);
  assert.equal(hasPlayOrder(base({ jumps: { segno: 4 } })), false);
});

test("editing: bar start / end, toggle, one jump and one ending kind", () => {
  let s = base();
  const apply = (q: number, action: Parameters<typeof editJumps>[2]) => {
    const r = editJumps(s, q, action);
    if ("error" in r) throw new Error(r.error);
    s = { ...s, jumps: r.jumps };
  };
  apply(5, "segno");
  apply(17, "ds");
  apply(9, "toCoda");
  apply(21, "coda");
  assert.deepEqual(s.jumps, { segno: 4, ds: 20, toCoda: 12, coda: 20 });
  assert.equal(jumpProblem(s), null);
  apply(1, "dc");
  assert.equal(s.jumps?.ds, undefined, "D.C. replaces D.S.");
  apply(5, "fine");
  assert.deepEqual(s.jumps, { segno: 4, dc: 4, fine: 8 });
  assert.equal(s.jumps?.toCoda, undefined, "Fine replaces To Coda");
  assert.equal(s.jumps?.coda, undefined);
  apply(5, "fine");
  assert.equal(s.jumps?.fine, undefined, "same place toggles off");
  apply(0, "clearJumps");
  assert.equal(s.jumps, undefined);
  const withRepeat = base({ repeats: [{ from: 0, to: 12 }] });
  const inside = editJumps(withRepeat, 5, "dc");
  assert.ok("error" in inside && /反复段中间/.test(inside.error));
  const edge = editJumps(withRepeat, 9, "dc");
  assert.deepEqual(edge, { jumps: { dc: 12 } });
});

test("marks and staff ABC decorations, top voice only", () => {
  const s = base({ jumps: { segno: 4, toCoda: 12, ds: 20, coda: 20 } });
  assert.deepEqual(jumpMarks(s).map((m) => m.text), ["Segno", "To Coda", "Coda", "D.S. al Coda"]);
  const text = abcBarText(s)!;
  assert.equal(text(0, 1, 0), " | !segno! ");
  assert.equal(text(2, 3, 0), " !coda!| ");
  assert.equal(text(4, 5, 0), " !D.S.alcoda!| !coda! ");
  assert.equal(text(4, 5, 1), " | ");
  assert.equal(abcBarText(base({ jumps: { dc: 16, fine: 8 } }))!(3, null, 0), " !D.C.alfine!|");
});

test("an edited voice moves the marks; marks in the edited span go away", () => {
  const prev = base({ jumps: { dc: 16, fine: 8 } });
  // Insert a bar at the start: everything shifts by 4.
  const notes = [{ pitches: [72], dur: 4 }, ...prev.notes];
  const next = fitJumps(prev, { ...prev, notes });
  assert.deepEqual(next.jumps, { dc: 20, fine: 12 });
  // Rewrite bar 2 to 3 beats: the Fine at its end is in the span and is dropped; D.C. shifts.
  const cut = prev.notes.map((n, i) => (i === 1 ? { ...n, dur: 3 } : n));
  const after = fitJumps(prev, { ...prev, notes: cut });
  assert.equal(after.jumps?.fine, undefined);
});

test("isScore checks the jumps shape; MIDI and wait mode follow the jump", async () => {
  assert.ok(isScore(base({ jumps: { dc: 16, fine: 8 } })));
  assert.ok(!isScore({ ...base(), jumps: { dc: "x" } }));
  assert.ok(!isScore({ ...base(), jumps: { dc: -4 } }));
  assert.ok(!isScore({ ...base(), jumps: 3 }));
  const s = base({ jumps: { dc: 16, fine: 8 } });
  const { scoreToMidi } = await import("./midi.ts");
  assert.deepEqual(scoreToMidi(s), scoreToMidi(unrollScore(s).score));
  assert.notDeepEqual(scoreToMidi(s), scoreToMidi(base()));
  const { waitTargets } = await import("./wait-mode.ts");
  assert.deepEqual(waitTargets(s).map((t) => t.pitches[0]), [60, 61, 62, 63, 60, 61]);
});

test("share links keep the jumps", async () => {
  const { decodeSharePayload, encodeSharePayload } = await import("./share-link.ts");
  const s = base({ jumps: { segno: 4, toCoda: 12, ds: 20, coda: 20 } });
  assert.deepEqual(decodeSharePayload(encodeSharePayload(s))?.jumps, s.jumps);
});

test("MusicXML writes segno / coda / words + sound and reads them back", async () => {
  const { musicXmlToScore, scoreToMusicXml } = await import("./musicxml.ts");
  for (const jumps of [{ segno: 4, toCoda: 12, ds: 20, coda: 20 }, { dc: 16, fine: 8 }]) {
    const s = base({ jumps });
    const xml = scoreToMusicXml(s);
    if (jumps.ds) {
      assert.match(xml, /<segno\/>[\s\S]*<sound segno="segno"\/>/);
      assert.match(xml, /<words>D\.S\. al Coda<\/words>[\s\S]*<sound dalsegno="segno"\/>/);
      assert.match(xml, /<sound tocoda="coda"\/>/);
    } else {
      assert.match(xml, /<sound fine="yes"\/>/);
      assert.match(xml, /<words>D\.C\. al Fine<\/words>[\s\S]*<sound dacapo="yes"\/>/);
    }
    const back = musicXmlToScore(xml, "x");
    assert.deepEqual(back.score.jumps, jumps);
    assert.ok(!back.losses.some((l) => l.startsWith("跳转")), back.losses.join(" / "));
    assert.match(back.notice, /已保留跳转记号/);
  }
  // Words only (no <sound>) from another editor.
  const words = scoreToMusicXml(base()).replace(
    /(<measure number="4"[^>]*>[\s\S]*?)(\n    <\/measure>)/,
    `$1<direction><direction-type><words>D.C. al Fine</words></direction-type></direction>$2`,
  ).replace(
    /(<measure number="2"[^>]*>[\s\S]*?)(\n    <\/measure>)/,
    `$1<direction><direction-type><words>Fine</words></direction-type></direction>$2`,
  );
  assert.deepEqual(musicXmlToScore(words, "x").score.jumps, { fine: 8, dc: 16 });
});

test("printed numbered score labels the jumps on the top voice", async () => {
  const { jianpuPrint } = await import("./jianpu-print.ts");
  const { DEFAULT_PRINT_SETTINGS } = await import("./print-layout.ts");
  const s = base({ jumps: { segno: 4, toCoda: 12, ds: 20, coda: 20 }, voice2: base().notes });
  const markup = jianpuPrint(s, DEFAULT_PRINT_SETTINGS).markup;
  for (const [kind, label] of [["segno", "Segno"], ["coda", "⊕ Coda"], ["toCoda", "To Coda ⊕"], ["jump", "D.S. al Coda"]])
    assert.equal(markup.split(`data-jump="${kind}">${label}<`).length - 1, 1, kind);
});
