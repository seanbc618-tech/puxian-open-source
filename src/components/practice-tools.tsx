import { useEffect, useRef, useState } from "react";
import { quiet, solid } from "./ui/styles";
import { connectWaitInput, waitInputError, type WaitConnection } from "@/lib/music/wait-input";
import {
  A4_MAX,
  A4_MIN,
  clampA4,
  jianpuDegree,
  livePitchHz,
  needle,
  smoothPitch,
  TUNING_PRESETS,
  tunerReading,
  type TunerReading,
} from "@/lib/music/tuner";
import {
  ACCENT_LABEL,
  clampBpm,
  cycleAccent,
  METRO_MAX_BPM,
  METRO_MIN_BPM,
  GAP_OPTIONS,
  RAMP_OPTIONS,
  resizeAccents,
  trainerTicks,
  SUBDIVISIONS,
  tapTempo,
  type BeatAccent,
  type Subdivision,
} from "@/lib/music/metronome";

const IN_TUNE = "#2f7d4f";

/** Chromatic / string tuner on the local microphone (YIN, nothing recorded or uploaded). */
export function Tuner({ tonicPc, onClose }: { tonicPc: number; onClose: () => void }) {
  const [preset, setPreset] = useState("free");
  const [a4, setA4] = useState(440);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState("");
  const [reading, setReading] = useState<TunerReading | null>(null);
  const conn = useRef<WaitConnection | null>(null);
  const history = useRef<(number | null)[]>([]);
  const settings = useRef({ preset, a4 });
  settings.current = { preset, a4 };
  const attempt = useRef(0);
  const stop = () => {
    attempt.current += 1;
    conn.current?.stop();
    conn.current = null;
    history.current = [];
    setListening(false);
    setReading(null);
  };
  useEffect(() => () => conn.current?.stop(), []);
  const start = async () => {
    setError("");
    setListening(true);
    const mine = ++attempt.current;
    try {
      const next = await connectWaitInput(
        "mic",
        (event) => {
          if (event.kind !== "mic") return;
          history.current = [...history.current.slice(-5), event.midi];
          const midi = smoothPitch(history.current);
          const { preset: id, a4: ref } = settings.current;
          setReading(midi == null ? null : tunerReading(livePitchHz(midi), ref, TUNING_PRESETS.find((p) => p.id === id)));
        },
        () => {},
      );
      if (mine !== attempt.current) next.stop();
      else conn.current = next;
    } catch (e) {
      if (mine !== attempt.current) return;
      setListening(false);
      setError(waitInputError(e));
    }
  };
  const tuning = TUNING_PRESETS.find((p) => p.id === preset);
  const pos = reading ? needle(reading.cents) : 0;
  const color = reading?.inTune ? IN_TUNE : "var(--color-ink)";
  return (
    <div className="tool-group mt-3" data-tuner="">
      <p className="tool-group-title">
        调音器<span>麦克风只在本机分析</span>
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={listening ? solid : quiet} aria-pressed={listening} onClick={() => (listening ? stop() : void start())}>
          {listening ? "停止调音" : "开始调音"}
        </button>
        <select className="practice-select max-w-full" aria-label="调音乐器" value={preset} onChange={(e) => setPreset(e.target.value)}>
          {TUNING_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
        <button type="button" className={quiet} onClick={() => { stop(); onClose(); }}>
          收起调音器
        </button>
        <label className="flex w-full min-w-0 items-center gap-2 text-sm">
          <span className="whitespace-nowrap">A4 = {a4} Hz</span>
          <input
            className="h-11 min-w-0 flex-1 accent-accent"
            type="range"
            aria-label="标准音 A4 频率"
            min={A4_MIN}
            max={A4_MAX}
            value={a4}
            onChange={(e) => setA4(clampA4(Number(e.target.value)))}
          />
        </label>
      </div>
      {error ? <p className="mt-2 text-sm" role="alert">{error}</p> : null}
      <div className="mt-3 rounded-2xl border border-line p-3" aria-live="polite">
        <div className="flex flex-wrap items-center gap-3">
          <strong className="text-2xl" data-tuner-note="" style={{ color }}>
            {reading ? reading.name : "—"}
          </strong>
          <span className="text-sm text-muted">
            {reading ? `简谱 ${jianpuDegree(reading.midi, tonicPc)} · ${reading.hz} Hz · ${reading.cents > 0 ? "+" : ""}${reading.cents} 音分` : listening ? "请拨一根弦或唱一个长音" : "未在听"}
          </span>
        </div>
        <div
          role="meter"
          aria-label="音准偏差"
          aria-valuemin={-50}
          aria-valuemax={50}
          aria-valuenow={reading ? Math.max(-50, Math.min(50, Math.round(reading.cents))) : 0}
          style={{ position: "relative", height: 28, marginTop: 8, borderBottom: "1px solid var(--color-line)" }}
        >
          <span style={{ position: "absolute", left: "45%", width: "10%", top: 0, bottom: 0, background: "rgba(47,125,79,.12)" }} />
          <span style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: 1, background: "var(--color-faint)" }} />
          <span
            style={{
              position: "absolute",
              left: `calc(${50 + pos * 50}% - 2px)`,
              top: 2,
              bottom: 0,
              width: 4,
              borderRadius: 2,
              background: color,
              opacity: reading ? 1 : 0.25,
              transition: "left 80ms linear",
            }}
          />
        </div>
        <div className="flex text-xs text-muted" style={{ justifyContent: "space-between" }}>
          <span>-50 偏低</span>
          <span>准</span>
          <span>偏高 +50</span>
        </div>
        {tuning?.strings.length ? (
          <p className="mt-2 text-sm" data-tuner-string="">
            {reading?.string
              ? `第 ${tuning.strings.length - reading.string.index} 弦 ${reading.string.name}：${reading.string.hint === "准" ? "已准" : reading.string.hint}`
              : `空弦：${tuning.label.split(" ")[1] ?? ""}`}
          </p>
        ) : null}
      </div>
    </div>
  );
}

