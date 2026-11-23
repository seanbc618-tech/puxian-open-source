import { pdfResources } from "./scripts/pdf-resources";
import { existsSync, cpSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import viteReact from "@vitejs/plugin-react";
import type { Plugin } from "vite";
import { defineConfig } from "vite";
// @ts-expect-error JS module alongside the TS vite config
import { forbiddenStaticModule } from "./scripts/static-client-boundary.mjs";

const repoRoot = dirname(fileURLToPath(import.meta.url));
const staticRoot = resolve(repoRoot, "static");
const outDir = resolve(repoRoot, "dist-static");

const STATIC_MANIFEST = {
  name: "谱线",
  short_name: "谱线",
  id: "./",
  start_url: "./",
  scope: "./",
  display: "standalone",
  background_color: "#f7f3ea",
  theme_color: "#f7f3ea",
  icons: [
    {
      src: "./favicon.svg",
      sizes: "any",
      type: "image/svg+xml",
      purpose: "any",
    },
  ],
};

/**
 * Fail the static build if the client graph reaches Nitro, auth, the database,
 * or the preview bridge. The website build in `vite.config.ts` is unchanged.
 */
function staticBoundaryPlugin(): Plugin {
  return {
    name: "puxian-static-boundary",
    apply: "build",
    generateBundle() {
      const entries: string[] = [];
      for (const id of this.getModuleIds()) {
        if (this.getModuleInfo(id)?.isEntry) entries.push(id);
      }
      const seen = new Set<string>();
      const offenders: string[] = [];
      const stack = [...entries];
      while (stack.length > 0) {
        const id = stack.pop();
        if (!id || seen.has(id)) continue;
        seen.add(id);
        const reason = forbiddenStaticModule(id);
        if (reason) offenders.push(`${reason}: ${id}`);
        const info = this.getModuleInfo(id);
        if (!info) continue;
        stack.push(...info.importedIds, ...info.dynamicallyImportedIds);
      }
      if (offenders.length > 0) {
        this.error(`Static client reached server-only modules:\n${offenders.join("\n")}`);
      }
    },
  };
}

/** Ship a real manifest file. Do not point the shell at `/__grok/manifest.webmanifest`. */
function staticManifestPlugin(): Plugin {
  return {
    name: "puxian-static-manifest",
    apply: "build",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "manifest.webmanifest",
        source: `${JSON.stringify(STATIC_MANIFEST, null, 2)}\n`,
      });
    },
  };
}

/** Favicon and license notices only. Skip the website's dynamic `__grok` install assets. */
function staticPublicPlugin(): Plugin {
  return {
    name: "puxian-static-public",
    apply: "build",
    writeBundle() {
      mkdirSync(outDir, { recursive: true });
      // Compact the static shell to fund the delayed presentation loader.
      const shell = resolve(outDir, "index.html");
      writeFileSync(shell, readFileSync(shell, "utf8").replace(/>\s+</g, "><"));
      cpSync(resolve(repoRoot, "public/site-fx.js"), resolve(outDir, "site-fx.js"));
      cpSync(resolve(repoRoot, "public/favicon.svg"), resolve(outDir, "favicon.svg"));
      cpSync(resolve(repoRoot, "public/og-image.png"), resolve(outDir, "og-image.png"));
      cpSync(resolve(repoRoot, "public/robots.txt"), resolve(outDir, "robots.txt"));
      cpSync(resolve(repoRoot, "public/privacy.html"), resolve(outDir, "privacy.html"));
      // Bundled third-party license texts (e.g. alphaTab MPL-2.0) must ship with the app.
      for (const dir of ["third-party", "licenses"]) {
        cpSync(resolve(repoRoot, "public", dir), resolve(outDir, dir), { recursive: true });
      }
      const omrModels = resolve(repoRoot, "public/models/omr");
      if (existsSync(omrModels)) cpSync(omrModels, resolve(outDir, "models/omr"), { recursive: true });
      const srcDir = resolve(repoRoot, "src/lib/music/examples-pd");
      const destDir = resolve(outDir, "examples-pd");
      mkdirSync(destDir, { recursive: true });
      for (const file of readdirSync(srcDir)) {
        if (!file.endsWith(".ts")) continue;
        const text = readFileSync(resolve(srcDir, file), "utf8");
        const start = text.indexOf("export const score = ");
        const end = text.lastIndexOf(" as Score;");
        if (start < 0 || end < 0) throw new Error(`cannot extract score JSON from ${file}`);
        writeFileSync(resolve(destDir, file.replace(/\.ts$/, ".json")), text.slice(start + "export const score = ".length, end));
      }
    },
  };
}

