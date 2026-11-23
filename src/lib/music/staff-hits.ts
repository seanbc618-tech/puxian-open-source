import { expandRect, minHitUnits } from "./hit-area.ts";

const SVG_NS = "http://www.w3.org/2000/svg";

/** Grow every engraved note to a 44px-class tap pad, sitting behind the ink. */
export function padStaffHits(paper: HTMLElement | null): number {
  if (!paper) return 0;
  paper.querySelectorAll(".staff-note-target").forEach((el) => el.remove());
  const svg = paper.querySelector("svg");
  if (!svg) return 0;
  const min = minHitUnits(svg);
  const doc = svg.ownerDocument;
  let drawn = 0;
  for (const note of paper.querySelectorAll<SVGGElement>(".abcjs-note")) {
    let bbox: { x: number; y: number; width: number; height: number };
    try {
      bbox = note.getBBox();
    } catch {
      continue;
    }
    if (!bbox.width && !bbox.height) continue;
    const box = expandRect(bbox.x, bbox.y, bbox.width || 8, bbox.height || 8, min);
    const rect = doc.createElementNS(SVG_NS, "rect");
    rect.setAttribute("x", String(box.x));
    rect.setAttribute("y", String(box.y));
    rect.setAttribute("width", String(box.width));
    rect.setAttribute("height", String(box.height));
    rect.setAttribute("rx", "6");
    rect.setAttribute("class", "staff-note-target");
    rect.setAttribute("fill", "transparent");
    note.insertBefore(rect, note.firstChild);
    drawn += 1;
  }
  return drawn;
}
