import { useEffect, useState } from "react";
import type { Score } from "@/lib/music/theory";
import {
  CHANGE_BPM_MAX,
  CHANGE_BPM_MIN,
  clearTempoChange,
  hasTempoMark,
  setTempoChange,
  tempoAt,
  tempoMarkSummary,
} from "@/lib/music/tempo-mark";
import {
  CHANGE_BPM_MAX as GRADUAL_BPM_MAX,
  CHANGE_BPM_MIN as GRADUAL_BPM_MIN,
  DEFAULT_SPAN_QUARTERS,
  clearGradualTempo,
  defaultGradualEnd,
  gradualTempoAt,
  gradualTempoSummary,
  hasGradualStart,
  setGradualTempo,
  type GradualKind,
} from "@/lib/music/gradual-tempo";

/** Mid-score metronome marks and gradual rit./accel. Lazy-loaded from 写谱. */
export default function TempoMarkBar({
  score,
  at,
  endAt = null,
  canEdit,
  quiet,
  onChange,
}: {
  score: Score;
  at: number | null;
  endAt?: number | null;
  canEdit: boolean;
  quiet: string;
  onChange: (next: Score, notice: string) => void;
}) {
  const current = at == null ? score.bpm : tempoAt(score, at);
  const marked = at != null && hasTempoMark(score, at);
  const [draft, setDraft] = useState(String(current));
  const [endMode, setEndMode] = useState<"next-mark" | "beats">("next-mark");
  const [spanBeats, setSpanBeats] = useState(String(DEFAULT_SPAN_QUARTERS));
  const [targetMode, setTargetMode] = useState<"default" | "ratio" | "bpm">("default");
  const [ratioDraft, setRatioDraft] = useState("0.75");
  const [targetDraft, setTargetDraft] = useState(String(current));
  useEffect(() => {
    setDraft(String(current));
    setTargetDraft(String(current));
  }, [current, at]);
  const text = tempoMarkSummary(score);
  const gradualText = gradualTempoSummary(score);
  const rangeSelected = at != null && endAt != null && endAt > at + 1e-6;
  const covering = at != null ? gradualTempoAt(score, at) : undefined;
  const atStart = at != null && hasGradualStart(score, at);
  const apply = () => {
    if (!canEdit || at == null) return;
    const parsed = Number(draft);
    const next = setTempoChange(score, at, Number.isFinite(parsed) ? parsed : current);
    const opening = at <= 1e-6;
    const bpm = opening ? next.bpm : (next.changes?.find((change) => Math.abs(change.at - at) <= 1e-6)?.bpm ?? current);
    onChange(
      next,
      opening ? `已把全曲开头速度设为 ♩=${bpm}。可以撤销。` : `已从这里起设为 ♩=${bpm}。可以撤销。`,
    );
  };
  const clear = () => {
    if (!canEdit || at == null || at <= 1e-6) return;
    onChange(clearTempoChange(score, at), "已去掉此处的途中速度。可以撤销。");
  };
  const applyGradual = (kind: GradualKind) => {
    if (!canEdit || at == null) return;
    const beats = Number(spanBeats);
    const to = rangeSelected
      ? endAt!
      : defaultGradualEnd(score, at, endMode, Number.isFinite(beats) && beats > 0 ? beats : DEFAULT_SPAN_QUARTERS);
    const options: { from: number; to: number; kind: GradualKind; toBpm?: number; ratio?: number } = {
      from: at,
      to,
      kind,
    };
    if (targetMode === "bpm") {
      const parsed = Number(targetDraft);
      options.toBpm = Number.isFinite(parsed) ? parsed : current;
    } else if (targetMode === "ratio") {
      const parsed = Number(ratioDraft);
      options.ratio = Number.isFinite(parsed) && parsed > 0 ? parsed : kind === "rit" ? 0.75 : 4 / 3;
    }
    const next = setGradualTempo(score, options);
    const word = kind === "rit" ? "渐慢 rit." : "渐快 accel.";
    onChange(next, `已标${word}。播放时在这段里平滑变速，谱面时值不变。可以撤销。`);
  };
  const clearGradual = () => {
    if (!canEdit || at == null || (!covering && !atStart)) return;
    onChange(clearGradualTempo(score, at), "已去掉此处的渐快/渐慢。可以撤销。");
  };
  return (
    <div className="tool-group mt-3" data-tempo-mark-bar="">
      <p className="tool-group-title">
        途中速度<span>点谱上的音或休止，从这里起改播放速度，谱面时值不变</span>
      </p>
      <form
        className="mt-2 flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          apply();
        }}
      >
        <label className="text-sm text-muted" htmlFor="tempo-mark-bpm">
          ♩=
        </label>
        <input
          id="tempo-mark-bpm"
          aria-label="途中速度"
          inputMode="numeric"
          type="number"
          min={CHANGE_BPM_MIN}
          max={CHANGE_BPM_MAX}
          step={1}
          value={draft}
          disabled={!canEdit}
          style={{ minWidth: 44, minHeight: 44 }}
          className="w-20 rounded-xl border border-line bg-bg px-2 text-sm tabular-nums text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          onChange={(event) => setDraft(event.target.value)}
        />
        <button type="submit" className={quiet} style={{ minWidth: 44, minHeight: 44 }} disabled={!canEdit}>
          设为从这里起
        </button>
        <button
          type="button"
          className={quiet}
          style={{ minWidth: 44, minHeight: 44 }}
          disabled={!canEdit || at == null || at <= 1e-6 || !marked}
          onClick={clear}
        >
          去掉此处速度
        </button>
      </form>
      <p className="mt-2 text-xs text-muted" data-tempo-mark-summary="">
        {text
          ? `已标：${text}。`
          : at != null && at <= 1e-6
            ? "这是开头。这里改的是全曲速度，和「移调与乐器」里的速度相同。"
            : "没有途中速度。选中谱上的音后可设从这里起的速度，全曲开头请改「移调与乐器」里的速度。"}
      </p>
      <p className="tool-group-title mt-3">
        渐快 / 渐慢<span>点选起止音，或从选中音起跨若干拍、到下一个途中速度</span>
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2" data-gradual-tempo-bar="">
        {rangeSelected ? (
          <p className="text-sm text-muted">已按选中的起止音。</p>
        ) : (
          <>
            <span className="text-sm text-muted">结束</span>
            <button
              type="button"
              className={quiet}
              style={{ minWidth: 44, minHeight: 44 }}
              aria-pressed={endMode === "next-mark"}
              disabled={!canEdit}
              onClick={() => setEndMode("next-mark")}
            >
              到下一个途中速度
            </button>
            <label className="text-sm text-muted" htmlFor="gradual-span-beats">
              跨
            </label>
            <input
              id="gradual-span-beats"
              aria-label="跨几拍"
              inputMode="decimal"
              type="number"
              min={0.25}
              max={64}
              step={0.25}
              value={spanBeats}
              disabled={!canEdit}
              style={{ minWidth: 44, minHeight: 44 }}
              className="w-20 rounded-xl border border-line bg-bg px-2 text-sm tabular-nums text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              onChange={(event) => {
                setSpanBeats(event.target.value);
                setEndMode("beats");
              }}
            />
            <span className="text-sm text-muted">拍</span>
          </>
        )}
        <span className="text-sm text-muted">目标</span>
        <button
          type="button"
          className={quiet}
          style={{ minWidth: 44, minHeight: 44 }}
          aria-pressed={targetMode === "default"}
          disabled={!canEdit}
          onClick={() => setTargetMode("default")}
        >
          默认比例
        </button>
        <label className="text-sm text-muted" htmlFor="gradual-ratio">
          比例
        </label>
        <input
          id="gradual-ratio"
          aria-label="目标速度比例"
          inputMode="decimal"
          type="number"
          min={0.25}
          max={4}
          step={0.05}
          value={ratioDraft}
          disabled={!canEdit}
          style={{ minWidth: 44, minHeight: 44 }}
          className="w-20 rounded-xl border border-line bg-bg px-2 text-sm tabular-nums text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          onChange={(event) => {
            setRatioDraft(event.target.value);
            setTargetMode("ratio");
          }}
        />
        <label className="text-sm text-muted" htmlFor="gradual-target-bpm">
          ♩=
        </label>
        <input
          id="gradual-target-bpm"
          aria-label="目标速度"
          inputMode="numeric"
          type="number"
          min={GRADUAL_BPM_MIN}
          max={GRADUAL_BPM_MAX}
          step={1}
          value={targetDraft}
          disabled={!canEdit}
          style={{ minWidth: 44, minHeight: 44 }}
          className="w-20 rounded-xl border border-line bg-bg px-2 text-sm tabular-nums text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          onChange={(event) => {
            setTargetDraft(event.target.value);
            setTargetMode("bpm");
          }}
        />
        <button
          type="button"
          className={quiet}
          style={{ minWidth: 44, minHeight: 44 }}
          disabled={!canEdit || at == null}
          onClick={() => applyGradual("rit")}
        >
          渐慢 rit.
        </button>
        <button
          type="button"
          className={quiet}
          style={{ minWidth: 44, minHeight: 44 }}
          disabled={!canEdit || at == null}
          onClick={() => applyGradual("accel")}
        >
          渐快 accel.
        </button>
        <button
          type="button"
          className={quiet}
          style={{ minWidth: 44, minHeight: 44 }}
          disabled={!canEdit || at == null || (!covering && !atStart)}
          onClick={clearGradual}
        >
          去掉此处渐变
        </button>
      </div>
      <p className="mt-2 text-xs text-muted" data-gradual-tempo-summary="">
        {gradualText
          ? `已标：${gradualText}。`
          : "没有渐快或渐慢。选中起止音，或从当前音起跨若干拍，可加上记号。"}
      </p>
    </div>
  );
}
