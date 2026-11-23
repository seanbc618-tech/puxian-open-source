import { TIMBRES, type Timbre } from "@/lib/music/timbres";
import { mixerFolds, type MixerChannel } from "@/lib/music/mixer";
import { useState } from "react";
import { voiceLabel } from "@/lib/music/voices";
export default function MixerPanel({
  channels,
  onChange,
}: {
  channels: MixerChannel[];
  onChange: (channels: MixerChannel[]) => void;
}) {
  const update = (index: number, patch: Partial<MixerChannel>) =>
    onChange(channels.map((c, i) => (i === index ? { ...c, ...patch } : c)));
  // A one-voice score with nothing changed has little to mix: one line until asked (390 宽少占一屏).
  const [open, setOpen] = useState(() => !mixerFolds(channels));
  if (!open && mixerFolds(channels)) {
    return (
      <div className="tool-group" data-mixer="" data-mixer-folded="">
        <p className="tool-group-title">
          混音台<span>本曲 · 仅存本机</span>
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-xs text-muted">单声部：钢琴音色，音量 100%，居中。</p>
          <button type="button" className="tool-button" aria-expanded={false} onClick={() => setOpen(true)}>
            展开混音台
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="tool-group" data-mixer="">
      <p className="tool-group-title">
        混音台<span>本曲 · 仅存本机</span>
      </p>
      <p className="mb-2 text-xs text-muted">
        先应用分手练（静音或
        30%），再乘混音音量；有独奏时仅听独奏声部，静音优先。播放中调音量、静音或独奏会即时生效；被静音的声部重新打开，以及音色、声像，在下次播放（循环时为下一遍）生效。
      </p>
      {channels.map((c, i) => (
        <fieldset key={i} className="mb-3 min-w-0 rounded-2xl border border-line p-3">
          <legend className="text-sm text-muted">{voiceLabel(i)}</legend>
          <div className="flex flex-wrap items-center gap-2">
            <select
              className="practice-select max-w-full"
              aria-label={`${voiceLabel(i)}音色`}
              value={c.timbre}
              onChange={(e) => update(i, { timbre: e.target.value as Timbre, timbreChanged: true })}
            >
              {Object.entries(TIMBRES).map(([id, p]) => (
                <option key={id} value={id}>
                  {p.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="tool-button"
              aria-label={`${voiceLabel(i)}静音 M`}
              aria-pressed={c.mute}
              onClick={() => update(i, { mute: !c.mute })}
            >
              M 静音
            </button>
            <button
              type="button"
              className="tool-button"
              aria-label={`${voiceLabel(i)}独奏 S`}
              aria-pressed={c.solo}
              onClick={() => update(i, { solo: !c.solo })}
            >
              S 独奏
            </button>
          </div>
          <label className="mt-2 flex items-center gap-2 text-sm">
            音量 {c.volume}%
            <input
              className="h-11 min-w-0 flex-1 accent-accent"
              type="range"
              min="0"
              max="100"
              aria-label={`${voiceLabel(i)}音量`}
              value={c.volume}
              onChange={(e) => update(i, { volume: Number(e.target.value) })}
            />
          </label>
          <label className="mt-2 flex items-center gap-2 text-sm">
            声像 {c.pan}
            <input
              className="h-11 min-w-0 flex-1 accent-accent"
              type="range"
              min="-100"
              max="100"
              aria-label={`${voiceLabel(i)}左右声像`}
              value={c.pan}
              onChange={(e) => update(i, { pan: Number(e.target.value) })}
            />
          </label>
        </fieldset>
      ))}
      <p className="text-xs text-muted">
        声像 −100 为左，0 居中，100
        为右；浏览器不支持时保持居中。音色为本机合成；仅主动选择过的音色写入 MIDI。
      </p>
    </div>
  );
}
