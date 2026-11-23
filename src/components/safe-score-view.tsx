import { Component, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Score } from "@/lib/music/theory";
import { replaceVoiceAndRemap, voiceLabel, voiceList, type VoiceId } from "@/lib/music/voices";
import type { JianpuView } from "./jianpu-view";
import { quiet } from "./ui/styles";

const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FIRST_ROWS = 32;
const ROW_STEP = 40;
const HEAVY_NOTES = 48;
const HEAVY_VOICES = 6;
const DENSE_MEASURE = 24;
const NOTATION_CHUNK = 12;

export function midiToName(midi: number): string {
  const n = Math.round(midi);
  return `${NAMES[((n % 12) + 12) % 12]}${Math.floor(n / 12) - 1}`;
}

export type ScoreEventRow = {
  voice: number;
  index: number;
  start: number;
  dur: number;
  pitches: number[];
};

export function flattenScoreEvents(score: Score): ScoreEventRow[] {
  const rows: ScoreEventRow[] = [];
  voiceList(score).forEach((notes, voice) => {
    let t = 0;
    notes.forEach((note, index) => {
      rows.push({ voice, index, start: t, dur: note.dur, pitches: note.pitches });
      t += note.dur;
    });
  });
  rows.sort((a, b) => a.start - b.start || a.voice - b.voice || a.index - b.index);
  return rows;
}

export function scoreNoteCount(score: Score): number {
  return voiceList(score).reduce((n, notes) => n + notes.length, 0);
}

export function scoreIsHeavy(score: Score): boolean {
  const voices = voiceList(score);
  const n = voices.reduce((sum, notes) => sum + notes.length, 0);
  if (n >= HEAVY_NOTES) return true;
  if (voices.length > HEAVY_VOICES) return true;
  const ends = score.measureEnds;
  if (ends && ends.length > 0 && n / ends.length >= DENSE_MEASURE) return true;
  return false;
}

export function takeScorePrefix(score: Score, maxEvents: number): Score {
  if (maxEvents <= 0) return { ...score, notes: [] };
  if (scoreNoteCount(score) <= maxEvents) return score;
  const chosen = new Set(
    flattenScoreEvents(score).slice(0, maxEvents).map((row) => `${row.voice}:${row.index}`),
  );
  let next = score;
  voiceList(score).forEach((notes, voice) => {
    next = replaceVoiceAndRemap(
      next,
      voice as VoiceId,
      notes.filter((_, index) => chosen.has(`${voice}:${index}`)),
    );
  });
  return next;
}

function formatPitches(pitches: number[]): string {
  if (!pitches.length) return "休止";
  return pitches.map(midiToName).join(" ");
}

/** Show a beat length without a floating-point residue such as 0.9999999999999991. */
export function formatBeats(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  let best = value;
  let bestErr = 1e-8;
  for (const den of [1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64]) {
    const snapped = Math.round(value * den) / den;
    const err = Math.abs(value - snapped);
    if (err < bestErr) {
      best = snapped;
      bestErr = err;
    }
  }
  if (Math.abs(best - Math.round(best)) < 1e-8) return String(Math.round(best));
  return best.toFixed(4).replace(/\.?0+$/, "");
}

