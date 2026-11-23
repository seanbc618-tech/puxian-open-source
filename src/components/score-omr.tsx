import "./score-omr.css";
import { useEffect, useRef, useState } from "react";
import { createBlankScore } from "../lib/music/score-storage";
import type { Score } from "../lib/music/theory";
import {
  compileRecognition,
  fragmentLabel,
  type OmrFragment,
  type OmrPage,
} from "../lib/omr/recognition";
import { voiceList } from "../lib/music/voices";
import {
  GEOM_BANNER,
  eventsFromScore,
  installGeomHook,
  GeomRefusal,
  probeGeom,
  recognizeGeom,
  type GeomEvent,
  type GeomStatus,
} from "../lib/omr/geom-preview";
import { quiet, solid } from "./ui/styles";
import { SafeOmrPreview } from "./safe-score-view";

type Draft = NonNullable<ReturnType<typeof compileRecognition>["draft"]>;
function countPitched(score: Score, events?: GeomEvent[]): number {
  if (events && events.length) return events.length;
  return eventsFromScore(score).length;
}

function geomFinishedStatus(n: number, partial: boolean, done: number, total: number): string {
  const where =
    "顶上的主谱还是原来的样子，没有改动。识别结果在全宽对照预览里（左图右谱）。";
  const count = `已识别 ${n} 个音。`;
  if (partial) return `识谱已完成部分页（${done}/${total}）。${where}${count}`;
  return `识谱已完成。${where}${count}请在全宽对照预览里检查（左图右谱），再点「写入主谱」。`;
}

function mergeGeomScores(scores: Score[], title: string): Score {
  const first = scores[0];
  const merged: Score = { ...first, title, notes: [...first.notes] };
  const ends = [...(first.measureEnds ?? [])];
  const extra: NonNullable<Score["extraVoices"]> = [...(first.extraVoices ?? [])];
  if (first.voice2) merged.voice2 = [...first.voice2];
  for (const next of scores.slice(1)) {
    merged.notes = [...merged.notes, ...next.notes];
    if (next.voice2) merged.voice2 = [...(merged.voice2 ?? []), ...next.voice2];
    if (next.extraVoices) {
      next.extraVoices.forEach((voice, i) => {
        while (extra.length <= i) extra.push([]);
        extra[i] = [...extra[i], ...voice];
      });
    }
    const shift = ends[ends.length - 1] ?? 0;
    const add = next.measureEnds?.length
      ? next.measureEnds.map((end) => end + shift)
      : [shift + next.notes.reduce((t, n) => t + n.dur, 0)];
    ends.push(...add);
  }
  if (extra.length) merged.extraVoices = extra;
  merged.measureEnds = ends;
  return merged;
}

