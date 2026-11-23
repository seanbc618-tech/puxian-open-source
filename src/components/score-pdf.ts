import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
GlobalWorkerOptions.workerSrc = workerUrl;

export async function renderPdf(file: File, remaining: () => number, add: (blob: Blob, name: string) => void, warn: (message: string) => void) {
  const base = import.meta.env.DEV ? new URL("../../node_modules/pdfjs-dist/", import.meta.url).href : new URL("./pdfjs/", import.meta.url).href;
  const task = getDocument({ cMapUrl: `${base}cmaps/`, cMapPacked: true, standardFontDataUrl: `${base}standard_fonts/`, wasmUrl: `${base}wasm/`, iccUrl: `${base}iccs/`, data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false, useSystemFonts: true });
  try {
    const pdf = await task.promise;
    const count = Math.min(pdf.numPages, remaining());
    if (count < pdf.numPages) warn(`${file.name}：合计最多 40 页，第 ${count + 1}–${pdf.numPages} 页未加入。`);
    for (let n = 1; n <= count; n++) {
      if (remaining() <= 0) break;
      const page = await pdf.getPage(n);
      const original = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: Math.min(2, 2400 / Math.max(original.width, original.height)) });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
      await page.render({ canvas, viewport }).promise;
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => b ? resolve(b) : reject(new Error("无法读取页面")), "image/png"));
      add(blob, `${file.name} · 第 ${n} 页`);
      canvas.width = canvas.height = 0;
      page.cleanup();
    }
  } finally { await task.destroy(); }
}
