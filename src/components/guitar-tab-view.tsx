import { voiceLabel, voiceList as allVoices } from "@/lib/music/voices";
import { useEffect, useMemo, useRef } from "react";
import {
  BASS_STANDARD,
  GUITAR_STANDARD,
  describeTabMisses,
  guitarTabOf,
  layoutGuitarTab,
  TAB_POSITIONS,
  type TabPositionId,
  type TabTuningId,
} from "@/lib/music/guitar-tab";
import type { FollowSlot } from "@/lib/music/playback-clock";
import type { LoopRange } from "@/lib/music/practice";
import type { Score } from "@/lib/music/theory";
import type { VoiceId } from "@/lib/music/voices";
import { bindScorePointer } from "@/lib/music/pointer-pick";

type GuitarTabViewProps = {
  score: Score;
  sounding: readonly FollowSlot[];
  playhead: number | null;
  selected?: readonly number[];
  activeVoice?: VoiceId;
  onPick?: (index: number, extend: boolean, voice: VoiceId) => void;
  width: number;
  loop: LoopRange | null;
  follow?: boolean;
  tuning: TabTuningId;
  onTuning: (tuning: TabTuningId) => void;
  position?: TabPositionId;
  onPosition?: (id: TabPositionId) => void;
};

const VOICE_FILL = ["#1f3d3a", "#7a5c3e"] as const;

