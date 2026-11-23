/// <reference lib="webworker" />
import * as ort from "onnxruntime-web/wasm";
import wasmUrl from "onnxruntime-web/ort-wasm-simd-threaded.wasm?url";
import moduleUrl from "onnxruntime-web/ort-wasm-simd-threaded.mjs?url";
import manifest from "./manifest.json";
import { flattenStaffImage } from "./preprocess.ts";
import { browserStaffRefusal } from "./staff-page.ts";

const send = (message: string, progress?: number) =>
  self.postMessage({ kind: "progress", message, progress });
async function cachedFile(url: string, bytes?: number, hash?: string): Promise<ArrayBuffer> {
  const cache = await caches.open(manifest.id);
  let response = await cache.match(url);
  if (!response) {
    const fetched = await fetch(url, { credentials: "same-origin" });
    if (!fetched.ok || !fetched.body)
      throw new Error("模型尚未下载完成：本站模型文件暂不可用，请联网后重试。");
    const reader = fetched.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.length;
      send(
        `首次下载本机识谱模型：${(total / 1048576).toFixed(1)} MB${bytes ? ` / ${(bytes / 1048576).toFixed(1)} MB` : ""}`,
        bytes ? Math.min(99, Math.round((total / bytes) * 100)) : undefined,
      );
    }
    const data = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
      data.set(c, offset);
      offset += c.length;
    }
    if (bytes && total !== bytes) throw new Error("模型尚未下载完成，文件大小不符，请重试。");
    if (hash) {
      const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", data))]
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      if (digest !== hash) throw new Error("模型校验失败，请重新下载；现有乐谱未更改。");
    }
    response = new Response(data);
    await cache.put(url, response.clone());
  }
  const data = await response.arrayBuffer();
  // Validate cached content too, so a stale/partial cache never becomes a success.
  if (bytes && data.byteLength !== bytes) {
    await cache.delete(url);
    throw new Error("本机模型缓存不完整，请重新识别以下载。");
  }
  if (hash) {
    const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", data))]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    if (digest !== hash) {
      await cache.delete(url);
      throw new Error("本机模型缓存校验失败，请重新下载。");
    }
  }
  return data;
}
let sessions:
  | Promise<{
      encoder: ort.InferenceSession;
      decoder: ort.InferenceSession;
      vocabulary: { i2w: Record<string, string>; bos: number; maxLength: number };
    }>
  | undefined;
async function load(base: string) {
  sessions ??= (async () => {
    ort.env.wasm.numThreads = 1;
    send("正在准备本机推理运行时…");
    const wasm = await cachedFile(new URL(wasmUrl, self.location.origin).href);
    const mod = await cachedFile(new URL(moduleUrl, self.location.origin).href);
    const files: Record<string, ArrayBuffer> = {};
    for (const f of manifest.files)
      files[f.name] = await cachedFile(new URL(f.name, base).href, f.bytes, f.sha256);
    const wasmBlob = URL.createObjectURL(new Blob([wasm], { type: "application/wasm" }));
    const modBlob = URL.createObjectURL(new Blob([mod], { type: "text/javascript" }));
    ort.env.wasm.wasmPaths = { wasm: wasmBlob, mjs: modBlob };
    send("模型已下载并校验，正在初始化本机识谱…", 100);
    try {
      const encoder = await ort.InferenceSession.create(files["encoder.onnx"], {
        executionProviders: ["wasm"],
      });
      const decoder = await ort.InferenceSession.create(files["decoder.onnx"], {
        executionProviders: ["wasm"],
      });
      return {
        encoder,
        decoder,
        vocabulary: JSON.parse(new TextDecoder().decode(files["vocabulary.json"])),
      };
    } finally {
      URL.revokeObjectURL(wasmBlob);
      URL.revokeObjectURL(modBlob);
    }
  })();
  try {
    return await sessions;
  } catch (e) {
    sessions = undefined;
    throw e;
  }
}

