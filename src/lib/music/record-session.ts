export type RecordPhase = "idle" | "arming" | "live";

export type RecordGate = {
  phase: RecordPhase;
  /** A second tap arrived before the microphone was ready. */
  stopQueued: boolean;
};

export function initialRecordGate(): RecordGate {
  return { phase: "idle", stopQueued: false };
}

/**
 * One tap. Starting is idempotent: a second tap while arming queues a single
 * stop, and a tap while live stops. It never asks for another microphone.
 */
export function tapRecord(gate: RecordGate): {
  gate: RecordGate;
  begin: boolean;
  stopNow: boolean;
} {
  if (gate.phase === "idle") {
    return { gate: { phase: "arming", stopQueued: false }, begin: true, stopNow: false };
  }
  if (gate.phase === "arming") {
    return { gate: { phase: "arming", stopQueued: true }, begin: false, stopNow: false };
  }
  return { gate: { phase: "idle", stopQueued: false }, begin: false, stopNow: true };
}

/** The microphone permission returned. `alive` is false after unmount. */
export function finishArming(gate: RecordGate, alive: boolean): { gate: RecordGate; open: boolean } {
  if (!alive || gate.phase !== "arming" || gate.stopQueued) {
    return { gate: { phase: "idle", stopQueued: false }, open: false };
  }
  return { gate: { phase: "live", stopQueued: false }, open: true };
}

type Stoppable = { stop(): void };

/**
 * Mic and audio-node bag for one take.
 * Resources added after `release` are disposed immediately, so a stop during
 * `AudioContext.resume()` still drops tracks that were registered beforehand.
 */
export class RecordingArm {
  private released = false;
  private tracks: Stoppable[] = [];
  private closers: Array<() => void> = [];

  get isReleased(): boolean {
    return this.released;
  }

  track(track: Stoppable): void {
    if (this.released) {
      track.stop();
      return;
    }
    this.tracks.push(track);
  }

  closer(close: () => void): void {
    if (this.released) {
      close();
      return;
    }
    this.closers.push(close);
  }

  release(): void {
    if (this.released) return;
    this.released = true;
    for (const track of this.tracks) track.stop();
    for (const close of this.closers) close();
    this.tracks = [];
    this.closers = [];
  }
}

export const RECORD_SECONDS = 20;

/** Errors that belong in the dictation panel, not the floating editor toast. */
export function isMicrophoneStatusError(message: string): boolean {
  return /麦克风|录音|安全上下文|哼得太短|听不出|音高/.test(message);
}


export function microphoneHelp(userAgent: string): string {
  const ios = /iPad|iPhone|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && /Mobile/.test(userAgent));
  if (ios && /CriOS|FxiOS|EdgiOS/.test(userAgent)) {
    return "请在 iPhone/iPad 的设置里打开该浏览器的麦克风权限，或在地址栏网站设置中允许麦克风，然后刷新再试。";
  }
  if (ios) {
    return "请在设置 → Safari → 麦克风，或地址栏的网站设置里允许麦克风，然后刷新再试。";
  }
  if (/Chrome|Chromium|Edg/.test(userAgent)) {
    return "请点地址栏左侧图标 / 锁定标记 → 网站设置 → 麦克风 → 允许，然后刷新。";
  }
  return "请在地址栏站点权限里允许麦克风，然后刷新再试。";
}

export function microphoneError(error: unknown, userAgent: string, secure = true): string {
  const name = typeof error === "object" && error !== null && "name" in error ? String(error.name) : "";
  const fallback = "也可以改用「上传音乐」。";
  if (!secure || name === "InsecureContextError") {
    return "当前页面不是安全上下文，无法使用麦克风。请通过 HTTPS 或 localhost 打开。" + fallback;
  }
  if (name === "NotFoundError") return "没有找到麦克风。请连接麦克风，并检查系统输入设备。" + fallback;
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "麦克风权限未获允许，或被页面的权限策略限制。" + microphoneHelp(userAgent)
      + "若已允许仍失败，请在独立浏览器页面打开，或联系站点管理员检查麦克风权限策略。" + fallback;
  }
  if (name === "NotReadableError") return "麦克风被占用或无法读取。请关闭其他录音应用，检查系统麦克风权限后重试。" + fallback;
  if (name === "UnsupportedError") return "此浏览器未提供麦克风接口。请使用支持录音的浏览器打开。" + fallback;
  return "录音未能启动。请检查麦克风和系统音频设置后重试。" + fallback;
}

/** Meter uses captured PCM, not wall time; display level maps -60..0 dBFS to 0..1. */
export function recordingMeter(samples: Float32Array, collected: number, rate: number) {
  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  const rms = Math.sqrt(sum / Math.max(1, samples.length));
  const elapsed = Math.min(RECORD_SECONDS, Math.max(0, collected / rate));
  return { elapsed, remaining: RECORD_SECONDS - elapsed, level: Math.max(0, Math.min(1, (20 * Math.log10(Math.max(1e-6, rms)) + 60) / 60)) };
}
