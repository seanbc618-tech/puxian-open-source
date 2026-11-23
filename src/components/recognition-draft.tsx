import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Score } from "@/lib/music/theory";
import { replaceVoiceAndRemap, voiceList, voiceNotes, type VoiceId } from "@/lib/music/voices";
import type { shiftSelection } from "@/lib/music/selection-edit";
import type { JianpuView } from "./jianpu-view";
import { field, quiet, solid } from "./ui/styles";
import { installGeomHook } from "../lib/omr/geom-preview";
import { attachResizeHandle } from "../lib/card-size";
import { formatBeats, SafeScoreView } from "./safe-score-view";
import "./geom-review.css";

export type RecognitionSourceImage = { url: string; name: string };

/** Isolated from the main score and its undo stack until explicitly accepted.
 *  Full-width left-image / right-score review (not a blocking <dialog showModal>). */
export default function RecognitionDraft({
  initial,
  gaps,
  onConfirm,
  onClose,
  ScoreView,
  shiftNotes,
  images,
  currentImage = 0,
}: {
  shiftNotes: typeof shiftSelection;
  ScoreView: typeof JianpuView;
  initial: Score;
  gaps: string[];
  onConfirm: (score: Score) => void;
  onClose: () => void;
  images?: RecognitionSourceImage[];
  currentImage?: number;
}) {
  const [score, setScore] = useState(initial);
  const [voice, setVoice] = useState<VoiceId>(0);
  const [selected, setSelected] = useState<number[]>([]);
  const [history, setHistory] = useState<Score[]>([]);
  const [page, setPage] = useState(Math.max(0, Math.min(currentImage, (images?.length ?? 1) - 1)));
  const imagePane = useRef<HTMLElement>(null);
  const scorePane = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    installGeomHook({ editorScore: score, editorOpen: true });
  }, [score]);
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        closeRef.current();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey, true);
      installGeomHook({ editorOpen: false });
    };
  }, []);

  useEffect(() => {
    const left = imagePane.current;
    const right = scorePane.current;
    const dropLeft = left
      ? attachResizeHandle(left, {
          id: "geom-review-image",
          label: "调整原图区域大小",
          minWidth: 240,
          minHeight: 200,
          axes: "both",
        })
      : () => {};
    const dropRight = right
      ? attachResizeHandle(right, {
          id: "geom-review-score",
          label: "调整识别谱区域大小",
          minWidth: 240,
          minHeight: 240,
          axes: "both",
        })
      : () => {};
    return () => {
      dropLeft();
      dropRight();
    };
  }, [images?.length]);

  const duration = voiceNotes(score, voice)[selected[0]]?.dur ?? 1;
  const durations = [...new Set([0.125, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, duration])].sort(
    (a, b) => a - b,
  );
  function edit(next: Score) {
    setHistory((old) => [...old, score]);
    setScore(next);
  }
  function shift(amount: 1 | -1) {
    const notes = shiftNotes(
      voiceNotes(score, voice),
      selected,
      score.key,
      score.mode,
      "step",
      amount,
    );
    if (notes) edit(replaceVoiceAndRemap(score, voice, notes));
  }

  const hasImages = Boolean(images && images.length);
  const current = hasImages ? images![Math.min(page, images!.length - 1)] : undefined;
  const nEvents = voiceList(score).reduce(
    (n, notes) => n + notes.filter((note) => note.pitches.length).length,
    0,
  );

  const review = (
    <div
      className="geom-review"
      role="dialog"
      aria-modal="true"
      aria-label="识别草稿"
      data-geom-review="open"
      data-single-pane={hasImages ? undefined : ""}
    >
      <header className="geom-review-head">
        <h2>识别草稿 · 尚未写入主谱</h2>
        <div className="geom-review-actions">
          <button
            className={solid}
            type="button"
            onClick={() => {
              installGeomHook({ publishedScore: score, editorScore: score });
              onConfirm(score);
            }}
          >
            写入主谱
          </button>
          <button className={quiet} type="button" onClick={onClose}>
            放弃识别草稿
          </button>
        </div>
        <p>
          {hasImages
            ? "左侧是上传的原图，右侧是识别结果。两边可独立滚动。"
            : "这是听写草稿，对照录音校对即可。这里没有谱图。"}
          未写入前，顶上的主谱不会改。
          已识别 {nEvents} 个音，{voiceList(score).length} 个声部。
          大谱先列出音符，避免页面卡住；关闭、滚动随时可用。
        </p>
      </header>
      <div className="geom-review-body">
        {current ? (
          <section
            ref={imagePane}
            className="geom-review-pane geom-review-image"
            aria-label="上传的原图"
          >
            <h3>原图{images!.length > 1 ? ` · 第 ${page + 1} / ${images!.length} 页` : ""}</h3>
            {images!.length > 1 ? (
              <div className="geom-review-tools">
                <button className={quiet} type="button" disabled={page <= 0} onClick={() => setPage(page - 1)}>
                  上一页
                </button>
                <button
                  className={quiet}
                  type="button"
                  disabled={page >= images!.length - 1}
                  onClick={() => setPage(page + 1)}
                >
                  下一页
                </button>
              </div>
            ) : null}
            <img src={current.url} alt={`谱子原图：${current.name}`} />
          </section>
        ) : null}
        <section
          ref={scorePane}
          className="geom-review-pane geom-review-score"
          aria-label="识别谱面"
        >
          <h3>识别结果</h3>
          <p className="text-sm text-muted">
            {hasImages
              ? "点列表或谱面选音，校对音高、时值或删除。未识别区域需对照原图补写；休止占位不代表识别出的休止。"
              : "点列表或谱面选音，校对音高、时值或删除。请对照录音，这里没有原图。"}
          </p>
          {score.tempoMarked === false ? (
            <p className="text-sm text-muted">
              没有读到可靠的速度记号，谱上不写 ♩=。原谱如果印了速度，请在写谱里补上。
            </p>
          ) : null}
          {gaps.length > 0 && (
            <details open={gaps.length <= 4}>
              <summary className="min-h-11 cursor-pointer text-warn">
                待校对 / 缺口（{gaps.length} 项）
              </summary>
              {gaps.map((gap, index) => (
                <p key={index} className="text-sm text-warn">
                  {gap}
                </p>
              ))}
            </details>
          )}
          <div className="geom-review-tools">
            <button className={quiet} type="button" disabled={!selected.length} onClick={() => shift(1)}>
              升一级
            </button>
            <button className={quiet} type="button" disabled={!selected.length} onClick={() => shift(-1)}>
              降一级
            </button>
            <label>
              时值{" "}
              <select
                className={field}
                aria-label="草稿音符时值"
                disabled={!selected.length}
                value={duration}
                onChange={(event) =>
                  edit(
                    replaceVoiceAndRemap(
                      score,
                      voice,
                      voiceNotes(score, voice).map((note, i) =>
                        selected.includes(i) ? { ...note, dur: Number(event.target.value) } : note,
                      ),
                    ),
                  )
                }
              >
                {durations.map((dur) => (
                  <option key={dur} value={dur}>
                    {formatBeats(dur)} 拍
                  </option>
                ))}
              </select>
            </label>
            <button
              className={quiet}
              type="button"
              disabled={!selected.length}
              onClick={() => {
                edit(
                  replaceVoiceAndRemap(
                    score,
                    voice,
                    voiceNotes(score, voice).filter((_, i) => !selected.includes(i)),
                  ),
                );
                setSelected([]);
              }}
            >
              删除选中音
            </button>
            <button
              className={quiet}
              type="button"
              onClick={() => {
                edit(
                  replaceVoiceAndRemap(score, voice, [
                    ...voiceNotes(score, voice),
                    { pitches: [60], dur: 1 },
                  ]),
                );
              }}
            >
              补一个音
            </button>
            <button
              className={quiet}
              type="button"
              disabled={!history.length}
              onClick={() => {
                setScore(history[history.length - 1]);
                setHistory(history.slice(0, -1));
                setSelected([]);
              }}
            >
              撤销草稿修改
            </button>
          </div>
          <SafeScoreView
            score={score}
            ScoreView={ScoreView}
            selected={selected}
            activeVoice={voice}
            onPick={(index, _extend, nextVoice) => {
              setVoice(nextVoice);
              setSelected([index]);
            }}
          />
          <p className="text-xs text-muted">
            {voiceList(score).length} 个声部；写入将替换主谱，可在主编辑器撤销。
          </p>
        </section>
      </div>
    </div>
  );

  if (typeof document === "undefined") return review;
  return createPortal(review, document.body);
}
