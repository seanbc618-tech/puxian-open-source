import { alignMixer, mixerPrograms } from "@/lib/music/mixer";
import { loadMixer, saveMixer } from "@/lib/music/mixer-store";
import "./performance.css";
import "./editor-chrome.css";
import { attachResizeHandle } from "../lib/card-size";
import { pageTurn, performanceSeconds, autoScrollSpeed } from "@/lib/music/performance";
import { readSetlists, nextSetlistSong } from "@/lib/music/setlists";
import type { Gp5Preview } from "../lib/music/gp5-import";
import { importMusicXmlSource, formatImportError, MAX_MXL_BYTES } from "@/lib/music/mxl";
import { drawJianpuPrint, jianpuPrint, exportView, exportPipeline, type ExportView } from "@/lib/music/jianpu-print";
import type { TabPositionId, TabTuningId } from "@/lib/music/guitar-tab";
import { drawTabPrint, tabPrint } from "@/lib/music/tab-print";
import { scoreToMusicXmlTab } from "@/lib/music/tab-musicxml";
import { ScoreImageUpload } from "./score-image";
import { MUSIC_UPLOAD_ACCEPT, MUSIC_UPLOAD_HELP, MUSIC_UPLOAD_ERROR } from "@/lib/music/upload";
import { decodeUploadedAudio } from "@/lib/music/decode-audio";
import {
  FOREGROUND_RELEASE_NOTICE,
  shouldReleaseForegroundAudio,
} from "@/lib/music/foreground-audio";
import { importTextScore, importTextScoreFromPaste, loadAbc, TEXT_FORMAT_ACCEPT } from "@/lib/music/text-formats";
import { exportJpwabc } from "@/lib/music/jpwabc-export";
import { export123 } from "@/lib/music/j123-export";
import { followInto, stickyCover } from "@/lib/music/follow-scroll";
import { padStaffHits } from "@/lib/music/staff-hits";
import { hapticEnabled, setHapticEnabled, tapHaptic } from "@/lib/music/tap-feedback";
import { isLongPress, pointerMoved } from "@/lib/music/pointer-pick";
import { nextBar, stateAt } from "@/lib/music/score-timeline";
import { repeatSelection, restSelection, shiftSelection } from "@/lib/music/selection-edit";
import { editFermatas, hasFermata, noteOnsets } from "@/lib/music/fermata";
import { ImportLosses, type ImportReport } from "./import-losses";
import { scoreToJianpuLy } from "../lib/music/jianpu-ly-export.ts";
import { AppErrorBoundary } from "./app-error-boundary";
import { JianpuView } from "./jianpu-view";
import { PianoRollView } from "./piano-roll-view";
import { GuitarTabView } from "./guitar-tab-view";
import { clearFingering, suggestFingering } from "@/lib/music/fingering";
import type { SimplifyLevel } from "@/lib/music/simplify";
import { leadSheetScore } from "@/lib/music/chord-symbol";
import { ScoreTitle } from "./score-title";
import { TapPad } from "./tap-pad";
import {
  clampTapOctave,
  tapBackspace,
  tapCursor,
  tapCursorLabel,
  tapInsert,
  tapPitch,
  type TapAccidental,
} from "@/lib/music/tap-entry";
import {
  COUNT_IN_OPTIONS,
  SPEED_MAX,
  SPEED_MIN,
  barStarts,
  clampSpeed,
  type CountInBars,
  type LoopRange,
} from "@/lib/music/practice";
import { DEFAULT_TRAINING, trainingProgress, type SpeedTraining } from "@/lib/music/speed-training";
import type { PracticeClip } from "@/lib/music/practice-store";
import { loadPractice, savePractice } from "@/lib/music/practice-store";
import { cleanLoopPause, cleanLoopTimes, LOOP_PAUSE_OPTIONS, LOOP_TIMES_OPTIONS } from "@/lib/music/loop-pause";
import { markStaffLoop } from "@/lib/music/loop-band";
import { checkScoreBars, describeBarCheck } from "@/lib/music/bar-check";
import { Zone } from "./ui/zone";
import { RepeatBar } from "./repeat-bar";
import { describeLoop, karaokeLine, loopFromBars, loopFromSelection, practiceChange, practiceLoopStatus, type PracticeKey } from "@/lib/music/practice-text";
import { abcBarText, editJumps, editRepeats, fitJumps, fitRepeats, hasPlayOrder, jumpsSummary, repeatsSummary, unrollScore, type JumpAction, type RepeatAction } from "@/lib/music/repeats";
import { FEATURES, isFeatureId, type FeatureId } from "./ui/zone-layout";
import { quiet, solid, field, stack, voiceOff, voiceOn, danger, dangerQuiet } from "./ui/styles";
import { songIncipit, upsertScore } from "@/lib/music/my-songs";
import { clearShareHash, shareUrlOf } from "@/lib/music/share-link";
import { connectMicCapture, takeMicFrame, type MicCaptureHandle } from "@/lib/music/mic-capture";
import { notePlace } from "@/lib/music/note-place";
import { emptyHistory, rememberHistory, travelHistory } from "@/lib/music/history-stack";
import {
  newDraftId,
  readDrafts,
  writeDrafts,
  DRAFT_KEY,
  type Draft,
} from "@/lib/music/draft-history";
import { lazy, Suspense, useCallback, useLayoutEffect, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import {
  Download,
  Mic,
  Minus,
  Music2,
  Pause,
  Play,
  Plus,
  Printer,
  Trash2,
  Undo2,
  Redo2,
  Upload,
  Maximize2,
  LocateFixed,
  LocateOff,
  Minimize2,
  Timer,
  Repeat2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { clsx } from "clsx";
import type { ArrangeStyle } from "@/lib/music/arrange";
import {
  estimateBpm,
  quantizeDetected,
  transcribeBuffer,
  transcribeMono,
  isLowPitchConfidence,
  type DetectedNote,
} from "@/lib/music/audio";
import { EXAMPLES, PD_EXAMPLES, exampleScoreUrl, scoreFromExample, type Example, type ExampleCard } from "@/lib/music/examples";
import {
  MAX_POLY_SECONDS,
  buildPolyDraft,
  cleanPolyNotes,
  POLY_LAYOUT_LABEL,
  type PolyLayout,
  midiName,
  suggestSplit,
} from "@/lib/music/poly-dictation";
import type { PolyNoteEvent } from "@/lib/music/basic-pitch/notes";
import { analyzePulse, METER_CHOICES, regroupPulse, scalePulse, type PulseGrid } from "@/lib/music/poly-rhythm";
import { polyBackendLabel } from "@/lib/music/poly-dictation-protocol";
import { applyJianpuText, rewriteVoice } from "@/lib/music/jianpu-edit";
import {
  applyMark,
  cleanScore,
  slurPairs,
  type MarkAction,
} from "@/lib/music/expression";
import {
  MAX_MIDI_BYTES,
  describeMidiVoice,
  listMidiVoices,
  midiChoicePrompt,
  previewMidiImport,
  midiLosses,
  previewMidiVoices,
  midiToScore,
  scoreToMidi,
  type MidiVoice,
} from "@/lib/music/midi";
import {
  assignLyrics,
  clearLyrics,
  formatLyricLine,
  lyricFromEntry,
  lyricsDropped,
  scoreHasLyrics,
  setNoteLyric,
} from "@/lib/music/lyrics";
import { musicXmlToScore, scoreToMusicXml } from "@/lib/music/musicxml";
import {
  formatJianpu,
  formatLetters,
  importJianpu,
  jianpuShareText,
  parseLetters,
  staffCaption,
  staffTargetAt,
  type StaffHit,
} from "@/lib/music/notation";
import { engraveAbc } from "@/lib/music/score-engraving";
import { paintNotes, type EngravedTune, type RangePaint } from "@/lib/music/range-paint";
import { drawStaffGraduals, dropDoubledKeySignatures, markStaffAbc, staffMarksScore, type StaffGradualChars } from "@/lib/music/staff-marks";
import {
  DEFAULT_PRINT_SETTINGS,
  normalizePrintSettings,
  type MeasuresPerSystem,
  type PaperId,
  type PrintSettings,
} from "@/lib/music/print-layout";
import { createPrintReadiness, type PrintStatus } from "@/lib/music/print-readiness";
import { drawPrintedScore, type PrintAbcRender } from "@/lib/music/print-sheet";
import { outOfRangePitches, rangeNotice, rangePitchCount, writtenRangeOf } from "@/lib/music/range";
import { playScore, previewTone, type PlaybackHandle, type PlayFrame } from "@/lib/music/playback";
import { isSwingFeel, SWING_RATIO, type SwingFeel } from "@/lib/music/swing";
import type { FollowSlot } from "@/lib/music/playback-clock";
import {
  RecordingArm,
  finishArming,
  initialRecordGate,
  tapRecord,
  type RecordGate,
  type RecordPhase,
  microphoneHelp,
  microphoneError,
  isMicrophoneStatusError,
  recordingMeter,
  RECORD_SECONDS,
} from "@/lib/music/record-session";
import { scoreLayoutMotion, type LayoutView } from "@/lib/music/score-motion";
import {
  applyStaffPick,
  noteShapeOf,
  selectionSurvivesEdit,
  type SelectionOwner,
} from "@/lib/music/staff-pick";
import {
  beginStaffRender,
  exportDownloadName,
  exportFileBase,
  freezeExportSnapshot,
  initialStaffGeneration,
  noteStaffFailed,
  noteStaffRendered,
  staffWaitResult,
  type ExportSnapshot,
} from "@/lib/music/staff-export";
import {
  INSTRUMENTS,
  KEY_NAMES,
  canTranspose,
  inferTonicOctave,
  stackChordAt,
  instrumentOf,
  keyLabel,
  keyPadShift,
  keyTitle,
  tonicMidi,
  transposeScore,
  type Clef,
  type InstrumentId,
  type KeyName,
  type Mode,
  type Score,
  type ScoreNote,
  guessKey,
} from "@/lib/music/theory";
import {
  addVoice, removeVoice, voiceList, voiceLabel, isVoiceId, MAX_VOICES,
  allVoiceNotes,
  hasSecondVoice,
  replaceVoice,
  replaceVoiceAndRemap,
  scoreQuarters,
  voiceNotes,
  voiceView,
  type VoiceId,
} from "@/lib/music/voices";

import { createBlankScore, isScore, STORAGE_KEY } from "@/lib/music/score-storage";
import { retryImport } from "@/lib/lazy-retry";
import { EAR_PRACTICE, addPractice, practiceTimer, readLog, writeLog } from "@/lib/music/practice-log";
const ChordSymbolsPanel = lazy(() => import("./chord-symbols-panel").then(m => ({ default: m.ChordSymbolsPanel })));
const FingeringPanel = lazy(() => import("./fingering-panel").then(m => ({ default: m.FingeringPanel })));
const ChordGuide = lazy(() => retryImport(() => import("./chord-guide")));
const VisualKeyboard = lazy(() => retryImport(() => import("./visual-keyboard")));
const WaitPractice = lazy(() => retryImport(() => import("./wait-practice")));
const MixerPanel = lazy(() => retryImport(() => import("./mixer-panel")));
const PracticeExtras = lazy(() => retryImport(() => import("./practice-extras")));
const PracticeLogCard = lazy(() => retryImport(() => import("./practice-log-card")));
const EarTrainer = lazy(() => retryImport(() => import("./ear-trainer")));
const RhythmTapper = lazy(() => retryImport(() => import("./rhythm-tapper")));
const Drone = lazy(() => retryImport(() => import("./drone")));
const ChordProPanel = lazy(() => retryImport(() => import("./chordpro-panel")));
const RehearsalBar = lazy(() => retryImport(() => import("./rehearsal-bar")));
const CreditsBar = lazy(() => retryImport(() => import("./credits-bar")));
const SightReadPanel = lazy(() => retryImport(() => import("./sight-read-panel")));
const TempoMarkBar = lazy(() => retryImport(() => import("./tempo-mark-bar")));
const MeterMarkBar = lazy(() => retryImport(() => import("./meter-mark-bar")));
const KeyMarkBar = lazy(() => retryImport(() => import("./key-mark-bar")));
const Tuner = lazy(() => retryImport(() => import("./practice-tools")).then((m) => ({ default: m.Tuner })));
const StandaloneMetronome = lazy(() => retryImport(() => import("./practice-tools")).then((m) => ({ default: m.Metronome })));

const METER_OPTIONS = ["2/4", "3/4", "4/4", "3/8", "6/8", "5/4"];
const blankScore = createBlankScore();

type MidiSession = {
  bytes: Uint8Array;
  fallbackTitle: string;
  voices: MidiVoice[];
  selected: { track: number; channel: number } | null;
};

const STYLE_DONE: Record<ArrangeStyle, string> = {
  lively: "已按「活泼」加上邻音或经过音。不想要就点撤销。",
  playful: "已按「俏皮」加上空拍或邻音。不想要就点撤销。",
  lyrical: "已按「抒情」在跳进前加了经过音。不想要就点撤销。",
};

const LYRIC_ARRANGED = "改编动过的音不再带歌词。没改的音，歌词还在原来的音上。";

type Tab = "jianpu" | "letters" | "piano";

type InputSource = "jianpu" | "letters" | "other";

function paintStaff(
  tunes: EngravedTune[],
  hits: StaffHit[],
  selected: readonly number[],
  sounding: number | null,
  range: RangePaint,
  unmarkedNow: { current: boolean },
  setUnmarked: (value: boolean) => void,
  activeVoice: VoiceId = 0,
  slots?: readonly FollowSlot[],
) {
  const unmarked = paintNotes(tunes, hits, selected, sounding, range, activeVoice, slots);
  if (unmarked === unmarkedNow.current) return;
  unmarkedNow.current = unmarked;
  setUnmarked(unmarked);
}

const staffPointer = { x: 0, y: 0, at: 0, moved: false };

function attachStaffPointer(host: HTMLElement): () => void {
  const down = (event: PointerEvent) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    staffPointer.x = event.clientX;
    staffPointer.y = event.clientY;
    staffPointer.at = Date.now();
    staffPointer.moved = false;
  };
  const move = (event: PointerEvent) => {
    if (pointerMoved(staffPointer.x, staffPointer.y, event.clientX, event.clientY)) staffPointer.moved = true;
  };
  host.addEventListener("pointerdown", down);
  host.addEventListener("pointermove", move);
  return () => {
    host.removeEventListener("pointerdown", down);
    host.removeEventListener("pointermove", move);
  };
}

function placeText(score: Pick<Score, "notes" | "beats" | "beatUnit">, index: number): string {
  const { bar, nth } = notePlace(score.notes, index, score.beats, score.beatUnit);
  return `第 ${bar} 小节第 ${nth} 个音`;
}

function selectionText(indexes: number[], score: Pick<Score, "notes" | "beats" | "beatUnit">, voiceName: string): string {
  const notes = score.notes;
  if (!indexes.length) return `还没有选中的音。正在改${voiceName}。点这一行的符头。`;
  if (indexes.length === 1) {
    const count = notes[indexes[0]]?.pitches.length ?? 0;
    if (count > 1) {
      return `已选${voiceName}${placeText(score, indexes[0])}，这一拍有 ${count} 个音。记号加在整组和弦上。`;
    }
    return `已选${voiceName}${placeText(score, indexes[0])}。`;
  }
  return `已选${voiceName}${placeText(score, indexes[0])}到${placeText(score, indexes[indexes.length - 1])}。`;
}

function markDoneText(action: MarkAction): string {
  const names: Record<string, string> = {
    p: "弱 p", mp: "中弱 mp", mf: "中强 mf", f: "强 f",
    staccato: "跳音", accent: "重音", tenuto: "保持音",
    trill: "颤音", grace: "短倚音", arpeggio: "琶音", cresc: "渐强", dim: "渐弱",
  };
  if (action.type === "clear") return "已去掉选中音的记号。";
  if (action.type === "slur") return "已更新连线。";
  const value = "value" in action ? String(action.value) : "";
  return `已更新「${names[value] ?? value}」。`;
}

function voiceNameOf(voice: VoiceId): string {
  return voiceLabel(voice);
}

function adoptMidi(current: Score, imported: Score, voice: VoiceId): Score {
  return replaceVoice(
    {
      ...current,
      title: imported.title,
      bpm: imported.bpm,
      beats: imported.beats,
      beatUnit: imported.beatUnit,
      changes: imported.changes,
      key: imported.key,
      mode: imported.mode,
      clef: imported.clef,
      tonicOctave: imported.tonicOctave,
    },
    voice,
    imported.notes,
  );
}

function staffJianpuText(score: Score): string {
  if (voiceList(score).length === 1) return formatJianpu(score);
  return voiceList(score).map((notes,i) => `${voiceLabel(i)}  ${formatJianpu({ ...score, notes }) || "（空）"}`).join("\n");
}

function chordRefuse(reason: "rest" | "duplicate" | "full" | "range" | "index" | "many"): string {
  if (reason === "rest") return "休止上叠不了音。";
  if (reason === "duplicate") return "这个音已经在这一拍里。";
  if (reason === "full") return "一组和弦最多八个音。";
  if (reason === "range") return "这个音超出钢琴音域。";
  if (reason === "many") return "叠和弦时请只选一个音。";
  return "这一拍叠不了音。";
}

function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.rel = "noopener";
  link.style.display = "none";
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function noteLabel(midi: number): string {
  const names = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
  const pc = ((midi % 12) + 12) % 12;
  return `${names[pc]}${Math.floor(midi / 12) - 1}`;
}

function Piano({ base, onPick }: { base: number; onPick: (midi: number) => void }) {
  const whites: number[] = [];
  let midi = base;
  while (whites.length < 8) {
    if (![1, 3, 6, 8, 10].includes(((midi % 12) + 12) % 12)) whites.push(midi);
    midi += 1;
  }
  const top = whites[whites.length - 1];
  return (
    <div className="flex h-28 gap-px">
      {whites.map((white) => {
        const pc = ((white % 12) + 12) % 12;
        const black = [0, 2, 5, 7, 9].includes(pc) ? white + 1 : null;
        const showBlack = black != null && black <= top;
        return (
          <div key={white} className="relative min-w-0 flex-1">
            <button
              type="button"
              className="pressable h-full w-full rounded-md border border-line bg-paper text-xs text-faint"
              aria-label={noteLabel(white)}
              onClick={() => onPick(white)}
            >
              <span className="absolute inset-x-0 bottom-1">
                {pc === 0 ? noteLabel(white) : ""}
              </span>
            </button>
            {showBlack && black != null ? (
              <button
                type="button"
                className="pressable absolute top-0 z-10 h-[58%] w-[68%] rounded-b-md bg-ink"
                style={{ right: "-34%" }}
                aria-label={noteLabel(black)}
                onClick={() => onPick(black)}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function MidiVoicePicker({
  session,
  disabled,
  onPick,
}: {
  session: MidiSession;
  disabled: boolean;
  onPick: (voice: MidiVoice) => void;
}) {
  return (
    <div className="mt-4">
      <p id="midi-voice-label" className="text-sm text-muted">
        选择声部
      </p>
      <div
        className="mt-2 grid max-h-80 gap-2 overflow-auto"
        role="radiogroup"
        aria-labelledby="midi-voice-label"
      >
        {session.voices.map((voice) => {
          const picked =
            session.selected?.track === voice.track && session.selected.channel === voice.channel;
          const described = describeMidiVoice(voice);
          return (
            <button
              key={`${voice.track}:${voice.channel}`}
              type="button"
              role="radio"
              aria-checked={picked}
              className={picked ? voiceOn : voiceOff}
              disabled={disabled}
              onClick={() => onPick(voice)}
            >
              <span className="break-words">{described.title}</span>
              <span className="text-xs font-normal opacity-80">{described.detail}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function PitchTrace({ notes }: { notes: DetectedNote[] }) {
  const end = notes[notes.length - 1].start + notes[notes.length - 1].dur;
  const midis = notes.map((note) => note.midi);
  const low = Math.min(...midis) - 1;
  const high = Math.max(...midis) + 1;
  return (
    <svg viewBox="0 0 100 32" className="h-16 w-full text-accent" role="img" aria-label="听写草稿音高轨迹，淡色表示需重点校对">
      {notes.map((note, i) => {
        const y = 32 - ((note.midi - low) / (high - low)) * 32;
        const faint = isLowPitchConfidence(note);
        return <path key={i} d={`M ${(note.start / end) * 100} ${y} H ${((note.start + note.dur) / end) * 100}`}
          opacity={faint ? 0.35 : 1}
          fill="none" stroke="currentColor" strokeWidth="1.4" vectorEffect="non-scaling-stroke">
          <title>{`MIDI ${note.midi} · ${note.start.toFixed(2)} 秒 · 稳定度 ${Math.round((note.confidence ?? 1) * 100)}%${faint ? "（需校对）" : ""}`}</title>
        </path>;
      })}
    </svg>
  );
}

/** Raw 多音 result as a small piano roll: opacity follows loudness; the dashed line is the voice split. */
function PolyRoll({ notes, split, big = false }: { notes: PolyNoteEvent[]; split: number | null; big?: boolean }) {
  if (!notes.length) return null;
  const end = Math.max(...notes.map((note) => note.start + note.dur)) || 1;
  const midis = notes.map((note) => note.midi);
  const low = Math.min(...midis, split ?? Infinity) - 1;
  const high = Math.max(...midis, split ?? -Infinity) + 1;
  const y = (midi: number) => 48 - ((midi - low) / (high - low)) * 48;
  return (
    <svg
      viewBox="0 0 100 48"
      preserveAspectRatio="none"
      className={clsx("text-accent", big ? "h-64" : "h-24 w-full")}
      style={big ? { width: `${Math.max(100, Math.round(end * 12))}%`, minWidth: "100%" } : undefined}
      role="img"
      aria-label="多音听写草稿卷帘，颜色越淡音越轻"
    >
      {split != null ? (
        <path d={`M 0 ${y(split - 0.5)} H 100`} stroke="currentColor" strokeDasharray="2 2" strokeWidth="0.6" opacity={0.5} vectorEffect="non-scaling-stroke" />
      ) : null}
      {notes.map((note, i) => (
        <path
          key={i}
          d={`M ${(note.start / end) * 100} ${y(note.midi)} H ${((note.start + note.dur) / end) * 100}`}
          opacity={Math.max(0.25, Math.min(1, note.amplitude))}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
        >
          <title>{`${midiName(note.midi)} · ${note.start.toFixed(2)} 秒 · 响度 ${Math.round(note.amplitude * 100)}%`}</title>
        </path>
      ))}
    </svg>
  );
}

type SelectionAction = "repeat" | "up" | "down" | "octaveUp" | "octaveDown" | "rest";

function ExpressionBar({
  score,
  selected,
  rangeMode,
  notice,
  onRangeMode,
  onStep,
  onMark,
  onEdit,
  onFermata,
  voice,
  voiceName,
}: {
  score: Score;
  selected: number[];
  rangeMode: boolean;
  notice: string | null;
  onRangeMode: (next: boolean) => void;
  onStep: (delta: number) => void;
  onMark: (action: MarkAction) => void;
  onEdit: (action: SelectionAction) => void;
  onFermata: () => void;
  voice: number;
  voiceName: string;
}) {
  const notes = score.notes;
  const sounding = selected.filter((index) => notes[index]?.pitches.length);
  const first = notes[selected[0] ?? -1];
  const starts = noteOnsets(notes).starts;
  const fermataOn = selected.length > 0 && selected.every((index) => starts[index] != null && hasFermata(score, voice, starts[index]!));
  let span: { from: number; to: number } | null = null;
  if (selected.length >= 2 && selected.every((index, step) => index === selected[0] + step)) {
    if (sounding.length >= 2) {
      span = { from: sounding[0], to: sounding[sounding.length - 1] };
    }
  }
  const slurOn =
    span != null && slurPairs(notes).some((pair) => pair.from === span.from && pair.to === span.to);
  const artOn = (value: "staccato" | "accent" | "tenuto") =>
    sounding.length > 0 && sounding.every((index) => notes[index]?.articulations?.includes(value));
  const ornamentOn = (value: "trill" | "grace" | "arpeggio") =>
    sounding.length > 0 && sounding.every((index) => notes[index]?.ornament === value);
  const hairpinOn = (value: "cresc" | "dim") =>
    selected.length >= 2 &&
    notes[selected[0]]?.hairpin === value &&
    notes[selected[selected.length - 1]]?.hairpinEnd === true;

  return (
    <div>
      {selected.length === 0 ? (
        <p className="select-hint" role="note">先点一个音：在上面谱面点一下符头（简谱点数字），再选下面的记号。</p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={rangeMode ? quiet : solid}
          aria-pressed={!rangeMode}
          onClick={() => onRangeMode(false)}
        >
          单音
        </button>
        <button
          type="button"
          className={rangeMode ? solid : quiet}
          aria-pressed={rangeMode}
          onClick={() => onRangeMode(true)}
        >
          选一段
        </button>
        <button type="button" className={quiet} onClick={() => onStep(-1)} disabled={!notes.length}>
          上一个音
        </button>
        <button type="button" className={quiet} onClick={() => onStep(1)} disabled={!notes.length}>
          下一个音
        </button>
      </div>
      <p className="mt-3 text-sm text-muted" aria-live="polite">
        {selectionText(selected, score, voiceName)}
      </p>
      <p className="mt-4 text-sm text-muted">选段编辑<span className="ml-2 text-xs">电脑上：R 重复 · ↑↓ 一级 · Ctrl+↑↓ 八度</span></p>
      <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="选段编辑">
        {(
          [
            ["repeat", "重复一遍"],
            ["up", "上移一级"],
            ["down", "下移一级"],
            ["octaveUp", "高八度"],
            ["octaveDown", "低八度"],
            ["rest", "改成休止"],
          ] as const
        ).map(([action, label]) => (
          <button key={action} type="button" className={quiet} disabled={!selected.length} onClick={() => onEdit(action)}>
            {label}
          </button>
        ))}
      </div>
      <p className="mt-4 text-sm text-muted">力度</p>
      <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="力度">
        {(
          [
            ["p", "弱 p"],
            ["mp", "中弱 mp"],
            ["mf", "中强 mf"],
            ["f", "强 f"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            className={first?.dynamic === value ? solid : quiet}
            aria-pressed={first?.dynamic === value}
            disabled={!selected.length}
            onClick={() => onMark({ type: "dynamic", value })}
          >
            {label}
          </button>
        ))}
      </div>
      <p className="mt-4 text-sm text-muted">奏法</p>
      <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="奏法">
        {(
          [
            ["staccato", "跳音"],
            ["accent", "重音"],
            ["tenuto", "保持音"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            className={artOn(value) ? solid : quiet}
            aria-pressed={artOn(value)}
            disabled={!selected.length}
            onClick={() => onMark({ type: "articulation", value })}
          >
            {label}
          </button>
        ))}
      </div>
      <p className="mt-4 text-sm text-muted">连线与渐变</p>
      <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="连线与渐变">
        <button
          type="button"
          className={slurOn ? solid : quiet}
          aria-pressed={slurOn}
          disabled={sounding.length < 2}
          onClick={() => onMark({ type: "slur" })}
        >
          连线
        </button>
        <button
          type="button"
          className={hairpinOn("cresc") ? solid : quiet}
          aria-pressed={hairpinOn("cresc")}
          disabled={selected.length < 2}
          onClick={() => onMark({ type: "hairpin", value: "cresc" })}
        >
          渐强
        </button>
        <button
          type="button"
          className={hairpinOn("dim") ? solid : quiet}
          aria-pressed={hairpinOn("dim")}
          disabled={selected.length < 2}
          onClick={() => onMark({ type: "hairpin", value: "dim" })}
        >
          渐弱
        </button>
      </div>
      <p className="mt-4 text-sm text-muted">装饰</p>
      <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="装饰">
        {(
          [
            ["trill", "颤音"],
            ["grace", "短倚音"],
            ["arpeggio", "琶音"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            className={ornamentOn(value) ? solid : quiet}
            aria-pressed={ornamentOn(value)}
            disabled={!selected.length}
            onClick={() => onMark({ type: "ornament", value })}
          >
            {label}
          </button>
        ))}
        <button
          type="button"
          className={fermataOn ? solid : quiet}
          aria-pressed={fermataOn}
          disabled={!selected.length}
          onClick={onFermata}
        >
          延长
        </button>
        <button
          type="button"
          className={quiet}
          disabled={!selected.length}
          onClick={() => onMark({ type: "clear" })}
        >
          去掉记号
        </button>
      </div>
      <details className="zone-help"><summary>了解更多</summary><p className="mt-3 text-sm leading-relaxed text-muted">
        跳音短一些，重音更响，保持音更满。短倚音是主音前的上邻音，颤音在主音和上邻音之间交替，琶音把和弦从低到高依次奏出（只加在和弦上；导入 MIDI 时识别到的琶音也记成这个记号）。连线画在谱上，播放会稍连一点。延长记号画在简谱音上，播放时这一拍按 1.5 倍时值放慢，后面的声部一起等；可加在休止上。选中和弦时，力度、跳音、连线和装饰加在这一整组上，不能只标其中一个音。简谱不写力度和奏法记号；音和时值没变时，记号还留着。五线谱也刻延长记号。MusicXML
        里不带斜线的倚音留成较长的倚音，不会改成短倚音。
      </p></details>
      {notice ? <p className="mt-2 text-sm text-muted">{notice}</p> : null}
    </div>
  );
}

function LyricBar({
  score,
  selected,
  line,
  entry,
  notice,
  onLine,
  onEntry,
  onFill,
  onWrite,
  onBlank,
  onRemove,
  onClear,
}: {
  score: Score;
  selected: number[];
  line: string;
  entry: string;
  notice: string | null;
  onLine: (value: string) => void;
  onEntry: (value: string) => void;
  onFill: () => void;
  onWrite: () => void;
  onBlank: () => void;
  onRemove: () => void;
  onClear: () => void;
}) {
  const lineComposing = useRef(false);
  const entryComposing = useRef(false);
  const one = selected.length === 1 ? score.notes[selected[0]] : undefined;
  const sounding = Boolean(one?.pitches.length);
  const current = formatLyricLine(score.notes).replace(/(?:\s+\*)+$/u, "");
  let here = "先点谱上的一个符头。";
  if (selected.length > 1) here = "请只选一个音，再把字写到那个音上。";
  else if (one && !one.pitches.length) here = "选中的是休止，不写歌词。";
  else if (one) {
    const lyric = one.lyric;
    const chord = one.pitches.length > 1 ? "这一拍是和弦，只写一个字。" : "";
    const state = !lyric
      ? "这个音还没有歌词。"
      : lyric.text
        ? `这个音上现在是「${lyric.text}」。`
        : lyric.extend
          ? "这个音接着唱前一个字。"
          : "这个音空过。";
    here = `${chord}${state}`;
  }
  return (
    <div>
      <label className="block text-sm text-muted" htmlFor="lyric-line">
        整段歌词
      </label>
      <textarea
        onCompositionStart={() => { lineComposing.current = true; }}
        onCompositionEnd={(event) => { lineComposing.current = false; onLine(event.currentTarget.value); }}
        id="lyric-line"
        value={line}
        onChange={(event) => onLine(event.target.value)}
        rows={2}
        placeholder="小星星亮晶晶    或    Twin-kle twin-kle lit-tle star"
        className="mt-2 w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      />
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" className={solid} onClick={() => { if (!lineComposing.current) onFill(); }}>
          从开头填入
        </button>
        <button
          type="button"
          className={quiet}
          onClick={onClear}
          disabled={!scoreHasLyrics(score.notes)}
        >
          清空全部歌词
        </button>
      </div>
      <p className="mt-4 text-sm text-muted">写到选中的音</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          onCompositionStart={() => { entryComposing.current = true; }}
          onCompositionEnd={(event) => { entryComposing.current = false; onEntry(event.currentTarget.value); }}
          aria-label="这个音的歌词"
          value={entry}
          onChange={(event) => onEntry(event.target.value)}
          placeholder="一个字"
          disabled={!sounding}
          className={`${field} w-36 disabled:opacity-40`}
        />
        <button type="button" className={solid} onClick={() => { if (!entryComposing.current) onWrite(); }} disabled={!sounding}>
          写到选中的音
        </button>
        <button type="button" className={quiet} onClick={onBlank} disabled={!sounding}>
          这个音空过
        </button>
        <button
          type="button"
          className={quiet}
          onClick={onRemove}
          disabled={!sounding || !one?.lyric}
        >
          去掉这个音的歌词
        </button>
      </div>
      <p className="mt-3 text-sm text-muted" aria-live="polite">
        {here}
      </p>
      <p className="lyric-preview mt-2 text-sm text-muted">
        {scoreHasLyrics(score.notes) ? `谱上现在是：${current}` : "谱上还没有歌词。"}
        {score.notes.some(note => (note.lyric?.text.length ?? 0) >= 12) && <span className="block">长音节在窄谱面上可能超出边缘；以上预览保留完整音节，可用连字符分音节。</span>}
      </p>
      <details className="zone-help"><summary>了解更多</summary><p className="mt-3 text-sm leading-relaxed text-muted">
        每个汉字是一个音节，中间的空格可以不写。拉丁音节用空格分开。同一个词要连字符时写成
        Hel-lo，中间不要加空格。单独的 / 或 * 表示这个音空过，后面的字不会挤上来。_ 或 ～
        表示前一个字再拖一个音。{"{多个字}"} 放在同一个音下。| 跳到下一小节的第一个音，方便对齐。标点不占音（中文输入法下的「、」也是标点，空过请用英文 /）。和弦只占一个字。休止不占字。跨小节连起来的音，字只写在第一个音下面。只写第
        1 段。简谱和 MIDI 不带歌词。音和时值没变时，歌词还在；旋律一改就会清掉，避免对错音。
      </p></details>
      {notice ? <p className="mt-2 text-sm text-muted">{notice}</p> : null}
    </div>
  );
}

type StafflineAppProps = {
  /** Explicit selections take precedence over the previous local draft. */
  initialScore?: Score;
  pendingUpload?: File;
  pendingImage?: File[];
  recognizeMusic?: boolean;
  /** Archive entry being continued from「我的曲子」; autosave rolls this entry forward. */
  songId?: string;
  setlistId?: string;
  /** Opened from a `#s=` share link: view, play, and practice only until the visitor saves a copy. */
  shared?: boolean;
  onReturnHome?: (unsavedScore?: Score) => void;
  pendingExampleId?: string;
};

const VIEW_KEY = "puxian-view-v1";
const FOLLOW_KEY = "puxian-follow-v1";
function rememberedFollow(): boolean {
  try {
    return localStorage.getItem(FOLLOW_KEY) !== "off";
  } catch {
    return true;
  }
}
const FINGER_KEY = "puxian-fingering-v1";
function rememberedFingering(): boolean {
  try {
    return localStorage.getItem(FINGER_KEY) === "1";
  } catch {
    return false;
  }
}
const NAMING_KEY = "puxian-jianpu-naming-v1";
function rememberedFixedDo(): boolean {
  try {
    return localStorage.getItem(NAMING_KEY) === "fixed";
  } catch {
    return false;
  }
}
const SWING_KEY = "puxian-swing-v1";
function rememberedSwing(): SwingFeel {
  try {
    const value = localStorage.getItem(SWING_KEY);
    return isSwingFeel(value) ? value : "straight";
  } catch {
    return "straight";
  }
}
const COMP_KEY = "puxian-comp-v1";
function rememberedComp(): boolean {
  try {
    return localStorage.getItem(COMP_KEY) === "1";
  } catch {
    return false;
  }
}

/** 「填入示例」for a blank score: the opening of 小星星. */
const JIANPU_SAMPLE = "1 1 5 5 | 6 6 5 - | 4 4 3 3 | 2 2 1 -";
const ZOOM_STEPS = [0.85, 1, 1.25, 1.5, 2];
type ScoreView = "jianpu" | "staff" | "roll" | "lead" | "tab";
function rememberedView(keepSaved: boolean): ScoreView {
  // A new score or an official example must not inherit 六线 from the previous piece.
  if (!keepSaved) return "jianpu";
  try {
    const value = localStorage.getItem(VIEW_KEY);
    return value === "staff" || value === "roll" || value === "lead" || value === "tab" ? value : "jianpu";
  } catch {
    return "jianpu";
  }
}

function isMachineTitle(title: string): boolean {
  return /几何识谱草稿|图片识别草稿/.test(title) || /^upload\b/i.test(title);
}



const EXAMPLE_LOAD_ERROR = "示例乐谱打不开，请稍后重试。";

async function fetchExampleScore(id: string): Promise<Score> {
  const response = await fetch(exampleScoreUrl(id, document.baseURI));
  if (!response.ok) throw new Error(EXAMPLE_LOAD_ERROR);
  return { ...await response.json(), staffInstrument: "piano" } as Score;
}

const RecognitionDraft = lazy(() => import("./recognition-draft"));
const ScoreImagePanel = lazy(() => import("./score-image-panel"));

export function StafflineApp({ initialScore, pendingUpload, pendingImage, recognizeMusic = false, songId, setlistId, shared: sharedView = false, onReturnHome, pendingExampleId }: StafflineAppProps = {}) {
  const [recognitionDraft, setRecognitionDraft] = useState<{ score: Score; gaps: string[]; images?: { url: string; name: string }[]; currentImage?: number } | null>(null);
  const [scoreImage, setScoreImage] = useState<File[] | undefined>(pendingImage);
  const [activeFeature, setActiveFeature] = useState<FeatureId>(recognizeMusic ? "zone-audio" : "zone-input");
  const [auxiliary, setAuxiliary] = useState<{
    arrange: typeof import("@/lib/music/arrange");
    simplify: typeof import("@/lib/music/simplify");
  } | null>(null);
  const [auxiliaryError, setAuxiliaryError] = useState(false);
  useEffect(() => {
    if (activeFeature !== "zone-style" || auxiliary) return;
    let live = true;
    setAuxiliaryError(false);
    Promise.all([import("@/lib/music/arrange"), import("@/lib/music/simplify")]).then(([arrange, simplify]) => {
      if (live) setAuxiliary({ arrange, simplify });
    }).catch(() => { if (live) setAuxiliaryError(true); });
    return () => { live = false; };
  }, [activeFeature, auxiliary]);
  const ARRANGE_STYLES = auxiliary?.arrange.ARRANGE_STYLES ?? [];
  const ARRANGE_LIMIT = auxiliary?.arrange.ARRANGE_LIMIT ?? "";
  const SIMPLIFY_LEVELS = auxiliary?.simplify.SIMPLIFY_LEVELS ?? [];
  const arrangeScore: typeof import("@/lib/music/arrange").arrangeScore = (...args) => auxiliary!.arrange.arrangeScore(...args);
  const simplifyScore: typeof import("@/lib/music/simplify").simplifyScore = (...args) => auxiliary!.simplify.simplifyScore(...args);
  const describeSimplify: typeof import("@/lib/music/simplify").describeSimplify = (...args) => auxiliary!.simplify.describeSimplify(...args);

  useEffect(() => {
    const followHash = () => {
      const id = window.location.hash.slice(1);
      if (isFeatureId(id)) setActiveFeature(id);
    };
    if (!recognizeMusic) followHash();
    window.addEventListener("hashchange", followHash);
    return () => window.removeEventListener("hashchange", followHash);
  }, []);
  const starter = initialScore ?? blankScore;
  const [shared, setShared] = useState(Boolean(sharedView));
  const sharedRef = useRef(Boolean(sharedView));
  const [score, setScore] = useState<Score>(starter);
  // Numbered notation is the default; the last explicit choice is remembered.
  const [scoreView, setScoreViewState] = useState<ScoreView>(rememberedView(Boolean(songId)));
  const [scorePaint, setScorePaint] = useState(0);
  function setScoreView(view: ScoreView) {
    setScoreViewState(view);
    setSelected([]);
    anchorRef.current = null;
    try {
      localStorage.setItem(VIEW_KEY, view);
    } catch {
      /* private mode: keep the choice for this page only */
    }
  }
  const [jianpu, setJianpu] = useState(() => formatJianpu(starter));
  const [letters, setLetters] = useState(() => formatLetters(starter));
  const [tab, setTab] = useState<Tab>("jianpu");
  const [tabTuning, setTabTuning] = useState<TabTuningId>("guitar-standard");
  const [tabPosition, setTabPosition] = useState<TabPositionId>("auto");
  const [showFingering, setShowFingeringState] = useState(rememberedFingering);
  function setShowFingering(on: boolean) {
    setShowFingeringState(on);
    try { localStorage.setItem(FINGER_KEY, on ? "1" : "0"); } catch { /* private mode */ }
  }
  const [fixedDo, setFixedDoState] = useState(rememberedFixedDo);
  function setFixedDo(on: boolean) {
    setFixedDoState(on);
    try { localStorage.setItem(NAMING_KEY, on ? "fixed" : "movable"); } catch { /* private mode */ }
  }
  const [swingFeel, setSwingFeelState] = useState(rememberedSwing);
  const swingRef = useRef(swingFeel);
  swingRef.current = swingFeel;
  function setSwingFeel(feel: SwingFeel) {
    setSwingFeelState(feel);
    try { localStorage.setItem(SWING_KEY, feel); } catch { /* private mode */ }
  }
  const [compOn, setCompOnState] = useState(rememberedComp);
  const compRef = useRef(compOn);
  compRef.current = compOn;
  function setCompOn(on: boolean) {
    setCompOnState(on);
    try { localStorage.setItem(COMP_KEY, on ? "1" : "0"); } catch { /* private mode */ }
  }
  const [simplifyPreview, setSimplifyPreview] = useState<{
    level: SimplifyLevel; score: Score; base: Score;
  } | null>(null);
  const simplifyPreviewRef = useRef(simplifyPreview);
  simplifyPreviewRef.current = simplifyPreview;
  const [instrument, setInstrument] = useState<InstrumentId>("concert");
  const [markRange, setMarkRange] = useState(true);
  const [rangeUnmarked, setRangeUnmarked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Hide placeholder meter/clef until the lazy classic JSON arrives; do not persist the dummy score.
  const lazyExamplePendingRef = useRef(Boolean(pendingExampleId));
  const [lazyExampleReady, setLazyExampleReady] = useState(!pendingExampleId);
  useEffect(() => {
    if (!notice) return;
    // Short confirmations fade after ~2s; longer guidance stays long enough to read.
    // Failures live in `error` and stay until dismissed or replaced.
    const ms = Math.min(10_000, Math.max(2000, notice.length * 150));
    const timer = window.setTimeout(() => setNotice(null), ms);
    return () => window.clearTimeout(timer);
  }, [notice]);
  function exportSuccess(message: string) {
    setError(null);
    setNotice(message);
  }
  const [styleNotice, setStyleNotice] = useState<string | null>(null);
  const [stylePreview, setStylePreview] = useState<{
    style: ArrangeStyle; score: Score; base: Score; voice: VoiceId; from: number; to: number; lost: number;
  } | null>(null);
  const stylePreviewRef = useRef(stylePreview);
  stylePreviewRef.current = stylePreview;
  const stylePreviewBox = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // On phones the preview opens below the fold of the tools panel.
    if (stylePreview) stylePreviewBox.current?.scrollIntoView({ block: "nearest" });
  }, [stylePreview]);
  const [duration, setDuration] = useState(1);
  const [dotted, setDotted] = useState(false);
  // Tap keypad: sticky octave, one-shot accidental, cursor when nothing is selected.
  const [tapOctave, setTapOctave] = useState(0);
  const [tapAccidental, setTapAccidental] = useState<TapAccidental>(0);
  const [tapAudition, setTapAudition] = useState(true);
  const [tapCursorAt, setTapCursorAt] = useState<number | null>(null);
  const tapShapeRef = useRef<string | null>(null);
  const previewCtxRef = useRef<{ ctx: AudioContext; timer: ReturnType<typeof setTimeout> } | null>(null);
  const [stackChord, setStackChord] = useState(false);
  const [pianoBase, setPianoBase] = useState(60);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [playhead, setPlayhead] = useState<number | null>(null);
  const [sounding, setSounding] = useState<FollowSlot[]>([]);
  // Playback scrolls the score to the sounding note; the choice is remembered.
  const [followPlay, setFollowPlayState] = useState(rememberedFollow);
  function setFollowPlay(on: boolean) {
    setFollowPlayState(on);
    try {
      localStorage.setItem(FOLLOW_KEY, on ? "on" : "off");
    } catch {
      /* private mode: keep the choice for this page only */
    }
  }
  const [activeVoice, setActiveVoice] = useState<VoiceId>(0);
  const [metronome, setMetronome] = useState(false);
  const [metronomeVolume, setMetronomeVolume] = useState(0.7);
  // Narrow phones only: the volume pops over the bar; any tap outside closes it.
  const [metronomeOpen, setMetronomeOpen] = useState(false);
  const metroGroupRef = useRef<HTMLDivElement>(null);
  const narrowMetronome = () => typeof window !== "undefined" && window.matchMedia("(max-width: 359px)").matches;
  useEffect(() => {
    if (!metronomeOpen) return;
    const away = (event: PointerEvent) => {
      if (!metroGroupRef.current?.contains(event.target as Node)) setMetronomeOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMetronomeOpen(false);
    };
    document.addEventListener("pointerdown", away, true);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", away, true);
      document.removeEventListener("keydown", escape);
    };
  }, [metronomeOpen]);
  // Practice mode (A-B loop, slow-down, count-in). Not part of the score or its save.
  // Remembered per song on this device only (practice-store), never in the score or drafts.
  const [initialPractice] = useState(() =>
    loadPractice(typeof localStorage === "undefined" ? undefined : localStorage, songId ?? ""),
  );
  const [practiceHand, setPracticeHand] = useState<"both" | "right" | "left">(initialPractice.hand ?? "both");
  const [otherHand, setOtherHand] = useState<"mute" | "quiet">(initialPractice.otherHand ?? "mute");
  const handRef = useRef({ hand: practiceHand, otherHand });
  handRef.current = { hand: practiceHand, otherHand };
  const [waitActive, setWaitActive] = useState(false);
  // 练琴记录: time while the score plays, 等你弹 runs (both set `playing`) or the standalone
  // metronome ticks (not the tuner), kept per day and per song on this device.
  const [practiceLogTick, setPracticeLogTick] = useState(0);
  const [metroRunning, setMetroRunning] = useState(false);
  const [earActive, setEarActive] = useState(false);
  const [rhythmRunning, setRhythmRunning] = useState(false);
  const [droneRunning, setDroneRunning] = useState(false);
  // Playing, the metronome, 拍节奏 and 持续音 are time on this song (one clock, never counted twice);
  // 听音练耳 alone is its own line.
  const practiceMode = playing || metroRunning || rhythmRunning || droneRunning ? "song" : earActive ? "ear" : null;
  const practicing = practiceMode != null;
  useEffect(() => {
    if (!practiceMode) return;
    const timer = practiceTimer(
      () => (practiceMode === "ear" ? EAR_PRACTICE : { key: songIdRef.current, title: scoreRef.current.title }),
      (start, end, song) => writeLog(localStorage, addPractice(readLog(localStorage), start, end, song)),
    );
    const flush = () => timer.flush();
    // A closed or backgrounded tab never runs the cleanup, so bank what has been played so far.
    const onHide = () => { if (document.visibilityState === "hidden") flush(); };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onHide);
      flush();
      setPracticeLogTick((tick) => tick + 1);
    };
  }, [practiceMode]);
  const waitStop = useRef<(() => void) | null>(null);
  const [waitFeedback, setWaitFeedback] = useState<{ midi: number | null; wrong: boolean }>({ midi: null, wrong: false });
  const [practiceOpen, setPracticeOpen] = useState(false);
  const [tunerOpen, setTunerOpen] = useState(false);
  const [metroToolOpen, setMetroToolOpen] = useState(false);
  const [earOpen, setEarOpen] = useState(false);
  const [rhythmOpen, setRhythmOpen] = useState(false);
  const [droneOpen, setDroneOpen] = useState(false);
  const [hapticOn, setHapticOn] = useState(() => hapticEnabled());
  const [textPaste, setTextPaste] = useState("");
  const [practiceSpeed, setPracticeSpeed] = useState(initialPractice.speed);
  const [trainingSettings, setTrainingSettings] = useState<SpeedTraining>(initialPractice.training ?? DEFAULT_TRAINING);
  const [trainingActive, setTrainingActive] = useState(false);
  const [trainingCompleted, setTrainingCompleted] = useState(0);
  const trainingRef = useRef({ active: trainingActive, settings: trainingSettings, completed: trainingCompleted });
  trainingRef.current = { active: trainingActive, settings: trainingSettings, completed: trainingCompleted };
  const [clips, setClips] = useState<PracticeClip[]>(initialPractice.clips ?? []);
  const [chordLabels, setChordLabels] = useState<{source: Score; labels: NonNullable<Score["chordSymbols"]>} | null>(null);
  const onChordLabels = useCallback((source: Score, labels: NonNullable<Score["chordSymbols"]>) => setChordLabels({source, labels}), []);
  const chordDisplayScore = useMemo(() => chordLabels?.source === score ? {...score, chordSymbols: chordLabels.labels} : score, [chordLabels, score]);
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [keyboardTranspose, setKeyboardTranspose] = useState(0);
  const keyboardTranspositions = useRef(new WeakMap<Score, number>());
  const [countInBars, setCountInBars] = useState<CountInBars>(initialPractice.countInBars);
  const [loopOn, setLoopOn] = useState(initialPractice.loopOn);
  const [loopRange, setLoopRange] = useState<LoopRange | null>(initialPractice.loopRange);
  const [loopPause, setLoopPause] = useState(initialPractice.loopPause ?? 0);
  const [loopTimes, setLoopTimes] = useState(initialPractice.loopTimes ?? 0);
  /** Loop pass now playing (1-based) and pause seconds left, while a plain loop runs. */
  const [loopNow, setLoopNow] = useState<{ pass: number; rest: number } | null>(null);
  const [countdown, setCountdown] = useState(0);
  const [karaokeNote, setKaraokeNote] = useState<{ voice: VoiceId; note: number } | null>(null);
  const practiceRef = useRef({ speed: 1, countInBars: 0 as number, loopOn: false, loopRange: null as LoopRange | null, loopPause: 0, loopTimes: 0 });
  practiceRef.current = { speed: practiceSpeed, countInBars, loopOn, loopRange, loopPause, loopTimes };
  // The A-B loop is drawn on the score (both views) while looping is on.
  const loopShown = loopOn && loopRange ? loopRange : null;
  const loopShownRef = useRef(loopShown);
  loopShownRef.current = loopShown;
  /** Score quarter last reported by playback; a speed change resumes from here. */
  const playPositionRef = useRef<number | null>(null);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [drafts, setDrafts] = useState<Draft<Score>[]>([]);
  const [recordPhase, setRecordPhase] = useState<RecordPhase>("idle");
  const recording = recordPhase !== "idle";
  const [recordMeter, setRecordMeter] = useState({ elapsed: 0, remaining: RECORD_SECONDS, level: 0 });
  const [recordPending, setRecordPending] = useState("");
  const [draftBpm, setDraftBpm] = useState(92);
  const [draftVoice, setDraftVoice] = useState<VoiceId>(0);
  /** 单音 keeps the existing melody path; 多音 runs Basic Pitch on uploaded audio. */
  const [audioMode, setAudioMode] = useState<"mono" | "poly">("mono");
  const audioModeRef = useRef(audioMode);
  // Do not copy state back into the ref during render: a late "mono" paint can
  // overwrite a click that already set the ref to「多音」before the upload runs.
  const [polyJob, setPolyJob] = useState<{ phase: "audio" | "model" | "infer"; done: number } | null>(null);
  const [polyTake, setPolyTake] = useState<{
    notes: PolyNoteEvent[];
    seconds: number;
    clippedSeconds: number;
    backend: string;
    modelMs: number;
    inferMs: number;
    voice: VoiceId;
    /** Beats followed through the recording; bpm, meter and bar 1 come from it. */
    pulse: PulseGrid;
  } | null>(null);
  /** ×½ / ×2 on the followed beat, for the classic half/double-tempo slip. */
  const [polyTempo, setPolyTempo] = useState<0.5 | 1 | 2>(1);
  /** "auto" or "beats/unit" picked by the user. */
  const [polyMeter, setPolyMeter] = useState("auto");
  const [polyLayout, setPolyLayout] = useState<PolyLayout>("reduced");
  const [polyCpu, setPolyCpu] = useState(false);
  const [polyRollBig, setPolyRollBig] = useState(false);
  const polyPanelRef = useRef<HTMLDivElement | null>(null);
  const [polySplit, setPolySplit] = useState<number | null>(60);
  const [polyGrid, setPolyGrid] = useState<0.25 | 0.125>(0.25);
  const [polyKeepOvertones, setPolyKeepOvertones] = useState(false);
  const polyCancel = useRef<(() => void) | null>(null);
  const [confirmWipe, setConfirmWipe] = useState(false);
  const [zoom, setZoom] = useState<number>(1);
  const zoomRef = useRef(1);
  zoomRef.current = zoom;
  const [fullScore, setFullScore] = useState(!!setlistId);
  useEffect(() => {
    if (!fullScore) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setFullScore(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullScore]);
  const [autoScrolling, setAutoScrolling] = useState(false);
  const [scrollPercent, setScrollPercent] = useState(100);
  const turnPointer = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [detected, setDetected] = useState<DetectedNote[] | null>(null);
  const [midiSession, setMidiSession] = useState<MidiSession | null>(null);
  // Product default dictation grid is eighths (0.5). Official usable acceptance uses 0.25 separately and must not change this default.
  const [grid, setGrid] = useState(0.5);
  const [width, setWidth] = useState(640);
  const [selected, setSelected] = useState<number[]>([]);
  const [rangeMode, setRangeMode] = useState(false);
  const [markNotice, setMarkNotice] = useState<string | null>(null);
  const [lyricLine, setLyricLine] = useState("");
  const [lyricEntry, setLyricEntry] = useState("");
  const [lyricNotice, setLyricNotice] = useState<string | null>(null);
  const [printSettings, setPrintSettings] = useState<PrintSettings>(DEFAULT_PRINT_SETTINGS);

  const scoreRef = useRef(score);
  scoreRef.current = score;
  const instrumentRef = useRef(instrument);
  instrumentRef.current = instrument;
  const paperRef = useRef<HTMLDivElement>(null);
  const staffRef = useRef<HTMLDivElement>(null);
  const decodingContexts = useRef(new Set<AudioContext>());
  const stopRef = useRef<(() => void) | null>(null);
  const playHandle = useRef<PlaybackHandle | null>(null);
  /** Which button started the current playback: the transport, or a style preview. */
  const playKindRef = useRef<"score" | "preview">("score");
  const soundingRef = useRef<FollowSlot[]>([]);
  const metroRef = useRef({ on: false, volume: 0.7 });
  metroRef.current = { on: metronome, volume: metronomeVolume };
  const historyRef = useRef(emptyHistory<{ score: Score; register: number }>());
  const restoringRef = useRef(false);
  const storageDeletedRef = useRef(false);
  // One archive entry per song. Untouched examples/blank scores are not archived.
  const [initialSongId] = useState(() => songId ?? newDraftId());
  const songIdRef = useRef(initialSongId);
  function paintStaffLoop() {
    markStaffLoop(
      staffRef.current?.querySelector("svg"),
      tunesRef.current,
      (start, end) => staffTargetAt(hitsRef.current, start, end),
      voiceList(scoreRef.current),
      loopShownRef.current,
    );
  }
  const [practiceSong, setPracticeSong] = useState(initialSongId);
  const [mixer, setMixer] = useState(() => loadMixer(typeof localStorage === "undefined" ? undefined : localStorage, songId ?? "", voiceList(starter).length));
  const mixerRef = useRef(mixer);
  const mixerChannels = useMemo(() => alignMixer(mixer, voiceList(score).length), [mixer, score.voice2, score.extraVoices]);
  mixerRef.current = mixerChannels;
  useEffect(() => { setMixer(current => alignMixer(current, voiceList(score).length)); }, [score.voice2 == null, score.extraVoices?.length]);
  useEffect(() => { saveMixer(localStorage, practiceSong, mixerChannels); }, [practiceSong, mixerChannels]);
  // Volume / mute / solo reach the sound that is already playing.
  useEffect(() => { playHandle.current?.setMixer?.(mixerChannels); }, [mixerChannels]);
  /** Another song is now open here: bring back its own practice settings. */
  function adoptSong(id: string, nextScore: Score) {
    songIdRef.current = id;
    if (id === practiceSong) return;
    const saved = loadPractice(localStorage, id);
    setPracticeSong(id);
    setMixer(loadMixer(localStorage, id, voiceList(nextScore).length));
    setTrainingActive(false);
    setTrainingCompleted(0);
    setTrainingSettings(saved.training ?? DEFAULT_TRAINING);
    setClips(saved.clips ?? []);
    setKeyboardTranspose(0);
    keyboardTranspositions.current = new WeakMap();
    setPracticeHand(saved.hand ?? "both");
    setOtherHand(saved.otherHand ?? "mute");
    setPracticeSpeed(saved.speed);
    setCountInBars(saved.countInBars);
    setLoopOn(saved.loopOn);
    setLoopRange(saved.loopRange);
    setLoopPause(saved.loopPause ?? 0);
    setLoopTimes(saved.loopTimes ?? 0);
  }
  useEffect(() => paintStaffLoop(), [loopShown?.from, loopShown?.to]);
  useEffect(() => {
    savePractice(localStorage, practiceSong, { speed: practiceSpeed, countInBars, loopOn, loopRange, training: trainingSettings, clips, hand: practiceHand === "both" ? undefined : practiceHand, otherHand: otherHand === "quiet" ? "quiet" : undefined, ...(loopPause ? { loopPause } : {}), ...(loopTimes ? { loopTimes } : {}) });
  }, [practiceSong, practiceSpeed, countInBars, loopOn, loopRange, trainingSettings, clips, practiceHand, otherHand, loopPause, loopTimes]);
  const baselineRef = useRef(JSON.stringify(starter));
  const registerRef = useRef(tonicMidi(starter.key, starter.tonicOctave));
  const aliveRef = useRef(true);
  const armSeq = useRef(0);
  const transcribeToken = useRef(0);
  const recordGate = useRef<RecordGate>(initialRecordGate());
  const jianpuComposing = useRef(false);
  const lettersComposing = useRef(false);
  const jianpuFocus = useRef(false);
  const letterFocus = useRef(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const jpwRef = useRef<HTMLInputElement>(null);
  const [importReport, setImportReport] = useState<(ImportReport & { zone: "input" | "audio" }) | null>(null);
  const xmlRef = useRef<HTMLInputElement>(null);
  const gp5Ref = useRef<HTMLInputElement>(null);
  const [gp5Preview, setGp5Preview] = useState<Gp5Preview | null>(null);
  const gp5Request = useRef(0);
  const recordStop = useRef<(() => void) | null>(null);
  const recordAbort = useRef<(() => void) | null>(null);
  const staffGen = useRef(initialStaffGeneration());
  const staffWaiters = useRef<Array<() => void>>([]);
  const draftNotes = useMemo(() => detected ? quantizeDetected(detected, draftBpm, grid) : [], [detected, draftBpm, grid]);
  const draftKey = useMemo(() => guessKey(draftNotes), [draftNotes]);
  const polyDraft = useMemo(() => {
    if (!polyTake) return null;
    try {
      let pulse = polyTake.pulse;
      if (polyMeter !== "auto") {
        const [beats, unit] = polyMeter.split("/").map(Number);
        const heard = cleanPolyNotes(polyTake.notes).notes;
        pulse = regroupPulse(heard.length ? heard : polyTake.notes, pulse, { beats, beatUnit: unit === 8 ? 8 : 4 });
      }
      pulse = scalePulse(pulse, polyTempo);
      return buildPolyDraft(polyTake.notes, scoreRef.current, {
        bpm: pulse.bpm,
        pulse,
        layout: polyLayout,
        split: polySplit,
        grid: polyGrid,
        keepOvertones: polyKeepOvertones,
        clippedSeconds: polyTake.clippedSeconds,
      });
    } catch (err) {
      return err instanceof Error ? err.message : "多音草稿生成失败";
    }
    // scoreRef is read for meter and the untouched voice only.
  }, [polyTake, polyTempo, polyMeter, polyLayout, polySplit, polyGrid, polyKeepOvertones]);
  const polyDraftRef = useRef(polyDraft);
  polyDraftRef.current = polyDraft;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const activeVoiceRef = useRef<VoiceId>(0);
  activeVoiceRef.current = activeVoice;
  const stackRef = useRef(false);
  stackRef.current = stackChord;
  const chordAnchorRef = useRef<number | null>(null);
  const hitsRef = useRef<StaffHit[]>([]);
  const anchorRef = useRef<number | null>(null);
  const tunesRef = useRef<EngravedTune[]>([]);
  const staffGradualsRef = useRef<StaffGradualChars[]>([]);
  const pickRef = useRef<(index: number, extend: boolean, voice?: VoiceId) => void>(() => {});
  const placeRef = useRef<(cursor: number, voice: VoiceId) => void>(() => {});
  const selectionOwnerRef = useRef<SelectionOwner | null>(null);
  const rangeUnmarkedRef = useRef(false);

  const instrumentInfo = instrumentOf(instrument);
  const rangeHits = useMemo(
    () => [
      ...voiceList(score).flatMap((notes, voice) => outOfRangePitches(notes, instrument, voice)),
    ],
    [score.notes, score.voice2, score.extraVoices, instrument],
  );
  const rangeSpan = writtenRangeOf(instrument);
  const rangeCount = rangePitchCount(rangeHits);
  const rangeText = rangeSpan
    ? rangeNotice(rangeCount, instrumentInfo.label, rangeSpan.label)
    : null;
  const rangeLine = rangeText && !markRange ? `${rangeText}谱上暂不标红。` : rangeText;
  const rangePaintRef = useRef<RangePaint>({
    hits: rangeHits,
    mark: markRange,
    notes: score.notes,
    voices: voiceList(score),
    instrument,
    key: score.key,
    mode: score.mode,
    changes: score.changes,
  });
  rangePaintRef.current = {
    hits: rangeHits,
    mark: markRange,
    notes: score.notes,
    voices: voiceList(score),
    instrument,
    key: score.key,
    mode: score.mode,
    changes: score.changes,
  };
  const viewScore = useMemo(() => (scoreView === "lead" ? leadSheetScore(score) : score), [score, scoreView]);
  // 五线谱刻途中记号（r40）：同位置的记号合并、加刻延长与渐变，见 staff-marks.ts。
  const engraved = useMemo(() => {
    const marked = staffMarksScore(viewScore);
    return markStaffAbc(
      engraveAbc(marked, instrumentInfo.shift, { leadSheet: scoreView === "lead", fingering: showFingering, bars: abcBarText(viewScore) }),
      marked,
      { leadSheet: scoreView === "lead" },
    );
  }, [viewScore, instrumentInfo.shift, scoreView, showFingering]);
  const staffShown = useMemo(() => {
    if (chordDisplayScore === score) return engraved;
    const shown = staffMarksScore(scoreView === "lead" ? leadSheetScore(chordDisplayScore) : chordDisplayScore);
    return markStaffAbc(
      engraveAbc(shown, instrumentInfo.shift, { leadSheet: scoreView === "lead", fingering: showFingering, bars: abcBarText(chordDisplayScore) }),
      shown,
      { leadSheet: scoreView === "lead" },
    );
  }, [chordDisplayScore, score, engraved, scoreView, instrumentInfo.shift, showFingering]);
  const abc = staffShown.abc;
  staffGradualsRef.current = staffShown.graduals;
  hitsRef.current = engraved.hits;
  const staffJianpu = useMemo(() => {
    const written = instrumentInfo.shift ? transposeScore(score, instrumentInfo.shift) : score;
    return staffJianpuText(written);
  }, [instrumentInfo.shift, score]);
  const caption = staffCaption(score, instrumentInfo.shift);
  const layoutView: LayoutView = {
    key: score.key,
    mode: score.mode,
    clef: score.clef,
    tonicOctave: score.tonicOctave,
    shift: instrumentInfo.shift,
  };
  const layoutToken = `${layoutView.key}|${layoutView.mode}|${layoutView.clef}|${layoutView.tonicOctave}|${layoutView.shift}`;
  const writtenHint =
    instrumentInfo.shift !== 0
      ? `谱面按${instrumentInfo.label}记谱（${instrumentInfo.hint}）。播放仍是实际音高。`
      : "";
  const followHint =
    instrumentInfo.shift !== 0 && staffJianpu !== staffJianpuText(score)
      ? "这行跟着谱面走。下面的输入框仍是实际音高。"
      : "";
  const keyLine = keyTitle(score.key, score.mode);
  const faceRef = useRef({
    caption,
    hint: writtenHint,
    jianpu: staffJianpu,
    follow: followHint,
    keyLine,
  });
  const layoutRef = useRef<LayoutView | null>(null);
  const liveRef = useRef<HTMLDivElement>(null);
  const ghostRef = useRef<HTMLDivElement>(null);
  const printHostRef = useRef<HTMLDivElement>(null);
  const printGen = useRef(createPrintReadiness());
  const [printStatus, setPrintStatus] = useState<PrintStatus>("pending");
  const [chosenExportView, setChosenExportView] = useState<ExportView | null>(null);
  const outputView = exportView(scoreView === "staff" || scoreView === "roll" ? "staff" : scoreView === "tab" ? "tab" : "jianpu", chosenExportView);
  const printScore = chosenExportView == null && scoreView === "lead" ? viewScore : score;
  const printEngraved = useMemo(
    () => {
      if (printScore === viewScore) return engraved;
      const marked = staffMarksScore(printScore);
      return markStaffAbc(engraveAbc(marked, instrumentInfo.shift, { fingering: showFingering, bars: abcBarText(printScore) }), marked);
    },
    [printScore, viewScore, engraved, instrumentInfo.shift, showFingering],
  );
  const printInput = useMemo(
    () => ({
      outputView,
      abc: printEngraved.abc,
      caption,
      hits: printEngraved.hits,
      graduals: printEngraved.graduals,
      instrument,
      markRange,
      printSettings,
      rangeHits,
      rangeText,
      score: printScore,
      tabTuning,
      tabPosition,
    }),
    [
      outputView,
      printEngraved.abc,
      printEngraved.hits,
      printEngraved.graduals,
      caption,
      instrument,
      markRange,
      printSettings,
      rangeHits,
      rangeText,
      printScore,
      tabTuning,
      tabPosition,
    ],
  );
  useLayoutEffect(() => {
    printGen.current.select(printInput);
    setPrintStatus("pending");
    return () => printGen.current.select(null);
  }, [printInput]);

  const buildPrintSheet = async (current: () => boolean) => {
    try {
      const { renderAbc } = await import("abcjs");
      if (!current()) return;
      const host = printHostRef.current;
      if (!host) throw new Error("Print host unavailable");
      if (printInput.outputView === "jianpu") {
        drawJianpuPrint(host, printInput.score, printInput.printSettings, instrumentOf(printInput.instrument).shift, printInput.caption);
        return;
      }
      if (printInput.outputView === "tab") {
        drawTabPrint(host, printInput.score, printInput.printSettings, printInput.tabTuning, printInput.caption, printInput.tabPosition);
        return;
      }
      drawPrintedScore(host, renderAbc as PrintAbcRender, {
        abc: printInput.abc,
        hits: printInput.hits,
        range: {
          hits: printInput.rangeHits,
          mark: printInput.markRange,
          notes: printInput.score.notes,
          voices: voiceList(printInput.score),
          instrument: printInput.instrument,
          key: printInput.score.key,
          mode: printInput.score.mode,
        },
        title: printInput.score.title,
        caption: printInput.caption,
        rangeLine: printInput.markRange ? printInput.rangeText : null,
        settings: printInput.printSettings,
        decorate: (svg, tunes) => {
          dropDoubledKeySignatures(svg);
          drawStaffGraduals(svg, tunes as EngravedTune[], printInput.graduals);
        },
      });
    } catch (error) {
      if (current() && printHostRef.current) {
        printHostRef.current.replaceChildren();
        printHostRef.current.dataset.pages = "0";
      }
      throw error;
    }
  };
  const [settledToken, setSettledToken] = useState(layoutToken);
  const [motionEpoch, setMotionEpoch] = useState(0);
  if (settledToken === layoutToken) {
    faceRef.current = {
      caption,
      hint: writtenHint,
      jianpu: staffJianpu,
      follow: followHint,
      keyLine,
    };
  }
  const barIssues = useMemo(() => checkScoreBars(score), [score.notes, score.voice2, score.extraVoices, score.beats, score.beatUnit]);
  const face = faceRef.current;

  function showSounding(slots: FollowSlot[]) {
    const prev = soundingRef.current;
    if (
      Array.isArray(prev) &&
      prev.length === slots.length &&
      prev.every(
        (slot, index) => slot.voice === slots[index]?.voice && slot.note === slots[index]?.note,
      )
    ) {
      return;
    }
    soundingRef.current = slots;
    paintStaff(
      tunesRef.current,
      hitsRef.current,
      selectedRef.current,
      null,
      rangePaintRef.current,
      rangeUnmarkedRef,
      setRangeUnmarked,
      activeVoiceRef.current,
      slots,
    );
    setSounding(slots);
  }

  function onPlayFrame(frame: { ratio: number; note: number | null; slots?: FollowSlot[]; countIn?: number; position?: number; pass?: number; rest?: number }) {
    if (frame.position != null) playPositionRef.current = frame.position;
    const looping = frame.pass != null && frame.ratio < 1 && practiceRef.current.loopOn;
    const pass = looping ? (frame.pass ?? 0) + (frame.rest ? 0 : 1) : 0;
    const rest = looping && frame.rest ? Math.ceil(frame.rest - 1e-6) : 0;
    setLoopNow((old) => (!looping ? null : old && old.pass === pass && old.rest === rest ? old : { pass, rest }));
    setProgress(frame.ratio);
    setPlayhead(frame.ratio >= 1 ? null : (frame.position ?? null));
    showSounding(frame.slots ?? []);
    setCountdown(frame.countIn ?? 0);
    // Karaoke keeps the last sung syllable lit through rests and staccato gaps.
    for (const slot of frame.slots ?? []) {
      if (!voiceNotes(scoreRef.current, slot.voice)[slot.note]?.lyric?.text) continue;
      setKaraokeNote((prev) => (prev?.voice === slot.voice && prev.note === slot.note ? prev : { voice: slot.voice, note: slot.note }));
      break;
    }
    if (frame.ratio >= 1) {
      const loopDone = practiceRef.current;
      if (frame.pass != null && loopDone.loopOn && loopDone.loopTimes && !trainingRef.current.active) setNotice(`已循环练完 ${loopDone.loopTimes} 遍。`);
      setPlaying(false);
      stopRef.current = null;
      playHandle.current = null;
    }
  }

  function halt() {
    waitStop.current?.();
    const stop = stopRef.current;
    if (!stop) return;
    stopRef.current = null;
    playHandle.current = null;
    stop();
    setPlaying(false);
    setProgress(0);
    setPlayhead(null);
    setCountdown(0);
    setKaraokeNote(null);
    showSounding([]);
  }

  function shownVoice(score: Score): VoiceId {
    return activeVoiceRef.current >= voiceList(score).length ? 0 : activeVoiceRef.current;
  }

  function refreshVoiceText(score: Score, voice: VoiceId) {
    const view = voiceView(score, voice);
    if (!jianpuFocus.current) setJianpu(formatJianpu(view));
    if (!letterFocus.current) setLetters(formatLetters(view));
  }

  function switchVoice(voice: VoiceId) {
    if (!isVoiceId(voice) || voice >= voiceList(scoreRef.current).length) return;
    if (voice === activeVoiceRef.current) return;
    activeVoiceRef.current = voice;
    setActiveVoice(voice);
    selectionOwnerRef.current = null;
    setSelected([]);
    anchorRef.current = null;
    setRangeMode(false);
    refreshVoiceText(scoreRef.current, voice);
  }

  function commit(next: Score) {
    // A shared score is read-only until 「在编辑器中打开副本」.
    if (sharedRef.current && !restoringRef.current) return;
    const prev = scoreRef.current;
    // Repeat signs follow inserted / deleted notes and drop when their bars are gone.
    if (!restoringRef.current) next = fitJumps(prev, fitRepeats(prev, next));
    if (JSON.stringify(prev) !== JSON.stringify(next)) storageDeletedRef.current = false;
    if (!restoringRef.current && JSON.stringify(prev) !== JSON.stringify(next)) {
      historyRef.current = rememberHistory(historyRef.current, {
        score: prev,
        register: registerRef.current,
      });
      setCanUndo(true);
      setCanRedo(false);
    }
    if (
      prev.notes !== next.notes ||
      prev.voice2 !== next.voice2 ||
      prev.extraVoices !== next.extraVoices ||
      prev.bpm !== next.bpm ||
      prev.key !== next.key ||
      prev.beats !== next.beats ||
      prev.beatUnit !== next.beatUnit
    ) {
      halt();
    }
    if (activeVoiceRef.current >= voiceList(next).length) {
      activeVoiceRef.current = 0;
      setActiveVoice(0);
    }
    // Imports and undo can replace a long score with a shorter/empty one.
    // Drop stale selections before the next render asks for their bar position.
    const noteCount = voiceNotes(next, activeVoiceRef.current).length;
    setSelected((current) => current.every((index) => index < noteCount)
      ? current : current.filter((index) => index < noteCount));
    if (anchorRef.current != null && anchorRef.current >= noteCount) anchorRef.current = null;
    const offsets = keyboardTranspositions.current;
    if (!offsets.has(prev)) offsets.set(prev, 0);
    if (!offsets.has(next)) offsets.set(next, restoringRef.current ? 0 : offsets.get(prev) ?? 0);
    setKeyboardTranspose(offsets.get(next) ?? 0);
    scoreRef.current = next;
    setScore(next);
  }

  function publish(
    next: Score,
    source: InputSource,
    options?: { keepRegister?: boolean; keepChordAnchor?: boolean },
  ) {
    if (sharedRef.current && !restoringRef.current) return;
    if (!options?.keepChordAnchor) chordAnchorRef.current = null;
    const prevTonic = tonicMidi(scoreRef.current.key, scoreRef.current.tonicOctave);
    commit(next);
    if (!options?.keepRegister) {
      const nextTonic = tonicMidi(next.key, next.tonicOctave);
      if (nextTonic !== prevTonic) registerRef.current = nextTonic;
    }
    const voice = shownVoice(next);
    if (source !== "jianpu" && !jianpuFocus.current)
      setJianpu(formatJianpu(voiceView(next, voice)));
    if (source !== "letters" && !letterFocus.current)
      setLetters(formatLetters(voiceView(next, voice)));
    if (source === "other") setError(null);
    setStyleNotice(null);
    setStylePreview(null);
    setSimplifyPreview(null);
  }

  /** Arrangement is previewed first: nothing changes until「应用」. */
  function previewStyle(style: ArrangeStyle) {
    const voice = activeVoiceRef.current;
    const before = voiceNotes(scoreRef.current, voice);
    const next = arrangeScore(scoreRef.current, style, voice);
    setError(null);
    halt();
    if (next === scoreRef.current) {
      setStylePreview(null);
      setStyleNotice(
        `没有适合改的地方，${voiceNameOf(voice)}保持原样。改编只动落在拍点上、时值是整拍、属于本调音阶的单音；和弦、休止和变化音不动。`,
      );
      return;
    }
    const after = voiceNotes(next, voice);
    const lost = before.filter((note) => note.lyric?.text).length - after.filter((note) => note.lyric?.text).length;
    setStyleNotice(null);
    setStylePreview({ style, score: next, base: scoreRef.current, voice, from: before.length, to: after.length, lost: Math.max(0, lost) });
  }

  /** Play the 多音 draft as it would be written; the score is not touched. */
  function auditionPoly() {
    const draft = polyDraftRef.current;
    if (!draft || typeof draft === "string") return;
    if (stopRef.current) {
      halt();
      return;
    }
    setPlaying(true);
    playKindRef.current = "preview";
    const handle = playScore(draft.score, (frame) => {
      setProgress(frame.ratio);
      if (frame.ratio >= 1) {
        setPlaying(false);
        stopRef.current = null;
        playHandle.current = null;
      }
    }, { clickGain: 0, mixer: mixerRef.current });
    playHandle.current = handle;
    stopRef.current = handle.stop;
  }

  function auditionStyle() {
    const preview = stylePreviewRef.current;
    if (!preview) return;
    if (stopRef.current) {
      halt();
      return;
    }
    setPlaying(true);
    playKindRef.current = "preview";
    const handle = playScore(preview.score, (frame) => {
      setProgress(frame.ratio);
      if (frame.ratio >= 1) {
        setPlaying(false);
        stopRef.current = null;
        playHandle.current = null;
      }
    }, { clickGain: metroRef.current.on ? metroRef.current.volume : 0, mixer: mixerRef.current });
    playHandle.current = handle;
    stopRef.current = handle.stop;
  }

  function auditionSight(preview: Score) {
    if (stopRef.current && playKindRef.current === "preview") {
      halt();
      return;
    }
    if (stopRef.current) halt();
    setPlaying(true);
    playKindRef.current = "preview";
    const handle = playScore(preview, (frame) => {
      setProgress(frame.ratio);
      if (frame.ratio >= 1) {
        setPlaying(false);
        stopRef.current = null;
        playHandle.current = null;
      }
    }, { clickGain: 0, mixer: mixerRef.current, swing: SWING_RATIO[swingRef.current] });
    playHandle.current = handle;
    stopRef.current = handle.stop;
  }

  function applySight(notes: ScoreNote[]) {
    halt();
    const voice = activeVoiceRef.current;
    publish(replaceVoiceAndRemap(scoreRef.current, voice, notes), "other");
    setNotice(`${voiceNameOf(voice)}已写入视奏练习，可撤销。`);
  }

  function applyStyle() {
    const preview = stylePreviewRef.current;
    if (!preview) return;
    halt();
    // A stale preview (score edited meanwhile) is recomputed rather than overwriting the edit.
    const next = preview.base === scoreRef.current ? preview.score : arrangeScore(scoreRef.current, preview.style, preview.voice);
    setStylePreview(null);
    if (next === scoreRef.current) return;
    const dropped = lyricsDropped(voiceNotes(scoreRef.current, preview.voice), voiceNotes(next, preview.voice));
    publish(next, "other");
    setStyleNotice(`${voiceNameOf(preview.voice)}${STYLE_DONE[preview.style]}` + (dropped ? LYRIC_ARRANGED : ""));
  }

  function previewSimplify(level: SimplifyLevel) {
    const next = simplifyScore(scoreRef.current, level);
    setError(null);
    halt();
    setStylePreview(null);
    if (next === scoreRef.current) {
      setSimplifyPreview(null);
      setStyleNotice("没有需要简化的地方，谱面保持原样。");
      return;
    }
    setStyleNotice(null);
    setSimplifyPreview({ level, score: next, base: scoreRef.current });
  }
  function auditionSimplify() {
    const preview = simplifyPreviewRef.current;
    if (!preview) return;
    if (stopRef.current) {
      halt();
      return;
    }
    setPlaying(true);
    playKindRef.current = "preview";
    const handle = playScore(preview.score, (frame) => {
      setProgress(frame.ratio);
      if (frame.ratio >= 1) {
        setPlaying(false);
        stopRef.current = null;
        playHandle.current = null;
      }
    }, { clickGain: metroRef.current.on ? metroRef.current.volume : 0, mixer: mixerRef.current });
    playHandle.current = handle;
    stopRef.current = handle.stop;
  }
  function applySimplify() {
    const preview = simplifyPreviewRef.current;
    if (!preview) return;
    halt();
    const next = preview.base === scoreRef.current ? preview.score : simplifyScore(scoreRef.current, preview.level);
    setSimplifyPreview(null);
    if (next === scoreRef.current) return;
    publish(next, "other");
    setStyleNotice("已降低难度，可撤销回到原谱。");
  }
  function generateFingering() {
    const next = suggestFingering(scoreRef.current);
    setShowFingering(true);
    if (next === scoreRef.current || JSON.stringify(next) === JSON.stringify(scoreRef.current)) {
      setNotice("没有可以标注的音。");
      return;
    }
    commit(next);
    setNotice("已加上钢琴指法，可撤销，也可再手改。");
  }
  function clearFingeringMarks() {
    const next = clearFingering(scoreRef.current);
    if (JSON.stringify(next) === JSON.stringify(scoreRef.current)) return;
    commit(next);
    setNotice("已清除指法。");
  }
  function setNoteFinger(index: number, pitchIndex: number, finger: number) {
    const voice = shownVoice(scoreRef.current);
    const notes = voiceNotes(scoreRef.current, voice).map((note, at) => {
      if (at !== index) return note;
      const fingers = note.pitches.map((_, i) => note.fingers?.[i] ?? 0);
      fingers[pitchIndex] = finger;
      return { ...note, fingers };
    });
    commit(replaceVoice(scoreRef.current, voice, notes));
  }

  /** Roll this song's single archive entry forward; untouched examples stay out. */
  function archiveSong(value: Score, pinned = false): boolean {
    if (sharedRef.current && !pinned) return true;
    const id = songIdRef.current;
    try {
      const existing = readDrafts(localStorage, isScore).some((draft) => draft.id === id);
      if (!pinned && !existing && JSON.stringify(value) === baselineRef.current) return true;
      const next = upsertScore(localStorage, { id, value, pinned });
      setDrafts(next);
      if (!next.some((draft) => draft.id === id)) {
        setNotice("手动保存的曲子已满 20 首，这首没能自动存进「我的曲子」。删掉几首或点「保存当前草稿」。");
      }
      return true;
    } catch {
      setNotice("本机草稿保存失败，可能空间不足或浏览器禁止存储。请导出文件备份。");
      return false;
    }
  }

  function saveDraft(value: Score) {
    storageDeletedRef.current = false;
    if (archiveSong(value, true)) {
      setError(null);
      setNotice(`已保存「${value.title.trim() || "未命名乐谱"}」到「我的曲子」。`);
    }
  }

  function travel(direction: "undo" | "redo") {
    const result = travelHistory(
      historyRef.current,
      { score: scoreRef.current, register: registerRef.current },
      direction,
    );
    if (!result) return;
    historyRef.current = result.history;
    restoringRef.current = true;
    registerRef.current = result.value.register;
    publish(result.value.score, "other", { keepRegister: true });
    restoringRef.current = false;
    setCanUndo(result.history.past.length > 0);
    setCanRedo(result.history.future.length > 0);
  }
  function undo() {
    // The loss list described the import being undone.
    setImportReport(null);
    travel("undo");
  }
  function redo() {
    travel("redo");
  }

  /** Open another archived song here; the current one is flushed to its own entry first. */
  function restoreDraft(draft: Draft<Score>) {
    halt();
    persistScore();
    adoptSong(draft.id, draft.value);
    const value = cleanScore(draft.value);
    baselineRef.current = JSON.stringify(value);
    storageDeletedRef.current = false;
    restoringRef.current = true;
    publish(value, "other");
    restoringRef.current = false;
    historyRef.current = emptyHistory();
    setCanUndo(false);
    setCanRedo(false);
    setNotice(`已打开「${value.title.trim() || "未命名乐谱"}」，刚才的曲子已自动保存。`);
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.closest("dialog, input, textarea, select, [contenteditable=true]") ||
          target.isContentEditable)
      )
        return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z" && !event.altKey) {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  useEffect(() => {
    try { readSetlists(localStorage, readDrafts(localStorage, isScore).map(song => song.id)); } catch { /* storage unavailable */ }
  }, [drafts]);
  const performanceList = useMemo(() => {
    if (!setlistId) return undefined;
    const saved = readDrafts(localStorage, isScore);
    return readSetlists(localStorage, saved.map(song => song.id)).find(list => list.id === setlistId);
  }, [setlistId, practiceSong, drafts]);

  /** Taps on the sticky chord guide open it / use its controls; only the notes turn pages in full screen. */
  const onGuide = (event: { target: EventTarget | null }) => event.target instanceof Element && event.target.closest(".chord-guide") !== null;

  function turnPerformance(direction: -1 | 1) {
    const stage = paperRef.current;
    if (!stage) return;
    const result = pageTurn(stage.scrollTop, stage.clientHeight, stage.scrollHeight - stage.clientHeight, direction, stickyCover(stage));
    setAutoScrolling(false);
    if (result.atEnd && setlistId) {
      const saved = readDrafts(localStorage, isScore);
      const list = readSetlists(localStorage, saved.map(song => song.id)).find(list => list.id === setlistId);
      const next = list && nextSetlistSong(list, songIdRef.current);
      const song = saved.find(song => song.id === next);
      if (song) { restoreDraft(song); return; }
      setNotice("已到歌单末尾。");
    }
    stage.scrollTo({ top: result.top, behavior: "auto" });
  }
  useLayoutEffect(() => { paperRef.current?.scrollTo({ top: 0, behavior: "auto" }); }, [practiceSong]);
  useEffect(() => {
    if (!fullScore) { setAutoScrolling(false); return; }
    function keys(event: KeyboardEvent) {
      if ((event.target as HTMLElement)?.closest?.("dialog, input, textarea, select, [contenteditable=true]") || event.altKey || event.ctrlKey || event.metaKey) return;
      const direction = ["ArrowRight", "PageDown"].includes(event.key) || (event.key === " " && !playing) ? 1
        : ["ArrowLeft", "PageUp"].includes(event.key) ? -1 : 0;
      if (!direction) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      turnPerformance(direction);
    }
    window.addEventListener("keydown", keys, true);
    return () => window.removeEventListener("keydown", keys, true);
  });
  useEffect(() => {
    if (!fullScore || !autoScrolling || playing) return;
    const total = Math.max(0, ...voiceList(score).map(notes => notes.reduce((sum, note) => sum + note.dur, 0)));
    const seconds = performanceSeconds(total, score.bpm, score.changes);
    let frame = 0, previous = 0, remainder = 0;
    function tick(now: number) {
      const stage = paperRef.current;
      if (!stage) return;
      const max = stage.scrollHeight - stage.clientHeight;
      if (previous && !document.hidden) {
        remainder += autoScrollSpeed(max, seconds, scrollPercent) * Math.min(0.1, (now - previous) / 1000);
        if (remainder >= 1) {
          const step = Math.floor(remainder);
          stage.scrollTop += step;
          remainder -= step;
        }
      }
      previous = now;
      if (stage.scrollTop >= max - 1) { setAutoScrolling(false); return; }
      frame = requestAnimationFrame(tick);
    }
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [fullScore, autoScrolling, playing, scrollPercent, score]);

  function pickNote(index: number, extend: boolean, voice: VoiceId = activeVoiceRef.current) {
    if (fullScore) return;
    if (!isVoiceId(voice) || voice >= voiceList(scoreRef.current).length) return;
    const count = voiceNotes(scoreRef.current, voice).length;
    const next = applyStaffPick(
      { voice: activeVoiceRef.current, anchor: anchorRef.current, selected: selectedRef.current },
      { index, extend, voice },
      rangeMode,
      count,
    );
    if (
      next.voice === activeVoiceRef.current &&
      next.anchor === anchorRef.current &&
      next.selected === selectedRef.current
    ) {
      return;
    }
    selectionOwnerRef.current = {
      voice: next.voice,
      shape: noteShapeOf(voiceNotes(scoreRef.current, next.voice)),
    };
    if (next.voice !== activeVoiceRef.current) {
      activeVoiceRef.current = next.voice;
      setActiveVoice(next.voice);
      refreshVoiceText(scoreRef.current, next.voice);
    }
    anchorRef.current = next.anchor;
    setSelected(next.selected);
    tapHaptic();
  }
  pickRef.current = pickNote;

  /** A tapped barline: no selection, and the tap pad inserts at the start of the next bar. */
  function placeCursor(cursor: number, voice: VoiceId) {
    if (!isVoiceId(voice) || voice >= voiceList(scoreRef.current).length) return;
    if (voice !== activeVoiceRef.current) {
      activeVoiceRef.current = voice;
      setActiveVoice(voice);
      refreshVoiceText(scoreRef.current, voice);
    }
    const notes = voiceNotes(scoreRef.current, voice);
    const at = Math.max(0, Math.min(notes.length, cursor));
    selectionOwnerRef.current = null;
    anchorRef.current = null;
    setSelected([]);
    tapShapeRef.current = noteShapeOf(notes);
    setTapCursorAt(at >= notes.length ? null : at);
    setNotice(`输入位置：${tapCursorLabel(notes, at)}（简谱键盘从这里插入）。`);
  }
  placeRef.current = placeCursor;

  function stepSelection(delta: number) {
    const count = voiceNotes(scoreRef.current, activeVoiceRef.current).length;
    if (!count) return;
    setRangeMode(false);
    anchorRef.current = null;
    setSelected((current) => {
      const origin = current[0] ?? (delta > 0 ? -1 : count);
      const next = Math.min(count - 1, Math.max(0, origin + delta));
      return [next];
    });
  }

  function mark(action: MarkAction) {
    const voice = activeVoiceRef.current;
    const currentScore = scoreRef.current;
    const current = voiceNotes(currentScore, voice);
    const nextNotes = applyMark(current, selectedRef.current, action);
    const nextScore = action.type === "clear"
      ? editFermatas(currentScore, voice, selectedRef.current, "clear")
      : currentScore;
    if (nextNotes === current && nextScore === currentScore) {
      if (!selectedRef.current.length) setMarkNotice("先点谱上的符头。");
      else if (action.type === "slur") setMarkNotice("连线要选至少两个音。");
      else if (action.type === "hairpin") setMarkNotice("渐强和渐弱要选至少两个音。");
      else if (action.type === "ornament" && action.value === "arpeggio") setMarkNotice("琶音要加在和弦上。先用「叠和弦」或简谱 [1,3,5] 做成和弦，再点琶音。");
      else if (action.type === "articulation" || action.type === "ornament") {
        setMarkNotice("这个记号要加在有音高的音上。");
      } else setMarkNotice(null);
      return;
    }
    setMarkNotice(null);
    const notes = nextNotes === current ? voiceNotes(nextScore, voice) : nextNotes;
    publish(replaceVoice(nextScore, voice, notes), "other");
    setNotice(markDoneText(action));
  }

  function markFermata() {
    const voice = activeVoiceRef.current;
    const picked = selectedRef.current;
    if (!picked.length) {
      setMarkNotice("先点谱上的符头。");
      return;
    }
    const current = scoreRef.current;
    const next = editFermatas(current, voice, picked, "toggle");
    if (next === current) return;
    setMarkNotice(null);
    const starts = noteOnsets(voiceNotes(next, voice)).starts;
    const on = picked.every((index) => starts[index] != null && hasFermata(next, voice, starts[index]!));
    publish(next, "other");
    setNotice(on ? "已加上延长记号。" : "已去掉延长记号。");
  }

  /** 选段编辑 (Sibelius-style R, ↑/↓, Ctrl+↑/↓): one undo step; the selection follows the music. */
  function editSelection(action: SelectionAction) {
    if (sharedRef.current && !restoringRef.current) return;
    const voice = activeVoiceRef.current;
    const current = scoreRef.current;
    const picked = selectedRef.current;
    if (!picked.length) {
      setMarkNotice("先点谱上的符头（要一段就点「选一段」再点首尾）。");
      return;
    }
    const notes = voiceNotes(current, voice);
    let next: Score;
    let selected = picked;
    let done: string;
    if (action === "repeat") {
      const result = repeatSelection(current, voice, picked);
      if ("error" in result) { setMarkNotice(result.error); return; }
      next = result.score;
      selected = result.selected;
      done = `已重复一遍（${result.selected.length} 个音），新的一遍已选中，可以接着按 R。`;
    } else {
      const at = notes.slice(0, Math.min(...picked)).reduce((sum, note) => sum + note.dur, 0);
      const { key, mode } = stateAt(current, at);
      const shifted = action === "rest" ? restSelection(notes, picked)
        : shiftSelection(notes, picked, key, mode, action === "up" || action === "down" ? "step" : "octave", action === "up" || action === "octaveUp" ? 1 : -1);
      if (!shifted) {
        setMarkNotice(action === "rest" ? "选中的已经是休止。" : notes.some((n, i) => picked.includes(i) && n.pitches.length) ? "再移就超出钢琴音域了。" : "选中的是休止，没有音可移。");
        return;
      }
      next = replaceVoice(current, voice, shifted);
      done = { up: "已上移一级（按调内音阶）。", down: "已下移一级（按调内音阶）。", octaveUp: "已升高八度。", octaveDown: "已降低八度。", rest: "已改成休止，节奏不变。" }[action];
    }
    setMarkNotice(null);
    selectionOwnerRef.current = { voice, shape: noteShapeOf(voiceNotes(next, voice)) };
    publish(next, "other");
    if (selected !== picked) {
      anchorRef.current = selected[0] ?? null;
      setSelected(selected);
    }
    setNotice(done);
  }
  const editSelectionRef = useRef(editSelection);
  editSelectionRef.current = editSelection;
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.closest?.("dialog, input, textarea, select, [contenteditable=true]") || target?.isContentEditable || event.altKey) return;
      if (fullScore || !selectedRef.current.length) return;
      const mod = event.ctrlKey || event.metaKey;
      const action: SelectionAction | null = !mod && !event.shiftKey && event.key.toLowerCase() === "r" ? "repeat"
        : event.key === "ArrowUp" ? (mod ? "octaveUp" : "up")
        : event.key === "ArrowDown" ? (mod ? "octaveDown" : "down")
        : null;
      if (!action) return;
      event.preventDefault();
      editSelectionRef.current(action);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullScore]);

  function lyricSame(next: ScoreNote[]): boolean {
    const current = voiceNotes(scoreRef.current, activeVoiceRef.current);
    return (
      JSON.stringify(current.map((note) => note.lyric ?? null)) ===
      JSON.stringify(next.map((note) => note.lyric ?? null))
    );
  }

  function commitLyrics(next: ScoreNote[], message: string | null) {
    if (lyricSame(next)) {
      setLyricNotice(message ?? "歌词没有变化。");
      return;
    }
    publish(replaceVoice(scoreRef.current, activeVoiceRef.current, next), "other");
    setLyricNotice(message);
    if (selectedRef.current.length === 1) {
      setLyricEntry(next[selectedRef.current[0]]?.lyric?.text ?? "");
    }
  }

  function fillLyrics() {
    const current = scoreRef.current;
    const result = assignLyrics(voiceNotes(current, activeVoiceRef.current), lyricLine, (at) => nextBar(current, at));
    commitLyrics(result.notes, result.notice ?? "已从开头填到有音高的音上。休止没有占字。");
  }

  function writeLyricAtSelection() {
    if (selectedRef.current.length !== 1) {
      setLyricNotice("请只选一个音，再写到谱上。");
      return;
    }
    const parsed = lyricFromEntry(lyricEntry);
    if (!parsed.ok) {
      setLyricNotice(
        parsed.reason === "many"
          ? "写到一个音时只放一个音节。多个字请用上面的框，从开头填入。"
          : "先写一个字，或一个拉丁音节。",
      );
      return;
    }
    const result = setNoteLyric(
      voiceNotes(scoreRef.current, activeVoiceRef.current),
      selectedRef.current[0],
      parsed.lyric,
    );
    if (!result.ok) {
      setLyricNotice(result.reason === "rest" ? "休止上不写歌词。" : "这个音不在谱上。");
      return;
    }
    commitLyrics(result.notes, `已写到第 ${selectedRef.current[0] + 1} 个音。`);
  }

  function blankLyricAtSelection() {
    if (selectedRef.current.length !== 1) {
      setLyricNotice("请只选一个音，再让它空过。");
      return;
    }
    const result = setNoteLyric(
      voiceNotes(scoreRef.current, activeVoiceRef.current),
      selectedRef.current[0],
      {
        text: "",
        syllabic: "single",
      },
    );
    if (!result.ok) {
      setLyricNotice(result.reason === "rest" ? "休止上不写歌词。" : "这个音不在谱上。");
      return;
    }
    commitLyrics(result.notes, "这个音空过，后面的字不会挤上来。");
  }

  function removeLyricAtSelection() {
    if (selectedRef.current.length !== 1) {
      setLyricNotice("请只选一个音，再去掉它的歌词。");
      return;
    }
    const result = setNoteLyric(
      voiceNotes(scoreRef.current, activeVoiceRef.current),
      selectedRef.current[0],
      null,
    );
    if (!result.ok) {
      setLyricNotice(result.reason === "rest" ? "休止上没有歌词。" : "这个音不在谱上。");
      return;
    }
    commitLyrics(result.notes, "已去掉这个音的歌词。");
  }

  function removeAllLyrics() {
    const next = clearLyrics(voiceNotes(scoreRef.current, activeVoiceRef.current));
    commitLyrics(next, "这一声部的歌词已全部去掉。另一声部的歌词还在。");
  }

  useEffect(() => {
    try {
      setDrafts(readDrafts(localStorage, isScore));
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw) as {
        score?: unknown;
        instrument?: InstrumentId;
        markRange?: unknown;
        activeVoice?: unknown;
        metronome?: { on?: unknown; volume?: unknown };
        songId?: unknown;
      };
      if (!isScore(data.score)) return;
      const previousId = typeof data.songId === "string" ? data.songId : null;
      // Keep the previous work in the archive before replacing it. Current saves
      // already rolled it into its own entry; older saves had no song id.
      if (initialScore) {
        const archived = readDrafts(localStorage, isScore);
        const known = previousId
          ? archived.some((draft) => draft.id === previousId)
          : archived.some((draft) => JSON.stringify(draft.value) === JSON.stringify(data.score));
        if (!known && !previousId) {
          setDrafts(upsertScore(localStorage, { id: newDraftId(), value: data.score as Score }));
        }
        return;
      }
      if (previousId) adoptSong(previousId, data.score as Score);
      try {
        const cleaned = cleanScore(data.score);
        if (!isScore(cleaned)) throw new Error("invalid cleaned score");
        baselineRef.current = JSON.stringify(cleaned);
        if (isVoiceId(data.activeVoice) && data.activeVoice < voiceList(cleaned).length) {
          activeVoiceRef.current = data.activeVoice;
          setActiveVoice(data.activeVoice);
        }
        restoringRef.current = true;
        publish(cleaned, "other");
        restoringRef.current = false;
      } catch {
        restoringRef.current = false;
        setNotice("上次草稿打不开，已为你打开空白谱。原内容若还在「我的曲子」里，可以再打开。");
        const blank = createBlankScore();
        baselineRef.current = JSON.stringify(blank);
        publish(blank, "other");
      }
      if (data.instrument && INSTRUMENTS.some((item) => item.id === data.instrument)) {
        setInstrument(data.instrument);
      }
      if (typeof data.markRange === "boolean") setMarkRange(data.markRange);
      if (typeof data.metronome?.on === "boolean") setMetronome(data.metronome.on);
      if (typeof data.metronome?.volume === "number" && Number.isFinite(data.metronome.volume)) {
        setMetronomeVolume(Math.min(1, Math.max(0, data.metronome.volume)));
      }
    } catch {
      /* ignore broken local data */
    }
    // Restore once only for the explicit “continue draft” entry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function persistScore(): boolean {
    if (sharedRef.current) return true;
    if (storageDeletedRef.current) return true;
    if (lazyExamplePendingRef.current) return true;
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          score: scoreRef.current,
          songId: songIdRef.current,
          instrument,
          markRange,
          activeVoice,
          metronome: { on: metronome, volume: metronomeVolume },
        }),
      );
      archiveSong(scoreRef.current);
      return true;
    } catch {
      setNotice("自动保存失败，请导出文件备份。");
      return false;
    }
  }

  function returnHome() {
    if (sharedRef.current) clearShareHash();
    halt();
    for (const ctx of decodingContexts.current) void ctx.close().catch(() => {});
    decodingContexts.current.clear();
    armSeq.current += 1;
    transcribeToken.current += 1;
    recordAbort.current?.();
    // Flush the debounce before unmounting so the latest edit is resumable.
    onReturnHome?.(persistScore() ? undefined : scoreRef.current);
  }

  useEffect(() => {
    const timer = window.setTimeout(persistScore, 400);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [score, instrument, markRange, metronome, metronomeVolume, activeVoice]);

  useEffect(() => {
    const host = paperRef.current;
    if (!host) return;
    const observer = new ResizeObserver(() => setWidth(host.clientWidth));
    observer.observe(host);
    setWidth(host.clientWidth);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const host = staffRef.current;
    const stage = paperRef.current;
    const live = liveRef.current;
    const ghost = ghostRef.current;
    if (!host || !stage || !live || !ghost) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const previous = layoutRef.current;
    const motion = scoreLayoutMotion(previous, layoutView, reduced);
    const keyChanged =
      previous !== null && (previous.key !== layoutView.key || previous.mode !== layoutView.mode);
    layoutRef.current = layoutView;
    staffGen.current = beginStaffRender(staffGen.current);
    const generation = staffGen.current.requested;
    let cancelled = false;
    let finish = () => {};
    let detachPointer = () => {};
    const wakeStaff = () => {
      const pending = staffWaiters.current.splice(0);
      pending.forEach((wake) => wake());
    };
    void (async () => {
      const { renderAbc } = await import("abcjs");
      if (cancelled || generation !== staffGen.current.requested || !staffRef.current) return;
      // Zoom reflows fewer bars per line; the SVG still fills the stage width.
      const staffWidth = Math.max(200, staffRef.current.clientWidth / zoomRef.current);
      const reveal = motion.animate;
      const onEnd = (event: AnimationEvent) => {
        if (event.target !== ghost) return;
        ghost.removeEventListener("animationend", onEnd);
        finish();
      };
      const release = () => {
        ghost.removeEventListener("animationend", onEnd);
        if (generation !== staffGen.current.requested) return;
        ghost.classList.remove("is-leaving");
        ghost.replaceChildren();
        ghost.hidden = true;
        stage.classList.remove("is-arriving");
        stage.style.height = "";
        stage.style.transition = "";
      };
      if (reveal) {
        if (!ghost.childElementCount && staffRef.current) {
          ghost.replaceChildren(staffRef.current.cloneNode(true));
        }
        ghost.hidden = false;
        ghost.classList.remove("is-leaving");
        stage.classList.remove("is-arriving");
        stage.style.setProperty("--score-nudge", `${motion.nudge}px`);
        stage.style.transition = "none";
        stage.style.height = `${Math.max(stage.offsetHeight, live.offsetHeight)}px`;
      }
      try {
        const rendered = renderAbc(staffRef.current, abc, {
          add_classes: true,
          clickListener: (elem, _tuneNumber, _classes, _analysis, _drag, event?: Event) => {
            if (staffPointer.moved) return;
            if (elem.startChar == null || elem.endChar == null) return;
            const target = staffTargetAt(hitsRef.current, elem.startChar, elem.endChar);
            if (!target) return;
            const mouse = event as MouseEvent | undefined;
            pickRef.current(
              target.index,
              Boolean(mouse?.shiftKey || mouse?.metaKey) || isLongPress(staffPointer.at),
              target.voice,
            );
          },
          foregroundColor: "#1c1916",
          paddingbottom:
            allVoiceNotes(scoreRef.current).some((note) => note.lyric)
              ? 28
              : 0,
          paddingleft: 0,
          paddingright: 0,
          paddingtop: 0,
          responsive: "resize",
          staffwidth: staffWidth,
          wrap: {
            minSpacing: 1.4,
            maxSpacing: 2.4,
            preferredMeasuresPerLine: staffWidth < 640 ? 2 : 4,
          },
        });
        tunesRef.current = rendered;
        padStaffHits(staffRef.current);
        dropDoubledKeySignatures(staffRef.current.querySelector("svg"));
        drawStaffGraduals(staffRef.current.querySelector("svg"), rendered as EngravedTune[], staffGradualsRef.current);
        detachPointer();
        detachPointer = attachStaffPointer(staffRef.current);
        paintStaffLoop();
        paintStaff(
          rendered,
          hitsRef.current,
          selectedRef.current,
          null,
          rangePaintRef.current,
          rangeUnmarkedRef,
          setRangeUnmarked,
          activeVoiceRef.current,
          soundingRef.current,
        );
      } catch {
        release();
        flushSync(() => setSettledToken(layoutToken));
        if (generation === staffGen.current.requested) {
          staffGen.current = noteStaffFailed(staffGen.current, generation);
          wakeStaff();
        }
        return;
      }
      if (cancelled || generation !== staffGen.current.requested) return;
      staffGen.current = noteStaffRendered(staffGen.current, generation);
      wakeStaff();
      const drawnHeight = live.offsetHeight;
      if (!reveal) {
        flushSync(() => setSettledToken(layoutToken));
        release();
        return;
      }
      finish = release;
      requestAnimationFrame(() => {
        if (cancelled || generation !== staffGen.current.requested) return;
        flushSync(() => {
          setSettledToken(layoutToken);
          if (keyChanged) setMotionEpoch((epoch) => epoch + 1);
        });
        const target = Math.max(drawnHeight, live.offsetHeight);
        stage.style.transition = "height 280ms cubic-bezier(0.22, 1, 0.36, 1)";
        stage.style.height = `${target}px`;
        void stage.offsetWidth;
        stage.classList.add("is-arriving");
        ghost.classList.add("is-leaving");
      });
      ghost.addEventListener("animationend", onEnd);
      window.setTimeout(finish, 360);
    })();
    return () => {
      cancelled = true;
      finish();
      detachPointer();
    };
    // layoutView is read with layoutToken; listing the object would redraw every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abc, width, layoutToken, zoom, recognitionDraft, scorePaint]);

  useEffect(() => {
    void printGen.current.prepare(printInput, buildPrintSheet, setPrintStatus);
    // The builder captures only printInput, whose identity includes every print input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [printInput]);

  useEffect(() => {
    paintStaff(
      tunesRef.current,
      hitsRef.current,
      selected,
      null,
      rangePaintRef.current,
      rangeUnmarkedRef,
      setRangeUnmarked,
      activeVoice,
      soundingRef.current,
    );
  }, [selected, rangeHits, markRange, instrument, score.key, score.mode, activeVoice]);

  useEffect(() => {
    playHandle.current?.setClickGain(metronome ? metronomeVolume : 0);
  }, [metronome, metronomeVolume]);

  // Changing a practice setting mid-play: speed alone resumes at the current spot
  // without a count-in; loop / count-in changes restart from the loop (or song) start.
  const practiceKey = `${practiceSpeed}|${countInBars}|${loopOn}|${loopRange?.from}|${loopRange?.to}|${loopPause}|${loopTimes}`;
  const practiceNow: PracticeKey = { speed: practiceSpeed, countInBars, loopOn, from: loopRange?.from, to: loopRange?.to, loopPause, loopTimes };
  const practiceKeyRef = useRef(practiceNow);
  const practiceChangeRef = useRef<"none" | "resume" | "restart">("none");
  useEffect(() => {
    const change = practiceChange(practiceKeyRef.current, practiceNow);
    practiceKeyRef.current = practiceNow;
    if (change === "none" || !stopRef.current || playKindRef.current !== "score") return;
    // A pending restart wins over a later speed-only tweak in the same burst.
    if (practiceChangeRef.current !== "restart") practiceChangeRef.current = change;
    // Debounced so dragging the speed slider restarts once, after it settles.
    const timer = setTimeout(() => {
      const mode = practiceChangeRef.current;
      practiceChangeRef.current = "none";
      if (!stopRef.current || playKindRef.current !== "score") return;
      const at = mode === "resume" ? playPositionRef.current : null;
      halt();
      startPlayback(at);
    }, 300);
    return () => clearTimeout(timer);
    // startPlayback/halt read refs only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [practiceKey]);

  // Changing swing mid-play resumes at the current spot, same as a speed tweak.
  const swingFeelRef = useRef(swingFeel);
  useEffect(() => {
    const changed = swingFeelRef.current !== swingFeel;
    swingFeelRef.current = swingFeel;
    if (!changed || !stopRef.current || playKindRef.current !== "score") return;
    const timer = setTimeout(() => {
      if (!stopRef.current || playKindRef.current !== "score") return;
      const at = playPositionRef.current;
      halt();
      startPlayback(at);
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [swingFeel]);

  const compOnRef = useRef(compOn);
  useEffect(() => {
    const changed = compOnRef.current !== compOn;
    compOnRef.current = compOn;
    if (!changed || !stopRef.current || playKindRef.current !== "score") return;
    const timer = setTimeout(() => {
      if (!stopRef.current || playKindRef.current !== "score") return;
      const at = playPositionRef.current;
      halt();
      startPlayback(at);
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compOn]);

  const selectedIndex = selected.length === 1 ? selected[0] : -1;
  useEffect(() => {
    if (selectedIndex < 0) return;
    setLyricEntry(voiceNotes(scoreRef.current, activeVoice)[selectedIndex]?.lyric?.text ?? "");
  }, [selectedIndex, activeVoice]);

  const editingNotes = voiceNotes(score, activeVoice);
  const noteShape = noteShapeOf(editingNotes);
  useEffect(() => {
    if (tapShapeRef.current === noteShape) return;
    tapShapeRef.current = null;
    setTapCursorAt(null);
  }, [noteShape, activeVoice]);
  useEffect(() => {
    if (selectionSurvivesEdit(selectionOwnerRef.current, activeVoice, noteShape)) return;
    selectionOwnerRef.current = null;
    anchorRef.current = null;
    setSelected([]);
  }, [noteShape, activeVoice]);

  const releaseForegroundRef = useRef<() => void>(() => {});
  releaseForegroundRef.current = () => {
    const playing = stopRef.current != null || waitStop.current != null;
    const recording = recordAbort.current != null;
    if (!playing && !recording) return;
    if (playing) halt();
    recordAbort.current?.();
    setError(null);
    setNotice(FOREGROUND_RELEASE_NOTICE);
  };

  useEffect(() => {
    aliveRef.current = true;
    const onVisibility = () => {
      if (!shouldReleaseForegroundAudio(document.visibilityState, window.location.protocol)) return;
      releaseForegroundRef.current();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      aliveRef.current = false;
      polyCancel.current?.();
      polyCancel.current = null;
      const preview = previewCtxRef.current;
      previewCtxRef.current = null;
      if (preview) {
        clearTimeout(preview.timer);
        void preview.ctx.close().catch(() => {});
      }
      for (const ctx of decodingContexts.current) void ctx.close().catch(() => {});
      decodingContexts.current.clear();
      armSeq.current += 1;
      transcribeToken.current += 1;
      recordGate.current = initialRecordGate();
      const stopPlayback = stopRef.current;
      stopRef.current = null;
      playHandle.current = null;
      stopPlayback?.();
      const stop = recordAbort.current;
      recordStop.current = null;
      recordAbort.current = null;
      stop?.();
    };
  }, []);

  /**
   * Snapshot taken when a 唱名/音名 text edit begins. Every keystroke carries lyrics and
   * chord marks from it, so a half-typed line cannot strip them. Any other change to the
   * score (undo, tap pad, import) starts a fresh snapshot.
   */
  const textEditRef = useRef<{ base: Score; voice: VoiceId; last: Score } | null>(null);

  function textEditBase(voice: VoiceId): Score {
    const held = textEditRef.current;
    if (held && held.voice === voice && held.last === scoreRef.current) return held.base;
    textEditRef.current = { base: scoreRef.current, voice, last: scoreRef.current };
    return scoreRef.current;
  }

  function textEditSeen() {
    if (textEditRef.current) textEditRef.current.last = scoreRef.current;
  }

  function onJianpu(value: string) {
    setJianpu(value);
    if (jianpuComposing.current) return;
    try {
      const voice = activeVoiceRef.current;
      const result = applyJianpuText(scoreRef.current, value, voice, instrumentInfo.shift, textEditBase(voice));
      if (result.error) {
        setError(result.error);
        return;
      }
      setError(null);
      publish(result.score, "jianpu");
      textEditSeen();
      const parts = [result.lyricNotice ?? "", result.chordNotice ?? ""].filter(Boolean);
      setNotice(parts.length ? parts.join("") : null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "唱名没能写进谱面。");
    }
  }

  function onLetters(value: string) {
    setLetters(value);
    if (lettersComposing.current) return;
    const parsed = parseLetters(value);
    if (parsed.error) {
      setError(parsed.error);
      return;
    }
    setError(null);
    const voice = activeVoiceRef.current;
    const base = textEditBase(voice);
    const midis = parsed.notes.flatMap((note) => note.pitches);
    const result = rewriteVoice(
      base,
      { tonicOctave: midis.length ? inferTonicOctave(midis, base.key) : base.tonicOctave },
      voice,
      parsed.notes,
    );
    publish(result.score, "letters");
    textEditSeen();
    const parts = [result.lyricNotice ?? "", result.chordNotice ?? ""].filter(Boolean);
    setNotice(parts.length ? parts.join("") : null);
  }

  function nudge(semitones: number) {
    if (!canTranspose(allVoiceNotes(scoreRef.current), semitones)) {
      setError(null);
      setNotice("再移就会超出钢琴音域。");
      return;
    }
    setNotice(null);
    const next = transposeScore(scoreRef.current, semitones);
    keyboardTranspositions.current.set(next, (keyboardTranspositions.current.get(scoreRef.current) ?? 0) + semitones);
    publish(next, "other", { keepRegister: true });
    registerRef.current += semitones;
  }

  function pickKey(key: KeyName) {
    const shift = keyPadShift(scoreRef.current, registerRef.current, key);
    if (shift === null) {
      setError(null);
      setNotice("再移就会超出钢琴音域。");
      return;
    }
    if (shift === 0) return;
    setNotice(null);
    const next = transposeScore(scoreRef.current, shift);
    keyboardTranspositions.current.set(next, (keyboardTranspositions.current.get(scoreRef.current) ?? 0) + shift);
    publish(next, "other", { keepRegister: true });
  }

  async function loadExample(example: ExampleCard) {
    setError(null);
    setDetected(null);
    setMidiSession(null);
    if (example.lazy) {
      lazyExamplePendingRef.current = true;
      setLazyExampleReady(false);
    }
    try {
      const score = example.lazy
        ? await fetchExampleScore(example.id)
        : scoreFromExample(example as Example);
      publish(score, "other");
      lazyExamplePendingRef.current = false;
      setLazyExampleReady(true);
      setNotice(null);
    } catch {
      setNotice(null);
      setError(EXAMPLE_LOAD_ERROR);
    }
  }

  useEffect(() => {
    if (!pendingExampleId) return;
    const example = PD_EXAMPLES.find((item) => item.id === pendingExampleId);
    if (example) void loadExample(example);
    else setError(EXAMPLE_LOAD_ERROR);
    // Opening a classic from the home list; run once for this editor session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  const [midiPreview, setMidiPreview] = useState<ReturnType<typeof previewMidiImport> | null>(null);

  const [midiGrid, setMidiGrid] = useState<0.25 | 0.125>(0.25);

  function previewMidi(hands: boolean) {
    if (!midiSession) return;
    try {
      setMidiPreview(
        previewMidiImport(midiSession.bytes, midiSession.fallbackTitle, {
          hands,
          grid: midiGrid,
          voice: midiSession.selected ?? midiSession.voices[0],
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "MIDI 读不了");
    }
  }

  function loadMidiBytes(bytes: Uint8Array, fallbackTitle: string) {
    const voices = listMidiVoices(bytes);
    if (!voices.length) throw new Error("文件里没有音符");
    setMidiPreview(null);
    setDetected(null);
    setStyleNotice(null);
    setMidiSession({ bytes, fallbackTitle, voices, selected: null });
    setNotice(
      (voices.length === 1
        ? "检测到 1 个旋律声部。选择导入，或预览增强量化与双手导入。"
        : midiChoicePrompt(voices.length)) + " 打击乐通道 10 已跳过；速度、拍号、调号取最早事件作为起始值，并保留曲中变化。",
    );
  }

  function chooseMidiVoice(voice: MidiVoice) {
    setMidiPreview(null);
    const current = midiSession;
    if (!current || busy || recording) return;
    try {
      const next = midiToScore(current.bytes, current.fallbackTitle, voice);
      setDetected(null);
      setRecognitionDraft({ score: adoptMidi(scoreRef.current, next, activeVoiceRef.current), gaps: midiLosses(current.bytes, voice) });
      setMidiSession({ ...current, selected: { track: voice.track, channel: voice.channel } });
      setNotice(`MIDI 已送入识别草稿，调性为${keyTitle(next.key, next.mode)}；主谱尚未更改。`);
      setImportReport({ zone: "audio", source: "MIDI", losses: midiLosses(current.bytes, voice), notes: [] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "MIDI 读不了");
    }
  }

  function noteDuration() {
    return duration * (dotted ? 1.5 : 1);
  }

  function chordTarget(notes: ScoreNote[]): number | "rest" | "many" | null {
    const selected = selectedRef.current;
    if (selected.length > 1) return "many";
    if (selected.length === 1) {
      const index = selected[0];
      if (!notes[index]) return null;
      if (!notes[index].pitches.length) return "rest";
      return index;
    }
    const anchor = chordAnchorRef.current;
    if (anchor != null && notes[anchor]?.pitches.length) return anchor;
    return null;
  }

  function addPitch(midi: number) {
    const current = scoreRef.current;
    const voice = activeVoiceRef.current;
    const editing = voiceNotes(current, voice);
    if (stackRef.current) {
      const target = chordTarget(editing);
      if (target === "many" || target === "rest") {
        setNotice(chordRefuse(target));
        return;
      }
      if (typeof target === "number") {
        const stacked = stackChordAt(editing, target, midi);
        if (!stacked.ok) {
          setNotice(chordRefuse(stacked.reason));
          return;
        }
        chordAnchorRef.current = target;
        setNotice(null);
        publish(replaceVoice(current, voice, stacked.notes), "other", { keepChordAnchor: true });
        return;
      }
    }
    const notes = [...editing, { pitches: [midi], dur: noteDuration() }];
    if (stackRef.current) chordAnchorRef.current = notes.length - 1;
    setNotice(null);
    publish(replaceVoiceAndRemap(current, voice, notes), "other", { keepChordAnchor: stackRef.current });
  }

  function addRest() {
    const voice = activeVoiceRef.current;
    publish(
      replaceVoiceAndRemap(scoreRef.current, voice, [
        ...voiceNotes(scoreRef.current, voice),
        { pitches: [], dur: noteDuration() },
      ]),
      "other",
    );
  }

  function tapCursorNow(): number {
    const editing = voiceNotes(scoreRef.current, activeVoiceRef.current);
    if (selectedRef.current.length) return tapCursor(editing, selectedRef.current);
    return Math.min(tapCursorAt ?? editing.length, editing.length);
  }

  function tapSelect(voice: VoiceId, notes: ScoreNote[], index: number) {
    tapShapeRef.current = noteShapeOf(notes);
    if (index >= 0) {
      selectionOwnerRef.current = { voice, shape: noteShapeOf(notes) };
      anchorRef.current = index;
      setSelected([index]);
      setTapCursorAt(null);
    } else {
      selectionOwnerRef.current = null;
      anchorRef.current = null;
      setSelected([]);
      setTapCursorAt(0);
    }
  }

  function auditionSlots(slots: FollowSlot[]) {
    for (const slot of slots) {
      for (const midi of voiceNotes(scoreRef.current, slot.voice)[slot.note]?.pitches ?? []) {
        auditionPitch(midi, slot.voice);
      }
    }
  }

  function auditionPitch(midi: number, voice = activeVoiceRef.current) {
    try {
      let preview = previewCtxRef.current;
      if (preview) clearTimeout(preview.timer);
      const ctx = preview && preview.ctx.state !== "closed" ? preview.ctx : new AudioContext();
      void ctx.resume();
      previewTone(ctx, midi, .35, mixerRef.current, voice);
      preview = {
        ctx,
        timer: setTimeout(() => {
          previewCtxRef.current = null;
          void ctx.close().catch(() => {});
        }, 1500),
      };
      previewCtxRef.current = preview;
    } catch {
      // No audio device: entry still works silently.
    }
  }

  function tapDigit(degree: number) {
    const current = scoreRef.current;
    const voice = activeVoiceRef.current;
    const editing = voiceNotes(current, voice);
    const midi = degree === 0 ? null : tapPitch(current, degree, tapOctave, tapAccidental);
    if (stackRef.current && midi != null) {
      const target = chordTarget(editing);
      if (target === "many" || target === "rest") {
        setNotice(chordRefuse(target));
        return;
      }
      if (typeof target === "number") {
        const stacked = stackChordAt(editing, target, midi);
        if (!stacked.ok) {
          setNotice(chordRefuse(stacked.reason));
          return;
        }
        chordAnchorRef.current = target;
        setNotice(null);
        publish(replaceVoiceAndRemap(current, voice, stacked.notes), "other", { keepChordAnchor: true });
        tapSelect(voice, stacked.notes, target);
        if (tapAccidental) setTapAccidental(0);
        if (tapOctave) setTapOctave(0);
        if (tapAudition) auditionPitch(midi);
        return;
      }
    }
    const { notes, index } = tapInsert(editing, tapCursorNow(), {
      pitches: midi == null ? [] : [midi],
      dur: noteDuration(),
    });
    setNotice(null);
    publish(replaceVoiceAndRemap(current, voice, notes), "other", { keepChordAnchor: Boolean(stackRef.current && midi != null) });
    if (stackRef.current && midi != null) chordAnchorRef.current = index;
    tapSelect(voice, notes, index);
    if (tapAccidental) setTapAccidental(0);
    if (tapOctave) setTapOctave(0);
    if (midi != null && tapAudition) auditionPitch(midi);
  }

  function tapBack() {
    const current = scoreRef.current;
    const voice = activeVoiceRef.current;
    const result = tapBackspace(voiceNotes(current, voice), tapCursorNow());
    if (!result) return;
    publish(replaceVoiceAndRemap(current, voice, result.notes), "other");
    tapSelect(voice, result.notes, result.index);
  }

  function tapToEnd() {
    selectionOwnerRef.current = null;
    anchorRef.current = null;
    setSelected([]);
    setTapCursorAt(null);
  }

  function dropLast() {
    const voice = activeVoiceRef.current;
    const editing = voiceNotes(scoreRef.current, voice);
    if (!editing.length) return;
    publish(replaceVoiceAndRemap(scoreRef.current, voice, editing.slice(0, -1)), "other");
  }

  function clearNotes() {
    const voice = activeVoiceRef.current;
    if (!voiceNotes(scoreRef.current, voice).length) return;
    publish(replaceVoiceAndRemap(scoreRef.current, voice, []), "other");
    setDetected(null);
  }

  function createSecondVoice() {
    const count = voiceList(scoreRef.current).length;
    if (count >= MAX_VOICES) return;
    const next = addVoice(scoreRef.current);
    activeVoiceRef.current = count;
    setActiveVoice(count);
    setSelected([]);
    anchorRef.current = null;
    publish(next, "other");
    setNotice(`已加上${voiceLabel(count)}。写进去的音只改这一行。`);
  }

  function deleteSecondVoice() {
    const voice = activeVoiceRef.current || 1;
    if (voice >= voiceList(scoreRef.current).length) return;
    activeVoiceRef.current = 0;
    setActiveVoice(0);
    setSelected([]);
    anchorRef.current = null;
    setMixer(current => current.filter((_, i) => i !== voice));
    publish(removeVoice(scoreRef.current, voice), "other");
    setNotice(`${voiceLabel(voice)}已去掉，其余声部保留。撤销可以恢复。`);
  }

  function scoreSounds(score: Score): boolean {
    return allVoiceNotes(score).some((note) => note.pitches.length);
  }

  function manualPracticeSpeed(speed: number) {
    if (trainingRef.current.active) {
      const at = playPositionRef.current;
      const wasPlaying = Boolean(stopRef.current);
      halt();
      trainingRef.current.active = false;
      setTrainingActive(false);
      practiceRef.current.speed = speed;
      setPracticeSpeed(speed);
      if (wasPlaying) startPlayback(at);
    } else setPracticeSpeed(speed);
  }

  function togglePlay() {
    if (stopRef.current || waitStop.current) {
      halt();
      return;
    }
    startPlayback(trainingRef.current.active ? playPositionRef.current : null);
  }

  /** `resumeAt`: score quarter to continue from (speed change), skipping the count-in. */
  function startPlayback(resumeAt: number | null = null) {
    if (!scoreSounds(scoreRef.current)) return;
    playPositionRef.current = null;
    const practice = practiceRef.current;
    const training = trainingRef.current;
    // A loop left past the end by later edits falls back to the whole song, once.
    const loopUsable = practice.loopOn && practice.loopRange != null &&
      practice.loopRange.from < scoreQuarters(scoreRef.current) - 1e-6;
    setPlaying(true);
    setKaraokeNote(null);
    // Repeats and D.C. / D.S. play in their written order (A B A' …). A practice loop plays the bars as drawn.
    const unrolled = !loopUsable && hasPlayOrder(scoreRef.current) ? unrollScore(scoreRef.current) : null;
    const frameOf = unrolled
      ? (frame: PlayFrame) => {
          const map = (voice: number, note: number) => {
            const source = unrolled.source[voice]?.[note];
            return source == null || source < 0 ? null : source;
          };
          onPlayFrame({
            ...frame,
            note: frame.note == null ? null : map(0, frame.note),
            slots: frame.slots.flatMap((slot) => {
              const note = map(slot.voice, slot.note);
              return note == null ? [] : [{ ...slot, note }];
            }),
            position: frame.position == null ? undefined : unrolled.sourceAt(frame.position),
          });
          // Resuming after a speed change continues on the played (unrolled) timeline.
          if (frame.position != null) playPositionRef.current = frame.position;
        }
      : onPlayFrame;
    const handle = playScore(unrolled?.score ?? scoreRef.current, frameOf, {
      mixer: mixerRef.current,
      swing: SWING_RATIO[swingRef.current],
      comp: compRef.current,
      clickGain: metroRef.current.on ? metroRef.current.volume : 0,
      hand: scoreRef.current.voice2 == null ? "both" : handRef.current.hand,
      otherHand: handRef.current.otherHand,
      practice: {
        range: loopUsable ? practice.loopRange : null,
        loop: loopUsable,
        speed: practice.speed,
        countInBars: practice.countInBars,
        startAt: resumeAt,
        loopPause: practice.loopPause,
        loopTimes: practice.loopTimes,
        training: training.active ? { settings: training.settings, completed: training.completed, onProgress: (completed) => {
          trainingRef.current.completed = completed;
          setTrainingCompleted(completed);
          if (trainingProgress(training.settings, completed).done) {
            trainingRef.current.active = false;
            setTrainingActive(false);
            setNotice(`已练到 ${training.settings.target}%`);
          }
        } } : undefined,
      },
    });
    playHandle.current = handle;
    stopRef.current = handle.stop;
    playKindRef.current = "score";
  }

  function confirmDetected() {
    if (!detected?.length || busy || recording) return;
    const current = scoreRef.current;
    if (draftVoice >= voiceList(current).length) {
      setError("原目标声部已不存在，请重新听写后确认。");
      return;
    }
    const heard = detected.length;
    const written = draftNotes.filter((note) => note.pitches.length).length;
    const gaps = written < heard
      ? [`听出 ${heard} 个音，写下 ${written} 个。请对照录音补上没写下的音。`]
      : [];
    const title = isMachineTitle(current.title) ? "听写草稿" : current.title;
    setRecognitionDraft({ score: replaceVoiceAndRemap({
      ...current, title, bpm: draftBpm, key: draftKey.key, mode: draftKey.mode,
      tonicOctave: inferTonicOctave(draftNotes.flatMap(note => note.pitches), draftKey.key),
    }, draftVoice, draftNotes), gaps });
    setDetected(null);
    setNotice("听写结果已送入识别草稿，可选音修改后写入主谱。");
  }

  function transcribe(takeFrom: () => ReturnType<typeof transcribeMono>) {
    const token = ++transcribeToken.current;
    if (!aliveRef.current) return;
    setBusy(true);
    setDetected(null);
    setPolyTake(null);
    setImportReport((report) => (report?.zone === "audio" ? null : report));
    setNotice("正在听写…");
    window.setTimeout(() => {
      if (!aliveRef.current || token !== transcribeToken.current) return;
      try {
        const take = takeFrom();
        if (!aliveRef.current || token !== transcribeToken.current) return;
        if (!take.notes.length) {
          setError(take.notice ?? "没有听出稳定的音高。哼得慢一点、单音清楚一点。谱面未更改。");
          setNotice(null);
          return;
        }
        setError(null);
        setDetected(take.notes);
        setDraftBpm(estimateBpm(take.notes));
        setDraftVoice(activeVoiceRef.current);
        setMidiSession(null);
        setNotice(take.notice);
      } catch {
        if (!aliveRef.current || token !== transcribeToken.current) return;
        setError("听写未完成。没有写入谱面。");
        setNotice(null);
      } finally {
        if (aliveRef.current && token === transcribeToken.current) setBusy(false);
      }
    }, 40);
  }

  async function transcribePoly(audio: AudioBuffer) {
    const token = ++transcribeToken.current;
    setBusy(true);
    setDetected(null);
    setPolyTake(null);
    setImportReport((report) => (report?.zone === "audio" ? null : report));
    setError(null);
    setNotice(null);
    setPolyJob({ phase: "audio", done: 0 });
    window.requestAnimationFrame(() => polyPanelRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
    const voice = activeVoiceRef.current;
    try {
      // Lazy: the worker, TensorFlow.js and the model download only on first use.
      const { polyTranscribe } = await import("@/lib/music/poly-dictation-client");
      if (!aliveRef.current || token !== transcribeToken.current) return;
      const job = polyTranscribe(audio, (phase, done) => {
        if (aliveRef.current && token === transcribeToken.current) setPolyJob({ phase, done });
      }, polyCpu ? "cpu" : "auto");
      polyCancel.current = job.cancel;
      const result = await job.promise;
      if (!aliveRef.current || token !== transcribeToken.current) return;
      if (!result.notes.length) {
        setError("没有听出稳定的音。请换一段音色清楚的钢琴或和弦录音。谱面未更改。");
        return;
      }
      const heard = cleanPolyNotes(result.notes).notes;
      const pulse = analyzePulse(heard.length ? heard : result.notes);
      setPolyTempo(1);
      setPolyMeter("auto");
      setPolySplit(suggestSplit(heard));
      setPolyKeepOvertones(false);
      setPolyTake({
        notes: result.notes,
        seconds: result.seconds,
        clippedSeconds: result.clippedSeconds,
        backend: result.backend,
        modelMs: result.modelMs,
        inferMs: result.inferMs,
        voice,
        pulse,
      });
      window.requestAnimationFrame(() => polyPanelRef.current?.scrollIntoView({ block: "start", behavior: "smooth" }));
      setNotice(
        `多音听写完成：${result.seconds.toFixed(1)} 秒音频识别用时 ${(result.inferMs / 1000).toFixed(1)} 秒（${polyBackendLabel(result.backend)}）` +
          (result.modelMs > 50 ? `，首次载入模型 ${(result.modelMs / 1000).toFixed(1)} 秒` : "") +
          "。请校对草稿后确认。",
      );
    } catch (err) {
      if (!aliveRef.current || token !== transcribeToken.current) return;
      if (err instanceof Error && err.message === "cancelled") setNotice("已取消多音听写，谱面未更改。");
      else setError(`多音听写失败：${err instanceof Error ? err.message : "未知错误"}。谱面未更改。可改用单音模式或 MIDI。`);
    } finally {
      if (token === transcribeToken.current) {
        polyCancel.current = null;
        if (aliveRef.current) {
          setPolyJob(null);
          setBusy(false);
        }
      }
    }
  }

  function cancelPoly() {
    // Also covers the moment before the job exists (module still loading).
    polyCancel.current?.();
    polyCancel.current = null;
    transcribeToken.current += 1;
    setPolyJob(null);
    setBusy(false);
    setError(null);
    setNotice("已取消多音听写，谱面未更改。");
  }

  function confirmPoly() {
    if (!polyTake || !polyDraft || typeof polyDraft === "string" || !polyDraft.written || busy || recording) return;
    const current = scoreRef.current;
    // The heard meter is only safe to apply when no other written voice depends on the old bars.
    const other = voiceList(current).filter((_, i) => i !== polyTake.voice).flat();
    const meterFree = (polyDraft.twoVoices && !current.extraVoices?.some(v => v.length)) || !other.some((note) => note.pitches.length);
    const meta: Score = {
      ...current,
      title: isMachineTitle(current.title) ? "听写草稿" : current.title,
      bpm: polyDraft.score.bpm,
      ...(meterFree ? { beats: polyDraft.score.beats, beatUnit: polyDraft.score.beatUnit } : {}),
      key: polyDraft.score.key,
      mode: polyDraft.score.mode,
      tonicOctave: polyDraft.score.tonicOctave,
    };
    let next: Score;
    if (polyDraft.twoVoices) {
      // Both voices are new: mid-piece tempo/key marks and chord symbols no longer line up.
      next = { ...meta, notes: polyDraft.score.notes, voice2: polyDraft.score.voice2 ?? [] };
      if (!current.extraVoices?.some(v => v.length)) delete next.changes;
      // Chord names are inferred from what was heard; the old ones no longer line up.
      if (polyDraft.score.chordSymbols?.length) next.chordSymbols = polyDraft.score.chordSymbols;
      else delete next.chordSymbols;
    } else {
      if (polyTake.voice >= voiceList(current).length) {
        setError("原目标声部已不存在，请重新听写后确认。");
        return;
      }
      next = replaceVoiceAndRemap(meta, polyTake.voice, polyDraft.score.notes);
      if (polyTake.voice === 0) {
        if (polyDraft.score.chordSymbols?.length) next = { ...next, chordSymbols: polyDraft.score.chordSymbols };
        else {
          next = { ...next };
          delete next.chordSymbols;
        }
      }
    }
    setRecognitionDraft({ score: next, gaps: polyDraft.losses });
    setImportReport({ zone: "audio", source: "多音听写", losses: polyDraft.losses, notes: polyDraft.notes });
    setPolyTake(null);
    setNotice("多音结果已送入识别草稿，请修改后写入主谱。");
  }

  async function onTextScoreFile(file: File) {
    setError(null);
    setImportReport(null);
    try {
      const result = await importTextScore(file.name, new Uint8Array(await file.arrayBuffer()));
      setDetected(null);
      setMidiSession(null);
      publish(result.score, "other");
      setNotice(`已整谱导入${result.format.label}。`);
      setImportReport({ zone: "input", source: result.format.label, losses: result.losses, notes: result.notes });
    } catch (err) {
      setNotice(null);
      setError(err instanceof Error ? err.message : "简谱文本读不了，现有谱未更改。");
    }
  }

  async function onTextScorePaste() {
    const text = textPaste.trim();
    if (!text) {
      setError("请先粘贴 123、番茄、JP-Word、ABC 文本或 iReal 链接。");
      return;
    }
    setError(null);
    setImportReport(null);
    try {
      const result = await importTextScoreFromPaste(text);
      setDetected(null);
      setMidiSession(null);
      publish(result.score, "other");
      setNotice(`已整谱导入${result.format.label}。`);
      setImportReport({ zone: "input", source: result.format.label, losses: result.losses, notes: result.notes });
      setTextPaste("");
    } catch (err) {
      setNotice(null);
      setError(err instanceof Error ? err.message : "简谱文本读不了，现有谱未更改。");
    }
  }

  async function onGp5File(file: File) {
    const request = ++gp5Request.current;
    setGp5Preview(null);
    setError(null);
    try {
      // alphaTab is large: load the importer only when a .gp5 file is actually chosen.
      const { importGp5, MAX_GP5_BYTES } = await import("../lib/music/gp5-import");
      if (file.size > MAX_GP5_BYTES) throw new Error("GP5 文件过大，请使用不超过 4 MB 的文件。");
      const result = importGp5(new Uint8Array(await file.arrayBuffer()), file.name.replace(/\.gp5$/i, ""));
      if (request === gp5Request.current) setGp5Preview(result);
    } catch (err) {
      if (request === gp5Request.current) setError(err instanceof Error ? err.message : "GP5 读不了，现有谱未更改。");
    }
  }

  async function onMusicXmlFile(file: File, zone: "input" | "audio" = "input") {
    setError(null);
    try {
      if (file.size > MAX_MXL_BYTES) throw new Error("MusicXML/.mxl 文件过大，请使用不超过 16 MB 的文件，现有谱未更改。");
      const fallback = file.name.replace(/\.(musicxml|xml|mxl)$/i, "");
      const result = importMusicXmlSource(new Uint8Array(await file.arrayBuffer()), fallback, /\.mxl$/i.test(file.name));
      setDetected(null);
      setMidiSession(null);
      publish(result.score, "other");
      setNotice(result.notice);
      setImportReport({ zone, source: "MusicXML", losses: result.losses, notes: [] });
    } catch (err) {
      setNotice(null);
      setError(formatImportError(err));
    }
  }

  const consumedUpload = useRef<File | null>(null);
  useEffect(() => {
    if (!pendingUpload || consumedUpload.current === pendingUpload) return;
    consumedUpload.current = pendingUpload;
    void onFile(pendingUpload);
    // Consume each selected File once, including React StrictMode effect replay.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingUpload]);

  function revealAudio() {
    setActiveFeature("zone-audio");
  }

  async function onFile(file: File) {
    revealAudio();
    setError(null);
    setNotice(null);
    setPolyTake(null);
    // A new upload starts over: the last import's loss list no longer applies, even if this one fails.
    setImportReport((report) => (report?.zone === "audio" ? null : report));
    let bytes: Uint8Array<ArrayBuffer>;
    try {
      const header = new TextDecoder().decode(await file.slice(0, 4).arrayBuffer());
      if ((/\.(musicxml|xml|mxl)$/i.test(file.name) && header !== "MThd") || header.startsWith("PK")) {
        await onMusicXmlFile(file, "audio");
        return;
      }
      if ((header === "MThd" || /\.midi?$/i.test(file.name)) && file.size > MAX_MIDI_BYTES) {
        setError("MIDI 文件过大，请使用不超过 16 MB 的文件");
        return;
      }
      bytes = new Uint8Array(await file.arrayBuffer());
      if (!aliveRef.current) return;
    } catch {
      if (aliveRef.current) setError("文件读取失败，请重新选择本机音乐文件。");
      return;
    }
    const header = String.fromCharCode(bytes[0] ?? 0, bytes[1] ?? 0, bytes[2] ?? 0, bytes[3] ?? 0);
    if (/\.musicxml$/i.test(file.name) || (/\.xml$/i.test(file.name) && header !== "MThd")) {
      await onMusicXmlFile(file, "audio");
      return;
    }
    if (header === "MThd" || /\.midi?$/i.test(file.name)) {
      try {
        loadMidiBytes(bytes, file.name.replace(/\.midi?$/i, ""));
      } catch (err) {
        setError(err instanceof Error ? err.message : "MIDI 读不了");
      }
      return;
    }
    setBusy(true);
    setNotice("正在读音频…");
    let ctx: AudioContext | undefined;
    try {
      const audio = await decodeUploadedAudio(bytes, () => {
        const next = new AudioContext();
        ctx = next;
        decodingContexts.current.add(next);
        return next;
      });
      if (!aliveRef.current) return;
      setMidiSession(null);
      if (audioModeRef.current === "poly") void transcribePoly(audio);
      else transcribe(() => transcribeBuffer(audio, audio.sampleRate));
    } catch {
      setBusy(false);
      setNotice(null);
      setError(MUSIC_UPLOAD_ERROR);
    } finally {
      if (ctx) { decodingContexts.current.delete(ctx); void ctx.close().catch(() => {}); }
    }
  }

  async function startRecord() {
    const decision = tapRecord(recordGate.current);
    recordGate.current = decision.gate;
    setRecordPhase(decision.gate.phase);
    if (decision.gate.stopQueued) setRecordPending("已排队停止；权限返回后不会开始录音。");
    if (decision.stopNow || decision.gate.stopQueued) {
      recordStop.current?.();
      return;
    }
    if (!decision.begin) return;
    setError(null);
    setNotice(null);
    setRecordPending("正在请求麦克风…");
    setRecordMeter({ elapsed: 0, remaining: RECORD_SECONDS, level: 0 });
    const armId = ++armSeq.current;
    transcribeToken.current += 1;
    const stale = () => !aliveRef.current || armSeq.current !== armId;
    const arm = new RecordingArm();
    let cleanup: (() => void) | null = null;
    const permissionTimer = window.setTimeout(() => {
      if (!stale() && recordGate.current.phase === "arming" && !recordGate.current.stopQueued) {
        setRecordPending("仍在等待麦克风授权，请查看浏览器弹窗。" + microphoneHelp(navigator.userAgent) + "也可以排队停止后改用「上传音乐」。");
      }
    }, 10000);
    try {
      if (!window.isSecureContext) throw { name: "InsecureContextError" };
      if (!navigator.mediaDevices?.getUserMedia) throw { name: "UnsupportedError" };
      const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
      window.clearTimeout(permissionTimer);
      mic.getTracks().forEach((track) => arm.track(track));
      const held: { audio?: AudioContext; capture?: MicCaptureHandle } = {};
      let timer = 0;
      let started = false;
      const chunks: Float32Array[] = [];
      let collected = 0;
      let owningStop = false;
      const stop = (mode: "abort" | "finish") => {
        if (arm.isReleased) return;
        window.clearTimeout(timer);
        held.capture?.disconnect();
        held.capture = undefined;
        arm.release();
        if (owningStop) {
          recordStop.current = null;
          recordAbort.current = null;
        }
        owningStop = false;
        recordGate.current = initialRecordGate();
        if (armSeq.current === armId) armSeq.current += 1;
        if (!aliveRef.current) return;
        setRecordPhase("idle");
        setRecordPending("");
        setRecordMeter({ elapsed: 0, remaining: RECORD_SECONDS, level: 0 });
        if (mode === "abort" || !started) {
          setNotice(null);
          return;
        }
        const rate = held.audio?.sampleRate ?? 48000;
        if (collected < rate * 0.25) {
          setNotice(null);
          setError("哼得太短了。慢一点，至少半秒。");
          return;
        }
        const mono = new Float32Array(collected);
        let offset = 0;
        for (const chunk of chunks) {
          mono.set(chunk, offset);
          offset += chunk.length;
        }
        transcribe(() => transcribeMono(mono, rate));
      };
      // Registered before resume(), so unmount or a queued stop can release the mic
      // while AudioContext.resume() is still pending. `started` is read when the
      // handle runs, so the same handle finishes a take only after it is live.
      const invoke = () => stop(started ? "finish" : "abort");
      cleanup = () => stop("abort");
      recordStop.current = invoke;
      recordAbort.current = () => stop("abort");
      owningStop = true;
      if (stale() || recordGate.current.stopQueued || arm.isReleased) {
        stop("abort");
        return;
      }
      held.audio = new AudioContext();
      arm.closer(() => {
        if (held.audio && held.audio.state !== "closed") void held.audio.close();
      });
      await held.audio.resume();
      if (arm.isReleased || stale() || recordGate.current.stopQueued) {
        stop("abort");
        return;
      }
      const opened = finishArming(recordGate.current, !stale());
      recordGate.current = opened.gate;
      if (!opened.open) {
        stop("abort");
        return;
      }
      const source = held.audio.createMediaStreamSource(mic);
      const rate = held.audio.sampleRate;
      const maxSamples = Math.floor(rate * 20);
      held.capture = await connectMicCapture(held.audio, source, (data) => {
        if (arm.isReleased) return;
        const taken = takeMicFrame(data, collected, maxSamples);
        if (taken.chunk) {
          chunks.push(taken.chunk);
          collected = taken.collected;
          setRecordMeter(recordingMeter(taken.chunk, collected, rate));
        }
        if (taken.done) stop("finish");
      });
      // If the user cancelled while the worklet module was loading, `stop` already
      // ran with an empty handle. Disconnect the graph that just came up.
      if (arm.isReleased || stale() || recordGate.current.stopQueued) {
        held.capture.disconnect();
        held.capture = undefined;
        try {
          source.disconnect();
        } catch {
          /* already disconnected */
        }
        stop("abort");
        return;
      }
      arm.closer(() => {
        held.capture?.disconnect();
        try {
          source.disconnect();
        } catch {
          /* already disconnected */
        }
      });
      started = true;
      timer = window.setTimeout(() => stop("finish"), 20000);
      if (!aliveRef.current || arm.isReleased) {
        stop("abort");
        return;
      }
      setRecordPhase("live");
      setRecordPending("");
      setError(null);
      setNotice("正在听，最长二十秒。");
    } catch (error) {
      const failed = !arm.isReleased;
      if (failed) {
        if (cleanup) cleanup();
        else arm.release();
      }
      if (armSeq.current === armId) recordGate.current = initialRecordGate();
      if (aliveRef.current && failed) {
        setRecordPhase("idle");
        setRecordPending("");
        setRecordMeter({ elapsed: 0, remaining: RECORD_SECONDS, level: 0 });
        setError(microphoneError(error, navigator.userAgent, window.isSecureContext));
      }
    } finally {
      window.clearTimeout(permissionTimer);
    }
  }

  function staffSvg(): SVGSVGElement | null {
    const svg = staffRef.current?.querySelector("svg");
    return svg instanceof SVGSVGElement ? svg : null;
  }

  function waitForStaff(): Promise<"ready" | "failed" | "timeout"> {
    const immediate = staffWaitResult(staffGen.current, staffSvg() !== null);
    if (immediate !== "pending") return Promise.resolve(immediate);
    return new Promise((resolve) => {
      const waiter = () => {
        window.clearTimeout(timer);
        const result = staffWaitResult(staffGen.current, staffSvg() !== null);
        resolve(result === "pending" ? "timeout" : result);
      };
      const timer = window.setTimeout(() => {
        staffWaiters.current = staffWaiters.current.filter((fn) => fn !== waiter);
        resolve("timeout");
      }, 2000);
      staffWaiters.current.push(waiter);
    });
  }

  async function captureExport(): Promise<ExportSnapshot | null> {
    return exportPipeline(outputView, async () => {
      const title = scoreRef.current.title;
      const shift = instrumentOf(instrumentRef.current).shift;
      const caption = staffCaption(scoreRef.current, shift);
      const markup = jianpuPrint(scoreRef.current, printSettings, shift, caption).markup;
      return freezeExportSnapshot({ title, caption, markup });
    }, async () => {
      const status = await waitForStaff();
      if (status !== "ready" || !aliveRef.current) return null;
      const svg = staffSvg();
      if (!svg) return null;
      const info = instrumentOf(instrumentRef.current);
      const title = scoreRef.current.title;
      const caption = staffCaption(scoreRef.current, info.shift);
      const markup = new XMLSerializer().serializeToString(titledSvg(svg, title, caption));
      return freezeExportSnapshot({ title, caption, markup });
    }, async () => {
      const title = scoreRef.current.title;
      const shift = instrumentOf(instrumentRef.current).shift;
      const caption = staffCaption(scoreRef.current, shift);
      const markup = tabPrint(scoreRef.current, printSettings, tabTuning, caption, tabPosition).markup;
      return freezeExportSnapshot({ title, caption, markup });
    });
  }

  function requantize() {
    if (!detected?.length) return;
    setDraftBpm(scoreRef.current.bpm);
  }

  async function downloadSvg() {
    const snapshot = await captureExport();
    if (!snapshot) {
      if (aliveRef.current) setError("谱面还没准备好。");
      return;
    }
    saveBlob(
      new Blob([snapshot.markup], { type: "image/svg+xml" }),
      exportDownloadName(snapshot, "svg"),
    );
    exportSuccess("SVG 已导出。");
  }

  async function downloadPng() {
    const snapshot = await captureExport();
    if (!snapshot) {
      if (aliveRef.current) setError("谱面还没准备好。");
      return;
    }
    const name = exportDownloadName(snapshot, "png");
    const url = URL.createObjectURL(new Blob([snapshot.markup], { type: "image/svg+xml" }));
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = image.width * 2;
      canvas.height = image.height * 2;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        URL.revokeObjectURL(url);
        setError("PNG 没能画出来。可以改下 SVG。");
        return;
      }
      ctx.fillStyle = "#f7f3ea";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => {
        if (!aliveRef.current) {
          URL.revokeObjectURL(url);
          return;
        }
        if (blob) { saveBlob(blob, name); exportSuccess("PNG 已导出。"); }
        else setError("PNG 没能画出来。可以改下 SVG。");
        URL.revokeObjectURL(url);
      });
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      setError("PNG 没能画出来。可以改下 SVG。");
    };
    image.src = url;
  }

  function downloadMidi() {
    const bytes = scoreToMidi(score, mixerPrograms(mixerRef.current));
    const copy = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(copy).set(bytes);
    saveBlob(new Blob([copy], { type: "audio/midi" }), `${exportFileBase(score.title)}.mid`);
    exportSuccess("MIDI 已导出。");
  }

  function downloadJianpuLy() {
    try {
      const current = scoreRef.current;
      const result = scoreToJianpuLy(current, { instrumentShift: instrumentInfo.shift });
      saveBlob(
        new Blob([result.text], { type: "text/plain;charset=utf-8" }),
        `${exportFileBase(current.title)}.jly`,
      );
      exportSuccess("jianpu-ly（.jly）已导出。");
      setError(result.warnings.length ? `已下载 .jly。${result.warnings.join("；")}` : null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "jianpu-ly 导出失败");
    }
  }

  function downloadJpwabc() {
    try {
      const current = scoreRef.current;
      const result = exportJpwabc(current);
      const copy = new ArrayBuffer(result.bytes.byteLength);
      new Uint8Array(copy).set(result.bytes);
      saveBlob(new Blob([copy], { type: "text/plain;charset=utf-16le" }), `${exportFileBase(current.title)}.jpwabc`);
      exportSuccess(result.losses.length ? `JP-Word 已导出；未写进去：${result.losses.join("、")}。` : "JP-Word 已导出。");
    } catch (err) {
      setError(err instanceof Error ? err.message : "JP-Word 导出失败");
    }
  }


  function download123() {
    try {
      const current = scoreRef.current;
      const result = export123(current);
      saveBlob(new Blob([result.text], { type: "text/plain;charset=utf-8" }), `${exportFileBase(current.title)}.123`);
      exportSuccess(result.losses.length ? `123 简谱已导出；未写进去：${result.losses.join("、")}。` : "123 简谱已导出。");
    } catch (err) {
      setError(err instanceof Error ? err.message : "123 导出失败");
    }
  }

  async function downloadAbc() {
    try {
      const current = scoreRef.current;
      const result = (await loadAbc()).exportAbc(current);
      saveBlob(new Blob([result.text], { type: "text/vnd.abc;charset=utf-8" }), `${exportFileBase(current.title)}.abc`);
      exportSuccess(result.losses.length ? `ABC 已导出；未写进去：${result.losses.join("、")}。` : "ABC 已导出。");
    } catch (err) {
      setError(err instanceof Error ? err.message : "ABC 导出失败");
    }
  }

  function keepSharedScore() {
    sharedRef.current = false;
    setShared(false);
    clearShareHash();
    if (archiveSong(scoreRef.current, true)) {
      persistScore();
      setNotice("已存到「我的曲子」。之后的修改会自动保存。");
    }
  }

  async function copyShareLink() {
    const result = shareUrlOf(scoreRef.current);
    if (!result.ok) {
      setError(null);
      setNotice("谱面太长，链接放不下，请改用文件（MusicXML 或简谱）发给对方。");
      return;
    }
    try {
      await navigator.clipboard.writeText(result.url);
      exportSuccess("分享链接已复制。对方打开后可查看、播放和练习，也可存到自己的曲子。");
    } catch {
      setError("复制失败了，请改用文件分享。");
    }
  }

  function downloadMusicXml() {
    const current = scoreRef.current;
    const xml = scoreToMusicXml(current);
    saveBlob(
      new Blob([xml], { type: "application/vnd.recordare.musicxml+xml" }),
      `${exportFileBase(current.title)}.musicxml`,
    );
    exportSuccess("MusicXML 已导出。");
  }

  function downloadMusicXmlTab() {
    const current = scoreRef.current;
    const { xml, notices } = scoreToMusicXmlTab(current, tabTuning, tabPosition);
    saveBlob(
      new Blob([xml], { type: "application/vnd.recordare.musicxml+xml" }),
      `${exportFileBase(current.title)}-tab.musicxml`,
    );
    exportSuccess("MusicXML 六线谱已导出。");
    if (notices.length) setError(notices.join(" "));
  }

  async function copyJianpu() {
    const text = jianpuShareText(
      voiceView(scoreRef.current, activeVoiceRef.current),
      instrumentInfo.shift,
    );
    try {
      await navigator.clipboard.writeText(text);
      setError(null);
      const voice = activeVoiceRef.current;
      const lyricNote = scoreHasLyrics(voiceNotes(scoreRef.current, voice)) ? "简谱不含歌词。" : "";
      const other = hasSecondVoice(scoreRef.current)
        ? "复制的是正在改的声部，另一声部还在谱上。"
        : "";
      setNotice(
        (instrumentInfo.shift ? `已复制${instrumentInfo.label}记谱简谱。` : "简谱已复制。") +
          other +
          lyricNote,
      );
    } catch {
      setError("复制失败了，可以手动选中谱面下的简谱。");
    }
  }

  const canPlay = scoreSounds(score);
  const shownFeature: FeatureId | null = practiceOpen ? null : activeFeature;
  useEffect(() => {
    if (fullScore) return;
    const drops: Array<() => void> = [];
    const scoreEl = document.getElementById("zone-score");
    if (scoreEl) {
      drops.push(attachResizeHandle(scoreEl, {
        id: "zone-score",
        label: "调整谱面区域大小",
        minWidth: 280,
        minHeight: 280,
        axes: "both",
      }));
    }
    const panel = document.querySelector(
      ".app-shell[data-editor-layout] .zone-panel:not([hidden])",
    ) as HTMLElement | null;
    if (panel && !panel.classList.contains("score-image-panel")) {
      drops.push(attachResizeHandle(panel, {
        id: "zone-tools-drawer",
        label: "调整工具面板大小",
        minWidth: 260,
        minHeight: 200,
        axes: "both",
      }));
    }
    return () => {
      for (const drop of drops) drop();
    };
  }, [shownFeature, practiceOpen, fullScore, scoreImage]);

  useEffect(() => {
    // An upload or dictation error must be on screen, not below the fold of the panel.
    if (error && shownFeature === "zone-audio" && !isMicrophoneStatusError(error))
      window.requestAnimationFrame(() => polyPanelRef.current?.scrollIntoView({ block: "nearest" }));
  }, [error, shownFeature]);
  const exportShown = shownFeature === "zone-play";
  const jpwPreview = useMemo(() => {
    if (!exportShown) return { losses: [] as string[], error: null as string | null };
    try {
      return { losses: exportJpwabc(score).losses, error: null };
    } catch (err) {
      return { losses: [], error: err instanceof Error ? err.message : "这首暂时不能导出 JP-Word。" };
    }
  }, [score, exportShown]);
  // Staff view: abcjs marks the sounding head after paint, so look one frame later.
  useEffect(() => {
    if ((!followPlay && !fullScore) || !sounding.length || scoreView !== "staff") return;
    const frame = requestAnimationFrame(() => {
      const lit = staffRef.current?.querySelector(".is-sounding");
      if (lit) followInto(lit);
    });
    return () => cancelAnimationFrame(frame);
  }, [sounding, followPlay, fullScore, scoreView]);
  useEffect(() => {
    if (playing) return;
    const frame = requestAnimationFrame(() => {
      const el = paperRef.current?.querySelector(
        ".is-chosen, .jianpu-bar-target.is-cursor, .piano-roll-note.is-chosen, .guitar-tab-fret.is-chosen",
      );
      if (el) followInto(el);
    });
    return () => cancelAnimationFrame(frame);
  }, [selected, tapCursorAt, scoreView, playing]);
  useEffect(() => {
    if (recognitionDraft) { halt(); setKeyboardOpen(false); }
  }, [recognitionDraft]);
  const bars = barStarts(score);
  const barCount = bars.length;
  const loopLabel = loopRange ? describeLoop(score, loopRange) : "";
  const currentPracticeSpeed = trainingActive ? trainingProgress(trainingSettings, trainingCompleted).speed : practiceSpeed;
  const practiceActive = waitActive || practiceHand !== "both" || trainingActive || practiceSpeed !== 1 || countInBars > 0 || (loopOn && loopRange != null);
  const karaokeVoice: VoiceId | null = karaokeNote?.voice ?? (scoreHasLyrics(voiceNotes(score, activeVoice)) ? activeVoice : scoreHasLyrics(score.notes) ? 0 : null);
  const karaoke = playing && playKindRef.current === "score" && karaokeVoice != null
    ? karaokeLine(voiceNotes(score, karaokeVoice), score, karaokeNote?.voice === karaokeVoice ? karaokeNote.note : -1)
    : null;
  function editRepeat(action: RepeatAction) {
    const notes = voiceNotes(scoreRef.current, activeVoiceRef.current);
    const index = selected[0];
    if (index == null || !notes[index]) {
      setNotice("先在谱上点一个音，再设反复。");
      return;
    }
    const at = notes.slice(0, index).reduce((sum, note) => sum + note.dur, 0);
    const result = editRepeats(scoreRef.current, at, action);
    if ("error" in result) {
      setNotice(result.error);
      return;
    }
    const next: Score = { ...scoreRef.current };
    if (result.repeats) next.repeats = result.repeats;
    else delete next.repeats;
    commit(next);
    const summary = repeatsSummary(next);
    setNotice(summary ? `已设：${summary}。可以撤销。` : "已清除反复。可以撤销。");
  }

  function editJump(action: JumpAction) {
    const notes = voiceNotes(scoreRef.current, activeVoiceRef.current);
    const index = selected[0];
    if (index == null || !notes[index]) {
      setNotice("先在谱上点一个音，再设跳转记号。");
      return;
    }
    const at = notes.slice(0, index).reduce((sum, note) => sum + note.dur, 0);
    const result = editJumps(scoreRef.current, at, action);
    if ("error" in result) {
      setNotice(result.error);
      return;
    }
    const next: Score = { ...scoreRef.current };
    if (result.jumps) next.jumps = result.jumps;
    else delete next.jumps;
    commit(next);
    const summary = jumpsSummary(next);
    setNotice(summary ? `已设：${summary.replace(/。$/, "")}。可以撤销。` : "已清除跳转。可以撤销。");
  }

  function setLoopBars(fromBar: number, toBar: number) {
    const range = loopFromBars(scoreRef.current, fromBar, toBar);
    if (range) setLoopRange(range);
  }
  const loopFromBar = loopRange ? bars.filter((start) => start <= loopRange.from + 1e-6).length : 1;
  const loopToBar = loopRange ? Math.max(loopFromBar, bars.filter((start) => start < loopRange.to - 1e-6).length) : Math.min(2, barCount);
  const meter = `${score.beats}/${score.beatUnit}`;
  const meters = METER_OPTIONS.includes(meter) ? METER_OPTIONS : [meter, ...METER_OPTIONS];

  return (
    <>
      <div ref={printHostRef} className="print-sheet" />
      <main className="app-shell no-print mx-auto min-h-screen" data-editor-layout="workspace" data-image-panel={scoreImage ? "" : undefined} data-review={recognitionDraft ? "" : undefined} data-keyboard={keyboardOpen ? "" : undefined} data-full-score={fullScore ? "" : undefined} data-tap-dock={!shared && shownFeature === "zone-input" && tab === "jianpu" ? "" : undefined} data-readonly={shared ? "" : undefined}>
      <header className="editor-header no-print flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 whitespace-nowrap text-xl font-medium tracking-tight">
            <Music2 className="size-5" aria-hidden="true" />
            <span className="editor-brand">谱线</span>
          </h1>
          <p className="mt-1 text-sm text-muted">
            让旋律，落在纸上。
          </p>
        </div>
        <div className="flex flex-shrink-0 items-stretch gap-2">
        <nav aria-label="编辑器导航" className="editor-actions">
          <ScoreImageUpload onSelect={(files) => setScoreImage((previous) => [...(previous ?? []), ...files])} className="" />
          <button type="button" disabled={busy} onClick={() => { setPracticeOpen(false); setActiveFeature("zone-audio"); }}>
            <Upload className="size-4" aria-hidden="true" />识别音乐
          </button>
        </nav>
        {onReturnHome && <button type="button" className="editor-home" onClick={returnHome}>返回主页</button>}
        </div>
      </header>

      {shared ? (
        <div className="share-banner no-print" role="status">
          <p>这是分享来的只读谱，可看谱、播放和练习，不会写入你的草稿。要修改，点「在编辑器中打开副本」，会存一份到我的曲子。</p>
          <button type="button" className={solid} onClick={keepSharedScore}>
            在编辑器中打开副本
          </button>
        </div>
      ) : null}

      {shared ? null : <div className="feature-bar no-print" role="tablist" aria-label="编辑器功能栏">
        {FEATURES.map((feature, index) => (
          <button key={feature.id} id={`tab-${feature.id}`} type="button" role="tab"
            aria-selected={shownFeature === feature.id} aria-controls={feature.id}
            tabIndex={activeFeature === feature.id ? 0 : -1}
            onClick={() => { setPracticeOpen(false); setActiveFeature(feature.id); }}
            onKeyDown={(event) => {
              const next = event.key === "ArrowRight" ? (index + 1) % FEATURES.length
                : event.key === "ArrowLeft" ? (index + FEATURES.length - 1) % FEATURES.length
                : event.key === "Home" ? 0 : event.key === "End" ? FEATURES.length - 1 : -1;
              if (next < 0) return;
              event.preventDefault();
              setPracticeOpen(false);
              setActiveFeature(FEATURES[next].id);
              document.getElementById(`tab-${FEATURES[next].id}`)?.focus();
            }}
          >{feature.title}</button>
        ))}
      </div>}

      {((error && !isMicrophoneStatusError(error)) || notice || (pendingExampleId && !lazyExampleReady && !error)) && !(shownFeature === "zone-audio" || recording) && (
        <div className="editor-message no-print rounded-2xl border border-line bg-paper px-3 py-1">
          <button type="button" className="float-right -my-1 -mr-2 ml-2 inline-flex size-11 items-center justify-center text-lg text-muted" aria-label="关闭提示" onClick={() => { setError(null); setNotice(null); }}>×</button>
          {error ? (
            <p className="text-sm text-warn" role="alert">
              {error}
            </p>
          ) : null}
          {pendingExampleId && !lazyExampleReady && !error ? (
            <p role="status" className={error ? "mt-1 text-sm text-muted" : "text-sm text-muted"}>正在打开「{score.title}」…</p>
          ) : notice ? (
            <p role="status" className={error ? "mt-1 text-sm text-muted" : "text-sm text-muted"}>{notice}</p>
          ) : null}
        </div>
      )}

      <Zone
        id="zone-score"
        title="谱面"
        hint="曲名可以改。两个声部各写一行，上下对齐。正在改的是下面标出的那一声部。"
      >
        <div className="score-head">
          <ScoreTitle
            key={scorePaint}
            value={score.title}
            readOnly={shared || fullScore}
            onChange={(title) => commit({ ...scoreRef.current, title })}
          />
          {songId && (EXAMPLES.some((item) => item.title === score.title) || PD_EXAMPLES.some((item) => item.title === score.title)) ? (
            <p className="w-full text-xs leading-5 text-muted">这是本机保存的谱，不是同名示例。</p>
          ) : null}
          <div className="score-tools no-print">
            <div className="segmented" role="group" aria-label="谱面视图">
              {(["jianpu", "staff", "roll", "lead", "tab"] as const).map((view) => (
                <button
                  key={view}
                  type="button"
                  aria-pressed={scoreView === view}
                  onClick={() => setScoreView(view)}
                >
                  {view === "jianpu" ? "简谱" : view === "staff" ? "五线" : view === "roll" ? "卷帘" : view === "lead" ? "和弦谱" : "六线"}
                </button>
              ))}
            </div>
            <div className="segmented" role="group" aria-label="谱面大小">
              <button type="button" aria-label="缩小谱面" disabled={zoom <= ZOOM_STEPS[0]}
                onClick={() => setZoom((value) => ZOOM_STEPS[Math.max(0, ZOOM_STEPS.indexOf(value) - 1)])}>
                <ZoomOut className="size-4" aria-hidden="true" />
              </button>
              <button type="button" aria-label="放大谱面" disabled={zoom >= ZOOM_STEPS[ZOOM_STEPS.length - 1]}
                onClick={() => setZoom((value) => ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, ZOOM_STEPS.indexOf(value) + 1)])}>
                <ZoomIn className="size-4" aria-hidden="true" />
              </button>
            </div>
            <button type="button" className="tool-button" aria-pressed={followPlay}
              aria-label="播放时谱面跟随" title={followPlay ? "播放时谱面跟随：开" : "播放时谱面跟随：关"}
              onClick={() => setFollowPlay(!followPlay)}>
              {followPlay ? <LocateFixed className="size-4" aria-hidden="true" /> : <LocateOff className="size-4" aria-hidden="true" />}
            </button>
            <button type="button" className="tool-button" aria-pressed={fullScore}
              aria-label={fullScore ? "退出全屏看谱" : "全屏看谱"} onClick={() => setFullScore((on) => !on)}>
              {fullScore ? <Minimize2 className="size-4" aria-hidden="true" /> : <Maximize2 className="size-4" aria-hidden="true" />}
              {fullScore ? <span className="full-score-exit-label">退出全屏</span> : null}
            </button>
            <button type="button" className="tool-button" aria-label={keyboardOpen ? '琴键 收起' : '琴键 展开'} aria-expanded={keyboardOpen} aria-controls="visual-keyboard-panel" onClick={() => setKeyboardOpen(on => !on)}>琴键</button>
          </div>
        </div>
        {fullScore ? <div className="performance-bar" aria-label="演出控制">
          {performanceList ? <span className="performance-list">{performanceList.name} · {performanceList.songs.indexOf(practiceSong) + 1}/{performanceList.songs.length}</span> : null}
          <button type="button" className={quiet} onClick={() => turnPerformance(-1)}>上一屏</button>
          <button type="button" className={quiet} onClick={() => turnPerformance(1)}>下一屏</button>
          <button type="button" className={quiet} aria-pressed={autoScrolling} disabled={playing} onClick={() => setAutoScrolling(on => !on)}>{autoScrolling ? "暂停滚屏" : "按速度自动滚"}</button>
          <label>速度 {scrollPercent}% <input aria-label="自动滚屏速度" type="range" min="50" max="150" step="10" value={scrollPercent} onChange={event => setScrollPercent(Number(event.target.value))} /></label>
          <span className="performance-hint">{playing ? "播放中，跟随音符" : "轻触左右翻页 · 方向键 / 翻页器"}</span>
        </div> : null}
        {/* Zero-height anchor: the count-in / karaoke strip floats over the top of
            the score instead of pushing it down. */}
        <div className="practice-overlay no-print">
        {countdown > 0 || karaoke || trainingActive ? (
          <div className="practice-strip" aria-live="off">
            {trainingActive ? <span className="count-in-pill" role="status">第 {trainingCompleted + 1} 遍 · {Math.round(currentPracticeSpeed * 100)}% · 下一档 {trainingProgress(trainingSettings, trainingCompleted).next == null ? '完成' : `${trainingProgress(trainingSettings, trainingCompleted).next}%`}</span> : null}
            {countdown > 0 ? <span className="count-in-pill" role="status">预备 {countdown}</span> : null}
            {karaoke && countdown === 0 ? (
              <p className="karaoke" aria-label="跟唱歌词">
                {karaoke.map((syllable) => (
                  <span key={syllable.index} className={`karaoke-${syllable.state}`}>
                    {syllable.text}{syllable.joinNext || !/[A-Za-z0-9'’]$/.test(syllable.text) ? "" : " "}
                  </span>
                ))}
              </p>
            ) : null}
          </div>
        ) : null}
        </div>
        {score.lyricist || score.composer ? (
          <p className="mt-1 text-sm text-muted" data-score-credits="">
            {[score.lyricist ? `词：${score.lyricist}` : "", score.composer ? `曲：${score.composer}` : ""].filter(Boolean).join("　")}
          </p>
        ) : null}
        <div ref={paperRef} className={clsx("score-stage mt-1", waitFeedback.wrong && "wait-wrong")} aria-busy={pendingExampleId && !lazyExampleReady ? true : undefined}
          onPointerDownCapture={event => {
            if (!fullScore || onGuide(event)) return;
            turnPointer.current = { x: event.clientX, y: event.clientY, moved: false };
            event.stopPropagation();
          }}
          onPointerMoveCapture={event => {
            if (!fullScore || onGuide(event)) return;
            const start = turnPointer.current;
            if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 10) start.moved = true;
            event.stopPropagation();
          }}
          onPointerUpCapture={event => { if (fullScore && !onGuide(event)) event.stopPropagation(); }}
          onPointerCancelCapture={() => { turnPointer.current = null; }}
          onDoubleClickCapture={event => { if (fullScore && !onGuide(event)) { event.preventDefault(); event.stopPropagation(); } }}
          onClickCapture={event => {
            if (!fullScore || onGuide(event)) return;
            event.preventDefault(); event.stopPropagation();
            const start = turnPointer.current;
            turnPointer.current = null;
            if (!start || start.moved) return;
            const box = event.currentTarget.getBoundingClientRect();
            const part = (event.clientX - box.left) / box.width;
            if (part < 1/3) turnPerformance(-1);
            else if (part > 2/3) turnPerformance(1);
          }} role="region" aria-label="谱面预览，可滚动查看完整乐谱" tabIndex={0}>
          <div ref={liveRef} className="score-live">
            {pendingExampleId && !lazyExampleReady ? (
              <p className="text-center text-sm text-muted" role="status">
                {error ? error : `正在打开「${score.title}」…`}
              </p>
            ) : (<>
            <p
              key={face.caption}
              className={
                motionEpoch
                  ? "score-swap text-center text-sm text-muted tabular-nums"
                  : "text-center text-sm text-muted tabular-nums"
              }
            >
              {face.caption}{fixedDo ? " · 简谱固定调（1=C）" : ""}
            </p>
            {face.hint ? (
              <p
                key={face.hint}
                className={
                  motionEpoch
                    ? "score-swap mt-1 text-center text-sm text-muted"
                    : "mt-1 text-center text-sm text-muted"
                }
              >
                {face.hint}
              </p>
            ) : null}
            {auxiliary && score.chordSymbols?.length ? <Suspense fallback={null}><ChordGuide key={songIdRef.current} songId={songIdRef.current} score={score} at={playhead ?? (selected[0] != null ? voiceNotes(score, activeVoice).slice(0, selected[0]).reduce((sum, n) => sum + n.dur, 0) : 0)} onLabels={onChordLabels} /></Suspense> : null}
            <AppErrorBoundary label="谱面">
            {scoreView === "jianpu" || scoreView === "lead" ? (
              <div style={zoom === 1 ? undefined : { zoom }}>
              <JianpuView
                key={scoreView}
                score={scoreView === "lead" ? leadSheetScore(chordDisplayScore) : chordDisplayScore}
                shift={instrumentInfo.shift}
                sounding={sounding}
                selected={selected}
                activeVoice={activeVoice}
                onPick={(index, extend, voice) => pickRef.current(index, extend, voice)}
                onPlace={(cursor, voice) => { if (!fullScore) placeRef.current(cursor, voice); }}
                cursor={selected.length ? null : tapCursorAt}
                follow={followPlay || fullScore}
                width={Math.max(240, (width - 12) / zoom)}
                loop={loopShown}
                leadSheet={scoreView === "lead"}
                showFingering={showFingering}
                fixedDo={fixedDo}
              />
              </div>
            ) : null}
            {scoreView === "roll" ? (
              <div style={zoom === 1 ? undefined : { zoom }}>
              <PianoRollView
                score={score}
                shift={instrumentInfo.shift}
                sounding={sounding}
                playhead={playhead}
                selected={selected}
                activeVoice={activeVoice}
                onPick={(index, extend, voice) => pickRef.current(index, extend, voice)}
                width={Math.max(240, (width - 12) / zoom)}
                loop={loopShown}
                follow={followPlay || fullScore}
                showFingering={showFingering}
              />
              </div>
            ) : null}
            {scoreView === "tab" ? (
              <div style={zoom === 1 ? undefined : { zoom }}>
              <GuitarTabView
                score={chordDisplayScore}
                sounding={sounding}
                playhead={playhead}
                selected={selected}
                activeVoice={activeVoice}
                onPick={(index, extend, voice) => pickRef.current(index, extend, voice)}
                width={Math.max(240, (width - 12) / zoom)}
                loop={loopShown}
                follow={followPlay || fullScore}
                tuning={tabTuning}
                onTuning={setTabTuning}
                position={tabPosition}
                onPosition={setTabPosition}
              />
              </div>
            ) : null}
            <div className={`staff-slot mt-3${scoreView !== "staff" ? " jianpu-staff-backup" : ""}`}>
              <div
                ref={staffRef}
                className="staff min-h-32"
                aria-label="五线谱，点符头可以选中"
                aria-describedby={rangeLine ? "range-notice" : undefined}
              />
              <div ref={ghostRef} className="score-ghost" hidden aria-hidden="true" />
            </div>
            </AppErrorBoundary>
            {rangeLine ? (
              <p id="range-notice" className="mt-2 text-center text-sm text-warn" role="status">
                {rangeLine}
                {markRange && rangeUnmarked ? "有的超音域音没能标到符头上。" : ""}
              </p>
            ) : null}
            <details className="zone-help score-bar-check no-print mt-3">
              <summary>拍数核对{barIssues.length ? `：${barIssues.length} 处末小节未满` : "：拍数完整"}</summary>
              <p className="mt-2 text-sm text-muted">按各声部原有时值核对，休止计拍、和弦计一次；每拍按当前拍号的分母计算。小节自动划分，跨小节长音合法。末小节未满可能是正在录入或弱起收尾，请自行核对，不影响保存。</p>
              <ul className="mt-2 text-sm text-warn" aria-label="末小节缺拍提示">
                {barIssues.map((issue) => <li key={issue.voice}>{describeBarCheck(issue, score.beatUnit)}</li>)}
              </ul>
            </details>
            <div className="no-print mt-3 h-px bg-line" aria-hidden="true">
              <div
                className="h-px origin-left bg-accent"
                style={{ transform: `scaleX(${progress})` }}
              />
            </div>
            {playing && (sounding.length > 0 || progress > 0.001) ? (
              <p className="no-print mt-2 text-center text-sm text-accent" aria-live="polite">
                {sounding.length
                  ? sounding
                      .map((slot) => {
                        const notes = voiceNotes(score, slot.voice);
                        const chord = (notes[slot.note]?.pitches.length ?? 0) > 1;
                        const name = hasSecondVoice(score) ? voiceNameOf(slot.voice) : "";
                        return chord
                          ? `正在响${name}第 ${slot.note + 1} 个音，这一拍的和弦`
                          : `正在响${name}第 ${slot.note + 1} 个音`;
                      })
                      .join("。")
                  : "休止"}
              </p>
            ) : null}
            {scoreView === "roll" || scoreView === "lead" || scoreView === "tab" ? null : face.jianpu ? (
              <p className="mt-4 whitespace-pre-line text-center text-base leading-relaxed tracking-wide">
                {face.jianpu}
              </p>
            ) : (
              <p className="mt-4 text-center text-sm text-muted" role={polyJob || polyTake ? "status" : undefined}>
                {polyJob
                  ? "正在多音听写，识别完会在「听写与音频」里出草稿。"
                  : polyTake
                    ? "多音草稿已出，请在「听写与音频」里试听、确认写入。"
                    : "还没有音符。写唱名，或点下面的例子。"}
              </p>
            )}
            {face.follow ? (
              <p className="mt-1 text-center text-sm text-muted">{face.follow}</p>
            ) : null}
            <div className="no-print mt-4 flex flex-wrap items-center justify-center gap-2">
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="正在改的声部">
                {Array.from({ length: Math.max(2, voiceList(score).length) }, (_, voice) => (
                  <button key={voice} type="button" role="radio" aria-checked={activeVoice === voice}
                    className={activeVoice === voice ? solid : quiet} disabled={voice >= voiceList(score).length}
                    onClick={() => switchVoice(voice)}>{voiceLabel(voice)}</button>
                ))}
              </div>
              {hasSecondVoice(score) ? (
                <button type="button" className={quiet} onClick={deleteSecondVoice}>
                  {activeVoice > 1 ? `去掉${voiceLabel(activeVoice)}` : "去掉第二声部"}
                </button>
              ) : (
                <button type="button" className={quiet} onClick={createSecondVoice}>
                  加上第二声部
                </button>
              )}
            </div>
            {hasSecondVoice(score) && voiceList(score).length < MAX_VOICES ? <button type="button" className={quiet} onClick={createSecondVoice}>加上第{["一", "二", "三", "四", "五", "六", "七", "八", "九", "十", "十一", "十二", "十三", "十四", "十五", "十六"][voiceList(score).length]}声部</button> : null}
            <p className="no-print mt-2 text-center text-sm text-muted">
              {hasSecondVoice(score)
                ? `正在改${voiceNameOf(activeVoice)}。换声部不会清掉其他行。各声部节奏可以不一样，短的那行后面是空的，谱上补的休止不写进音符里。`
                : "现在只有声部一。加上第二声部后，可以单独改它的音和节奏。"}
            </p>
            </>)}
          </div>
        </div>
      </Zone>

      {scoreImage && <Suspense fallback={<p>正在打开多页对照…</p>}><ScoreImagePanel onNavigate={(target) => { setPracticeOpen(false); setActiveFeature(target); requestAnimationFrame(() => document.getElementById(target)?.scrollIntoView({ block: "start" })); }} decode={musicXmlToScore} files={scoreImage} onClose={() => setScoreImage(undefined)}
        onAttempt={(event) => {
          setRecognitionDraft(null);
          if (event.phase === "start") setNotice(null);
          if (event.phase === "fail") {
            setNotice("这张图没有识别成功。屏幕上的谱还是上一次的，没有换成这张图。");
          }
        }}
        onConfirm={(next, losses, source) => {
          setDetected(null);
          setMidiSession(null);
          const score = next.tempoMarked === false
            ? { ...next, bpm: scoreRef.current.bpm, tempoMarked: false as const }
            : next;
          setRecognitionDraft({ score, gaps: losses, images: source?.images, currentImage: source?.current });
          setImportReport({ zone: "input", source: "本站识谱服务", losses, notes: [] });
          setPracticeOpen(false);
          setActiveFeature("zone-input");
          setNotice("识别结果已打开对照预览，请校对后写入主谱。");
        }} /></Suspense>}

      {recognitionDraft && <Suspense fallback={<p>正在打开识别草稿…</p>}><RecognitionDraft ScoreView={JianpuView} shiftNotes={shiftSelection} key={`${recognitionDraft.score.title}-${recognitionDraft.score.notes.length}-${recognitionDraft.gaps.length}-${recognitionDraft.images?.[0]?.url ?? "no-image"}`} initial={recognitionDraft.score} gaps={recognitionDraft.gaps}
        images={recognitionDraft.images} currentImage={recognitionDraft.currentImage}
        onClose={() => setRecognitionDraft(null)} onConfirm={next => { publish(next, "other"); setRecognitionDraft(null); setScorePaint((n) => n + 1); setNotice("识别草稿已写入主谱。返回首页后再打开，这次不能撤销。"); }} /></Suspense>}

      <Zone
        id="zone-input" active={shownFeature === "zone-input"}
        title="写谱"
        hint="用简谱、音名或键盘写进来，也可以直接点一首例子。写错了就撤销。"
      >
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="输入方式">
          {(
            [
              ["jianpu", "简谱"],
              ["letters", "音名"],
              ["piano", "键盘"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              className={tab === id ? solid : quiet}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>


        {tab === "jianpu" ? (
          <div className="mt-3">
            <div className="flex items-center justify-between gap-2">
              <label className="text-sm text-muted" htmlFor="jianpu">
                唱名（{voiceNameOf(activeVoice)}）
              </label>
              {!voiceNotes(score, activeVoice).length ? (
                <button type="button" className={quiet} onClick={() => onJianpu(JIANPU_SAMPLE)}>
                  填入示例
                </button>
              ) : null}
            </div>
            <textarea
              onCompositionStart={() => { jianpuComposing.current = true; }}
              onCompositionEnd={(event) => { jianpuComposing.current = false; onJianpu(event.currentTarget.value); }}
              id="jianpu"
              value={jianpu}
              onChange={(event) => onJianpu(event.target.value)}
              onFocus={() => {
                jianpuFocus.current = true;
              }}
              onBlur={() => {
                jianpuFocus.current = false;
                textEditRef.current = null;
                if (jianpuComposing.current) return;
                const imported = importJianpu(jianpu, scoreRef.current, instrumentInfo.shift);
                if (!imported.error) {
                  setJianpu(
                    formatJianpu({
                      ...scoreRef.current,
                      key: imported.key,
                      beats: imported.beats,
                      beatUnit: imported.beatUnit,
                      tonicOctave: imported.tonicOctave,
                      notes: imported.notes,
                    }),
                  );
                }
              }}
              spellCheck={false}
              className="mt-2 min-h-32 w-full rounded-2xl border border-line bg-bg p-4 text-base leading-relaxed tracking-wide text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              placeholder="1 1 5 5 6 6 5 -"
            />
            <p className="mt-2 text-sm text-muted">空格分开，1–7 是唱名，0 是休止，5- 延长一拍。</p>
            <details className="syntax-help">
              <summary aria-label="唱名写法说明">?<span className="ml-1">更多写法</span></summary>
              <ul>
                <li><b>八度</b>：高八度加 '，低八度加 ,（如 5' 和 5,）。</li>
                <li><b>附点</b>：5. 是附点；5.6 和 (5.6) 都是附点加后面的短音。</li>
                <li><b>一拍多音</b>：12 占一拍（两个八分），123 是三连音。</li>
                <li><b>和弦</b>：同一拍写成 [1,3,5]；低八度的 5 和 1 写成 [5,+1]，一组最多八个音。12 仍是两个音，不是和弦。</li>
                <li><b>调和拍号</b>：开头写「1 = 调名」和拍号会改调，不当成音符。选了乐器时，调名按记谱调换回实际音高。</li>
                <li>这一框只改{voiceNameOf(activeVoice)}。</li>
              </ul>
            </details>
            <div className="tap-dock">
            <TapPad
              duration={duration}
              dotted={dotted}
              octave={tapOctave}
              accidental={tapAccidental}
              audition={tapAudition}
              stack={stackChord}
              cursorLabel={tapCursorLabel(editingNotes, selected.length ? tapCursor(editingNotes, selected) : Math.min(tapCursorAt ?? editingNotes.length, editingNotes.length))}
              canBackspace={(selected.length ? tapCursor(editingNotes, selected) : Math.min(tapCursorAt ?? editingNotes.length, editingNotes.length)) > 0}
              atEnd={!selected.length && tapCursorAt == null}
              onDuration={setDuration}
              onDotted={() => setDotted((value) => !value)}
              onOctave={(delta) => setTapOctave((value) => clampTapOctave(value + delta))}
              onAccidental={setTapAccidental}
              onAudition={() => setTapAudition((on) => !on)}
              onStack={() => {
                setStackChord((on) => {
                  if (on) chordAnchorRef.current = null;
                  return !on;
                });
              }}
              onDigit={tapDigit}
              onBackspace={tapBack}
              onEnd={tapToEnd}
            />
              <div className="write-actions mt-2 flex flex-wrap gap-2">
                <button type="button" className={quiet} onClick={dropLast}>
                  删掉末音
                </button>
                <button type="button" className={quiet} onClick={clearNotes}>
                  <Trash2 className="size-4" />
                  清空这一声部
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {tab === "letters" ? (
          <div className="mt-3">
            <label className="text-sm text-muted" htmlFor="letters">
              音名（{voiceNameOf(activeVoice)}）
            </label>
            <textarea
              onCompositionStart={() => { lettersComposing.current = true; }}
              onCompositionEnd={(event) => { lettersComposing.current = false; onLetters(event.currentTarget.value); }}
              id="letters"
              value={letters}
              onChange={(event) => onLetters(event.target.value)}
              onFocus={() => {
                letterFocus.current = true;
              }}
              onBlur={() => {
                letterFocus.current = false;
                textEditRef.current = null;
                if (lettersComposing.current) return;
                const parsed = parseLetters(letters);
                if (!parsed.error)
                  setLetters(formatLetters({ ...scoreRef.current, notes: parsed.notes }));
              }}
              spellCheck={false}
              className="mt-2 min-h-32 w-full rounded-2xl border border-line bg-bg p-4 font-sans text-base leading-relaxed text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              placeholder="C4 D4 E4 F4 | G4 A4 B4 C5"
            />
            <p className="mt-2 text-sm text-muted">如 C4 D4 E4 F#4，z 是休止，- 延长一拍。</p>
            <details className="syntax-help">
              <summary aria-label="音名写法说明">?<span className="ml-1">更多写法</span></summary>
              <ul>
                <li><b>时值</b>：写在斜线后，/h 二分，/e 八分，/q. 附点四分。</li>
                <li><b>和弦</b>：写成 [C4,E4,G4]，一组最多八个音，多了会提示。</li>
              </ul>
            </details>
          </div>
        ) : null}

        {tab === "piano" ? (
          <div className="mt-3 rounded-2xl border border-line bg-bg p-3">
            <div className="mb-3 flex flex-wrap gap-2">
              {[
                [4, "全"],
                [2, "二分"],
                [1, "四分"],
                [0.5, "八分"],
                [0.25, "十六"],
              ].map(([value, label]) => (
                <button
                  key={label}
                  type="button"
                  aria-pressed={duration === value}
                  className={duration === value ? solid : quiet}
                  onClick={() => setDuration(Number(value))}
                >
                  {label}
                </button>
              ))}
              <button
                type="button"
                aria-pressed={dotted}
                className={dotted ? solid : quiet}
                onClick={() => setDotted((value) => !value)}
              >
                附点
              </button>
              <button type="button" className={quiet} onClick={addRest}>
                加休止
              </button>
              <button
                type="button"
                aria-pressed={stackChord}
                className={stackChord ? solid : quiet}
                onClick={() => {
                  setStackChord((on) => {
                    if (on) chordAnchorRef.current = null;
                    return !on;
                  });
                }}
              >
                叠和弦
              </button>
            </div>
            <div className="mb-3 flex gap-2">
              <button
                type="button"
                className={quiet}
                onClick={() => setPianoBase((value) => Math.max(36, value - 12))}
              >
                键盘低八度
              </button>
              <button
                type="button"
                className={quiet}
                onClick={() => setPianoBase((value) => Math.min(72, value + 12))}
              >
                键盘高八度
              </button>
            </div>
            <Piano base={pianoBase} onPick={addPitch} />
            <p className="mt-3 text-sm text-muted">先选时值，再点琴键，音接到曲子末尾。</p>
            <details className="syntax-help">
              <summary aria-label="键盘输入说明">?<span className="ml-1">叠和弦怎么用</span></summary>
              <p>打开「叠和弦」后，第一下新起一组，接着点的音叠在同一拍。先点谱上的一个符头，再叠，就加在那一拍。一组最多八个音。</p>
            </details>
          </div>
        ) : null}
        <div className="write-actions mt-3 flex flex-wrap gap-2" hidden={tab === "jianpu"}>
          <button type="button" className={quiet} onClick={dropLast}>
            删掉末音
          </button>
          <button type="button" className={quiet} onClick={clearNotes}>
            <Trash2 className="size-4" />
            清空这一声部
          </button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {EXAMPLES.map((example) => (
            <button
              key={example.id}
              type="button"
              className={quiet}
              onClick={() => loadExample(example)}
            >
              {example.title}
            </button>
          ))}
          <button type="button" className={quiet} onClick={() => jpwRef.current?.click()}>
            <Upload className="size-4" />导入 123 / 番茄 / JP-Word / ABC
          </button>
          <input ref={jpwRef} type="file" accept={TEXT_FORMAT_ACCEPT} aria-label="选择文本谱文件（JP-Word、123、番茄、ABC）" className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void onTextScoreFile(file);
            }} />
          <button type="button" className={quiet} onClick={() => gp5Ref.current?.click()}>
            <Upload className="size-4" />导入 Guitar Pro .gp5
          </button>
          <input ref={gp5Ref} type="file" accept=".gp5" aria-label="选择 Guitar Pro 5 文件" className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void onGp5File(file);
            }} />
          <button type="button" className={quiet} onClick={() => xmlRef.current?.click()}>
            <Upload className="size-4" />
            导入 MusicXML / .mxl
          </button>
          <input
            ref={xmlRef}
            type="file"
            accept=".musicxml,.xml,.mxl,application/vnd.recordare.musicxml,application/vnd.recordare.musicxml+xml,application/xml,text/xml"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void onMusicXmlFile(file);
            }}
          />
        </div>
        {gp5Preview ? (
          <section className="mt-3 rounded-2xl border border-line bg-paper p-3" aria-label="GP5 导入预览">
            <h3 className="font-medium">GP5 导入预览：{gp5Preview.score.title}</h3>
            <p className="text-sm">{gp5Preview.score.bpm} BPM · {gp5Preview.score.beats}/{gp5Preview.score.beatUnit} · {gp5Preview.score.notes.length} 个主声部事件</p>
            <JianpuView score={gp5Preview.score} shift={0} sounding={[]} selected={[]} activeVoice={0} onPick={() => {}} width={560} />
            <ImportLosses report={{ source: "GP5", losses: gp5Preview.losses, notes: gp5Preview.notes }} onClose={() => setGp5Preview(null)} />
            <button type="button" className={quiet} disabled={busy || recording} onClick={() => {
              setDetected(null);
              setMidiSession(null);
              publish(gp5Preview.score, "other");
              setImportReport({ zone: "input", source: "GP5", losses: gp5Preview.losses, notes: gp5Preview.notes });
              setNotice("已导入 GP5，可撤销恢复原谱。");
              setGp5Preview(null);
            }}>确认整谱导入 GP5</button>
            <button type="button" className={quiet} onClick={() => setGp5Preview(null)}>取消预览</button>
            <a className="text-sm underline" href="licenses/alphatab-MPL-2.0.txt" target="_blank" rel="noreferrer">alphaTab MPL-2.0 许可</a>
            <a className="ml-2 text-sm underline" href="https://github.com/CoderLine/alphaTab/tree/v1.8.3" target="_blank" rel="noreferrer">alphaTab 源码</a>
          </section>
        ) : null}
        <label className="mt-3 block text-sm text-muted" htmlFor="text-score-paste">粘贴 123 / 番茄 / JP-Word / ABC 文本</label>
        <textarea
          id="text-score-paste"
          className="text-score-paste mt-1 rounded-2xl border border-line bg-bg p-3 text-sm leading-relaxed text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          spellCheck={false}
          value={textPaste}
          onChange={(event) => setTextPaste(event.target.value)}
          placeholder="把 123、番茄、JP-Word、ABC 文本或 irealb:// 链接贴在这里"
        />
        <button type="button" className={clsx(quiet, "mt-2")} onClick={() => void onTextScorePaste()}>
          导入粘贴的文本
        </button>
        {importReport?.zone === "input" ? <ImportLosses report={importReport} onClose={() => setImportReport(null)} /> : null}
        <details className="zone-help"><summary>了解更多</summary><p className="mt-2 text-sm text-muted">
          简谱、音名、键盘、听写和风格改编都只改正在写的声部，其他声部还留着。MusicXML
          最多留下十六个声部；另一行乐器会说明已略过。MIDI
          选一条音轨放进正在改的声部，这条上同时响的音收成和弦（最多四个）。不会把整首编曲一次导入。文本谱支持 JP-Word（.jpwabc）、123（.123）、番茄简谱（.jps）、ABC（.abc，只读第一首的第一个声部）与 iReal Pro 链接（取第一首的和弦），会替换整谱；每次导入后都会列出这次丢失了什么。也可以把文本贴在上面的框里导入。
        </p></details>

        <RepeatBar summary={repeatsSummary(score)} jumps={jumpsSummary(score)} canEdit={selected.length > 0} onEdit={editRepeat} onJump={editJump} quiet={quiet} />
        <Suspense fallback={null}>
          <TempoMarkBar
            score={score}
            at={selected[0] == null ? null : voiceNotes(score, activeVoice).slice(0, selected[0]).reduce((sum, note) => sum + note.dur, 0)}
            endAt={(() => {
              if (selected.length < 2) return null;
              const notes = voiceNotes(score, activeVoice);
              const last = Math.max(...selected);
              if (!notes[last]) return null;
              return notes.slice(0, last).reduce((sum, note) => sum + note.dur, 0) + notes[last].dur;
            })()}
            canEdit={!shared && !busy && selected.length > 0}
            quiet={quiet}
            onChange={(next, notice) => { commit(next); setNotice(notice); }}
          />
          <MeterMarkBar
            score={score}
            at={selected[0] == null ? null : voiceNotes(score, activeVoice).slice(0, selected[0]).reduce((sum, note) => sum + note.dur, 0)}
            canEdit={!shared && !busy && selected.length > 0}
            quiet={quiet}
            onChange={(next, notice) => { commit(next); setNotice(notice); }}
          />
          <KeyMarkBar
            score={score}
            at={selected[0] == null ? null : voiceNotes(score, activeVoice).slice(0, selected[0]).reduce((sum, note) => sum + note.dur, 0)}
            canEdit={!shared && !busy && selected.length > 0}
            quiet={quiet}
            onChange={(next, notice) => { commit(next); setNotice(notice); }}
          />
          <RehearsalBar
            score={score}
            at={selected[0] == null ? null : voiceNotes(score, activeVoice).slice(0, selected[0]).reduce((sum, note) => sum + note.dur, 0)}
            canEdit={!shared && !busy && selected.length > 0}
            quiet={quiet}
            onChange={(next, notice) => { commit(next); setNotice(notice); }}
          />
          <CreditsBar
            score={score}
            canEdit={!shared && !busy}
            quiet={quiet}
            onChange={(next, notice) => { commit(next); setNotice(notice); }}
          />
        </Suspense>
      </Zone>

      <Zone
        id="zone-expression" active={shownFeature === "zone-expression"}
        title="表情记号"
        hint="点谱上的符头。要选一串，先点「选一段」，再点开头和结尾。力度从那个音往后生效。撤销可以收回。"
      >
        <ExpressionBar
          score={voiceView(score, activeVoice)}
          selected={selected}
          rangeMode={rangeMode}
          notice={markNotice}
          onRangeMode={setRangeMode}
          onStep={stepSelection}
          onMark={mark}
          onEdit={editSelection}
          onFermata={markFermata}
          voice={activeVoice}
          voiceName={voiceNameOf(activeVoice)}
        />
      </Zone>

      <Zone
        id="zone-lyrics" active={shownFeature === "zone-lyrics"}
        title="歌词"
        hint="每个字对一个音。点符头可以把一个字写到那个音上。写错了就点撤销。"
      >
        <LyricBar
          score={voiceView(score, activeVoice)}
          selected={selected}
          line={lyricLine}
          entry={lyricEntry}
          notice={lyricNotice}
          onLine={setLyricLine}
          onEntry={setLyricEntry}
          onFill={fillLyrics}
          onWrite={writeLyricAtSelection}
          onBlank={blankLyricAtSelection}
          onRemove={removeLyricAtSelection}
          onClear={removeAllLyrics}
        />
        {shownFeature === "zone-lyrics" ? <Suspense fallback={null}><ChordProPanel score={score} fileBase={exportFileBase(score.title)} disabled={shared || busy || recording}
          onApply={(next, message) => { publish(next, "other"); setNotice(message); }} /></Suspense> : null}
      </Zone>

      <Zone
        id="zone-key" active={shownFeature === "zone-key"}
        title="移调与乐器"
        hint="半音和调名会改实际音高。乐器按钮只改记谱，播放还是原来的音。红色符头超出这件乐器学生常用的音域。"
      >
        <section className="tool-group" aria-labelledby="group-shift">
        <h3 id="group-shift" className="tool-group-title">移调<span>整首一起升降，实际音高会变</span></h3>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <button type="button" className={quiet} onClick={() => nudge(-12)}>
            低八度
          </button>
          <button type="button" className={quiet} onClick={() => nudge(-1)}>
            <Minus className="size-4" />
            低半音
          </button>
          <p className="min-w-28 px-2 text-center font-display text-xl font-medium">
            <span className="block text-xs font-sans font-normal text-muted">实际音高</span>
            <span key={face.keyLine} className={motionEpoch ? "score-swap" : undefined}>
              {face.keyLine}
            </span>
          </p>
          <button type="button" className={quiet} onClick={() => nudge(1)}>
            <Plus className="size-4" />
            高半音
          </button>
          <button type="button" className={quiet} onClick={() => nudge(12)}>
            高八度
          </button>
        </div>
        </section>
        <section className="tool-group" aria-labelledby="group-key">
        <h3 id="group-key" className="tool-group-title">目标调<span>点一个调，整首移过去</span></h3>
        <div
          className="grid grid-cols-6 gap-2 sm:grid-cols-12"
          role="group"
          aria-label="移到这个调"
        >
          {KEY_NAMES.map((key) => (
            <button
              key={key}
              type="button"
              aria-pressed={score.key === key}
              className={clsx(score.key === key ? solid : quiet, "px-0")}
              onClick={() => pickKey(key)}
            >
              {keyLabel(key)}
            </button>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-center gap-2" role="group" aria-label="大调或小调">
          {(["major", "minor"] as Mode[]).map((mode) => (
            <button
              key={mode}
              type="button"
              aria-pressed={score.mode === mode}
              className={score.mode === mode ? solid : quiet}
              onClick={() => publish({ ...scoreRef.current, mode }, "other")}
            >
              {mode === "major" ? "大调" : "小调"}
            </button>
          ))}
        </div>
        </section>
        <section className="tool-group" aria-labelledby="group-meter">
        <h3 id="group-meter" className="tool-group-title">拍号、速度与谱号</h3>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <label className="flex items-center gap-2 text-sm text-muted">
            拍号
            <select
              className={field}
              value={meter}
              disabled={!lazyExampleReady}
              onChange={(event) => {
                const [beats, beatUnit] = event.target.value.split("/").map(Number);
                publish({ ...scoreRef.current, beats, beatUnit }, "other");
              }}
            >
              {meters.map((option) => (
                <option key={option}>{option}</option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm text-muted">
            速度
            <input
              className={clsx(field, "w-20 tabular-nums")}
              inputMode="numeric"
              type="number"
              min={36}
              max={220}
              value={score.bpm}
              disabled={!lazyExampleReady}
              onChange={(event) => {
                const bpm = Math.min(
                  220,
                  Math.max(36, Number(event.target.value) || scoreRef.current.bpm),
                );
                const { tempoMarked: _marked, ...rest } = scoreRef.current;
                commit({ ...rest, bpm });
              }}
            />
          </label>
          <p className="w-full text-center text-xs text-muted">要在中途改速、改拍号或转调，请到写谱里的「途中速度」、「途中拍号」和「途中转调」。</p>
          <label className="flex items-center gap-2 text-sm text-muted">
            谱号
            <select
              className={field}
              value={score.clef}
              disabled={!lazyExampleReady}
              onChange={(event) =>
                commit({ ...scoreRef.current, clef: event.target.value as Clef })
              }
            >
              <option value="treble">高音</option>
              <option value="bass">低音</option>
            </select>
          </label>
        </div>
        </section>
        <section className="tool-group" aria-labelledby="group-instrument">
        <h3 id="group-instrument" className="tool-group-title">乐器<span>只改记谱，播放还是原来的音</span></h3>
        <div
          className="flex flex-wrap justify-center gap-2"
          role="group"
          aria-label="乐器移调"
        >
          {INSTRUMENTS.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={instrument === item.id}
              className={instrument === item.id ? solid : quiet}
              onClick={() => setInstrument(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="mt-3 flex justify-center">
          <button
            type="button"
            aria-pressed={markRange}
            aria-describedby="range-help"
            className={markRange ? solid : quiet}
            onClick={() => setMarkRange((on) => !on)}
          >
            标出超音域
          </button>
        </div>
        <p className="mt-2 text-center text-sm text-muted">{instrumentInfo.hint}</p>
        <p id="range-help" className="mt-2 text-center text-sm leading-relaxed text-muted">
          红色符头比这件乐器通常能吹的音更高或更低。这里用的是学生常用音域，不是专业演奏的极限。检查的是记谱音高，不是实际音高。和弦里只把超出去的那个音标红。原调不对应某一件乐器，所以不标。关掉「标出超音域」后，文字还在，谱上的音不变。
        </p>
        </section>
        <section className="tool-group" aria-labelledby="group-jianpu-naming">
        <h3 id="group-jianpu-naming" className="tool-group-title">简谱唱名<span>只改看谱，不改实际音高；点按输入仍按首调</span></h3>
        <div className="segmented" role="radiogroup" aria-label="简谱唱名">
          <button type="button" aria-checked={!fixedDo} onClick={() => setFixedDo(false)}>首调</button>
          <button type="button" aria-checked={fixedDo} onClick={() => setFixedDo(true)}>固定调</button>
        </div>
        {fixedDo ? (
          <p className="mt-2 text-center text-sm text-muted">谱上数字按 1=C 记；原调不变。打印仍按首调。</p>
        ) : null}
        </section>
        <section className="tool-group" aria-labelledby="group-swing">
        <h3 id="group-swing" className="tool-group-title">摇摆<span>只改播放，谱面写法不变</span></h3>
        <div className="segmented" role="radiogroup" aria-label="摇摆节奏" data-swing-feel={swingFeel}>
          {([["straight", "直拍"], ["light", "轻摆"], ["swing", "摇摆"]] as const).map(([feel, label]) => (
            <button key={feel} type="button" role="radio" aria-checked={swingFeel === feel}
              onClick={() => setSwingFeel(feel)}>
              {label}
            </button>
          ))}
        </div>
        {swingFeel !== "straight" ? (
          <p className="mt-2 text-center text-sm text-muted">复合拍（如 6/8）仍按原谱。节拍器打在正拍上。</p>
        ) : null}
        </section>
      </Zone>

      <Zone
        id="zone-style" active={shownFeature === "zone-style"}
        title="辅助模块"
        hint="编曲、和弦、指法与视奏按需打开；练习工具和混音也在这里。应用后可撤销。"
      >
        <button type="button" className={quiet} onClick={() => setPracticeOpen(true)}>练习工具与混音</button>
        {auxiliary ? <Suspense fallback={<p>正在打开辅助模块…</p>}>
        <ChordSymbolsPanel
          score={score}
          selected={selected}
          activeVoice={activeVoice}
          onChange={(next, notice) => {
            commit(next);
            setNotice(notice);
          }}
          comp={compOn}
          onComp={setCompOn}
        />
        <FingeringPanel
          score={score}
          show={showFingering}
          onShow={setShowFingering}
          onGenerate={generateFingering}
          onClear={clearFingeringMarks}
          selected={selected}
          activeVoice={activeVoice}
          onSetFinger={setNoteFinger}
          quiet={quiet}
          solid={solid}
        />
        <Suspense fallback={null}>
          <SightReadPanel
            score={score}
            onPlay={auditionSight}
            onWrite={applySight}
          />
        </Suspense>
        </Suspense> : null}
        {auxiliaryError && <p role="alert">辅助模块未能加载，请切换面板重试。</p>}
        <h3 className="mt-3 font-medium">编曲 / 风格改编</h3>
        <p className="text-sm text-muted">先选一种风格预览，试听满意再应用；应用后也能撤销。</p>
        <div className="mt-2 grid grid-cols-3 gap-2" role="group" aria-label="风格改编">
          {ARRANGE_STYLES.map((style) => (
            <button
              key={style.id}
              type="button"
              className={stack}
              aria-pressed={stylePreview?.style === style.id}
              disabled={!canPlay}
              onClick={() => previewStyle(style.id)}
            >
              <span>{style.label}</span>
              <span className="text-xs font-normal text-muted">{style.detail}</span>
            </button>
          ))}
        </div>
        {stylePreview ? (
          <div ref={stylePreviewBox} className="style-preview mt-3" role="group" aria-label="改编预览">
            <p className="text-sm text-ink">
              预览「{ARRANGE_STYLES.find((item) => item.id === stylePreview.style)?.label}」：{voiceNameOf(stylePreview.voice)}
              从 {stylePreview.from} 个音变成 {stylePreview.to} 个音，还没有写进谱面。
            </p>
            {stylePreview.lost > 0 ? (
              <p className="mt-1 text-sm text-warn">应用后，改动过的 {stylePreview.lost} 个音会去掉歌词；没改的音歌词还在。</p>
            ) : null}
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" className={quiet} onClick={auditionStyle}>
                {playing ? <Pause className="size-4" aria-hidden="true" /> : <Play className="size-4" aria-hidden="true" />}
                {playing ? "停止试听" : "试听"}
              </button>
              <button type="button" className={solid} onClick={applyStyle}>应用到谱面</button>
              <button type="button" className={quiet} onClick={() => { halt(); setStylePreview(null); }}>取消</button>
            </div>
          </div>
        ) : null}
        <p className="mt-3 text-sm leading-relaxed text-muted">{ARRANGE_LIMIT}</p>
        <div className="mt-5">
          <h3 className="text-sm font-medium text-ink">降低难度</h3>
          <p className="mt-1 text-sm leading-relaxed text-muted">
            按规则简化，不是重新配和声。会尽量留住旋律最高音与低音，减少内声部、限制跨度、合并过密的节奏。先预览试听，再写入，并可撤销。
          </p>
          <div className="mt-2 grid grid-cols-3 gap-2" role="group" aria-label="降低难度">
            {SIMPLIFY_LEVELS.map((level) => (
              <button
                key={level.id}
                type="button"
                className={stack}
                aria-pressed={simplifyPreview?.level === level.id}
                disabled={!canPlay}
                onClick={() => previewSimplify(level.id)}
              >
                <span>{level.label}</span>
                <span className="text-xs font-normal text-muted">{level.detail}</span>
              </button>
            ))}
          </div>
          {simplifyPreview ? (
            <div className="style-preview mt-3" role="group" aria-label="降难度预览">
              <p className="text-sm text-ink">
                预览「{SIMPLIFY_LEVELS.find((item) => item.id === simplifyPreview.level)?.label}」：音的数量从 {describeSimplify(simplifyPreview.base, simplifyPreview.score).from} 变成 {describeSimplify(simplifyPreview.base, simplifyPreview.score).to}，还没有写进谱面。
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" className={quiet} onClick={auditionSimplify}>
                  {playing ? <Pause className="size-4" aria-hidden="true" /> : <Play className="size-4" aria-hidden="true" />}
                  {playing ? "停止试听" : "试听"}
                </button>
                <button type="button" className={solid} onClick={applySimplify}>应用到谱面</button>
                <button type="button" className={quiet} onClick={() => { halt(); setSimplifyPreview(null); }}>取消</button>
              </div>
            </div>
          ) : null}
        </div>
        {styleNotice ? <p className="mt-2 text-sm text-muted" role="status">{styleNotice}</p> : null}
      </Zone>

      <Zone
        id="zone-play" active={shownFeature === "zone-play"}
        title="打印与导出"
        hint="打印用浏览器自己的打印（可存成 PDF），不经过服务器。下载的文件都在本机生成。复制的简谱带调名和拍号，可以再贴回去。"
      >
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={solid}
            onClick={() =>
              void printGen.current.print(printInput, buildPrintSheet, setPrintStatus, () =>
                window.print(),
              )
            }
          >
            <Printer className="size-4" />
            {printStatus === "error" ? "重试打印" : "打印"}
          </button>
          <label className="flex items-center gap-2 text-sm text-muted">
            谱面
            <select aria-label="打印与图片谱面" className={field} value={chosenExportView ?? "follow"}
              onChange={event => setChosenExportView(event.target.value === "follow" ? null : event.target.value as ExportView)}>
              <option value="follow">跟随编辑视图（{scoreView === "staff" || scoreView === "roll" ? "五线谱" : scoreView === "lead" ? "和弦谱" : scoreView === "tab" ? "六线谱" : "简谱"}）</option>
              <option value="jianpu">简谱</option><option value="staff">五线谱</option><option value="tab">六线谱</option>
            </select>
          </label>
        </div>
        {printStatus === "error" && (
          <p role="alert" className="mt-2 text-sm text-warn">
            打印谱面生成失败，请重试打印。
          </p>
        )}
        <h3 className="mt-3 text-sm font-medium text-ink">下载与分享</h3>
        <ul className="export-list mt-2">
          <li>
            <button type="button" className={quiet} onClick={() => void downloadPng()}>
              <Download className="size-4" />
              PNG
            </button>
            <span>图片，发微信或插进文档。</span>
          </li>
          <li>
            <button type="button" className={quiet} onClick={() => void downloadSvg()}>
              SVG
            </button>
            <span>矢量图，放大不糊，适合排版印刷。</span>
          </li>
          <li>
            <button type="button" className={quiet} onClick={downloadMidi}>
              MIDI
            </button>
            <span>音符和速度，可导入库乐队、MuseScore 等软件播放。</span>
          </li>
          <li>
            <button type="button" className={quiet} onClick={downloadMusicXml}>
              导出 MusicXML
            </button>
            <button type="button" className={quiet} onClick={downloadMusicXmlTab}>
              导出 MusicXML 六线谱
            </button>
            <span>乐谱交换格式，在 MuseScore、Finale、Dorico 里接着改。六线谱为标准调弦的 TAB 谱（可改贝斯四弦），不含 Guitar Pro（.gp5）。</span>
          </li>
          <li>
            <button type="button" className={quiet} onClick={() => void copyJianpu()}>
              复制简谱
            </button>
            <span>复制唱名文字，可贴回谱线或发给别人。</span>
          </li>
          <li>
            <button type="button" className={quiet} onClick={() => void copyShareLink()}>
              复制分享链接
            </button>
            <span>只读链接，对方可查看、播放和练习。太长时请改发文件。</span>
          </li>
          <li>
            <button type="button" className={quiet} onClick={downloadJianpuLy}>
              导出 jianpu-ly（.jly）
            </button>
            <span>简谱排版源文件，需配合电脑上的排版工具（见「高级」）。</span>
          </li>
          <li>
            <button type="button" className={quiet} onClick={downloadJpwabc}>
              导出 JP-Word（.jpwabc）
            </button>
            <span>
              {jpwPreview.error
                ? jpwPreview.error
                : jpwPreview.losses.length
                  ? `单声部简谱文本。这首导出会丢失：${jpwPreview.losses.join("、")}。`
                  : "单声部简谱文本（UTF-16），可在 JP-Word 里接着改，再导回谱线。"}
            </span>
          </li>
          <li>
            <button type="button" className={quiet} onClick={download123}>
              导出 123（.123）
            </button>
            <span>谱线自己的简谱文本，改完可再导回；途中速度、拍号、转调、延长和渐快渐慢会写进去。</span>
          </li>
          <li>
            <button type="button" className={quiet} onClick={() => void downloadAbc()}>
              导出 ABC（.abc）
            </button>
            <span>纯文本五线谱，ABC 编辑器都能打开，改完可再导回谱线；导出时列出没写进去的内容。</span>
          </li>
        </ul>
        <details className="zone-help mt-2">
          <summary>纸张与排版</summary>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-sm text-muted">
              纸张
              <select
                aria-label="纸张"
                className={field}
                value={printSettings.paper}
                onChange={(event) => {
                  const paper: PaperId = event.target.value === "letter" ? "letter" : "a4";
                  setPrintSettings((current) => normalizePrintSettings({ ...current, paper }));
                }}
              >
                <option value="a4">A4</option>
                <option value="letter">Letter</option>
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm text-muted">
              页边
              <select
                aria-label="页边"
                className={field}
                value={String(printSettings.marginMm)}
                onChange={(event) => {
                  setPrintSettings((current) =>
                    normalizePrintSettings({ ...current, marginMm: Number(event.target.value) }),
                  );
                }}
              >
                <option value="10">10 毫米</option>
                <option value="12">12 毫米</option>
                <option value="16">16 毫米</option>
                <option value="20">20 毫米</option>
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm text-muted">
              谱面
              <select
                aria-label="谱面大小"
                className={field}
                value={String(printSettings.scale)}
                onChange={(event) => {
                  setPrintSettings((current) =>
                    normalizePrintSettings({ ...current, scale: Number(event.target.value) }),
                  );
                }}
              >
                <option value="0.85">较小</option>
                <option value="1">标准</option>
                <option value="1.15">较大</option>
                <option value="1.3">大</option>
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm text-muted">
              每行
              <select
                aria-label="每行小节"
                className={field}
                value={String(printSettings.measuresPerSystem)}
                onChange={(event) => {
                  const raw = event.target.value;
                  const measuresPerSystem: MeasuresPerSystem =
                    raw === "2" ? 2 : raw === "3" ? 3 : raw === "4" ? 4 : "auto";
                  setPrintSettings((current) =>
                    normalizePrintSettings({ ...current, measuresPerSystem }),
                  );
                }}
              >
                <option value="auto">自动</option>
                <option value="2">2 小节</option>
                <option value="3">3 小节</option>
                <option value="4">4 小节</option>
              </select>
            </label>
          </div>
          <p className="mt-2 text-sm text-muted">分页只排版，不改音、休止和歌词。</p>
        </details>
        <details className="zone-help mt-3">
          <summary>高级：用 jianpu-ly 与 LilyPond 排版</summary>
          <p className="mt-2 text-sm text-muted">
            .jly 按当前乐器的记谱音高导出简谱。仅下载文本；本机需 Python、jianpu-ly 与 LilyPond。
            力度、奏法和装饰等不导出；仅支持两声部、第 1 段歌词，不支持反复。和弦或不支持的节奏会提示并停止导出。
            本机命令：<code>jianpu-ly &lt; 曲谱.jly &gt; 曲谱.ly</code>，再运行 <code>lilypond 曲谱.ly</code> 生成 PDF。
          </p>
        </details>
        <details className="zone-help"><summary>MusicXML 会带走什么</summary><p className="mt-3 text-sm text-muted">
          MusicXML 给 MuseScore、Dorico、Finale。文件里是实际音高，和 MIDI
          一样。同一条旋律上的和弦会带走，第 1
          段歌词也会带走。两个声部会分写在两行谱上，并按时间对齐。第三声部或另一行乐器不会自动全部导入。简谱和
          MIDI 不含歌词。MIDI 仍是选一条音轨，放进正在改的声部。文件里如果还有第 2
          段歌词，读进来时会说明，不会并到同一排字上。导出 MusicXML 六线谱时按当前调弦（吉他标准或贝斯四弦）写下弦品；无法落品的音仍保留音高并提示，不会改写原谱。
        </p></details>
      </Zone>

      <Zone
        id="zone-audio" active={shownFeature === "zone-audio"}
        title="听写与音频"
        hint={`${MUSIC_UPLOAD_HELP} 哼一段单音，一次大约二十秒；有伴奏时只抓较突出的音。多轨 MIDI 会请你选一条声部，这条上同时响的音收成和弦。`}
      >
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={recording ? solid : quiet}
            onClick={() => void startRecord()}
            disabled={busy}
            aria-busy={recordPhase === "arming"}
          >
            <Mic className="size-4" />
            {recordPhase === "arming" ? "正在请求麦克风…" : recording ? "停止哼唱" : "开始哼唱"}
          </button>
          <button
            type="button"
            className={quiet}
            onClick={() => fileRef.current?.click()}
            disabled={busy}
          >
            <Upload className="size-4" />
            上传音乐 / MIDI
          </button>
          <input
            ref={fileRef}
            type="file"
            accept={MUSIC_UPLOAD_ACCEPT}
            aria-label="上传音乐文件"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void onFile(file);
            }}
          />
          <button type="button" className={quiet} aria-expanded={tunerOpen} onClick={() => setTunerOpen((v) => !v)}>
            调音器
          </button>
        </div>
        {tunerOpen ? <Suspense fallback={<p>正在打开调音器…</p>}><Tuner tonicPc={(tonicMidi(score.key, 4) + (score.mode === "minor" ? 3 : 0)) % 12} onClose={() => setTunerOpen(false)} /></Suspense> : null}
        <div className="mt-3 flex flex-wrap items-center gap-2" role="group" aria-label="听写模式">
          <span className="text-sm text-muted">上传音频听写：</span>
          <button
            type="button"
            className={audioMode === "mono" ? solid : quiet}
            aria-pressed={audioMode === "mono"}
            disabled={busy}
            onClick={() => {
              audioModeRef.current = "mono";
              setAudioMode("mono");
              setImportReport((report) => (report?.zone === "audio" && report.source === "多音听写" ? null : report));
            }}
          >
            单音（哼唱/旋律）
          </button>
          <button
            type="button"
            className={audioMode === "poly" ? solid : quiet}
            aria-pressed={audioMode === "poly"}
            disabled={busy}
            onClick={() => {
              // Update the ref now: a file chosen in the same turn must not still see「单音」.
              audioModeRef.current = "poly";
              setAudioMode("poly");
              setImportReport((report) => (report?.zone === "audio" && report.source !== "多音听写" ? null : report));
            }}
          >
            多音（和弦/钢琴）
          </button>
        </div>
        {audioMode === "poly" ? (
          <p className="mt-2 text-sm leading-6 text-muted">
            多音模式听上传的钢琴、吉他或和弦录音，能同时记下几个音，最长 {MAX_POLY_SECONDS} 秒。首次使用会从本站下载识别模型和运算库（约 2.3 MB，压缩传输约 1 MB），之后走浏览器缓存；音频只在本机处理。哼唱仍按单音听写。
          </p>
        ) : null}
        {audioMode === "poly" ? (
          <label className="mt-2 flex items-center gap-2 text-sm text-muted">
            <input type="checkbox" checked={polyCpu} disabled={busy} onChange={(event) => setPolyCpu(event.target.checked)} />
            不用显卡（显卡出错或结果异常时勾选，较慢）
          </label>
        ) : null}
        <div ref={polyPanelRef} className="poly-panel scroll-mt-3">
        {(shownFeature === "zone-audio" || recording) && notice ? (
          <p className="mt-3 text-sm leading-6 text-muted" role="status">{notice}</p>
        ) : null}
        {(shownFeature === "zone-audio" || recording) && error && !isMicrophoneStatusError(error) ? (
          <div className="mt-3">
            <p className="text-sm leading-6 text-warn" role="alert">{error}</p>
          </div>
        ) : null}
        {polyJob ? (
          <div className="mt-3 text-sm leading-6" role="status" aria-live="polite">
            <p>
              {polyJob.phase === "audio"
                ? "多音听写：正在准备音频…"
                : polyJob.phase === "model"
                  ? `多音听写：正在载入识别模型 ${Math.round(polyJob.done * 100)}%`
                  : `多音听写：正在识别 ${Math.round(polyJob.done * 100)}%`}
            </p>
            <div
              className="mt-1 h-2 w-full max-w-60 overflow-hidden rounded-full bg-line"
              role="progressbar"
              aria-label="多音听写进度"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(polyJob.done * 100)}
            >
              <div className="h-full rounded-full bg-accent" style={{ width: `${Math.round(polyJob.done * 100)}%` }} />
            </div>
            <button type="button" className={clsx(quiet, "mt-2")} onClick={cancelPoly}>取消多音听写</button>
          </div>
        ) : null}
        {polyTake && polyDraft ? (
          <div className="poly-draft mt-4 rounded-2xl border border-line bg-paper p-3" aria-label="多音听写草稿">
            <p className="text-sm font-medium">多音听写草稿 · 尚未写入谱面</p>
            {typeof polyDraft === "string" ? (
              <div>
                <p className="text-sm text-warn" role="alert">{polyDraft}</p>
              </div>
            ) : (
              <>
                <p className="text-sm">
                  听出 {polyDraft.detected} 个音，将写入 {polyDraft.written} 个音（{polyDraft.chords} 处和弦）；
                  估计调式 {keyTitle(polyDraft.score.key, polyDraft.score.mode)}，{polyDraft.score.beats}/{polyDraft.score.beatUnit} 拍，草稿速度 ♩={polyDraft.score.bpm}
                  {polyDraft.pickup > 0 ? `，开头弱起（前面补 ${+polyDraft.pickup.toFixed(2)} 拍休止）` : ""}。
                  {polyLayout === "melody"
                    ? `确认后替换${voiceNameOf(polyTake.voice)}，和声写成和弦名。`
                    : polyDraft.twoVoices
                      ? `确认后替换声部一和声部二（声部二用低音谱号）${scoreRef.current.changes?.length ? "，并清除原有中途变速变调" : ""}。`
                      : `确认后替换${voiceNameOf(polyTake.voice)}。`}
                </p>
                {polyDraft.chordLine ? (
                  <p className="mt-1 text-sm" aria-label="草稿和弦">
                    和弦：<span className="poly-chord-line font-medium tabular-nums">{polyDraft.chordLine}</span>
                  </p>
                ) : (
                  <p className="mt-1 text-sm text-muted">没有认出稳定的和弦。</p>
                )}
                <div className="dictation-actions mt-2">
                  <p className="text-sm font-medium">将写入 {polyDraft.written} 个音。请校对后再进编辑。</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                  <button type="button" className={solid} disabled={busy || recording || !polyDraft.written} onClick={confirmPoly}>
                    编辑识别草稿
                  </button>
                  <button type="button" className={quiet} disabled={!polyDraft.written} onClick={auditionPoly}>
                    {playing && playKindRef.current === "preview" ? "停止试听" : "试听草稿"}
                  </button>
                  <button
                    type="button"
                    className={quiet}
                    onClick={() => {
                      halt();
                      setPolyTake(null);
                      setImportReport((report) => (report?.zone === "audio" ? null : report));
                      setNotice("已放弃多音草稿，谱面未更改。");
                    }}
                  >
                    放弃
                  </button>
                  </div>
                </div>
                <div className={clsx("mt-2", polyRollBig && "overflow-x-auto")}>
                  <PolyRoll notes={polyTake.notes} split={polyDraft.twoVoices ? polySplit : null} big={polyRollBig} />
                </div>
                <button type="button" className={clsx(quiet, "mt-1")} aria-pressed={polyRollBig} onClick={() => setPolyRollBig((on) => !on)}>
                  {polyRollBig ? "缩小卷帘" : "放大卷帘"}
                </button>
                <details className="mt-2">
                  <summary className="text-sm text-muted">识别细节</summary>
                  <p className="text-sm text-muted">{polyDraft.notice}</p>
                </details>
              </>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <label className="text-sm">
                写法{" "}
                <select className={field} value={polyLayout} onChange={(event) => setPolyLayout(event.target.value as PolyLayout)}>
                  {(Object.keys(POLY_LAYOUT_LABEL) as PolyLayout[]).map((key) => (
                    <option key={key} value={key}>{POLY_LAYOUT_LABEL[key]}</option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                拍号{" "}
                <select className={field} value={polyMeter} aria-label="多音草稿拍号" onChange={(event) => setPolyMeter(event.target.value)}>
                  <option value="auto">自动（{polyTake.pulse.meter.beats}/{polyTake.pulse.meter.beatUnit}）</option>
                  {METER_CHOICES.map((m) => (
                    <option key={`${m.beats}/${m.beatUnit}`} value={`${m.beats}/${m.beatUnit}`}>{m.beats}/{m.beatUnit}</option>
                  ))}
                </select>
              </label>
              <span className="flex items-center gap-1 text-sm" role="group" aria-label="多音草稿速度">
                速度
                <button type="button" className={polyTempo === 0.5 ? solid : quiet} aria-pressed={polyTempo === 0.5} onClick={() => setPolyTempo((v) => (v === 0.5 ? 1 : 0.5))}>
                  减半
                </button>
                <button type="button" className={polyTempo === 2 ? solid : quiet} aria-pressed={polyTempo === 2} onClick={() => setPolyTempo((v) => (v === 2 ? 1 : 2))}>
                  加倍
                </button>
              </span>
              {polyLayout !== "melody" ? (
                <label className="text-sm">
                  分声部{" "}
                  <select
                    className={field}
                    value={polySplit ?? "none"}
                    onChange={(event) => setPolySplit(event.target.value === "none" ? null : Number(event.target.value))}
                  >
                    <option value="none">不分（和弦层）</option>
                    {[48, 53, 55, 57, 60, 62, 64, 67].map((m) => (
                      <option key={m} value={m}>{midiName(m)} 以上为声部一</option>
                    ))}
                  </select>
                </label>
              ) : null}
              <label className="text-sm">
                量化精度{" "}
                <select
                  className={field}
                  value={polyGrid}
                  onChange={(event) => setPolyGrid(Number(event.target.value) as 0.25 | 0.125)}
                >
                  <option value={0.25}>十六分音符</option>
                  <option value={0.125}>三十二分音符</option>
                </select>
              </label>
              <label className="flex items-center gap-1 text-sm">
                <input
                  type="checkbox"
                  checked={polyKeepOvertones}
                  onChange={(event) => setPolyKeepOvertones(event.target.checked)}
                />
                保留疑似泛音
              </label>
            </div>
            {typeof polyDraft !== "string" && polyDraft.losses.length ? (
              <p className="mt-2 text-sm text-muted">写入后会列出本次丢失：{polyDraft.losses.join("；")}。</p>
            ) : null}
          </div>
        ) : null}
        </div>
        {recordPhase === "arming" ? (
          <p className="mt-3 text-sm leading-6" role="status">
            {recordPending || "正在请求麦克风…"} 再点一次可排队停止。
          </p>
        ) : null}
        {recordPhase === "live" ? (
          <div className="mt-3 text-sm leading-6" role="status">
            <p>录音中 · 已录 {recordMeter.elapsed.toFixed(1)} 秒 / 最长 20 秒 · 剩余 {recordMeter.remaining.toFixed(1)} 秒。请对着麦克风哼单音。</p>
            <div
              className="mt-1 h-2 w-full max-w-40 overflow-hidden rounded-full bg-line"
              role="meter"
              aria-label="录音音量电平"
              aria-valuemin={0}
              aria-valuemax={1}
              aria-valuenow={Number(recordMeter.level.toFixed(2))}
            >
              <div className="h-full rounded-full bg-accent" style={{ width: `${Math.round(recordMeter.level * 100)}%` }} />
            </div>
          </div>
        ) : null}
        {error && recordPhase === "idle" && isMicrophoneStatusError(error) ? (
          <p className="mt-3 text-sm leading-6 text-warn" role="alert">{error}</p>
        ) : null}
        {midiSession ? (
          <div className="mt-3 flex flex-wrap gap-2">
            <label>
              量化精度{" "}
              <select
                className={field}
                value={midiGrid}
                onChange={(event) => {
                  setMidiGrid(Number(event.target.value) as 0.25 | 0.125);
                  setMidiPreview(null);
                }}
              >
                <option value={0.25}>十六分音符</option>
                <option value={0.125}>三十二分音符</option>
              </select>
            </label>
            <button type="button" className={quiet} disabled={busy || recording} onClick={() => previewMidi(false)}>
              预览增强量化
            </button>
            <button type="button" className={quiet} disabled={busy || recording} onClick={() => previewMidi(true)}>
              预览双手导入
            </button>
            <button type="button" className={quiet} disabled={busy || recording} onClick={() => {
              if (!midiSession) return;
              try { setMidiPreview(previewMidiVoices(midiSession.bytes, midiSession.fallbackTitle)); }
              catch (err) { setError(err instanceof Error ? err.message : "MIDI 读不了"); }
            }}>预览全部声部导入</button>
            {midiPreview ? (
              <div>
                <p>{midiPreview.notice}</p>
                <ImportLosses report={{ source: "MIDI", losses: midiPreview.losses, notes: [] }} onClose={() => setMidiPreview(null)} />
                <button
                  type="button"
                  className={solid}
                  disabled={busy || recording}
                  onClick={() => {
                    setRecognitionDraft({ score: midiPreview.hands ? midiPreview.score : adoptMidi(scoreRef.current, midiPreview.score, activeVoiceRef.current), gaps: midiPreview.losses });
                    setNotice(midiPreview.notice);
                    setImportReport({ zone: "audio", source: "MIDI", losses: midiPreview.losses, notes: [] });
                    setMidiPreview(null);
                    setMidiSession(null);
                  }}
                >
                  确认导入
                </button>
                <button type="button" className={quiet} onClick={() => setMidiPreview(null)}>取消预览</button>
              </div>
            ) : null}
          </div>
        ) : null}
        {importReport?.zone === "audio" ? <ImportLosses report={importReport} onClose={() => setImportReport(null)} /> : null}
        {midiSession ? (
          <MidiVoicePicker
            session={midiSession}
            disabled={busy || recording}
            onPick={chooseMidiVoice}
          />
        ) : null}
        {detected ? (
          <div className="mt-4">
            <div className="dictation-actions">
            <p className="text-sm font-medium">听写草稿 · 尚未写入谱面</p>
            <p className="text-sm">听出 {detected.length} 个音，将写入 {draftNotes.filter(note => note.pitches.length).length} 个音；
              估计调式 {keyTitle(draftKey.key, draftKey.mode)}，草稿速度 {draftBpm} BPM。</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={solid} disabled={busy || recording} onClick={confirmDetected}>编辑识别草稿</button>
              <button type="button" className={quiet} onClick={() => { setDetected(null); setNotice("已放弃听写草稿，谱面未更改。"); }}>放弃</button>
            </div>
            </div>
            <p className="text-sm text-muted">确认后替换声部 {draftVoice + 1}。淡色音稳定度较低（低于 65%）。网格与速度只改这份草稿。</p>
            <PitchTrace notes={detected} />
            <div className="mt-3 flex flex-wrap gap-2">
              {[
                [1, "按四分对齐"],
                [0.5, "按八分对齐"],
                [0.25, "按十六分对齐"],
              ].map(([value, label]) => (
                <button
                  key={label}
                  type="button"
                  aria-pressed={grid === value}
                  className={grid === value ? solid : quiet}
                  onClick={() => setGrid(Number(value))}
                >
                  {label}
                </button>
              ))}
              <button type="button" className={quiet} onClick={requantize}>
                按当前速度重排
              </button>
            </div>
          </div>
        ) : null}
        {busy && !polyJob ? <p className="mt-3 text-sm text-muted">正在听写…</p> : null}
      </Zone>

      <Zone id="zone-drafts" active={shownFeature === "zone-drafts"} title="本机草稿" hint="仅保存在此浏览器。每首曲子只占一条，边写边自动保存。">
          <p className="text-sm leading-relaxed text-muted">
            仅保存在此浏览器，最多 20 首、约 2 MiB。每首曲子一条，边写边自动更新；点「保存当前草稿」后它算手动保存，自动保存不会把它挤掉。
          </p>
          <button type="button" className={clsx(solid, "mt-3")} onClick={() => saveDraft(scoreRef.current)}>
            保存当前草稿
          </button>
          <button
            type="button"
            className={clsx(quiet, "mt-3 ml-2")}
            aria-pressed={hapticOn}
            aria-label="点按震动"
            onClick={() => {
              const next = !hapticOn;
              setHapticEnabled(next);
              setHapticOn(next);
            }}
          >
            点按震动：{hapticOn ? "开" : "关"}
          </button>
          {([
            ["手动保存", drafts.filter((draft) => draft.pinned)],
            ["自动保存", drafts.filter((draft) => !draft.pinned)],
          ] as const).map(([label, list]) => (
            <div key={label} className="mt-5">
              <h3 className="text-sm font-medium text-ink">{label}<span className="ml-1 font-normal text-muted">{list.length} 首</span></h3>
              {list.length === 0 ? (
                <p className="mt-2 text-sm text-muted">{label === "手动保存" ? "还没有手动保存的曲子。" : "还没有自动保存的曲子。"}</p>
              ) : (
                <ul className="draft-list mt-2">
                  {[...list].reverse().map((draft) => {
                    const current = draft.id === songIdRef.current;
                    const incipit = songIncipit(draft.value);
                    return (
                      <li key={draft.id} className="draft-row">
                        <button type="button" className="draft-open" onClick={() => restoreDraft(draft)} disabled={current}>
                          <span className="block truncate text-sm font-medium text-ink">
                            {draft.value.title || "未命名"}{current ? "（正在编辑）" : ""}
                          </span>
                          <span className="block truncate text-xs text-muted">
                            {incipit ? `${incipit} · ` : ""}{new Date(draft.at).toLocaleString("zh-CN")}
                          </span>
                        </button>
                        <button
                          type="button"
                          className={quiet}
                          aria-label={`删除草稿 ${draft.value.title}`}
                          onClick={() => {
                            try {
                              setDrafts(
                                writeDrafts(
                                  localStorage,
                                  readDrafts(localStorage, isScore).filter((item) => item.id !== draft.id),
                                ),
                              );
                              if (current) {
                                // As with delete-all, keep the visible score but prevent the
                                // debounce/return-home flush from recreating this archive.
                                localStorage.removeItem(STORAGE_KEY);
                                storageDeletedRef.current = true;
                              }
                              setNotice(`已删除「${draft.value.title || "未命名"}」。`);
                            } catch {
                              setNotice("无法删除本机草稿。");
                            }
                          }}
                        >
                          删除
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          ))}
          <div className="mt-8 border-t border-line pt-4">
            {confirmWipe ? (
              <div role="group" aria-label="确认删除全部本机存档" className="rounded-xl border border-warn/30 bg-warn/5 p-3">
                <p className="text-sm text-warn">确定删除这个浏览器里的全部曲子和上次草稿？删除后无法恢复，重要作品请先导出。</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className={danger}
                    onClick={() => {
                      setConfirmWipe(false);
                      try {
                        storageDeletedRef.current = true;
                        localStorage.removeItem(DRAFT_KEY);
                        localStorage.removeItem(STORAGE_KEY);
                        setDrafts([]);
                        setNotice("已删除全部本机存档。");
                      } catch {
                        setNotice("无法删除本机草稿。");
                      }
                    }}
                  >
                    确认删除全部
                  </button>
                  <button type="button" className={quiet} onClick={() => setConfirmWipe(false)}>取消</button>
                </div>
              </div>
            ) : (
              <button type="button" className={dangerQuiet} onClick={() => setConfirmWipe(true)}>
                <Trash2 className="size-4" aria-hidden="true" />
                删除全部本机存档
              </button>
            )}
          </div>
      </Zone>
      <section id="zone-practice" className="zone zone-panel practice-panel" aria-labelledby="zone-practice-heading" hidden={!practiceOpen}>
        <h2><span id="zone-practice-heading" className="zone-title">练习</span></h2>
        <div className="zone-content">
          {practiceOpen || waitActive ? <Suspense fallback={<p>正在打开分手练与等你弹…</p>}><WaitPractice
            key={practiceSong} score={score} onHint={auditionSlots} hand={score.voice2 == null ? "both" : practiceHand} other={otherHand} range={loopOn ? loopRange : null}
            disabled={!canPlay || recording || busy}
            onHand={hand => { halt(); setPracticeHand(hand); }}
            onOther={other => { halt(); setOtherHand(other); }}
            onStart={() => { halt(); trainingRef.current.active = false; setTrainingActive(false); setKeyboardOpen(true); }}
            onActive={active => { setWaitActive(active); setPlaying(active); if (!active) setPracticeOpen(true); }}
            onControl={stop => { waitStop.current = stop; }}
            onFrame={(slots, quarter) => { showSounding(slots); setPlayhead(quarter); }}
            onFeedback={(midi, wrong) => setWaitFeedback({ midi, wrong })}
            onLoopBar={bar => { setLoopBars(bar, bar); setLoopOn(true); }}
          /></Suspense> : null}
          <div className="tool-group">
            <p className="tool-group-title">段落循环<span>A-B 反复练一段</span></p>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className={loopOn ? solid : quiet} aria-pressed={loopOn}
                disabled={barCount < 1 || !canPlay}
                onClick={() => {
                  if (!loopOn && !loopRange) setLoopBars(1, Math.min(2, barCount));
                  setLoopOn((on) => !on);
                }}>
                <Repeat2 className="size-4" aria-hidden="true" />循环播放
              </button>
              <label className="flex items-center gap-1 text-sm">
                从第
                <select aria-label="循环起点小节" className="practice-select" value={loopFromBar}
                  onChange={(event) => { setLoopBars(Number(event.target.value), Math.max(Number(event.target.value), loopToBar)); setLoopOn(true); }}>
                  {bars.map((_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}
                </select>
              </label>
              <label className="flex items-center gap-1 text-sm">
                到第
                <select aria-label="循环终点小节" className="practice-select" value={loopToBar}
                  onChange={(event) => { setLoopBars(Math.min(loopFromBar, Number(event.target.value)), Number(event.target.value)); setLoopOn(true); }}>
                  {bars.map((_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}
                </select>
                小节
              </label>
              <button type="button" className={quiet} disabled={!selected.length}
                onClick={() => {
                  const range = loopFromSelection(scoreRef.current, activeVoiceRef.current, selectedRef.current);
                  if (!range) return;
                  // This only sets the A-B range and turns looping on.
                  // "循环播放" is the on/off; clicking this again must not toggle it off.
                  setLoopRange(range);
                  setLoopOn(true);
                }}>
                用选中的音
              </button>
            </div>
            {loopOn && loopRange ? (
              <div className="mt-2 flex flex-wrap items-center gap-2" data-loop-pause="">
                <label className="flex items-center gap-1 text-sm">
                  每遍后停
                  <select aria-label="每遍之间停顿" className="practice-select" value={loopPause} onChange={(event) => setLoopPause(cleanLoopPause(Number(event.target.value)))}>
                    {LOOP_PAUSE_OPTIONS.map((s) => <option key={s} value={s}>{s ? `${s} 秒` : "不停"}</option>)}
                  </select>
                </label>
                <label className="flex items-center gap-1 text-sm">
                  练
                  <select aria-label="循环遍数" className="practice-select" value={loopTimes} onChange={(event) => setLoopTimes(cleanLoopTimes(Number(event.target.value)))}>
                    {LOOP_TIMES_OPTIONS.map((n) => <option key={n} value={n}>{n ? `${n} 遍` : "不限"}</option>)}
                  </select>
                </label>
              </div>
            ) : null}
            <p className="mt-2 text-sm text-muted" role="status">
              {practiceLoopStatus({ playing, loopOn, loopRange, label: loopLabel, now: trainingActive ? null : loopNow, times: trainingActive ? 0 : loopTimes })}
            </p>
          </div>
          <div className="tool-group">
            <p className="tool-group-title">慢速<span>放慢或加快，音高不变</span></p>
            <div className="flex items-center gap-3">
              <input
                aria-label="播放速度"
                className="h-11 min-w-0 flex-1 accent-accent"
                type="range"
                min={SPEED_MIN * 100}
                max={SPEED_MAX * 100}
                step={5}
                value={Math.round(currentPracticeSpeed * 100)}
                onChange={(event) => manualPracticeSpeed(clampSpeed(Number(event.target.value) / 100))}
              />
              <output className="w-12 text-right text-sm tabular-nums" aria-label="当前速度">{Math.round(currentPracticeSpeed * 100)}%</output>
              <button type="button" className={quiet} disabled={!trainingActive && practiceSpeed === 1} onClick={() => manualPracticeSpeed(1)}>原速</button>
            </div>
            <p className="mt-1 text-xs text-muted tabular-nums">约 ♩={Math.round(score.bpm * currentPracticeSpeed)}（原速 {score.bpm}）</p>
          </div>
          <div className="tool-group">
            <p className="tool-group-title">预备拍<span>播放前先打拍子</span></p>
            <div className="segmented" role="radiogroup" aria-label="预备拍">
              {COUNT_IN_OPTIONS.map((bars) => (
                <button key={bars} type="button" role="radio" aria-checked={countInBars === bars}
                  onClick={() => setCountInBars(bars)}>
                  {bars === 0 ? "不用" : `${bars} 小节`}
                </button>
              ))}
            </div>
          </div>
          {practiceOpen ? (
            <div className="tool-group practice-kit" data-practice-kit>
              <p className="tool-group-title">小工具<span>点一下打开，再点收起</span></p>
              <div className="practice-kit-grid">
                {([
                  ["独立节拍器", "不播谱练拍子", metroToolOpen, setMetroToolOpen],
                  ["听音练耳", "先定调，再认级数", earOpen, setEarOpen],
                  ["拍节奏", "跟着节拍点按", rhythmOpen, setRhythmOpen],
                  ["持续音", "对着长音练音准", droneOpen, setDroneOpen],
                ] as const).map(([name, hint, open, setOpen]) => (
                  <button key={name} type="button" className="tool-button" aria-label={`${name}（${hint}）`} aria-pressed={open} onClick={() => setOpen(!open)}>
                    <b>{name}</b><small>{hint}</small>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {practiceOpen && metroToolOpen ? <Suspense fallback={<p>正在打开节拍器…</p>}><StandaloneMetronome initialBpm={score.bpm} initialBeats={score.beats} playing={playing} onClose={() => setMetroToolOpen(false)} onRunning={setMetroRunning} /></Suspense> : null}
          {practiceOpen && earOpen ? <Suspense fallback={<p>正在打开听音练耳…</p>}><EarTrainer keyName={score.key} mode={score.mode} playing={playing} onActive={setEarActive} onClose={() => setEarOpen(false)} /></Suspense> : null}
          {practiceOpen && rhythmOpen ? <Suspense fallback={<p>正在打开拍节奏…</p>}><RhythmTapper score={score} loop={loopOn ? loopRange : null} speed={currentPracticeSpeed} playing={playing} onRunning={setRhythmRunning} onClose={() => setRhythmOpen(false)} /></Suspense> : null}
          {practiceOpen && droneOpen ? <Suspense fallback={<p>正在打开持续音…</p>}><Drone keyName={score.key} mode={score.mode} playing={playing} onRunning={setDroneRunning} onClose={() => setDroneOpen(false)} /></Suspense> : null}
          {practiceOpen ? <Suspense fallback={<p>正在打开混音台…</p>}><MixerPanel channels={mixerChannels} onChange={setMixer} /></Suspense> : null}
          {practiceOpen ? <Suspense fallback={<p>正在打开练习设置…</p>}><PracticeExtras
            settings={trainingSettings} onSettings={setTrainingSettings} completed={trainingCompleted} active={trainingActive}
            onToggle={() => {
              halt();
              playPositionRef.current = null;
              const active = !trainingRef.current.active;
              trainingRef.current = { active, settings: trainingSettings, completed: 0 };
              setTrainingActive(active); setTrainingCompleted(0);
            }}
            clips={clips} onClips={setClips} range={loopOn ? loopRange : null} label={loopLabel} speed={trainingActive ? trainingProgress(trainingSettings, trainingCompleted).speed : practiceSpeed}
            onRecall={clip => { halt(); trainingRef.current.active = false; setTrainingActive(false); setPracticeSpeed(clip.speed); setLoopRange(clip.range); setLoopOn(true); playPositionRef.current = null; }}
          /></Suspense> : null}
          {practiceOpen ? <Suspense fallback={<p>正在打开练琴记录…</p>}><PracticeLogCard running={practicing} tick={practiceLogTick} song={{ key: practiceSong, title: score.title }} /></Suspense> : null}
          <details className="zone-help"><summary>了解更多</summary><p className="mt-3 text-xs text-muted">播放中拖慢速，会从当前位置接着放、不重打预备拍；改循环段或预备拍，会从段落开头重新开始。设置按曲记在本机，不写进谱子。有歌词时，谱面上方浮出一行跟唱，高亮当前唱到的字。播放中改摇摆（在「移调与乐器」里），也会从当前位置接着放。</p></details>
        </div>
      </section>
      {keyboardOpen ? <div id="visual-keyboard-panel" className="keyboard-dock no-print"><Suspense fallback={<p>正在打开琴键…</p>}><VisualKeyboard key={practiceHand} defaultHand={score.voice2 == null ? "both" : practiceHand} played={waitFeedback.wrong ? waitFeedback.midi : null} score={score} sounding={sounding} showFingering={showFingering} transposed={keyboardTranspose !== 0} /></Suspense></div> : null}
      <nav className="transport" aria-label="播放与编辑">
        <span className="transport-title" aria-hidden="true">{score.title || "未命名"}</span>
        <button type="button" className={clsx(solid, "transport-play")} onClick={togglePlay} disabled={!canPlay && !playing}
          aria-label={playing ? "停止" : "播放"}>
          {playing ? <Pause className="size-4" aria-hidden="true" /> : <Play className="size-4" aria-hidden="true" />}
          <span className="transport-play-label">{playing ? "停止" : "播放"}</span>
        </button>
        <div ref={metroGroupRef} className="metro" role="group" aria-label="节拍器设置">
          <button
            type="button"
            className={clsx(metronome ? solid : quiet, "metro-toggle")}
            aria-label="节拍器"
            aria-pressed={metronome}
            title="节拍器按拍号打拍，每小节第一拍更重；播放中也能开关、调音量"
            aria-expanded={narrowMetronome() && metronome ? metronomeOpen : undefined}
            onClick={() => {
              // <360px the volume is a pop-over: tapping the lit button while it is
              // closed reopens it; tapping again (or 关闭节拍器 inside) turns the click off.
              if (metronome && !metronomeOpen && narrowMetronome()) {
                setMetronomeOpen(true);
                return;
              }
              setMetronomeOpen(!metronome);
              setMetronome((on) => !on);
            }}
          >
            <Timer className="size-4" aria-hidden="true" />
            <span className="transport-label">节拍器</span>
            {metronome && playing ? (
              <span
                className="metro-dot"
                aria-hidden="true"
                style={{ animationDuration: `${(60 / Math.max(1, score.bpm)) * (4 / score.beatUnit)}s` }}
              />
            ) : null}
          </button>
          <label className={clsx("metro-volume", metronome && "is-on", metronome && metronomeOpen && "is-open")}>
            <span className="sr-only">节拍器音量</span>
            <input
              aria-label="节拍器音量"
              className="h-11 w-full accent-accent"
              type="range"
              min={0}
              max={100}
              step={1}
              value={Math.round(metronomeVolume * 100)}
              onChange={(event) => setMetronomeVolume(Number(event.target.value) / 100)}
            />
            <span className="metro-volume-value tabular-nums" aria-hidden="true">音量 {Math.round(metronomeVolume * 100)}</span>
          </label>
          {metronome && metronomeOpen ? (
            <button type="button" className={clsx(quiet, "metro-off")} onClick={() => { setMetronome(false); setMetronomeOpen(false); }}>
              关闭节拍器
            </button>
          ) : null}
        </div>
        <button type="button" className={clsx(practiceOpen || practiceActive ? solid : quiet, "transport-icon practice-toggle")}
          aria-label="练习" aria-pressed={practiceOpen} aria-controls="zone-practice"
          title="练习：段落循环、慢速、预备拍"
          onClick={() => setPracticeOpen((open) => !open)}>
          <Repeat2 className="size-4" aria-hidden="true" />
          <span className="transport-label">练习</span>
        </button>
        <span className="transport-divider" aria-hidden="true" />
        <button type="button" className={clsx(quiet, "transport-icon transport-edit")} onClick={undo} disabled={!canUndo} aria-label="撤销">
          <Undo2 className="size-4" aria-hidden="true" />
        </button>
        <button type="button" className={clsx(quiet, "transport-icon transport-edit")} onClick={redo} disabled={!canRedo} aria-label="重做">
          <Redo2 className="size-4" aria-hidden="true" />
        </button>
      </nav>
      </main>
    </>
  );
}

function titledSvg(svg: SVGSVGElement, title: string, caption: string): SVGSVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const rect = svg.getBoundingClientRect();
  const width = Math.max(320, Math.round(rect.width || Number(svg.getAttribute("width")) || 640));
  const height = Math.max(80, Math.round(rect.height || Number(svg.getAttribute("height")) || 160));
  const top = 78;
  const wrap = document.createElementNS(ns, "svg");
  wrap.setAttribute("xmlns", ns);
  wrap.setAttribute("width", String(width));
  wrap.setAttribute("height", String(height + top));
  wrap.setAttribute("viewBox", `0 0 ${width} ${height + top}`);
  const bg = document.createElementNS(ns, "rect");
  bg.setAttribute("width", "100%");
  bg.setAttribute("height", "100%");
  bg.setAttribute("fill", "#f7f3ea");
  wrap.appendChild(bg);
  const titleNode = document.createElementNS(ns, "text");
  titleNode.setAttribute("x", String(width / 2));
  titleNode.setAttribute("y", "32");
  titleNode.setAttribute("text-anchor", "middle");
  titleNode.setAttribute("fill", "#1c1916");
  titleNode.setAttribute("font-size", "22");
  titleNode.setAttribute(
    "font-family",
    "Newsreader, Songti SC, Noto Serif SC, WenQuanYi Micro Hei, Droid Sans Fallback, serif",
  );
  titleNode.textContent = title || "未命名";
  wrap.appendChild(titleNode);
  const sub = document.createElementNS(ns, "text");
  sub.setAttribute("x", String(width / 2));
  sub.setAttribute("y", "56");
  sub.setAttribute("text-anchor", "middle");
  sub.setAttribute("fill", "#6f675e");
  sub.setAttribute("font-size", "13");
  sub.setAttribute(
    "font-family",
    "Outfit, PingFang SC, Noto Sans SC, WenQuanYi Micro Hei, Droid Sans Fallback, sans-serif",
  );
  sub.textContent = caption;
  wrap.appendChild(sub);
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("x", "0");
  clone.setAttribute("y", String(top));
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));
  wrap.appendChild(clone);
  return wrap;
}
