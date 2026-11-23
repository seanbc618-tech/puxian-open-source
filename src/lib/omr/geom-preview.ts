import type { Score, ScoreNote } from "../music/theory";

export const GEOM_API = "/api/geom-omr";
export const GEOM_BANNER =
  "几何识谱（检测 + 谱线重建）。识别会有错，请对照原图校对后再写入主谱。";

export type GeomEvent = { pitch: number; start: number; dur: number; clef?: string };
export type GeomStatus = {
  ok: boolean;
  engine?: string;
  banner?: string;
  ready?: boolean;
  loading?: boolean;
  device?: string | null;
  error?: string | null;
  job?: { id?: string; stage?: string; elapsed?: number; error?: string | null } | null;
};

export type GeomResult = {
  ok: boolean;
  engine: string;
  banner: string;
  events: GeomEvent[];
  score: Score;
  musicxml?: string;
  error?: string;
};

export type GeomPreviewHook = {
  engine: string;
  banner: string;
  usedGeom: boolean;
  events?: GeomEvent[];
  score?: Score;
  editorScore?: Score;
  editorOpen?: boolean;
  publishedScore?: Score;
};

declare global {
  interface Window {
    __PUXIAN_GEOM_PREVIEW__?: GeomPreviewHook;
  }
}

export function eventsFromScore(score: Score): GeomEvent[] {
  const voices: ScoreNote[][] = [score.notes];
  if (score.voice2) voices.push(score.voice2);
  if (score.extraVoices) voices.push(...score.extraVoices);
  const ev: GeomEvent[] = [];
  for (const voice of voices) {
    let t = 0;
    for (const note of voice) {
      for (const pitch of note.pitches) ev.push({ pitch, start: t, dur: note.dur });
      t += note.dur;
    }
  }
  ev.sort((a, b) => a.start - b.start || a.pitch - b.pitch);
  return ev;
}

export function installGeomHook(partial: Partial<GeomPreviewHook>): GeomPreviewHook {
  const prev = window.__PUXIAN_GEOM_PREVIEW__ ?? {
    engine: "smt",
    banner: "",
    usedGeom: false,
  };
  const next = { ...prev, ...partial };
  window.__PUXIAN_GEOM_PREVIEW__ = next;
  return next;
}

export async function probeGeom(timeoutMs = 2500): Promise<GeomStatus | null> {
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${GEOM_API}/status`, { method: "GET", signal: ctrl.signal });
    if (!res.ok) return null;
    const data = (await res.json()) as GeomStatus;
    return data?.ok ? data : null;
  } catch {
    return null;
  } finally {
    window.clearTimeout(timer);
  }
}

/** A 4xx the server already explained. Do not start the browser model after this. */
export class GeomRefusal extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "GeomRefusal";
    this.status = status;
  }
}

export async function recognizeGeom(
  file: File,
  onTick?: (elapsedSec: number, stage: string) => void,
): Promise<GeomResult> {
  const started = Date.now();
  const token =
    globalThis.crypto?.randomUUID?.() ?? `job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  let closed = false;
  const tick = window.setInterval(() => {
    if (closed) return;
    const sec = Math.round((Date.now() - started) / 1000);
    onTick?.(sec, `正在识别（已用 ${sec} 秒，大图可能需要一两分钟）…`);
    // The status body stays public. Only this request's token can read its stage.
    void fetch(GEOM_API + "/status", { headers: { "X-Geom-Job": token } })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: GeomStatus | null) => {
        if (closed) return;
        const stage = data?.job?.stage;
        if (stage) onTick?.(Math.round((Date.now() - started) / 1000), `${stage}（已用 ${sec} 秒）`);
      })
      .catch(() => {});
  }, 1000);
  try {
    const body = new FormData();
    body.append("image", file, file.name || "upload.png");
    body.append("job", token);
    const res = await fetch(GEOM_API, { method: "POST", body, headers: { "X-Geom-Job": token } });
    const data = (await res.json()) as GeomResult & { error?: string };
    if (res.status >= 400 && res.status < 500 && data?.error && /[\u3400-\u9fff]/.test(data.error)) {
      throw new GeomRefusal(data.error, res.status);
    }
    if (!res.ok || !data?.ok || !data.score) {
      throw new Error(data?.error || `几何识谱接口失败（HTTP ${res.status}）`);
    }
    return data;
  } finally {
    closed = true;
    window.clearInterval(tick);
  }
}
