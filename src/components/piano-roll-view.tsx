import { voiceLabel, voiceList as allVoices } from "@/lib/music/voices";
import { voiceList } from "@/lib/music/voices";
import { useEffect, useMemo, useRef, useState } from "react";
import type { FollowSlot } from "@/lib/music/playback-clock";
import type { LoopRange } from "@/lib/music/practice";
import {
  isWhiteKey,
  layoutPianoRoll,
  midiOctaveName,
  pianoRollOf,
  type PianoRollPitch,
} from "@/lib/music/piano-roll";
import type { Score } from "@/lib/music/theory";
import type { VoiceId } from "@/lib/music/voices";
import { bindScorePointer } from "@/lib/music/pointer-pick";

type PianoRollViewProps = {
  score: Score;
  shift: number;
  sounding: readonly FollowSlot[];
  playhead: number | null;
  selected?: readonly number[];
  activeVoice?: VoiceId;
  onPick?: (index: number, extend: boolean, voice: VoiceId) => void;
  width: number;
  loop: LoopRange | null;
  /** Scroll along with the playhead (on unless the score's follow switch is off). */
  follow?: boolean;
  showFingering?: boolean;
};

const VOICE_FILL = ["#1f3d3a", "#7a5c3e"] as const;

export function PianoRollView({
  score,
  shift,
  sounding,
  playhead,
  selected = [],
  activeVoice = 0,
  onPick,
  width,
  loop,
  follow = true,
  showFingering = false,
}: PianoRollViewProps) {
  const [pitch, setPitch] = useState<PianoRollPitch>("sounding");
  const [vZoom, setVZoom] = useState(1);
  const [plotMin, setPlotMin] = useState(220);
  const scroller = useRef<HTMLDivElement>(null);
  const model = useMemo(() => pianoRollOf(score, { shift, pitch }), [score, shift, pitch]);
  useEffect(() => {
    const stage = scroller.current?.closest(".score-stage") as HTMLElement | null;
    const measure = () => {
      const h = stage ? Math.max(160, stage.clientHeight - 56) : 220;
      setPlotMin(h);
    };
    measure();
    if (!stage || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(stage);
    return () => ro.disconnect();
  }, [score, width]);
  const layout = useMemo(
    () => layoutPianoRoll(model, Math.max(240, width), { minPlotHeight: plotMin * vZoom }),
    [model, width, plotMin, vZoom],
  );
  const soundingKeys = useMemo(() => new Set(sounding.map((slot) => `${slot.voice}:${slot.note}`)), [sounding]);

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
    if (x - layout.keyboardWidth < left + margin || x > left + view - margin) {
      host.scrollTo({ left: Math.max(0, x - layout.keyboardWidth - margin) });
    }
    const lit = host.querySelector(".piano-roll-note.is-sounding") as SVGGraphicsElement | null;
    if (lit) {
      const y = lit.getBBox().y;
      const top = host.scrollTop;
      const vh = host.clientHeight;
      if (y < top + 8 || y > top + vh - 24) host.scrollTo({ top: Math.max(0, y - 16) });
    }
  }, [playhead, layout, follow, sounding]);

  const rows = [];
  for (let midi = model.midiHigh; midi >= model.midiLow; midi -= 1) {
    const y = layout.yOf(midi);
    const white = isWhiteKey(midi);
    const name = midiOctaveName(midi);
    rows.push(
      <g key={midi} aria-hidden="true">
        <rect
          x={0}
          y={y}
          width={layout.keyboardWidth}
          height={layout.rowHeight}
          className={white ? "piano-roll-key is-white" : "piano-roll-key is-black"}
        />
        <rect
          x={layout.keyboardWidth}
          y={y}
          width={layout.width - layout.keyboardWidth}
          height={layout.rowHeight}
          className={white ? "piano-roll-row is-white" : "piano-roll-row is-black"}
        />
        {name ? (
          <text
            x={layout.keyboardWidth - 4}
            y={y + layout.rowHeight - 2}
            textAnchor="end"
            className="piano-roll-key-label"
          >
            {name}
          </text>
        ) : null}
      </g>,
    );
  }

  const loopX = loop ? layout.xOf(loop.from) : 0;
  const loopW = loop ? Math.max(2, layout.xOf(loop.to) - loopX) : 0;
  const plotTop = layout.axisHeight;
  const plotH = layout.height - layout.axisHeight;

  return (
    <div className="piano-roll">
      <div className="piano-roll-toolbar no-print">
        <div className="segmented" role="group" aria-label="卷帘音高">
          <button type="button" aria-pressed={pitch === "sounding"} onClick={() => setPitch("sounding")}>
            实际音高
          </button>
          <button type="button" aria-pressed={pitch === "written"} onClick={() => setPitch("written")}>
            记谱音高
          </button>
        </div>
        <div className="segmented" role="group" aria-label="卷帘纵向缩放">
          <button type="button" aria-label="纵向缩小" disabled={vZoom <= 0.8} onClick={() => setVZoom((z) => Math.max(0.8, Math.round((z - 0.2) * 10) / 10))}>小</button>
          <button type="button" aria-label="纵向还原" aria-pressed={vZoom === 1} onClick={() => setVZoom(1)}>原大</button>
          <button type="button" aria-label="纵向放大" disabled={vZoom >= 2} onClick={() => setVZoom((z) => Math.min(2, Math.round((z + 0.2) * 10) / 10))}>大</button>
        </div>
        {score.voice2 != null ? (
          <p className="piano-roll-legend" aria-hidden="true">
            {allVoices(score).map((_,i) => <span key={i}><span className="piano-roll-swatch" data-voice={i} />{voiceLabel(i)}</span>)}
          </p>
        ) : null}
      </div>
      <div ref={scroller} className="piano-roll-scroll">
        <svg
          width={layout.width}
          height={layout.height}
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          role="img"
          aria-label="钢琴卷帘，跟奏预览"
          data-piano-roll=""
        >
          {rows}
          {model.bars.map((at, index) => {
            const x = layout.xOf(at);
            const label = index < model.bars.length - 1 || at < model.quarters - 1e-9 ? String(index + 1) : "";
            return (
              <g key={`bar-${at}`} aria-hidden="true">
                <line
                  x1={x}
                  x2={x}
                  y1={plotTop}
                  y2={layout.height}
                  className={index === 0 ? "piano-roll-bar is-start" : "piano-roll-bar"}
                />
                {label && x + 10 < layout.width ? (
                  <text x={x + 4} y={13} className="piano-roll-bar-label">
                    {label}
                  </text>
                ) : null}
              </g>
            );
          })}
          {loop ? (
            <g data-loop-band="" aria-hidden="true">
              <rect
                x={loopX}
                y={plotTop}
                width={loopW}
                height={plotH}
                rx={6}
                fill="#a44825"
                fillOpacity={0.09}
              />
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
          {model.rects.map((rect, index) => {
            const key = `${rect.voice}:${rect.note}`;
            const lit = soundingKeys.has(key);
            const chosen = rect.voice === activeVoice && selected.includes(rect.note);
            const x = layout.xOf(rect.start);
            const y = layout.yOf(rect.midi) + 1;
            const w = layout.wOf(rect.dur) - 1;
            const h = Math.max(4, layout.rowHeight - 2);
            return (
              <g key={`${key}-${rect.midi}-${index}`}>
              <rect
                x={x}
                y={y + h / 2 - Math.max(h, 22) / 2}
                width={Math.max(22, w)}
                height={Math.max(22, h)}
                rx={2}
                fill="transparent"
                className="piano-roll-hit"
                data-voice={rect.voice}
                data-note={rect.note}
                style={onPick ? { cursor: "pointer" } : undefined}
              />
              <rect
                key={`${key}-${rect.midi}-${index}`}
                x={x}
                y={y}
                width={Math.max(2, w)}
                height={h}
                rx={2}
                fill={VOICE_FILL[rect.voice]}
                fillOpacity={lit ? 1 : 0.82}
                className={`piano-roll-note${lit ? " is-sounding" : ""}${chosen ? " is-chosen" : ""}`}
                data-voice={rect.voice}
                data-note={rect.note}
                data-midi={rect.midi}
                data-start={rect.start}
                style={onPick ? { pointerEvents: "none" } : undefined}
              />
              {showFingering ? (() => {
                const notes = voiceList(score)[rect.voice] ?? [];
                const note = notes[rect.note];
                const soundingMidi = pitch === "written" ? rect.midi - shift : rect.midi;
                const exact = note?.pitches.indexOf(soundingMidi) ?? -1;
                const finger = exact >= 0 ? note?.fingers?.[exact] : undefined;
                return finger && finger >= 1 && finger <= 5 ? (
                  <text
                    x={x + 3}
                    y={y + h - 1}
                    fontSize={8}
                    fill="#f7f3ea"
                    aria-hidden="true"
                  >
                    {finger}
                  </text>
                ) : null;
              })() : null}
              </g>
            );
          })}
          {playhead != null && Number.isFinite(playhead) ? (
            <line
              x1={layout.xOf(playhead)}
              x2={layout.xOf(playhead)}
              y1={plotTop}
              y2={layout.height}
              className="piano-roll-playhead"
            />
          ) : null}
        </svg>
      </div>
    </div>
  );
}
