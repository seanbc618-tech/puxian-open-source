import { useEffect, useState } from "react";
import { cleanTraining, trainingProgress, type SpeedTraining } from "@/lib/music/speed-training";
import {
  addPracticeClip,
  PRACTICE_CLIP_LIMIT,
  type PracticeClip,
} from "@/lib/music/practice-store";
import type { LoopRange } from "@/lib/music/practice";
function TrainingNumber({
  value,
  title,
  min,
  max,
  disabled,
  onValue,
}: {
  value: number;
  title: string;
  min: number;
  max: number;
  disabled: boolean;
  onValue: (value: number) => void;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  return (
    <label className="text-sm">
      {title}
      <input
        type="number"
        className="w-full rounded border p-2"
        aria-label={title}
        min={min}
        max={max}
        value={text}
        disabled={disabled}
        onChange={(event) => setText(event.target.value)}
        onBlur={() => {
          const next = text.trim()
            ? Math.max(min, Math.min(max, Math.round(Number(text)) || min))
            : value;
          setText(String(next));
          onValue(next);
        }}
      />
    </label>
  );
}
/** Whether 渐进加速 was left open; kept while the page lives. */
let trainingOpen = false;

export default function PracticeExtras({
  settings,
  onSettings,
  completed,
  active,
  onToggle,
  clips,
  onClips,
  range,
  label,
  speed,
  onRecall,
}: {
  settings: SpeedTraining;
  onSettings: (s: SpeedTraining) => void;
  completed: number;
  active: boolean;
  onToggle: () => void;
  clips: PracticeClip[];
  onClips: (c: PracticeClip[]) => void;
  range: LoopRange | null;
  label: string;
  speed: number;
  onRecall: (clip: PracticeClip) => void;
}) {
  const [name, setName] = useState("");
  const [open, setOpen] = useState(active || trainingOpen);
  // A running ramp keeps its settings and status in view.
  useEffect(() => {
    if (active) setOpen(true);
  }, [active]);
  const progress = trainingProgress(settings, completed);
  return (
    <>
      <details className="tool-group practice-fold" data-speed-training open={open}
        onToggle={(event) => { trainingOpen = event.currentTarget.open; setOpen(trainingOpen); }}>
        <summary className="tool-group-title">
          渐进加速<span>逐档练到目标速度</span>
        </summary>
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              ["start", "起始速度（%）", 50, 120],
              ["target", "目标速度（%）", 50, 120],
              ["step", "每次加多少（%）", 1, 70],
              ["repeats", "每档练几遍", 1, 100],
            ] as const
          ).map(([key, title, min, max]) => (
            <TrainingNumber
              key={key}
              title={title}
              min={min}
              max={max}
              value={settings[key]}
              disabled={active}
              onValue={(value) => onSettings(cleanTraining({ ...settings, [key]: value }))}
            />
          ))}
        </div>
        <label className="my-2 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={settings.countEach}
            disabled={active}
            onChange={(e) => onSettings({ ...settings, countEach: e.target.checked })}
          />
          每遍前预备拍（沿用预备拍小节数）
        </label>
        <button type="button" className="tool-button" aria-pressed={active} onClick={onToggle}>
          {active ? "取消渐进加速" : "开启渐进加速"}
        </button>
        <p className="mt-2 text-sm" role="status">
          {active
            ? `第 ${progress.pass} 遍 · ${Math.round(progress.speed * 100)}% · 下一档 ${progress.next == null ? "完成" : `${progress.next}%`}`
            : `共 ${progress.total} 遍，开启后点播放。`}
        </p>
      </details>
      <div className="tool-group">
        <p className="tool-group-title">
          收藏练习段<span>本曲最多 {PRACTICE_CLIP_LIMIT} 段</span>
        </p>
        <div className="flex flex-wrap gap-2">
          <input
            className="min-w-0 flex-1 rounded border p-2"
            aria-label="练习段名称"
            placeholder={label || "片段名称"}
            value={name}
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
          />
          <button
            type="button"
            className="tool-button"
            disabled={!range || clips.length >= PRACTICE_CLIP_LIMIT}
            onClick={() => {
              if (range) {
                onClips(
                  addPracticeClip(clips, {
                    id: crypto.randomUUID(),
                    name: name.trim() || label,
                    range,
                    speed,
                  }),
                );
                setName("");
              }
            }}
          >
            存为片段
          </button>
        </div>
        {clips.map((clip) => (
          <div key={clip.id} className="mt-2 flex min-w-0 gap-2">
            <button
              type="button"
              className="tool-button min-w-0 flex-1 truncate"
              onClick={() => onRecall(clip)}
            >
              {clip.name} · {Math.round(clip.speed * 100)}%
            </button>
            <button
              type="button"
              className="tool-button"
              aria-label={`删除片段 ${clip.name}`}
              onClick={() => onClips(clips.filter((c) => c.id !== clip.id))}
            >
              删除
            </button>
          </div>
        ))}
      </div>
    </>
  );
}
