import { useEffect, useRef, useState } from "react";
import {
  CALIBRATION_GAP_S,
  LATENCY_MAX_MS,
  LATENCY_MIN_MS,
  LATENCY_STEP_MS,
  RHYTHM_WINDOW_S,
  calibrationClicks,
  cleanLatency,
  compensate,
  estimateLatency,
  gradeTaps,
  readLatency,
  rhythmExercise,
  rhythmRange,
  rhythmSummary,
  weakBars,
  writeLatency,
  type RhythmExercise,
  type RhythmResult,
} from "@/lib/music/rhythm-tap";
import type { LoopRange } from "@/lib/music/practice";
import type { Score } from "@/lib/music/theory";
import { generateRhythmQuiz, quizText, quizTokens, quizToScore, type RhythmQuiz } from "@/lib/music/rhythm-quiz";
import { quiet, solid } from "./ui/styles";
import "./rhythm-tapper.css";

const VERDICT_TEXT = { good: "准", early: "偏早", late: "偏晚", miss: "漏拍" } as const;

/**
 * 拍节奏: one bar of count-in, then the beat keeps clicking while the player taps each
 * written note of the range (A-B loop, or the first four bars). Local Web Audio only.
 */
export default function RhythmTapper({ score, loop, speed, playing, onRunning, onClose }: {
  score: Score; loop: LoopRange | null; speed: number; playing: boolean;
  onRunning: (running: boolean) => void; onClose: () => void;
}) {
  const range = rhythmRange(score, loop);
  // A drill (exercise set) or a latency calibration (exercise null); `start` is the page-clock 0.
  const [run, setRun] = useState<{ exercise: RhythmExercise | null; start: number; latency: number } | null>(null);
  const [latency, setLatency] = useState(() => readLatency(localStorage));
  const [quizMode, setQuizMode] = useState(false);
  const [quizSeed, setQuizSeed] = useState(1);
  const written = rhythmExercise(score, range, speed);
  const quiz: RhythmQuiz = generateRhythmQuiz({
    seed: quizSeed,
    beats: score.beats,
    beatUnit: score.beatUnit,
    bars: 2,
  });
  const quizLength = quiz.events.reduce((sum, event) => sum + event.dur, 0);
  const preview = quizMode
    ? rhythmExercise(quizToScore(quiz, score.bpm), { from: 0, to: quizLength }, speed)
    : written;
  const [calNotice, setCalNotice] = useState<string | null>(null);
  const [result, setResult] = useState<RhythmResult | null>(null);
  const [shown, setShown] = useState<RhythmExercise | null>(null);
  const [beat, setBeat] = useState<string | null>(null);
  const taps = useRef<number[]>([]);
  const ctx = useRef<AudioContext | null>(null);
  const timers = useRef<number[]>([]);
  const running = useRef(onRunning);
  running.current = onRunning;

  const stop = () => {
    for (const id of timers.current) window.clearTimeout(id);
    timers.current = [];
    const old = ctx.current;
    ctx.current = null;
    if (old && old.state !== "closed") void old.close();
    setRun(null);
    setBeat(null);
    running.current(false);
  };
  useEffect(() => stop, []);
  useEffect(() => { if (playing) stop(); }, [playing]);

  const beep = (audio: AudioContext, t: number, accent: boolean) => {
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = "square";
    osc.frequency.value = accent ? 1500 : 1000;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(accent ? 0.16 : 0.1, t + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    osc.connect(gain).connect(audio.destination);
    osc.start(t);
    osc.stop(t + 0.06);
  };

  /** Opens the audio and returns the page-clock ms of `lead` seconds from now. */
  const open = (lead: number, clicks: { when: number; accent: boolean }[]) => {
    const audio = new AudioContext();
    ctx.current = audio;
    void audio.resume();
    const zero = audio.currentTime + lead;
    for (const click of clicks) beep(audio, zero + click.when, click.accent);
    // Taps are timed on the page clock, lined up with the audio clock once here.
    return performance.now() + lead * 1000;
  };

  const start = () => {
    stop();
    if (typeof AudioContext === "undefined") return;
    const exercise = quizMode
      ? rhythmExercise(quizToScore(quiz, score.bpm), { from: 0, to: quiz.events.reduce((sum, event) => sum + event.dur, 0) }, speed)
      : rhythmExercise(score, range, speed);
    const lead = 0.15 - exercise.countIn[0].when;
    const startMs = open(lead, [...exercise.countIn, ...exercise.clicks]);
    const offset = latency;
    taps.current = [];
    setResult(null);
    setCalNotice(null);
    setShown(exercise);
    setRun({ exercise, start: startMs, latency: offset });
    running.current(true);
    const count = exercise.countIn.length;
    exercise.countIn.forEach((click, i) => {
      timers.current.push(window.setTimeout(() => setBeat(`预备 ${count - i}`), (lead + click.when) * 1000));
    });
    timers.current.push(window.setTimeout(() => setBeat("开始拍"), lead * 1000));
    timers.current.push(window.setTimeout(() => {
      const graded = gradeTaps(exercise.targets, compensate(taps.current, offset));
      stop();
      setResult(graded);
    }, (lead + exercise.length + RHYTHM_WINDOW_S + offset / 1000 + 0.1) * 1000));
  };

  const saveLatency = (ms: number, notice: string | null = null) => {
    const next = cleanLatency(ms);
    setLatency(next);
    setCalNotice(writeLatency(localStorage, next) ? notice : "没能保存到本机，可能空间不足。");
  };

  /** 点按校准: tap with each of eight clicks; the median lag is the output delay. */
  const calibrate = () => {
    stop();
    if (typeof AudioContext === "undefined") return;
    const clicks = calibrationClicks();
    const lead = 0.3;
    const startMs = open(lead, clicks.map((when, i) => ({ when, accent: i === 0 })));
    taps.current = [];
    setCalNotice(null);
    setRun({ exercise: null, start: startMs, latency: 0 });
    clicks.forEach((when, i) => {
      timers.current.push(window.setTimeout(() => setBeat(`跟着每一声点 ${i + 1}/${clicks.length}`), (lead + when) * 1000));
    });
    timers.current.push(window.setTimeout(() => {
      const found = estimateLatency(clicks, taps.current);
      stop();
      if (found == null) setCalNotice("点得太少，没校准成：每听到一声就点一下，至少跟上 4 下。");
      else saveLatency(found, `已校准：延迟补偿 ${found} 毫秒，存在本机。`);
    }, (lead + clicks[clicks.length - 1] + CALIBRATION_GAP_S + 0.2) * 1000));
  };

  const tap = (stamp: number) => {
    if (!run) return;
    taps.current.push((stamp - run.start) / 1000);
  };

  const lane = shown ?? preview;
  const span = Math.max(0.5, lane.length);
  const x = (seconds: number) => `${Math.min(100, Math.max(0, (seconds / span) * 100))}%`;
  const weak = result ? weakBars(result) : [];
  return (
    <div className="tool-group rhythm-tapper" data-rhythm-tapper>
      <p className="tool-group-title">拍节奏<span>{quizMode ? `随机题 · ${quiz.bars} 小节` : `第 ${lane.bars[0]}–${lane.bars[1]} 小节`} · {lane.targets.length} 个音 · {Math.round(speed * 100)}%</span></p>
      <p className="text-xs text-muted">{quizMode ? "先听一小节预备拍，再按下面这道随机节奏点按，每个音点一下。换一题出新节奏，不改谱子。" : "先听一小节预备拍，再跟着节拍按谱子的节奏点按，每个音点一下。设了 A-B 段落就拍那一段。"}</p>
      <div className="segmented" role="radiogroup" aria-label="拍节奏题目">
        <button type="button" aria-checked={!quizMode} disabled={run != null} onClick={() => { setQuizMode(false); setResult(null); setShown(null); }}>按谱拍</button>
        <button type="button" aria-checked={quizMode} disabled={run != null} onClick={() => { setQuizMode(true); setResult(null); setShown(null); }}>随机题</button>
      </div>
      {quizMode ? (
        <div className="rhythm-quiz" data-rhythm-quiz={quizText(quiz)} data-rhythm-quiz-seed={String(quiz.seed)}>
          {quizTokens(quiz).map((token, index) => (
            <span key={`${token.bar}-${index}`} data-rest={token.label === "休" ? "" : undefined} style={{ ["--d" as string]: token.dur }}>{token.label}{index < quizTokens(quiz).length - 1 && quizTokens(quiz)[index + 1]?.bar !== token.bar ? " |" : ""}</span>
          ))}
        </div>
      ) : null}
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" className={solid} disabled={playing || run != null || !preview.targets.length} onClick={start}>
          {result ? "再拍一次" : "开始拍节奏"}
        </button>
        {run ? <button type="button" className={quiet} onClick={stop}>停下</button> : null}
        {quizMode ? (
          <button type="button" className={quiet} disabled={playing || run != null} onClick={() => { setResult(null); setShown(null); setQuizSeed((seed) => seed + 1); }}>换一题</button>
        ) : null}
        <button type="button" className={quiet} onClick={() => { stop(); onClose(); }}>收起拍节奏</button>
      </div>
      <button type="button" className="rhythm-pad" data-rhythm-pad disabled={!run}
        data-rhythm-start={run ? String(run.start) : undefined}
        data-rhythm-targets={run?.exercise ? JSON.stringify(run.exercise.targets.map((t) => t.at)) : undefined}
        data-rhythm-calibrating={run && !run.exercise ? "" : undefined}
        onPointerDown={(event) => { event.preventDefault(); tap(event.timeStamp); }}
        onKeyDown={(event) => {
          if (event.repeat || (event.key !== " " && event.key !== "Enter")) return;
          event.preventDefault();
          tap(event.timeStamp);
        }}>
        {run ? beat ?? "准备…" : "点这里拍（或按空格）"}
      </button>
      <div className="rhythm-latency" data-rhythm-latency>
        <span>延迟补偿</span>
        <button type="button" className={quiet} aria-label={`延迟补偿减 ${LATENCY_STEP_MS} 毫秒`} disabled={run != null || latency <= LATENCY_MIN_MS}
          onClick={() => saveLatency(latency - LATENCY_STEP_MS)}>−</button>
        <output aria-label="延迟补偿毫秒">{latency} 毫秒</output>
        <button type="button" className={quiet} aria-label={`延迟补偿加 ${LATENCY_STEP_MS} 毫秒`} disabled={run != null || latency >= LATENCY_MAX_MS}
          onClick={() => saveLatency(latency + LATENCY_STEP_MS)}>+</button>
        <button type="button" className={quiet} disabled={playing || run != null} onClick={calibrate}>点按校准</button>
      </div>
      <p className="text-xs text-muted">戴蓝牙耳机时声音晚到，点按会整体偏晚：先点「点按校准」，跟着 8 声点按，或手动调；只存在本机。</p>
      {calNotice ? <p className="text-xs" role="status" data-rhythm-calibration>{calNotice}</p> : null}
      <svg className="rhythm-lane" role="img" aria-label="节奏对照：竖线是谱上的音，圆点是你的点按" width="100%" height="34">
        {lane.clicks.map((click, i) => <line key={`b${i}`} x1={x(click.when)} x2={x(click.when)} y1="28" y2="34" className="rhythm-beat" />)}
        {lane.targets.map((target, i) => <line key={`t${i}`} x1={x(target.at)} x2={x(target.at)} y1="4" y2="26" className="rhythm-target" />)}
        {result?.marks.map((mark, i) => mark.offset == null ? null
          : <circle key={`m${i}`} cx={x(mark.target.at + mark.offset)} cy="15" r="5" data-verdict={mark.verdict} />)}
        {result?.extra.map((at, i) => <circle key={`e${i}`} cx={x(at)} cy="15" r="4" data-verdict="extra" />)}
      </svg>
      {result ? (
        <>
          <p className="mt-2 text-sm" role="status" data-rhythm-summary>{rhythmSummary(result)}</p>
          <ol className="rhythm-marks" aria-label="每个音的结果">
            {result.marks.map((mark, i) => (
              <li key={i} data-verdict={mark.verdict}>
                {VERDICT_TEXT[mark.verdict]}{mark.offset != null && mark.verdict !== "good" ? ` ${Math.round(Math.abs(mark.offset) * 1000)}` : ""}
              </li>
            ))}
          </ol>
          <p className="text-xs text-muted" data-rhythm-weak>{weak.length ? `要再练：第 ${weak.join("、")} 小节（可在上面设成 A-B 段落）。` : "每个音都拍准了。"}</p>
        </>
      ) : null}
    </div>
  );
}
