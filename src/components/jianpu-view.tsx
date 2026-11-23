import { voiceList, voiceLabel } from "@/lib/music/voices";
import { useEffect, useRef, useState } from "react";
import type { Score } from "@/lib/music/theory";
import type { FollowSlot } from "@/lib/music/playback-clock";
import type { VoiceId } from "@/lib/music/voices";
import type { JianpuVoice } from "@/lib/music/jianpu-render";
import { followInto } from "@/lib/music/follow-scroll";
import { bindScorePointer } from "@/lib/music/pointer-pick";

type Props = {
  score: Score;
  shift: number;
  sounding: FollowSlot[];
  selected: number[];
  activeVoice: VoiceId;
  onPick: (index: number, extend: boolean, voice: VoiceId) => void;
  /** A barline was tapped: place the insertion point (voice-wide index) there. */
  onPlace?: (cursor: number, voice: VoiceId) => void;
  /** Insertion point shown at a barline when nothing is selected. */
  cursor?: number | null;
  /** Keep the sounding note in view while playing. */
  follow?: boolean;
  /** Available CSS width; lines wrap at whole bars to fit it. */
  width?: number;
  /** Practice A-B loop (score quarters) to shade on the score; null = none. */
  loop?: { from: number; to: number } | null;
  /** Screen-only: 1 is always C. Playback and editing stay movable-do. */
  fixedDo?: boolean;
  /** Melody-only lead sheet: hide voice labels, show chord symbols. */
  leadSheet?: boolean;
  showFingering?: boolean;
};

function runCleanup(jobs: (() => void)[]) {
  for (const dispose of jobs.splice(0)) {
    try {
      dispose();
    } catch {
      /* one failed destroy must not skip the rest, or crash the app */
    }
  }
}