export function GuitarTabView({
  score,
  sounding,
  playhead,
  selected = [],
  activeVoice = 0,
  onPick,
  width,
  loop,
  follow = true,
  tuning,
  onTuning,
  position = "auto",
  onPosition,
}: GuitarTabViewProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const resolved = tuning === "bass-standard" ? BASS_STANDARD : GUITAR_STANDARD;
  const model = useMemo(() => guitarTabOf(score, resolved, position), [score, resolved, position]);
  const layout = useMemo(() => layoutGuitarTab(model, Math.max(240, width)), [model, width]);
  const soundingKeys = useMemo(() => new Set(sounding.map((slot) => `${slot.voice}:${slot.note}`)), [sounding]);
  const missText = describeTabMisses(model.misses, model.tuning);

  useEffect(() => {
    const host = scroller.current;
    if (!onPick || !host) return;
    return bindScorePointer(host, {
      hit: (x, y, target) => {
        const node = (target instanceof Element ? target : host.ownerDocument.elementFromPoint(x, y))
          ?.closest("[data-note][data-voice]");
        if (!node || !host.contains(node)) return undefined;
        return { kind: "note", index: Number(node.getAttribute("data-note")), voice: Number(node.getAttribute("data-voice")) };
      },
      onNote: (index, extend, voice) => onPick(index, extend, (voice ?? 0) as VoiceId),
    });
  }, [onPick, layout, model]);

  useEffect(() => {
    const host = scroller.current;
    if (!follow || !host || playhead == null || !Number.isFinite(playhead)) return;
    const x = layout.xOf(playhead);
    const left = host.scrollLeft;
    const view = host.clientWidth;
    const margin = Math.min(80, view * 0.25);
    if (x - layout.labelWidth < left + margin || x > left + view - margin) {
      host.scrollTo({ left: Math.max(0, x - layout.labelWidth - margin) });
    }
  }, [playhead, layout, follow]);

  const loopX = loop ? layout.xOf(loop.from) : 0;
  const loopW = loop ? Math.max(2, layout.xOf(loop.to) - loopX) : 0;
  const plotTop = layout.yOf(1) - 8;
  const plotBottom = layout.yOf(model.tuning.strings.length) + 8;
  const plotH = plotBottom - plotTop;

  return (
    <div className="guitar-tab">
      <div className="guitar-tab-toolbar no-print">
        <div className="segmented" role="group" aria-label="调弦">
          <button type="button" aria-pressed={tuning === "guitar-standard"} onClick={() => onTuning("guitar-standard")}>
            吉他标准调弦
          </button>
          <button type="button" aria-pressed={tuning === "bass-standard"} onClick={() => onTuning("bass-standard")}>
            贝斯标准四弦
          </button>
        </div>
        {onPosition ? (
          <label className="guitar-tab-position">
            把位
            <select
              aria-label="把位"
              value={position}
              onChange={(event) => onPosition(event.target.value as TabPositionId)}
            >
              {TAB_POSITIONS.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {score.voice2 != null ? (
          <p className="guitar-tab-legend" aria-hidden="true">
            {allVoices(score).map((_,i) => <span key={i}><span className="guitar-tab-swatch" data-voice={i} />{voiceLabel(i)}</span>)}
          </p>
        ) : null}
      </div>
      <details className="guitar-tab-note">
        <summary>六线谱怎么排的</summary>
        <p>默认优先空弦和低把位。可换把位，让同一音改落在更高品格。和弦名写在谱上方。只支持标准调弦，按实际音高落品，不是从混音里自动抠出的吉他声部。</p>
      </details>
      {missText ? (
        <p className="guitar-tab-miss" role="status">
          {missText}
        </p>
      ) : null}
      <div ref={scroller} className="guitar-tab-scroll">
        <svg
          width={layout.width}
          height={layout.height}
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          role="img"
          aria-label="六线谱，跟奏预览"
          data-guitar-tab=""
        >
          {model.tuning.strings.map((str) => {
            const y = layout.yOf(str.string);
            return (
              <g key={str.string} aria-hidden="true">
                <text x={4} y={y + 4} className="guitar-tab-string-label">
                  {str.name}
                </text>
                <line
                  x1={layout.labelWidth}
                  x2={layout.width}
                  y1={y}
                  y2={y}
                  className="guitar-tab-string"
                />
              </g>
            );
          })}
          {model.bars.map((at, index) => {
            const x = layout.xOf(at);
            const label = index < model.bars.length - 1 || at < model.quarters - 1e-9 ? String(index + 1) : "";
            return (
              <g key={`bar-${at}`} aria-hidden="true">
                <line
                  x1={x}
                  x2={x}
                  y1={plotTop + 8}
                  y2={plotBottom - 8}
                  className={index === 0 ? "guitar-tab-bar is-start" : "guitar-tab-bar"}
                />
                {label && x + 10 < layout.width ? (
                  <text x={x + 4} y={model.chordMarks.length ? 30 : 13} className="guitar-tab-bar-label">
                    {label}
                  </text>
                ) : null}
              </g>
            );
          })}
          {model.chordMarks.map((mark, index) => (
            <text
              key={`chord-${mark.at}-${index}`}
              x={layout.xOf(mark.at)}
              y={16}
              className="guitar-tab-chord"
              textAnchor="middle"
            >
              {mark.symbol}
            </text>
          ))}
          {loop ? (
            <g data-loop-band="" aria-hidden="true">
              <rect x={loopX} y={plotTop} width={loopW} height={plotH} rx={6} fill="#a44825" fillOpacity={0.09} />
              <path
                d={`M ${loopX + 5} ${plotTop} h -5 v ${plotH} h 5`}
                fill="none"
                stroke="#a44825"
                strokeWidth={1.6}
                data-loop-edge="start"
              />
              <path
                d={`M ${loopX + loopW - 5} ${plotTop} h 5 v ${plotH} h -5`}
                fill="none"
                stroke="#a44825"
                strokeWidth={1.6}
                data-loop-edge="end"
              />
            </g>
          ) : null}
          {model.places.map((place, index) => {
            const key = `${place.voice}:${place.note}`;
            const lit = soundingKeys.has(key);
            const chosen = place.voice === activeVoice && selected.includes(place.note);
            const x = layout.xOf(place.start) + Math.max(4, layout.wOf(place.dur) * 0.15);
            const y = layout.yOf(place.string);
            return (
              <g
                key={`${key}-${place.string}-${index}`}
                className={`guitar-tab-fret${lit ? " is-sounding" : ""}${chosen ? " is-chosen" : ""}`}
                data-voice={place.voice}
                data-note={place.note}
                data-string={place.string}
                data-fret={place.fret}
                style={onPick ? { cursor: "pointer" } : undefined}
              >
                <rect
                  x={x - 22}
                  y={y - 22}
                  width={44}
                  height={44}
                  fill="transparent"
                />
                <rect
                  x={x - 7}
                  y={y - 8}
                  width={place.fret >= 10 ? 16 : 14}
                  height={14}
                  rx={2}
                  fill="#f7f3ea"
                />
                <text
                  x={x}
                  y={y + 4}
                  textAnchor="middle"
                  fill={VOICE_FILL[place.voice]}
                  fontWeight={lit || chosen ? 700 : 600}
                  fontSize={12}
                >
                  {place.fret}
                </text>
              </g>
            );
          })}
          {playhead != null && Number.isFinite(playhead) ? (
            <line
              x1={layout.xOf(playhead)}
              x2={layout.xOf(playhead)}
              y1={plotTop}
              y2={plotBottom}
              className="guitar-tab-playhead"
            />
          ) : null}
        </svg>
      </div>
    </div>
  );
}
