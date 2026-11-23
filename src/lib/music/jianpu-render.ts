import { standardRhythm, rhythmFraction } from "./rhythm-spelling.ts";
import { writtenJianpuKey } from "./jianpu-key.ts";
import { displayKeyName, displayKeyPc, type JianpuNaming } from "./fixed-do.ts";
import { voiceList } from "./voices.ts";
// Explicit CommonJS entry: the package's `module` entry is actually UMD.
import renderer from "jianpurender/node/index.js";
import type { JianpuInfo } from "jianpurender";
import { KEY_NAMES, type Score } from "./theory.ts";
import type { ChordSymbol } from "./chord-symbol.ts";
import type { VoiceId } from "./voices.ts";
import { nextBar } from "./score-timeline.ts";
import { installJianpuSmilGuards } from "./jianpu-smil.ts";
import { expandRect, hitContains, hitDistance, minHitUnits } from "./hit-area.ts";

export { safeDestroy, installJianpuSmilGuards } from "./jianpu-smil.ts";

type SourceJianpuInfo = JianpuInfo & { measureEnds?: number[] };

export type JianpuHit = {
  voice: VoiceId;
  index: number;
  start: number;
  end: number;
  pitches: number[];
};
export type JianpuVoice = {
  voice: VoiceId;
  /** Written key spelling, retained separately from the renderer pitch class. */
  keyNames?: { start: number; name: string }[];
  info: JianpuInfo;
  hits: JianpuHit[];
  /** Screen lines only: false on a wrapped line that starts without a key/meter/tempo change. */
  header?: boolean;
  /** Screen lines only: restate ♩= on this line (first line, or a tempo change at its start). */
  tempoMark?: boolean;
  /** Score quarter where this line starts (hits are line-relative). */
  offset?: number;
};

/** One renderer per independent voice; never flatten voice2 into a shared note grid. */
export function scoreToJianpu(score: Score, instrumentShift = 0, naming: JianpuNaming = "movable"): JianpuVoice[] {
  const key = (KEY_NAMES.indexOf(score.key) + instrumentShift + 120) % 12;
  return voiceList(score).map(
    (notes, voice) => {
      let start = 0;
      const info: SourceJianpuInfo = {
        measureEnds: score.measureEnds,
        notes: [],
        lyrics: [],
        tempos: [
          ...(score.tempoMarked === false ? [] : [{ start: 0, qpm: score.bpm }]),
          ...(score.changes ?? []).filter(c => c.bpm !== undefined).map(c => ({ start: c.at, qpm: c.bpm! })),
        ],
        keySignatures: [{ start: 0, key: displayKeyPc(key, naming) }, ...(score.changes ?? []).filter(c => c.key !== undefined).map(c => ({ start: c.at, key: displayKeyPc((KEY_NAMES.indexOf(c.key!) + instrumentShift + 120) % 12, naming) }))],
        timeSignatures: [{ start: 0, numerator: score.beats, denominator: score.beatUnit }, ...(score.changes ?? []).filter(c => c.beats !== undefined).map(c => ({ start: c.at, numerator: c.beats!, denominator: c.beatUnit! }))],
      };
      const hits = notes.map((note, index): JianpuHit => {
        const pitches = note.pitches.map((pitch) => pitch + instrumentShift);
        const hit = { voice: voice as VoiceId, index, start, end: start + note.dur, pitches };
        // The library only infers rests from gaps and drops trailing/all-rest duration.
        // Silent placeholders preserve every rest boundary; RestModel removes their
        // pitches from the public block model before the final SVG is drawn.
        for (const pitch of pitches.length ? pitches : [0]) {
          const points = [start, ...([...new Set([...(score.changes ?? []).map(c => c.at), ...(score.measureEnds ?? [])])].filter(at => at > start && at < start + note.dur).sort((a,b) => a-b)), start + note.dur];
          for (let i = 0; i + 1 < points.length; i++) info.notes.push({ start: points[i], length: points[i+1]-points[i], pitch, intensity: pitches.length ? 100 : 0 });
        }
        if (note.lyric?.text && pitches.length) info.lyrics!.push({ start, text: note.lyric.text });
        start += note.dur;
        return hit;
      });
      return { voice: voice as VoiceId, info, hits, keyNames: [{ start: 0, name: displayKeyName(writtenJianpuKey(score.key, instrumentShift), naming) }, ...(score.changes ?? []).filter(c => c.key !== undefined).map(c => ({ start: c.at, name: displayKeyName(writtenJianpuKey(c.key!, instrumentShift), naming) }))] };
    },
  );
}

/**
 * Wrap each voice into lines of whole bars so the screen view reads like a page
 * instead of one long scrolling row. Times restart at 0 on every line (the SVG
 * ids are line-relative); `hit.index` stays the voice-wide note index.
 *
 * Lines break on real barlines (meter changes end a bar), and each line carries
 * its own line-relative key / meter / tempo timeline. Only the first line and a
 * line that starts on a change restate the `1=X 4/4 ♩=…` header (`header`).
 */
export function scoreToJianpuLines(score: Score, instrumentShift = 0, barsPerLine = 4, naming: JianpuNaming = "movable"): JianpuVoice[][] {
  const voices = scoreToJianpu(score, instrumentShift, naming);
  const perLine = Math.max(1, Math.floor(barsPerLine));
  const total = Math.max(0, ...voices.flatMap((voice) => voice.hits.map((hit) => hit.end)));
  const offsets: number[] = [0];
  let at = 0;
  for (let bar = 1; ; bar += 1) {
    const next = nextBar(score, at);
    if (!Number.isFinite(next) || next <= at + 1e-9 || next >= total - 1e-6) break;
    at = next;
    if (bar % perLine === 0) offsets.push(at);
  }
  const lineOf = (start: number) => {
    let line = 0;
    while (line + 1 < offsets.length && start >= offsets[line + 1] - 1e-6) line += 1;
    return line;
  };
  const used = Math.max(1, ...voices.flatMap((voice) => voice.hits.map((hit) => lineOf(hit.start) + 1)));
  const changes = score.changes ?? [];
  const lines: JianpuVoice[][] = [];
  for (let line = 0; line < used; line += 1) {
    const offset = offsets[line];
    const end = offsets[line + 1] ?? Infinity;
    const opening = changes.filter((change) => Math.abs(change.at - offset) < 1e-6);
    const header = line === 0 || opening.some((c) => c.key !== undefined || c.beats !== undefined || c.bpm !== undefined);
    const tempoMark = (line === 0 && score.tempoMarked !== false) || opening.some((c) => c.bpm !== undefined);
    lines.push(voices.map((voice) => {
      const hits = voice.hits
        .filter((hit) => lineOf(hit.start) === line)
        .map((hit) => ({ ...hit, start: hit.start - offset, end: hit.end - offset }));
      const inLine = (start: number) => lineOf(start) === line;
      const rebase = <T extends { start: number }>(events: T[] | undefined): T[] => {
        const list = events ?? [];
        let current: T | undefined;
        for (const event of list) if (event.start <= offset + 1e-6) current = event;
        const inside = list.filter((event) => event.start > offset + 1e-6 && event.start < end - 1e-6);
        return [...(current ? [current] : []), ...inside].map((event) => ({
          ...event,
          start: Math.max(0, event.start - offset),
        }));
      };
      const info: SourceJianpuInfo = {
        ...voice.info,
        measureEnds: (voice.info as SourceJianpuInfo).measureEnds?.filter(at => at > offset + 1e-8 && at <= end + 1e-8).map(at => at-offset),
        tempos: rebase(voice.info.tempos),
        keySignatures: rebase(voice.info.keySignatures),
        timeSignatures: rebase(voice.info.timeSignatures),
        notes: voice.info.notes.filter((note) => inLine(note.start)).map((note) => ({ ...note, start: note.start - offset })),
        lyrics: (voice.info.lyrics ?? []).filter((lyric) => inLine(lyric.start)).map((lyric) => ({ ...lyric, start: lyric.start - offset })),
      };
      return { voice: voice.voice, info, hits, header, tempoMark, offset, keyNames: rebase(voice.keyNames) };
    }));
  }
  return lines;
}

/** Whole bars that fit `width` CSS pixels (about 28 px per quarter note on screen, more for dense music). */
export function jianpuBarsPerLine(score: Pick<Score, "beats" | "beatUnit">, width: number, quarterPx = 28): number {
  const bar = ((score.beats * 4) / score.beatUnit) * quarterPx + 4;
  const fit = Math.floor((width - 48) / bar);
  return [8, 6, 4, 3, 2, 1].find((count) => count <= fit) ?? 1;
}

export function jianpuHitAt(
  hits: JianpuHit[],
  start: number,
  pitch?: number,
): JianpuHit | undefined {
  return hits.find(
    (hit) =>
      start >= hit.start - 1e-6 &&
      start < hit.end - 1e-6 &&
      (pitch === undefined || hit.pitches.includes(pitch)),
  );
}

export class RestModel extends renderer.JianpuModel {
  override update(info: JianpuInfo, key?: number) {
    super.update(info, key);
    const sourceEnds = (info as SourceJianpuInfo).measureEnds;
    if (sourceEnds?.length) {
      this.measuresInfo.measureNumberAtQ = (at: number) => {
        const i = sourceEnds.findIndex(end => end > at + 1e-8);
        const index = i < 0 ? sourceEnds.length - 1 : i;
        const start = sourceEnds[index-1] ?? 0;
        return index + 1 + (at-start)/(sourceEnds[index]-start) + 1e-9;
      };
      this.measuresInfo.measureLengthAtQ = (at: number) => {
        const i = sourceEnds.findIndex(end => end > at + 1e-8);
        const index = i < 0 ? sourceEnds.length - 1 : i;
        return sourceEnds[index] - (sourceEnds[index-1] ?? 0);
      };
      (this as unknown as { infoToBlocks(lyrics: JianpuInfo['lyrics']): void }).infoToBlocks(info.lyrics ?? []);
    } else if ((info.timeSignatures?.length ?? 0) > 1) {
      const meters = info.timeSignatures!;
      this.measuresInfo.measureNumberAtQ = (at: number) => {
        let number = 1;
        for (let i = 0; i < meters.length; i++) {
          const m = meters[i], length = m.numerator * 4 / m.denominator;
          const end = meters[i+1]?.start ?? Infinity;
          if (at < end - 1e-8) return number + (at-m.start)/length + 1e-9;
          number += Math.ceil((end-m.start)/length - 1e-8);
        }
        return number;
      };
      // Pinned jianpurender 1.8.1 builds blocks before callers can supply measure rules.
      // Rebuild once with the corrected public MeasuresInfo method; covered by SVG tests.
      (this as unknown as { infoToBlocks(lyrics: JianpuInfo['lyrics']): void }).infoToBlocks(info.lyrics ?? []);
    }
    for (const block of this.jianpuBlockMap.values()) {
      if (!standardRhythm(block.length)) {
        delete block.durationLines;
        delete block.augmentationDots;
        delete block.augmentationDash;
      }
      block.notes = block.notes.filter((note) => note.intensity !== 0);
      // 1.8.1 paints simultaneous pitches at the same SVG position. Keep the
      // lowest note on the baseline; stackChords() writes the rest above it
      // (lowest at the bottom, as in the printed jianpu). Score is intact.
      if (block.notes.length > 1) {
        block.notes = [
          block.notes.reduce((lower, note) => (note.pitch < lower.pitch ? note : lower)),
        ];
      }
    }
  }
}

