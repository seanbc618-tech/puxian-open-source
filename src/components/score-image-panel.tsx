import "./score-image-panel.css";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { attachResizeHandle } from "../lib/card-size";
import type { RecognitionSourceImage } from "./recognition-draft";
import { quiet } from "./ui/styles";

import type { Score } from "../lib/music/theory";
const ScoreOmr = lazy(() => import("./score-omr"));
type Page = { url: string; name: string; file: File };

function ImageCard({
  page,
  zoom,
  cardRef,
}: {
  page: Page;
  zoom: boolean;
  cardRef: { current: HTMLDivElement | null };
}) {
  return (
    <div ref={cardRef} className="score-image-card">
      <div className="score-image-viewport">
        <img
          src={page.url}
          alt={`谱子图片：${page.name}`}
          style={{ display: "block", width: zoom ? "180%" : "100%", maxWidth: "none" }}
        />
      </div>
    </div>
  );
}

export default function ScoreImagePanel({
  files,
  onClose,
  decode,
  onConfirm,
  onAttempt,
  onNavigate,
}: {
  files: File[];
  onClose: () => void;
  decode: typeof import("../lib/music/musicxml").musicXmlToScore;
  onConfirm: (score: Score, losses: string[], source?: { images: RecognitionSourceImage[]; current: number }) => void;
  onAttempt?: (event: { phase: "start" | "fail"; message?: string }) => void;
  onNavigate: (target: "zone-input" | "zone-key") => void;
}) {
  const [pages, setPages] = useState<Page[]>([]);
  const [current, setCurrent] = useState(0);
  const [messages, setMessages] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [zoom, setZoom] = useState(false);
  const [imported, setImported] = useState(false);
  const [omrPhase, setOmrPhase] = useState<"idle" | "running" | "done" | "failed">("idle");
  const imageCard = useRef<HTMLDivElement>(null);
  const queue = useRef(Promise.resolve());
  const processed = useRef(0);
  const accepted = useRef<Page[]>([]);
  const urls = useRef<string[]>([]);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      urls.current.forEach(URL.revokeObjectURL);
    };
  }, []);
  useEffect(() => {
    const batch = files.slice(processed.current);
    processed.current = files.length;
    queue.current = queue.current.then(async () => {
      if (!alive.current) return;
      setBusy(true);
      const warn = (message: string) => {
        if (alive.current) setMessages((old) => [...old, message]);
      };
      const add = (blob: Blob, name: string) => {
        if (!alive.current) return;
        const image =
          blob instanceof File ? blob : new File([blob], `${name}.png`, { type: "image/png" });
        const page = { url: URL.createObjectURL(blob), name, file: image };
        urls.current.push(page.url);
        accepted.current = [...accepted.current, page];
        setPages(accepted.current);
      };
      for (const file of batch) {
        const pdf = /\.pdf$/i.test(file.name) || file.type === "application/pdf";
        const limit = pdf ? 40 : 20;
        if (file.size > limit * 1024 * 1024) {
          warn(`${file.name}：超过 ${limit} MB，未加入。`);
          continue;
        }
        if (!pdf && !/\.(png|jpe?g|webp)$/i.test(file.name)) {
          warn(`${file.name}：不支持此格式，HEIC / HEIF 请先转为 PNG、JPG 或 WebP。`);
          continue;
        }
        if (accepted.current.length >= 40) {
          warn(`${file.name}：合计最多 40 页，此文件未加入。`);
          continue;
        }
        try {
          if (pdf) {
            const { renderPdf } = await import("./score-pdf");
            await renderPdf(
              file,
              () => (alive.current ? 40 - accepted.current.length : 0),
              add,
              warn,
            );
          } else {
            const bitmap = await createImageBitmap(file);
            bitmap.close();
            add(file, file.name);
          }
        } catch {
          warn(
            `${file.name}：${pdf ? "PDF 无法打开（可能已加密或损坏）" : "图片无法打开，请换一张 PNG、JPG 或 WebP 图片"}。`,
          );
        }
      }
      if (alive.current) setBusy(false);
    });
  }, [files]);
  const imagePages = useMemo(() => pages.map((page) => page.file), [pages]);
  useEffect(() => {
    const el = imageCard.current;
    if (!el) return;
    return attachResizeHandle(el, {
      id: "score-image-card",
      label: "调整图片卡片大小",
      minWidth: 240,
      minHeight: 240,
      axes: "both",
    });
  }, [pages, current]);

  const page = pages[current];
  return (
    <aside
      tabIndex={0}
      aria-label="谱子图片对照"
      className="score-image-panel zone-panel no-print my-4 rounded-2xl border border-line bg-paper p-4"
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
          event.preventDefault();
          event.stopPropagation();
          setCurrent((n) =>
            Math.max(0, Math.min(pages.length - 1, n + (event.key === "ArrowRight" ? 1 : -1))),
          );
        }
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-medium">多图 / PDF 合并导入主谱</h2>
        <button className={quiet} onClick={onClose}>
          关闭图片
        </button>
      </div>
      <p className="text-sm text-muted">
        支持识别印刷体西方五线谱，优先钢琴大谱表；识别会有错，需校对，确认前不会覆盖当前乐谱。点识别后，图片会发到本站识别服务，用完即删。<a href="privacy.html">隐私说明</a>
      </p>
      <p role="status">
        {busy
          ? "正在本机打开页面…"
          : omrPhase === "done"
            ? "识别已经完成。请在对照预览里检查，再写入主谱。主谱还没改。"
            : omrPhase === "failed"
              ? "这次没有新的识别结果。左边的主谱仍是上一次写入的内容，不是这次的结果。"
              : omrPhase === "running"
                ? "正在识别，请稍等。主谱还没改。"
                : pages.length > 1
                  ? "页面已在本机打开。下一步：点击「识别全部页并合并预览」，检查后确认写入主谱。"
                  : pages.length
                    ? "页面已在本机打开。下一步：点击「识别此页」，检查后确认写入主谱。"
                    : "请选择可打开的图片或 PDF。"}
      </p>
      {messages.map((message, index) => (
        <p role="alert" key={index}>
          {message}
        </p>
      ))}
      {page && (
        <Suspense fallback={<p role="status">正在打开本机识谱面板…</p>}>
          <ScoreOmr
            disabled={busy}
            pages={imagePages}
            currentPage={current}
            decode={decode}
            onPhase={setOmrPhase}
            onConfirm={(score, losses) => {
              onConfirm(score, losses, {
                images: pages.map((p) => ({ url: p.url, name: p.name })),
                current,
              });
              setImported(true);
            }}
            onAttempt={onAttempt}
          />
        </Suspense>
      )}
      {imported && (
        <div role="status" className="my-3">
          <p>结果已送入识别草稿。请校对后点「写入主谱」，写入后可撤销恢复原谱。</p>
          <button className={quiet} onClick={() => onNavigate("zone-input")}>
            去主谱改音符 / 途中转调
          </button>{" "}
          <button className={quiet} onClick={() => onNavigate("zone-key")}>
            去移调与乐器（整首移调）
          </button>
        </div>
      )}
      {page && (
        <>
          <div className="flex flex-wrap items-center gap-2 my-3">
            <button className={quiet} disabled={!current} onClick={() => setCurrent(current - 1)}>
              上一页
            </button>
            <span>
              第 {current + 1} 页 / 共 {pages.length} 页
            </span>
            <button
              className={quiet}
              disabled={current === pages.length - 1}
              onClick={() => setCurrent(current + 1)}
            >
              下一页
            </button>
            <button className={quiet} onClick={() => setZoom(!zoom)}>
              {zoom ? "适合宽度" : "放大谱面"}
            </button>
            <button
              className={quiet}
              onClick={() => {
                URL.revokeObjectURL(page.url);
                accepted.current = accepted.current.filter((p) => p !== page);
                setPages(accepted.current);
                setCurrent(Math.max(0, current - 1));
                if (!accepted.current.length) onClose();
              }}
            >
              删除当前页
            </button>
          </div>
          <nav
            aria-label="对照页码"
            className="flex flex-wrap gap-2"
            style={{ maxHeight: 100, overflowY: "auto" }}
          >
            {pages.map((p, i) => (
              <button
                className={quiet}
                aria-current={i === current ? "page" : undefined}
                style={{ fontWeight: i === current ? 700 : 400 }}
                title={p.name}
                key={p.url}
                onClick={() => setCurrent(i)}
              >
                {i + 1}
              </button>
            ))}
          </nav>
          <p>{page.name}</p>
          <p className="text-sm text-muted">
            默认按可用高度显示整页。拖动右下角手柄可再调整，尺寸记在本机（puxian-card-sizes-v1）。
          </p>
          <ImageCard page={page} zoom={zoom} cardRef={imageCard} />
        </>
      )}
      <details className="mt-3 text-sm">
        <summary>格式、限制与识别说明</summary>
        <p className="mt-3 text-sm leading-7 text-muted">
          支持识别印刷体西方五线谱，优先钢琴大谱表；识别会有错，需校对，确认前不会覆盖当前乐谱。点识别后，图片会发到本站识别服务，用完即删。可对照下图在下方手动写谱，或使用「听写与音频」、上传音乐
          / MIDI、导入 MusicXML / .jpwabc。
        </p>
        <p className="text-sm leading-7 text-muted">
          支持多选 PNG、JPG、WebP（每张最多 20 MB）及 PDF（每份最多 40 MB），合计最多 40 页。HEIC /
          HEIF
          请先转换。刷新或返回首页后需重新选择文件。识别时图片会发到本站服务，用完即删，不归档保存。<a href="privacy.html">隐私说明</a>
        </p>
      </details>
    </aside>
  );
}
