import { useState } from "react";
import { barStarts } from "@/lib/music/practice";
import type { Score } from "@/lib/music/theory";

/** Kept inside this lazy panel so rehearsals.ts is not a shared first-screen mapDeps chunk. */
const PRESETS = ["前奏", "主歌", "副歌", "间奏", "尾声", "A", "B", "C"] as const;

function edit(score: Score, at: number, label: string | null): Score {
  const starts = barStarts(score);
  let start = 0;
  for (const q of starts) if (q <= at + 1e-6) start = q;
  const text = label?.replace(/\s+/g, " ").trim().slice(0, 12) || null;
  const next = [...(score.rehearsals ?? [])].filter((m) => Math.abs(m.at - start) > 1e-6);
  if (text) next.push({ at: start, label: text });
  next.sort((a, b) => a.at - b.at);
  const out: Score = { ...score };
  if (next.length) out.rehearsals = next;
  else delete out.rehearsals;
  return out;
}

function summary(score: Score): string {
  const marks = score.rehearsals ?? [];
  if (!marks.length) return "";
  const starts = barStarts(score);
  return marks
    .map((m) => {
      let bar = 1;
      starts.forEach((q, i) => {
        if (q <= m.at + 1e-6) bar = i + 1;
      });
      return `第 ${bar} 小节「${m.label}」`;
    })
    .join("、");
}

/** Section labels for the bar of the selected note. Lazy-loaded from the 写谱 panel. */
export default function RehearsalBar({
  score,
  at,
  canEdit,
  onChange,
  quiet,
}: {
  score: Score;
  at: number | null;
  canEdit: boolean;
  onChange: (next: Score, notice: string) => void;
  quiet: string;
}) {
  const [custom, setCustom] = useState("");
  const text = summary(score);
  const apply = (label: string | null) => {
    if (!canEdit || at == null) return;
    const next = edit(score, at, label);
    const after = summary(next);
    onChange(next, after ? `已设：${after}。可以撤销。` : "已清除这一小节的段落标记。可以撤销。");
  };
  return (
    <div className="tool-group mt-3" data-rehearsal-bar="">
      <p className="tool-group-title">
        段落标记<span>按选中音所在的小节，印在简谱该小节开头</span>
      </p>
      <div className="flex flex-wrap gap-2" role="group" aria-label="段落标记">
        {PRESETS.map((label) => (
          <button key={label} type="button" className={quiet} style={{ minWidth: 44, minHeight: 44 }} disabled={!canEdit} onClick={() => apply(label)}>
            {label}
          </button>
        ))}
        <button type="button" className={quiet} style={{ minWidth: 44, minHeight: 44 }} disabled={!canEdit} onClick={() => apply(null)}>
          清除标记
        </button>
      </div>
      <form
        className="mt-2 flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (!custom.trim()) return;
          apply(custom);
          setCustom("");
        }}
      >
        <label className="text-sm text-muted" htmlFor="rehearsal-custom">
          自定义
        </label>
        <input
          id="rehearsal-custom"
          style={{ minWidth: 44, minHeight: 44 }}
          className="rounded-xl border border-line bg-bg px-2 text-sm text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          value={custom}
          maxLength={12}
          disabled={!canEdit}
          onChange={(event) => setCustom(event.target.value)}
          placeholder="最多 12 字"
        />
        <button type="submit" className={quiet} style={{ minWidth: 44, minHeight: 44 }} disabled={!canEdit || !custom.trim()}>
          加上
        </button>
      </form>
      <p className="mt-2 text-xs text-muted" data-rehearsal-summary="">
        {text || "没有段落标记。选中谱上的音后可设前奏、主歌、副歌等，再点同一小节会替换。"}
      </p>
    </div>
  );
}
