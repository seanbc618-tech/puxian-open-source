import { useEffect, useState } from "react";
import type { KeyName, Mode, Score } from "@/lib/music/theory";
import {
  KEY_NAMES,
  barNumberAt,
  barStartAt,
  clearKeyChange,
  hasKeyMark,
  keyAt,
  keyMarkLabel,
  keyMarkSummary,
  modeName,
  setKeyChange,
} from "@/lib/music/key-mark";

/** Mid-score key changes. Lazy-loaded from the 写谱 panel so key-mark.ts stays out of index.js. */
export default function KeyMarkBar({
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
  const current = snapped == null ? { key: score.key, mode: score.mode } : keyAt(score, snapped);
  const marked = snapped != null && hasKeyMark(score, snapped);
  const [draftKey, setDraftKey] = useState<KeyName>(current.key);
  const [draftMode, setDraftMode] = useState<Mode>(current.mode);
  useEffect(() => {
    setDraftKey(current.key);
    setDraftMode(current.mode);
  }, [current.key, current.mode, snapped]);
  const text = keyMarkSummary(score);
  const apply = () => {
    if (!canEdit || snapped == null) return;
    const next = setKeyChange(score, snapped, draftKey, draftMode);
    const atStart = snapped <= 1e-6;
    const applied = keyAt(next, snapped);
    const label = `${keyMarkLabel(applied.key)}（${modeName(applied.mode)}）`;
    const wrote = !atStart && hasKeyMark(next, snapped);
    onChange(
      next,
      atStart
        ? `已把全曲开头调设为 ${label}。可以撤销。`
        : wrote
          ? `已从第 ${barNumberAt(next, snapped)} 小节起设为 ${label}。可以撤销。`
          : `已去掉此处的途中转调，从这里起仍是 ${label}。可以撤销。`,
    );
  };
  const clear = () => {
    if (!canEdit || snapped == null || snapped <= 1e-6) return;
    onChange(clearKeyChange(score, snapped), "已去掉此处的途中转调。可以撤销。");
  };
  return (
    <div className="tool-group mt-3" data-key-mark-bar="">
      <p className="tool-group-title">
        途中转调<span>点谱上的音或休止，从该小节开头起换调（1=X），简谱按新调记</span>
      </p>
      <form
        className="mt-2 flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          apply();
        }}
      >
        <label className="text-sm text-muted" htmlFor="key-mark-value">
          1=
        </label>
        <select
          id="key-mark-value"
          aria-label="途中转调"
          value={draftKey}
          disabled={!canEdit}
          style={{ minWidth: 44, minHeight: 44 }}
          className="rounded-xl border border-line bg-bg px-2 text-sm text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          onChange={(event) => setDraftKey(event.target.value as KeyName)}
        >
          {KEY_NAMES.map((option) => (
            <option key={option} value={option}>
              {keyMarkLabel(option).slice(2)}
            </option>
          ))}
        </select>
        <select
          id="key-mark-mode"
          aria-label="途中转调调式"
          value={draftMode}
          disabled={!canEdit}
          style={{ minWidth: 44, minHeight: 44 }}
          className="rounded-xl border border-line bg-bg px-2 text-sm text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          onChange={(event) => setDraftMode(event.target.value === "minor" ? "minor" : "major")}
        >
          <option value="major">大调</option>
          <option value="minor">小调</option>
        </select>
        <button type="submit" className={quiet} style={{ minWidth: 44, minHeight: 44 }} disabled={!canEdit}>
          设为从这小节换调
        </button>
        <button
          type="button"
          className={quiet}
          style={{ minWidth: 44, minHeight: 44 }}
          disabled={!canEdit || snapped == null || snapped <= 1e-6 || !marked}
          onClick={clear}
        >
          去掉此处调号
        </button>
      </form>
      <p className="mt-2 text-xs text-muted" data-key-mark-summary="">
        {text
          ? `已标：${text}。`
          : snapped != null && snapped <= 1e-6
            ? "这是第一小节。这里改的是全曲的调，和「移调与乐器」里的调相同。"
            : "没有途中转调。选中第二小节及之后的音，可从那一小节开头起换调；全曲开头请改「移调与乐器」里的调。"}
      </p>
    </div>
  );
}
