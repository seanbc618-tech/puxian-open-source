// Main-thread side of 多音 dictation: resample with Web Audio, run the worker.
import { BP_SAMPLE_RATE } from "./basic-pitch/notes.ts";
import type { PolyPhase, PolyWorkerRequest, PolyWorkerResponse } from "./poly-dictation-protocol.ts";
import { MAX_POLY_SECONDS } from "./poly-dictation.ts";

export type PolyResult = Extract<PolyWorkerResponse, { type: "done" }> & { seconds: number; clippedSeconds: number };

let worker: Worker | null = null;
let nextId = 1;

function getWorker(): Worker {
  worker ??= new Worker(new URL("./poly-dictation.worker.ts", import.meta.url), { type: "module" });
  return worker;
}

/** Mono 22.05 kHz copy of the first MAX_POLY_SECONDS, the rate Basic Pitch expects. */
export async function resampleForModel(buffer: AudioBuffer): Promise<{ audio: Float32Array; seconds: number; clippedSeconds: number }> {
  const seconds = Math.min(buffer.duration, MAX_POLY_SECONDS);
  const length = Math.max(1, Math.ceil(seconds * BP_SAMPLE_RATE));
  const ctx = new OfflineAudioContext(1, length, BP_SAMPLE_RATE);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(ctx.destination);
  source.start(0, 0, seconds);
  const rendered = await ctx.startRendering();
  return { audio: rendered.getChannelData(0).slice(), seconds, clippedSeconds: Math.max(0, buffer.duration - seconds) };
}

export function polyTranscribe(
  buffer: AudioBuffer,
  onProgress: (phase: PolyPhase | "audio", done: number) => void,
  backend: "auto" | "cpu" = "auto",
): { promise: Promise<PolyResult>; cancel: () => void } {
  const id = nextId++;
  let settled = false;
  let rejectRun: (err: Error) => void = () => {};
  const promise = new Promise<PolyResult>((resolve, reject) => {
    rejectRun = reject;
    onProgress("audio", 0);
    resampleForModel(buffer)
      .then(({ audio, seconds, clippedSeconds }) => {
        if (settled) return;
        onProgress("audio", 1);
        const w = getWorker();
        const onMessage = (event: MessageEvent<PolyWorkerResponse>) => {
          const m = event.data;
          if (m.id !== id) return;
          if (m.type === "progress") {
            onProgress(m.phase, m.done);
            return;
          }
          w.removeEventListener("message", onMessage);
          w.removeEventListener("error", onError);
          if (settled) return;
          settled = true;
          if (m.type === "done") resolve({ ...m, seconds, clippedSeconds });
          else reject(new Error(m.message));
        };
        const onError = () => {
          w.removeEventListener("message", onMessage);
          w.removeEventListener("error", onError);
          worker?.terminate();
          worker = null;
          if (settled) return;
          settled = true;
          reject(new Error("多音听写模块加载失败"));
        };
        w.addEventListener("message", onMessage);
        w.addEventListener("error", onError);
        const request: PolyWorkerRequest = { type: "run", id, audio, backend };
        w.postMessage(request, [audio.buffer]);
      })
      .catch((err) => {
        if (settled) return;
        settled = true;
        reject(err instanceof Error ? err : new Error(String(err)));
      });
  });
  return {
    promise,
    cancel() {
      if (settled) return;
      settled = true;
      // Stop at once; the next run starts a fresh worker (model files come from HTTP cache).
      worker?.terminate();
      worker = null;
      rejectRun(new Error("cancelled"));
    },
  };
}
