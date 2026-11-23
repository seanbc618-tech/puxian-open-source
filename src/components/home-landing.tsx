import { flushSync } from "react-dom";
import { ScoreImageUpload } from "./score-image";
import { MUSIC_UPLOAD_HELP } from "@/lib/music/upload";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { OVERTURE_INNER, OVERTURE_VIEWBOX } from "@/lib/home-overture";
import { ArrowRight, Copy, Music2, Pencil, Plus } from "lucide-react";
import { HOME_EXAMPLES, HOME_EXAMPLE_GROUPS, scoreFromExample, type Example, type ExampleCard } from "@/lib/music/examples";
import { createBlankScore, isScore, STORAGE_KEY } from "@/lib/music/score-storage";
import {
  clearAutoSongs,
  compactSameTitleAutos,
  duplicateSong,
  readMySongs,
  renameSong,
  restoreSongs,
} from "@/lib/music/my-songs";
import type { Draft } from "@/lib/music/draft-history";
import type { Score } from "@/lib/music/theory";
import { AppErrorBoundary } from "./app-error-boundary";
import { quiet, solid } from "./ui/styles";

const loadAtmosphere = () => { void import(/* @vite-ignore */ new URL("site-fx.js", document.baseURI).href).catch(() => {}); };

function HomeOverture() {
  return <svg className="px-overture" viewBox={OVERTURE_VIEWBOX} preserveAspectRatio="xMinYMid meet" aria-hidden="true" dangerouslySetInnerHTML={{ __html: OVERTURE_INNER }} />;
}

const songArrow = <ArrowRight className="size-5 shrink-0 text-accent" aria-hidden="true" />;

// A dropped chunk fetch is tried once more (browsers do not cache the failure), so the editor
// cannot hang on 「正在打开乐谱…」. Inline on purpose: a shared helper would add a first-screen request.
const SetlistPanel = lazy(() => { const load = () => import("./setlist-panel"); return load().catch(load); });

const StafflineApp = lazy(() => {
  const load = () => import("./staffline-app");
  return load().catch(load).then((module) => ({ default: module.StafflineApp }));
});

type HomeLandingProps = {
  onSelect: (example: ExampleCard) => void;
  onOpenSong: (score: Score, songId: string, setlistId?: string) => void;
  onCreate: () => void;
  onResume: () => void;
  onMusic: () => void;
  onImage: (files: File[]) => void;
  unsavedScore?: Score;
  shareNotice?: string | null;
};

