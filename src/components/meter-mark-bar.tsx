import { useEffect, useState } from "react";
import type { Score } from "@/lib/music/theory";
import {
  METER_CHOICES,
  barNumberAt,
  barStartAt,
  clearMeterChange,
  hasMeterMark,
  meterAt,
  meterLabel,
  meterMarkSummary,
  setMeterChange,
} from "@/lib/music/meter-mark";

/** Mid-score time signatures. Lazy-loaded from the 写谱 panel so meter-mark.ts stays out of index.js. */
export default function MeterMarkBar({
  score,
  at,
  canEdit,
  quiet,
  onChange,
}: {
  score: Score;
  at: number | null;
  canEdit: boolean;
  quiet: string;
  onChange: (next: Score, notice: string) => void;
}) {
  const snapped = at == null ? null : barStartAt(score, at);
  const current = snapped == null ? { beats: score.beats, beatUnit: score.beatUnit } : meterAt(score, snapped);
  const marked = snapped != null && hasMeterMark(score, snapped);
  const label = meterLabel(current.beats, current.beatUnit);
  const choices: string[] = METER_CHOICES.includes(label as (typeof METER_CHOICES)[number])
    ? [...METER_CHOICES]
    : [label, ...METER_CHOICES];
  const [draft, setDraft] = useState(label);
  useEffect(() => {
    setDraft(label);
  }, [label, snapped]);
  const text = meterMarkSummary(score);
  const apply = () => {
    if (!canEdit || snapped == null) return;
    const [beats, beatUnit] = draft.split("/").map(Number);
    const next = setMeterChange(
      score,
      snapped,
      Number.isFinite(beats) ? beats : current.beats,
      Number.isFinite(beatUnit) ? beatUnit : current.beatUnit,
    );
    const atStart = snapped <= 1e-6;
    const applied = meterAt(next, snapped);
    const meter = meterLabel(applied.beats, applied.beatUnit);
    const wrote = !atStart && hasMeterMark(next, snapped);
    onChange(
      next,
      atStart
        ? `已把全曲开头拍号设为 ${meter}。可以撤销。`
        : wrote
          ? `已从第 ${barNumberAt(next, snapped)} 小节起设为 ${meter}。可以撤销。`
          : `已去掉此处的途中拍号，从这里起仍是 ${meter}。可以撤销。`,
    );
  };
  const clear = () => {
    if (!canEdit || snapped == null || snapped <= 1e-6) return;
    onChange(clearMeterChange(score, snapped), "已去掉此处的途中拍号。可以撤销。");
  };
  return (
    <div className="tool-group mt-3" data-meter-mark-bar="">
      <p className="tool-group-title">
        途中拍号<span>点谱上的音或休止，从该小节开头起改拍号，谱面时值不变</span>
      </p>
      <form
        className="mt-2 flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          apply();
        }}
      >
        <label className="text-sm text-muted" htmlFor="meter-mark-value">
          拍号
        </label>
        <select
          id="meter-mark-value"
          aria-label="途中拍号"
          value={choices.includes(draft) ? draft : label}
          disabled={!canEdit}
          style={{ minWidth: 44, minHeight: 44 }}
          className="rounded-xl border border-line bg-bg px-2 text-sm tabular-nums text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          onChange={(event) => setDraft(event.target.value)}
        >
          {choices.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        <button type="submit" className={quiet} style={{ minWidth: 44, minHeight: 44 }} disabled={!canEdit}>
          设为从这小节起
        </button>
        <button
          type="button"
          className={quiet}
          style={{ minWidth: 44, minHeight: 44 }}
          disabled={!canEdit || snapped == null || snapped <= 1e-6 || !marked}
          onClick={clear}
        >
          去掉此处拍号
        </button>
      </form>
      <p className="mt-2 text-xs text-muted" data-meter-mark-summary="">
        {text
          ? `已标：${text}。`
          : snapped != null && snapped <= 1e-6
            ? "这是第一小节。这里改的是全曲拍号，和「移调与乐器」里的拍号相同。"
            : "没有途中拍号。选中第二小节及之后的音，可从那一小节开头起改拍号；全曲开头请改「移调与乐器」里的拍号。"}
      </p>
    </div>
  );
}
