import { livePitch } from "./audio.ts";
import { connectMicCapture } from "./mic-capture.ts";
import type { WaitInput } from "./wait-mode.ts";
export type WaitConnection = { stop(): void };
/** Browser boundary. Caller cancels a pending permission request by closing its late result. */
export async function connectWaitInput(
  source: "midi" | "mic",
  onInput: (event: WaitInput) => void,
  onStatus: (message: string) => void,
): Promise<WaitConnection> {
  if (source === "midi") {
    if (!navigator.requestMIDIAccess)
      throw new Error("此浏览器不支持 MIDI，请使用支持 Web MIDI 的浏览器，或选择麦克风。");
    const access = await navigator.requestMIDIAccess({ sysex: false });
    const bound = new Set<MIDIInput>();
    const message = (event: MIDIMessageEvent) => {
      const data = event.data;
      if (!data || data.length < 3) return;
      const type = data[0] & 0xf0;
      if (type === 0x90 || type === 0x80)
        onInput({
          kind: type === 0x90 && data[2] > 0 ? "on" : "off",
          midi: data[1],
          at: performance.now(),
        });
    };
    const bind = () => {
      for (const input of bound)
        if (input.state === "disconnected") {
          input.removeEventListener("midimessage", message);
          bound.delete(input);
        }
      for (const input of access.inputs.values())
        if (input.state === "connected" && !bound.has(input)) {
          input.addEventListener("midimessage", message);
          bound.add(input);
        }
      onStatus(
        bound.size
          ? "MIDI 已连接。和弦请在 300 毫秒内按齐；相同的音需松开再弹。"
          : "未发现 MIDI 键盘，请连接键盘；可随时退出。",
      );
    };
    bind();
    access.addEventListener("statechange", bind);
    return {
      stop() {
        access.removeEventListener("statechange", bind);
        for (const input of bound) {
          input.removeEventListener("midimessage", message);
          void input.close().catch(() => {});
        }
        bound.clear();
      },
    };
  }
  if (!navigator.mediaDevices?.getUserMedia || typeof AudioContext === "undefined")
    throw new Error("此浏览器无法使用麦克风，请在 HTTPS 或本机地址中打开。");
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  });
  let audio: AudioContext | undefined;
  try {
    audio = new AudioContext();
    await audio.resume();
    const context = audio;
    const node = audio.createMediaStreamSource(stream);
    // At least 80ms of samples, analyzed at ~25 Hz, no recording or upload.
    const length = Math.ceil(audio.sampleRate * 0.1);
    const frame = new Float32Array(length);
    let filled = 0,
      since = 0;
    const capture = await connectMicCapture(audio, node, (data) => {
      if (data.length >= length) {
        frame.set(data.subarray(data.length - length));
        filled = length;
      } else {
        frame.copyWithin(0, data.length);
        frame.set(data, length - data.length);
        filled = Math.min(length, filled + data.length);
      }
      since += data.length;
      if (filled < length || since < context.sampleRate * 0.04) return;
      since = 0;
      onInput({ kind: "mic", midi: livePitch(frame, context.sampleRate), at: performance.now() });
    });
    onStatus(
      "麦克风只适合单音旋律；和弦只检查最高音。请逐音弹奏，相同音之间稍作停顿。音频仅在本机处理。",
    );
    return {
      stop() {
        capture.disconnect();
        node.disconnect();
        stream.getTracks().forEach((track) => track.stop());
        void context.close().catch(() => {});
      },
    };
  } catch (error) {
    stream.getTracks().forEach((track) => track.stop());
    void audio?.close().catch(() => {});
    throw error;
  }
}
export function waitInputError(error: unknown): string {
  if (error instanceof Error && /此浏览器/.test(error.message)) return error.message;
  if (
    error instanceof Error &&
    (error.name === "NotAllowedError" || error.name === "SecurityError")
  )
    return "未获得输入权限。请在浏览器的网站设置中允许 MIDI 或麦克风后重试。";
  return "无法连接输入设备，请检查设备是否连接、是否被其他应用占用，然后重试。";
}