/** Header row the library reserves above the notes (key / meter / tempo text). */
export const CONTINUED_HEADER_PX = 30;

/**
 * Screen spacing for numbered notation. The renderer spaces notes by time (pixels per second), so
 * at the default 44 px/s a run of sixteenths at ♩=72 or faster drew digits on top of each other.
 * Give the shortest written note about 22 px (room for a sharp or flat); slow, plain songs keep the original 44 px/s.
 */
export function jianpuSpacing(score: Score): { pixelsPerTimeStep: number; quarterPx?: number } {
  const base = 44;
  const qpm = score.bpm > 0 ? score.bpm : 60;
  let shortest = Infinity;
  for (const note of voiceList(score).flat()) if (note.dur > 1e-6) shortest = Math.min(shortest, note.dur);
  const need = Number.isFinite(shortest) ? Math.min(96, 22 / Math.max(shortest, 0.125)) : 0;
  const quarterPx = (base * 60) / qpm;
  if (need <= quarterPx + 0.5) return { pixelsPerTimeStep: base };
  return { pixelsPerTimeStep: (need * qpm) / 60, quarterPx: need };
}

export function renderJianpu(
  host: HTMLDivElement,
  voice: JianpuVoice,
  options: { height?: number; showTempoMarking?: boolean; header?: boolean; pixelsPerTimeStep?: number } = {},
) {
  const scope = host.ownerDocument?.defaultView ?? (typeof window !== "undefined" ? window : globalThis);
  installJianpuSmilGuards(scope);
  const view = new renderer.JianpuSVGRender(
    voice.info,
    {
      noteHeight: 22,
      noteColor: "#1c1916",
      activeNoteColor: "#a44825",
      pixelsPerTimeStep: options.pixelsPerTimeStep ?? 44,
      height: options.height ?? 180,
      showTempoMarking: options.showTempoMarking ?? true,
    },
    host,
  );
  view.jianpuModel = new RestModel(voice.info);
  // Patch the public signature drawing hook, including redraws after resize/scroll.
  const signatures = view as unknown as { currentKey: number; drawSignatures: (...args: unknown[]) => number };
  const draw = signatures.drawSignatures.bind(view);
  signatures.drawSignatures = (...args) => {
    const existing = new Set((args[0] as Element).querySelectorAll("text"));
    const width = draw(...args);
    const name = voice.keyNames?.find(k => (k.name === "♭G" ? 6 : KEY_NAMES.indexOf(k.name.replace(/♭([A-G])/, "$1b") as Score["key"])) === signatures.currentKey % 12)?.name;
    if (name) (args[0] as Element).querySelectorAll("text").forEach(text => {
      if (existing.has(text) || !/^1=/.test(text.textContent ?? "")) return;
      // The library sized this slot for "1=D#"; a full-size ♭ glyph is wider and runs into the meter.
      // Draw the flat as a smaller raised mark so 1=♭E occupies about the same width.
      const flat = /^♭([A-G])$/.exec(name);
      if (!flat) { text.textContent = `1=${name}`; return; }
      text.textContent = "1=";
      const mark = text.ownerDocument.createElementNS("http://www.w3.org/2000/svg", "tspan");
      mark.setAttribute("font-size", "62%");
      mark.setAttribute("baseline-shift", "super");
      mark.textContent = "♭";
      text.append(mark, flat[1]!);
    });
    return width;
  };
  // The library otherwise paints every sub-64th tail as a normal 64th.
  const blocks = view as unknown as { drawJianpuBlock: (block: renderer.JianpuBlock, ...args: unknown[]) => number };
  const drawBlock = blocks.drawJianpuBlock.bind(view);
  blocks.drawJianpuBlock = (block, ...args) => {
    const width = drawBlock(block, ...args);
    const group = host.querySelector(`[data-block-start="${block.start}"]`);
    if (group && !standardRhythm(block.length) && !group.querySelector('[data-rhythm-duration]')) {
      const label = host.ownerDocument.createElementNS(SVG_NS, 'text');
      label.setAttribute('data-rhythm-duration', `${block.length}`);
      label.setAttribute('font-size', '10');
      label.setAttribute('y', '32');
      label.setAttribute('x', `${args[0]}`);
      label.textContent = `[${rhythmFraction(block.length)}拍]`;
      group.append(label);
    }
    return width;
  };
  view.clear();
  view.redraw();
  stackChords(host, voice, view.jianpuModel as RestModel);
  if (options.header === false) {
    // Continuation line: the library always paints the opening 1=X / meter in its
    // overlay. Drop it and pull the notes up into the freed header row.
    const [overlay, scroller] = [...host.children] as HTMLElement[];
    if (overlay?.tagName.toLowerCase() === "svg") overlay.replaceChildren();
    const main = scroller?.querySelector("svg");
    if (main) main.style.marginTop = `-${CONTINUED_HEADER_PX}px`;
    host.dataset.continued = "";
  }
  return view;
}

const SVG_NS = "http://www.w3.org/2000/svg";
/** Vertical distance between stacked chord digits, as a multiple of the digit size. */
const CHORD_STEP = 1.2;

type JianpuDigit = { jianpuNumber: number; octaveDot: number; accidental: number };

/**
 * Screen chords read like the print: every pitch, stacked upward from the lowest.
 * Extra digits go inside the lowest note's group, so clicks and follow colours
 * (paintJianpu) cover the whole chord. The line grows to make room above.
 */
export function stackChords(host: HTMLElement, voice: JianpuVoice, model: RestModel) {
  const chords = voice.hits.filter((hit) => hit.pitches.length > 1);
  if (!chords.length) return 0;
  const main = host.querySelectorAll("svg")[1] ?? host.querySelector("svg");
  if (!main) return 0;
  const doc = main.ownerDocument;
  const create = model as unknown as { createJianpuNote(note: object, key: number): JianpuDigit };
  let tallest = 0;
  for (const hit of chords) {
    const sorted = [...hit.pitches].sort((a, b) => a - b);
    const [low, ...upper] = sorted;
    const key = model.measuresInfo.keySignatureAtQ(hit.start);
    for (const group of main.querySelectorAll<SVGGElement>("g[data-id]")) {
      const match = /^(\d+(?:\.\d+)?)-(\d+)$/.exec(group.dataset.id ?? "");
      if (!match || Number(match[2]) !== low) continue;
      const start = Number(match[1]);
      if (start < hit.start - 1e-6 || start >= hit.end - 1e-6) continue;
      const digit = [...group.querySelectorAll("text")].find((el) => /^\d$/.test(el.textContent ?? ""));
      if (!digit || group.querySelector("[data-chord-tone]")) continue; // tie dash or already stacked
      const size = parseFloat(digit.getAttribute("font-size") ?? "26") || 26;
      const step = size * CHORD_STEP;
      const x = Number(digit.getAttribute("x") ?? 0);
      upper.forEach((pitch, i) => {
        const note = create.createJianpuNote({ start, length: 1, pitch, intensity: 100 }, key);
        const y = -(i + 1) * step - (i === 0 && lowHasHighDots(group) ? size * 0.3 : 0);
        const text = doc.createElementNS(SVG_NS, "text");
        for (const name of ["font-family", "font-size", "font-weight", "text-anchor", "dominant-baseline", "fill"])
          if (digit.getAttribute(name) !== null) text.setAttribute(name, digit.getAttribute(name)!);
        text.setAttribute("x", String(x));
        text.setAttribute("y", String(y));
        text.setAttribute("data-chord-tone", String(pitch));
        text.textContent = `${note.accidental === 1 ? "#" : note.accidental === 2 ? "b" : ""}${note.jianpuNumber}`;
        if (note.accidental) text.setAttribute("x", String(x - size * 0.35));
        group.append(text);
        for (let d = 0; d < Math.abs(note.octaveDot); d += 1) {
          const dot = doc.createElementNS(SVG_NS, "circle");
          dot.setAttribute("cx", String(x + size * 0.28));
          dot.setAttribute("cy", String(y + (note.octaveDot > 0 ? -size * 0.62 - d * 5 : size * 0.5 + d * 5)));
          dot.setAttribute("r", "1.8");
          dot.setAttribute("fill", digit.getAttribute("fill") ?? "#1c1916");
          dot.setAttribute("data-chord-tone", String(pitch));
          group.append(dot);
        }
      });
      tallest = Math.max(tallest, upper.length * step + size * 0.6);
    }
  }
  if (tallest > 0) {
    // Push the music down so stacked digits do not climb into the header / line above.
    const content = main.querySelector<SVGGElement>('g[data-id="main-content"]');
    const shift = Math.ceil(tallest - 8);
    const match = /translate\(\s*([-\d.]+)[ ,]+([-\d.]+)\s*\)/.exec(content?.getAttribute("transform") ?? "");
    if (content && match && shift > 0) {
      content.setAttribute("transform", `translate(${match[1]}, ${Number(match[2]) + shift})`);
      main.setAttribute("height", String(Number(main.getAttribute("height") ?? 0) + shift));
      host.dataset.chordShift = String(shift);
    }
  }
  return tallest;
}

