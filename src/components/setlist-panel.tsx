import { useEffect, useState } from "react";
import { readMySongs } from "@/lib/music/my-songs";
import { newDraftId } from "@/lib/music/draft-history";
import {
  SETLIST_KEY,
  addSetlist,
  addToSetlist,
  moveSetlistSong,
  readSetlists,
  removeSetlist,
  removeSetlistSong,
  type Setlist,
} from "@/lib/music/setlists";
import type { Score } from "@/lib/music/theory";
import "./setlist-panel.css";
const quiet = "setlist-button";
const solid = "setlist-button setlist-primary";

export default function SetlistPanel({
  onOpen,
}: {
  onOpen: (score: Score, id: string, setlistId?: string) => void;
}) {
  const [songs, setSongs] = useState<ReturnType<typeof readMySongs>>([]);
  const [lists, setLists] = useState<Setlist[]>([]);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    function refresh() {
      try {
        const next = readMySongs(localStorage);
        setSongs(next);
        setLists(
          readSetlists(
            localStorage,
            next.map((song) => song.id),
          ),
        );
      } catch {
        setError("无法读取本机歌单。");
      }
    }
    refresh();
    window.addEventListener("storage", refresh);
    return () => window.removeEventListener("storage", refresh);
  }, []);
  function save(next: Setlist[]) {
    try {
      localStorage.setItem(SETLIST_KEY, JSON.stringify(next));
      setLists(next);
      setError("");
      return true;
    } catch {
      setError("歌单未能保存到本机，可能空间不足。");
      return false;
    }
  }
  function update(next: Setlist) {
    save(lists.map((list) => (list.id === next.id ? next : list)));
  }
  return (
    <div className="setlist-manage mt-4 rounded-2xl border border-line p-4" aria-label="歌单管理">
      <p className="text-sm text-muted">按演出顺序收好曲子。打开后进入全屏，末页再翻就到下一首。</p>
      <form
        className="mt-3 flex flex-wrap gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (save(addSetlist(lists, newDraftId(), name))) setName("");
        }}
      >
        <input
          aria-label="歌单名称"
          placeholder="歌单名称"
          maxLength={80}
          className="h-11 min-w-0 flex-1 rounded-xl border border-line bg-white/80 px-3"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <button className={solid} disabled={!name.trim() || lists.length >= 100}>
          新建歌单
        </button>
      </form>
      {error && <p role="alert">{error}</p>}
      {lists.map((list) => (
        <section
          key={list.id}
          className="mt-4 border-t border-line pt-4"
          aria-label={`歌单 ${list.name}`}
        >
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="min-w-0 flex-1 break-words font-medium">
              {list.name} · {list.songs.length} 首
            </h3>
            <button
              className={solid}
              disabled={!list.songs.length}
              onClick={() => {
                const song = songs.find((song) => song.id === list.songs[0]);
                if (song) onOpen(song.value, song.id, list.id);
              }}
            >
              打开歌单
            </button>
            <button
              className={quiet}
              aria-label={`删除歌单 ${list.name}`}
              onClick={() => save(removeSetlist(lists, list.id))}
            >
              删除歌单
            </button>
          </div>
          <ol className="mt-2">
            {list.songs.map((id, index) => (
              <li key={id} className="flex flex-wrap items-center gap-1 border-b border-line py-2">
                <span className="min-w-0 flex-1 break-words text-sm">
                  {index + 1}. {songs.find((song) => song.id === id)?.title}
                </span>
                <button
                  className={quiet}
                  aria-label={`上移第 ${index + 1} 首`}
                  disabled={index === 0}
                  onClick={() => update(moveSetlistSong(list, index, -1))}
                >
                  ↑
                </button>
                <button
                  className={quiet}
                  aria-label={`下移第 ${index + 1} 首`}
                  disabled={index === list.songs.length - 1}
                  onClick={() => update(moveSetlistSong(list, index, 1))}
                >
                  ↓
                </button>
                <button
                  className={quiet}
                  aria-label={`移出第 ${index + 1} 首`}
                  onClick={() => update(removeSetlistSong(list, id))}
                >
                  移出
                </button>
              </li>
            ))}
          </ol>
          <select
            aria-label={`添加曲子到 ${list.name}`}
            value=""
            className="mt-2 h-11 w-full rounded-xl border border-line bg-white/80 px-3"
            onChange={(event) => update(addToSetlist(list, event.target.value))}
          >
            <option value="">选择曲子加入歌单…</option>
            {songs
              .filter((song) => !list.songs.includes(song.id))
              .map((song) => (
                <option key={song.id} value={song.id}>
                  {song.title}
                </option>
              ))}
          </select>
        </section>
      ))}
    </div>
  );
}
