import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { arrangeScore } from "./arrange.ts";
import { cleanScore, soundingEvents } from "./expression.ts";
import { listMidiVoices, midiToScore, scoreToMidi } from "./midi.ts";
import { musicXmlToScore, scoreToMusicXml } from "./musicxml.ts";
import { engraveAbc, staffTargetAt } from "./notation.ts";
import { playbackPlan } from "./playback.ts";
import { followNoteAt, followSlotsAt, scheduleBeats } from "./playback-clock.ts";
import { cleanNote } from "./expression.ts";
import { addSecondVoice, removeSecondVoice, replaceVoice, scoreQuarters } from "./voices.ts";
import { transposeScore, type Score, type ScoreNote } from "./theory.ts";

function n(midi: number | number[], dur = 1, extra: Partial<ScoreNote> = {}): ScoreNote {
  const pitches = typeof midi === "number" ? (midi < 0 ? [] : [midi]) : midi;
  return { pitches, dur, ...extra };
}

function asScore(notes: ScoreNote[], extra: Partial<Score> = {}): Score {
  return {
    title: "试",
    bpm: 120,
    beats: 4,
    beatUnit: 4,
    key: "C",
    mode: "major",
    clef: "treble",
    tonicOctave: 4,
    notes,
    ...extra,
  };
}

function pitches(notes: ScoreNote[]): Array<number[] | null> {
  return notes.map((note) => (note.pitches.length ? note.pitches : null));
}

describe("saved single-voice scores", () => {
  it("keeps a score that has no voice2 field", () => {
    const saved = JSON.parse(
      JSON.stringify({
        title: "旧",
        bpm: 88,
        beats: 4,
        beatUnit: 4,
        key: "C",
        mode: "major",
        clef: "treble",
        tonicOctave: 4,
        notes: [n(60, 1, { lyric: { text: "小", syllabic: "single" } })],
      }),
    ) as Score;
    assert.equal(saved.voice2, undefined);
    const cleaned = cleanScore(saved);
    assert.equal(cleaned.voice2, undefined);
    assert.equal(cleaned.notes[0].lyric?.text, "小");
    assert.equal(scoreQuarters(cleaned), 1);
    assert.doesNotMatch(engraveAbc(cleaned).abc, /V:1/);
  });
});

