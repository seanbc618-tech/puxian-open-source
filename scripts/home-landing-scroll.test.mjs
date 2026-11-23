import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
const landing = readFileSync(new URL("../src/components/home-landing.tsx", import.meta.url), "utf8");
const fx = readFileSync(new URL("../public/site-fx.js", import.meta.url), "utf8");

function screenCss(source) {
  return source.replace(/@media\s+print\s*\{[\s\S]*?\n\}/g, "");
}

test("home landing keeps real content below the hero card", () => {
  const hero = landing.search(/className="home-hero"|data-home-plate/);
  const songs = landing.indexOf('id="songs"');
  const footer = landing.indexOf("<footer");
  const footerCopy = landing.indexOf("仅存于当前浏览器");
  const examples = landing.indexOf("示例曲目") !== -1 || landing.indexOf("HOME_EXAMPLE_GROUPS") !== -1;
  assert.ok(hero !== -1, "hero card must exist");
  assert.ok(songs !== -1, "#songs must exist");
  assert.ok(footer !== -1, "footer must exist");
  assert.ok(hero < songs && songs < footer, "hero, then #songs, then footer — in that order");
  assert.ok(footer < footerCopy, "footer must keep the real storage / credits copy");
  assert.ok(examples, "example songs stay in the landing, not replaced by empty spacer");
});

test("the landing document can scroll and is not overflow-locked", () => {
  const screen = screenCss(css);
  assert.match(
    screen,
    /\[data-home-landing\]\{[^}]*overflow-y:\s*visible/,
    "landing must not become a nested locked scroller",
  );
  assert.doesNotMatch(
    screen,
    /\[data-home-landing\]\{[^}]*overflow(?:-y)?:\s*hidden/,
    "landing must not use overflow hidden",
  );
  assert.doesNotMatch(
    screen,
    /^(html|body|html\s*,\s*body)[^{]*\{[^}]*overflow(?:-y)?:\s*hidden/m,
    "html/body must not lock page scroll",
  );
  assert.doesNotMatch(
    screen,
    /html[^{]*::-webkit-scrollbar\s*\{[^}]*width:\s*(?!0\b)\d+px/,
    "first paint must not force a classic native scrollbar; the custom 12px bar is the visible affordance",
  );
  assert.match(
    fx,
    /html:has\(\[data-home-landing\]\)\s*\{[^}]*overflow-y:\s*auto/,
    "atmosphere must keep the document itself as the home scroller",
  );
  assert.doesNotMatch(
    fx,
    /html:has\(\[data-home-landing\]\)[^\{]*\{[^}]*overflow(?:-y)?:\s*hidden/,
  );
  assert.match(fx, /\.px-page-scrollbar \{[^}]*position:\s*fixed/, "custom right-edge bar stays visible when overlay scrollbars hide");
  assert.match(fx, /\.px-page-scrollbar \{[^}]*width:\s*12px/);
  assert.match(fx, /export function installPageScrollbar/);
});

test("editor workspace still uses its own overflow, not a document-scroll trap", () => {
  const screen = screenCss(css);
  const editor = screen.match(/\.app-shell:not\(\[data-home-landing\]\)\s*\{([^}]+)\}/);
  assert.ok(editor, "editor app-shell rule exists");
  assert.match(editor[1], /height:\s*100dvh/);
  assert.match(editor[1], /overflow:\s*hidden/);
  assert.match(
    screen,
    /\.app-shell:not\(\[data-home-landing\]\) \.score-stage\s*\{[^}]*overflow:\s*auto/,
    "the score still scrolls inside the editor",
  );
  assert.doesNotMatch(
    css,
    /html:has\(\[data-editor-layout\]\)::-webkit-scrollbar|html:not\(:has\(\[data-home-landing\]\)\)::-webkit-scrollbar/,
    "first-screen must not force a document scrollbar off the home landing",
  );
  assert.match(
    fx,
    /export function primaryScrollMetrics/,
    "the custom bar uses one reusable primary-scroller rule on every screen",
  );
  assert.match(fx, /\.app-shell:not\(\[data-home-landing\]\) \.score-stage[^}]*scrollbar-width:\s*none/);
  assert.match(fx, /\[data-primary-scroll\][^}]*scrollbar-width:\s*none/);
});

function declarationBodies(source, selector) {
  return [...source.matchAll(new RegExp(`${selector}\\s*\\{([^}]*)\\}`, "g"))].map((match) => match[1].replace(/\s+/g, "").replace(/;+$/, ""));
}

const HOME_DOCUMENT = String.raw`html:has\(\[data-home-landing\]\)(?!::)`;

test("home scrollbar geometry is stable at first paint and does not wait for site-fx", () => {
  const screen = screenCss(css);
  const firstDocument = declarationBodies(screen, HOME_DOCUMENT);
  const lazyDocument = declarationBodies(fx, HOME_DOCUMENT);
  assert.ok(firstDocument.some((body) => body.includes("scrollbar-gutter:stable")), "stable gutter must apply before site-fx loads");
  assert.ok(firstDocument.some((body) => body.includes("scrollbar-width:none")), "the native bar is hidden without a webkit scrollbar width");
  assert.ok(lazyDocument.some((body) => body.includes("scrollbar-gutter:stable")));
  assert.ok(lazyDocument.some((body) => body.includes("scrollbar-width:none")));
  assert.doesNotMatch(screen, /html[^{]*::-webkit-scrollbar/, "first paint must not customize the home webkit scrollbar");
  assert.doesNotMatch(fx, /html[^{]*::-webkit-scrollbar/, "site-fx must not introduce a home webkit scrollbar after load");
  assert.doesNotMatch(css, /html[^{]*::-webkit-scrollbar\s*\{[^}]*width:\s*\d+px/);
  assert.doesNotMatch(fx, /html[^{]*::-webkit-scrollbar\s*\{[^}]*width:\s*\d+px/);
});

test("the custom page scrollbar must not toggle layout or observe the document element", () => {
  assert.match(
    css,
    /html:has\(\[data-home-landing\]\)\s*\{[^}]*scrollbar-gutter:\s*stable/,
    "the reserved gutter is layout-critical and cannot wait for the lazy effects script",
  );
  assert.match(
    fx,
    /html:has\(\[data-home-landing\]\)\s*\{[^}]*scrollbar-gutter:\s*stable/,
    "keep a reserved gutter so the custom bar cannot change document width",
  );
  assert.match(fx, /html:has\(\[data-home-landing\]\)\s*\{[^}]*scrollbar-width:\s*none/);
  assert.doesNotMatch(fx, /html[^{]*::-webkit-scrollbar/, "hiding the native bar must not use a webkit scrollbar width");
  assert.doesNotMatch(
    fx,
    /html:has\(\.px-page-scrollbar:not\(\[hidden\]\)\)\s*\{[^}]*scrollbar-gutter:\s*auto/,
    "showing the custom bar must not drop scrollbar-gutter to auto",
  );
  assert.doesNotMatch(fx, /new win\.ResizeObserver\(\s*refresh\s*\)/);
  assert.doesNotMatch(fx, /observe\(\s*doc\.documentElement\s*\)/);
});
