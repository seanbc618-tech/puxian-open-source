import type { PolyNoteEvent } from "./basic-pitch/notes.ts";

export type PolyPhase = "model" | "infer";

export type PolyBackend = "webgl" | "webgl-software" | "cpu";

/** Plain-language label for the status line. */
export function polyBackendLabel(backend: string): string {
  if (backend === "webgl") return "显卡加速";
  if (backend === "webgl-software") return "软件模拟显卡，较慢";
  return "处理器运算";
}

export type PolyWorkerRequest =
  | {
      type: "run";
      id: number;
      audio: Float32Array;
      /** "cpu" skips the GPU (also the fallback when WebGL is missing or only half-float). */
      backend?: "auto" | "cpu";
    }
  | { type: "cancel"; id: number };

export type PolyWorkerResponse =
  | { type: "progress"; id: number; phase: PolyPhase; done: number }
  | {
      type: "done";
      id: number;
      notes: PolyNoteEvent[];
      /** What actually ran: "webgl", "webgl-software" (an emulated GPU such as SwiftShader), or "cpu". */
      backend: PolyBackend;
      /** Download + graph load; near zero once cached in this worker. */
      modelMs: number;
      inferMs: number;
      decodeMs: number;
    }
  | { type: "error"; id: number; message: string };
