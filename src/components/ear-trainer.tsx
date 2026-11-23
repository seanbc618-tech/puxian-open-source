import { useEffect, useRef, useState } from "react";
import {
  EAR_IDLE_MS,
  EAR_LEVELS,
  degreeLabel,
  earSummary,
  earTonic,
  eventsLength,
  levelOf,
  pickDegree,
  questionEvents,
  readEarStats,
  recordAnswer,
  resolution,
  resolutionEvents,
  writeEarStats,
  type Degree,
  type EarEvent,
  type EarLevelId,
} from "@/lib/music/ear-training";
import {
  INTERVAL_LEVELS,
  intervalLevelOf,
  intervalOf,
  intervalQuestionEvents,
  intervalSummary,
  pickInterval,
  pickIntervalPair,
  readIntervalStats,
  recordIntervalAnswer,
  writeIntervalStats,
  type IntervalId,
  type IntervalLevelId,
  type IntervalStyle,
} from "@/lib/music/ear-interval";
import {
  CHORD_LEVELS,
  chordLevelOf,
  chordOf,
  chordPitches,
  chordQuestionEvents,
  chordSummary,
  pickChord,
  pickChordRoot,
  readChordStats,
  recordChordAnswer,
  writeChordStats,
  type ChordId,
  type ChordLevelId,
  type ChordStyle,
} from "@/lib/music/ear-chord";
import {
  PROG_LEVELS,
  answerIds,
  pickProgression,
  progSummary,
  progressionLabel,
  progressionOf,
  progressionPitches,
  progressionUses,
  progressionQuestionEvents,
  readProgStats,
  recordProgAnswer,
  sameProgression,
  writeProgStats,
  type ProgChordId,
  type ProgLevelId,
  type ProgStyle,
  type ProgressionId,
} from "@/lib/music/ear-progression";
import {
  SCALE_LEVELS,
  scaleLevelOf,
  scaleOf,
  scalePitches,
  scaleQuestionEvents,
  scaleSummary,
  pickScale,
  pickScaleRoot,
  readScaleStats,
  recordScaleAnswer,
  writeScaleStats,
  type ScaleId,
  type ScaleLevelId,
  type ScaleDirection,
} from "@/lib/music/ear-scale";
import type { KeyName, Mode } from "@/lib/music/theory";
import { quiet, solid } from "./ui/styles";
import "./ear-trainer.css";

type DegreeQuestion = { kind: "degree"; degree: Degree; missed: boolean; solved: boolean };
type IntervalQuestion = { kind: "interval"; id: IntervalId; low: number; high: number; missed: boolean; solved: boolean };
type ChordQuestion = { kind: "chord"; id: ChordId; pitches: number[]; missed: boolean; solved: boolean };
type ProgressionQuestion = { kind: "progression"; id: ProgressionId; chords: number[][]; missed: boolean; solved: boolean };
type ScaleQuestion = { kind: "scale"; id: ScaleId; pitches: number[]; missed: boolean; solved: boolean };
type Question = DegreeQuestion | IntervalQuestion | ChordQuestion | ProgressionQuestion | ScaleQuestion;
type Drill = "degree" | "interval" | "chord" | "progression" | "scale";

const freq = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

/**
 * 听音练耳: default is cadence + one note by 简谱 degree; 认音程 plays two tones
 * and asks for the interval name; 认和弦 plays a block or broken chord and asks
 * for the quality; 认进行 plays a short progression and asks for Roman numerals
 * in order; 认音阶 plays a scale and asks for its type. Local Web Audio only;
 * the context is closed when the panel folds.
 */
