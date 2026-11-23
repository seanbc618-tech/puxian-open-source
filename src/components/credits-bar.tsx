import { useEffect, useState } from "react";
import type { Score } from "@/lib/music/theory";

/** 词/曲 credits for the jianpu header. Lazy-loaded from the 写谱 panel so score-credits.ts
 * is not a shared first-screen mapDeps chunk. */
export default function CreditsBar({
  score,
  canEdit,
  onChange,
  quiet,
}: {
  score: Score;
  canEdit: boolean;
  onChange: (next: Score, notice: string) => void;
  quiet: string;
}) {
  const [lyricist, setLyricist] = useState(score.lyricist ?? "");
  const [composer, setComposer] = useState(score.composer ?? "");
  useEffect(() => { setLyricist(score.lyricist ?? ""); setComposer(score.composer ?? ""); }, [score.lyricist, score.composer]);
  const clean = (raw: string) => raw.replace(/\s+/g, " ").trim().slice(0, 40);
  const save = (nextLyricist: string, nextComposer: string) => {
    const out: Score = { ...score };
    const l = clean(nextLyricist);
    const c = clean(nextComposer);
    if (l) out.lyricist = l;
    else delete out.lyricist;
    if (c) out.composer = c;
    else delete out.composer;
    const parts = [l ? `词：${l}` : "", c ? `曲：${c}` : ""].filter(Boolean);
    onChange(out, parts.length ? `已设${parts.join("，")}。可以撤销。` : "已清除词曲作者。可以撤销。");
  };
  return (
    <div className="tool-group mt-3" data-credits-bar="">
      <p className="tool-group-title">
        词曲作者<span>印在简谱标题一行的左右两侧，像出版简谱那样</span>
      </p>
      <form
        className="mt-2 flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (!canEdit) return;
          save(lyricist, composer);
        }}
      >
        <label className="text-sm text-muted" htmlFor="score-lyricist">
          词
        </label>
        <input
          id="score-lyricist"
          aria-label="词作者"
          style={{ minWidth: 44, minHeight: 44 }}
          className="rounded-xl border border-line bg-bg px-2 text-sm text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          value={lyricist}
          maxLength={40}
          disabled={!canEdit}
          onChange={(event) => setLyricist(event.target.value)}
          placeholder="作词"
        />
        <label className="text-sm text-muted" htmlFor="score-composer">
          曲
        </label>
        <input
          id="score-composer"
          aria-label="曲作者"
          style={{ minWidth: 44, minHeight: 44 }}
          className="rounded-xl border border-line bg-bg px-2 text-sm text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          value={composer}
          maxLength={40}
          disabled={!canEdit}
          onChange={(event) => setComposer(event.target.value)}
          placeholder="作曲"
        />
        <button type="submit" className={quiet} style={{ minWidth: 44, minHeight: 44 }} disabled={!canEdit}>
          写入谱面
        </button>
      </form>
      <p className="mt-2 text-xs text-muted" data-credits-summary="">
        {score.lyricist || score.composer
          ? [score.lyricist ? `词：${score.lyricist}` : "", score.composer ? `曲：${score.composer}` : ""].filter(Boolean).join("　")
          : "还没有词曲作者。写上后会出现在简谱标题两侧，并随 MusicXML、ABC、123 一起保存。"}
      </p>
    </div>
  );
}
