import { useEffect, useRef, useState } from "react";
import {
  DRONE_DEGREES,
  DRONE_VOICINGS,
  droneFrequencies,
  droneIntervals,
  justCents,
  readDrone,
  writeDrone,
  type DroneDegree,
  type DroneSettings,
} from "@/lib/music/drone";
import type { KeyName, Mode } from "@/lib/music/theory";
import { quiet, solid } from "./ui/styles";
import "./drone.css";

const DEGREE_LABEL = ["1", "2", "3", "4", "5", "6", "7"];

/**
 * 持续音: a steady tone (or fifth / triad) in the score's key to hold long notes and scales
 * against. Local Web Audio only; it fades out when the score plays or the panel folds.
 */
export default function Drone({ keyName, mode, playing, onRunning, onClose }: {
  keyName: KeyName; mode: Mode; playing: boolean;
  /** Sounding = practice time on the open song (练琴计时), like the standalone metronome. */
  onRunning: (running: boolean) => void; onClose: () => void;
}) {
  const [settings, setSettings] = useState<DroneSettings>(() => readDrone(localStorage));
  const [degree, setDegree] = useState<DroneDegree>(1);
  const [on, setOn] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const audio = useRef<{ ctx: AudioContext; master: GainNode; tones: OscillatorNode[] } | null>(null);
  const freqs = droneFrequencies(keyName, mode, degree, settings.voicing, settings.tuning);

  const close = () => {
    const old = audio.current;
    audio.current = null;
    if (!old) return;
    const t = old.ctx.currentTime;
    old.master.gain.cancelScheduledValues(t);
    old.master.gain.setTargetAtTime(0, t, 0.05);
    window.setTimeout(() => { if (old.ctx.state !== "closed") void old.ctx.close(); }, 300);
  };
  useEffect(() => close, []);
  const running = useRef(onRunning);
  running.current = onRunning;
  useEffect(() => { running.current(on); }, [on]);
  useEffect(() => () => running.current(false), []);
  useEffect(() => { if (playing) setOn(false); }, [playing]);

  // (Re)voice whenever the pitches change while sounding; a short fade avoids clicks.
  const key = freqs.map((f) => f.toFixed(3)).join(",");
  useEffect(() => {
    close();
    if (!on || typeof AudioContext === "undefined") return;
    const ctx = new AudioContext();
    void ctx.resume();
    const master = ctx.createGain();
    master.gain.setValueAtTime(0, ctx.currentTime);
    master.gain.setTargetAtTime(settings.volume * 0.18, ctx.currentTime, 0.12);
    master.connect(ctx.destination);
    const tones: OscillatorNode[] = [];
    for (const f of freqs) {
      // A soft organ-like tone: the fundamental plus a quiet octave.
      for (const [mult, level, type] of [[1, 1, "sine"], [2, 0.25, "triangle"]] as const) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = type;
        osc.frequency.value = f * mult;
        gain.gain.value = level / freqs.length;
        osc.connect(gain).connect(master);
        osc.start();
        tones.push(osc);
      }
    }
    audio.current = { ctx, master, tones };
  }, [on, key]);
  useEffect(() => {
    const live = audio.current;
    if (live) live.master.gain.setTargetAtTime(settings.volume * 0.18, live.ctx.currentTime, 0.05);
  }, [settings.volume]);

  const change = (next: DroneSettings) => {
    setSettings(next);
    setNotice(writeDrone(localStorage, next) ? null : "没能保存到本机，可能空间不足。");
  };
  const intervals = droneIntervals(mode, degree, settings.voicing).slice(1);
  const hint = settings.tuning === "just" && intervals.length
    ? `纯律：${intervals.map((s) => `${s === 3 ? "小三度" : s === 4 ? "大三度" : s === 6 ? "减五度" : s === 8 ? "增五度" : "纯五度"} ${justCents(s) > 0 ? "+" : ""}${justCents(s)} 音分`).join("，")}（相对平均律），和音不打拍。`
    : "平均律：和钢琴、乐谱播放一致。";
  return (
    <div className="tool-group drone" data-drone>
      <p className="tool-group-title">持续音<span>{keyName} {mode === "minor" ? "小调" : "大调"} · 拉长音、练音阶时对着听音准</span></p>
      <div className="mt-1 flex flex-wrap gap-2">
        <button type="button" className={on ? quiet : solid} disabled={playing} aria-pressed={on} onClick={() => setOn(!on)}>
          {on ? "停止持续音" : "开始持续音"}
        </button>
        <button type="button" className={quiet} onClick={() => { setOn(false); close(); onClose(); }}>收起持续音</button>
      </div>
      <div className="drone-degrees segmented" role="radiogroup" aria-label="持续音根音（级数）">
        {DRONE_DEGREES.map((d) => (
          <button key={d} type="button" role="radio" aria-checked={degree === d} aria-label={`根音 ${DEGREE_LABEL[d - 1]} 级`} onClick={() => setDegree(d)}>
            {DEGREE_LABEL[d - 1]}
          </button>
        ))}
      </div>
      <div className="segmented mt-2" role="radiogroup" aria-label="持续音声部">
        {DRONE_VOICINGS.map((v) => (
          <button key={v.id} type="button" role="radio" aria-checked={settings.voicing === v.id} onClick={() => change({ ...settings, voicing: v.id })}>
            {v.label}
          </button>
        ))}
      </div>
      <div className="segmented mt-2" role="radiogroup" aria-label="持续音律制">
        <button type="button" role="radio" aria-checked={settings.tuning === "equal"} onClick={() => change({ ...settings, tuning: "equal" })}>平均律</button>
        <button type="button" role="radio" aria-checked={settings.tuning === "just"} onClick={() => change({ ...settings, tuning: "just" })}>纯律（无拍音）</button>
      </div>
      <label className="drone-volume">
        <span>音量</span>
        <input type="range" aria-label="持续音音量" min={5} max={100} step={5} value={Math.round(settings.volume * 100)}
          onChange={(event) => change({ ...settings, volume: Number(event.target.value) / 100 })} />
      </label>
      <p className="text-xs text-muted" data-drone-hint>{hint}</p>
      <p className="text-xs text-muted" data-drone-freqs>{freqs.map((f) => `${f.toFixed(1)} Hz`).join(" · ")}{on ? "（正在发声）" : ""}</p>
      {notice ? <p className="text-xs" role="status">{notice}</p> : null}
    </div>
  );
}