export default function EarTrainer({ keyName, mode, playing, onActive, onClose }: {
  keyName: KeyName; mode: Mode; playing: boolean;
  /** True from a listen or answer until EAR_IDLE_MS without one (练琴计时). */
  onActive: (active: boolean) => void; onClose: () => void;
}) {
  const [drill, setDrill] = useState<Drill>("degree");
  const [level, setLevel] = useState<EarLevelId>("low");
  const [intervalLevel, setIntervalLevel] = useState<IntervalLevelId>("narrow");
  const [intervalStyle, setIntervalStyle] = useState<IntervalStyle>("melodic");
  const [chordLevel, setChordLevel] = useState<ChordLevelId>("triads");
  const [chordStyle, setChordStyle] = useState<ChordStyle>("block");
  const [progLevel, setProgLevel] = useState<ProgLevelId>("basic");
  const [progStyle, setProgStyle] = useState<ProgStyle>("block");
  const [scaleLevel, setScaleLevel] = useState<ScaleLevelId>("basic");
  const [scaleDirection, setScaleDirection] = useState<ScaleDirection>("up");
  const [draft, setDraft] = useState<ProgChordId[]>([]);
  const [question, setQuestion] = useState<Question | null>(null);
  const [status, setStatus] = useState("先听 I–IV–V–I 定调，再听一个音，按它在调里的级数作答。");
  const [sounding, setSounding] = useState(false);
  const [stats, setStats] = useState(() => readEarStats(localStorage));
  const [intervalStats, setIntervalStats] = useState(() => readIntervalStats(localStorage));
  const [chordStats, setChordStats] = useState(() => readChordStats(localStorage));
  const [progStats, setProgStats] = useState(() => readProgStats(localStorage));
  const [scaleStats, setScaleStats] = useState(() => readScaleStats(localStorage));
  const [session, setSession] = useState({ right: 0, total: 0 });
  const [intervalSession, setIntervalSession] = useState({ right: 0, total: 0 });
  const [chordSession, setChordSession] = useState({ right: 0, total: 0 });
  const [progSession, setProgSession] = useState({ right: 0, total: 0 });
  const [scaleSession, setScaleSession] = useState({ right: 0, total: 0 });
  const ctx = useRef<AudioContext | null>(null);
  const stopTimer = useRef<number | null>(null);
  const tonic = earTonic(keyName);
  const active = useRef(onActive);
  active.current = onActive;
  const idle = useRef<number | null>(null);
  const touch = () => {
    if (idle.current != null) window.clearTimeout(idle.current);
    else active.current(true);
    idle.current = window.setTimeout(() => { idle.current = null; active.current(false); }, EAR_IDLE_MS);
  };
  useEffect(() => () => {
    if (idle.current != null) window.clearTimeout(idle.current);
    idle.current = null;
    active.current(false);
  }, []);

  const silence = () => {
    if (stopTimer.current != null) window.clearTimeout(stopTimer.current);
    stopTimer.current = null;
    const old = ctx.current;
    ctx.current = null;
    if (old && old.state !== "closed") void old.close();
    setSounding(false);
  };
  useEffect(() => silence, []);
  // The score's own playback takes the speakers.
  useEffect(() => { if (playing) silence(); }, [playing]);

  const play = (events: EarEvent[]) => {
    silence();
    touch();
    if (typeof AudioContext === "undefined") return;
    const audio = new AudioContext();
    ctx.current = audio;
    void audio.resume();
    const start = audio.currentTime + 0.05;
    for (const e of events) {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = "triangle";
      osc.frequency.value = freq(e.midi);
      const t = start + e.when;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(e.gain, t + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, t + e.dur);
      osc.connect(gain).connect(audio.destination);
      osc.start(t);
      osc.stop(t + e.dur + 0.05);
    }
    setSounding(true);
    stopTimer.current = window.setTimeout(() => {
      stopTimer.current = null;
      if (ctx.current === audio) silence();
    }, (eventsLength(events) + 0.2) * 1000);
  };

  const askDegree = (nextLevel = level) => {
    const degree = pickDegree(nextLevel, question?.kind === "degree" ? question.degree : null);
    setQuestion({ kind: "degree", degree, missed: false, solved: false });
    setStatus("听好了：先定调，再听一个音。");
    play(questionEvents(tonic, mode, degree));
  };

  const askInterval = (nextLevel = intervalLevel, style = intervalStyle) => {
    const id = pickInterval(nextLevel, question?.kind === "interval" ? question.id : null);
    const pair = pickIntervalPair(intervalOf(id).semitones);
    setQuestion({ kind: "interval", id, low: pair.low, high: pair.high, missed: false, solved: false });
    setStatus(style === "harmonic" ? "听好了：两个音一起响。" : "听好了：先后两个音。");
    play(intervalQuestionEvents(pair.low, pair.high, style));
  };

  const askChord = (nextLevel = chordLevel, style = chordStyle) => {
    const id = pickChord(nextLevel, question?.kind === "chord" ? question.id : null);
    const pitches = chordPitches(id, pickChordRoot(id));
    setQuestion({ kind: "chord", id, pitches, missed: false, solved: false });
    setStatus(style === "arpeggio" ? "听好了：几个音先后响。" : "听好了：几个音一起响。");
    play(chordQuestionEvents(pitches, style));
  };

  const askProgression = (nextLevel = progLevel, style = progStyle) => {
    const id = pickProgression(nextLevel, mode, question?.kind === "progression" ? question.id : null);
    const chords = progressionPitches(tonic, progressionOf(id).chords);
    setDraft([]);
    setQuestion({ kind: "progression", id, chords, missed: false, solved: false });
    setStatus(style === "arpeggio" ? "听好了：和弦一个一个分解。" : "听好了：一串柱式和弦。");
    play(progressionQuestionEvents(chords, style));
  };

  const askScale = (nextLevel = scaleLevel, direction = scaleDirection) => {
    const id = pickScale(nextLevel, question?.kind === "scale" ? question.id : null);
    const pitches = scalePitches(id, pickScaleRoot(), direction);
    setQuestion({ kind: "scale", id, pitches, missed: false, solved: false });
    setStatus(direction === "updown" ? "听好了：音阶先上再下。" : "听好了：音阶从下往上。");
    play(scaleQuestionEvents(pitches));
  };

  const ask = () => {
    if (drill === "interval") askInterval();
    else if (drill === "chord") askChord();
    else if (drill === "progression") askProgression();
    else if (drill === "scale") askScale();
    else askDegree();
  };

  const replay = () => {
    if (!question) return;
    if (question.kind === "interval") play(intervalQuestionEvents(question.low, question.high, intervalStyle));
    else if (question.kind === "chord") play(chordQuestionEvents(question.pitches, chordStyle));
    else if (question.kind === "progression") play(progressionQuestionEvents(question.chords, progStyle));
    else if (question.kind === "scale") play(scaleQuestionEvents(question.pitches));
    else play(questionEvents(tonic, mode, question.degree));
  };

  const drillHint = (next: Drill) => {
    if (next === "interval") return "听两个音，选出它们的音程。可先听先后，再听同时。";
    if (next === "chord") return "听一个和弦，选出它的性质。可先听柱式，再听分解。";
    if (next === "progression") return "听一串和弦，按罗马数字依次点出进行。可先听柱式，再听分解。";
    if (next === "scale") return "听一条音阶，选出它的类型。可先听上行，再听上下行。";
    return "先听 I–IV–V–I 定调，再听一个音，按它在调里的级数作答。";
  };

  const switchDrill = (next: Drill) => {
    if (next === drill) return;
    silence();
    setQuestion(null);
    setDraft([]);
    setDrill(next);
    setStatus(drillHint(next));
  };

  const answerDegree = (picked: Degree) => {
    if (!question || question.kind !== "degree" || question.solved) return;
    touch();
    if (picked !== question.degree) {
      setQuestion({ ...question, missed: true });
      setStatus(`不是 ${degreeLabel(picked)}，再听听（可点「再听一次」）。`);
      return;
    }
    const firstTry = !question.missed;
    const next = recordAnswer(readEarStats(localStorage), question.degree, firstTry);
    writeEarStats(localStorage, next);
    setStats(next);
    setSession((s) => ({ right: s.right + (firstTry ? 1 : 0), total: s.total + 1 }));
    setQuestion({ ...question, solved: true });
    const walk = resolution(question.degree).map(degreeLabel).join(" ");
    setStatus(`${firstTry ? "答对了" : "对了"}：${degreeLabel(question.degree)}。回到主音：${walk}`);
    play(resolutionEvents(tonic, mode, question.degree));
  };

  const answerInterval = (picked: IntervalId) => {
    if (!question || question.kind !== "interval" || question.solved) return;
    touch();
    const right = intervalOf(question.id);
    if (picked !== question.id) {
      setQuestion({ ...question, missed: true });
      setStatus(`不是 ${intervalOf(picked).name}，再听听（可点「再听一次」）。`);
      return;
    }
    const firstTry = !question.missed;
    const next = recordIntervalAnswer(readIntervalStats(localStorage), question.id, firstTry);
    writeIntervalStats(localStorage, next);
    setIntervalStats(next);
    setIntervalSession((s) => ({ right: s.right + (firstTry ? 1 : 0), total: s.total + 1 }));
    setQuestion({ ...question, solved: true });
    setStatus(`${firstTry ? "答对了" : "对了"}：${right.name}。`);
  };

  const answerChord = (picked: ChordId) => {
    if (!question || question.kind !== "chord" || question.solved) return;
    touch();
    const right = chordOf(question.id);
    if (picked !== question.id) {
      setQuestion({ ...question, missed: true });
      setStatus(`不是 ${chordOf(picked).name}，再听听（可点「再听一次」）。`);
      return;
    }
    const firstTry = !question.missed;
    const next = recordChordAnswer(readChordStats(localStorage), question.id, firstTry);
    writeChordStats(localStorage, next);
    setChordStats(next);
    setChordSession((s) => ({ right: s.right + (firstTry ? 1 : 0), total: s.total + 1 }));
    setQuestion({ ...question, solved: true });
    setStatus(`${firstTry ? "答对了" : "对了"}：${right.name}。`);
  };

  const finishProgression = (nextDraft: readonly ProgChordId[], current: ProgressionQuestion) => {
    const expected = progressionOf(current.id).chords;
    if (!sameProgression(nextDraft, expected)) {
      setQuestion({ ...current, missed: true });
      setDraft([]);
      setStatus(`不是 ${nextDraft.join("–")}，再听听（可点「再听一次」）。`);
      return;
    }
    const firstTry = !current.missed;
    const next = recordProgAnswer(readProgStats(localStorage), current.id, firstTry);
    writeProgStats(localStorage, next);
    setProgStats(next);
    setProgSession((s) => ({ right: s.right + (firstTry ? 1 : 0), total: s.total + 1 }));
    setQuestion({ ...current, solved: true });
    setStatus(`${firstTry ? "答对了" : "对了"}：${progressionLabel(current.id)}。`);
  };

  const answerProgression = (picked: ProgChordId) => {
    if (!question || question.kind !== "progression" || question.solved) return;
    touch();
    const expected = progressionOf(question.id).chords;
    const nextDraft = [...draft, picked];
    setDraft(nextDraft);
    if (nextDraft.length < expected.length) {
      setStatus(`已选 ${nextDraft.join("–")}，继续选。`);
      return;
    }
    finishProgression(nextDraft, question);
  };

  const answerScale = (picked: ScaleId) => {
    if (!question || question.kind !== "scale" || question.solved) return;
    touch();
    const right = scaleOf(question.id);
    if (picked !== question.id) {
      setQuestion({ ...question, missed: true });
      setStatus(`不是 ${scaleOf(picked).name}，再听听（可点「再听一次」）。`);
      return;
    }
    const firstTry = !question.missed;
    const next = recordScaleAnswer(readScaleStats(localStorage), question.id, firstTry);
    writeScaleStats(localStorage, next);
    setScaleStats(next);
    setScaleSession((s) => ({ right: s.right + (firstTry ? 1 : 0), total: s.total + 1 }));
    setQuestion({ ...question, solved: true });
    setStatus(`${firstTry ? "答对了" : "对了"}：${right.name}。`);
  };

  const degrees: readonly Degree[] = levelOf(level).degrees;
  const intervalIds = intervalLevelOf(intervalLevel).ids;
  const chordIds = chordLevelOf(chordLevel).ids;
  const progAnswers = answerIds(mode);
  const scaleIds = scaleLevelOf(scaleLevel).ids;
  const caption = drill === "interval" ? "按音程作答"
    : drill === "chord" ? "按和弦性质作答"
    : drill === "progression" ? "按和弦进行作答"
    : drill === "scale" ? "按音阶类型作答"
    : "按简谱级数作答";
  return (
    <div className="tool-group ear-trainer" data-ear-trainer data-ear-drill={drill}>
      <p className="tool-group-title">听音练耳<span>{keyName} {mode === "minor" ? "小调" : "大调"} · {caption}</span></p>
      <div className="segmented" role="radiogroup" aria-label="练耳内容">
        <button type="button" role="radio" aria-checked={drill === "degree"} onClick={() => switchDrill("degree")}>认级数</button>
        <button type="button" role="radio" aria-checked={drill === "interval"} onClick={() => switchDrill("interval")}>认音程</button>
        <button type="button" role="radio" aria-checked={drill === "chord"} onClick={() => switchDrill("chord")}>认和弦</button>
        <button type="button" role="radio" aria-checked={drill === "progression"} onClick={() => switchDrill("progression")}>认进行</button>
        <button type="button" role="radio" aria-checked={drill === "scale"} onClick={() => switchDrill("scale")}>认音阶</button>
      </div>
      {drill === "degree" ? (
        <div className="segmented" role="radiogroup" aria-label="练耳范围">
          {EAR_LEVELS.map((item) => (
            <button key={item.id} type="button" role="radio" aria-checked={level === item.id}
              onClick={() => { setLevel(item.id); if (question) askDegree(item.id); }}>
              {item.label}
            </button>
          ))}
        </div>
      ) : drill === "interval" ? (
        <>
          <div className="segmented" role="radiogroup" aria-label="音程范围">
            {INTERVAL_LEVELS.map((item) => (
              <button key={item.id} type="button" role="radio" aria-checked={intervalLevel === item.id}
                onClick={() => { setIntervalLevel(item.id); if (question) askInterval(item.id); }}>
                {item.label}
              </button>
            ))}
          </div>
          <div className="segmented" role="radiogroup" aria-label="听法">
            <button type="button" role="radio" aria-checked={intervalStyle === "melodic"}
              onClick={() => { setIntervalStyle("melodic"); if (question?.kind === "interval") play(intervalQuestionEvents(question.low, question.high, "melodic")); }}>先后</button>
            <button type="button" role="radio" aria-checked={intervalStyle === "harmonic"}
              onClick={() => { setIntervalStyle("harmonic"); if (question?.kind === "interval") play(intervalQuestionEvents(question.low, question.high, "harmonic")); }}>同时</button>
          </div>
        </>
      ) : drill === "chord" ? (
        <>
          <div className="segmented" role="radiogroup" aria-label="和弦范围">
            {CHORD_LEVELS.map((item) => (
              <button key={item.id} type="button" role="radio" aria-checked={chordLevel === item.id}
                onClick={() => { setChordLevel(item.id); if (question) askChord(item.id); }}>
                {item.label}
              </button>
            ))}
          </div>
          <div className="segmented" role="radiogroup" aria-label="听法">
            <button type="button" role="radio" aria-checked={chordStyle === "block"}
              onClick={() => { setChordStyle("block"); if (question?.kind === "chord") play(chordQuestionEvents(question.pitches, "block")); }}>柱式</button>
            <button type="button" role="radio" aria-checked={chordStyle === "arpeggio"}
              onClick={() => { setChordStyle("arpeggio"); if (question?.kind === "chord") play(chordQuestionEvents(question.pitches, "arpeggio")); }}>分解</button>
          </div>
        </>
      ) : drill === "progression" ? (
        <>
          <div className="segmented" role="radiogroup" aria-label="进行范围">
            {PROG_LEVELS.map((item) => (
              <button key={item.id} type="button" role="radio" aria-checked={progLevel === item.id}
                onClick={() => { setProgLevel(item.id); if (question) askProgression(item.id); }}>
                {item.label}
              </button>
            ))}
          </div>
          <div className="segmented" role="radiogroup" aria-label="听法">
            <button type="button" role="radio" aria-checked={progStyle === "block"}
              onClick={() => { setProgStyle("block"); if (question?.kind === "progression") play(progressionQuestionEvents(question.chords, "block")); }}>柱式</button>
            <button type="button" role="radio" aria-checked={progStyle === "arpeggio"}
              onClick={() => { setProgStyle("arpeggio"); if (question?.kind === "progression") play(progressionQuestionEvents(question.chords, "arpeggio")); }}>分解</button>
          </div>
        </>
      ) : (
        <>
          <div className="segmented" role="radiogroup" aria-label="音阶范围">
            {SCALE_LEVELS.map((item) => (
              <button key={item.id} type="button" role="radio" aria-checked={scaleLevel === item.id}
                onClick={() => { setScaleLevel(item.id); if (question) askScale(item.id); }}>
                {item.label}
              </button>
            ))}
          </div>
          <div className="segmented" role="radiogroup" aria-label="听法">
            <button type="button" role="radio" aria-checked={scaleDirection === "up"}
              onClick={() => {
                setScaleDirection("up");
                if (question?.kind === "scale") {
                  const pitches = scalePitches(question.id, question.pitches[0]!, "up");
                  setQuestion({ ...question, pitches });
                  play(scaleQuestionEvents(pitches));
                }
              }}>上行</button>
            <button type="button" role="radio" aria-checked={scaleDirection === "updown"}
              onClick={() => {
                setScaleDirection("updown");
                if (question?.kind === "scale") {
                  const pitches = scalePitches(question.id, question.pitches[0]!, "updown");
                  setQuestion({ ...question, pitches });
                  play(scaleQuestionEvents(pitches));
                }
              }}>上下行</button>
          </div>
        </>
      )}
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" className={solid} disabled={playing || (question != null && !question.solved)} onClick={() => ask()}>
          {question ? "下一题" : "开始练耳"}
        </button>
        <button type="button" className={quiet} disabled={playing || !question} onClick={() => replay()}>
          再听一次
        </button>
        {drill === "progression" ? (
          <button type="button" className={quiet}
            disabled={playing || !question || question.solved || draft.length === 0}
            onClick={() => {
              const next = draft.slice(0, -1);
              setDraft(next);
              setStatus(next.length ? `已选 ${next.join("–")}，继续选。` : "听好了：按罗马数字依次点出进行。");
            }}>
            退格
          </button>
        ) : null}
        <button type="button" className={quiet} onClick={() => { silence(); onClose(); }}>收起练耳</button>
      </div>
      {drill === "degree" ? (
        <div className="ear-answers" role="group" aria-label="选级数">
          {degrees.map((degree) => (
            <button key={degree} type="button" className={quiet} disabled={!question || question.solved || playing}
              aria-label={`级数 ${degreeLabel(degree)}`}
              data-right={question?.kind === "degree" && question.solved && question.degree === degree ? "" : undefined}
              onClick={() => answerDegree(degree)}>
              {degreeLabel(degree)}
            </button>
          ))}
        </div>
      ) : drill === "interval" ? (
        <div className="ear-answers" data-kind="interval" role="group" aria-label="选音程">
          {intervalIds.map((id) => (
            <button key={id} type="button" className={quiet} disabled={!question || question.solved || playing}
              aria-label={intervalOf(id).name}
              data-right={question?.kind === "interval" && question.solved && question.id === id ? "" : undefined}
              onClick={() => answerInterval(id)}>
              {intervalOf(id).label}
            </button>
          ))}
        </div>
      ) : drill === "chord" ? (
        <div className="ear-answers" data-kind="chord" role="group" aria-label="选和弦">
          {chordIds.map((id) => (
            <button key={id} type="button" className={quiet} disabled={!question || question.solved || playing}
              aria-label={chordOf(id).name}
              data-right={question?.kind === "chord" && question.solved && question.id === id ? "" : undefined}
              onClick={() => answerChord(id)}>
              {chordOf(id).label}
            </button>
          ))}
        </div>
      ) : drill === "progression" ? (
        <>
          <p className="ear-prog-draft" data-ear-prog-draft role="status">
            {question?.kind === "progression" && question.solved
              ? progressionLabel(question.id)
              : draft.length ? draft.join("–") : "先听，再按顺序点级数。"}
          </p>
          <div className="ear-answers" data-kind="progression" role="group" aria-label="选进行">
            {progAnswers.map((id) => (
              <button key={id} type="button" className={quiet} disabled={!question || question.solved || playing}
                aria-label={id}
                data-right={question?.kind === "progression" && question.solved && progressionUses(question.id, id) ? "" : undefined}
                onClick={() => answerProgression(id)}>
                {id}
              </button>
            ))}
          </div>
        </>
      ) : (
        <div className="ear-answers" data-kind="scale" role="group" aria-label="选音阶">
          {scaleIds.map((id) => (
            <button key={id} type="button" className={quiet} disabled={!question || question.solved || playing}
              aria-label={scaleOf(id).name}
              data-right={question?.kind === "scale" && question.solved && question.id === id ? "" : undefined}
              onClick={() => answerScale(id)}>
              {scaleOf(id).label}
            </button>
          ))}
        </div>
      )}
      <p className="mt-2 text-sm" role="status" data-ear-status>{sounding ? `${status}（正在播放）` : status}</p>
      <p className="text-xs text-muted" data-ear-summary>
        {drill === "interval"
          ? `${intervalSession.total ? `本次 ${intervalSession.right}/${intervalSession.total} 一次答对。` : ""}${intervalSummary(intervalStats)}`
          : drill === "chord"
            ? `${chordSession.total ? `本次 ${chordSession.right}/${chordSession.total} 一次答对。` : ""}${chordSummary(chordStats)}`
            : drill === "progression"
              ? `${progSession.total ? `本次 ${progSession.right}/${progSession.total} 一次答对。` : ""}${progSummary(progStats)}`
              : drill === "scale"
                ? `${scaleSession.total ? `本次 ${scaleSession.right}/${scaleSession.total} 一次答对。` : ""}${scaleSummary(scaleStats)}`
                : `${session.total ? `本次 ${session.right}/${session.total} 一次答对。` : ""}${earSummary(stats)}`}
      </p>
    </div>
  );
}
