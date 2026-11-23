import { voiceList } from "./voices.ts";
import { describeTabMisses, guitarTabOf, tuningOf, type TabPlace, type TabPosition, type TabPositionId, type TabTuning, type TabTuningId } from "./guitar-tab.ts";
import { nextBar } from "./score-timeline.ts";
import { type Score } from "./theory.ts";

const STEP_OF = [
  { step: "C" },
  { step: "C", alter: 1 },
  { step: "D" },
  { step: "D", alter: 1 },
  { step: "E" },
  { step: "F" },
  { step: "F", alter: 1 },
  { step: "G" },
  { step: "G", alter: 1 },
  { step: "A" },
  { step: "A", alter: 1 },
  { step: "B" },
] as const;

const TYPE_OF: Record<number, { type: string; dots: number }> = {
  4: { type: "whole", dots: 0 },
  3: { type: "half", dots: 1 },
  2: { type: "half", dots: 0 },
  1.5: { type: "quarter", dots: 1 },
  1: { type: "quarter", dots: 0 },
  0.75: { type: "eighth", dots: 1 },
  0.5: { type: "eighth", dots: 0 },
  0.375: { type: "16th", dots: 1 },
  0.25: { type: "16th", dots: 0 },
  0.125: { type: "32nd", dots: 0 },
};

const DIV = 48;

function esc(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[ch]!
  ));
}

function pitchXml(midi: number, indent: string): string[] {
  const rounded = Math.round(midi);
  const pc = ((rounded % 12) + 12) % 12;
  const octave = Math.floor(rounded / 12) - 1;
  const step = STEP_OF[pc]!;
  const lines = [
    `${indent}<pitch>`,
    `${indent}  <step>${step.step}</step>`,
  ];
  if ("alter" in step && step.alter) lines.push(`${indent}  <alter>${step.alter}</alter>`);
  lines.push(`${indent}  <octave>${octave}</octave>`, `${indent}</pitch>`);
  return lines;
}

function typeOf(quarters: number): { type: string; dots: number } {
  return TYPE_OF[quarters] ?? { type: "quarter", dots: 0 };
}

function noteXml(
  midi: number,
  divs: number,
  quarters: number,
  voice: string,
  chord: boolean,
  place: TabPlace | undefined,
): string {
  const kind = typeOf(quarters);
  const lines = ["      <note>"];
  if (chord) lines.push("        <chord/>");
  lines.push(...pitchXml(midi, "        "));
  lines.push(`        <duration>${divs}</duration>`);
  lines.push(`        <voice>${voice}</voice>`);
  lines.push(`        <type>${kind.type}</type>`);
  for (let i = 0; i < kind.dots; i += 1) lines.push("        <dot/>");
  if (place) {
    lines.push(
      "        <notations>",
      "          <technical>",
      `            <string>${place.string}</string>`,
      `            <fret>${place.fret}</fret>`,
      "          </technical>",
      "        </notations>",
    );
  }
  lines.push("      </note>");
  return lines.join("\n");
}

function restXml(divs: number, quarters: number, voice: string): string {
  const kind = typeOf(quarters);
  const lines = [
    "      <note>",
    "        <rest/>",
    `        <duration>${divs}</duration>`,
    `        <voice>${voice}</voice>`,
    `        <type>${kind.type}</type>`,
  ];
  for (let i = 0; i < kind.dots; i += 1) lines.push("        <dot/>");
  lines.push("      </note>");
  return lines.join("\n");
}

function staffDetails(tuning: TabTuning): string[] {
  const lines = [
    "        <clef>",
    "          <sign>TAB</sign>",
    "          <line>5</line>",
    "        </clef>",
    "        <staff-details>",
    `          <staff-lines>${tuning.strings.length}</staff-lines>`,
  ];
  // MusicXML staff-tuning line 1 is the lowest staff line (lowest string).
  const byLine = [...tuning.strings].sort((a, b) => b.string - a.string);
  byLine.forEach((str, index) => {
    const pc = ((str.midi % 12) + 12) % 12;
    const step = STEP_OF[pc]!;
    const octave = Math.floor(str.midi / 12) - 1;
    lines.push(`          <staff-tuning line="${index + 1}">`);
    lines.push(`            <tuning-step>${step.step}</tuning-step>`);
    if ("alter" in step && step.alter) lines.push(`            <tuning-alter>${step.alter}</tuning-alter>`);
    lines.push(`            <tuning-octave>${octave}</tuning-octave>`);
    lines.push("          </staff-tuning>");
  });
  lines.push("        </staff-details>");
  return lines;
}

type Slice = { at: number; end: number; midi: number; voice: number; note: number };

function slicesOf(score: Score): Slice[] {
  const out: Slice[] = [];
  const walk = (notes: Score["notes"], voice: number) => {
    let at = 0;
    notes.forEach((note, index) => {
      const dur = note.dur;
      if (!Number.isFinite(dur) || dur <= 0) return;
      if (!note.pitches.length) {
        out.push({ at, end: at + dur, midi: NaN, voice, note: index });
      } else {
        for (const midi of note.pitches) out.push({ at, end: at + dur, midi, voice, note: index });
      }
      at += dur;
    });
  };
  voiceList(score).forEach(walk);
  return out.sort((a, b) => a.at - b.at || a.voice - b.voice || a.midi - b.midi);
}

/**
 * Concert-pitch MusicXML with a TAB staff, standard tuning, and string/fret marks.
 * Unplaceable notes keep their pitch but omit <technical>, and are listed in notices.
 */