function lowHasHighDots(group: SVGGElement) {
  // The library draws octave dots as paths above (negative y) the digit.
  return [...group.querySelectorAll("path")].some((path) => {
    if (!(path.getAttribute("d") ?? "").startsWith("M 0 0 a")) return false;
    const transform = path.getAttribute("transform") ?? "";
    const m = /translate\(\s*[-\d.]+[ ,]+(-[\d.]+)/.exec(transform);
    return m != null && Number(m[1]) < -6;
  });
}

/**
 * Shade + bracket the practice A-B loop on one rendered line. `range` is in score
 * quarters. Notes are matched by onset, so a band only spans the looped notes.
 * Returns true when something was drawn on this line.
 */
export function markLoop(
  host: HTMLElement,
  voice: JianpuVoice,
  range: { from: number; to: number } | null,
  lineEnd = Infinity,
) {
  host.querySelectorAll("[data-loop-band]").forEach((el) => el.remove());
  if (!range) return false;
  const main = host.querySelectorAll("svg")[1] ?? host.querySelector("svg");
  const content = main?.querySelector<SVGGElement>('g[data-id="main-content"]');
  if (!main || !content) return false;
  const offset = voice.offset ?? 0;
  let left = Infinity, right = -Infinity, size = 26, top = 0;
  for (const group of content.querySelectorAll<SVGGElement>("g[data-id]")) {
    // Every block (notes and rests) is a `block-<start>` group.
    const match = /^block-(\d+(?:\.\d+)?)$/.exec(group.dataset.id ?? "");
    if (!match) continue;
    const at = Number(match[1]) + offset;
    if (at < range.from - 1e-6 || at >= range.to - 1e-6) continue;
    const digit = [...group.querySelectorAll("text")].find((el) => !el.hasAttribute("data-chord-tone") && /\d/.test(el.textContent ?? ""));
    // Tie-continuation blocks only hold a dash path: use its translate x.
    const dash = digit ? null : /translate\(\s*([-\d.]+)/.exec(group.querySelector("path")?.getAttribute("transform") ?? "");
    if (!digit && !dash) continue;
    const x = (digit ? Number(digit.getAttribute("x") ?? 0) : Number(dash![1])) + groupX(group, content);
    if (digit) size = parseFloat(digit.getAttribute("font-size") ?? "26") || 26;
    // Real layout (browser): the whole block, including dots and the — dashes.
    let box: { x: number; width: number } | null = null;
    try {
      const b = (group as SVGGraphicsElement).getBBox?.();
      if (b && b.width > 0) box = b;
    } catch {
      box = null;
    }
    left = Math.min(left, box ? box.x + groupX(group, content) : x);
    right = Math.max(right, box ? box.x + box.width + groupX(group, content) : x + size * 0.6);
    for (const tone of group.querySelectorAll("text[data-chord-tone]"))
      top = Math.min(top, Number(tone.getAttribute("y") ?? 0));
  }
  if (!(right > left)) return false;
  const doc = main.ownerDocument;
  const pad = 6;
  const y = top - size * 0.95, h = size * 1.95 - top;
  const band = doc.createElementNS(SVG_NS, "g");
  band.setAttribute("data-loop-band", "");
  band.setAttribute("aria-hidden", "true");
  band.setAttribute("pointer-events", "none");
  const rect = doc.createElementNS(SVG_NS, "rect");
  Object.entries({ x: left - pad, y, width: right - left + pad * 2, height: h, rx: 6, fill: "#a44825", "fill-opacity": "0.09" })
    .forEach(([k, v]) => rect.setAttribute(k, String(v)));
  band.append(rect);
  // Square brackets at the loop ends; a line that only continues the loop gets no bracket.
  const firstHere = range.from >= offset - 1e-6;
  const lastHere = range.to <= lineEnd + 1e-6;
  const bracket = (x: number, dir: 1 | -1) => {
    const path = doc.createElementNS(SVG_NS, "path");
    path.setAttribute("d", `M ${x + dir * 5} ${y} h ${-dir * 5} v ${h} h ${dir * 5}`);
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "#a44825");
    path.setAttribute("stroke-width", "1.6");
    path.setAttribute("data-loop-edge", dir === 1 ? "start" : "end");
    band.append(path);
  };
  if (firstHere) bracket(left - pad, 1);
  if (lastHere) bracket(right + pad, -1);
  content.insertBefore(band, content.firstChild);
  return true;
}

/** Room above the digits for a lead-sheet mark. */
export const CHORD_MARK_LIFT = 22;
/** SVG user units; the same size as the digits, so marks read at about 15–16 CSS px. */
export const CHORD_MARK_SIZE = 26;
/** Larger, bolder marks so the lead-sheet view is not just “jianpu plus tiny letters”. */
export const LEAD_CHORD_MARK_SIZE = 30;
/** Minimum gap between the bottom of a visible `1=X` header and a chord mark's top. */
export const HEADER_CHORD_GAP = 36;

/** Bounding box of the library's `1=X 4/4 ♩=` overlay, in the overlay SVG's coordinates. */
export function overlayHeaderBox(host: HTMLElement): { bottom: number; right: number } | null {
  const overlay = [...host.children].find((el) => el.tagName.toLowerCase() === "svg");
  if (!overlay) return null;
  const texts = [...overlay.querySelectorAll("text")];
  if (!texts.some((el) => /^1=/.test(el.textContent ?? ""))) return null;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const node of texts) {
    const size = parseFloat(node.getAttribute("font-size") ?? "16") || 16;
    const x = Number(node.getAttribute("x") ?? 0) + groupX(node, overlay);
    const y = Number(node.getAttribute("y") ?? 0) + groupY(node, overlay);
    const width = size * 0.55 * [...(node.textContent ?? "")].length;
    right = Math.max(right, x + width);
    bottom = Math.max(bottom, y + size * 0.25);
  }
  if (!Number.isFinite(right) || !Number.isFinite(bottom)) return null;
  return { bottom, right };
}

function contentTranslateY(content: Element): number {
  let y = 0;
  const re = /translate\(\s*([-\d.]+)[ ,]+([-\d.]+)\s*\)/g;
  const tf = content.getAttribute("transform") ?? "";
  for (let m = re.exec(tf); m; m = re.exec(tf)) y += Number(m[2]);
  return y;
}

/**
 * How far above the usual mark position the stacked chord tones reach (0 when none), so marks
 * sit over the whole stack instead of on top of its upper digits.
 */
function stackClearance(content: Element): number {
  let top = 0;
  for (const el of content.querySelectorAll("[data-chord-tone]")) {
    if (el.closest("[data-chord-symbol]")) continue;
    if (el.tagName.toLowerCase() === "circle") {
      top = Math.min(top, Number(el.getAttribute("cy") ?? 0) - Number(el.getAttribute("r") ?? 2));
    } else {
      const size = parseFloat(el.getAttribute("font-size") ?? "26") || 26;
      top = Math.min(top, Number(el.getAttribute("y") ?? 0) - size * 0.8);
    }
  }
  if (top >= 0) return 0;
  // A plain digit's mark baseline is 0.55em above it; leave a small gap over the stack too.
  return Math.max(0, Math.ceil(-top + 4 - 26 * 0.55));
}

function chordMarkLift(host: HTMLElement, content: Element, markSize: number, clearance = 0): number {
  // stackChords() already pushed the line down by the stack height; only the header gap may need more.
  let lift = CHORD_MARK_LIFT;
  const header = overlayHeaderBox(host);
  if (!header) return lift;
  // Marks sit `0.55em` above the digit baseline, in `markSize` type.
  const markTop = contentTranslateY(content) + lift - 26 * 0.55 - clearance - markSize;
  const need = header.bottom + HEADER_CHORD_GAP - markTop;
  if (need > 0) lift += Math.ceil(need);
  return lift;
}

