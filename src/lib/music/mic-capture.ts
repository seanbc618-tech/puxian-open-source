/** Live humming capture. Prefers AudioWorklet; falls back to ScriptProcessor. */

export const MIC_CAPTURE_BUFFER = 4096;
export const MIC_WORKLET_NAME = "puxian-mic-capture";

/** Worklet source is built as a blob URL so the static host does not need a second file. */
export const MIC_WORKLET_SOURCE = `class PuxianMicCapture extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0] && inputs[0][0];
    if (input && input.length) this.port.postMessage(input.slice());
    return true;
  }
}
registerProcessor("${MIC_WORKLET_NAME}", PuxianMicCapture);
`;

export type MicCaptureKind = "worklet" | "script";

export type MicCaptureHandle = {
  node: AudioNode;
  kind: MicCaptureKind;
  disconnect: () => void;
};

export type MicFrameHandler = (frame: Float32Array) => void;

export type TakeMicFrame = {
  chunk: Float32Array | null;
  collected: number;
  done: boolean;
};

/** Copy one live frame into the collection, same take as the old ScriptProcessor path. */
export function takeMicFrame(data: ArrayLike<number>, collected: number, maxSamples: number): TakeMicFrame {
  const room = maxSamples - collected;
  if (room <= 0) return { chunk: null, collected, done: true };
  const take = Math.min(room, data.length);
  const chunk = new Float32Array(take);
  chunk.set(data instanceof Float32Array ? data.subarray(0, take) : Array.prototype.slice.call(data, 0, take));
  const next = collected + take;
  return { chunk, collected: next, done: next >= maxSamples };
}

async function tryWorklet(audio: AudioContext, onFrame: MicFrameHandler): Promise<AudioWorkletNode | null> {
  if (!audio.audioWorklet?.addModule) return null;
  const url = URL.createObjectURL(new Blob([MIC_WORKLET_SOURCE], { type: "text/javascript" }));
  try {
    await audio.audioWorklet.addModule(url);
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
  try {
    const node = new AudioWorkletNode(audio, MIC_WORKLET_NAME, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      channelCount: 1,
    });
    node.port.onmessage = (event) => {
      const data = event.data;
      if (data instanceof Float32Array && data.length) onFrame(data);
    };
    return node;
  } catch {
    return null;
  }
}

/**
 * source → capture → muted gain → destination, so the graph stays live
 * without playing the microphone back.
 */
export async function connectMicCapture(
  audio: AudioContext,
  source: MediaStreamAudioSourceNode,
  onFrame: MicFrameHandler,
): Promise<MicCaptureHandle> {
  const mute = audio.createGain();
  mute.gain.value = 0;
  const worklet = await tryWorklet(audio, onFrame);
  if (worklet) {
    source.connect(worklet);
    worklet.connect(mute);
    mute.connect(audio.destination);
    return {
      node: worklet,
      kind: "worklet",
      disconnect() {
        worklet.port.onmessage = null;
        try {
          source.disconnect(worklet);
        } catch {
          /* already disconnected */
        }
        try {
          worklet.disconnect();
        } catch {
          /* already disconnected */
        }
        try {
          mute.disconnect();
        } catch {
          /* already disconnected */
        }
      },
    };
  }

  const processor = audio.createScriptProcessor(MIC_CAPTURE_BUFFER, 1, 1);
  processor.onaudioprocess = (event) => {
    const data = event.inputBuffer.getChannelData(0);
    if (data.length) onFrame(data);
  };
  source.connect(processor);
  processor.connect(mute);
  mute.connect(audio.destination);
  return {
    node: processor,
    kind: "script",
    disconnect() {
      processor.onaudioprocess = null;
      try {
        source.disconnect(processor);
      } catch {
        /* already disconnected */
      }
      try {
        processor.disconnect();
      } catch {
        /* already disconnected */
      }
      try {
        mute.disconnect();
      } catch {
        /* already disconnected */
      }
    },
  };
}
