import { useState } from "react";
import type { Score } from "@/lib/music/theory";
import {
  diatonicChords,
  PROGRESSIONS,
  expandProgression,
  mergeProgression,
} from "@/lib/music/chord-degrees";
import { stateAt } from "@/lib/music/score-timeline";
import { describeChordPlace, type ChordSymbol } from "@/lib/music/chord-symbol";
export default function ChordLibrary({
  score,
  at,
  onCommit,
  buttonClass,
}: {
  score: Score;
  at: number;
  buttonClass: string;
  onCommit: (marks: ChordSymbol[], notice: string) => void;
}) {
  const [preview, setPreview] = useState<ChordSymbol[]>([]),
    [overwrite, setOverwrite] = useState(false);
  const state = stateAt(score, at);
  const conflicts = preview.filter((p) =>
    score.chordSymbols?.some((s) => Math.abs(p.at - s.at) < 1e-8),
  );
  return (
    <div className="mt-3 space-y-2" aria-label="调内和弦与进行">
      <p className="text-sm">
        调内和弦 · {state.key} {state.mode === "minor" ? "小调" : "大调"}（插到选中位置）
      </p>
      <div className="flex flex-wrap gap-2">
        {diatonicChords(state.key, state.mode).map((s) => (
          <button
            key={s}
            type="button"
            className={buttonClass}
            style={{
              minWidth: 44,
              maxWidth: "100%",
              height: "auto",
              minHeight: 44,
              overflowWrap: "anywhere",
            }}
            onClick={() => {
              if (score.chordSymbols?.some((m) => Math.abs(m.at - at) < 1e-8)) {
                setPreview([{ at, symbol: s }]);
                setOverwrite(false);
              } else
                onCommit(
                  [...(score.chordSymbols ?? []), { at, symbol: s }],
                  `已插入 ${s}，可撤销。`,
                );
            }}
          >
            {s}
          </button>
        ))}
      </div>
      <p className="text-sm">常用进行 · 从选中小节起，每小节一个和弦，小调按自然小调展开</p>
      <div className="flex flex-wrap gap-2">
        {PROGRESSIONS.map((p) => (
          <button
            key={p.name}
            type="button"
            className={buttonClass}
            style={{
              minWidth: 44,
              maxWidth: "100%",
              height: "auto",
              minHeight: 44,
              overflowWrap: "anywhere",
            }}
            onClick={() => {
              setPreview(expandProgression(score, p.degrees, at));
              setOverwrite(false);
            }}
          >
            预览 {p.name}
          </button>
        ))}
      </div>
      {preview.length ? (
        <div className="rounded-xl border border-line p-2" aria-label="和弦进行预览">
          <p>{preview.map((p) => `${describeChordPlace(score, p.at)}：${p.symbol}`).join("；")}</p>
          <p className="text-sm">
            仅填入现有小节，不延长谱子。
            {conflicts.length ? `${conflicts.length} 处已有标记，默认保留。` : ""}
          </p>
          {conflicts.length ? (
            <label>
              <input
                type="checkbox"
                checked={overwrite}
                onChange={(e) => setOverwrite(e.target.checked)}
              />{" "}
              确认覆盖这些已有标记
            </label>
          ) : null}
          <div className="flex gap-2">
            <button
              type="button"
              className={buttonClass}
              style={{
                minWidth: 44,
                maxWidth: "100%",
                height: "auto",
                minHeight: 44,
                overflowWrap: "anywhere",
              }}
              onClick={() => {
                onCommit(
                  mergeProgression(score.chordSymbols ?? [], preview, overwrite),
                  "已应用和弦进行，可撤销。",
                );
                setPreview([]);
              }}
            >
              应用进行
            </button>
            <button
              type="button"
              className={buttonClass}
              style={{
                minWidth: 44,
                maxWidth: "100%",
                height: "auto",
                minHeight: 44,
                overflowWrap: "anywhere",
              }}
              onClick={() => setPreview([])}
            >
              取消预览
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
