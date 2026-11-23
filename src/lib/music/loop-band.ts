/**
 * Practice A-B loop marking on the staff view. The jianpu view draws its own
 * band (jianpu-render markLoop); this covers abcjs, where notes are found via
 * their engraved elements and grouped per system (line).
 */

export type LoopRangeQ = { from: number; to: number };
export type NoteBox = { line: number; x: number; w: number };
export type LineBox = { y: number; h: number };
export type LoopBand = { line: number; x: number; y: number; w: number; h: number; start: boolean; end: boolean };

/** Indexes of notes (rests included) whose onset lies inside [from, to). */
export function notesInLoop(notes: readonly { dur: number }[], range: LoopRangeQ | null): Set<number> {
  const inside = new Set<number>();
  if (!range) return inside;
  let at = 0;
  notes.forEach((note, index) => {
    if (at >= range.from - 1e-6 && at < range.to - 1e-6) inside.add(index);
    at += note.dur;
  });
  return inside;
}

/**
 * One rect per system that holds looped notes; the bracket edges go only where
 * the loop actually begins (first band) and ends (last band).
 */
export function loopBands(boxes: readonly NoteBox[], lines: ReadonlyMap<number, LineBox>, pad = 6): LoopBand[] {
  const byLine = new Map<number, { left: number; right: number }>();
  for (const box of boxes) {
    if (!lines.has(box.line) || !Number.isFinite(box.x)) continue;
    const span = byLine.get(box.line) ?? { left: Infinity, right: -Infinity };
    span.left = Math.min(span.left, box.x);
    span.right = Math.max(span.right, box.x + Math.max(0, box.w));
    byLine.set(box.line, span);
  }
  const order = [...byLine.keys()].sort((a, b) => a - b);
  return order.map((line, i) => {
    const span = byLine.get(line)!;
    const row = lines.get(line)!;
    return {
      line,
      x: span.left - pad,
      y: row.y,
      w: span.right - span.left + pad * 2,
      h: row.h,
      start: i === 0,
      end: i === order.length - 1,
    };
  });
}

const SVG_NS = "http://www.w3.org/2000/svg";

/** Replace any previous staff loop marking in `svg` with `bands`. */
export function drawLoopBands(svg: SVGSVGElement, bands: readonly LoopBand[]) {
  svg.querySelectorAll("[data-loop-band]").forEach((el) => el.remove());
  if (!bands.length) return;
  const doc = svg.ownerDocument;
  const layer = doc.createElementNS(SVG_NS, "g");
  layer.setAttribute("data-loop-band", "");
  layer.setAttribute("aria-hidden", "true");
  layer.setAttribute("pointer-events", "none");
  for (const band of bands) {
    const rect = doc.createElementNS(SVG_NS, "rect");
    Object.entries({ x: band.x, y: band.y, width: band.w, height: band.h, rx: 6, fill: "#a44825", "fill-opacity": "0.09" })
      .forEach(([k, v]) => rect.setAttribute(k, String(v)));
    layer.append(rect);
    const edge = (x: number, dir: 1 | -1, name: string) => {
      const path = doc.createElementNS(SVG_NS, "path");
      path.setAttribute("d", `M ${x + dir * 5} ${band.y} h ${-dir * 5} v ${band.h} h ${dir * 5}`);
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", "#a44825");
      path.setAttribute("stroke-width", "1.6");
      path.setAttribute("data-loop-edge", name);
      layer.append(path);
    };
    if (band.start) edge(band.x, 1, "start");
    if (band.end) edge(band.x + band.w, -1, "end");
  }
  // Behind the music so noteheads stay clickable and readable.
  svg.insertBefore(layer, svg.firstChild);
}

type Engraved = {
  lines?: Array<{ staff?: Array<{ voices?: Array<Array<{ el_type?: string; startChar?: number; endChar?: number; abselem?: { elemset?: Element[] } }>> }> }>;
};
type Target = { index: number; voice: number } | null | undefined;

function boxOf(el: Element): { x: number; y: number; width: number; height: number } | null {
  try {
    const box = (el as SVGGraphicsElement).getBBox?.();
    return box && Number.isFinite(box.x) ? box : null;
  } catch {
    return null;
  }
}

/**
 * Staff view: shade the looped notes per system of an abcjs render. `target`
 * maps an engraved note's source chars to its score index and voice.
 */
export function markStaffLoop(
  svg: SVGSVGElement | null | undefined,
  tunes: readonly Engraved[],
  target: (startChar: number, endChar: number) => Target,
  voices: readonly (readonly { dur: number }[])[],
  range: LoopRangeQ | null,
) {
  if (!svg) return [];
  const inside = voices.map((notes) => notesInLoop(notes, range));
  const boxes: NoteBox[] = [];
  const lines = new Map<number, LineBox>();
  if (range) {
    for (const tune of tunes) {
      (tune.lines ?? []).forEach((line, li) => {
        for (const staff of line.staff ?? [])
          for (const voice of staff.voices ?? [])
            for (const elem of voice) {
              if (elem.el_type !== "note" || elem.startChar == null || elem.endChar == null) continue;
              const hit = target(elem.startChar, elem.endChar);
              if (!hit || !inside[hit.voice]?.has(hit.index)) continue;
              const el = elem.abselem?.elemset?.[0];
              const box = el ? boxOf(el) : null;
              if (box) boxes.push({ line: li, x: box.x, w: box.width });
            }
        let top = Infinity, bottom = -Infinity;
        for (const staffLines of svg.querySelectorAll(`.abcjs-staff.abcjs-l${li}`)) {
          const box = boxOf(staffLines);
          if (!box) continue;
          top = Math.min(top, box.y);
          bottom = Math.max(bottom, box.y + box.height);
        }
        if (bottom > top) lines.set(li, { y: top - 14, h: bottom - top + 28 });
      });
    }
  }
  const bands = loopBands(boxes, lines);
  drawLoopBands(svg, bands);
  return bands;
}
