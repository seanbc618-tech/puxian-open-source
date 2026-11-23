import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  cssAssetUrls,
  findForbiddenBundleStrings,
  findForbiddenEntrySpecifiers,
  forbiddenStaticModule,
  inspectStaticIndexHtml,
  pngSize,
  SITE_DESCRIPTION,
  SITE_ORIGIN,
  isHashedRelativeAsset,
  nextPackagedUrl,
  packagedOrigin,
  packagedRequestProblem,
  residualHttpUrls,
} from "./static-client-boundary.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

test("static entry does not name server, auth, or preview modules", () => {
  const main = readFileSync(join(root, "static/main.tsx"), "utf8");
  const html = readFileSync(join(root, "static/index.html"), "utf8");
  assert.deepEqual(findForbiddenEntrySpecifiers(main), []);
  assert.deepEqual(inspectStaticIndexHtml(html), []);
  assert.match(main, /<HomeApp \/>/);
  const web = readFileSync(join(root, "src/routes/index.tsx"), "utf8");
  assert.match(web, /<HomeApp \/>/);
  assert.match(web, /@\/components\/home-landing/);
  assert.match(main, /@\/components\/home-landing/);
  assert.doesNotMatch(html, /\/__grok\//);
});

test("forbidden specifiers are caught in static source", () => {
  const source = `
    import { db } from "@/lib/db";
    import { AuthProvider } from "@/lib/auth/provider";
    const bridge = import("@/components/preview-host-bridge");
  `;
  assert.deepEqual(findForbiddenEntrySpecifiers(source), [
    "@/lib/db",
    "@/lib/auth/provider",
    "@/components/preview-host-bridge",
  ]);
});

test("server module ids are rejected and the score editor is not", () => {
  assert.equal(forbiddenStaticModule("/repo/src/lib/db.ts"), "server database module");
  assert.equal(forbiddenStaticModule("/repo/src/lib/db.ts?import"), "server database module");
  assert.equal(forbiddenStaticModule("C:\\repo\\src\\lib\\auth\\server.ts"), "auth module");
  assert.equal(
    forbiddenStaticModule("/repo/node_modules/better-auth/dist/index.js"),
    "better-auth",
  );
  assert.equal(
    forbiddenStaticModule("/repo/node_modules/@electric-sql/pglite/dist/index.js"),
    "pglite",
  );
  assert.equal(forbiddenStaticModule("/repo/src/components/staffline-app.tsx"), null);
  assert.equal(forbiddenStaticModule("/repo/src/lib/music/playback.ts"), null);
  assert.equal(forbiddenStaticModule("/repo/node_modules/react/index.js"), null);
  assert.equal(forbiddenStaticModule("\0vite/preload-helper"), null);
});

test("built asset names stay relative and hashed", () => {
  assert.equal(isHashedRelativeAsset("./assets/index-Ab12cd34.js"), true);
  assert.equal(isHashedRelativeAsset("/assets/index-Ab12cd34.js"), false);
  assert.equal(isHashedRelativeAsset("./assets/index.js"), false);
  assert.equal(isHashedRelativeAsset("https://cdn.example/app.js"), false);
});

test("bundle scan flags Nitro and font CDNs, and ignores XML namespaces", () => {
  const sample = `
    fetch("/api/auth/session");
    const ns = "http://www.w3.org/2000/svg";
    const sound = "https://paulrosen.github.io/midi-js-soundfonts/abcjs/";
  `;
  assert.deepEqual(findForbiddenBundleStrings(sample), ["/api/auth"]);
  assert.deepEqual(residualHttpUrls(sample), [
    "https://paulrosen.github.io/midi-js-soundfonts/abcjs/",
  ]);
  assert.deepEqual(
    findForbiddenBundleStrings('@font-face { src: url("https://fonts.gstatic.com/s/a.woff2") }'),
    ["fonts.gstatic.com"],
  );
});

test("css urls skip inlined data and keep packaged files", () => {
  const css = `src:url(data:font/woff2;base64,AAAA),url("./outfit-abc.woff2")`;
  assert.deepEqual(cssAssetUrls(css), ["./outfit-abc.woff2"]);
});

test("packaged requests must match the static server origin, not just the host", () => {
  const origin = packagedOrigin("127.0.0.1", 43210);
  assert.equal(origin, "http://127.0.0.1:43210");
  assert.equal(packagedRequestProblem("http://127.0.0.1:43210/assets/a.js", origin), null);
  assert.equal(packagedRequestProblem("data:font/woff2;base64,AA", origin), null);
  assert.equal(packagedRequestProblem("blob:http://127.0.0.1:43210/uuid", origin), null);
  assert.match(packagedRequestProblem("http://127.0.0.1:8080/assets/a.js", origin), /8080/);
  assert.match(packagedRequestProblem("http://127.0.0.1/assets/a.js", origin), /127\.0\.0\.1/);
  assert.match(packagedRequestProblem("http://localhost:43210/", origin), /localhost/);
  assert.match(packagedRequestProblem("https://127.0.0.1:43210/", origin), /https:/);
  assert.match(packagedRequestProblem("http://127.0.0.1:43210/api/auth", origin), /\/api/);
  assert.match(
    packagedRequestProblem("http://127.0.0.1:43210/__grok/manifest.webmanifest", origin),
    /__grok/,
  );
});

test("redirect targets are checked before they would be followed", () => {
  const origin = packagedOrigin("127.0.0.1", 43210);
  const here = `${origin}/assets/app.css`;
  assert.deepEqual(nextPackagedUrl(here, 200, null, origin), { follow: null, problem: null });
  assert.deepEqual(nextPackagedUrl(here, 302, "/assets/font.woff2", origin), {
    follow: `${origin}/assets/font.woff2`,
    problem: null,
  });
  const otherPort = nextPackagedUrl(here, 302, "http://127.0.0.1:9/stolen.js", origin);
  assert.equal(otherPort.follow, null);
  assert.match(otherPort.problem, /127\.0\.0\.1:9/);
  const offHost = nextPackagedUrl(here, 301, "https://cdn.example/font.woff2", origin);
  assert.equal(offHost.follow, null);
  assert.match(offHost.problem, /cdn\.example/);
  const api = nextPackagedUrl(here, 302, "/api/auth/session", origin);
  assert.equal(api.follow, null);
  assert.match(api.problem, /\/api/);
  assert.match(nextPackagedUrl(here, 302, null, origin).problem, /no Location/);
});

test("static shell has accurate OG and twitter preview tags", () => {
  const html = readFileSync(join(root, "static/index.html"), "utf8");
  assert.deepEqual(inspectStaticIndexHtml(html), []);
  assert.match(html, /twitter:card" content="summary_large_image"/);
  assert.ok(html.includes(SITE_DESCRIPTION));
  assert.ok(html.includes(`${SITE_ORIGIN}/og-image.png`));
  assert.match(SITE_DESCRIPTION, /简谱/);
  assert.match(SITE_DESCRIPTION, /六线谱/);
  assert.match(SITE_DESCRIPTION, /卷帘/);
});

test("committed og-image is an original 1200×630 PNG", () => {
  const png = readFileSync(join(root, "public/og-image.png"));
  assert.deepEqual(pngSize(png), { width: 1200, height: 630 });
  assert.equal(png[0], 0x89);
  assert.ok(png.length > 8_000, "image should contain drawn pixels, not an empty stub");
  assert.ok(png.length < 400_000, "image should stay a compact drawing, not a photograph");
});
