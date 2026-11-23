import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const root = new URL("..", import.meta.url);
const read = (rel) => readFileSync(new URL(rel, root), "utf8");

test("favicon and header Music2 stay the existing marks", () => {
  const favicon = read("public/favicon.svg");
  assert.match(favicon, /viewBox="0 0 32 32"/);
  assert.match(favicon, /rect width="32" height="32" rx="7" fill="#1F3D3A"/);
  assert.match(favicon, /width="11" height="1.7"/);
  assert.doesNotMatch(favicon, /ellipse|circle/);
  const sha = createHash("sha256").update(favicon).digest("hex");
  assert.equal(sha, "a8b279f4f4407a693831324cfae881c62a5247dcb3f0785a3ce88936b478d66d");
  const home = read("src/components/home-landing.tsx");
  assert.match(home, /<Music2 className="size-5" aria-hidden="true" \/>\s*\n\s*谱线/);
});

test("home overture is a complete 4/4 bar with a flagged last eighth", async () => {
  const { OVERTURE_VIEWBOX, STAFF_YS, OVERTURE_INNER } = await import("../src/lib/home-overture.js");
  assert.equal(OVERTURE_VIEWBOX, "0 0 600 120");
  assert.deepEqual(STAFF_YS, [40, 50, 60, 70, 80]);
  assert.equal([...OVERTURE_INNER.matchAll(/<ellipse /g)].length, 8);
  assert.equal([...OVERTURE_INNER.matchAll(/rotate\(-20 /g)].length, 8);
  assert.equal([...OVERTURE_INNER.matchAll(/c2 0 12-2 13-11/g)].length, 2);
  assert.equal([...OVERTURE_INNER.matchAll(/ 50Z"| 40Z"| 90Z"/g)].length, 3);
  assert.match(OVERTURE_INNER, /M478\.6 90c2 0 12-2/);
  assert.doesNotMatch(OVERTURE_INNER, /M522 60V20/);
  const home = read("src/components/home-landing.tsx");
  assert.match(home, /from ["']@\/lib\/home-overture["']/);
  assert.doesNotMatch(home, /M522 60V20/);
  assert.doesNotMatch(home, /useLayoutEffect/);
});
