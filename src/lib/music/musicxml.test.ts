import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { arrangeScore } from "./arrange.ts";
import { EXAMPLES, scoreFromExample } from "./examples.ts";
import { musicXmlToScore, scoreToMusicXml } from "./musicxml.ts";
import { parseJianpu } from "./notation.ts";
import { KEY_NAMES, tonicMidi, type Score, type ScoreNote } from "./theory.ts";
import { canonicalChanges } from "./score-timeline.ts";
import { canonicalFermatas } from "./fermata.ts";
import {
  canonicalGradualTempos,
  resolveGradualTarget,
  type ScoreWithGradual,
} from "./gradual-tempo.ts";
import { loadExampleScore } from "./examples-load.ts";

function asScore(notes: ScoreNote[], extra: Partial<ScoreWithGradual> = {}): ScoreWithGradual {
  return {
    title: "试",
    bpm: 96,
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

function sameNotes(a: ScoreNote[], b: ScoreNote[]) {
  assert.equal(a.length, b.length);
  for (let i = 0; i < a.length; i += 1) {
    assert.deepEqual(a[i].pitches, b[i].pitches, `pitch ${i}`);
    assert.ok(Math.abs(a[i].dur - b[i].dur) < 1e-9, `dur ${i}: ${a[i].dur} vs ${b[i].dur}`);
  }
}

function durationOf(notes: ScoreNote[]) {
  return notes.reduce((sum, note) => sum + note.dur, 0);
}

function roundTrip(score: Score) {
  return musicXmlToScore(scoreToMusicXml(score), "fallback").score;
}

describe("musicxml", () => {
  it("round-trips 小星星 with key, meter, tempo, title, and total length", () => {
    const score = scoreFromExample(EXAMPLES[0]);
    assert.equal(score.title, "小星星");
    const xml = scoreToMusicXml(score);
    assert.equal(xml.includes("<transpose>"), false);
    assert.match(xml, /<step>C<\/step>\s*<octave>4<\/octave>/);
    assert.match(xml, /<fifths>0<\/fifths>/);
    assert.match(xml, /<beats>4<\/beats>\s*<beat-type>4<\/beat-type>/);
    assert.match(xml, /tempo="88"/);

    const back = musicXmlToScore(xml, "fallback").score;
    assert.equal(back.title, "小星星");
    assert.equal(back.key, "C");
    assert.equal(back.mode, "major");
    assert.equal(back.beats, 4);
    assert.equal(back.beatUnit, 4);
    assert.equal(back.bpm, 88);
    assert.equal(back.clef, "treble");
    sameNotes(score.notes, back.notes);
    assert.ok(Math.abs(durationOf(score.notes) - durationOf(back.notes)) < 1e-9);
  });

  it("does not write a metronome mark when the source has no tempo", () => {
    const score = asScore([{ pitches: [60], dur: 1 }], { tempoMarked: false, bpm: 96 });
    const xml = scoreToMusicXml(score);
    assert.equal(xml.includes("<per-minute>"), false);
    assert.equal(xml.includes("sound tempo"), false);
    const marked = scoreToMusicXml(asScore([{ pitches: [60], dur: 1 }]));
    assert.match(marked, /tempo="96"/);
  });

  it("round-trips every built-in tune, including flats and a dotted rhythm", () => {
    for (const example of EXAMPLES) {
      const score = scoreFromExample(example);
      const back = roundTrip(score);
      assert.equal(back.title, score.title, example.id);
      assert.equal(back.key, score.key, example.id);
      assert.equal(back.mode, score.mode, example.id);
      assert.equal(back.beats, score.beats, example.id);
      assert.equal(back.beatUnit, score.beatUnit, example.id);
      assert.equal(back.bpm, score.bpm, example.id);
      sameNotes(score.notes, back.notes);
      assert.ok(Math.abs(durationOf(score.notes) - durationOf(back.notes)) < 1e-9);
    }
  });

  it("round-trips a lively arrangement and a playful arrangement of 小星星", () => {
    const score = scoreFromExample(EXAMPLES[0]);
    for (const style of ["lively", "playful"] as const) {
      const arranged = arrangeScore(score, style);
      assert.notEqual(arranged.notes.length, score.notes.length, style);
      const back = roundTrip(arranged);
      assert.equal(back.key, arranged.key, style);
      assert.equal(back.beats, arranged.beats, style);
      assert.equal(back.beatUnit, arranged.beatUnit, style);
      assert.equal(back.bpm, arranged.bpm, style);
      sameNotes(arranged.notes, back.notes);
      assert.ok(Math.abs(durationOf(arranged.notes) - durationOf(back.notes)) < 1e-9, style);
    }
  });

  it("round-trips a chord, a rest, a bass clef, and a note tied across a bar", () => {
    const chord = asScore(
      [
        { pitches: [60, 64, 67], dur: 1 },
        { pitches: [], dur: 1 },
        { pitches: [62], dur: 2 },
      ],
      { clef: "bass", title: "和弦" },
    );
    const back = roundTrip(chord);
    assert.equal(back.clef, "bass");
    sameNotes(chord.notes, back.notes);

    const tied = asScore([{ pitches: [60], dur: 5 }], { title: "跨小节" });
    const xml = scoreToMusicXml(tied);
    assert.match(xml, /<tie type="start"\/>/);
    sameNotes(tied.notes, roundTrip(tied).notes);
  });

  it("round-trips every key and mode at sounding pitch", () => {
    for (const key of KEY_NAMES) {
      for (const mode of ["major", "minor"] as const) {
        const midi = tonicMidi(key, 4);
        const score = asScore([{ pitches: [midi], dur: 1 }], {
          key,
          mode,
          title: `${key} ${mode}`,
        });
        const back = roundTrip(score);
        assert.equal(back.key, key, `${key} ${mode}`);
        assert.equal(back.mode, mode, `${key} ${mode}`);
        assert.equal(back.notes[0].pitches[0], midi, `${key} ${mode}`);
      }
    }
  });

  it("round-trips a jianpu triplet as sounding eighths", () => {
    const parsed = parseJianpu("123", {
      key: "C",
      mode: "major",
      tonicOctave: 4,
      beats: 4,
      beatUnit: 4,
    });
    assert.equal(parsed.error, null);
    const score = asScore(parsed.notes, { title: "三连音" });
    assert.equal(score.notes.length, 3);
    assert.ok(score.notes.every((note) => Math.abs(note.dur - 1 / 3) < 1e-9));
    const xml = scoreToMusicXml(score);
    assert.match(xml, /<actual-notes>3<\/actual-notes>/);
    sameNotes(score.notes, musicXmlToScore(xml, "fallback").score.notes);
  });

  it("keeps 6/8 eighths and escapes the title", () => {
    const score = asScore(
      [
        { pitches: [60], dur: 0.5 },
        { pitches: [62], dur: 0.5 },
        { pitches: [64], dur: 0.5 },
      ],
      { beats: 6, beatUnit: 8, bpm: 120, title: "A & B" },
    );
    const xml = scoreToMusicXml(score);
    assert.match(xml, /A &amp; B/);
    const back = musicXmlToScore(xml, "fallback").score;
    assert.equal(back.title, "A & B");
    assert.equal(back.beats, 6);
    assert.equal(back.beatUnit, 8);
    assert.equal(back.bpm, 120);
    sameNotes(score.notes, back.notes);
  });

  it("reads a MuseScore-like part and ignores a commented-out note", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <score-partwise version="3.1" xmlns="http://www.musicxml.org/ns/musicxml">
        <work><work-title>片段</work-title></work>
        <part-list><score-part id="P1"><part-name>旋律</part-name></score-part></part-list>
        <part id="P1">
          <measure number="1">
            <attributes>
              <divisions>1</divisions>
              <key><fifths>-1</fifths><mode>major</mode></key>
              <time><beats>4</beats><beat-type>4</beat-type></time>
              <clef><sign>G</sign><line>2</line></clef>
            </attributes>
            <sound tempo="100"/>
            <!-- <note><pitch><step>B</step><octave>2</octave></pitch><duration>1</duration></note> -->
            <note>
              <pitch><step>F</step><octave>4</octave></pitch>
              <duration>4</duration>
              <type>whole</type>
            </note>
          </measure>
          <measure number="2">
            <note><pitch><step>G</step><octave>4</octave></pitch><duration>1</duration></note>
            <note>
              <pitch><step>A</step><alter>-1</alter><octave>4</octave></pitch>
              <duration>1</duration>
              <type>quarter</type>
            </note>
          </measure>
        </part>
      </score-partwise>`;
    const imported = musicXmlToScore(xml, "fallback");
    assert.equal(imported.score.title, "片段");
    assert.equal(imported.score.key, "F");
    assert.equal(imported.score.bpm, 100);
    assert.deepEqual(
      imported.score.notes.map((note) => note.pitches[0]),
      [65, 67, 68],
    );
    assert.deepEqual(
      imported.score.notes.map((note) => note.dur),
      [4, 1, 1],
    );
    assert.match(imported.notice, /实际音高/);
    assert.doesNotMatch(imported.notice, /其余声部/);
  });

  it("keeps a leading rest timeline ahead of a later pitched staff", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <score-partwise version="3.1">
        <part id="P1">
          <measure number="1">
            <attributes>
              <divisions>1</divisions>
              <key number="1"><fifths>0</fifths><mode>major</mode></key>
              <key number="2"><fifths>1</fifths><mode>major</mode></key>
              <time><beats>4</beats><beat-type>4</beat-type></time>
              <staves>2</staves>
              <clef number="1"><sign>G</sign><line>2</line></clef>
              <clef number="2"><sign>G</sign><line>2</line></clef>
              <transpose number="1"><diatonic>0</diatonic><chromatic>0</chromatic></transpose>
              <transpose number="2"><diatonic>-1</diatonic><chromatic>-2</chromatic></transpose>
            </attributes>
            <note>
              <rest/>
              <duration>1</duration>
              <staff>1</staff>
              <voice>1</voice>
            </note>
            <backup><duration>1</duration></backup>
            <note>
              <pitch><step>A</step><octave>4</octave></pitch>
              <duration>1</duration>
              <staff>2</staff>
              <voice>1</voice>
            </note>
          </measure>
        </part>
      </score-partwise>`;
    const imported = musicXmlToScore(xml, "双谱表");
    assert.equal(imported.score.key, "C");
    sameNotes(imported.score.notes, [{ pitches: [], dur: 1 }]);
    sameNotes(imported.score.voice2 ?? [], [{ pitches: [67], dur: 1 }]);
    assert.doesNotMatch(imported.notice, /其余声部/);
  });

  it("does not apply another staff's transpose to the first melodic staff", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <score-partwise version="3.1">
        <part id="P1">
          <measure number="1">
            <attributes>
              <divisions>1</divisions>
              <key number="1"><fifths>0</fifths><mode>major</mode></key>
              <key number="2"><fifths>2</fifths><mode>major</mode></key>
              <time><beats>4</beats><beat-type>4</beat-type></time>
              <transpose number="1"><chromatic>0</chromatic></transpose>
              <transpose number="2"><chromatic>-2</chromatic></transpose>
            </attributes>
            <note>
              <pitch><step>C</step><octave>4</octave></pitch>
              <duration>1</duration>
              <staff>1</staff>
            </note>
            <backup><duration>1</duration></backup>
            <note>
              <pitch><step>D</step><octave>4</octave></pitch>
              <duration>1</duration>
              <staff>2</staff>
            </note>
          </measure>
        </part>
      </score-partwise>`;
    const imported = musicXmlToScore(xml, "主谱");
    assert.equal(imported.score.key, "C");
    sameNotes(imported.score.notes, [{ pitches: [60], dur: 1 }]);
    sameNotes(imported.score.voice2 ?? [], [{ pitches: [60], dur: 1 }]);
    assert.match(imported.notice, /两个声部/);
    assert.doesNotMatch(imported.notice, /其余声部/);
  });

  it("keeps a cue's time as a rest so the next note stays put", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <score-partwise version="3.1">
        <part id="P1">
          <measure number="1">
            <attributes>
              <divisions>1</divisions>
              <key><fifths>0</fifths><mode>major</mode></key>
              <time><beats>4</beats><beat-type>4</beat-type></time>
            </attributes>
            <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration></note>
            <note>
              <cue/>
              <pitch><step>E</step><octave>5</octave></pitch>
              <duration>1</duration>
              <type>quarter</type>
            </note>
            <note>
              <cue/>
              <chord/>
              <pitch><step>G</step><octave>5</octave></pitch>
              <duration>1</duration>
            </note>
            <note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration></note>
          </measure>
        </part>
      </score-partwise>`;
    const imported = musicXmlToScore(xml, "提示");
    sameNotes(imported.score.notes, [
      { pitches: [60], dur: 1 },
      { pitches: [], dur: 1 },
      { pitches: [62], dur: 1 },
    ]);
    assert.match(imported.notice, /提示音/);
    assert.match(imported.notice, /休止/);
  });

  it("does not spread one chord-tone tie across the whole chord", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <score-partwise version="3.1">
        <part id="P1">
          <measure number="1">
            <attributes>
              <divisions>1</divisions>
              <key><fifths>0</fifths></key>
              <time><beats>4</beats><beat-type>4</beat-type></time>
            </attributes>
            <note>
              <pitch><step>C</step><octave>4</octave></pitch>
              <duration>1</duration>
              <tie type="start"/>
            </note>
            <note>
              <chord/>
              <pitch><step>E</step><octave>4</octave></pitch>
              <duration>1</duration>
            </note>
            <note>
              <pitch><step>C</step><octave>4</octave></pitch>
              <duration>1</duration>
              <tie type="stop"/>
            </note>
            <note>
              <chord/>
              <pitch><step>E</step><octave>4</octave></pitch>
              <duration>1</duration>
            </note>
          </measure>
        </part>
      </score-partwise>`;
    const imported = musicXmlToScore(xml, "部分延音");
    sameNotes(imported.score.notes, [
      { pitches: [60, 64], dur: 1 },
      { pitches: [60, 64], dur: 1 },
    ]);
    assert.match(imported.notice, /延音/);
    assert.match(imported.notice, /和弦/);

    const tiedChord = asScore([{ pitches: [60, 64], dur: 5 }], { title: "和弦跨小节" });
    const back = roundTrip(tiedChord);
    sameNotes(tiedChord.notes, back.notes);
    assert.doesNotMatch(musicXmlToScore(scoreToMusicXml(tiedChord), "x").notice, /部分音/);
  });

  it("applies a written transpose to concert pitch, and leaves a concert score alone", () => {
    const written = `<?xml version="1.0" encoding="UTF-8"?>
      <score-partwise version="3.1">
        <work><work-title>单簧管</work-title></work>
        <part id="P1">
          <measure number="1">
            <attributes>
              <divisions>1</divisions>
              <key><fifths>2</fifths><mode>major</mode></key>
              <time><beats>4</beats><beat-type>4</beat-type></time>
              <transpose><diatonic>-1</diatonic><chromatic>-2</chromatic></transpose>
            </attributes>
            <sound tempo="80"/>
            <note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration></note>
          </measure>
        </part>
      </score-partwise>`;
    const clarinet = musicXmlToScore(written, "fallback");
    assert.equal(clarinet.score.key, "C");
    assert.equal(clarinet.score.notes[0].pitches[0], 60);
    assert.doesNotMatch(clarinet.notice, /中途移调/);

    const concert = written.replace(
      "<work><work-title>单簧管</work-title></work>",
      "<work><work-title>音乐会</work-title></work><concert-score/>",
    );
    const sounding = musicXmlToScore(concert, "fallback").score;
    assert.equal(sounding.key, "D");
    assert.equal(sounding.notes[0].pitches[0], 62);
  });

  it("keeps the opening concert key when a later transpose changes", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <score-partwise version="3.1">
        <part id="P1">
          <measure number="1">
            <attributes>
              <divisions>1</divisions>
              <key><fifths>2</fifths><mode>major</mode></key>
              <time><beats>4</beats><beat-type>4</beat-type></time>
              <transpose><diatonic>-1</diatonic><chromatic>-2</chromatic></transpose>
            </attributes>
            <note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration></note>
          </measure>
          <measure number="2">
            <attributes>
              <transpose><chromatic>0</chromatic></transpose>
            </attributes>
            <note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration></note>
          </measure>
        </part>
      </score-partwise>`;
    const imported = musicXmlToScore(xml, "中途移调");
    assert.equal(imported.score.key, "C");
    assert.equal(imported.score.mode, "major");
    assert.deepEqual(
      imported.score.notes.map((note) => note.pitches[0]),
      [60, 62],
    );
    assert.match(imported.notice, /中途移调/);
  });

  it("keeps the opening unnumbered key when a later numbered key appears", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <score-partwise version="3.1">
        <part id="P1">
          <measure number="1">
            <attributes>
              <divisions>1</divisions>
              <key><fifths>2</fifths><mode>major</mode></key>
              <time><beats>4</beats><beat-type>4</beat-type></time>
              <transpose><diatonic>-1</diatonic><chromatic>-2</chromatic></transpose>
            </attributes>
            <note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration></note>
          </measure>
          <measure number="2">
            <attributes>
              <key number="1"><fifths>4</fifths><mode>major</mode></key>
              <transpose number="1"><chromatic>0</chromatic></transpose>
            </attributes>
            <note>
              <pitch><step>E</step><octave>4</octave></pitch>
              <duration>1</duration>
              <staff>1</staff>
            </note>
          </measure>
        </part>
      </score-partwise>`;
    const imported = musicXmlToScore(xml, "调号切换");
    assert.equal(imported.score.key, "C");
    assert.equal(imported.score.mode, "major");
    assert.deepEqual(
      imported.score.notes.map((note) => note.pitches[0]),
      [60, 64],
    );
    assert.match(imported.notice, /中途调号/);
  });

  it("still reports a key change after a numbered key returns to the opening signature", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <score-partwise version="3.1">
        <part id="P1">
          <measure number="1">
            <attributes>
              <divisions>1</divisions>
              <key><fifths>2</fifths><mode>major</mode></key>
              <time><beats>1</beats><beat-type>4</beat-type></time>
              <transpose><chromatic>-2</chromatic></transpose>
            </attributes>
            <note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration></note>
          </measure>
          <measure number="2">
            <attributes>
              <key><fifths>4</fifths><mode>major</mode></key>
            </attributes>
            <note><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration></note>
          </measure>
          <measure number="3">
            <attributes>
              <key number="1"><fifths>2</fifths><mode>major</mode></key>
            </attributes>
            <note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration><staff>1</staff></note>
          </measure>
        </part>
      </score-partwise>`;
    const imported = musicXmlToScore(xml, "调号往返");
    assert.equal(imported.score.key, "C");
    assert.equal(imported.score.mode, "major");
    assert.deepEqual(
      imported.score.notes.map((note) => note.pitches[0]),
      [60, 62, 60],
    );
    assert.match(imported.notice, /中途调号/);
  });

  it("does not warn when a different staff's transpose changes later", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <score-partwise version="3.1">
        <part id="P1">
          <measure number="1">
            <attributes>
              <divisions>1</divisions>
              <key number="1"><fifths>2</fifths><mode>major</mode></key>
              <key number="2"><fifths>0</fifths><mode>major</mode></key>
              <time><beats>4</beats><beat-type>4</beat-type></time>
              <transpose number="1"><chromatic>-2</chromatic></transpose>
              <transpose number="2"><chromatic>0</chromatic></transpose>
            </attributes>
            <note>
              <pitch><step>D</step><octave>4</octave></pitch>
              <duration>1</duration>
              <staff>1</staff>
            </note>
          </measure>
          <measure number="2">
            <attributes>
              <transpose number="2"><chromatic>-5</chromatic></transpose>
            </attributes>
            <note>
              <pitch><step>C</step><octave>4</octave></pitch>
              <duration>1</duration>
              <staff>2</staff>
            </note>
          </measure>
        </part>
      </score-partwise>`;
    const imported = musicXmlToScore(xml, "另一谱");
    assert.equal(imported.score.key, "C");
    sameNotes(imported.score.notes, [{ pitches: [60], dur: 1 }]);
    assert.doesNotMatch(imported.notice, /中途移调/);
  });

  it("keeps the first melodic part of a two-staff file and says what was dropped", () => {
    const xml = readFileSync(
      fileURLToPath(new URL("./fixtures/two-voices.musicxml", import.meta.url)),
      "utf8",
    );
    const imported = musicXmlToScore(xml, "fallback");
    assert.equal(imported.score.title, "两行");
    assert.equal(imported.score.bpm, 90);
    assert.equal(imported.score.beats, 2);
    assert.equal(imported.score.beatUnit, 4);
    assert.equal(imported.score.key, "C");
    sameNotes(imported.score.notes, [
      { pitches: [60], dur: 1 },
      { pitches: [62, 65], dur: 0.5 },
      { pitches: [], dur: 0.5 },
    ]);
    assert.match(imported.notice, /主旋律/);
    assert.match(imported.notice, /其余声部/);
    assert.match(imported.notice, /反复/);
    assert.equal(imported.score.notes[0].lyric?.text, "闪");
    assert.doesNotMatch(imported.notice, /歌词/);
    assert.ok(!imported.score.notes.some((note) => note.pitches.includes(48)));
  });

  it("reads score-timewise and a metronome marked in half notes", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <score-timewise version="3.1">
        <work><work-title>横排</work-title></work>
        <part-list>
          <score-part id="P1"><part-name>旋律</part-name></score-part>
        </part-list>
        <measure number="1">
          <part id="P1">
            <attributes>
              <divisions>1</divisions>
              <key><fifths>0</fifths><mode>minor</mode></key>
              <time><beats>4</beats><beat-type>4</beat-type></time>
            </attributes>
            <direction>
              <direction-type>
                <metronome>
                  <beat-unit>half</beat-unit>
                  <per-minute>60</per-minute>
                </metronome>
              </direction-type>
            </direction>
            <note><pitch><step>A</step><octave>4</octave></pitch><duration>1</duration></note>
          </part>
        </measure>
      </score-timewise>`;
    const imported = musicXmlToScore(xml, "fallback").score;
    assert.equal(imported.title, "横排");
    assert.equal(imported.mode, "minor");
    assert.equal(imported.key, "A");
    assert.equal(imported.bpm, 120);
    assert.equal(imported.notes[0].pitches[0], 69);
  });

  it("round-trips dynamics, articulations, a slur, a trill, a grace note, and a hairpin", () => {
    const score = asScore([
      {
        pitches: [60],
        dur: 1,
        dynamic: "p" as const,
        articulations: ["staccato", "accent"] as const,
        slurStart: true,
      },
      { pitches: [62], dur: 1, ornament: "trill" as const, articulations: ["tenuto"] as const },
      {
        pitches: [64],
        dur: 5,
        slurEnd: true,
        ornament: "grace" as const,
        gracePitch: 65,
        hairpin: "cresc" as const,
      },
      { pitches: [67], dur: 1, hairpinEnd: true, dynamic: "f" as const },
    ]);
    const xml = scoreToMusicXml(score);
    assert.equal(xml.split("<p/>").length - 1, 1);
    assert.match(xml, /<staccato\/>/);
    assert.match(xml, /<accent\/>/);
    assert.match(xml, /<tenuto\/>/);
    assert.match(xml, /<trill-mark\/>/);
    assert.match(xml, /<grace slash="yes"\/>/);
    assert.match(xml, /<slur type="start" number="1"\/>/);
    assert.match(xml, /<slur type="stop" number="1"\/>/);
    assert.match(xml, /<wedge type="crescendo"\/>/);
    assert.match(xml, /<wedge type="stop"\/>/);
    const back = musicXmlToScore(xml, "fallback");
    assert.doesNotMatch(back.notice, /力度/);
    assert.doesNotMatch(back.notice, /装饰音/);
    score.notes.forEach((note, index) => {
      assert.equal(back.score.notes[index].dynamic, note.dynamic);
      assert.deepEqual(back.score.notes[index].articulations, note.articulations);
      assert.equal(back.score.notes[index].ornament, note.ornament);
      assert.equal(back.score.notes[index].gracePitch, note.gracePitch);
      assert.equal(back.score.notes[index].slurStart, note.slurStart);
      assert.equal(back.score.notes[index].slurEnd, note.slurEnd);
      assert.equal(back.score.notes[index].hairpin, note.hairpin);
      assert.equal(back.score.notes[index].hairpinEnd, note.hairpinEnd);
      assert.deepEqual(back.score.notes[index].pitches, note.pitches);
    });
  });

  it("does not invent expression marks for a plain tune", () => {
    const back = roundTrip(scoreFromExample(EXAMPLES[0]));
    for (const note of back.notes) {
      assert.equal(note.dynamic, undefined);
      assert.equal(note.ornament, undefined);
      assert.equal(note.slurStart, undefined);
      assert.equal(note.articulations, undefined);
      assert.equal(note.hairpin, undefined);
    }
  });

  it("folds pp into p, skips sfz, and skips a run of grace notes", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <score-partwise version="3.1">
        <part id="P1">
          <measure number="1">
            <attributes>
              <divisions>1</divisions>
              <key><fifths>0</fifths><mode>major</mode></key>
              <time><beats>4</beats><beat-type>4</beat-type></time>
            </attributes>
            <direction><direction-type><dynamics><pp/></dynamics></direction-type></direction>
            <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration></note>
            <direction><direction-type><dynamics><sfz/></dynamics></direction-type></direction>
            <note>
              <grace slash="yes"/><pitch><step>D</step><octave>4</octave></pitch>
            </note>
            <note>
              <grace slash="yes"/><pitch><step>E</step><octave>4</octave></pitch>
            </note>
            <note>
              <pitch><step>F</step><octave>4</octave></pitch>
              <duration>1</duration>
              <notations><ornaments><mordent/></ornaments></notations>
            </note>
          </measure>
        </part>
      </score-partwise>`;
    const imported = musicXmlToScore(xml, "力度");
    assert.equal(imported.score.notes[0].dynamic, "p");
    assert.equal(imported.score.notes[1].dynamic, undefined);
    assert.equal(imported.score.notes[1].ornament, undefined);
    assert.equal(imported.score.notes[1].pitches[0], 65);
    assert.match(imported.notice, /更细的力度记成 p 或 f/);
    assert.match(imported.notice, /其他力度/);
    assert.match(imported.notice, /装饰音/);
    assert.match(imported.notice, /其他装饰音/);
  });

  it("puts an offset dynamic on the later note, not the note already sounding", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <score-partwise version="3.1">
        <part id="P1">
          <measure number="1">
            <attributes>
              <divisions>1</divisions>
              <key><fifths>0</fifths><mode>major</mode></key>
              <time><beats>4</beats><beat-type>4</beat-type></time>
            </attributes>
            <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration></note>
            <direction>
              <direction-type><dynamics><f/></dynamics></direction-type>
              <offset>1</offset>
            </direction>
            <note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration></note>
            <note><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration></note>
          </measure>
        </part>
      </score-partwise>`;
    const notes = musicXmlToScore(xml, "偏移").score.notes;
    assert.equal(notes[0].dynamic, undefined);
    assert.equal(notes[1].dynamic, undefined);
    assert.equal(notes[2].dynamic, "f");
    assert.deepEqual(
      notes.map((note) => note.pitches[0]),
      [60, 62, 64],
    );
  });

  it("does not let another voice or staff take the melody's dynamic", () => {
    const voice = `<?xml version="1.0" encoding="UTF-8"?>
      <score-partwise version="3.1">
        <part id="P1">
          <measure number="1">
            <attributes>
              <divisions>1</divisions>
              <key><fifths>0</fifths></key>
              <time><beats>4</beats><beat-type>4</beat-type></time>
            </attributes>
            <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice></note>
            <direction>
              <direction-type><dynamics><f/></dynamics></direction-type>
              <voice>2</voice>
            </direction>
            <note><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice></note>
          </measure>
        </part>
      </score-partwise>`;
    const kept = musicXmlToScore(voice, "声部").score.notes;
    assert.equal(kept[0].dynamic, undefined);
    assert.equal(kept[1].dynamic, undefined);
    assert.deepEqual(
      kept.map((note) => note.pitches[0]),
      [60, 64],
    );

    const staff = `<?xml version="1.0" encoding="UTF-8"?>
      <score-partwise version="3.1">
        <part id="P1">
          <measure number="1">
            <attributes>
              <divisions>1</divisions>
              <key><fifths>0</fifths></key>
              <time><beats>4</beats><beat-type>4</beat-type></time>
            </attributes>
            <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><staff>1</staff></note>
            <direction>
              <direction-type><dynamics><p/></dynamics></direction-type>
              <staff>2</staff>
            </direction>
            <note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration><staff>1</staff></note>
          </measure>
        </part>
      </score-partwise>`;
    const melody = musicXmlToScore(staff, "谱表").score.notes;
    assert.equal(melody[0].dynamic, undefined);
    assert.equal(melody[1].dynamic, undefined);
  });

  it("ends a hairpin at the start of a note tied across the bar", () => {
    const score = asScore([
      { pitches: [60], dur: 1, hairpin: "cresc" as const },
      { pitches: [62], dur: 5, hairpinEnd: true },
    ]);
    const xml = scoreToMusicXml(score);
    const stop = xml.indexOf('wedge type="stop"');
    const tieStart = xml.indexOf('tie type="start"');
    const tieStop = xml.indexOf('tie type="stop"');
    assert.ok(stop >= 0 && tieStart > stop && tieStop > tieStart);
    assert.equal(xml.split('wedge type="stop"').length - 1, 1);
    const back = roundTrip(score);
    assert.equal(back.notes[0].hairpin, "cresc");
    assert.equal(back.notes[1].hairpinEnd, true);
    assert.equal(back.notes[1].dur, 5);
  });

  it("closes both wedges when two hairpins meet on one note", () => {
    const score = asScore([
      { pitches: [60], dur: 1, hairpin: "cresc" as const },
      { pitches: [62], dur: 1, hairpinEnd: true, hairpin: "dim" as const },
      { pitches: [64], dur: 1, hairpinEnd: true },
    ]);
    const xml = scoreToMusicXml(score);
    assert.equal(xml.split('wedge type="crescendo"').length - 1, 1);
    assert.equal(xml.split('wedge type="diminuendo"').length - 1, 1);
    assert.equal(xml.split('wedge type="stop"').length - 1, 2);
    const back = roundTrip(score);
    assert.equal(back.notes[0].hairpin, "cresc");
    assert.equal(back.notes[1].hairpinEnd, true);
    assert.equal(back.notes[1].hairpin, "dim");
    assert.equal(back.notes[2].hairpinEnd, true);
    assert.equal(back.notes[2].hairpin, undefined);
  });

  it("keeps a dynamic on a tied continuation instead of moving it to the long note", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <score-partwise version="3.1">
        <part id="P1">
          <measure number="1">
            <attributes>
              <divisions>1</divisions>
              <key><fifths>0</fifths><mode>major</mode></key>
              <time><beats>4</beats><beat-type>4</beat-type></time>
            </attributes>
            <direction><direction-type><wedge type="crescendo"/></direction-type></direction>
            <note>
              <pitch><step>C</step><octave>4</octave></pitch>
              <duration>4</duration>
              <tie type="start"/>
              <notations><tied type="start"/></notations>
            </note>
          </measure>
          <measure number="2">
            <direction><direction-type><wedge type="stop"/></direction-type></direction>
            <direction><direction-type><dynamics><f/></dynamics></direction-type></direction>
            <note>
              <pitch><step>C</step><octave>4</octave></pitch>
              <duration>1</duration>
              <tie type="stop"/>
              <notations><tied type="stop"/></notations>
            </note>
          </measure>
        </part>
      </score-partwise>`;
    const imported = musicXmlToScore(xml, "延音");
    assert.equal(imported.score.notes.length, 2);
    assert.equal(imported.score.notes[0].dur, 4);
    assert.equal(imported.score.notes[0].hairpin, "cresc");
    assert.equal(imported.score.notes[0].hairpinEnd, undefined);
    assert.equal(imported.score.notes[0].dynamic, undefined);
    assert.equal(imported.score.notes[1].dur, 1);
    assert.equal(imported.score.notes[1].hairpinEnd, true);
    assert.equal(imported.score.notes[1].dynamic, "f");
    assert.match(imported.notice, /没有挪到长音开头/);
  });

  it("does not collapse two hairpin ends on the two pieces of one tie", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <score-partwise version="3.1">
        <part id="P1">
          <measure number="1">
            <attributes>
              <divisions>1</divisions>
              <key><fifths>0</fifths><mode>major</mode></key>
              <time><beats>4</beats><beat-type>4</beat-type></time>
            </attributes>
            <direction><direction-type><wedge type="crescendo"/></direction-type></direction>
            <note>
              <pitch><step>C</step><octave>4</octave></pitch>
              <duration>1</duration>
            </note>
            <direction><direction-type><wedge type="stop"/></direction-type></direction>
            <direction><direction-type><wedge type="diminuendo"/></direction-type></direction>
            <note>
              <pitch><step>D</step><octave>4</octave></pitch>
              <duration>3</duration>
              <tie type="start"/>
              <notations><tied type="start"/></notations>
            </note>
          </measure>
          <measure number="2">
            <direction><direction-type><wedge type="stop"/></direction-type></direction>
            <note>
              <pitch><step>D</step><octave>4</octave></pitch>
              <duration>1</duration>
              <tie type="stop"/>
              <notations><tied type="stop"/></notations>
            </note>
          </measure>
        </part>
      </score-partwise>`;
    const imported = musicXmlToScore(xml, "两段渐变");
    assert.equal(imported.score.notes.length, 3);
    assert.equal(imported.score.notes[0].dur, 1);
    assert.equal(imported.score.notes[0].hairpin, "cresc");
    assert.equal(imported.score.notes[0].hairpinEnd, undefined);
    assert.equal(imported.score.notes[1].dur, 3);
    assert.equal(imported.score.notes[1].hairpinEnd, true);
    assert.equal(imported.score.notes[1].hairpin, "dim");
    assert.equal(imported.score.notes[2].dur, 1);
    assert.equal(imported.score.notes[2].pitches[0], 62);
    assert.equal(imported.score.notes[2].hairpinEnd, true);
    assert.equal(imported.score.notes[2].hairpin, undefined);
    assert.match(imported.notice, /没有挪到长音开头/);
    const again = scoreToMusicXml(imported.score);
    assert.equal(again.split('wedge type="stop"').length - 1, 2);
    assert.match(again, /wedge type="diminuendo"/);
  });

  it("keeps an unslashed grace as an appoggiatura", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <score-partwise version="3.1">
        <part id="P1">
          <measure number="1">
            <attributes>
              <divisions>1</divisions>
              <key><fifths>0</fifths><mode>major</mode></key>
              <time><beats>4</beats><beat-type>4</beat-type></time>
            </attributes>
            <note><grace/><pitch><step>D</step><octave>4</octave></pitch><type>eighth</type></note>
            <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration></note>
            <note><grace slash="yes"/><pitch><step>F</step><octave>4</octave></pitch><type>eighth</type></note>
            <note><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration></note>
          </measure>
        </part>
      </score-partwise>`;
    const imported = musicXmlToScore(xml, "倚音");
    assert.equal(imported.score.notes[0].ornament, "appoggiatura");
    assert.equal(imported.score.notes[0].gracePitch, 62);
    assert.equal(imported.score.notes[1].ornament, "grace");
    assert.equal(imported.score.notes[1].gracePitch, 65);
    assert.doesNotMatch(imported.notice, /装饰音/);
    const out = scoreToMusicXml(imported.score);
    const first = out.indexOf("<grace");
    const second = out.indexOf("<grace", first + 1);
    assert.match(out.slice(first, second), /<grace\/>/);
    assert.doesNotMatch(out.slice(first, second), /slash/);
    assert.match(out.slice(second), /slash="yes"/);
    const again = musicXmlToScore(out, "倚音").score;
    assert.equal(again.notes[0].ornament, "appoggiatura");
    assert.equal(again.notes[1].ornament, "grace");
  });

  it("rejects files that are not uncompressed MusicXML", () => {
    assert.throws(() => musicXmlToScore("hello", "x"), /这不是 MusicXML/);
    assert.throws(() => musicXmlToScore("<score>no</score>", "x"), /这不是 MusicXML/);
    assert.throws(
      () =>
        musicXmlToScore(
          `<?xml version="1.0"?><score-partwise version="3.1"><part id="P1"><measure number="1"/></part></score-partwise>`,
          "x",
        ),
      /没有音符/,
    );
    assert.throws(() => musicXmlToScore("PK\u0003\u0004 compressed", "x"), /mxl/);
  });
});


describe("chord symbols", () => {
  it("round-trips common marks and keeps a complex one with a notice", () => {
    const score = asScore(
      [
        { pitches: [60], dur: 1 },
        { pitches: [64], dur: 1 },
        { pitches: [67], dur: 1 },
        { pitches: [72], dur: 1 },
      ],
      {
        chordSymbols: [
          { at: 0, symbol: "C" },
          { at: 1, symbol: "Am7" },
          { at: 2, symbol: "G/B" },
          { at: 3, symbol: "C13#11" },
        ],
      },
    );
    const xml = scoreToMusicXml(score);
    assert.match(xml, /<harmony>/);
    assert.match(xml, /<kind>major<\/kind>/);
    assert.match(xml, /<kind>minor-seventh<\/kind>/);
    assert.match(xml, /<bass-step>B<\/bass-step>/);
    assert.match(xml, /C13#11/);
    const imported = musicXmlToScore(xml, "x");
    assert.deepEqual(
      imported.score.chordSymbols?.map((item) => [item.at, item.symbol]),
      [
        [0, "C"],
        [1, "Am7"],
        [2, "G/B"],
        [3, "C13#11"],
      ],
    );
    assert.equal(imported.score.notes.length, 4);
    assert.match(imported.notice, /和弦标记/);
  });

  it("opens a score with no marks unchanged", () => {
    const score = asScore([{ pitches: [60], dur: 4 }]);
    const imported = musicXmlToScore(scoreToMusicXml(score), "x");
    assert.equal(imported.score.chordSymbols, undefined);
  });
});

describe("musicxml import losses", () => {
  const xml = (measure: string, parts = "") => `<?xml version="1.0"?>
<score-partwise version="3.1"><part-list><score-part id="P1"><part-name>S</part-name></score-part>${parts ? '<score-part id="P2"><part-name>B</part-name></score-part>' : ""}</part-list>
<part id="P1"><measure number="1"><attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
${measure}</measure></part>${parts}</score-partwise>`;
  const note = (step: string, voice = 1, extra = "") =>
    `<note><pitch><step>${step}</step><octave>4</octave></pitch><duration>1</duration><voice>${voice}</voice><type>quarter</type>${extra}</note>`;

  it("keeps repeats and the third voice; lists pedal, extra verses and other parts", () => {
    const body = [
      '<barline location="left"><repeat direction="forward"/></barline>',
      '<direction><direction-type><pedal type="start"/></direction-type></direction>',
      note("C", 1, '<lyric number="1"><text>一</text></lyric><lyric number="2"><text>二</text></lyric>'),
      note("D"), note("E"), note("F"),
      '<backup><duration>4</duration></backup>', note("C", 2), note("C", 2), note("C", 2), note("C", 2),
      '<backup><duration>4</duration></backup>', note("G", 3), note("G", 3), note("G", 3), note("G", 3),
      '<barline location="right"><repeat direction="backward"/></barline>',
    ].join("");
    const other = '<part id="P2"><measure number="1">' + note("C") + note("C") + note("C") + note("C") + "</measure></part>";
    const { losses, score } = musicXmlToScore(xml(body, other), "fallback");
    assert.equal(score.extraVoices?.[0]?.length, 4);
    assert.ok(!losses.some(l => l.includes("第三")));
    for (const word of ["踏板", "第 2 段", "其他"])
      assert.ok(losses.some((l) => l.includes(word)), `${word}: ${losses.join(" / ")}`);
    // |: … :| is kept now (round 7), so it is no longer listed as lost.
    assert.deepEqual(score.repeats, [{ from: 0, to: 4 }]);
    assert.ok(!losses.some((l) => l.startsWith("反复")), losses.join(" / "));
  });

  it("is empty for a plain round trip", () => {
    const score = scoreFromExample(EXAMPLES[0]);
    assert.deepEqual(musicXmlToScore(scoreToMusicXml(score), "fallback").losses, []);
  });
});

describe("MusicXML arpeggiate", () => {
  it("writes <arpeggiate/> on every chord tone and reads it back as the arpeggio mark", () => {
    const score = asScore([{ pitches: [60, 64, 67], dur: 4, ornament: "arpeggio" }]);
    const xml = scoreToMusicXml(score);
    assert.equal(xml.match(/<arpeggiate\/>/g)?.length, 3);
    const back = musicXmlToScore(xml, "fallback");
    assert.equal(back.score.notes[0].ornament, "arpeggio");
    assert.ok(!(back.losses ?? []).some((l: string) => l.includes("琶音")));
  });
  it("keeps non-arpeggiate as a loss", () => {
    const xml = scoreToMusicXml(asScore([{ pitches: [60, 64], dur: 4 }])).replace(
      "<voice>1</voice>",
      "<voice>1</voice>",
    ).replace("</note>", "<notations><non-arpeggiate type=\"bottom\"/></notations></note>");
    const back = musicXmlToScore(xml, "fallback");
    assert.ok((back.losses ?? []).some((l: string) => l.includes("non-arpeggiate")));
  });
});

describe("MusicXML mid-score marks", () => {
  const note = (midi: number, dur = 1): ScoreNote => ({ pitches: [midi], dur });

  function sameAt(a: number, b: number, label: string) {
    assert.ok(Math.abs(a - b) < 1e-6, `${label}: ${a} vs ${b}`);
  }

  function sameChanges(a: Score["changes"], b: Score["changes"]) {
    const left = canonicalChanges(a ?? []).filter((c) => c.at > 0);
    const right = canonicalChanges(b ?? []).filter((c) => c.at > 0);
    assert.equal(left.length, right.length, `changes ${JSON.stringify(left)} vs ${JSON.stringify(right)}`);
    for (let i = 0; i < left.length; i++) {
      sameAt(left[i]!.at, right[i]!.at, `change ${i} at`);
      const { at: _a, ...l } = left[i]!;
      const { at: _b, ...r } = right[i]!;
      assert.deepEqual(l, r, `change ${i}`);
    }
  }

  function sameFermatas(a: Score["fermatas"], b: Score["fermatas"]) {
    const left = canonicalFermatas(a) ?? [];
    const right = canonicalFermatas(b) ?? [];
    assert.equal(left.length, right.length);
    for (let i = 0; i < left.length; i++) {
      assert.equal(left[i]!.voice, right[i]!.voice);
      sameAt(left[i]!.at, right[i]!.at, `fermata ${i}`);
    }
  }

  function sameGraduals(src: Score, back: Score) {
    const left = canonicalGradualTempos((src as ScoreWithGradual).gradualTempos) ?? [];
    const right = canonicalGradualTempos((back as ScoreWithGradual).gradualTempos) ?? [];
    assert.equal(left.length, right.length, `gradual ${JSON.stringify(left)} vs ${JSON.stringify(right)}`);
    for (let i = 0; i < left.length; i++) {
      sameAt(left[i]!.from, right[i]!.from, `gradual ${i} from`);
      sameAt(left[i]!.to, right[i]!.to, `gradual ${i} to`);
      assert.equal(left[i]!.kind, right[i]!.kind);
      assert.equal(resolveGradualTarget(src, left[i]!), resolveGradualTarget(back, right[i]!));
    }
  }

  it("round-trips mid-score tempo, time, key, fermata and gradual spans", () => {
    const score: ScoreWithGradual = asScore(Array.from({ length: 16 }, () => note(60, 1)), {
      bpm: 120,
      beats: 4,
      beatUnit: 4,
      key: "C",
      mode: "major",
      changes: [
        { at: 2, bpm: 80 },
        { at: 4, beats: 3, beatUnit: 4, key: "G", mode: "major" },
        { at: 10, bpm: 72 },
      ],
      fermatas: [{ voice: 0, at: 3 }],
      gradualTempos: [
        { from: 4, to: 7, kind: "rit", toBpm: 60 },
        { from: 10, to: 14, kind: "accel", ratio: 4 / 3 },
      ],
    });
    const xml = scoreToMusicXml(score);
    assert.match(xml, /<sound tempo="80"\/>/);
    assert.match(xml, /<time>\s*<beats>3<\/beats>\s*<beat-type>4<\/beat-type>\s*<\/time>/);
    assert.match(xml, /<key>\s*<fifths>1<\/fifths>\s*<mode>major<\/mode>\s*<\/key>/);
    assert.match(xml, /<fermata\/>/);
    assert.match(xml, /<words>rit\.<\/words>/);
    assert.match(xml, /<words>accel\.<\/words>/);
    assert.match(xml, /<dashes type="start" number="1"\/>/);
    assert.match(xml, /<dashes type="stop" number="1"\/>/);
    assert.match(xml, /<sound tempo="60"\/>/);
    const back = musicXmlToScore(xml, "fallback");
    assert.deepEqual(back.losses, []);
    assert.ok(!back.losses.some((l) => /延长|谱上文字|拍号|转调|速度|渐/.test(l)));
    sameChanges(score.changes, back.score.changes);
    sameFermatas(score.fermatas, back.score.fermatas);
    sameGraduals(score, back.score);
    assert.equal(back.score.bpm, 120);
    assert.equal(back.score.beats, 4);
    assert.equal(back.score.key, "C");
  });

  it("imports MuseScore-style directions and does not list kept marks as lost", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>S</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <key><fifths>0</fifths><mode>major</mode></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>G</sign><line>2</line></clef>
      </attributes>
      <direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>120</per-minute></metronome></direction-type><sound tempo="120"/></direction>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
      <direction><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>80</per-minute></metronome></direction-type><sound tempo="80"/></direction>
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type><notations><fermata/></notations></note>
      <note><pitch><step>F</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
    </measure>
    <measure number="2">
      <attributes>
        <key><fifths>1</fifths><mode>major</mode></key>
        <time><beats>3</beats><beat-type>4</beat-type></time>
      </attributes>
      <direction placement="above">
        <direction-type><words>rit.</words></direction-type>
        <direction-type><dashes type="start" number="1"/></direction-type>
      </direction>
      <note><pitch><step>G</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
      <note><pitch><step>A</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
      <note><pitch><step>B</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
    </measure>
    <measure number="3">
      <direction placement="above">
        <direction-type><dashes type="stop" number="1"/></direction-type>
        <sound tempo="60"/>
      </direction>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>1</duration><type>quarter</type></note>
      <note><pitch><step>D</step><octave>5</octave></pitch><duration>1</duration><type>quarter</type></note>
      <note><pitch><step>E</step><octave>5</octave></pitch><duration>1</duration><type>quarter</type></note>
    </measure>
  </part>
</score-partwise>
`;
    const { score, losses } = musicXmlToScore(xml, "fallback");
    assert.deepEqual(losses, []);
    sameChanges(
      [
        { at: 1, bpm: 80 },
        { at: 4, beats: 3, beatUnit: 4, key: "G", mode: "major" },
      ],
      score.changes,
    );
    sameFermatas([{ voice: 0, at: 2 }], score.fermatas);
    sameGraduals(
      asScore(score.notes, { bpm: score.bpm, changes: score.changes, gradualTempos: [{ from: 4, to: 7, kind: "rit", toBpm: 60 }] }),
      score,
    );
    // Target sound on the dashes stop must not invent a mid-score metronome mark.
    assert.ok(!(score.changes ?? []).some((c) => c.bpm === 60));
  });

  it("restores a words-only rallentando until the next tempo mark", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>S</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <key><fifths>0</fifths></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>G</sign><line>2</line></clef>
      </attributes>
      <direction><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>100</per-minute></metronome></direction-type><sound tempo="100"/></direction>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
      <direction><direction-type><words>rall.</words></direction-type></direction>
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
      <direction><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>70</per-minute></metronome></direction-type><sound tempo="70"/></direction>
      <note><pitch><step>F</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
    </measure>
  </part>
</score-partwise>
`;
    const { score, losses } = musicXmlToScore(xml, "fallback");
    assert.ok(!losses.some((l) => l.includes("谱上文字") || l.includes("延长")), losses.join(" / "));
    sameChanges([{ at: 3, bpm: 70 }], score.changes);
    sameGraduals(
      asScore(score.notes, { bpm: 100, changes: score.changes, gradualTempos: [{ from: 1, to: 3, kind: "rit", toBpm: 70 }] }),
      score,
    );
  });

  it("still lists leftover expression words as 谱上文字", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>S</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <key><fifths>0</fifths></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>G</sign><line>2</line></clef>
      </attributes>
      <direction><direction-type><words>rit.</words></direction-type><direction-type><dashes type="start" number="1"/></direction-type></direction>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>2</duration><type>half</type></note>
      <direction><direction-type><dashes type="stop" number="1"/></direction-type><direction-type><words>dolce</words></direction-type></direction>
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>2</duration><type>half</type></note>
    </measure>
  </part>
</score-partwise>
`;
    const { score, losses } = musicXmlToScore(xml, "fallback");
    assert.ok(losses.some((l) => l.includes("谱上文字")), losses.join(" / "));
    assert.ok(!losses.some((l) => l.includes("延长")), losses.join(" / "));
    const spans = canonicalGradualTempos((score as ScoreWithGradual).gradualTempos) ?? [];
    assert.equal(spans.length, 1);
    assert.equal(spans[0]!.kind, "rit");
    sameAt(spans[0]!.from, 0, "rit from");
    sameAt(spans[0]!.to, 2, "rit to");
  });

  it("keeps Hungarian Rhapsody No. 2 mid-score changes after a MusicXML round trip", async () => {
    const score = await loadExampleScore("hr2");
    const back = musicXmlToScore(scoreToMusicXml(score), "fallback");
    assert.ok(!back.losses.some((l) => /延长|谱上文字/.test(l)), back.losses.join(" / "));
    sameChanges(score.changes, back.score.changes);
    sameFermatas(score.fermatas, back.score.fermatas);
    sameGraduals(score, back.score);
  });
});