/** Local paper normalization and strip rectification before staff projection. */
function systems(bitmap: ImageBitmap): {
  crops: { pixels?: Float32Array; width?: number; error?: string }[];
  warnings: string[];
} {
  const scale = Math.min(1, 2200 / bitmap.width);
  const width = Math.round(bitmap.width * scale),
    height = Math.round(bitmap.height * scale);
  if (height > 12000) throw new Error("图片太长，请分成单页后再试。");
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const image = ctx.getImageData(0, 0, width, height);
  const data = flattenStaffImage(image.data, width, height);
  const preservedScan = data === image.data;
  image.data.set(data);
  ctx.putImageData(image, 0, 0);
  const rowInk = new Uint32Array(height);
  let inkLeft = width,
    inkRight = 0;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (data[i] + data[i + 1] + data[i + 2] < 690) {
        inkLeft = Math.min(inkLeft, x);
        inkRight = Math.max(inkRight, x);
      }
    }
  const inkWidth = inkRight - inkLeft + 1;
  for (let y = 0; y < height; y++) {
    let dark = 0;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (data[i] + data[i + 1] + data[i + 2] < 690) dark++;
    }
    rowInk[y] = dark;
  }
  function locate(threshold: number) {
    const rows = Array.from(rowInk, (dark, y) => (dark > inkWidth * threshold ? y : -1)).filter(
      (y) => y >= 0,
    );
    const lines: number[] = [];
    for (let i = 0; i < rows.length;) {
      let j = i;
      while (j + 1 < rows.length && rows[j + 1] <= rows[j] + 1) j++;
      lines.push((rows[i] + rows[j]) / 2);
      i = j + 1;
    }
    const staffs: number[][] = [];
    for (let i = 0; i + 4 < lines.length;) {
      const group = lines.slice(i, i + 5);
      const gaps = group.slice(1).map((v, j) => v - group[j]);
      if (Math.max(...gaps) / Math.min(...gaps) < 1.5) {
        staffs.push(group);
        i += 5;
      } else i++;
    }
    return { lines, staffs };
  }
  // Preserve proven scan segmentation; only broaden an unsuccessful scan search.
  // Rectified photographs use the broader search because their lines may remain fragmented.
  let located = locate(preservedScan ? 0.45 : 0.28);
  if (preservedScan && located.staffs.length < 2) located = locate(0.28);
  const { lines, staffs } = located;
  const refusal = browserStaffRefusal(lines.length, staffs.length);
  if (refusal) throw new Error(refusal);
  const warnings =
    staffs.length % 2
      ? [
          `本页第 ${Math.floor(staffs.length / 2) + 1} 个系统未识别：检测到 ${staffs.length} 个谱表，第 ${staffs.length} 个谱表未配对；该区域未导入，其余成对系统继续处理。`,
        ]
      : [];
  const result: { pixels?: Float32Array; width?: number; error?: string }[] = [];
  for (let s = 0; s + 1 < staffs.length; s += 2) {
    const top = staffs[s][0],
      bottom = staffs[s + 1][4],
      gap = (staffs[s][4] - top) / 4;
    let y0 = Math.max(0, Math.floor(top - gap * 3)),
      y1 = Math.min(height, Math.ceil(bottom + gap * 3));
    if (s > 0) y0 = Math.max(y0, Math.ceil((staffs[s - 1][4] + top) / 2));
    if (s + 2 < staffs.length) y1 = Math.min(y1, Math.floor((bottom + staffs[s + 2][0]) / 2));
    let x0 = width,
      x1 = 0,
      inkTop = y1,
      inkBottom = y0;
    for (let y = y0; y < y1; y++)
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        if (data[i] + data[i + 1] + data[i + 2] < 465) {
          x0 = Math.min(x0, x);
          x1 = Math.max(x1, x);
          inkTop = Math.min(inkTop, y);
          inkBottom = Math.max(inkBottom, y);
        }
      }
    x0 = Math.max(0, x0 - 10);
    x1 = Math.min(width, x1 + 11);
    y0 = Math.max(y0, inkTop - 10);
    y1 = Math.min(y1, inkBottom + 11);
    const h = 128,
      w = Math.round(((x1 - x0) * h) / (y1 - y0));
    if (w > 3056 || w < 64) {
      result.push({ error: "这一块谱的形状超出了浏览器识别的范围，这一段未读入。" });
      continue;
    }
    const crop = new OffscreenCanvas(w, h);
    const c = crop.getContext("2d")!;
    c.fillStyle = "white";
    c.fillRect(0, 0, w, h);
    c.drawImage(canvas, x0, y0, x1 - x0, y1 - y0, 0, 0, w, h);
    const pixels = c.getImageData(0, 0, w, h).data;
    const gray = new Float32Array(w * h);
    for (let i = 0; i < gray.length; i++)
      gray[i] =
        (pixels[i * 4] * 0.299 + pixels[i * 4 + 1] * 0.587 + pixels[i * 4 + 2] * 0.114) / 255;
    result.push({ pixels: gray, width: w });
  }
  return { crops: result, warnings };
}
const readableError = (error: unknown) =>
  error instanceof Error && /[\u3400-\u9fff]/.test(error.message)
    ? error.message
    : "模型下载或本机推理失败，请检查网络连接和浏览器可用内存后重试；模型未下载完成时无法离线识别。";