/** Draw lead-sheet marks above the melody line. Voice 2 is left unmarked. */
export function markChordSymbols(
  host: HTMLElement,
  voice: JianpuVoice,
  symbols: readonly ChordSymbol[] | undefined,
  lineEnd = Infinity,
  options?: { leadSheet?: boolean },
) {
  host.querySelectorAll("[data-chord-symbol]").forEach((el) => el.remove());
  if (!symbols?.length || voice.voice !== 0) return false;
  const main = host.querySelectorAll("svg")[1] ?? host.querySelector("svg");
  const content = main?.querySelector<SVGGElement>('g[data-id="main-content"]');
  if (!main || !content) return false;
  const markSize = options?.leadSheet ? LEAD_CHORD_MARK_SIZE : CHORD_MARK_SIZE;
  const clearance = stackClearance(content);
  const lift = chordMarkLift(host, content, markSize, clearance);
  if (content.getAttribute("data-chord-pad") !== "1") {
    content.setAttribute("data-chord-pad", "1");
    const prev = content.getAttribute("transform");
    content.setAttribute("transform", prev ? `${prev} translate(0, ${lift})` : `translate(0, ${lift})`);
    const height = Number(main.getAttribute("height") || 0);
    if (height) main.setAttribute("height", String(height + lift));
    // The host is overflow:hidden at the library's original height; grow it so
    // the lowered notes and the new gap under `1=X` are not clipped.
    const next = height ? height + lift : lift;
    const current = parseFloat(host.style.height || "") || 0;
    if (next > current) host.style.height = `${next}px`;
  }
  const offset = voice.offset ?? 0;
  const doc = main.ownerDocument;
  const layer = doc.createElementNS(SVG_NS, "g");
  layer.setAttribute("data-chord-symbol", "");
  layer.setAttribute("aria-hidden", "true");
  layer.setAttribute("pointer-events", "none");
  let drawn = 0;
  for (const symbol of symbols) {
    if (symbol.at < offset - 1e-6 || symbol.at >= lineEnd - 1e-6) continue;
    let x: number | null = null;
    let y = 0;
    let size = 26;
    for (const group of content.querySelectorAll<SVGGElement>("g[data-id]")) {
      const match = /^block-(\d+(?:\.\d+)?)$/.exec(group.dataset.id ?? "");
      if (!match) continue;
      const at = Number(match[1]) + offset;
      if (Math.abs(at - symbol.at) > 1e-6) continue;
      const digit = [...group.querySelectorAll("text")].find((el) => !el.hasAttribute("data-chord-tone") && /\d/.test(el.textContent ?? ""));
      const dash = digit ? null : /translate\(\s*([-\d.]+)/.exec(group.querySelector("path")?.getAttribute("transform") ?? "");
      if (!digit && !dash) continue;
      x = (digit ? Number(digit.getAttribute("x") ?? 0) : Number(dash![1])) + groupX(group, content);
      if (digit) {
        size = parseFloat(digit.getAttribute("font-size") ?? "26") || 26;
        y = Number(digit.getAttribute("y") ?? 0);
      }
      break;
    }
    if (x == null) continue;
    // Middle-anchored marks at x=0 would be clipped by the host's overflow.
    const half = Math.max(markSize * 0.35, [...symbol.symbol].length * markSize * 0.32);
    x = Math.max(x, half + 1);
    const text = doc.createElementNS(SVG_NS, "text");
    text.setAttribute("x", String(x));
    text.setAttribute("y", String(y - size * 0.55 - clearance));
    text.setAttribute("font-size", String(markSize));
    text.setAttribute("font-family", "var(--font-sans)");
    text.setAttribute("font-weight", options?.leadSheet ? "600" : "500");
    text.setAttribute("fill", options?.leadSheet ? "#a44825" : "#1c1916");
    text.setAttribute("text-anchor", "middle");
    text.setAttribute("data-chord-at", String(symbol.at));
    text.textContent = symbol.symbol;
    layer.append(text);
    drawn += 1;
  }
  if (!drawn) return false;
  content.append(layer);
  return true;
}

function groupX(group: Element, stop: Element) {
  let x = 0;
  for (let el: Element | null = group; el && el !== stop; el = el.parentElement) {
    const m = /translate\(\s*([-\d.]+)/.exec(el.getAttribute("transform") ?? "");
    if (m) x += Number(m[1]);
  }
  return x;
}

function groupY(group: Element, stop: Element) {
  let y = 0;
  for (let el: Element | null = group; el && el !== stop; el = el.parentElement) {
    const m = /translate\(\s*([-\d.]+)[ ,]+([-\d.]+)\s*\)/.exec(el.getAttribute("transform") ?? "");
    if (m) y += Number(m[2]);
  }
  return y;
}

/** What a click on a rendered line points at: a note or rest, or an insertion point at a barline. */
export type JianpuTarget = { kind: "note"; index: number } | { kind: "cursor"; cursor: number };

const BARLINE_D = /^m\s*0\s*,\s*-50\s+v\s*100/i;
/** Half-width of the invisible tap area over a barline (the drawn line is ~1px). */
const BAR_HIT = 9;

function blockStart(group: Element): number | null {
  const match = /^block-(\d+(?:\.\d+)?)$/.exec(group.getAttribute("data-id") ?? "");
  return match ? Number(match[1]) : null;
}

/** x of a block's first digit (or tie dash) in main-content coordinates. */
function blockX(group: SVGGElement, content: Element): number | null {
  const digit = [...group.querySelectorAll("text")].find((el) => !el.hasAttribute("data-chord-tone") && /\d/.test(el.textContent ?? ""));
  const dash = digit ? null : /translate\(\s*([-\d.]+)/.exec(group.querySelector("path")?.getAttribute("transform") ?? "");
  if (!digit && !dash) return null;
  return (digit ? Number(digit.getAttribute("x") ?? 0) : Number(dash![1])) + groupX(group, content);
}

/**
 * Lays an invisible tap area over every barline. Its `data-bar-cursor` is the
 * voice-wide insertion index right after the barline (the tap pad's cursor),
 * so a tap there places input at the start of the next bar.
 */
export function markBarlines(host: HTMLElement, voice: JianpuVoice) {
  host.querySelectorAll("[data-bar-cursor]").forEach((el) => el.remove());
  const main = host.querySelectorAll("svg")[1] ?? host.querySelector("svg");
  const content = main?.querySelector<SVGGElement>('g[data-id="main-content"]');
  const music = content?.querySelector<SVGGElement>('g[data-id="music"]');
  if (!main || !content || !music || !voice.hits.length) return 0;
  const blocks: { x: number; start: number }[] = [];
  for (const group of music.querySelectorAll<SVGGElement>("g[data-id]")) {
    const start = blockStart(group);
    if (start === null) continue;
    const x = blockX(group, content);
    if (x !== null) blocks.push({ x, start });
  }
  const doc = main.ownerDocument;
  let drawn = 0;
  for (const path of [...music.children]) {
    if (path.tagName.toLowerCase() !== "path" || !BARLINE_D.test(path.getAttribute("d") ?? "")) continue;
    const m = /translate\(\s*([-\d.]+)/.exec(path.getAttribute("transform") ?? "");
    if (!m) continue;
    const x = Number(m[1]) + groupX(music, content);
    const before = blocks.filter((b) => b.x < x);
    const last = before.length ? Math.max(...before.map((b) => b.start)) : null;
    const hit = last === null ? undefined : jianpuHitAt(voice.hits, last);
    const cursor = hit ? hit.index + 1 : voice.hits[0].index;
    const min = minHitUnits(main as SVGSVGElement);
    const box = expandRect(x - BAR_HIT, -28, BAR_HIT * 2, 50, min);
    const rect = doc.createElementNS(SVG_NS, "rect");
    rect.setAttribute("x", String(box.x));
    rect.setAttribute("y", String(box.y));
    rect.setAttribute("width", String(box.width));
    rect.setAttribute("height", String(box.height));
    rect.setAttribute("rx", "8");
    rect.setAttribute("fill", "transparent");
    rect.setAttribute("data-bar-cursor", String(cursor));
    rect.setAttribute("class", "jianpu-bar-target");
    content.append(rect);
    drawn += 1;
  }
  return drawn;
}

/**
 * Invisible pads under every note and rest, grown to at least 44 CSS pixels
 * so a finger can hit a digit or a 0 without landing exactly on the ink.
 */
export function markNoteHits(host: HTMLElement): number {
  host.querySelectorAll(".jianpu-note-target").forEach((el) => el.remove());
  const main = host.querySelectorAll("svg")[1] ?? host.querySelector("svg");
  if (!main) return 0;
  const min = minHitUnits(main as SVGSVGElement);
  const doc = main.ownerDocument;
  let drawn = 0;
  for (const group of host.querySelectorAll<SVGGElement>("g[data-id]")) {
    const id = group.dataset.id ?? "";
    const isNote = /^\d+(?:\.\d+)?-\d+$/.test(id);
    const isRestBlock = id.startsWith("block-") && !group.querySelector("g[data-id]");
    if (!isNote && !isRestBlock) continue;
    let bbox: { x: number; y: number; width: number; height: number };
    try {
      bbox = group.getBBox();
    } catch {
      continue;
    }
    if (!bbox.width && !bbox.height) continue;
    const box = expandRect(bbox.x, bbox.y, bbox.width || 8, bbox.height || 12, min);
    const rect = doc.createElementNS(SVG_NS, "rect");
    rect.setAttribute("x", String(box.x));
    rect.setAttribute("y", String(box.y));
    rect.setAttribute("width", String(box.width));
    rect.setAttribute("height", String(box.height));
    rect.setAttribute("rx", "8");
    rect.setAttribute("class", "jianpu-note-target");
    rect.setAttribute("fill", "transparent");
    group.insertBefore(rect, group.firstChild);
    drawn += 1;
  }
  return drawn;
}

/**
 * Prefer the nearest 44px pad under a point. Notes win ties over barlines so
 * an enlarged bar target cannot steal a digit that sits next to it.
 */
export function jianpuTargetAt(
  voice: JianpuVoice,
  host: HTMLElement,
  clientX: number,
  clientY: number,
  element: Element | null = null,
): JianpuTarget | undefined {
  type Candidate = { target: JianpuTarget; distance: number; note: boolean; inside: boolean };
  const candidates: Candidate[] = [];
  for (const el of host.querySelectorAll<SVGGraphicsElement>(".jianpu-note-target, [data-bar-cursor], g[data-id]")) {
    const rect = el.getBoundingClientRect();
    if (!rect.width && !rect.height) continue;
    const inside = hitContains(rect, clientX, clientY);
    const near = hitDistance(rect, clientX, clientY) <= 24;
    if (!inside && !near) continue;
    const target = jianpuTargetOf(voice, el);
    if (!target) continue;
    candidates.push({
      target,
      distance: hitDistance(rect, clientX, clientY),
      note: target.kind === "note",
      inside,
    });
  }
  if (!candidates.length) return jianpuTargetOf(voice, element);
  candidates.sort((a, b) => Number(b.inside) - Number(a.inside) || Number(b.note) - Number(a.note) || a.distance - b.distance);
  return candidates[0].target;
}

/** Note, rest, or barline under a click; undefined for empty paper. */
export function jianpuTargetOf(voice: JianpuVoice, element: Element | null): JianpuTarget | undefined {
  if (!element) return undefined;
  const bar = element.closest("[data-bar-cursor]");
  if (bar) return { kind: "cursor", cursor: Number(bar.getAttribute("data-bar-cursor")) };
  const note = element.closest("g[data-id]");
  const match = /^(\d+(?:\.\d+)?)-(\d+)$/.exec(note?.getAttribute("data-id") ?? "");
  if (match) {
    const hit = jianpuHitAt(voice.hits, Number(match[1]), Number(match[2]));
    return hit ? { kind: "note", index: hit.index } : undefined;
  }
  // Rests are bare `0` digits inside a block group; a rest longer than a beat
  // prints several, all mapped back to the same rest.
  const block = element.closest("g[data-id^='block-']");
  const start = block ? blockStart(block) : null;
  if (start === null) return undefined;
  const hit = jianpuHitAt(voice.hits, start);
  return hit && !hit.pitches.length ? { kind: "note", index: hit.index } : undefined;
}

/** Small 1–5 marks next to visible digits. Voice rows use that voice's notes. */
export function markFingerings(
  host: HTMLElement,
  voice: JianpuVoice,
  notes: readonly { pitches: number[]; fingers?: number[] }[],
  enabled: boolean,
  lineEnd = Infinity,
) {
  host.querySelectorAll("[data-fingering]").forEach((el) => el.remove());
  if (!enabled || !notes.length) return false;
  const main = host.querySelectorAll("svg")[1] ?? host.querySelector("svg");
  const content = main?.querySelector<SVGGElement>('g[data-id="main-content"]');
  if (!main || !content) return false;
  const offset = voice.offset ?? 0;
  const doc = main.ownerDocument;
  let drawn = 0;
  for (const group of content.querySelectorAll<SVGGElement>("g[data-id]")) {
    const match = /^(\d+(?:\.\d+)?)-(\d+)$/.exec(group.dataset.id ?? "");
    const hit = match ? jianpuHitAt(voice.hits, Number(match[1]), Number(match[2])) : undefined;
    if (!hit) continue;
    const at = Number(match![1]) + offset;
    if (at >= lineEnd - 1e-6) continue;
    const note = notes[hit.index];
    const fingers = note?.fingers;
    if (!note || !fingers?.length) continue;
    const texts = [...group.querySelectorAll("text")].filter((el) => /\d/.test(el.textContent ?? ""));
    const targets = texts.length ? texts : [];
    targets.forEach((digit, index) => {
      const finger = fingers[index] ?? fingers[0];
      if (!(finger >= 1 && finger <= 5)) return;
      const text = doc.createElementNS(SVG_NS, "text");
      const size = parseFloat(digit.getAttribute("font-size") ?? "26") || 26;
      text.setAttribute("x", String(Number(digit.getAttribute("x") ?? 0) + size * 0.55));
      text.setAttribute("y", String(Number(digit.getAttribute("y") ?? 0) - size * 0.15));
      text.setAttribute("font-size", "9");
      text.setAttribute("font-family", "var(--font-sans)");
      text.setAttribute("fill", "#6b6458");
      text.setAttribute("text-anchor", "start");
      text.setAttribute("data-fingering", String(finger));
      text.textContent = String(finger);
      // Place in the group's coordinate space.
      group.append(text);
      drawn += 1;
    });
  }
  if (!drawn) return false;
  return true;
}

/** Includes tied segments; uses the existing clock's original note index. */
export function paintJianpu(
  host: HTMLElement,
  voice: JianpuVoice,
  active: number[],
  selected: number[],
  cursor: number | null = null,
) {
  for (const rect of host.querySelectorAll<SVGRectElement>("[data-bar-cursor]")) {
    const on = cursor !== null && Number(rect.getAttribute("data-bar-cursor")) === cursor;
    rect.setAttribute("fill", on ? "rgba(42, 111, 219, 0.18)" : "transparent");
    rect.classList.toggle("is-cursor", on);
  }
  for (const group of host.querySelectorAll<SVGGElement>("g[data-id]")) {
    const id = group.dataset.id ?? "";
    const match = /^(\d+(?:\.\d+)?)-(\d+)$/.exec(id);
    let hit = match ? jianpuHitAt(voice.hits, Number(match[1]), Number(match[2])) : undefined;
    if (!match) {
      // A rest block: digits sit directly in the block, with no note group inside.
      const start = blockStart(group);
      if (start === null || group.querySelector("g[data-id]")) continue;
      const rest = jianpuHitAt(voice.hits, start);
      hit = rest && !rest.pitches.length ? rest : undefined;
    }
    if (!hit) continue;
    const playing = active.includes(hit.index);
    const picked = selected.includes(hit.index);
    group.classList.toggle("is-sounding", playing);
    group.classList.toggle("is-chosen", picked);
    // Selection is blue; red stays reserved for out-of-range warnings.
    group.style.color = playing ? "#a44825" : picked ? "#2a6fdb" : "#1c1916";
    group.style.fontWeight = playing || picked ? "700" : "";
    group.style.filter = picked ? "drop-shadow(0 0 2px #2a6fdb)" : "";
    for (const element of group.querySelectorAll<SVGElement>("[fill], [stroke]")) {
      if (element.getAttribute("fill") !== null && element.getAttribute("fill") !== "none")
        element.setAttribute("fill", "currentColor");
      if (element.getAttribute("stroke") !== null && element.getAttribute("stroke") !== "none")
        element.setAttribute("stroke", "currentColor");
    }
  }
}

/**
 * Repeat signs and 1st / 2nd ending brackets on one rendered line. Positions are
 * score quarters on bar lines; the line's own barline paths give the x of each.
 */
export function markRepeats(
  host: HTMLElement,
  voice: JianpuVoice,
  repeats: readonly { from: number; to: number; ending?: number; endingEnd?: number }[] | undefined,
  lineEnd = Infinity,
  jumps?: { segno?: number; coda?: number; fine?: number; toCoda?: number; dc?: number; ds?: number },
) {
  host.querySelectorAll("[data-repeat-marks]").forEach((el) => el.remove());
  const hasJumps = Boolean(jumps && (voice.voice ?? 0) === 0 && Object.values(jumps).some((v) => v !== undefined));
  if (!repeats?.length && !hasJumps) return 0;
  const main = host.querySelectorAll("svg")[1] ?? host.querySelector("svg");
  const content = main?.querySelector<SVGGElement>('g[data-id="main-content"]');
  const music = content?.querySelector<SVGGElement>('g[data-id="music"]');
  if (!main || !content || !music) return 0;
  const offset = voice.offset ?? 0;
  const blocks: { x: number; start: number }[] = [];
  for (const group of music.querySelectorAll<SVGGElement>("g[data-id]")) {
    const start = blockStart(group);
    const x = start === null ? null : blockX(group, content);
    if (start !== null && x !== null) blocks.push({ x, start: start + offset });
  }
  if (!blocks.length) return 0;
  const lineStart = Math.min(...blocks.map((b) => b.start));
  const lastStart = Math.max(...blocks.map((b) => b.start));
  // Bar line x by score quarter; the line start sits just left of the first digit.
  const lines = new Map<number, { x: number; top: number; bottom: number }>();
  let top = -26, bottom = 24;
  for (const path of [...music.children]) {
    if (path.tagName.toLowerCase() !== "path" || !BARLINE_D.test(path.getAttribute("d") ?? "")) continue;
    const t = /translate\(\s*([-\d.]+)[ ,]*([-\d.]+)?\s*\)/.exec(path.getAttribute("transform") ?? "");
    if (!t) continue;
    const sc = /scale\(\s*([-\d.]+)[ ,]*([-\d.]+)?\s*\)/.exec(path.getAttribute("transform") ?? "");
    const sy = sc ? Number(sc[2] ?? sc[1]) : 1;
    const x = Number(t[1]) + groupX(music, content);
    const y = Number(t[2] ?? 0) + groupY(music, content);
    top = y - 50 * sy;
    bottom = y + 50 * sy;
    const after = blocks.filter((b) => b.x > x).map((b) => b.start);
    const at = after.length ? Math.min(...after) : Math.min(lineEnd, Infinity);
    lines.set(Math.round((Number.isFinite(at) ? at : lastStart + 1e6) * 1e4) / 1e4, { x, top, bottom });
  }
  const firstX = Math.min(...blocks.map((b) => b.x)) - 14;
  const xAt = (q: number): number | null => {
    if (Math.abs(q - lineStart) < 1e-6) return firstX;
    for (const [at, line] of lines) if (Math.abs(at - q) < 1e-6) return line.x;
    return null;
  };
  // Final bar line of the line (end of the music, or the line break).
  const rightX = Math.max(...[...lines.values()].map((l) => l.x), ...blocks.map((b) => b.x + 20));
  const doc = main.ownerDocument;
  const layer = doc.createElementNS(SVG_NS, "g");
  layer.setAttribute("data-repeat-marks", "");
  layer.setAttribute("aria-hidden", "true");
  layer.setAttribute("pointer-events", "none");
  const ink = "#1c1916";
  const add = (tag: string, attrs: Record<string, string | number>, text?: string, parent: Element = layer) => {
    const el = doc.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
    if (text) el.textContent = text;
    parent.append(el);
    return el;
  };
  const mid = (top + bottom) / 2, gap = Math.max(6, (bottom - top) * 0.16);
  const sign = (x: number, dir: 1 | -1, kind: string) => {
    // Thick line on the outside, thin line, then two dots toward the repeated music.
    add("rect", { x: x - (dir === 1 ? 0 : 3), y: top, width: 3, height: bottom - top, fill: ink, "data-repeat": kind });
    add("rect", { x: x + dir * 6 - 0.5, y: top, width: 1, height: bottom - top, fill: ink });
    for (const dy of [-gap, gap]) add("circle", { cx: x + dir * 11, cy: mid + dy, r: 2.4, fill: ink });
  };
  // Chord names (drawn first) own the row just above the digits; endings and jumps go above them.
  let chordTop = Infinity;
  for (const mark of content.querySelectorAll("[data-chord-symbol] text")) {
    const y = Number(mark.getAttribute("y"));
    const size = parseFloat(mark.getAttribute("font-size") ?? "") || 14;
    if (Number.isFinite(y)) chordTop = Math.min(chordTop, y - size);
  }
  // The bracket ticks and its "1." hang 14px below the line, so they must clear the chord row too.
  const bracketY = Math.min(top - 14, chordTop - 16);
  const bracket = (from: number, to: number, label: string, closed: boolean) => {
    if (to <= lineStart + 1e-6 || from >= lineEnd - 1e-6) return;
    const x1 = from >= lineStart - 1e-6 ? (xAt(from) ?? firstX) : firstX;
    const x2 = to <= lineEnd + 1e-6 ? (xAt(to) ?? rightX) : rightX;
    const starts = from >= lineStart - 1e-6;
    const ends = closed && to <= lineEnd + 1e-6;
    add("path", { d: `M ${x1 + 2} ${starts ? bracketY + 14 : bracketY} V ${bracketY} H ${x2 - 3}${ends ? ` V ${bracketY + 14}` : ""}`, fill: "none", stroke: ink, "stroke-width": 1.4, "data-ending": label });
    if (starts) add("text", { x: x1 + 6, y: bracketY + 13, "font-size": 15, fill: ink }, `${label}.`);
  };
  let drawn = 0;
  let jumpTop = bracketY - 4;
  if (hasJumps && jumps) {
    // Above the ending brackets: Segno / Coda at a bar start, Fine / To Coda / D.C. / D.S. right-aligned at a bar end.
    const baseY = bracketY - 10;
    const jump = jumps.dc !== undefined ? "D.C." : jumps.ds !== undefined ? "D.S." : "";
    const tail = jumps.fine !== undefined ? " al Fine" : jumps.toCoda !== undefined ? " al Coda" : "";
    const marks: [number | undefined, string, "start" | "end"][] = [
      [jumps.segno, "segno", "start"], [jumps.coda, "coda", "start"],
      [jumps.fine, "fine", "end"], [jumps.toCoda, "toCoda", "end"], [jumps.dc ?? jumps.ds, "jump", "end"],
    ];
    // Marks on narrow bars stack upward instead of overprinting each other.
    const rows: [number, number][][] = [];
    for (const [q, kind, side] of marks) {
      if (q === undefined) continue;
      if (side === "start" ? !(q >= lineStart - 1e-6 && q < lineEnd - 1e-6) : !(q > lineStart + 1e-6 && q <= lineEnd + 1e-6)) continue;
      const x = side === "start" ? xAt(q) : xAt(q) ?? (Math.abs(q - lineEnd) < 1e-6 || !Number.isFinite(lineEnd) ? rightX : null);
      if (x === null) continue;
      const label = kind === "segno" ? "" : kind === "coda" ? "Coda" : kind === "fine" ? "Fine" : kind === "toCoda" ? "To Coda" : `${jump}${tail}`;
      const width = (kind === "segno" ? 22 : kind === "coda" ? 24 : 0) + label.length * 7;
      const span: [number, number] = side === "start" ? [x, x + width] : [x - 4 - width, x];
      let row = 0;
      while (rows[row]?.some(([a, b]) => span[0] < b + 4 && span[1] > a - 4)) row += 1;
      (rows[row] ??= []).push(span);
      const y = baseY - row * 16;
      jumpTop = Math.min(jumpTop, y - 18);
      const g = add("g", { "data-jump": kind });
      const text = (tx: number, value: string, anchor = "start") =>
        add("text", { x: tx, y, "font-size": 13, "font-style": "italic", "text-anchor": anchor, fill: ink }, value, g);
      if (kind === "segno") {
        // Drawn, not a font glyph: an italic S with a slash and two dots.
        add("text", { x: x + 8, y, "font-size": 20, "font-style": "italic", "font-family": "serif", fill: ink }, "S", g);
        add("path", { d: `M ${x + 5} ${y - 2} L ${x + 19} ${y - 16}`, stroke: ink, "stroke-width": 1.3 }, undefined, g);
        add("circle", { cx: x + 7, cy: y - 12, r: 1.6, fill: ink }, undefined, g);
        add("circle", { cx: x + 18, cy: y - 4, r: 1.6, fill: ink }, undefined, g);
      } else if (kind === "coda") {
        add("ellipse", { cx: x + 12, cy: y - 6, rx: 5, ry: 6.5, fill: "none", stroke: ink, "stroke-width": 1.6 }, undefined, g);
        add("path", { d: `M ${x + 3} ${y - 6} H ${x + 21} M ${x + 12} ${y - 15} V ${y + 3}`, stroke: ink, "stroke-width": 1.2 }, undefined, g);
        text(x + 24, label);
      } else text(x - 4, label, "end");
      drawn++;
    }
  }
  for (const r of repeats ?? []) {
    if (r.from >= lineStart - 1e-6 && r.from < lineEnd - 1e-6) {
      const x = xAt(r.from);
      if (x !== null) { sign(x, 1, "start"); drawn++; }
    }
    if (r.to > lineStart + 1e-6 && r.to <= lineEnd + 1e-6) {
      const x = xAt(r.to) ?? (Math.abs(r.to - lineEnd) < 1e-6 || !Number.isFinite(lineEnd) ? rightX : null);
      if (x !== null) { sign(x, -1, "end"); drawn++; }
    }
    if (r.ending !== undefined) { bracket(r.ending, r.to, "1", true); drawn++; }
    if (r.endingEnd !== undefined) { bracket(r.to, r.endingEnd, "2", false); drawn++; }
  }
  content.append(layer);
  // Make room above the line once: clear the `1=X` header and the SVG top edge.
  if (drawn && content.getAttribute("data-repeat-pad") == null) {
    const markTop = contentTranslateY(content) + jumpTop;
    const header = overlayHeaderBox(host);
    const lift = Math.max(0, Math.ceil((header ? header.bottom + 6 : 2) - markTop));
    content.setAttribute("data-repeat-pad", String(lift));
    if (lift) {
      const prev = content.getAttribute("transform");
      content.setAttribute("transform", prev ? `${prev} translate(0, ${lift})` : `translate(0, ${lift})`);
      const height = Number(main.getAttribute("height") || 0);
      if (height) main.setAttribute("height", String(height + lift));
      const current = parseFloat(host.style.height || "") || 0;
      const next = height ? height + lift : lift;
      if (next > current) host.style.height = `${next}px`;
    }
  }
  return drawn;
}

/** Boxed section labels at the bar start, stacked above chord names and jumps. */
export function markRehearsals(
  host: HTMLElement,
  voice: JianpuVoice,
  marks: readonly { at: number; label: string }[] | undefined,
  lineEnd = Infinity,
) {
  host.querySelectorAll("[data-rehearsal-marks]").forEach((el) => el.remove());
  if (!marks?.length || (voice.voice ?? 0) !== 0) return 0;
  const main = host.querySelectorAll("svg")[1] ?? host.querySelector("svg");
  const content = main?.querySelector<SVGGElement>('g[data-id="main-content"]');
  const music = content?.querySelector<SVGGElement>('g[data-id="music"]');
  if (!main || !content || !music) return 0;
  const offset = voice.offset ?? 0;
  const blocks: { x: number; start: number }[] = [];
  for (const group of music.querySelectorAll<SVGGElement>("g[data-id]")) {
    const start = blockStart(group);
    const x = start === null ? null : blockX(group, content);
    if (start !== null && x !== null) blocks.push({ x, start: start + offset });
  }
  if (!blocks.length) return 0;
  const lineStart = Math.min(...blocks.map((b) => b.start));
  const firstX = Math.min(...blocks.map((b) => b.x)) - 4;
  const xAt = (q: number): number | null => {
    if (Math.abs(q - lineStart) < 1e-6) return firstX;
    const hit = blocks.filter((b) => Math.abs(b.start - q) < 1e-6);
    if (hit.length) return Math.min(...hit.map((b) => b.x));
    const after = blocks.filter((b) => b.start >= q - 1e-6);
    return after.length ? Math.min(...after.map((b) => b.x)) : null;
  };
  let top = Infinity;
  for (const el of content.querySelectorAll<SVGElement>("[data-chord-symbol] text, [data-repeat-marks] text, [data-repeat-marks] path, [data-repeat-marks] rect")) {
    const y = Number(el.getAttribute("y"));
    if (Number.isFinite(y)) top = Math.min(top, y - (parseFloat(el.getAttribute("font-size") ?? "") || 12));
    const d = el.getAttribute("d") ?? "";
    const m = /V\s+([-.\d]+)/.exec(d) || /[My]\s*=?\s*([-.\d]+)/.exec(el.getAttribute("d") ?? "");
    if (el.tagName.toLowerCase() === "path") {
      const ys = [...d.matchAll(/[-+]?\d*\.?\d+/g)].map((n) => Number(n[0])).filter((n) => Number.isFinite(n));
      // paths mix x and y; skip rough parse, use bbox if available
      try {
        const box = (el as SVGGraphicsElement).getBBox();
        if (box) top = Math.min(top, box.y);
      } catch { /* not in document */ }
    }
    if (el.tagName.toLowerCase() === "rect") {
      const ry = Number(el.getAttribute("y"));
      if (Number.isFinite(ry)) top = Math.min(top, ry);
    }
  }
  if (!Number.isFinite(top)) top = -26;
  const y = top - 16;
  const doc = main.ownerDocument;
  const layer = doc.createElementNS(SVG_NS, "g");
  layer.setAttribute("data-rehearsal-marks", "");
  layer.setAttribute("aria-hidden", "true");
  layer.setAttribute("pointer-events", "none");
  let drawn = 0;
  for (const mark of marks) {
    if (mark.at < lineStart - 1e-6 || mark.at >= lineEnd - 1e-6) continue;
    const x = xAt(mark.at);
    if (x == null) continue;
    const text = doc.createElementNS(SVG_NS, "text");
    text.setAttribute("x", String(x));
    text.setAttribute("y", String(y));
    text.setAttribute("font-size", "13");
    text.setAttribute("font-family", "var(--font-sans)");
    text.setAttribute("font-weight", "600");
    text.setAttribute("fill", "#1c1916");
    text.setAttribute("text-anchor", "start");
    text.setAttribute("data-rehearsal-at", String(mark.at));
    text.textContent = `【${mark.label}】`;
    layer.append(text);
    drawn += 1;
  }
  if (!drawn) return 0;
  content.append(layer);
  // Grow the host if the label sits above the current top.
  const height = Number(main.getAttribute("height") || 0);
  const lift = Math.max(0, 8 - y);
  if (lift && height) {
    const prev = content.getAttribute("transform");
    if (!content.getAttribute("data-rehearsal-pad")) {
      content.setAttribute("data-rehearsal-pad", "1");
      content.setAttribute("transform", prev ? `${prev} translate(0, ${lift})` : `translate(0, ${lift})`);
      main.setAttribute("height", String(height + lift));
      const current = parseFloat(host.style.height || "") || 0;
      if (height + lift > current) host.style.height = `${height + lift}px`;
    }
  }
  return drawn;
}

/** Small measure numbers at the start of each bar, as in published jianpu. Voice 1 only. */
export function markBarNumbers(
  host: HTMLElement,
  voice: JianpuVoice,
  score: Pick<Score, "beats" | "beatUnit" | "changes">,
  lineEnd = Infinity,
) {
  host.querySelectorAll("[data-bar-numbers]").forEach((el) => el.remove());
  if ((voice.voice ?? 0) !== 0) return 0;
  const main = host.querySelectorAll("svg")[1] ?? host.querySelector("svg");
  const content = main?.querySelector<SVGGElement>('g[data-id="main-content"]');
  const music = content?.querySelector<SVGGElement>('g[data-id="music"]');
  if (!main || !content || !music) return 0;
  const offset = voice.offset ?? 0;
  const blocks: { x: number; start: number }[] = [];
  for (const group of music.querySelectorAll<SVGGElement>("g[data-id]")) {
    const start = blockStart(group);
    const x = start === null ? null : blockX(group, content);
    if (start !== null && x !== null) blocks.push({ x, start: start + offset });
  }
  if (!blocks.length) return 0;
  const lineStart = Math.min(...blocks.map((b) => b.start));
  const firstX = Math.min(...blocks.map((b) => b.x)) - 4;
  const xAt = (q: number): number | null => {
    if (Math.abs(q - lineStart) < 1e-6) return firstX;
    const hit = blocks.filter((b) => Math.abs(b.start - q) < 1e-6);
    if (hit.length) return Math.min(...hit.map((b) => b.x));
    const after = blocks.filter((b) => b.start >= q - 1e-6);
    return after.length ? Math.min(...after.map((b) => b.x)) : null;
  };
  let digitY = 0;
  for (const el of music.querySelectorAll("text")) {
    if (/\d/.test(el.textContent ?? "")) {
      const y = Number(el.getAttribute("y"));
      if (Number.isFinite(y)) {
        digitY = y;
        break;
      }
    }
  }
  let rehearsalY = Infinity;
  for (const el of host.querySelectorAll("[data-rehearsal-marks] text")) {
    const y = Number(el.getAttribute("y"));
    if (Number.isFinite(y)) rehearsalY = Math.min(rehearsalY, y);
  }
  const y = Number.isFinite(rehearsalY) ? rehearsalY + 14 : digitY - 22;
  const doc = main.ownerDocument;
  const layer = doc.createElementNS(SVG_NS, "g");
  layer.setAttribute("data-bar-numbers", "");
  layer.setAttribute("aria-hidden", "true");
  layer.setAttribute("pointer-events", "none");
  const horizon = Number.isFinite(lineEnd) ? lineEnd : lineStart + Math.max(0, ...blocks.map((b) => b.start)) + 8;
  let t = 0;
  let n = 1;
  let drawn = 0;
  while (t < horizon + 8) {
    if (t >= lineStart - 1e-6 && t < lineEnd - 1e-6) {
      const x = xAt(t);
      if (x != null) {
        const text = doc.createElementNS(SVG_NS, "text");
        text.setAttribute("x", String(x));
        text.setAttribute("y", String(y));
        text.setAttribute("font-size", "10");
        text.setAttribute("font-family", "var(--font-sans)");
        text.setAttribute("fill", "#1c1916");
        text.setAttribute("opacity", "0.72");
        text.setAttribute("text-anchor", "start");
        text.setAttribute("data-bar-number", String(n));
        text.textContent = String(n);
        layer.append(text);
        drawn += 1;
      }
    }
    const nxt = nextBar(score, t);
    if (!Number.isFinite(nxt) || nxt <= t + 1e-9) break;
    t = nxt;
    n += 1;
    if (n > 400) break;
  }
  if (!drawn) return 0;
  content.append(layer);
  const height = Number(main.getAttribute("height") || 0);
  const lift = Math.max(0, 8 - y);
  if (lift && height && !content.getAttribute("data-bar-number-pad")) {
    content.setAttribute("data-bar-number-pad", "1");
    const prev = content.getAttribute("transform");
    content.setAttribute("transform", prev ? `${prev} translate(0, ${lift})` : `translate(0, ${lift})`);
    main.setAttribute("height", String(height + lift));
    const current = parseFloat(host.style.height || "") || 0;
    if (height + lift > current) host.style.height = `${height + lift}px`;
  }
  return drawn;
}

/** Draw a fermata (arc + dot) above the note or rest it belongs to. */
export function markFermatas(
  host: HTMLElement,
  voice: JianpuVoice,
  marks: readonly { voice: number; at: number }[] | undefined,
  lineEnd = Infinity,
) {
  host.querySelectorAll("[data-fermata-marks], [data-fermata-at]").forEach((el) => el.remove());
  const mine = (marks ?? []).filter((m) => m.voice === (voice.voice ?? 0));
  if (!mine.length) return 0;
  const main = host.querySelectorAll("svg")[1] ?? host.querySelector("svg");
  const content = main?.querySelector<SVGGElement>('g[data-id="main-content"]');
  if (!main || !content) return 0;
  const offset = voice.offset ?? 0;
  const doc = main.ownerDocument;
  const layer = doc.createElementNS(SVG_NS, "g");
  layer.setAttribute("data-fermata-marks", "");
  layer.setAttribute("aria-hidden", "true");
  layer.setAttribute("pointer-events", "none");
  let drawn = 0;
  const placed = new Set<number>();
  const attach = (group: SVGGElement, at: number) => {
    if (placed.has(Math.round(at * 1e6))) return;
    const hit = mine.some((m) => Math.abs(m.at - at) < 1e-6);
    if (!hit) return;
    const texts = [...group.querySelectorAll("text")];
    const anchor = texts[0];
    let x = 0;
    let y = 0;
    if (anchor) {
      x = Number(anchor.getAttribute("x") ?? 0);
      const size = parseFloat(anchor.getAttribute("font-size") ?? "26") || 26;
      y = Number(anchor.getAttribute("y") ?? 0) - size * 0.85;
    } else {
      try {
        const box = group.getBBox();
        x = box.x + box.width / 2;
        y = box.y - 6;
      } catch {
        return;
      }
    }
    const path = doc.createElementNS(SVG_NS, "path");
    path.setAttribute("d", `M ${x - 7} ${y} Q ${x} ${y - 8} ${x + 7} ${y}`);
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "#1c1916");
    path.setAttribute("stroke-width", "1.2");
    path.setAttribute("stroke-linecap", "round");
    const dot = doc.createElementNS(SVG_NS, "circle");
    dot.setAttribute("cx", String(x));
    dot.setAttribute("cy", String(y - 1.5));
    dot.setAttribute("r", "1.3");
    dot.setAttribute("fill", "#1c1916");
    const wrap = doc.createElementNS(SVG_NS, "g");
    wrap.setAttribute("data-fermata-at", String(at));
    wrap.setAttribute("data-fermata-voice", String(voice.voice ?? 0));
    wrap.append(path, dot);
    group.append(wrap);
    placed.add(Math.round(at * 1e6));
    drawn += 1;
  };
  for (const group of content.querySelectorAll<SVGGElement>("g[data-id]")) {
    const match = /^(\d+(?:\.\d+)?)-(\d+)$/.exec(group.dataset.id ?? "");
    if (match) {
      const at = Number(match[1]) + offset;
      if (at < lineEnd - 1e-6) attach(group, at);
      continue;
    }
    const start = blockStart(group);
    if (start === null || group.querySelector("g[data-id]")) continue;
    const at = start + offset;
    if (at < lineEnd - 1e-6) attach(group, at);
  }
  if (!drawn) return 0;
  content.append(layer);
  return drawn;
}


/** Visible 1= name already in force strictly before `at`. */
function keyNameBefore(voice: JianpuVoice, at: number): string | undefined {
  let name: string | undefined;
  for (const item of voice.keyNames ?? []) {
    if (item.start > at - 1e-6) break;
    name = item.name;
  }
  return name;
}

/** Mid-score 1= spelling; omitted when the visible name did not change (e.g. fixed-do). */
function keyMarkName(voice: JianpuVoice, at: number, fallback?: string): string | undefined {
  const name = voice.keyNames?.find((item) => Math.abs(item.start - at) <= 1e-6)?.name ?? fallback;
  if (!name) return undefined;
  const prev = keyNameBefore(voice, at);
  if (prev && prev === name) return undefined;
  return name;
}

/** Draw mid-score metronome marks (♩=) above the note they start at. Voice 1 only. */
export function markTempos(
  host: HTMLElement,
  voice: JianpuVoice,
  changes: readonly { at: number; bpm?: number; beats?: number; beatUnit?: number; key?: string }[] | undefined,
  lineEnd = Infinity,
) {
  host.querySelectorAll("[data-tempo-marks]").forEach((el) => el.remove());
  if ((voice.voice ?? 0) !== 0) return 0;
  const marks = (changes ?? []).filter((change) => change.bpm !== undefined && change.at > 1e-6);
  if (!marks.length) return 0;
  const main = host.querySelectorAll("svg")[1] ?? host.querySelector("svg");
  const content = main?.querySelector<SVGGElement>('g[data-id="main-content"]');
  const music = content?.querySelector<SVGGElement>('g[data-id="music"]');
  if (!main || !content || !music) return 0;
  const offset = voice.offset ?? 0;
  const blocks: { x: number; start: number }[] = [];
  for (const group of music.querySelectorAll<SVGGElement>("g[data-id]")) {
    const start = blockStart(group);
    const x = start === null ? null : blockX(group, content);
    if (start !== null && x !== null) blocks.push({ x, start: start + offset });
  }
  if (!blocks.length) return 0;
  const lineStart = Math.min(...blocks.map((b) => b.start));
  const xAt = (q: number): number | null => {
    const hit = blocks.filter((b) => Math.abs(b.start - q) < 1e-6);
    if (hit.length) return Math.min(...hit.map((b) => b.x));
    const after = blocks.filter((b) => b.start >= q - 1e-6);
    return after.length ? Math.min(...after.map((b) => b.x)) : null;
  };
  let digitY = 0;
  for (const el of music.querySelectorAll("text")) {
    if (/\d/.test(el.textContent ?? "")) {
      const y = Number(el.getAttribute("y"));
      if (Number.isFinite(y)) {
        digitY = y;
        break;
      }
    }
  }
  let barY = Infinity;
  for (const el of host.querySelectorAll("[data-bar-numbers] text, [data-fermata-at] path")) {
    if (el.tagName.toLowerCase() === "text") {
      const y = Number(el.getAttribute("y"));
      if (Number.isFinite(y)) barY = Math.min(barY, y);
    } else {
      try {
        const box = (el as SVGGraphicsElement).getBBox();
        if (box) barY = Math.min(barY, box.y);
      } catch { /* not in document */ }
    }
  }
  const y = Number.isFinite(barY) ? barY - 14 : digitY - 36;
  const doc = main.ownerDocument;
  const layer = doc.createElementNS(SVG_NS, "g");
  layer.setAttribute("data-tempo-marks", "");
  layer.setAttribute("aria-hidden", "true");
  layer.setAttribute("pointer-events", "none");
  let drawn = 0;
  for (const mark of marks) {
    if (mark.at < lineStart - 1e-6 || mark.at >= lineEnd - 1e-6) continue;
    // A change that opens a wrapped line is already restated in the line header.
    if (Math.abs(mark.at - lineStart) < 1e-6) continue;
    const x = xAt(mark.at);
    if (x == null) continue;
    const text = doc.createElementNS(SVG_NS, "text");
    text.setAttribute("x", String(x));
    text.setAttribute("y", String(y));
    text.setAttribute("font-size", "11");
    text.setAttribute("font-family", "var(--font-sans)");
    text.setAttribute("font-weight", "600");
    text.setAttribute("fill", "#1c1916");
    text.setAttribute("text-anchor", "start");
    text.setAttribute("data-tempo-at", String(mark.at));
    text.setAttribute("data-tempo-bpm", String(mark.bpm));
    const meter = (changes ?? []).find((change) => change.beats !== undefined && Math.abs((change.at ?? 0) - mark.at) <= 1e-6);
    const keyChange = (changes ?? []).find((change) => change.key !== undefined && Math.abs((change.at ?? 0) - mark.at) <= 1e-6);
    const keyName = keyChange ? keyMarkName(voice, mark.at, keyChange.key) : undefined;
    if (keyName) text.setAttribute("data-key-at", String(mark.at));
    const parts = [];
    if (keyName) parts.push(`1=${keyName}`);
    if (meter) parts.push(`${meter.beats}/${meter.beatUnit}`);
    parts.push(`♩=${mark.bpm}`);
    text.textContent = parts.join(" ");
    layer.append(text);
    drawn += 1;
  }
  if (!drawn) return 0;
  content.append(layer);
  return drawn;
}

/** Draw mid-score time signatures (3/4) above the bar they start at. Voice 1 only. */
export function markMeters(
  host: HTMLElement,
  voice: JianpuVoice,
  changes: readonly { at: number; beats?: number; beatUnit?: number; bpm?: number; key?: string }[] | undefined,
  lineEnd = Infinity,
) {
  host.querySelectorAll("[data-meter-marks]").forEach((el) => el.remove());
  if ((voice.voice ?? 0) !== 0) return 0;
  const marks = (changes ?? []).filter((change) => change.beats !== undefined && change.at > 1e-6);
  if (!marks.length) return 0;
  const main = host.querySelectorAll("svg")[1] ?? host.querySelector("svg");
  const content = main?.querySelector<SVGGElement>('g[data-id="main-content"]');
  const music = content?.querySelector<SVGGElement>('g[data-id="music"]');
  if (!main || !content || !music) return 0;
  const offset = voice.offset ?? 0;
  const blocks: { x: number; start: number }[] = [];
  for (const group of music.querySelectorAll<SVGGElement>("g[data-id]")) {
    const start = blockStart(group);
    const x = start === null ? null : blockX(group, content);
    if (start !== null && x !== null) blocks.push({ x, start: start + offset });
  }
  if (!blocks.length) return 0;
  const lineStart = Math.min(...blocks.map((b) => b.start));
  const xAt = (q: number): number | null => {
    const hit = blocks.filter((b) => Math.abs(b.start - q) < 1e-6);
    if (hit.length) return Math.min(...hit.map((b) => b.x));
    const after = blocks.filter((b) => b.start >= q - 1e-6);
    return after.length ? Math.min(...after.map((b) => b.x)) : null;
  };
  let digitY = 0;
  for (const el of music.querySelectorAll("text")) {
    if (/\d/.test(el.textContent ?? "")) {
      const y = Number(el.getAttribute("y"));
      if (Number.isFinite(y)) {
        digitY = y;
        break;
      }
    }
  }
  let barY = Infinity;
  for (const el of host.querySelectorAll("[data-bar-numbers] text, [data-fermata-at] path")) {
    if (el.tagName.toLowerCase() === "text") {
      const y = Number(el.getAttribute("y"));
      if (Number.isFinite(y)) barY = Math.min(barY, y);
    } else {
      try {
        const box = (el as SVGGraphicsElement).getBBox();
        if (box) barY = Math.min(barY, box.y);
      } catch { /* not in document */ }
    }
  }
  const y = Number.isFinite(barY) ? barY - 14 : digitY - 36;
  const doc = main.ownerDocument;
  const layer = doc.createElementNS(SVG_NS, "g");
  layer.setAttribute("data-meter-marks", "");
  layer.setAttribute("aria-hidden", "true");
  layer.setAttribute("pointer-events", "none");
  let drawn = 0;
  for (const mark of marks) {
    if (mark.at < lineStart - 1e-6 || mark.at >= lineEnd - 1e-6) continue;
    // A change that opens a wrapped line is already restated in the line header.
    if (Math.abs(mark.at - lineStart) < 1e-6) continue;
    // A tempo mark at the same onset already includes the meter in its label.
    if (mark.bpm !== undefined) continue;
    const x = xAt(mark.at);
    if (x == null) continue;
    const textEl = doc.createElementNS(SVG_NS, "text");
    textEl.setAttribute("x", String(x));
    textEl.setAttribute("y", String(y));
    textEl.setAttribute("font-size", "11");
    textEl.setAttribute("font-family", "var(--font-sans)");
    textEl.setAttribute("font-weight", "600");
    textEl.setAttribute("fill", "#1c1916");
    textEl.setAttribute("text-anchor", "start");
    textEl.setAttribute("data-meter-at", String(mark.at));
    textEl.setAttribute("data-meter-beats", String(mark.beats));
    textEl.setAttribute("data-meter-unit", String(mark.beatUnit));
    const keyName = keyMarkName(voice, mark.at, mark.key);
    if (keyName) textEl.setAttribute("data-key-at", String(mark.at));
    textEl.textContent = keyName ? `1=${keyName} ${mark.beats}/${mark.beatUnit}` : `${mark.beats}/${mark.beatUnit}`;
    layer.append(textEl);
    drawn += 1;
  }
  if (!drawn) return 0;
  content.append(layer);
  return drawn;
}

/** Draw mid-score key changes (1=X) above the bar they start at. Voice 1 only.
 *  Do not grow the host: many mid-score marks (e.g. Hungarian Rhapsody No. 2)
 *  would otherwise retrigger a layout loop. */
export function markKeys(
  host: HTMLElement,
  voice: JianpuVoice,
  changes: readonly { at: number; key?: string; beats?: number; beatUnit?: number; bpm?: number }[] | undefined,
  lineEnd = Infinity,
) {
  host.querySelectorAll("[data-key-marks]").forEach((el) => el.remove());
  if ((voice.voice ?? 0) !== 0) return 0;
  const marks = (changes ?? []).filter((change) => change.key !== undefined && change.at > 1e-6);
  if (!marks.length) return 0;
  const main = host.querySelectorAll("svg")[1] ?? host.querySelector("svg");
  const content = main?.querySelector<SVGGElement>('g[data-id="main-content"]');
  const music = content?.querySelector<SVGGElement>('g[data-id="music"]');
  if (!main || !content || !music) return 0;
  const offset = voice.offset ?? 0;
  const blocks: { x: number; start: number }[] = [];
  for (const group of music.querySelectorAll<SVGGElement>("g[data-id]")) {
    const start = blockStart(group);
    const x = start === null ? null : blockX(group, content);
    if (start !== null && x !== null) blocks.push({ x, start: start + offset });
  }
  if (!blocks.length) return 0;
  const lineStart = Math.min(...blocks.map((b) => b.start));
  const xAt = (q: number): number | null => {
    const hit = blocks.filter((b) => Math.abs(b.start - q) < 1e-6);
    if (hit.length) return Math.min(...hit.map((b) => b.x));
    const after = blocks.filter((b) => b.start >= q - 1e-6);
    return after.length ? Math.min(...after.map((b) => b.x)) : null;
  };
  let digitY = 0;
  for (const el of music.querySelectorAll("text")) {
    if (/\d/.test(el.textContent ?? "")) {
      const y = Number(el.getAttribute("y"));
      if (Number.isFinite(y)) {
        digitY = y;
        break;
      }
    }
  }
  let barY = Infinity;
  for (const el of host.querySelectorAll("[data-bar-numbers] text, [data-fermata-at] path")) {
    if (el.tagName.toLowerCase() === "text") {
      const y = Number(el.getAttribute("y"));
      if (Number.isFinite(y)) barY = Math.min(barY, y);
    } else {
      try {
        const box = (el as SVGGraphicsElement).getBBox();
        if (box) barY = Math.min(barY, box.y);
      } catch { /* not in document */ }
    }
  }
  const y = Number.isFinite(barY) ? barY - 14 : digitY - 36;
  const doc = main.ownerDocument;
  const layer = doc.createElementNS(SVG_NS, "g");
  layer.setAttribute("data-key-marks", "");
  layer.setAttribute("aria-hidden", "true");
  layer.setAttribute("pointer-events", "none");
  let drawn = 0;
  for (const mark of marks) {
    if (mark.at < lineStart - 1e-6 || mark.at >= lineEnd - 1e-6) continue;
    // A change that opens a wrapped line is already restated in the line header.
    if (Math.abs(mark.at - lineStart) < 1e-6) continue;
    // A tempo or meter mark at the same onset already includes the key in its label.
    if (mark.bpm !== undefined || mark.beats !== undefined) continue;
    const name = keyMarkName(voice, mark.at, mark.key);
    if (!name) continue;
    const x = xAt(mark.at);
    if (x == null) continue;
    const textEl = doc.createElementNS(SVG_NS, "text");
    textEl.setAttribute("x", String(x));
    textEl.setAttribute("y", String(y));
    textEl.setAttribute("font-size", "11");
    textEl.setAttribute("font-family", "var(--font-sans)");
    textEl.setAttribute("font-weight", "600");
    textEl.setAttribute("fill", "#1c1916");
    textEl.setAttribute("text-anchor", "start");
    textEl.setAttribute("data-key-at", String(mark.at));
    textEl.setAttribute("data-key-name", name);
    textEl.textContent = `1=${name}`;
    layer.append(textEl);
    drawn += 1;
  }
  if (!drawn) return 0;
  content.append(layer);
  return drawn;
}

/** Draw rit./accel. text and a dashed line. Voice 1 only.
 *  Do not grow the host: many mid-score marks (e.g. Hungarian Rhapsody No. 2)
 *  would otherwise retrigger a layout loop. */
export function markGradualTempos(
  host: HTMLElement,
  voice: JianpuVoice,
  marks: readonly { from: number; to: number; kind?: string }[] | undefined,
  lineEnd = Infinity,
) {
  host.querySelectorAll("[data-gradual-tempos]").forEach((el) => el.remove());
  if ((voice.voice ?? 0) !== 0) return 0;
  const spans = (marks ?? []).filter(
    (mark) => Number.isFinite(mark.from) && Number.isFinite(mark.to) && mark.to > mark.from + 1e-6,
  );
  if (!spans.length) return 0;
  const main = host.querySelectorAll("svg")[1] ?? host.querySelector("svg");
  const content = main?.querySelector<SVGGElement>('g[data-id="main-content"]');
  const music = content?.querySelector<SVGGElement>('g[data-id="music"]');
  if (!main || !content || !music) return 0;
  const offset = voice.offset ?? 0;
  const blocks: { x: number; start: number; group: SVGGElement }[] = [];
  for (const group of music.querySelectorAll<SVGGElement>("g[data-id]")) {
    const start = blockStart(group);
    const x = start === null ? null : blockX(group, content);
    if (start !== null && x !== null) blocks.push({ x, start: start + offset, group });
  }
  if (!blocks.length) return 0;
  const lineStart = Math.min(...blocks.map((b) => b.start));
  const xAt = (q: number): number | null => {
    const hit = blocks.filter((b) => Math.abs(b.start - q) < 1e-6);
    if (hit.length) return Math.min(...hit.map((b) => b.x));
    const after = blocks.filter((b) => b.start >= q - 1e-6);
    return after.length ? Math.min(...after.map((b) => b.x)) : null;
  };
  const rightOf = (block: { x: number; group: SVGGElement }): number => {
    try {
      const box = block.group.getBBox();
      if (box && Number.isFinite(box.x + box.width)) return Math.max(block.x + 8, box.x + box.width);
    } catch { /* not in document */ }
    return block.x + 18;
  };
  const lineRight = Math.max(...blocks.map(rightOf));
  const xEnd = (q: number): number => {
    const before = blocks.filter((b) => b.start <= q + 1e-6);
    if (before.length) {
      const last = before.reduce((a, b) => (a.start >= b.start ? a : b));
      if (Math.abs(last.start - q) < 1e-6) return last.x;
      return rightOf(last);
    }
    return lineRight;
  };
  let digitY = 0;
  for (const el of music.querySelectorAll("text")) {
    if (/\d/.test(el.textContent ?? "")) {
      const y = Number(el.getAttribute("y"));
      if (Number.isFinite(y)) {
        digitY = y;
        break;
      }
    }
  }
  let barY = Infinity;
  for (const el of host.querySelectorAll("[data-bar-numbers] text, [data-fermata-at] path")) {
    if (el.tagName.toLowerCase() === "text") {
      const y = Number(el.getAttribute("y"));
      if (Number.isFinite(y)) barY = Math.min(barY, y);
    } else {
      try {
        const box = (el as SVGGraphicsElement).getBBox();
        if (box) barY = Math.min(barY, box.y);
      } catch { /* not in document */ }
    }
  }
  const y = Number.isFinite(barY) ? barY - 14 : digitY - 36;
  const doc = main.ownerDocument;
  const layer = doc.createElementNS(SVG_NS, "g");
  layer.setAttribute("data-gradual-tempos", "");
  layer.setAttribute("aria-hidden", "true");
  layer.setAttribute("pointer-events", "none");
  let drawn = 0;
  const thisEnd = Number.isFinite(lineEnd) ? lineEnd : Infinity;
  for (const mark of spans) {
    if (mark.to <= lineStart + 1e-6 || mark.from >= thisEnd - 1e-6) continue;
    const fromOnLine = mark.from >= lineStart - 1e-6 && mark.from < thisEnd - 1e-6;
    const startX = fromOnLine ? xAt(mark.from) : Math.min(...blocks.map((b) => b.x));
    const endX = mark.to < thisEnd - 1e-6 ? xEnd(mark.to) : lineRight;
    if (startX == null || !(endX > startX + 1)) continue;
    if (fromOnLine) {
      const text = doc.createElementNS(SVG_NS, "text");
      text.setAttribute("x", String(startX));
      text.setAttribute("y", String(y));
      text.setAttribute("font-size", "11");
      text.setAttribute("font-family", "var(--font-sans)");
      text.setAttribute("font-weight", "600");
      text.setAttribute("fill", "#1c1916");
      text.setAttribute("text-anchor", "start");
      text.setAttribute("data-gradual-from", String(mark.from));
      text.setAttribute("data-gradual-to", String(mark.to));
      text.setAttribute("data-gradual-kind", mark.kind === "accel" ? "accel" : "rit");
      text.textContent = mark.kind === "accel" ? "渐快 accel." : "渐慢 rit.";
      layer.append(text);
    }
    const dashStart = fromOnLine ? startX + 58 : startX;
    if (endX > dashStart + 2) {
      const line = doc.createElementNS(SVG_NS, "line");
      line.setAttribute("x1", String(dashStart));
      line.setAttribute("y1", String(y - 3));
      line.setAttribute("x2", String(endX));
      line.setAttribute("y2", String(y - 3));
      line.setAttribute("stroke", "#1c1916");
      line.setAttribute("stroke-width", "1");
      line.setAttribute("stroke-dasharray", "4 3");
      line.setAttribute("fill", "none");
      line.setAttribute("data-gradual-line", "");
      line.setAttribute("data-gradual-from", String(mark.from));
      line.setAttribute("data-gradual-to", String(mark.to));
      layer.append(line);
    }
    drawn += 1;
  }
  if (!drawn) return 0;
  content.append(layer);
  return drawn;
}
