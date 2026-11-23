import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { expandRect, hitContains, hitDistance, minHitUnits, svgUnitPerPx, MIN_HIT_PX } from "./hit-area.ts";

describe("hit-area", () => {
  it("keeps already-large boxes and grows small ones around their centre", () => {
    assert.deepEqual(expandRect(10, 10, 60, 60, 44), { x: 10, y: 10, width: 60, height: 60 });
    assert.deepEqual(expandRect(10, 20, 8, 12, 44), { x: 10 + 4 - 22, y: 20 + 6 - 22, width: 44, height: 44 });
  });

  it("treats a 12×12 glyph as a 44px target", () => {
    const rect = { left: 100, right: 112, top: 50, bottom: 62, width: 12, height: 12 } as DOMRect;
    assert.equal(hitContains(rect, 106, 56), true);
    assert.equal(hitContains(rect, 106 + 21, 56), true);
    assert.equal(hitContains(rect, 106 + 23, 56), false);
    assert.equal(Math.round(hitDistance(rect, 106, 56)), 0);
  });

  it("falls back to 1 svg unit per pixel when the element is not laid out", () => {
    const svg = { getBoundingClientRect: () => ({ width: 0 }), viewBox: { baseVal: { width: 0 } }, getAttribute: () => null } as unknown as SVGSVGElement;
    assert.equal(svgUnitPerPx(svg), 1);
    assert.equal(minHitUnits(svg, 24), Math.max(MIN_HIT_PX, 24));
  });

  it("converts 44 CSS pixels through the viewBox scale", () => {
    const svg = {
      getBoundingClientRect: () => ({ width: 220 }),
      viewBox: { baseVal: { width: 440 } },
      getAttribute: () => "440",
    } as unknown as SVGSVGElement;
    assert.equal(svgUnitPerPx(svg), 2);
    assert.equal(minHitUnits(svg, 24), 88);
  });
});
