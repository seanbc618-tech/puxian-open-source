import "./visual-keyboard.css";
import { useMemo, useState } from "react";
import type { Score } from "@/lib/music/theory";
import type { FollowSlot } from "@/lib/music/playback-clock";
import { keyboardNotes, keyboardRange, type KeyboardHand } from "@/lib/music/visual-keyboard";
import { isBlackKey } from "@/lib/music/fingering";
export default function VisualKeyboard({
  score,
  sounding,
  showFingering,
  transposed,
  defaultHand = "both",
  played = null,
}: {
  score: Score;
  sounding: readonly FollowSlot[];
  showFingering: boolean;
  transposed: boolean;
  defaultHand?: KeyboardHand;
  played?: number | null;
}) {
  const [hand, setHand] = useState<KeyboardHand>(defaultHand);
  const active = keyboardNotes(score, sounding, hand, showFingering, transposed);
  const range = useMemo(() => keyboardRange(score), [score.notes, score.voice2]);
  const low = played == null ? range.low : Math.min(range.low, played);
  const high = played == null ? range.high : Math.max(range.high, played);
  const keys = Array.from({ length: high - low + 1 }, (_, i) => low + i);
  const whites = keys.filter((m) => !isBlackKey(m));
  const width = Math.max(320, whites.length * 20);
  const unit = width / whites.length;
  return (
    <div className="visual-keyboard">
      <div className="segmented" role="group" aria-label="琴键声部">
        {(
          [
            ["both", "双手"],
            ["right", "只看右手"],
            ["left", "只看左手"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-pressed={hand === value}
            onClick={() => setHand(value)}
          >
            {label}
          </button>
        ))}
      </div>
      <p className="text-xs text-muted">
        右手 · 杏色　左手 · 淡紫色{transposed && showFingering ? " · 移调后隐藏指法" : ""}
      </p>
      <div style={{ overflowX: "auto", maxWidth: "100%" }}>
        <svg
          width={width}
          height={60}
          role="img"
          aria-label="正在发声的琴键"
          data-visual-keyboard=""
        >
          {[false, true].flatMap((black) =>
            keys
              .filter((m) => isBlackKey(m) === black)
              .map((midi) => {
                const lit = active.filter((n) => n.midi === midi);
                const left = whites.filter((m) => m < midi).length;
                const x = black ? left * unit - unit * 0.31 : left * unit;
                const fill = midi === played ? "#e8988b" :
                  lit.length > 1 && new Set(lit.map((n) => n.voice)).size > 1
                    ? "#d9bebd"
                    : lit[0]?.voice === 0
                      ? "#efc79f"
                      : lit[0]?.voice === 1
                        ? "#c9c0e4"
                        : black
                          ? "#343c3b"
                          : "#fffdf7";
                return (
                  <g key={midi} data-midi={midi} data-active={lit.length > 0} data-played={midi === played}>
                    <rect
                      x={x}
                      y={1}
                      width={unit * (black ? 0.62 : 1) - 1}
                      height={black ? 36 : 56}
                      rx={2}
                      fill={fill}
                      stroke="#bcb6aa"
                    />
                    {lit.length ? (
                      <text
                        x={x + unit * (black ? 0.31 : 0.5)}
                        y={black ? 26 : 48}
                        textAnchor="middle"
                        fontSize={12}
                        fill="#263b38"
                      >
                        {[...new Set(lit.map((n) => n.finger).filter(Boolean))].join("/")}
                      </text>
                    ) : null}
                  </g>
                );
              }),
          )}
        </svg>
      </div>
    </div>
  );
}