export function HomeLanding({ onSelect, onOpenSong, onCreate, onResume, onImage, onMusic, unsavedScore, shareNotice }: HomeLandingProps) {
  const [showSetlists, setShowSetlists] = useState(false);
  const [mySongs, setMySongs] = useState<ReturnType<typeof readMySongs>>([]);
  const [draftTitle, setDraftTitle] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null);
  const [songNotice, setSongNotice] = useState<string | null>(null);
  const [clearingAutos, setClearingAutos] = useState(false);
  const [clearedAutos, setClearedAutos] = useState<Draft<Score>[] | null>(null);
  /** The open draft, set aside when its automatic entry was cleared (put back by 撤回). */
  const clearedDraft = useRef<string | null>(null);

  /** Clearing an automatic save also drops「继续上次草稿」when that save was the open draft. */
  function dropClearedDraft(removed: readonly Draft<Score>[]) {
    clearedDraft.current = null;
    const raw = localStorage.getItem(STORAGE_KEY);
    const data = raw ? JSON.parse(raw) : null;
    if (raw && typeof data?.songId === "string" && removed.some((draft) => draft.id === data.songId)) {
      clearedDraft.current = raw;
      localStorage.removeItem(STORAGE_KEY);
      setDraftTitle(null);
    }
  }

  function restoreClearedDraft() {
    const raw = clearedDraft.current;
    clearedDraft.current = null;
    if (!raw || localStorage.getItem(STORAGE_KEY)) return;
    localStorage.setItem(STORAGE_KEY, raw);
    const data = JSON.parse(raw);
    if (isScore(data?.score)) setDraftTitle(data.score.title || "未命名乐谱");
  }

  function undoClear() {
    if (!clearedAutos) return;
    try {
      restoreSongs(localStorage, clearedAutos);
      restoreClearedDraft();
      setSongNotice("已撤回清理，自动保存已放回。");
    } catch { setSongNotice("撤回没能保存到本机。"); }
    setClearedAutos(null);
    refreshSongs();
  }

  function refreshSongs() {
    try {
      const songs = readMySongs(localStorage);
      setMySongs(songs);
      if (localStorage.getItem("puxian-setlists-v1")) void import("@/lib/music/setlists").then(({ readSetlists }) => readSetlists(localStorage, songs.map(song => song.id)));
    } catch {
      /* storage unavailable */
    }
  }

  function commitRename() {
    if (!renaming) return;
    try {
      if (renameSong(localStorage, renaming.id, renaming.title)) {
        // Keep「继续上次草稿」in step when the renamed song is the open draft.
        const raw = localStorage.getItem(STORAGE_KEY);
        const data = raw ? JSON.parse(raw) : null;
        if (data?.songId === renaming.id && isScore(data.score)) {
          data.score = { ...data.score, title: renaming.title.trim() };
          localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
          setDraftTitle(data.score.title);
        }
        setSongNotice(`已改名为「${renaming.title.trim()}」。`);
      }
    } catch {
      setSongNotice("改名没能保存到本机。");
    }
    setRenaming(null);
    refreshSongs();
  }

  useEffect(() => {
    try {
      compactSameTitleAutos(localStorage);
      setMySongs(readMySongs(localStorage));
      const raw = localStorage.getItem(STORAGE_KEY);
      const data = raw ? JSON.parse(raw) : null;
      if (isScore(data?.score)) setDraftTitle(data.score.title || "未命名乐谱");
    } catch {
      // A private browser or damaged draft must not prevent starting a score.
    }
  }, []);

  return (
    <main className="app-shell mx-auto min-h-screen max-w-5xl" data-home-landing>
      <header className="flex items-center justify-between gap-4 border-b border-line pb-5">
        <p className="flex items-center gap-2 text-xl font-medium">
          <Music2 className="size-5" aria-hidden="true" />
          谱线
        </p>
        <a href="#songs" className="inline-flex min-h-11 items-center px-2 text-sm text-muted underline-offset-4 hover:underline">
          选一首曲子
        </a>
      </header>

      <section aria-labelledby="home-title" className="home-hero" data-home-plate>
        <HomeOverture />
        <p data-home-eyebrow className="home-eyebrow mb-3">写下灵感 · 听见旋律</p>
        <h1
          id="home-title"
          aria-label="让旋律，落在纸上。"
          className="home-title"
        >
          {Array.from("让旋律，落在纸上。").map((char, i) => <span key={i}>{char}</span>)}
        </h1>
        <p data-home-desc className="home-desc mt-2 sm:mt-3">
          照片 / PDF、录音 / 音频 / MIDI，先识别成可修改的草稿，再写入主谱。
        </p>
        <div data-home-workbench className="home-workbench mt-4 sm:mt-6">
          <div data-honest-notice className="home-honest-notice">
            <span className="honest-dot" aria-hidden="true" />
            <span>生成可改草稿 · 需校对</span>
          </div>
          <div className="home-workbench-actions">
            <ScoreImageUpload onSelect={onImage} className="home-btn-primary" />
            <button type="button" className="home-btn-primary" onClick={onMusic}>
              识别音乐
            </button>
          </div>
          <p className="text-xs text-muted">识谱只认印刷五线谱，不含简谱、手写。</p>
        </div>
        <div className="home-secondary-actions mt-3">
          <button type="button" className={quiet} onClick={onCreate}>
            <Plus className="size-4" aria-hidden="true" />
            新建空白谱
          </button>
          {unsavedScore || draftTitle !== null ? (
            <button type="button" className={quiet} onClick={onResume}>
              继续上次草稿
              <ArrowRight className="size-4" aria-hidden="true" />
            </button>
          ) : null}
        </div>
        <details className="mt-3 max-w-xl text-xs leading-6 text-muted">
          <summary className="flex min-h-11 w-fit cursor-pointer items-center">支持哪些音乐文件？</summary>
          <p className="mt-1">{MUSIC_UPLOAD_HELP}</p>
        </details>
        {shareNotice ? (
          <p role="alert" className="mt-3 text-sm text-warn">{shareNotice}</p>
        ) : null}
        {unsavedScore ? (
          <p role="status" className="mt-3 text-sm text-warn">
            「{unsavedScore.title || "未命名乐谱"}
            」暂存于当前页面。本机保存失败，请继续草稿并导出备份，刷新会丢失未保存的修改。
          </p>
        ) : draftTitle !== null ? (
          <p className="mt-3 text-sm text-muted">上次编辑：{draftTitle}</p>
        ) : null}
      </section>

      <section id="songs" aria-labelledby={mySongs.length ? "songs-title" : "examples-title"} className="scroll-mt-6 border-t border-line pt-6">
        <button type="button" className={quiet} aria-expanded={showSetlists} onClick={() => setShowSetlists(on => !on)}>歌单</button>
        {showSetlists ? <Suspense fallback={<p role="status">正在打开歌单…</p>}><SetlistPanel key={mySongs.map(song => song.id).join()} onOpen={onOpenSong} /></Suspense> : null}
        {songNotice || (clearedAutos?.length && !clearingAutos) ? <div className="mt-3 flex flex-wrap items-center gap-2">
          {songNotice ? <p role="status" className="text-sm text-muted">{songNotice}</p> : null}
          {clearedAutos?.length && !clearingAutos ? <button type="button" className={quiet} onClick={undoClear}>撤回</button> : null}
        </div> : null}
        {mySongs.length > 0 ? (
          <>
        <h2 id="songs-title" className="text-2xl font-medium">
          我的曲子
        </h2>
        <p className="mt-2 text-sm leading-7 text-muted">
          每首曲子一条，边写边自动保存。在编辑器点「保存当前草稿」的会放在「手动保存」里，不会被自动保存挤掉。
        </p>
        {mySongs.some((song) => !song.pinned) ? (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {clearingAutos ? (
              <>
                <p className="text-sm text-muted">
                  将删除 {mySongs.filter((song) => !song.pinned).length} 首自动保存，手动保存不受影响。
                </p>
                <button
                  type="button"
                  className={solid}
                  onClick={() => {
                    try {
                      const removed = clearAutoSongs(localStorage);
                      dropClearedDraft(removed);
                      setClearedAutos(removed);
                      setClearingAutos(false);
                      setSongNotice(`已清理 ${removed.length} 首自动保存。`);
                    } catch {
                      setClearingAutos(false);
                      setSongNotice("清理没能保存到本机。");
                    }
                    refreshSongs();
                  }}
                >
                  确认清理自动存档
                </button>
                <button type="button" className={quiet} onClick={() => setClearingAutos(false)}>
                  取消
                </button>
              </>
            ) : (
              <button
                type="button"
                className={quiet}
                onClick={() => {
                  setSongNotice(null);
                  setClearingAutos(true);
                }}
              >
                清理自动存档
              </button>
            )}
          </div>
        ) : null}
        {([
            ["手动保存", mySongs.filter((song) => song.pinned)],
            ["自动保存", mySongs.filter((song) => !song.pinned)],
          ] as const).filter(([, list]) => list.length > 0).map(([label, list]) => (
            <div key={label} className="mt-4">
              <h3 className="text-sm font-medium text-muted">{label} · {list.length} 首</h3>
              <ul className="song-list mt-2">
                {list.map((song) => (
                  <li key={song.id} className="song-item">
                    {renaming?.id === song.id ? (
                      <form
                        className="flex flex-1 flex-wrap items-center gap-2 px-4 py-3"
                        onSubmit={(event) => { event.preventDefault(); commitRename(); }}
                      >
                        <input
                          aria-label="新的曲名"
                          autoFocus
                          value={renaming.title}
                          onChange={(event) => setRenaming({ id: song.id, title: event.target.value })}
                          className="h-11 min-w-0 flex-1 rounded-xl border border-line bg-white/80 px-3 text-base"
                        />
                        <button type="submit" className={solid} disabled={!renaming.title.trim()}>保存</button>
                        <button type="button" className={quiet} onClick={() => setRenaming(null)}>取消</button>
                      </form>
                    ) : (
                      <>
                        <button
                          type="button"
                          aria-label={`打开我的曲子 ${song.title}`}
                          onClick={() => onOpenSong(song.value, song.id)}
                          className="song-row"
                        >
                          <span className="min-w-0">
                            <span className="block break-words text-base font-medium">{song.title}</span>
                            {song.incipit ? (
                              <span className="mt-0.5 block truncate text-sm tracking-wide text-ink/70">{song.incipit}</span>
                            ) : null}
                            <span className="mt-0.5 block text-xs leading-6 text-muted">
                              {HOME_EXAMPLES.some((item) => item.title === song.title) ? "不是示例 · " : ""}
                              {song.pinned ? "手动保存" : "自动保存"}于 {new Date(song.at).toLocaleString("zh-CN")}
                            </span>
                          </span>
                          {songArrow}
                        </button>
                        <div className="song-actions">
                          <button type="button" className="song-action" aria-label={`重命名 ${song.title}`}
                            onClick={() => { setSongNotice(null); setRenaming({ id: song.id, title: song.title }); }}>
                            <Pencil className="size-4" aria-hidden="true" />
                          </button>
                          <button type="button" className="song-action" aria-label={`复制一份 ${song.title}`}
                            onClick={() => {
                              try {
                                if (duplicateSong(localStorage, song.id)) setSongNotice(`已复制「${song.title}」。`);
                              } catch {
                                setSongNotice("复制没能保存到本机，可能空间不足。");
                              }
                              refreshSongs();
                            }}>
                            <Copy className="size-4" aria-hidden="true" />
                          </button>
                        </div>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
          </>
        ) : null}
        <h2 id="examples-title" className={mySongs.length ? "mt-8 text-2xl font-medium" : "text-2xl font-medium"}>
          示例曲目
        </h2>
        {mySongs.length === 0 ? (
          <p className="mt-2 text-sm leading-7 text-muted">打开下面一首，就能开始写、听和练习。</p>
        ) : null}
        {HOME_EXAMPLE_GROUPS.map((group) => (
        <section key={group.id} className="example-group">
          <h3>{group.label}</h3>
          <div className="song-list mt-4">
          {HOME_EXAMPLES.filter((example) => example.group === group.id).map((example) => (
            <button
              key={example.id}
              type="button"
              aria-label={`打开${example.title}`}
              onClick={async (event) => {
                const card = event.currentTarget;
                if (!document.startViewTransition || matchMedia("(prefers-reduced-motion: reduce)").matches) { onSelect(example); return; }
                try { await import("./staffline-app"); } catch { onSelect(example); return; }
                card.style.viewTransitionName = "px-score";
                const transition = document.startViewTransition(async () => {
                  flushSync(() => onSelect(example));
                  const until = Date.now() + 1200;
                  while (!document.querySelector(".app-shell") && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 16));
                  await new Promise(resolve => setTimeout(resolve, 32));
                });
                void transition.finished.catch(() => {}).finally(() => { card.style.viewTransitionName = ""; });
              }}
              className="song-row"
            >
              <span>
                <span className="sr-only">示例曲目</span>
                <span className="block text-base font-medium"><span className="text-xs font-medium text-muted">示例 · </span>{example.title}</span>
                <span className="mt-1 block text-xs leading-6 text-muted">
                  {example.composer ? `曲：${example.composer} · ` : ""}
                  {example.keyText ?? `${example.key} ${example.mode === "major" ? "大调" : "小调"}`}
                  {example.lazy ? "" : ` · ${example.beats}/${example.beatUnit} 拍 · 每分钟 ${example.bpm} 拍`}
                  {example.chords?.length ? " · 带和弦" : ""}
                </span>
              </span>
              {songArrow}
            </button>
          ))}
          </div>
        </section>
        ))}
      </section>
      <footer className="mt-12 border-t border-line pt-5 text-sm leading-7 text-muted">
        <p aria-label="功能介绍">照片 / PDF 走本站识别，录音 / 音频 / MIDI 在本机处理 → 识别草稿 · 辅助模块 · 导出与打印</p>
        <p className="mt-2 text-xs leading-6">仅存于当前浏览器，每首曲子一条，最多 20 首；空间不足时先移除较早的自动保存，手动保存不会被挤掉。可在「本机草稿」删除。音频需重新选择，重要作品请导出备份。<a href="privacy.html">隐私说明</a></p>
      </footer>
    </main>
  );
}

/** Shared client-only entry: the web route and static SPA start on the same home. */
export function HomeApp() {
  useEffect(() => {
    const timer = setTimeout(loadAtmosphere, 4000);
    const visibility = () => document.documentElement.toggleAttribute("data-px-hidden", document.hidden);
    document.addEventListener("visibilitychange", visibility);
    visibility();
    return () => { clearTimeout(timer); document.removeEventListener("visibilitychange", visibility); document.documentElement.removeAttribute("data-px-hidden"); };
  }, []);

  const [editor, setEditor] = useState<{ initialScore?: Score; pendingUpload?: File; pendingImage?: File[]; recognizeMusic?: boolean; songId?: string; setlistId?: string; shared?: boolean; pendingExampleId?: string } | null>(null);
  const [shareNotice, setShareNotice] = useState<string | null>(null);
  const [unsavedScore, setUnsavedScore] = useState<Score>();
  const transitioned = useRef(false);
  const content = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!transitioned.current) return;
    content.current?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }, [editor]);

  function openEditor(initialScore?: Score, pendingUpload?: File, songId?: string, shared = false, setlistId?: string, pendingExampleId?: string) {
    loadAtmosphere();
    transitioned.current = true;
    setShareNotice(null);
    setEditor({ initialScore, pendingUpload, songId, shared, setlistId, pendingExampleId });
  }

  useEffect(() => {
    let cancelled = false;
    const openFromHash = () => {
      const hash = window.location.hash;
      if (!hash.startsWith("#s=")) return;
      void import("@/lib/music/share-link").then(({ parseShareHash }) => {
        if (cancelled) return;
        const score = parseShareHash(hash);
        if (!score) {
          setShareNotice("分享链接无效或已损坏。可以请对方改发 MusicXML 或简谱文件。");
          return;
        }
        openEditor(score, undefined, undefined, true);
      });
    };
    openFromHash();
    window.addEventListener("hashchange", openFromHash);
    // Pointer movement warms the lazy entry once; untouched home stays light.
    const prefetch = () => { void import("./staffline-app"); };
    window.addEventListener("pointermove", prefetch, { once: true, passive: true });
    return () => {
      cancelled = true;
      window.removeEventListener("hashchange", openFromHash);
      window.removeEventListener("pointermove", prefetch);
    };
  }, []);

  return (
    <AppErrorBoundary>
    <div ref={content} tabIndex={-1} className="outline-none" style={{ viewTransitionName: editor ? "px-score" : undefined }}>
      {editor ? (
        <Suspense
          fallback={
            <p role="status" className="p-8 text-muted">
              正在打开乐谱…
            </p>
          }
        >
          <StafflineApp
            initialScore={editor.initialScore}
            pendingUpload={editor.pendingUpload}
            pendingImage={editor.pendingImage}
            recognizeMusic={editor.recognizeMusic}
            songId={editor.songId}
            setlistId={editor.setlistId}
            shared={editor.shared}
            pendingExampleId={editor.pendingExampleId}
            onReturnHome={(unsaved) => {
              setUnsavedScore(unsaved);
              setEditor(null);
            }}
          />
        </Suspense>
      ) : (
        <HomeLanding
          onOpenSong={(score, id, list) => openEditor(score, undefined, id, false, list)}
          onSelect={(example) => {
            if (example.lazy) {
              openEditor({
                title: example.title,
                composer: example.composer,
                bpm: example.bpm,
                beats: example.beats,
                beatUnit: example.beatUnit,
                key: example.key,
                mode: example.mode,
                clef: "treble",
                tonicOctave: 4,
                notes: [],
              }, undefined, undefined, false, undefined, example.id);
              return;
            }
            try {
              openEditor(scoreFromExample(example as Example));
            } catch {
              setShareNotice("示例乐谱打不开，请稍后重试。");
            }
          }}
          onCreate={() => openEditor(createBlankScore())}
          onImage={(file) => { transitioned.current = true; setEditor({ initialScore: unsavedScore, pendingImage: file }); }}
          onMusic={() => { transitioned.current = true; setEditor({ initialScore: createBlankScore(), recognizeMusic: true }); }}
          onResume={() => openEditor(unsavedScore)}
          unsavedScore={unsavedScore}
          shareNotice={shareNotice}
        />
      )}
    </div>
    </AppErrorBoundary>
  );
}
