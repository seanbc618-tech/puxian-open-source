import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Plugin } from "vite";

export function pdfResources(): Plugin {
  return {
    name: "local-pdf-resources",
    generateBundle() {
      const visit = (directory: string, prefix: string) => {
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
          const path = resolve(directory, entry.name);
          const name = `${prefix}/${entry.name}`;
          if (entry.isDirectory()) visit(path, name);
          else this.emitFile({ type: "asset", fileName: `assets/pdfjs/${name}`, source: readFileSync(path) });
        }
      };
      for (const name of ["cmaps", "standard_fonts", "wasm", "iccs"]) visit(resolve("node_modules/pdfjs-dist", name), name);
    },
  };
}
