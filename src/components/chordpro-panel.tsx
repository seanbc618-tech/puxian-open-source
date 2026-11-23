import { useState } from "react";
import { applyChordPro, exportChordPro } from "@/lib/music/chordpro";
import type { Score } from "@/lib/music/theory";
import { quiet } from "./ui/styles";

/**
 * ChordPro (OnSong / SongbookPro lead-sheet text): paste "[C]一闪[G]一闪" to put the words and
 * chords on the melody already written, or save this song's words and chords as .cho.
 * Lazy: loads only when the 歌词 panel opens.
 */
export default function ChordProPanel({ score, fileBase, disabled, onApply }: { score: Score; /** Download name without extension (the editor's own export naming). */ fileBase: string; disabled: boolean; onApply: (score: Score, message: string) => void }) {
  const [text, setText] = useState("");
  const [report, setReport] = useState<{ ok: boolean; lines: string[] } | null>(null);
  const apply = () => {
    try {
      const r = applyChordPro(score, text);
      onApply(r.score, `已套上 ${r.syllables} 个字、${r.chords} 个和弦名，可撤销。`);
      setReport({ ok: true, lines: [...r.notes, ...(r.losses.length ? [`没套进去：${r.losses.join("、")}`] : [])] });
    } catch (err) {
      setReport({ ok: false, lines: [err instanceof Error ? err.message : "这段文字读不了，现有谱未更改。"] });
    }
  };
  const save = () => {
    const r = exportChordPro(score);
    const url = URL.createObjectURL(new Blob([r.text], { type: "text/plain;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${fileBase}.cho`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setReport({ ok: true, lines: [r.losses.length ? `ChordPro 已导出；未写进去：${r.losses.join("、")}。` : "ChordPro 已导出。"] });
  };
  return (
    <div className="tool-group mt-3" data-chordpro="">
      <p className="tool-group-title">ChordPro 歌词和弦<span>和 OnSong、SongbookPro 等互通</span></p>
      <label className="block text-sm text-muted" htmlFor="chordpro-paste">粘贴带 [和弦] 的歌词，按顺序一字一音套到声部一</label>
      <textarea id="chordpro-paste" className="text-score-paste mt-1 rounded-2xl border border-line bg-bg p-3 text-sm leading-relaxed text-ink"
        spellCheck={false} rows={3} value={text} onChange={(event) => setText(event.target.value)}
        placeholder={"{title: 小星星}\n[C]一闪一闪[G]亮晶晶"} />
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" className={quiet} disabled={disabled || !text.trim()} onClick={apply}>套到旋律上</button>
        <button type="button" className={quiet} onClick={save}>导出 ChordPro（.cho）</button>
      </div>
      {report ? (
        <ul className="mt-2 text-sm" role="status" data-chordpro-report="" data-ok={report.ok ? "" : undefined}>
          {report.lines.map((line) => <li key={line}>{line}</li>)}
        </ul>
      ) : null}
    </div>
  );
}