/** List + optional deferred/chunked notation so a large or malformed score cannot freeze the page. */
export function SafeScoreView({
  score,
  ScoreView,
  selected,
  activeVoice,
  onPick,
  width,
}: {
  score: Score;
  ScoreView?: typeof JianpuView;
  selected: number[];
  activeVoice: VoiceId;
  onPick: (index: number, extend: boolean, voice: VoiceId) => void;
  width?: number;
}) {
  const rows = useMemo(() => flattenScoreEvents(score), [score]);
  const heavy = useMemo(() => scoreIsHeavy(score), [score]);
  const [visible, setVisible] = useState(Math.min(FIRST_ROWS, rows.length));
  const [wantNotation, setWantNotation] = useState(!heavy);
  const [stopped, setStopped] = useState(false);
  const sentinel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setVisible(Math.min(FIRST_ROWS, flattenScoreEvents(score).length));
    setWantNotation(!scoreIsHeavy(score));
    setStopped(false);
  }, [score]);

  useEffect(() => {
    const el = sentinel.current;
    if (!el || visible >= rows.length) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setVisible((n) => Math.min(rows.length, n + ROW_STEP));
      }
    }, { rootMargin: "80px" });
    io.observe(el);
    return () => io.disconnect();
  }, [visible, rows.length]);

  const voices = voiceList(score).length;
  const pitched = rows.filter((row) => row.pitches.length).length;
  const rests = rows.length - pitched;

  return (
    <div className="safe-score-view">
      <p className="safe-score-summary" role="status">
        {pitched} 个音{rests ? `，${rests} 个休止` : ""} · {voices} 个声部
        {score.measureEnds?.length ? ` · ${score.measureEnds.length} 个小节` : ""}
        {heavy ? " · 谱面较密，先列出音符，页面可关闭、可滚动。" : ""}
      </p>
      {wantNotation && ScoreView && !stopped ? (
        <ChunkedNotation
          ScoreView={ScoreView}
          score={score}
          selected={selected}
          activeVoice={activeVoice}
          onPick={onPick}
          width={width}
          chunk={heavy ? NOTATION_CHUNK : scoreNoteCount(score)}
          onStop={() => setStopped(true)}
        />
      ) : null}
      {ScoreView ? (
        <div className="safe-score-toolbar">
          {!wantNotation || stopped ? (
            <button
              type="button"
              className={quiet}
              onClick={() => {
                setStopped(false);
                setWantNotation(true);
              }}
            >
              渲染乐谱预览（分段进行，可随时停止）
            </button>
          ) : (
            <button type="button" className={quiet} onClick={() => setStopped(true)}>
              停止谱面渲染
            </button>
          )}
        </div>
      ) : null}
      <ol className="safe-score-list" aria-label="识别事件列表">
        {rows.slice(0, visible).map((row) => {
          const active = activeVoice === row.voice && selected.includes(row.index);
          return (
            <li key={`${row.voice}-${row.index}-${row.start}`}>
              <button
                type="button"
                className={active ? "safe-score-row is-selected" : "safe-score-row"}
                aria-pressed={active}
                onClick={() => onPick(row.index, false, row.voice as VoiceId)}
              >
                <span className="safe-score-t">{row.start.toFixed(2)}</span>
                <span className="safe-score-v">{voiceLabel(row.voice)}</span>
                <span className="safe-score-p">{formatPitches(row.pitches)}</span>
                <span className="safe-score-d">{formatBeats(row.dur)} 拍</span>
              </button>
            </li>
          );
        })}
      </ol>
      {visible < rows.length ? (
        <div ref={sentinel} className="safe-score-more">
          <button
            type="button"
            className={quiet}
            onClick={() => setVisible((n) => Math.min(rows.length, n + ROW_STEP))}
          >
            显示后续事件（还有 {rows.length - visible} 个）
          </button>
        </div>
      ) : null}
    </div>
  );
}

function ChunkedNotation({
  ScoreView,
  score,
  selected,
  activeVoice,
  onPick,
  width,
  chunk,
  onStop,
}: {
  ScoreView: typeof JianpuView;
  score: Score;
  selected: number[];
  activeVoice: VoiceId;
  onPick: (index: number, extend: boolean, voice: VoiceId) => void;
  width?: number;
  chunk: number;
  onStop: () => void;
}) {
  const total = scoreNoteCount(score);
  const [shown, setShown] = useState(() => Math.min(chunk, total));
  const [error, setError] = useState("");
  const [waiting, setWaiting] = useState(true);
  const stopRef = useRef(false);

  useEffect(() => {
    stopRef.current = false;
    setShown(Math.min(chunk, scoreNoteCount(score)));
    setError("");
    setWaiting(true);
    const first = requestAnimationFrame(() => setWaiting(false));
    return () => {
      stopRef.current = true;
      cancelAnimationFrame(first);
    };
  }, [score, chunk]);

  useEffect(() => {
    if (waiting || stopRef.current || shown >= total || error) return;
    const win = window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    let idleId = 0;
    let timeoutId = 0;
    const step = () => {
      if (stopRef.current) return;
      setShown((n) => Math.min(total, n + chunk));
    };
    if (typeof win.requestIdleCallback === "function") {
      idleId = win.requestIdleCallback(step, { timeout: 200 });
      return () => win.cancelIdleCallback?.(idleId);
    }
    timeoutId = window.setTimeout(step, 50);
    return () => clearTimeout(timeoutId);
  }, [shown, total, chunk, waiting, error]);

  if (waiting) {
    return <p className="text-sm text-muted" role="status">正在准备谱面预览…</p>;
  }

  const prefix = takeScorePrefix(score, shown);

  return (
    <div className="safe-score-notation">
      <p className="text-sm text-muted" role="status">
        谱面预览 {Math.min(shown, total)} / {total}
        {shown < total ? "（分段渲染中，可停止）" : ""}
      </p>
      <CatchInner onError={(message) => { setError(message); onStop(); }}>
        <ScoreView
          score={prefix}
          shift={0}
          sounding={[]}
          selected={selected}
          activeVoice={activeVoice}
          onPick={onPick}
          width={width}
        />
      </CatchInner>
      {error ? <p role="alert">这段谱面预览失败：{error}。事件列表仍可查看和关闭。</p> : null}
    </div>
  );
}

class CatchInner extends Component<{ children: ReactNode; onError: (message: string) => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    this.props.onError(error instanceof Error ? error.message : "渲染出错");
  }
  render() {
    if (this.state.failed) return null;
    return this.props.children;
  }
}

/** Card preview for the OMR panel: list first, never a blocking abcjs render. */
export function SafeOmrPreview({ score, onReady }: { score: Score; onReady?: () => void }) {
  useEffect(() => {
    const id = requestAnimationFrame(() => onReady?.());
    return () => cancelAnimationFrame(id);
  }, [score, onReady]);
  return (
    <SafeScoreView
      score={score}
      selected={[]}
      activeVoice={0}
      onPick={() => {}}
    />
  );
}