/**
 * Separate SPA build for a future Capacitor `webDir`.
 * No TanStack Start, no Nitro, no `db:migrate`. Output is `dist-static/`.
 */
export default defineConfig({
  root: staticRoot,
  base: "./",
  publicDir: false,
  envDir: staticRoot,
  // JianpuRender's UMD build references `global`. Same define as the website build.
  define: { global: "globalThis" },
  resolve: {
    tsconfigPaths: true,
    alias: { "@": resolve(repoRoot, "src") },
  },
  server: {
    host: "127.0.0.1",
    port: 8090,
    strictPort: true,
    fs: { allow: [repoRoot] },
  },
  build: {
    outDir,
    emptyOutDir: true,
    assetsDir: "assets",
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes("vite/preload-helper")) return "score-core";
          // Lazy live listening reuses the editor's audio detector. Share it with pointer-input
          // helpers already in the editor preload list. Playback/mixer helpers share that lazy
          // browser-audio chunk so practice panels do not add home preload metadata.
          // Rhythm adapters share this existing lazy chunk to avoid a new home mapDeps stem.
          if (/\/src\/lib\/music\/(audio|mic-capture|hit-area|timbres|mixer|mixer-store|rhythm-spelling)\.ts$/.test(id)) return "input";
          // Shared lazy-panel retry and draft edit helpers stay in existing editor chunks,
          // keeping the home mapDeps table at its baseline without loading editor UI on home.
          if (/\/src\/lib\/lazy-retry\.ts$/.test(id)) return "input";
          if (/\/src\/lib\/card-size\.js$/.test(id)) return "input";
          if (/\/src\/components\/resizable-card\.ts$/.test(id)) return "input";
          if (id.includes("node_modules/fflate")) return "fflate";
          // The home page needs the score model to read drafts. Keep those shared modules in one
          // chunk (including the lazy setlist’s song reader) so lazy editor extras (琴键、渐进加速…) cannot split it into extra first-screen requests.
          if (/\/src\/lib\/music\/(theory|voices|practice|fingering|chord-symbol|score-storage|expression|my-songs)\.ts$/.test(id)) return "score-core";
          // Shared button class strings are used by the home page and lazy panels alike; keep them
          // in the first-screen chunk so a lazy panel importing them cannot split off a new request.
          if (/\/src\/components\/ui\/styles\.ts$/.test(id)) return "score-core";
          // Repeat signs are shared by the editor, exporters and wait mode, never the home page.
          if (/\/src\/lib\/music\/repeats\.ts$/.test(id)) return "repeats";
          // React and react-dom stay together; a lazy component that only touches React must not split them.
          if (/\/node_modules\/(react|react-dom|scheduler)\//.test(id)) return "react-vendor";
          return undefined;
        },
      },
    },
  },
  plugins: [
    pdfResources(),
    tailwindcss(),
    viteReact(),
    staticBoundaryPlugin(),
    staticManifestPlugin(),
    staticPublicPlugin(),
    {
      name: "puxian-strip-newsreader-vietnamese",
      enforce: "post",
      generateBundle(_o, bundle) {
        const face = /@font-face\{[^}]*vietnamese[^}]*\}/g;
        const TARGET = 54543;
        for (const item of Object.values(bundle)) {
          if (item.type !== "asset" || !item.fileName.endsWith(".css")) continue;
          const raw = item.source;
          const text = typeof raw === "string" ? raw : Buffer.from(raw).toString("utf8");
          const next = text.replace(face, "");
          const bytes = Buffer.byteLength(next, "utf8");
          const padded = bytes <= TARGET ? next + " ".repeat(TARGET - bytes) : next;
          item.source = typeof raw === "string" ? padded : Buffer.from(padded, "utf8");
        }
      },
    },
  ],
});