export function JianpuView(props: Props) {
  const host = useRef<HTMLDivElement>(null);
  const latest = useRef(props);
  latest.current = props;
  const [error, setError] = useState(false);
  const drawing = useRef<{ paint: () => void; mark: () => void } | null>(null);
  useEffect(() => {
    let cancelled = false;
    let timer = 0;
    const cleanup: (() => void)[] = [];
    setError(false);
    void import("@/lib/music/jianpu-render")
      .then((lib) => {
        if (cancelled || !host.current) return;
        host.current.replaceChildren();
        const rows: { container: HTMLDivElement; voice: JianpuVoice; lineEnd: number }[] = [];
        const spacing = lib.jianpuSpacing(props.score);
        const bars = lib.jianpuBarsPerLine(props.score, props.width ?? 640, spacing.quarterPx);
        const lines = lib.scoreToJianpuLines(props.score, props.shift, bars, props.fixedDo ? "fixed" : "movable");
        const twoVoices = (lines[0]?.length ?? 1) > 1;
        const lyrics = voiceList(props.score).some((notes) => notes.some((note) => note.lyric?.text));
        const drawLine = (line: JianpuVoice[], lineIndex: number) => line.forEach((voice) => {
          if (!host.current) return;
          if (!props.leadSheet && (lineIndex === 0 || twoVoices)) {
            const label = document.createElement("p");
            label.textContent = `第${voiceLabel(voice.voice).slice(2)}声部`;
            label.className = lineIndex === 0 ? "text-sm text-muted" : "sr-only";
            host.current.append(label);
          }
          const container = document.createElement("div");
          container.className = "jianpu-line overflow-x-auto";
          host.current.append(container);
          const header = voice.header !== false;
          const view = lib.renderJianpu(container, voice, {
            height: lineIndex === 0 ? (props.leadSheet ? (lyrics ? 188 : 168) : (lyrics ? 166 : (props.score.chordSymbols?.length || props.score.rehearsals?.length ? 156 : 128))) : (lyrics ? 118 : 96),
            showTempoMarking: voice.tempoMark ?? lineIndex === 0,
            header,
            pixelsPerTimeStep: spacing.pixelsPerTimeStep,
          });
          cleanup.push(() => lib.safeDestroy(view, container));
          lib.markBarlines(container, voice);
          lib.markNoteHits(container);
          const unbind = bindScorePointer(container, {
            hit: (x, y, target) => {
              const found = lib.jianpuTargetAt(voice, container, x, y, target instanceof Element ? target : null);
              if (!found) return undefined;
              return found.kind === "note"
                ? { kind: "note", index: found.index, voice: voice.voice }
                : { kind: "cursor", cursor: found.cursor, voice: voice.voice };
            },
            onNote: (index, extend, hitVoice) => latest.current.onPick(index, extend, (hitVoice ?? voice.voice) as VoiceId),
            onCursor: (cursor, hitVoice) => latest.current.onPlace?.(cursor, (hitVoice ?? voice.voice) as VoiceId),
          });
          cleanup.push(unbind);
          rows.push({ container, voice, lineEnd: lines[lineIndex + 1]?.[0]?.offset ?? Infinity });
        });
        type Row = (typeof rows)[number];
        const paintRows = (list: Row[]) => {
          const current = latest.current;
          for (const row of list)
            lib.paintJianpu(
              row.container,
              row.voice,
              current.sounding
                .filter((slot) => slot.voice === row.voice.voice)
                .map((slot) => slot.note),
              current.activeVoice === row.voice.voice ? current.selected : [],
              current.activeVoice === row.voice.voice ? (current.cursor ?? null) : null,
            );
        };
        const markRows = (list: Row[]) => {
          const current = latest.current;
          for (const row of list) {
            try {
              lib.markLoop(row.container, row.voice, current.loop ?? null, row.lineEnd);
              // Chord names first: repeat endings and jump marks stack above them.
              lib.markChordSymbols(row.container, row.voice, current.score.chordSymbols, row.lineEnd, { leadSheet: current.leadSheet });
              lib.markRepeats(row.container, row.voice, current.score.repeats, row.lineEnd, current.score.jumps);
              lib.markRehearsals(row.container, row.voice, current.score.rehearsals, row.lineEnd);
              lib.markFermatas(row.container, row.voice, current.score.fermatas, row.lineEnd);
              lib.markBarNumbers(row.container, row.voice, current.score, row.lineEnd);
              lib.markTempos(row.container, row.voice, current.score.changes, row.lineEnd);
              lib.markMeters(row.container, row.voice, current.score.changes, row.lineEnd);
              lib.markKeys(row.container, row.voice, current.score.changes, row.lineEnd);
              lib.markGradualTempos(row.container, row.voice, (current.score as { gradualTempos?: { from: number; to: number; kind?: string }[] }).gradualTempos, row.lineEnd);
              const notes = voiceList(current.score)[row.voice.voice] ?? [];
              lib.markFingerings(row.container, row.voice, notes, Boolean(current.showFingering), row.lineEnd);
            } catch {
              /* annotations must not take down the score view */
            }
          }
        };
        drawing.current = {
          paint: () => {
            paintRows(rows);
            const current = latest.current;
            if (current.follow && current.sounding.length) {
              const lit = host.current?.querySelector(".is-sounding");
              if (lit) followInto(lit);
            }
          },
          mark: () => markRows(rows),
        };
        // Long scores (hundreds of lines) are drawn in short slices so the editor stays responsive:
        // the first screenful at once, the rest between frames. Each slice paints only its new rows.
        let next = 0;
        const slice = (budgetMs: number) => {
          const from = rows.length;
          const start = performance.now();
          while (next < lines.length) {
            drawLine(lines[next], next);
            next += 1;
            if (performance.now() - start >= budgetMs) break;
          }
          const added = rows.slice(from);
          paintRows(added);
          markRows(added);
        };
        slice(48);
        drawing.current.paint();
        const pump = () => {
          if (cancelled || next >= lines.length) return;
          try {
            slice(24);
          } catch {
            setError(true);
            return;
          }
          timer = window.setTimeout(pump, 0);
        };
        timer = window.setTimeout(pump, 0);
      })
      .catch(() => {
        runCleanup(cleanup);
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      drawing.current = null;
      runCleanup(cleanup);
    };
  }, [props.score, props.shift, props.width, props.leadSheet, props.showFingering, props.fixedDo]);
  useEffect(() => {
    try {
      drawing.current?.paint();
    } catch {
      /* highlight updates must not crash the editor */
    }
  }, [props.sounding, props.selected, props.activeVoice, props.cursor]);
  useEffect(() => {
    try {
      drawing.current?.mark();
    } catch {
      /* annotation updates must not crash the editor */
    }
  }, [props.loop?.from, props.loop?.to]);
  return (
    <div className="no-print mt-3">
      {props.leadSheet && !props.score.chordSymbols?.length ? (
        <p className="lead-empty mb-2 rounded-2xl border border-line bg-paper px-3 py-2 text-sm leading-6 text-ink" role="status">
          <strong className="font-medium">还没有和弦标记</strong>：和弦谱是一行旋律、上面标和弦。打开「表情记号」里的「和弦标记」，手写或点「从谱上的和弦音生成」。
        </p>
      ) : null}
      <div ref={host} aria-label="简谱" />
      <p className="mt-2 text-center text-xs text-muted">
        点数字或休止选音，长按或拖过连选（电脑上也可按 Shift）；点小节线把输入位置放到下一小节开头。简谱暂不标超音域与表情记号。
      </p>
      {error ? <p role="alert">简谱加载失败，请切换五线视图。</p> : null}
    </div>
  );
}
