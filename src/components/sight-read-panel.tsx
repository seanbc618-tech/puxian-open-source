import { useMemo, useState } from "react";
import {
  SIGHT_DENSITIES,
  generateSightRead,
  isSightDensity,
  sightPreviewScore,
  type SightDensity,
} from "@/lib/music/sight-read";
import type { Score, ScoreNote } from "@/lib/music/theory";
import { quiet, solid } from "./ui/styles";

const DENSITY_KEY = "puxian-sight-density-v1";

function rememberedDensity(): SightDensity {
  try {
    const value = localStorage.getItem(DENSITY_KEY);
    return isSightDensity(value) ? value : "beats";
  } catch {
    return "beats";
  }
}

type Props = {
  score: Score;
  onPlay: (score: Score) => void;
  onWrite: (notes: ScoreNote[]) => void;
};

export default function SightReadPanel({ score, onPlay, onWrite }: Props) {
  const [density, setDensityState] = useState(rememberedDensity);
  const [seed, setSeed] = useState(1);
  const drill = useMemo(
    () => generateSightRead(score, density, seed),
    [score.key, score.mode, score.beats, score.beatUnit, score.tonicOctave, density, seed],
  );

  function setDensity(next: SightDensity) {
    setDensityState(next);
    try { localStorage.setItem(DENSITY_KEY, next); } catch { /* private mode */ }
  }

  return (
    <div className="mt-4 rounded-2xl border border-line bg-bg p-3" data-sight-read data-sight-seed={seed} data-sight-density={density}>
      <h3 className="text-sm font-medium">视奏练习</h3>
      <p className="mt-1 text-sm text-muted">
        按本曲的调和拍号生成两小节，先看先听，不改当前谱。写入会替换正在写的声部，可撤销。
      </p>
      <div className="segmented mt-3" role="radiogroup" aria-label="视奏节奏">
        {SIGHT_DENSITIES.map((item) => (
          <button
            key={item.id}
            type="button"
            role="radio"
            aria-checked={density === item.id}
            onClick={() => setDensity(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <p className="mt-3 text-sm tabular-nums" data-sight-line aria-label="视奏谱">{drill.line}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" className={quiet} onClick={() => setSeed((n) => n + 1)}>换一题</button>
        <button type="button" className={quiet} onClick={() => onPlay(sightPreviewScore(score, drill.notes))}>
          试听
        </button>
        <button type="button" className={solid} onClick={() => onWrite(drill.notes)}>写入当前声部</button>
      </div>
    </div>
  );
}
