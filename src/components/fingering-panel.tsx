import { scoreHasFingering } from "@/lib/music/fingering";
import type { Score, ScoreNote } from "@/lib/music/theory";
import type { VoiceId } from "@/lib/music/voices";

type Props = {
  score: Score;
  show: boolean;
  onShow: (show: boolean) => void;
  onGenerate: () => void;
  onClear: () => void;
  selected: readonly number[];
  activeVoice: VoiceId;
  onSetFinger: (index: number, pitchIndex: number, finger: number) => void;
  quiet: string;
  solid: string;
};

const FINGERS = [1, 2, 3, 4, 5] as const;

export function FingeringPanel({
  score,
  show,
  onShow,
  onGenerate,
  onClear,
  selected,
  activeVoice,
  onSetFinger,
  quiet,
  solid,
}: Props) {
  const notes: ScoreNote[] = activeVoice === 1 ? score.voice2 ?? [] : score.notes;
  const index = selected.length === 1 ? selected[0]! : null;
  const note = index != null ? notes[index] : undefined;
  return (
    <div className="fingering-panel mt-4" role="group" aria-label="钢琴指法">
      <h3 className="text-sm font-medium text-ink">钢琴指法</h3>
      <p className="mt-1 text-sm leading-relaxed text-muted">
        1 是拇指，5 是小指。只给钢琴用。关掉只是不画出来，不会改谱；点「生成指法」才会写入并可以撤销。
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className={quiet} aria-pressed={show} onClick={() => onShow(!show)}>
          {show ? "显示指法：开" : "显示指法：关"}
        </button>
        <button type="button" className={solid} onClick={onGenerate}>
          生成指法
        </button>
        <button type="button" className={quiet} onClick={onClear} disabled={!scoreHasFingering(score)}>
          清除指法
        </button>
      </div>
      {note && index != null && note.pitches.length ? (
        <div className="mt-3" role="group" aria-label="手改指法">
          <p className="text-sm text-muted">第 {index + 1} 个音</p>
          {note.pitches.map((midi, pitchIndex) => (
            <div key={`${midi}-${pitchIndex}`} className="mt-2 flex flex-wrap items-center gap-2">
              <span className="text-sm text-ink">音 {pitchIndex + 1}</span>
              <div className="segmented" role="group" aria-label={`第 ${pitchIndex + 1} 音指法`}>
                {FINGERS.map((finger) => (
                  <button
                    key={finger}
                    type="button"
                    aria-pressed={note.fingers?.[pitchIndex] === finger}
                    onClick={() => onSetFinger(index, pitchIndex, finger)}
                  >
                    {finger}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-3 text-sm text-muted">先在谱上点一个音，再指定用哪一根手指。</p>
      )}
    </div>
  );
}