export function scoreToMusicXmlTab(
  score: Score,
  tuning: TabTuningId | TabTuning = "guitar-standard",
  position: TabPositionId | TabPosition = "auto",
): { xml: string; notices: string[] } {
  const resolved = tuningOf(tuning);
  const model = guitarTabOf(score, resolved, position);
  const notices: string[] = [];
  const missText = describeTabMisses(model.misses, resolved);
  if (missText) notices.push(missText);

  const placeAt = (slice: Slice): TabPlace | undefined =>
    Number.isFinite(slice.midi)
      ? model.places.find(
          (item) =>
            item.voice === slice.voice &&
            item.note === slice.note &&
            item.midi === slice.midi &&
            Math.abs(item.start - slice.at) < 1e-9,
        )
      : undefined;

  const beatUnit = [1, 2, 4, 8, 16, 32].includes(score.beatUnit) ? score.beatUnit : 4;
  const beats = Math.max(1, Math.min(16, Math.round(score.beats || 4)));
  const bpm = Math.max(20, Math.min(400, Math.round(score.bpm || 96)));
  const all = slicesOf(score);
  const end = Math.max(0, ...all.map((item) => item.end), nextBar(score, 0));
  const measures: { start: number; end: number }[] = [];
  let cursor = 0;
  while (cursor < end - 1e-9) {
    const close = nextBar(score, cursor);
    measures.push({ start: cursor, end: close });
    cursor = close;
  }
  if (!measures.length) measures.push({ start: 0, end: nextBar(score, 0) });

  const fifthsFor: Record<string, number> = {
    C: 0, G: 1, D: 2, A: 3, E: 4, B: 5, "F#": 6,
    F: -1, Bb: -2, Eb: -3, Ab: -4, Db: -5,
  };
  const fifths = (fifthsFor[score.key] ?? 0) + (score.mode === "minor" ? -3 : 0);

  const body = measures.map((measure, index) => {
    const head =
      index === 0
        ? [
            "      <attributes>",
            `        <divisions>${DIV}</divisions>`,
            "        <key>",
            `          <fifths>${fifths}</fifths>`,
            `          <mode>${score.mode}</mode>`,
            "        </key>",
            "        <time>",
            `          <beats>${beats}</beats>`,
            `          <beat-type>${beatUnit}</beat-type>`,
            "        </time>",
            ...staffDetails(resolved),
            "      </attributes>",
            ...(score.tempoMarked === false
              ? []
              : [
                  '      <direction placement="above">',
                  "        <direction-type>",
                  "          <metronome>",
                  "            <beat-unit>quarter</beat-unit>",
                  `            <per-minute>${bpm}</per-minute>`,
                  "          </metronome>",
                  "        </direction-type>",
                  `        <sound tempo="${bpm}"/>`,
                  "      </direction>",
                ]),
          ].join("\n")
        : "";

    const inBar = all.filter((item) => item.at < measure.end - 1e-9 && item.end > measure.start + 1e-9);
    const voices = voiceList(score).map((_, i) => i);
    const chunks: string[] = [];
    let previousWidth = 0;
    for (const voice of voices) {
      const items = inBar.filter((item) => item.voice === voice);
      const starts = [...new Set(items.map((item) => item.at))].sort((a, b) => a - b);
      const lines: string[] = [];
      let written = 0;
      let time = measure.start;
      const emitRest = (from: number, to: number) => {
        let left = to - from;
        let at = from;
        while (left > 1e-9) {
          const step = [4, 3, 2, 1.5, 1, 0.75, 0.5, 0.375, 0.25, 0.125].find((q) => q <= left + 1e-9) ?? left;
          const divs = Math.max(1, Math.round(step * DIV));
          lines.push(restXml(divs, step, String(voice + 1)));
          written += divs;
          at += step;
          left = to - at;
        }
      };
      if (!starts.length) emitRest(measure.start, measure.end);
      for (const start of starts) {
        if (start > time + 1e-9) emitRest(time, start);
        const group = items.filter((item) => Math.abs(item.at - start) < 1e-9);
        const sounding = group.filter((item) => Number.isFinite(item.midi));
        const dur = Math.min(measure.end, group[0]!.end) - Math.max(measure.start, start);
        const divs = Math.max(1, Math.round(dur * DIV));
        if (!sounding.length) {
          emitRest(start, start + dur);
        } else {
          sounding.forEach((item, chordIndex) => {
            lines.push(noteXml(item.midi, divs, dur, String(voice + 1), chordIndex > 0, placeAt(item)));
          });
          written += divs;
        }
        time = start + dur;
      }
      if (time < measure.end - 1e-9) emitRest(time, measure.end);
      if (voice > 0 && previousWidth > 0) {
        chunks.push(["      <backup>", `        <duration>${previousWidth}</duration>`, "      </backup>"].join("\n"));
      }
      chunks.push(lines.join("\n"));
      previousWidth = written;
    }

    return [`    <measure number="${index + 1}">`, head, ...chunks, "    </measure>"]
      .filter((part) => part !== "")
      .join("\n");
  }).join("\n");

  const title = score.title.trim() || "未命名";
  const partName = resolved.id === "bass-standard" ? "贝斯" : "吉他";
  const xml = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<score-partwise version="3.1">`,
    `  <work>`,
    `    <work-title>${esc(title)}</work-title>`,
    `  </work>`,
    `  <identification>`,
    `    <encoding>`,
    `      <software>谱线</software>`,
    `    </encoding>`,
    `  </identification>`,
    `  <part-list>`,
    `    <score-part id="P1">`,
    `      <part-name>${partName}</part-name>`,
    `    </score-part>`,
    `  </part-list>`,
    `  <part id="P1">`,
    body,
    `  </part>`,
    `</score-partwise>`,
    "",
  ].join("\n");
  return { xml, notices };
}