const LOOKAHEAD = 0.12;

/** Target choices for the speed-up: +10 … +60 from the start tempo, keeping the current pick. */
function rampTargets(bpm: number, current: number): number[] {
  const list = [10, 20, 30, 40, 60].map((d) => Math.min(METRO_MAX_BPM, bpm + d));
  return [...new Set([...list, current])].filter((v) => v > bpm || v === current).sort((a, b) => a - b);
}

/** Standalone metronome: its own audio context, so it works without playing the score. */
export function Metronome({ initialBpm, initialBeats, playing, onClose, onRunning }: { initialBpm: number; initialBeats: number; playing: boolean; onClose: () => void; /** 练琴记录 times the metronome while it ticks. */ onRunning?: (running: boolean) => void }) {
  const [bpm, setBpm] = useState(() => clampBpm(initialBpm));
  const [accents, setAccents] = useState<BeatAccent[]>(() => resizeAccents([], initialBeats));
  const [subdivision, setSubdivision] = useState<Subdivision>(1);
  const [running, setRunning] = useState(false);
  const [beat, setBeat] = useState(-1);
  const [gapId, setGapId] = useState("off");
  const [rampId, setRampId] = useState("off");
  const [rampTarget, setRampTarget] = useState(() => Math.min(METRO_MAX_BPM, clampBpm(initialBpm) + 20));
  const [now, setNow] = useState<{ bar: number; bpm: number; silent: boolean } | null>(null);
  const taps = useRef<number[]>([]);
  const gap = GAP_OPTIONS.find((o) => o.id === gapId)?.gap ?? null;
  const rampOption = RAMP_OPTIONS.find((o) => o.id === rampId);
  const ramp = rampOption && rampOption.step > 0 ? { step: rampOption.step, every: rampOption.every, target: rampTarget } : null;
  const live = useRef({ bpm, accents, subdivision, gap, ramp });
  live.current = { bpm, accents, subdivision, gap, ramp };
  const engine = useRef<{ ctx: AudioContext; timer: number; stop: () => void } | null>(null);
  const halt = () => {
    engine.current?.stop();
    engine.current = null;
    setRunning(false);
    setBeat(-1);
    setNow(null);
  };
  useEffect(() => () => engine.current?.stop(), []);
  useEffect(() => { if (playing) halt(); }, [playing]);
  const report = useRef(onRunning);
  report.current = onRunning;
  useEffect(() => { report.current?.(running); }, [running]);
  useEffect(() => () => report.current?.(false), []);
  // Tempo / meter / subdivision / speed-up changes restart the grid (and the ramp) from the next tick.
  // Silent bars switch live.
  useEffect(() => {
    if (engine.current) { halt(); start(); }
  }, [bpm, accents.length, subdivision, rampId, rampTarget]);
  const start = () => {
    if (typeof AudioContext === "undefined") return;
    const ctx = new AudioContext();
    void ctx.resume();
    const bus = ctx.createGain();
    bus.gain.value = 0.2;
    bus.connect(ctx.destination);
    let cursor = { index: 0, when: ctx.currentTime + 0.06 };
    const pending: { when: number; beat: number; bar: number; bpm: number; silent: boolean }[] = [];
    const pump = () => {
      if (ctx.state === "closed") return;
      const result = trainerTicks(live.current, cursor, ctx.currentTime + LOOKAHEAD);
      cursor = result.cursor;
      for (const c of result.clicks) {
        if (c.sub === 0) pending.push({ when: c.when, beat: c.beat, bar: c.bar, bpm: c.bpm, silent: c.silent });
        if (c.silent) continue;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "square";
        osc.frequency.setValueAtTime(c.accent ? 1760 : c.sub ? 880 : 1174.66, c.when);
        gain.gain.setValueAtTime(0.0001, c.when);
        gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, c.level), c.when + 0.002);
        gain.gain.exponentialRampToValueAtTime(0.0001, c.when + (c.accent ? 0.04 : 0.026));
        osc.connect(gain);
        gain.connect(bus);
        osc.start(c.when);
        osc.stop(c.when + 0.07);
      }
      let shown: (typeof pending)[number] | null = null;
      while (pending.length && pending[0].when <= ctx.currentTime) shown = pending.shift()!;
      if (shown != null) {
        setBeat(shown.beat);
        const { bar, bpm: at, silent } = shown;
        setNow((old) => (old && old.bar === bar && old.bpm === at && old.silent === silent ? old : { bar, bpm: at, silent }));
      }
    };
    pump();
    const timer = window.setInterval(pump, 25);
    engine.current = {
      ctx,
      timer,
      stop: () => {
        window.clearInterval(timer);
        void ctx.close().catch(() => {});
      },
    };
    setRunning(true);
  };
  const tap = () => {
    const next = tapTempo(taps.current, performance.now());
    taps.current = next.taps;
    if (next.bpm != null) setBpm(next.bpm);
  };
  return (
    <div className="tool-group mt-3" data-standalone-metronome="">
      <p className="tool-group-title">
        独立节拍器<span>不播谱也能用；开始播放乐谱时自动停</span>
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={running ? solid : quiet} aria-pressed={running} onClick={() => (running ? halt() : start())}>
          {running ? "停止节拍器" : "开始节拍器"}
        </button>
        <button type="button" className={quiet} onClick={tap}>
          点按测速
        </button>
        <button type="button" className={quiet} onClick={() => { halt(); onClose(); }}>
          收起节拍器
        </button>
      </div>
      <label className="mt-2 flex items-center gap-2 text-sm">
        速度 {bpm}
        <input
          className="h-11 min-w-0 flex-1 accent-accent"
          type="range"
          aria-label="独立节拍器速度"
          min={METRO_MIN_BPM}
          max={METRO_MAX_BPM}
          value={bpm}
          onChange={(e) => setBpm(clampBpm(Number(e.target.value)))}
        />
      </label>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-sm">
          每小节
          <select className="practice-select" aria-label="独立节拍器拍数" value={accents.length} onChange={(e) => setAccents((a) => resizeAccents(a, Number(e.target.value)))}>
            {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {n} 拍
              </option>
            ))}
          </select>
        </label>
        <select className="practice-select" aria-label="独立节拍器细分" value={subdivision} onChange={(e) => setSubdivision(Number(e.target.value) as Subdivision)}>
          {SUBDIVISIONS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2" data-metro-trainer="">
        <label className="flex items-center gap-2 text-sm">
          静音小节
          <select className="practice-select" aria-label="静音小节（练内心节拍）" value={gapId} onChange={(e) => setGapId(e.target.value)}>
            {GAP_OPTIONS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm">
          自动加速
          <select className="practice-select" aria-label="自动加速" value={rampId} onChange={(e) => setRampId(e.target.value)}>
            {RAMP_OPTIONS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
        </label>
        {ramp ? (
          <label className="flex items-center gap-2 text-sm">
            加到
            <select className="practice-select" aria-label="自动加速目标速度" value={rampTarget} onChange={(e) => setRampTarget(Number(e.target.value))}>
              {rampTargets(bpm, rampTarget).map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </label>
        ) : null}
      </div>
      {running && now && (gap || ramp) ? (
        <p className="mt-1 text-sm" role="status" data-metro-now="">
          第 {now.bar + 1} 小节 · ♩={now.bpm}
          {now.silent ? " · 静音中，心里继续数" : ""}
          {ramp && rampTarget > bpm && now.bpm >= Math.min(METRO_MAX_BPM, rampTarget) ? " · 已到目标速度" : ""}
        </p>
      ) : ramp && rampTarget <= bpm ? (
        <p className="mt-1 text-sm text-muted">目标速度要比现在快，才会加速。</p>
      ) : null}
      <div className="mt-2 flex flex-wrap gap-2" aria-label="每拍重音（点按切换 重 / 普通 / 静音）">
        {accents.map((a, i) => (
          <button
            key={i}
            type="button"
            className={quiet}
            aria-label={`第 ${i + 1} 拍：${ACCENT_LABEL[a]}`}
            aria-current={running && beat === i ? "true" : undefined}
            onClick={() => setAccents((list) => list.map((v, j) => (j === i ? cycleAccent(v) : v)))}
            style={running && beat === i ? { background: "var(--color-accent)", color: "var(--color-accent-fg)" } : undefined}
          >
            {i + 1}·{ACCENT_LABEL[a]}
          </button>
        ))}
      </div>
    </div>
  );
}
