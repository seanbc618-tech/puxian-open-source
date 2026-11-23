/**
 * Rules for the mobile static client: which modules and URLs must stay out of
 * the Capacitor webDir package. Shared by the Vite build plugin and node:test.
 */

/** Module-id substrings that mean the static graph reached a server or preview stack. */
export const FORBIDDEN_MODULE_RULES = [
  [/\/src\/lib\/db\.ts$/, "server database module"],
  [/\/src\/lib\/env\.server\.ts$/, "server env module"],
  [/\/src\/lib\/auth(?:\/|$)/, "auth module"],
  [/\/src\/lib\/app-data(?:\/|$)/, "app-data module"],
  [/\/src\/lib\/multiplayer(?:\/|$)/, "multiplayer module"],
  [/\/src\/lib\/preview-host-bridge(?:\.ts|$)/, "preview host bridge"],
  [/\/src\/lib\/preview-embedder-origin/, "preview embedder origin"],
  [/\/src\/lib\/preview-path-prefix/, "preview path prefix"],
  [/\/src\/components\/preview-host-bridge/, "PreviewHostBridge component"],
  [/\/src\/router\.tsx$/, "TanStack router"],
  [/\/src\/routes(?:\/|$)/, "TanStack routes"],
  [/\/src\/routeTree\.gen\.ts$/, "generated route tree"],
  [/\/server(?:\/|$)/, "Nitro server directory"],
  [/\/scripts\/(?:grok-pwa|migrate|with-app-env|app-env)/, "server or dev script"],
  [/node_modules\/@tanstack\/react-start(?:\/|$)/, "@tanstack/react-start"],
  [/node_modules\/@tanstack\/react-router(?:\/|$)/, "@tanstack/react-router"],
  [/node_modules\/@tanstack\/router-plugin(?:\/|$)/, "@tanstack/router-plugin"],
  [/node_modules\/nitro(?:\/|$)/, "nitro"],
  [/node_modules\/better-auth(?:\/|$)/, "better-auth"],
  [/node_modules\/@electric-sql\/pglite(?:\/|$)/, "pglite"],
  [/node_modules\/pg(?:\/|$)/, "pg"],
  [/node_modules\/kysely(?:\/|$)/, "kysely"],
  [/node_modules\/jose(?:\/|$)/, "jose"],
];

/** Import specifiers the static entry is not allowed to name directly. */
const FORBIDDEN_SPECIFIER =
  /^(?:@\/lib\/(?:db|env\.server|auth|app-data|multiplayer|preview-host-bridge|preview-embedder-origin|preview-path-prefix)(?:[./].*)?|@\/components\/preview-host-bridge(?:[./].*)?|@\/router(?:\.tsx)?|@\/routes(?:\/.*)?|@tanstack\/(?:react-start|react-router)(?:\/.*)?|nitro(?:\/.*)?|better-auth(?:\/.*)?|@electric-sql\/pglite(?:\/.*)?)$/;