const decodeText = (text: string) =>
  text.replaceAll("<b>", "\n").replaceAll("<t>", "\t").replaceAll("<s>", " ");
self.onmessage = async (event: MessageEvent<{ bitmap: ImageBitmap; base: string }>) => {
  try {
    send("正在本机查找钢琴大谱表系统…");
    const { crops, warnings } = systems(event.data.bitmap);
    self.postMessage({ kind: "page", total: crops.length, warnings });
    const { encoder, decoder, vocabulary: v } = await load(event.data.base);
    const output: string[] = [];
    for (let i = 0; i < crops.length; i++) {
      let text = "";
      let features: Record<string, ort.Tensor> | undefined;
      try {
        const crop = crops[i];
        if (crop.error) throw new Error(crop.error);
        features = await encoder.run({
          image: new ort.Tensor("float32", crop.pixels!, [1, 1, 128, crop.width!]),
        });
        const tokens = [v.bos];
        let finished = false;
        for (let step = 0; step < v.maxLength - 1; step++) {
          if (step % 8 === 0)
            self.postMessage({
              kind: "progress",
              message: `本机识别第 ${i + 1} / ${crops.length} 个系统，已生成 ${step} 个符号…`,
              system: i + 1,
              total: crops.length,
              text: decodeText(text),
            });
          const prediction = await decoder.run({
            tokens: new ort.Tensor("int64", BigInt64Array.from(tokens, BigInt), [1, tokens.length]),
            raw: features.raw,
            positional: features.positional,
          });
          const logits = prediction.logits.data as Float32Array;
          let best = 0;
          for (let n = 1; n < logits.length; n++) if (logits[n] > logits[best]) best = n;
          const token = v.i2w[String(best)];
          prediction.logits.dispose();
          if (token === "<eos>") {
            finished = true;
            break;
          }
          if (token === undefined || token === "<pad>")
            throw new Error("模型没有生成有效的后续谱符；已生成部分保留待校对。");
          text += token;
          tokens.push(best);
        }
        if (!finished)
          throw new Error(
            "此系统达到模型长度限制，仅保留已生成部分；尾部未识别，请裁成更短的系统后重试。",
          );
        const decoded = decodeText(text);
        output.push(decoded);
        self.postMessage({
          kind: "system",
          index: i + 1,
          total: crops.length,
          text: decoded,
          complete: true,
        });
      } catch (error) {
        const decoded = decodeText(text);
        if (decoded) output.push(decoded);
        self.postMessage({
          kind: "system",
          index: i + 1,
          total: crops.length,
          text: decoded,
          complete: false,
          error: readableError(error),
        });
      } finally {
        features?.raw.dispose();
        features?.positional.dispose();
      }
    }
    self.postMessage({ kind: "result", systems: output });
  } catch (error) {
    self.postMessage({ kind: "error", message: readableError(error) });
  }
};
