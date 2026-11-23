// MIT. Deterministic local camera simulation using browser Canvas only.
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { browserSession } from "../scripts/eval/common.mjs";
const manifest = JSON.parse(readFileSync("eval/manifest.json", "utf8"));
const { page, close } = await browserSession();
const cases = [];
try {
  for (const item of manifest.items) {
    for (const variant of ["clean", "perspective", "lighting", "low-quality", "combined"]) {
      const encoded = await page.evaluate(
        async ({ base64, crop, variant, seed }) => {
          const bitmap = await createImageBitmap(
            await (await fetch("data:image/png;base64," + base64)).blob(),
          );
          const [left, top, right, bottom] = crop || [0, 0, bitmap.width, bitmap.height];
          const w = right - left,
            h = bottom - top;
          const canvas = new OffscreenCanvas(w, h),
            ctx = canvas.getContext("2d");
          ctx.fillStyle = "white";
          ctx.fillRect(0, 0, w, h);
          ctx.drawImage(bitmap, left, top, w, h, 0, 0, w, h);
          bitmap.close();
          if (variant !== "clean" && variant !== "low-quality") {
            const source = ctx.getImageData(0, 0, w, h),
              dest = ctx.createImageData(w, h);
            const camera = ["perspective", "combined"].includes(variant),
              light = ["lighting", "combined"].includes(variant);
            const angle = (0.9 * Math.PI) / 180,
              cos = Math.cos(angle),
              sin = Math.sin(angle);
            for (let y = 0; y < h; y++)
              for (let x = 0; x < w; x++) {
                let sx = x,
                  sy = y;
                if (light) sy -= 3 * Math.sin((x / (w - 1)) * Math.PI * 2);
                if (camera) {
                  const rx = cos * (sx - w / 2) - sin * (sy - h / 2) + w / 2,
                    ry = sin * (sx - w / 2) + cos * (sy - h / 2) + h / 2;
                  const divisor = 1 + 0.000018 * rx + 0.000011 * ry;
                  sx = (rx + 0.035 * ry - w * 0.018) / divisor;
                  sy = (0.014 * rx + ry - h * 0.012) / divisor;
                }
                const shade = light
                  ? 0.92 -
                    (0.31 * x) / (w - 1) -
                    0.22 *
                      Math.exp(
                        -((x / (w - 1) - 0.32) ** 2 / 0.025 + (y / (h - 1) - 0.45) ** 2 / 0.15),
                      )
                  : 1;
                const ix = Math.floor(sx),
                  iy = Math.floor(sy),
                  fx = sx - ix,
                  fy = sy - iy,
                  j = (y * w + x) * 4;
                for (let c = 0; c < 3; c++) {
                  const sample = (a, b) =>
                    a < 0 || b < 0 || a >= w || b >= h ? 255 : source.data[(b * w + a) * 4 + c];
                  dest.data[j + c] =
                    shade *
                    ((1 - fy) * ((1 - fx) * sample(ix, iy) + fx * sample(ix + 1, iy)) +
                      fy * ((1 - fx) * sample(ix, iy + 1) + fx * sample(ix + 1, iy + 1)));
                }
                dest.data[j + 3] = 255;
              }
            ctx.putImageData(dest, 0, 0);
          }
          let result = canvas;
          if (["low-quality", "combined"].includes(variant)) {
            const ratio = Math.min(1, 1000 / Math.max(w, h));
            result = new OffscreenCanvas(Math.round(w * ratio), Math.round(h * ratio));
            const c = result.getContext("2d");
            c.filter = "blur(0.45px)";
            c.drawImage(canvas, 0, 0, result.width, result.height);
            const pixels = c.getImageData(0, 0, result.width, result.height);
            let state = seed >>> 0;
            const random = () => {
              state ^= state << 13;
              state ^= state >>> 17;
              state ^= state << 5;
              return (state >>> 0) / 4294967296;
            };
            for (let i = 0; i < pixels.data.length; i += 4)
              for (let ch = 0; ch < 3; ch++)
                pixels.data[i + ch] += (random() + random() + random() - 1.5) * 4;
            c.putImageData(pixels, 0, 0);
          }
          const jpeg = ["low-quality", "combined"].includes(variant);
          const blob = await result.convertToBlob({
            type: jpeg ? "image/jpeg" : "image/png",
            quality: 0.52,
          });
          const bytes = new Uint8Array(await blob.arrayBuffer());
          let binary = "";
          for (let i = 0; i < bytes.length; i += 16384)
            binary += String.fromCharCode(...bytes.subarray(i, i + 16384));
          return btoa(binary);
        },
        {
          base64: readFileSync(item.source).toString("base64"),
          crop: item.crop,
          variant,
          seed: manifest.seed,
        },
      );
      const path = `eval/generated/${item.id}-${variant}.${["low-quality", "combined"].includes(variant) ? "jpg" : "png"}`;
      const bytes = Buffer.from(encoded, "base64");
      writeFileSync(path, bytes);
      cases.push({
        ...item,
        variant,
        path,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        sample: item.crop ? "first system crop" : "whole image",
      });
    }
    if (item.crop)
      cases.push({
        ...item,
        id: item.id + "-whole",
        variant: "clean",
        path: item.source,
        truth: null,
        ends: null,
        sample: "whole page; draft only",
        sha256: createHash("sha256").update(readFileSync(item.source)).digest("hex"),
      });
  }
  // Exercise the existing PDF.js ingestion path, not an external PDF renderer.
  const pdf = await page.evaluate(async (base64) => {
    const { renderPdf } = await import("/src/components/score-pdf.ts");
    const file = new File(
      [Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))],
      "bach_prelude_c_a4.pdf",
      { type: "application/pdf" },
    );
    const blobs = [],
      warnings = [];
    await renderPdf(
      file,
      () => 40 - blobs.length,
      (blob, name) => blobs.push({ blob, name }),
      (m) => warnings.push(m),
    );
    return {
      warnings,
      pages: await Promise.all(
        blobs.map(async ({ blob, name }) => {
          const bytes = new Uint8Array(await blob.arrayBuffer());
          let binary = "";
          for (let i = 0; i < bytes.length; i += 16384)
            binary += String.fromCharCode(...bytes.subarray(i, i + 16384));
          return { name, base64: btoa(binary) };
        }),
      ),
    };
  }, readFileSync("eval/generated/bach_prelude_c_a4.pdf").toString("base64"));
  for (let i = 0; i < pdf.pages.length; i++) {
    const path = `eval/generated/bach-pdf-${i + 1}.png`,
      bytes = Buffer.from(pdf.pages[i].base64, "base64");
    writeFileSync(path, bytes);
    cases.push({
      id: `bach-pdf-${i + 1}`,
      kind: "piano",
      variant: "clean",
      path,
      truth: null,
      ends: null,
      sample: "whole PDF page via product renderPdf; draft only",
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
  }
  writeFileSync("eval/generated/cases.json", JSON.stringify(cases, null, 2) + "\n");
  writeFileSync(
    "eval/generated/pdf-ingestion.json",
    JSON.stringify({ pages: pdf.pages.length, warnings: pdf.warnings }, null, 2) + "\n",
  );
  console.log(`Generated ${cases.length} OMR cases; seed ${manifest.seed}`);
} finally {
  await close();
}
