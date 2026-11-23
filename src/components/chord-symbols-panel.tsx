import { lazy, Suspense, useState } from "react";
import { retryImport } from "@/lib/lazy-retry";
import { canonicalChordSymbols, describeChordPlace, detectScoreChordSymbols } from "@/lib/music/chord-symbol";
import type { Score } from "@/lib/music/theory";
import type { VoiceId } from "@/lib/music/voices";
import { voiceNotes } from "@/lib/music/voices";
import { quiet, field } from "./ui/styles";

const ChordLibrary = lazy(() => retryImport(() => import("./chord-library")));

type Props = {
  score: Score;
  selected: readonly number[];
  activeVoice: VoiceId;
  onChange: (score: Score, notice: string) => void;
  comp?: boolean;
  onComp?: (on: boolean) => void;
};

function onsetOf(score: Score, voice: VoiceId, index: number): number | null {
  const notes = voiceNotes(score, voice);
  if (index < 0 || index >= notes.length) return null;
  let at = 0;
  for (let i = 0; i < index; i += 1) at += notes[i].dur;
  return at;
}

export function ChordSymbolsPanel({ score, selected, activeVoice, onChange, comp = false, onComp }: Props) {
  const symbols = score.chordSymbols ?? [];
  const [drafts, setDrafts] = useState<Record<number, string>>({});

  function commit(nextSymbols: Score["chordSymbols"], notice: string) {
    const cleaned = canonicalChordSymbols(nextSymbols);
    const next: Score = { ...score };
    if (cleaned) next.chordSymbols = cleaned;
    else delete next.chordSymbols;
    setDrafts({});
    onChange(next, notice);
  }

  function flush(index: number, symbol: string) {
    const next = symbols.map((item, i) => (i === index ? { ...item, symbol } : item));
    if (!symbol.trim()) {
      commit(next.filter((_, i) => i !== index), "已去掉这处和弦标记。");
      return;
    }
    if (symbol.trim() === symbols[index]?.symbol) {
      setDrafts((d) => {
        const copy = { ...d };
        delete copy[index];
        return copy;
      });
      return;
    }
    commit(next, "已改和弦标记。");
  }

  return (
    <div className="chord-symbols-panel mt-4 rounded-2xl border border-line bg-bg p-3">
      <h3 className="text-sm font-medium">和弦标记</h3>
      <p className="mt-1 text-sm text-muted">
        写在旋律上方，和音符分开。移调时标记一起走。没有标记的旧稿打开后跟原来一样。
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          className={quiet}
          onClick={() => {
            const found = detectScoreChordSymbols(score);
            commit(found, found.length ? `已根据同时发响的音写下 ${found.length} 处和弦标记，可改可撤销。` : "谱上没有能识别的三和弦或常见七和弦。");
          }}
        >
          从谱上的和弦音生成
        </button>
        <button
          type="button"
          className={quiet}
          onClick={() => {
            const index = selected[0];
            const at = index != null ? onsetOf(score, activeVoice, index) : 0;
            if (at == null) return;
            commit([...symbols, { at, symbol: "C" }], "已加上和弦标记，可以改写成需要的记号。");
          }}
        >
          {selected.length ? "在选中的音上加上" : "在开头加上"}
        </button>
      </div>
      <Suspense fallback={null}><ChordLibrary buttonClass={quiet} score={score} at={selected[0] != null ? onsetOf(score, activeVoice, selected[0]) ?? 0 : 0} onCommit={commit} /></Suspense>
      {symbols.length ? (
        <ul className="mt-3 space-y-2" aria-label="和弦标记列表">
          {symbols.map((item, index) => (
            <li key={`${item.at}-${index}`} className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-muted tabular-nums">{describeChordPlace(score, item.at)}</span>
              <input
                className={field}
                aria-label={`${describeChordPlace(score, item.at)}的和弦标记`}
                value={drafts[index] ?? item.symbol}
                onChange={(event) => setDrafts((d) => ({ ...d, [index]: event.target.value }))}
                onBlur={(event) => flush(index, event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") (event.target as HTMLInputElement).blur();
                }}
              />
              <button type="button" className={quiet} onClick={() => flush(index, "")}>
                去掉
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-muted">还没有和弦标记。</p>
      )}
      {onComp ? (
        <div className="mt-3">
          <button
            type="button"
            className={quiet}
            aria-pressed={comp}
            data-comp-on={comp ? "1" : "0"}
            onClick={() => onComp(!comp)}
          >
            播放时加伴奏
          </button>
          <p className="mt-2 text-sm text-muted">
            根据和弦标记加简单的低音和柱式和弦，不改谱子。没有标记或标着 N.C. 时不响。
          </p>
        </div>
      ) : null}
    </div>
  );
}
