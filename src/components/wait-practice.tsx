import { useEffect, useRef, useState } from "react";
import type { Score } from "@/lib/music/theory";
import type { FollowSlot } from "@/lib/music/playback-clock";
import type { LoopRange } from "@/lib/music/practice";
import type { PracticeHand, OtherHand } from "@/lib/music/practice-hands";
import {
  acceptWaitInput,
  newWaitState,
  waitResult,
  waitTargets,
  type WaitInput,
} from "@/lib/music/wait-mode";
import { connectWaitInput, waitInputError, type WaitConnection } from "@/lib/music/wait-input";

type Props = {
  score: Score;
  onHint: (slots: FollowSlot[]) => void;
  hand: PracticeHand;
  other: OtherHand;
  range: LoopRange | null;
  onHand: (hand: PracticeHand) => void;
  onOther: (other: OtherHand) => void;
  onStart: () => void;
  onActive: (active: boolean) => void;
  onFrame: (slots: FollowSlot[], quarter: number | null) => void;
  onFeedback: (midi: number | null, wrong: boolean) => void;
  onControl: (stop: (() => void) | null) => void;
  onLoopBar: (bar: number) => void;
  disabled: boolean;
};
export default function WaitPractice(props: Props) {
  const latest = useRef(props);
  latest.current = props;
  const [source, setSource] = useState<"midi" | "mic">("mic");
  const [active, setActive] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [message, setMessage] = useState("选择输入后开启，谱面停在当前音，弹对才前进。");
  const [result, setResult] = useState<ReturnType<typeof waitResult> | null>(null);
  const run = useRef<ReturnType<typeof newWaitState> | null>(null);
  const targets = useRef<ReturnType<typeof waitTargets>>([]);
  const connection = useRef<WaitConnection | null>(null);
  const generation = useRef(0);
  function hint() {
    const target = targets.current[run.current?.index ?? 0];
    if (target) latest.current.onHint(target.slots);
  }
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  function finish(showResult = true) {
    generation.current++;
    connection.current?.stop();
    connection.current = null;
    clearTimeout(feedbackTimer.current);
    if (showResult && run.current) setResult(waitResult(run.current, performance.now()));
    run.current = null;
    setActive(false);
    setConnecting(false);
    latest.current.onControl(null);
    latest.current.onFrame([], null);
    latest.current.onFeedback(null, false);
    latest.current.onActive(false);
  }
  // A changed score/hand/loop ends this attempt, so indexes never drift under a live run.
  useEffect(() => {
    if (run.current) finish();
  }, [props.score, props.hand, props.range?.from, props.range?.to]);
  useEffect(
    () => () => {
      generation.current++;
      connection.current?.stop();
      clearTimeout(feedbackTimer.current);
      latest.current.onControl(null);
      latest.current.onFrame([], null);
      latest.current.onFeedback(null, false);
    },
    [],
  );
  async function start() {
    latest.current.onStart();
    const list = waitTargets(props.score, props.hand, props.range);
    if (!list.length) {
      setMessage("所选手或循环段内没有可练的音，请调整后重试。");
      return;
    }
    const token = ++generation.current;
    targets.current = list;
    run.current = newWaitState(performance.now());
    setResult(null);
    setActive(true);
    setConnecting(true);
    props.onActive(true);
    props.onControl(() => finish());
    props.onFrame(list[0].slots, list[0].quarter);
    setMessage("正在连接输入设备…");
    const input = (event: WaitInput) => {
      if (generation.current !== token || !run.current) return;
      const before = run.current;
      const next = acceptWaitInput(before, targets.current, event, latest.current.range != null);
      run.current = next;
      if (next.feedback === "wrong") {
        latest.current.onFeedback(next.played, true);
        clearTimeout(feedbackTimer.current);
        feedbackTimer.current = setTimeout(() => latest.current.onFeedback(null, false), 350);
      } else if (next.feedback === "correct") {
        clearTimeout(feedbackTimer.current);
        latest.current.onFeedback(null, false);
        if (next.finished) {
          finish();
          setMessage("这一遍已完成。");
          return;
        }
        const target = targets.current[next.index];
        latest.current.onFrame(target.slots, target.quarter);
        if (next.index === 0) setResult(waitResult(next, event.at));
      }
    };
    try {
      const device = await connectWaitInput(source, input, (text) => {
        if (generation.current === token) setMessage(text);
      });
      if (generation.current !== token) {
        device.stop();
        return;
      }
      connection.current = device;
      setConnecting(false);
      // Permission time is excluded from the attempt duration.
      run.current = newWaitState(performance.now());
    } catch (error) {
      if (generation.current !== token) return;
      finish(false);
      setMessage(waitInputError(error));
    }
  }
  return (
    <div className="tool-group" data-wait-practice="">
      {props.score.voice2 != null ? (
        <>
          <p className="tool-group-title">
            分手练<span>右手为声部一，左手为声部二</span>
          </p>
          <div className="segmented" role="group" aria-label="练习哪只手">
            {(
              [
                ["both", "双手"],
                ["right", "只练右手"],
                ["left", "只练左手"],
              ] as const
            ).map(([hand, label]) => (
              <button
                type="button"
                key={hand}
                aria-pressed={props.hand === hand}
                onClick={() => props.onHand(hand)}
              >
                {label}
              </button>
            ))}
          </div>
          {props.hand !== "both" ? (
            <label className="mt-2 flex items-center gap-2 text-sm">
              另一手与伴奏
              <select
                aria-label="另一手与伴奏"
                className="practice-select"
                value={props.other}
                onChange={(e) => props.onOther(e.target.value as OtherHand)}
              >
                <option value="mute">静音</option>
                <option value="quiet">小声伴奏（30%）</option>
              </select>
            </label>
          ) : null}
        </>
      ) : null}
      <p className="tool-group-title mt-3">
        等你弹<span>弹对当前音才前进</span>
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <select
          className="practice-select"
          aria-label="等你弹输入"
          disabled={active}
          value={source}
          onChange={(e) => setSource(e.target.value as "midi" | "mic")}
        >
          <option value="mic">麦克风 · 单音旋律</option>
          {typeof navigator.requestMIDIAccess === "function" ? (
            <option value="midi">MIDI 键盘</option>
          ) : null}
        </select>
        <button
          type="button"
          className="tool-button"
          disabled={props.disabled && !active}
          aria-pressed={active}
          onClick={() => (active ? finish() : void start())}
        >
          {active ? "退出等你弹" : "开启等你弹"}
        </button>
      </div>
      {active && !connecting ? <button type="button" className="tool-button mt-2" onClick={hint}>听当前音</button> : null}
      <p className="mt-2 text-sm text-muted" role="status">
        {message}
      </p>
      {source === "mic" ? (
        <p className="text-xs text-muted">
          麦克风只适合单音旋律；和弦取所选手的最高音。容差 ±50 音分，稳定约 80 毫秒。不上传音频。
        </p>
      ) : null}
      {typeof navigator.requestMIDIAccess !== "function" ? (
        <p className="text-xs text-muted">
          此浏览器不支持 Web MIDI，可使用麦克风，或换用支持 MIDI 的浏览器。
        </p>
      ) : null}
      {active ? (
        <p className="text-xs text-muted">
          {connecting ? "等待设备授权，可随时退出。" : "正在等你弹；循环开启时反复练当前段。"}{" "}
          等你弹按音符前进；节拍器、预备拍与渐进加速用于普通播放。
        </p>
      ) : null}
      {result ? (
        <div className="mt-2" aria-label="本次成绩">
          <p>
            正确率 {result.accuracy}% · 错 {result.errors} 次 · 用时{" "}
            {Math.floor(result.seconds / 60)} 分 {result.seconds % 60} 秒
          </p>
          {result.bars.length ? (
            <p className="text-sm">
              错得最多：
              {result.bars.map(({ bar, errors }) => (
                <button
                  type="button"
                  className="tool-button"
                  key={bar}
                  onClick={() => {
                    if (run.current) finish();
                    props.onLoopBar(bar);
                  }}
                >
                  第 {bar} 小节 · 错 {errors} 次 · 设为循环段
                </button>
              ))}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
