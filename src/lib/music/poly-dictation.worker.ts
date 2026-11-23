/// <reference lib="webworker" />
// Basic Pitch inference off the main thread. Loaded only when 多音 dictation runs.
// The model is bundled as same-origin hashed assets; nothing is fetched elsewhere.
import * as tf from "@tensorflow/tfjs-core";
import "@tensorflow/tfjs-backend-cpu";
import "@tensorflow/tfjs-backend-webgl";
import { loadGraphModel, type GraphModel } from "@tensorflow/tfjs-converter";
import modelUrl from "./basic-pitch/model/model.json?url";
import weightsUrl from "./basic-pitch/model/group1-shard1of1.bin?url";
import { runBasicPitch } from "./basic-pitch/inference.ts";
import { decodeNotes } from "./basic-pitch/notes.ts";
import type { PolyBackend, PolyWorkerRequest, PolyWorkerResponse } from "./poly-dictation-protocol.ts";

const scope = self as unknown as DedicatedWorkerGlobalScope;
/** Bytes of model.json + weights; used when the server sends no Content-Length. */
const MODEL_BYTES = 174537 + 742392;

let modelPromise: Promise<{ model: GraphModel; ms: number }> | undefined;
let cancelledId = -1;

function post(message: PolyWorkerResponse) {
  scope.postMessage(message);
}

async function fetchBytes(url: string, onBytes: (n: number) => void): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`模型下载失败（${response.status}）`);
  if (!response.body) {
    const all = new Uint8Array(await response.arrayBuffer());
    onBytes(all.length);
    return all;
  }
  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    total += value.length;
    onBytes(value.length);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** Renderer string of the WebGL context tf.js is using, when the browser exposes it. */
function rendererName(): string {
  try {
    const backend = tf.backend() as unknown as { gpgpu?: { gl?: WebGLRenderingContext } };
    const gl = backend.gpgpu?.gl;
    if (!gl) return "";
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    return String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? "");
  } catch {
    return "";
  }
}

async function selectBackend(prefer: "auto" | "cpu"): Promise<PolyBackend> {
  if (prefer === "auto") {
    try {
      if (typeof OffscreenCanvas !== "undefined" && (await tf.setBackend("webgl"))) {
        await tf.ready();
        // Half-float GPUs drift on this model; fall back rather than mis-hear.
        if (tf.env().getBool("WEBGL_RENDER_FLOAT32_CAPABLE")) {
          return /swiftshader|llvmpipe|softpipe|software|basic render/i.test(rendererName()) ? "webgl-software" : "webgl";
        }
      }
    } catch {
      // fall through to the CPU backend
    }
  }
  await tf.setBackend("cpu");
  await tf.ready();
  return "cpu";
}

function loadModel(id: number) {
  modelPromise ??= (async () => {
    const t0 = performance.now();
    let loaded = 0;
    const progress = (n: number) => {
      loaded += n;
      post({ type: "progress", id, phase: "model", done: Math.min(1, loaded / MODEL_BYTES) });
    };
    const [jsonBytes, weights] = await Promise.all([fetchBytes(modelUrl, progress), fetchBytes(weightsUrl, progress)]);
    const json = JSON.parse(new TextDecoder().decode(jsonBytes));
    const model = await loadGraphModel(
      tf.io.fromMemory({
        modelTopology: json.modelTopology,
        weightSpecs: json.weightsManifest[0].weights,
        weightData: weights.buffer.slice(weights.byteOffset, weights.byteOffset + weights.byteLength) as ArrayBuffer,
      }),
    );
    return { model, ms: performance.now() - t0 };
  })();
  modelPromise.catch(() => {
    modelPromise = undefined;
  });
  return modelPromise;
}

scope.onmessage = async (event: MessageEvent<PolyWorkerRequest>) => {
  const message = event.data;
  if (message.type === "cancel") {
    cancelledId = message.id;
    return;
  }
  const { id, audio } = message;
  try {
    const fresh = !modelPromise;
    // Pick the backend before the weights load so they land there; tf.js moves them if it changes later.
    const backend = await selectBackend(message.backend ?? "auto");
    const loaded = await loadModel(id);
    const { model } = loaded;
    const modelMs = fresh ? loaded.ms : 0;
    post({ type: "progress", id, phase: "model", done: 1 });
    const t0 = performance.now();
    const out = await runBasicPitch(
      tf,
      model,
      audio,
      (done) => post({ type: "progress", id, phase: "infer", done }),
      () => cancelledId === id,
      // A GPU pays per call; four windows (~6 s of audio) per call cuts that overhead.
      backend === "cpu" ? 1 : 4,
    );
    const inferMs = performance.now() - t0;
    const notes = decodeNotes(out.frames, out.onsets);
    post({ type: "done", id, notes, backend, modelMs, inferMs, decodeMs: performance.now() - t0 - inferMs });
  } catch (err) {
    post({ type: "error", id, message: err instanceof Error ? err.message : String(err) });
  }
};