export default function ScoreOmr({
  pages,
  decode,
  currentPage,
  onConfirm,
  onAttempt,
  onPhase,
  disabled = false,
}: {
  pages: File[];
  disabled?: boolean;
  decode: typeof import("../lib/music/musicxml").musicXmlToScore;
  currentPage: number;
  onConfirm: (score: Score, losses: string[]) => void;
  /** Clear a previous review when a new attempt starts or fails, so the old score is not shown as this result. */
  onAttempt?: (event: { phase: "start" | "fail"; message?: string }) => void;
  onPhase?: (phase: "idle" | "running" | "done" | "failed") => void;
}) {
  const singlePage = pages.length <= 1;
  const [status, setStatus] = useState(
    singlePage
      ? "点「识别此页」开始。确认写入前，主谱不会改。"
      : "点「识别全部页并合并预览」开始。确认写入前，主谱不会改。",
  );
  const [progress, setProgress] = useState<number>();
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<Draft>();
  const [fragments, setFragments] = useState<OmrFragment[]>([]);
  const [pageReports, setPageReports] = useState<OmrPage[]>([]);
  const [issues, setIssues] = useState<string[]>([]);
  const worker = useRef<Worker | undefined>(undefined);
  const generation = useRef(0);
  const running = useRef(false);
  const recoverLatest = useRef<() => void>(() => {});
  const draftRef = useRef<HTMLDivElement>(null);
  const draftActionsRef = useRef<HTMLDivElement>(null);
  const [geom, setGeom] = useState<GeomStatus | null>(null);
  const [geomNoteCount, setGeomNoteCount] = useState<number | null>(null);
  function revealDraft() {
    // Scroll the confirm row into view so notation + the button sit above the transport.
    (draftActionsRef.current ?? draftRef.current)?.scrollIntoView({
      behavior: "smooth",
      block: "end",
      inline: "nearest",
    });
  }
  const openedDraft = useRef<Draft | null>(null);
  useEffect(() => {
    if (!draft || busy) return;
    const t = window.setTimeout(revealDraft, 60);
    return () => window.clearTimeout(t);
  }, [draft, busy]);
  useEffect(() => {
    if (!draft || busy) return;
    if (openedDraft.current === draft) return;
    openedDraft.current = draft;
    const t = window.setTimeout(() => {
      installGeomHook({ editorScore: draft.score, editorOpen: true, score: draft.score });
      onConfirm(draft.score, draft.losses);
      setStatus("已打开对照预览，主谱尚未更改。");
    }, 0);
    return () => window.clearTimeout(t);
  }, [draft, busy, onConfirm]);
  useEffect(
    () => () => {
      worker.current?.terminate();
      worker.current = undefined;
    },
    [],
  );
  // Probe only after ScoreOmr is lazy-loaded (user already opened 识别图片).
  // Never runs on the first screen.
  useEffect(() => {
    let cancelled = false;
    void probeGeom().then((status) => {
      if (cancelled) return;
      setGeom(status);
      if (!busy && !draft) {
        setStatus(
          status?.ok
            ? pages.length > 1
              ? "识别服务已就绪。多页请点「识别全部页并合并预览」。确认前主谱不会改。图片会发到本站识别服务，用完即删。"
              : "识别服务已就绪。这一页请点「识别此页」。确认前主谱不会改。图片会发到本站识别服务，用完即删。"
            : "识别服务暂时不可用，将使用浏览器内 SMT 后备路径（首次需下载约 86.5 MB 模型）。确认前主谱不会改。",
        );
      }
    });
    return () => {
      cancelled = true;
    };
  }, [pages.length]);
  function stop() {
    recoverLatest.current();
    generation.current++;
    running.current = false;
    worker.current?.terminate();
    worker.current = undefined;
    setBusy(false);
    setProgress(undefined);
  }
  useEffect(() => {
    setBusy(false);
    setProgress(undefined);
    setDraft(undefined);
    setGeomNoteCount(null);
    setFragments([]);
    setPageReports([]);
    setIssues([]);
    onPhase?.("idle");
    setStatus(
      disabled
        ? "正在本机打开页面，完成后可识别。现有乐谱未更改。"
        : pages.length > 1
          ? "多页可点「识别全部页并合并预览」。确认前主谱不会改。"
          : "这一页请点「识别此页」。确认前主谱不会改。",
    );
    return () => {
      generation.current++;
      if (running.current) {
        worker.current?.terminate();
        worker.current = undefined;
      }
      running.current = false;
    };
  }, [pages, currentPage, disabled]);
  async function recognize(all = false) {
    if (disabled) return;
    generation.current++;
    running.current = true;
    const run = generation.current;
    onPhase?.("running");
    setDraft(undefined);
    setFragments([]);
    setIssues([]);
    setGeomNoteCount(null);
    setBusy(true);
    setProgress(undefined);
    setStatus("正在准备本机识谱…");
    onAttempt?.({ phase: "start" });
    const selected = all
      ? pages.map((file, i) => ({ file, page: i + 1 }))
      : [{ file: pages[currentPage], page: currentPage + 1 }];
    const collected: OmrFragment[] = [];
    const reports: OmrPage[] = selected.map((p) => ({ page: p.page, done: false, warnings: [] }));
    const title = `${selected[0].file.name.replace(/\.[^.]+$/, "")} · 识谱草稿`;
    let latest: Draft | undefined;
    const refresh = () => {
      if (run !== generation.current) return;
      const result = compileRecognition(collected, reports, title, decode);
      latest = result.draft;
      setDraft(result.draft);
      setIssues(result.issues);
      setFragments([...collected]);
      setPageReports(reports.map((p) => ({ ...p })));
    };
    recoverLatest.current = refresh;
    const collect = (fragment: OmrFragment) => {
      const previous = collected.findIndex(
        (f) => f.page === fragment.page && f.system === fragment.system,
      );
      if (previous >= 0) collected[previous] = fragment;
      else collected.push(fragment);
    };
    setPageReports(reports);
    try {
      // Prefer the local geom API when it is up. If it is down, fall through
      // to the unchanged SMT worker without changing the product default.
      let geomStatus = geom;
      if (!geomStatus || !geomStatus.ok) geomStatus = await probeGeom(4000);
      if (run !== generation.current) return;
      if (geomStatus?.ok) {
        setGeom(geomStatus);
        const scores: Score[] = [];
        const allEvents: GeomEvent[] = [];
        // The banner is already on the panel. Do not list it as a proofreading gap.
        const losses: string[] = [];
        let refusal: string | null = null;
        for (const [i, selectedPage] of selected.entries()) {
          if (run !== generation.current) return;
          const report = reports[i];
          try {
            setStatus(
              `第 ${selectedPage.page} 页：正在用本站识别服务处理…`,
            );
            const result = await recognizeGeom(selectedPage.file, (sec, stage) => {
              if (run === generation.current) {
                setStatus(`第 ${selectedPage.page} 页：${stage}`);
                setProgress(undefined);
              }
            });
            if (run !== generation.current) return;
            scores.push(result.score);
            allEvents.push(...(result.events ?? []));
            report.done = true;
            report.total = 1;
            report.warnings = [];
            installGeomHook({
              engine: result.engine,
              banner: GEOM_BANNER,
              usedGeom: true,
              events: result.events,
              score: result.score,
            });
          } catch (error) {
            if (run !== generation.current) return;
            report.done = true;
            if (error instanceof GeomRefusal) {
              report.error = error.message;
              refusal = refusal ?? error.message;
            } else {
              report.error =
                error instanceof Error && /[\u3400-\u9fff]/.test(error.message)
                  ? error.message
                  : "识谱失败。";
              losses.push(`第 ${selectedPage.page} 页：${report.error}`);
            }
          }
          setPageReports(reports.map((p) => ({ ...p })));
        }
        if (run !== generation.current) return;
        if (!scores.length && refusal) {
          // The server already refused this page. Do not open the browser model,
          // and do not keep the "locating staves" line or the previous draft.
          setDraft(undefined);
          setIssues([]);
          setFragments([]);
          setPageReports([]);
          setStatus(refusal);
          onAttempt?.({ phase: "fail", message: refusal });
          return;
        }
        if (scores.length) {
          const score = scores.length === 1 ? scores[0] : mergeGeomScores(scores, title);
          latest = {
            score,
            losses,
            partial: scores.length < selected.length,
            pages: selected.slice(0, scores.length).map((p) => p.page),
            systems: scores.length,
          } as Draft;
          setDraft(latest);
          setIssues(losses);
          const nNotes = countPitched(score, allEvents);
          setGeomNoteCount(nNotes);
          setStatus(geomFinishedStatus(nNotes, latest.partial, scores.length, selected.length));
          installGeomHook({
            engine: "copisteria-geom",
            banner: GEOM_BANNER,
            usedGeom: true,
            score,
            events: allEvents,
          });
          return;
        }
        setStatus("识别服务没有得到可用草稿，改走浏览器内 SMT 后备路径。现有乐谱未更改。");
        // fall through to SMT
      }

      if (!globalThis.Worker || !globalThis.createImageBitmap || !globalThis.caches)
        throw new Error(
          "此浏览器不支持本机识谱缓存或图像处理，请使用新版 Chrome / Edge，并通过 HTTPS 打开。",
        );
      installGeomHook({ engine: "smt", banner: "", usedGeom: false });
      for (const [i, selectedPage] of selected.entries()) {
        if (run !== generation.current) return;
        const report = reports[i];
        let streamed = false;
        try {
          setStatus(`第 ${selectedPage.page} 页：正在打开图片并定位谱表…`);
          const bitmap = await createImageBitmap(selectedPage.file);
          if (run !== generation.current) {
            bitmap.close();
            return;
          }
          const w =
            worker.current ??
            new Worker(new URL("../lib/omr/omr.worker.ts", import.meta.url), { type: "module" });
          worker.current = w;
          const result = await new Promise<string[]>((resolve, reject) => {
            w.onerror = () => {
              w.terminate();
              worker.current = undefined;
              reject(new Error("本页本机运行时中断或内存不足；已有谱符保留，继续处理后续页。"));
            };
            w.onmessage = (e: MessageEvent) => {
              if (run !== generation.current) return;
              const m = e.data;
              if (m.kind === "progress") {
                setStatus(`第 ${selectedPage.page} 页：${m.message}`);
                setProgress(m.progress);
                if (typeof m.text === "string") {
                  collect({
                    page: selectedPage.page,
                    system: m.system,
                    text: m.text,
                    complete: false,
                  });
                  setFragments([...collected]);
                }
              } else if (m.kind === "page") {
                report.total = m.total;
                report.warnings = m.warnings ?? [];
                refresh();
              } else if (m.kind === "system") {
                streamed = true;
                collect({
                  page: selectedPage.page,
                  system: m.index,
                  text: m.text,
                  complete: m.complete,
                  error: m.error,
                });
                refresh();
              } else if (m.kind === "result") resolve(m.systems);
              else if (m.kind === "error") reject(new Error(m.message));
            };
            const configured = import.meta.env.VITE_OMR_MODEL_BASE as string | undefined;
            const base = new URL(
              configured || `${import.meta.env.BASE_URL}models/omr/`,
              location.href,
            ).href;
            w.postMessage({ bitmap, base: base.endsWith("/") ? base : `${base}/` }, [bitmap]);
          });
          // Accept the terminal batch as well, for cached/older worker messages.
          if (!streamed)
            result.forEach((text, j) =>
              collect({ page: selectedPage.page, system: j + 1, text, complete: true }),
            );
          if (!result.length && !streamed)
            report.error = "未返回可转换谱符，本页未导入；后续页仍会继续。";
        } catch (error) {
          if (run !== generation.current) return;
          report.error =
            error instanceof Error && /[\u3400-\u9fff]/.test(error.message)
              ? error.message
              : "图片解码或本机识别失败；已生成谱符保留。";
        }
        report.done = true;
        refresh();
      }
      if (run !== generation.current) return;
      const reason = reports.find((p) => p.error)?.error;
      if (!latest) onAttempt?.({ phase: "fail", message: reason });
      if (!latest && reason && /^(暂不支持简谱|这不像五线谱|这一页是单行)/.test(reason)) {
        setIssues([]);
        setFragments([]);
        setPageReports([]);
        setStatus(reason);
        return;
      }
      const failed = reports.filter(
        (p) =>
          p.error || p.warnings.length || collected.some((f) => f.page === p.page && !f.complete),
      ).length;
      setStatus(
        latest
          ? `${reports.length} 页已逐页尝试；${latest.partial ? "仅恢复部分内容，失败位置见下方，未识别区域未导入" : "已合并识别结果"}。草稿包含 ${latest.pages.length} 页的 ${latest.systems} 个系统。请检查后确认写入主谱，现有乐谱未更改。`
          : `${reports.length} 页已尝试，${failed} 页未能完整识别。暂无可转换草稿；已生成谱符和逐页原因见下方，现有乐谱未更改。`,
      );
    } catch (error) {
      if (run === generation.current) {
        refresh();
        setStatus(
          `${error instanceof Error ? error.message : "识别失败"} 已有谱符保留，现有乐谱未更改。`,
        );
      }
    } finally {
      if (run === generation.current) {
        running.current = false;
        setBusy(false);
        setProgress(undefined);
        onPhase?.(latest ? "done" : "failed");
      }
    }
  }

  return (
    <section aria-label="自动识谱" className="omr-panel">
      <h3>
        {geom?.ok
          ? "本站识谱服务 · 检测 + 谱线重建"
          : "识谱 · 印刷体钢琴大谱表"}
      </h3>
      {geom?.ok ? (
        <p role="note" data-geom-engine="copisteria-geom">
          {GEOM_BANNER}图片会发送到本站识别服务，用完即删，不保存你的谱图。<a href="privacy.html">隐私说明</a>。识别可能需要一两分钟，状态栏会显示已用时间。若识别服务暂时不可用，将改用浏览器内的
          SMT 后备路径（需下载模型）。大谱表和复杂总谱仍可能不准，请校对。
        </p>
      ) : (
        <>
          <p>
            本轮针对端正清晰的印刷体西方五线谱，优先钢琴大谱表。手写谱、简谱和复杂总谱暂不支持。识别会有错，简单大谱表也可能读错谱号、产生多余声部，需要逐小节校对。
          </p>
          <p>
            首次需联网下载约 86.5 MB
            模型和推理运行时，文件经校验后缓存在本机；此编辑会话内下载完成后可离线识别。图片不会上传。
          </p>
        </>
      )}
      <div className="omr-actions">
        {singlePage ? (
          <button type="button" className={solid} disabled={busy || disabled} onClick={() => void recognize()}>
            识别此页
          </button>
        ) : null}
        <button
          type="button"
          className={singlePage ? quiet : solid}
          disabled={busy || disabled}
          onClick={() => void recognize(true)}
        >
          识别全部页并合并预览
        </button>
        {singlePage ? null : (
          <button type="button" className={quiet} disabled={busy || disabled} onClick={() => void recognize()}>
            识别此页
          </button>
        )}
        {busy && (
          <button
            type="button"
            className={quiet}
            onClick={() => {
              stop();
              setStatus(
                "已取消后续识别，已生成谱符及可转换草稿保留；可检查后确认写入，现有乐谱未更改。",
              );
            }}
          >
            取消识别
          </button>
        )}
      </div>
      <p role="status" aria-live="polite">
        {status}
      </p>
      {busy && progress !== undefined && (
        <progress max={100} value={progress} aria-label="模型下载进度" />
      )}
      {pageReports.length > 0 && (
        <ul aria-label="逐页识别结果" className="omr-page-reports">
          {pageReports.map((p) => (
            <li key={p.page}>
              第 {p.page} 页：{p.done ? (p.error ? "未完整识别" : "已尝试全部系统") : "尚未完成"}
              {p.total != null ? `（定位到 ${p.total} 个系统）` : ""}
              {p.error ? `；${p.error}` : ""}
            </li>
          ))}
        </ul>
      )}
      {issues.map((issue, i) => (
        <p key={i} role="note">
          {issue}
        </p>
      ))}
      {fragments.some((f) => f.text) && (
        <details className="omr-raw">
          <summary>查看已生成的本机谱符（含未完成部分）</summary>
          {fragments
            .filter((f) => f.text)
            .map((f) => (
              <div key={`${f.page}-${f.system}`}>
                <p>
                  {fragmentLabel(f)} · {f.complete ? "模型输出结束，仍需校对" : "未完成 / 待恢复"}
                  {f.error ? `：${f.error}` : ""}
                </p>
                <pre>{f.text}</pre>
              </div>
            ))}
        </details>
      )}
      {!busy && !draft && pageReports.length > 0 && !/^(暂不支持简谱|这不像五线谱|这一页是单行)/.test(status) && <button type="button" className={solid} onClick={() => onConfirm({ ...createBlankScore(), title: "图片识别草稿", tempoMarked: false, notes: [{ pitches: [], dur: 4 }] }, [...issues, "整页未恢复可转换音符；草稿休止仅为占位，请对照原图补音。"]) }>打开可修改的占位草稿</button>}
      {draft && (
        <div className="omr-draft" ref={draftRef} data-geom-draft="ready">
          <h3>{draft.partial ? "部分合并预览 · 存在未识别区域" : "合并预览 · 尚未写入主编辑器"}</h3>
          <p>
            顶上的主谱还是原来的样子，没有改动。
            {geomNoteCount != null
              ? `已识别 ${geomNoteCount} 个音，请在对照预览里查看。`
              : "识别结果会在对照预览里打开，不在顶上那行谱里。"}
          </p>
          <p>
            {draft.partial
              ? `仅包含第 ${draft.pages.join("、")} 页已恢复的 ${draft.systems} 个系统；失败或遗漏区域不在草稿中，请逐项检查。`
              : `共 ${draft.pages.length} 页，按页码顺序拼接为一首谱。`}
            确认将替换当前主谱，可用「撤销」恢复；随后可改音符、整首移调或途中转调。
            {busy && " 后续系统仍在识别，完成或取消后才能确认。"}
          </p>
          <p>
            调号：{draft.score.key} {draft.score.mode === "minor" ? "小调" : "大调"}；拍号：
            {draft.score.beats}/{draft.score.beatUnit}；{voiceList(draft.score).length}{" "}
            个声部{draft.score.staffInstrument === "piano" ? "（按钢琴大谱表读入）" : "（单行谱表）"}；约 {draft.score.measureEnds?.length ?? "未知"} 小节。
            {draft.score.tempoMarked === false ? " 没有读到可靠的速度记号，谱上不写 ♩=。" : ""}
          </p>
          <p>
            模型不提供经过校准的置信度。音符、拍号、声部分配均可能有错，尤其注意额外音符和漏音。
          </p>
          {draft.losses.map((loss, i) => (
            <p key={i}>{loss}</p>
          ))}
          <div className="omr-notation">
            <SafeOmrPreview score={draft.score} onReady={revealDraft} />
          </div>
          <div className="omr-actions" ref={draftActionsRef}>
            <button
              type="button"
              className={solid}
              disabled={busy}
              onClick={() => {
                installGeomHook({ editorScore: draft.score, editorOpen: true, score: draft.score });
                onConfirm(draft.score, draft.losses);
                setDraft(undefined);
                setStatus("已送入可编辑识别草稿，主谱尚未更改。");
              }}
            >
              编辑识别草稿 / 打开对照预览（主谱保持不变）
            </button>
            <button
              type="button"
              className={quiet}
              onClick={() => {
                setDraft(undefined);
                setStatus("已放弃识别草稿，现有乐谱未更改。");
              }}
            >
              放弃此草稿
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
