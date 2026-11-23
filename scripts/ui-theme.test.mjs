import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderWebManifest } from "./grok-pwa-shared.mjs";

test("PWA and document use the cream paper chrome", () => {
  const manifest = JSON.parse(renderWebManifest("localhost"));
  assert.equal(manifest.theme_color, "#f7f3ea");
  assert.equal(manifest.background_color, manifest.theme_color);
  const root = readFileSync(new URL("../src/routes/__root.tsx", import.meta.url), "utf8");
  assert.match(root, /name: "theme-color", content: "#f7f3ea"/);
  assert.match(root, /viewport-fit=cover/);
});

test("wide layouts retain safe-area spacing on landscape phones", () => {
  const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  const wide = css.slice(css.indexOf("@media (min-width: 640px)"));
  const shell = wide.match(/\.app-shell\s*\{([^}]+)\}/)?.[1];
  assert.ok(shell, "wide app shell rule exists");
  assert.match(shell, /padding:\s*max\(40px, env\(safe-area-inset-top\)\) max\(32px, env\(safe-area-inset-right\)\) calc\(140px \+ env\(safe-area-inset-bottom\)\) max\(32px, env\(safe-area-inset-left\)\)/);
  const transport = wide.match(/\.transport\s*\{([^}]+)\}/)?.[1];
  assert.ok(transport, "wide transport rule exists");
  assert.match(transport, /--transport-edge:\s*max\(24px, env\(safe-area-inset-left\), env\(safe-area-inset-right\)\)/);
  assert.match(transport, /width:\s*min\(640px, calc\(100% - var\(--transport-edge\) - var\(--transport-edge\)\)\)/);
  assert.match(transport, /left:\s*50%/);
  assert.match(transport, /transform:\s*translateX\(-50%\)/);
  assert.match(transport, /bottom:\s*calc\(20px \+ env\(safe-area-inset-bottom\)\)/);
});

test("home atelier workbench structure and styles are defined", () => {
  const landingSource = readFileSync(new URL("../src/components/home-landing.tsx", import.meta.url), "utf8");
  assert.match(landingSource, /data-home-workbench/, "home landing must render workbench container");
  assert.match(landingSource, /data-honest-notice/, "honest notice container must be tagged");
  assert.match(landingSource, /生成可改草稿 · 需校对/, "honest notice text must be present");
  assert.match(landingSource, /data-home-desc/, "description paragraph must be tagged");
  const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  assert.match(css, /\.home-workbench|\[data-home-workbench\]/, "workbench CSS rule must exist");
});

test("hidden file input in ScoreImageUpload has tabIndex={-1} for keyboard accessibility", () => {
  const source = readFileSync(new URL("../src/components/score-image.tsx", import.meta.url), "utf8");
  assert.match(
    source,
    /<input[^>]*tabIndex=\{-1\}/,
    "hidden file input must have tabIndex={-1} so it is skipped during tab navigation",
  );
});

test("CSS prefers-reduced-motion covers ink, title, workbench, buttons, and view transitions without global wildcard", () => {
  const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  assert.doesNotMatch(
    css,
    /\*\s*\{\s*animation(?:-duration)?:\s*(?:0\.01ms|none)/,
    "must not use global wildcard 0.01ms animation hack",
  );
  const reduceBlock = css.slice(css.lastIndexOf("@media (prefers-reduced-motion:reduce)"));
  assert.match(reduceBlock, /\.px-overture/, "reduced-motion must cover ink overture");
  assert.match(reduceBlock, /#home-title span/, "reduced-motion must cover title entrance");
  assert.match(reduceBlock, /\.home-workbench/, "reduced-motion must cover workbench entrance");
  assert.match(reduceBlock, /\.home-btn-primary/, "reduced-motion must cover primary CTA buttons");
  assert.match(reduceBlock, /::view-transition/, "reduced-motion must cover view transitions");
});

test("home entrance keyframes do not hide elements on first frame with opacity: 0", () => {
  const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  const titleKeyframe = css.match(/@keyframes px-title-in\s*\{([^}]+)\}/)?.[1] ?? "";
  assert.ok(titleKeyframe, "px-title-in keyframe must exist");
  assert.doesNotMatch(titleKeyframe, /opacity:\s*0/, "title entrance keyframe must not start from opacity: 0");

  const workbenchKeyframe = css.match(/@keyframes px-workbench-in\s*\{([^}]+)\}/)?.[1] ?? "";
  assert.ok(workbenchKeyframe, "px-workbench-in keyframe must exist");
  assert.doesNotMatch(workbenchKeyframe, /opacity:\s*0/, "workbench entrance keyframe must not start from opacity: 0");
});

test("primary CTA buttons define distinguishable hover and active visual feedback", () => {
  const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  const hoverRule = css.match(/\.home-btn-primary:hover\s*\{([^}]+)\}/)?.[1] ?? "";
  const activeRule = css.match(/\.home-btn-primary:active\s*\{([^}]+)\}/)?.[1] ?? "";
  assert.ok(hoverRule, "primary button hover rule must exist");
  assert.ok(activeRule, "primary button active rule must exist");
  assert.match(hoverRule, /background:/, "hover rule must define distinct background");
  assert.match(activeRule, /background:/, "active rule must define distinct background");
});

test("score plate folio board and editorial hierarchy are defined", () => {
  const landingSource = readFileSync(new URL("../src/components/home-landing.tsx", import.meta.url), "utf8");
  assert.match(landingSource, /data-home-plate/, "home hero section must be marked as score plate [data-home-plate]");
  assert.match(landingSource, /data-home-eyebrow/, "home eyebrow subtitle must be tagged [data-home-eyebrow]");

  const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  assert.match(css, /\.home-eyebrow/, "eyebrow CSS rule must exist with editorial styling");
  assert.match(css, /\.home-plate|\.home-hero|\[data-home-plate\]/, "score plate CSS rule must exist");
  assert.match(css, /\.home-desc[^{]*\{[^}]*#575047/, "description must specify #575047 for high-contrast ink hierarchy");
  assert.match(
    css,
    /\.home-workbench-actions>\.home-btn-primary\{[^}]*min-width:160px/,
    "desktop primary CTAs must not shrink below 160px in the workbench row",
  );
});