describe("two rhythmic voices", () => {
  const upper = [n(60), n(62), n(64), n(65)];
  const lower = [n(48, 2), n([53, 57], 2)];
  const score = asScore(upper, {
    voice2: lower,
    notes: upper.map((note, index) =>
      index === 0 ? { ...note, lyric: { text: "上", syllabic: "single" } } : note,
    ),
  });

  it("aligns four quarters over two halves without writing padding into the notes", () => {
    assert.deepEqual(pitches(score.notes), [[60], [62], [64], [65]]);
    assert.deepEqual(
      score.voice2?.map((note) => note.dur),
      [2, 2],
    );
    const engraved = engraveAbc(score);
    assert.match(engraved.abc, /V:1 clef=treble/);
    assert.match(engraved.abc, /V:2 clef=bass/);
    const voice1 = engraved.hits.filter((hit) => hit.voice !== 1);
    const voice2 = engraved.hits.filter((hit) => hit.voice === 1);
    assert.deepEqual(
      voice1.map((hit) => hit.index),
      [0, 1, 2, 3],
    );
    assert.deepEqual(
      voice2.map((hit) => hit.index),
      [0, 1],
    );
    const plan = playbackPlan(score);
    assert.equal(plan.quarters, 4);
    assert.deepEqual(followSlotsAt(plan.events, 0), [
      { voice: 0, note: 0 },
      { voice: 1, note: 0 },
    ]);
    assert.deepEqual(followSlotsAt(plan.events, 1), [
      { voice: 0, note: 1 },
      { voice: 1, note: 0 },
    ]);
    assert.deepEqual(followSlotsAt(plan.events, 2), [
      { voice: 0, note: 2 },
      { voice: 1, note: 1 },
    ]);
    assert.equal(followNoteAt(plan.events, 1), 1);
    const clicks = scheduleBeats({ bpm: 120, beats: 4, beatUnit: 4, quarters: 4 });
    assert.deepEqual(plan.clicks, clicks);
    assert.equal(plan.clicks.length, 4);
  });

  it("pads a short voice with silence and keeps its source notes", () => {
    const short = asScore(upper, { voice2: [n(48, 1)] });
    assert.equal(short.voice2?.length, 1);
    assert.equal(scoreQuarters(short), 4);
    const plan = playbackPlan(short);
    assert.equal(plan.clicks.length, 4);
    assert.deepEqual(followSlotsAt(plan.events, 0), [
      { voice: 0, note: 0 },
      { voice: 1, note: 0 },
    ]);
    assert.deepEqual(followSlotsAt(plan.events, 1.2), [{ voice: 0, note: 1 }]);
    const engraved = engraveAbc(short);
    const lower = engraved.abc.split("V:2")[1] ?? "";
    assert.match(lower, /z/);
    assert.equal(engraveAbc(short).hits.filter((hit) => hit.voice === 1).length, 1);
    assert.deepEqual(short.voice2, [n(48, 1)]);
  });

  it("edits one voice and leaves the other, including lyric fragments", () => {
    const fragment = {
      text: "上",
      syllabic: "begin" as const,
      extend: true,
      extendType: "start" as const,
      fragments: [{ at: 0.5, dur: 0.5, extendType: "stop" as const }],
      extendEnd: "stop" as const,
      extendEndAt: 0.5,
      extendEndDur: 0.5,
    };
    const original = asScore([n(60, 1, { lyric: fragment })], {
      voice2: [n(48, 1, { lyric: { text: "下", syllabic: "single" }, dynamic: "p" })],
    });
    const edited = replaceVoice(original, 0, [n(67, 1), n(69, 1)]);
    assert.equal(edited.voice2?.[0].lyric?.text, "下");
    assert.equal(edited.voice2?.[0].dynamic, "p");
    assert.deepEqual(edited.notes[0].lyric, undefined);
    const cleared = replaceVoice(edited, 1, []);
    assert.equal(cleared.voice2?.length, 0);
    assert.equal(cleared.notes.length, 2);
    const removed = removeSecondVoice(cleared);
    assert.equal(removed.voice2, undefined);
    assert.equal(addSecondVoice(removed).voice2?.length, 0);
    const again = addSecondVoice(original);
    assert.equal(again, original);
  });

  it("transposes both voices and keeps each lyric on its own note", () => {
    const moved = transposeScore(score, 2);
    assert.equal(moved.notes[0].pitches[0], 62);
    assert.equal(moved.notes[0].lyric?.text, "上");
    assert.equal(moved.voice2?.[0].pitches[0], 50);
    assert.equal(moved.voice2?.[1].pitches[0], 55);
    const arranged = arrangeScore(
      asScore([n(60, 1, { lyric: { text: "留", syllabic: "single" } }), n(64)], {
        voice2: [n(60), n(67)],
      }),
      "lyrical",
      1,
    );
    assert.equal(arranged.notes[0].lyric?.text, "留");
    assert.equal(arranged.notes.length, 2);
    assert.ok((arranged.voice2?.length ?? 0) > 2);
  });

  it("plays concert pitch while the staff shows the instrument's written pitch", () => {
    const duo = asScore([n(60)], { voice2: [n(67, 1)] });
    const written = engraveAbc(duo, 2).abc.split("V:2")[1] ?? "";
    assert.match(written, /A/i);
    assert.equal(soundingEvents(duo).find((event) => event.voice === 1)?.midi, 67);
    const target = staffTargetAt(engraveAbc(duo).hits, 0, 0);
    assert.equal(target, null);
  });
});