const IMPORT_FROM = /(?:import|export)\s+(?:[^'"\n]+?\s+from\s+)?["']([^"']+)["']/g;
const IMPORT_DYNAMIC = /import\(\s*["']([^"']+)["']\s*\)/g;

export function normalizeModuleId(id) {
  return String(id).replaceAll("\\", "/").split("?")[0].split("#")[0];
}

/** @returns {string | null} human-readable reason when `id` is forbidden. */
export function forbiddenStaticModule(id) {
  const path = normalizeModuleId(id);
  if (path.startsWith("\0")) return null;
  for (const [pattern, reason] of FORBIDDEN_MODULE_RULES) {
    if (pattern.test(path)) return reason;
  }
  return null;
}

export function findForbiddenEntrySpecifiers(source) {
  const found = new Set();
  for (const match of String(source).matchAll(IMPORT_FROM)) {
    if (FORBIDDEN_SPECIFIER.test(match[1])) found.add(match[1]);
  }
  for (const match of String(source).matchAll(IMPORT_DYNAMIC)) {
    if (FORBIDDEN_SPECIFIER.test(match[1])) found.add(match[1]);
  }
  return [...found];
}

/** Problems in the shell HTML. Empty means the document can mount without Nitro. */
export const SITE_ORIGIN = "https://818189.xyz";
export const SITE_DESCRIPTION =
  "在浏览器里写简谱、五线谱、和弦谱和六线谱，用卷帘跟奏练习。谱存本机；识谱才上传。";

/** PNG width/height from the IHDR chunk, or null when the buffer is not a PNG. */
export function pngSize(buffer) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  if (buf.length < 24) return null;
  if (buf[0] !== 0x89 || buf[1] !== 0x50 || buf[2] !== 0x4e || buf[3] !== 0x47) return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

export function inspectStaticIndexHtml(html) {
  const problems = [];
  const text = String(html);
  if (!/<div id="root"><\/div>/.test(text)) problems.push("missing #root");
  if (!/<script type="module"/.test(text)) problems.push("missing module script");
  if (text.includes("/__grok/")) problems.push("references /__grok/");
  if (text.includes("/api/")) problems.push("references /api/");
  const required = [
    ["name=\"description\"", SITE_DESCRIPTION],
    ["property=\"og:title\"", "谱线"],
    ["property=\"og:description\"", SITE_DESCRIPTION],
    ["property=\"og:image\"", `${SITE_ORIGIN}/og-image.png`],
    ["property=\"og:image:width\"", "1200"],
    ["property=\"og:image:height\"", "630"],
    ["property=\"og:type\"", "website"],
    ["property=\"og:url\"", `${SITE_ORIGIN}/`],
    ["name=\"twitter:card\"", "summary_large_image"],
    ["name=\"twitter:image\"", `${SITE_ORIGIN}/og-image.png`],
    ["name=\"twitter:title\"", "谱线"],
    ["rel=\"canonical\"", `${SITE_ORIGIN}/`],
  ];
  for (const [needle, value] of required) {
    if (!text.includes(needle) || !text.includes(value)) {
      problems.push(`missing preview meta ${needle}`);
    }
  }
  return problems;
}

/** Script and stylesheet URLs declared by a built index.html. */
export function builtAssetRefs(html) {
  const refs = [];
  const pattern = /<(?:script|link)\b[^>]*>/g;
  for (const tag of String(html).matchAll(pattern)) {
    const src = /(?:src|href)="([^"]+)"/.exec(tag[0]);
    if (!src) continue;
    const url = src[1];
    if (tag[0].includes('type="module"') || tag[0].includes('rel="stylesheet"')) refs.push(url);
  }
  return refs;
}

/** Vite's default hashed relative asset name under `base: "./"`. */
export function isHashedRelativeAsset(url) {
  return /^\.\/assets\/[A-Za-z0-9._-]+-[A-Za-z0-9_-]{6,}\.(?:js|css)$/.test(url);
}

/** Substrings that must not appear in the static JS/CSS, even as dead data. */
export const FORBIDDEN_BUNDLE_STRINGS = [
  "/__grok/",
  "/api/auth",
  "DATABASE_URL",
  "@electric-sql/pglite",
  "better-auth",
  "fonts.googleapis.com",
  "fonts.gstatic.com",
];

export function findForbiddenBundleStrings(source) {
  const text = String(source);
  return FORBIDDEN_BUNDLE_STRINGS.filter((needle) => text.includes(needle));
}

const URL_IN_SOURCE = /https?:\/\/[^\s"'`<>)\\]+/g;

/** Absolute URLs left in a built file. XML namespaces are not network calls. */
export function residualHttpUrls(source) {
  const urls = new Set();
  for (const match of String(source).matchAll(URL_IN_SOURCE)) {
    const url = match[0].replace(/[.,;]+$/, "");
    if (url.startsWith("http://www.w3.org/")) continue;
    if (url.startsWith("http://www.musicxml.org/")) continue;
    urls.add(url);
  }
  return [...urls];
}

const CSS_URL = /url\(([^)]+)\)/g;

export function cssAssetUrls(css) {
  const urls = [];
  for (const match of String(css).matchAll(CSS_URL)) {
    const raw = match[1].trim().replace(/^['"]|['"]$/g, "");
    if (!raw || raw.startsWith("data:")) continue;
    urls.push(raw);
  }
  return urls;
}

/** Origin of the one Python static server for this run, including its port. */
export function packagedOrigin(host, port) {
  return `http://${host}:${port}`;
}

/**
 * Null when a browser or CSS request may be sent. `data:` and `blob:` are
 * in-memory. Anything else must be this exact origin, not merely the same host
 * on another port, and must not be a Nitro path.
 */
export function packagedRequestProblem(urlString, origin) {
  let url;
  try {
    url = urlString instanceof URL ? urlString : new URL(String(urlString));
  } catch {
    return `unparseable url ${urlString}`;
  }
  if (url.protocol === "data:" || url.protocol === "blob:") return null;
  if (url.origin !== origin) return `origin ${url.origin} is not ${origin}`;
  if (url.pathname.startsWith("/api") || url.pathname.includes("/__grok/")) {
    return `forbidden path ${url.pathname}`;
  }
  return null;
}

/**
 * Decide whether a 3xx may be followed. The target is resolved against the
 * current URL and refused before any further request when it leaves the
 * packaged origin.
 */
export function nextPackagedUrl(currentHref, status, location, origin) {
  if (status < 300 || status >= 400) return { follow: null, problem: null };
  if (!location) return { follow: null, problem: `redirect from ${currentHref} has no Location` };
  let next;
  try {
    next = new URL(location, currentHref);
  } catch {
    return { follow: null, problem: `redirect from ${currentHref} has an unparseable Location` };
  }
  const problem = packagedRequestProblem(next.href, origin);
  if (problem) return { follow: null, problem: `redirect target refused: ${problem}` };
  return { follow: next.href, problem: null };
}