describe("MusicXML voices", () => {
  it("round-trips two voices, a chord, and a lyric fragment without flattening", () => {
    const score = asScore(
      [
        n(60, 2, {
          lyric: {
            text: "和",
            syllabic: "single",
            extend: true,
            extendType: "start",
            fragments: [{ at: 1, dur: 1, extendType: "stop" }],
            extendEnd: "stop",
            extendEndAt: 1,
            extendEndDur: 1,
          },
        }),
        n(64),
        n(65),
      ],
      {
        voice2: [
          n([48, 55], 2, { lyric: { text: "下", syllabic: "single" } }),
          n(53, 2, { dynamic: "p" }),
        ],
      },
    );
    const xml = scoreToMusicXml(score);
    assert.match(xml, /<voice>1<\/voice>/);
    assert.match(xml, /<voice>2<\/voice>/);
    assert.match(xml, /<staff>1<\/staff>/);
    assert.match(xml, /<staff>2<\/staff>/);
    assert.match(xml, /<backup>/);
    assert.equal(xml.includes("<voice>3</voice>"), false);
    const back = musicXmlToScore(xml, "回");
    assert.deepEqual(
      back.score.notes.map((note) => note.pitches[0]),
      [60, 64, 65],
    );
    assert.equal(back.score.notes[0].dur, 2);
    assert.deepEqual(
      back.score.voice2?.map((note) => note.dur),
      [2, 2],
    );
    assert.deepEqual(back.score.voice2?.[0].pitches, [48, 55]);
    assert.equal(back.score.voice2?.[0].lyric?.text, "下");
    assert.equal(back.score.voice2?.[1].dynamic, "p");
    assert.equal(
      back.score.notes.some((note) => note.lyric?.text === "下"),
      false,
    );
    assert.equal(back.score.notes[0].lyric?.text, "和");
    assert.equal(back.score.notes[0].lyric?.extendType, "start");
    assert.equal(back.score.notes[0].lyric?.extendEnd, "stop");
    assert.equal(back.score.notes[0].lyric?.extendEndAt, 1);
    assert.equal(back.score.notes[1].lyric, undefined);
    assert.match(back.notice, /两个声部/);
    assert.doesNotMatch(back.notice, /其余声部/);
  });

  it("does not add a rest to the shorter voice on the way back", () => {
    const score = asScore([n(60), n(62), n(64), n(65)], { voice2: [n(48), n(50)] });
    const back = musicXmlToScore(scoreToMusicXml(score), "短");
    assert.equal(back.score.voice2?.length, 2);
    assert.deepEqual(
      back.score.voice2?.map((note) => note.dur),
      [1, 1],
    );
    assert.ok(back.score.voice2?.every((note) => note.pitches.length));
  });

  it("keeps all three independent timelines", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <score-partwise version="3.1">
        <part id="P1">
          <measure number="1">
            <attributes>
              <divisions>1</divisions>
              <key><fifths>0</fifths><mode>major</mode></key>
              <time><beats>4</beats><beat-type>4</beat-type></time>
            </attributes>
            <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice></note>
            <note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice></note>
            <backup><duration>2</duration></backup>
            <note><pitch><step>G</step><octave>3</octave></pitch><duration>2</duration><voice>2</voice></note>
            <backup><duration>2</duration></backup>
            <note><pitch><step>E</step><octave>3</octave></pitch><duration>2</duration><voice>3</voice></note>
          </measure>
        </part>
      </score-partwise>`;
    const imported = musicXmlToScore(xml, "三");
    assert.deepEqual(
      imported.score.notes.map((note) => note.pitches[0]),
      [60, 62],
    );
    assert.deepEqual(imported.score.voice2?.[0].pitches, [55]);
    assert.equal(imported.score.voice2?.[0].dur, 2);
    assert.equal(
      [...imported.score.notes, ...(imported.score.voice2 ?? [])].some((note) =>
        note.pitches.includes(52),
      ),
      false,
    );
    assert.deepEqual(imported.score.extraVoices?.[0], [{ pitches: [52], dur: 2 }]);
    assert.match(imported.notice, /3 个声部都留下/);
  });
});

describe("MIDI voices", () => {
  it("writes two tracks that start together and still imports one track at a time", () => {
    const score = asScore([n(60), n(62), n(64), n(65)], { voice2: [n(48, 2), n(53, 2)] });
    const bytes = scoreToMidi(score);
    assert.equal(bytes[9], 1);
    assert.equal(bytes[11], 2);
    const voices = listMidiVoices(bytes);
    assert.equal(voices.length, 2);
    assert.notEqual(voices[0].track, voices[1].track);
    const upper = midiToScore(bytes, "上", voices[0]);
    const lower = midiToScore(bytes, "下", voices[1]);
    assert.deepEqual(
      upper.notes.map((note) => note.pitches[0]),
      [60, 62, 64, 65],
    );
    assert.deepEqual(
      lower.notes.map((note) => [note.pitches[0], note.dur]),
      [
        [48, 2],
        [53, 2],
      ],
    );
    const single = scoreToMidi(asScore([n(60)]));
    assert.equal(single[9], 0);
    assert.equal(single[11], 1);
    assert.equal(cleanNote(n(60)).pitches[0], 60);
  });

  it("keeps a rest-only second voice as its own track through the written length", () => {
    const quarterAndWhole = asScore([n(60, 1)], { voice2: [n(-1, 4)] });
    const both = midiFile(scoreToMidi(quarterAndWhole));
    assert.equal(both.format, 1);
    assert.equal(both.tracks, 2);
    assert.equal(both.division, 480);
    assert.deepEqual(both.ends, [480, 1920]);

    const trailing = asScore([n(60, 1)], { voice2: [n(48, 1), n(-1, 3)] });
    const restAfter = midiFile(scoreToMidi(trailing));
    assert.equal(restAfter.format, 1);
    assert.deepEqual(restAfter.ends, [480, 1920]);

    const onlyFirst = midiFile(scoreToMidi(asScore([n(60, 1), n(-1, 3)])));
    assert.equal(onlyFirst.format, 0);
    assert.equal(onlyFirst.tracks, 1);
    assert.deepEqual(onlyFirst.ends, [1920]);

    const absent = midiFile(scoreToMidi(asScore([n(60, 1)])));
    assert.equal(absent.format, 0);
    assert.equal(absent.tracks, 1);
    assert.deepEqual(absent.ends, [480]);
    const empty = midiFile(scoreToMidi(asScore([n(60, 1)], { voice2: [] })));
    assert.equal(empty.format, 0);
    assert.equal(empty.tracks, 1);
    assert.deepEqual(empty.ends, [480]);
  });
});

function readVar(data: Uint8Array, offset: number): { value: number; offset: number } {
  let value = 0;
  let byte = 0;
  do {
    byte = data[offset];
    offset += 1;
    value = (value << 7) | (byte & 0x7f);
  } while (byte & 0x80);
  return { value, offset };
}

function midiFile(bytes: Uint8Array): {
  format: number;
  tracks: number;
  division: number;
  ends: number[];
} {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const format = view.getUint16(8);
  const tracks = view.getUint16(10);
  const division = view.getUint16(12);
  let offset = 14;
  const ends: number[] = [];
  for (let track = 0; track < tracks; track += 1) {
    const length = view.getUint32(offset + 4);
    offset += 8;
    const stop = offset + length;
    let tick = 0;
    let status = 0;
    let endTick = 0;
    while (offset < stop) {
      const delta = readVar(bytes, offset);
      offset = delta.offset;
      tick += delta.value;
      const byte = bytes[offset] ?? 0;
      if (byte === 0xff) {
        const type = bytes[offset + 1];
        offset += 2;
        const size = readVar(bytes, offset);
        offset = size.offset + size.value;
        if (type === 0x2f) endTick = tick;
        continue;
      }
      if (byte === 0xf0 || byte === 0xf7) {
        offset += 1;
        const size = readVar(bytes, offset);
        offset = size.offset + size.value;
        continue;
      }
      if (byte >= 0x80) {
        status = byte;
        offset += 1;
      }
      const kind = status & 0xf0;
      offset += kind === 0xc0 || kind === 0xd0 ? 1 : 2;
    }
    ends.push(endTick);
  }
  return { format, tracks, division, ends };
}

const NOTE_MODEL = [
  "grace",
  "cue",
  "chord",
  "pitch",
  "unpitched",
  "rest",
  "duration",
  "tie",
  "instrument",
  "footnote",
  "level",
  "voice",
  "type",
  "dot",
  "accidental",
  "time-modification",
  "stem",
  "notehead",
  "notehead-text",
  "staff",
  "beam",
  "notations",
  "lyric",
  "play",
];

function noteChildNames(xml: string): string[][] {
  const notes: string[][] = [];
  let current: string[] | null = null;
  for (const line of xml.split("\n")) {
    if (line === "      <note>") {
      current = [];
      notes.push(current);
      continue;
    }
    if (line === "      </note>") {
      current = null;
      continue;
    }
    if (!current) continue;
    const child = line.match(/^ {8}<([a-z0-9-]+)/);
    if (child) current.push(child[1]);
  }
  return notes;
}

function assertNoteContentOrder(xml: string) {
  const notes = noteChildNames(xml);
  assert.ok(notes.length > 0);
  const repeatable = new Set(["tie", "dot", "beam", "notations", "lyric"]);
  for (const children of notes) {
    let last = -1;
    assert.ok(children.includes("voice"));
    if (children.includes("staff")) {
      assert.ok(children.indexOf("staff") > children.indexOf("type"));
      if (children.includes("dot"))
        assert.ok(children.indexOf("staff") > children.lastIndexOf("dot"));
      if (children.includes("time-modification")) {
        assert.ok(children.indexOf("staff") > children.indexOf("time-modification"));
      }
    }
    for (const name of children) {
      const at = NOTE_MODEL.indexOf(name);
      assert.ok(at >= 0, name);
      assert.ok(at > last || (at === last && repeatable.has(name)), children.join(" "));
      last = at;
    }
  }
}

describe("rest-only second voice", () => {
  it("keeps an explicit whole rest in voice 2 and does not invent a voice from a direction", () => {
    const score = asScore([n(60, 1)], { voice2: [n(-1, 4)] });
    const xml = scoreToMusicXml(score);
    assert.match(xml, /<voice>2<\/voice>/);
    assert.match(xml, /<rest\/>/);
    const back = musicXmlToScore(xml, "休");
    assert.deepEqual(back.score.notes[0].pitches, [60]);
    assert.equal(back.score.notes[0].dur, 1);
    assert.equal(back.score.voice2?.length, 1);
    assert.deepEqual(back.score.voice2?.[0].pitches, []);
    assert.equal(back.score.voice2?.[0].dur, 4);

    const reversed = asScore([n(-1, 4)], { voice2: [n(60, 4)] });
    const reversedXml = scoreToMusicXml(reversed);
    assert.match(reversedXml, /<voice>1<\/voice>[\s\S]*<staff>1<\/staff>/);
    assert.match(reversedXml, /<voice>2<\/voice>[\s\S]*<staff>2<\/staff>/);
    const swapped = musicXmlToScore(reversedXml, "换");
    assert.deepEqual(swapped.score.notes[0].pitches, []);
    assert.equal(swapped.score.notes[0].dur, 4);
    assert.deepEqual(swapped.score.voice2?.[0].pitches, [60]);
    assert.equal(swapped.score.voice2?.[0].dur, 4);

    const leading = asScore([n(-1, 1), n(62, 1)], { voice2: [n(60, 2)] });
    const led = musicXmlToScore(scoreToMusicXml(leading), "先休");
    assert.deepEqual(
      led.score.notes.map((note) => note.pitches),
      [[], [62]],
    );
    assert.deepEqual(
      led.score.notes.map((note) => note.dur),
      [1, 1],
    );
    assert.deepEqual(led.score.voice2?.[0].pitches, [60]);
    assert.equal(led.score.voice2?.[0].dur, 2);

    const empty = asScore([n(60)], { voice2: [] });
    const omitted = scoreToMusicXml(empty);
    assert.equal(omitted.includes("<voice>2</voice>"), false);
    assert.equal(musicXmlToScore(omitted, "空").score.voice2, undefined);
    assert.equal(musicXmlToScore(scoreToMusicXml(asScore([n(60)])), "单").score.voice2, undefined);

    const silentFirst = `<?xml version="1.0" encoding="UTF-8"?>
      <score-partwise version="3.1">
        <part id="P1">
          <measure number="1">
            <attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
            <note><rest/><duration>4</duration><voice>1</voice></note>
          </measure>
        </part>
        <part id="P2">
          <measure number="1">
            <attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
            <note><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice></note>
          </measure>
        </part>
      </score-partwise>`;
    const melodyPart = musicXmlToScore(silentFirst, "后一行");
    assert.deepEqual(melodyPart.score.notes[0].pitches, [64]);
    assert.equal(melodyPart.score.notes[0].dur, 1);
    assert.equal(melodyPart.score.voice2, undefined);
    assert.doesNotMatch(melodyPart.notice, /两个声部/);

    const extraPart = `<?xml version="1.0" encoding="UTF-8"?>
      <score-partwise version="3.1">
        <part id="P1">
          <measure number="1">
            <attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
            <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><staff>1</staff></note>
            <backup><duration>1</duration></backup>
            <note><rest/><duration>4</duration><voice>2</voice><staff>2</staff></note>
          </measure>
        </part>
        <part id="P2">
          <measure number="1">
            <attributes><divisions>1</divisions></attributes>
            <note><pitch><step>G</step><octave>3</octave></pitch><duration>1</duration></note>
          </measure>
        </part>
      </score-partwise>`;
    const keptPart = musicXmlToScore(extraPart, "另部");
    assert.deepEqual(keptPart.score.notes[0].pitches, [60]);
    assert.deepEqual(keptPart.score.voice2?.[0].pitches, []);
    assert.equal(keptPart.score.voice2?.[0].dur, 4);
    assert.equal(
      [...keptPart.score.notes, ...(keptPart.score.voice2 ?? [])].some((note) =>
        note.pitches.includes(55),
      ),
      false,
    );
    assert.match(keptPart.notice, /其余声部/);

    const directionOnly = `<?xml version="1.0" encoding="UTF-8"?>
      <score-partwise version="3.1">
        <part id="P1">
          <measure number="1">
            <attributes>
              <divisions>1</divisions>
              <key><fifths>0</fifths></key>
              <time><beats>4</beats><beat-type>4</beat-type></time>
            </attributes>
            <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><staff>1</staff></note>
            <direction>
              <direction-type><dynamics><p/></dynamics></direction-type>
              <voice>2</voice>
              <staff>2</staff>
            </direction>
            <forward><duration>1</duration></forward>
          </measure>
        </part>
      </score-partwise>`;
    const kept = musicXmlToScore(directionOnly, "方向");
    assert.equal(kept.score.voice2, undefined);
    assert.equal(kept.score.notes[0].dynamic, undefined);
    assert.doesNotMatch(kept.notice, /两个声部/);
  });
});

describe("MusicXML note order", () => {
  it("writes staff after duration children and validates against the MusicXML 3.1 schema", () => {
    const score = asScore(
      [
        n([60, 64], 1, {
          lyric: { text: "和", syllabic: "single" },
          slurStart: true,
          ornament: "grace",
          gracePitch: 62,
        }),
        n(62, 1.5, { slurEnd: true }),
        n(64, 1 / 3),
        n(65, 1 / 3),
        n(67, 1 / 3),
      ],
      { voice2: [n(-1, 4)] },
    );
    const xml = scoreToMusicXml(score);
    assertNoteContentOrder(xml);
    const grace = xml.slice(xml.indexOf("<grace"), xml.indexOf("</note>", xml.indexOf("<grace")));
    assert.ok(grace.indexOf("<voice>") < grace.indexOf("<type>"));
    assert.ok(grace.indexOf("<type>") < grace.indexOf("<staff>"));
    assert.equal(grace.includes("<duration>"), false);
    const schema = fileURLToPath(new URL("./fixtures/musicxml-3.1/musicxml.xsd", import.meta.url));
    const dir = mkdtempSync(join(tmpdir(), "puxian-xml-"));
    const file = join(dir, "score.musicxml");
    writeFileSync(file, xml);
    const result = spawnSync("xmllint", ["--nonet", "--noout", "--schema", schema, file], {
      encoding: "utf8",
    });
    assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
  });
});

describe("three and more independent voices", () => {
  const make = (): Score => asScore([n(72,1),n([74,77],1),n(-1,1),n(76,1)], {
    voice2: [n(48,2),n(50,2)],
    extraVoices: [[n(-1,0.5),n(60,0.5),n(62,3)], [n(55,4)]],
    changes: [{ at: 2, bpm: 90, key: "G", mode: "major" }],
  });
  it("edits voice three without changing other voices and removes only the chosen voice", async () => {
    const { voiceList, addVoice, removeVoice, replaceVoiceAndRemap, isVoiceId, MAX_VOICES } = await import("./voices.ts");
    const source = make(); const before = JSON.stringify(source);
    const edited = replaceVoiceAndRemap(source,2,[n(65,2)]);
    assert.equal(edited.notes,source.notes); assert.equal(edited.voice2,source.voice2);
    assert.equal(edited.extraVoices?.[1],source.extraVoices?.[1]);
    assert.equal(edited.changes,source.changes);
    assert.deepEqual(voiceList(removeVoice(edited,2)),[source.notes,source.voice2,source.extraVoices![1]]);
    assert.equal(voiceList(addVoice(source)).length,5); assert.equal(JSON.stringify(source),before);
    assert.ok(isVoiceId(2)); assert.ok(!isVoiceId(0.5)); assert.ok(!isVoiceId(MAX_VOICES));
  });
  it("engraves and follows voice three and four independently", async () => {
    const { scoreToJianpu } = await import("./jianpu-render.ts");
    const score = make(); const plan = playbackPlan(score);
    assert.equal(plan.quarters,4);
    assert.deepEqual(followSlotsAt(plan.events,0.75).map(s=>s.voice),[0,1,2,3]);
    assert.equal(scoreToJianpu(score).length,4);
    const staff = engraveAbc(score);
    assert.match(staff.abc,/V:4/);
    const hit = staff.hits.find(h=>h.voice === 2)!;
    assert.equal(staffTargetAt(staff.hits,hit.start,hit.end)?.voice,2);
    const up = transposeScore(score,2);
    assert.deepEqual(up.extraVoices?.[1]?.[0]?.pitches,[57]);
  });
  it("round trips four voices through MusicXML without flattening independent rhythms", () => {
    const score = make();
    const xml = scoreToMusicXml(score);
    assert.match(xml,/<staves>4<\/staves>/);
    const back = musicXmlToScore(xml,"fallback");
    assert.deepEqual(back.score.notes,score.notes);
    assert.deepEqual(back.score.voice2,score.voice2);
    assert.deepEqual(back.score.extraVoices,score.extraVoices);
    assert.deepEqual(back.score.changes,score.changes);
    assert.deepEqual(back.losses,[]);
  });
  it("round trips four voices, short notes, rests and a chord through strict MIDI import", async () => {
    const { previewMidiVoices } = await import("./midi.ts");
    const score = make();
    const bytes = scoreToMidi(score);
    assert.equal(listMidiVoices(bytes).length,4);
    const back = previewMidiVoices(bytes,"fallback").score;
    assert.deepEqual(back.notes,score.notes); assert.deepEqual(back.voice2,score.voice2);
    assert.deepEqual(back.extraVoices,score.extraVoices);
    assert.deepEqual(back.changes,score.changes);
    assert.throws(()=>previewMidiVoices(bytes.slice(0,-1),"broken"));
  });
  it("keeps all sixteen voices off the drum channel, including an empty third and trailing silence", async () => {
    const { addVoice, replaceVoice, voiceList } = await import("./voices.ts");
    const { previewMidiVoices } = await import("./midi.ts");
    let score = asScore([n(72,4)]);
    for(let i=1;i<16;i++) score = replaceVoice(addVoice(score),i,i===2 ? [] : [n(40+i,2),n(-1,2)]);
    const bytes = scoreToMidi(score);
    assert.equal(listMidiVoices(bytes).length,15);
    assert.ok(listMidiVoices(bytes).every(v=>v.channel !== 9));
    const back = previewMidiVoices(bytes,"fallback").score;
    assert.deepEqual(voiceList(back),voiceList(score));
  });
  it("cleans, validates, shares and restores lyrics on the fourth voice", async () => {
    const { isScore } = await import("./score-storage.ts");
    const { encodeSharePayload, decodeSharePayload } = await import("./share-link.ts");
    const score = make(); score.extraVoices![1]![0]!.lyric = {text:"四",syllabic:"single"};
    const cleaned = cleanScore(score);
    assert.ok(isScore(cleaned)); assert.deepEqual(decodeSharePayload(encodeSharePayload(cleaned)),cleaned);
    assert.ok(!isScore({...score,extraVoices:[null]}));
    assert.ok(!isScore({...score,extraVoices:Array(15).fill([])}));
    assert.ok(!isScore({...score,voice2:undefined}));
  });
  it("checks duration and range on the last voice and includes it in piano roll and tab export", async () => {
    const { checkScoreBars } = await import("./bar-check.ts");
    const { pianoRollOf } = await import("./piano-roll.ts");
    const { scoreToMusicXmlTab } = await import("./tab-musicxml.ts");
    const score = make(); score.extraVoices![1] = [n(43,1)];
    assert.ok(checkScoreBars(score).some(i=>i.voice === 3));
    assert.ok(pianoRollOf(score).rects.some(r=>r.voice === 3));
    assert.match(scoreToMusicXmlTab(score).xml,/<voice>4<\/voice>/);
  });
});

it("MusicXML preserves declared empty voices between and after pitched voices", async () => {
  const { voiceList } = await import("./voices.ts");
  const score = asScore([], { voice2: [n(48,4)], extraVoices: [[],[n(67,4)],[]] });
  const result = musicXmlToScore(scoreToMusicXml(score),"empty slots").score;
  assert.deepEqual(voiceList(result),voiceList(score));
});
it("MIDI preserves non-binary durations in later voices using exact PPQ", async () => {
  const { previewMidiVoices } = await import("./midi.ts");
  const score = asScore([n(72,1)],{voice2:[n(48,1)],extraVoices:[[n(60,1/7),n(62,6/7)]]});
  const back = previewMidiVoices(scoreToMidi(score),"septuplet").score;
  assert.deepEqual(back.extraVoices,score.extraVoices);
});
