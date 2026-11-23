import assert from "node:assert/strict";
import { test } from "node:test";
import { appendDraft, readDrafts, writeDrafts, DRAFT_KEY } from "./draft-history.ts";
import { createBlankScore, isScore } from "./score-storage.ts";
import { readMySongs } from "./my-songs.ts";

test("homepage reads saved scores after reload and shares editor deletions", () => {
  const data = new Map<string, string>();
  const store = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
    removeItem: (key: string) => { data.delete(key); },
  };
  assert.deepEqual(readMySongs(store), []);
  const score = { ...createBlankScore(), title: "我的旋律" };
  appendDraft(store, isScore, score, 100);
  appendDraft(store, isScore, { ...score, title: " " }, 200);
  const songs = readMySongs({ ...store });
  assert.deepEqual(songs.map((song) => song.title), ["未命名乐谱", "我的旋律"]);
  assert.deepEqual(songs[1].value, score);
  assert.deepEqual([...data.keys()], [DRAFT_KEY]);
  // Same delete operation as the editor's local draft list.
  writeDrafts(store, readDrafts(store, isScore).filter((draft) => draft.id !== songs[1].id));
  assert.deepEqual(readMySongs(store).map((song) => song.title), ["未命名乐谱"]);
  store.removeItem(DRAFT_KEY);
  assert.deepEqual(readMySongs(store), []);
});

test("song rows show the opening notes; rename and duplicate stay one entry per song", async () => {
  const { upsertDraft } = await import("./draft-history.ts");
  const { songIncipit, copyTitle, renameSong, duplicateSong } = await import("./my-songs.ts");
  const data = new Map<string, string>();
  const store = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
    removeItem: (key: string) => { data.delete(key); },
  };
  const notes = [60, 60, 67, 67, 69, 69, 67].map((midi) => ({ pitches: [midi], dur: 1 }));
  const score = { ...createBlankScore(), title: "小星星", notes };
  assert.equal(songIncipit({ ...createBlankScore() }), "");
  assert.match(songIncipit(score, 4), /^1 1 5 5 …$/);
  assert.equal(copyTitle("小星星", ["小星星"]), "小星星 副本");
  assert.equal(copyTitle("小星星", ["小星星 副本", "小星星 副本 2"]), "小星星 副本 3");
  upsertDraft(store, isScore, { id: "a", value: score }, 1);
  assert.equal(renameSong(store, "a", "  "), false);
  assert.equal(renameSong(store, "a", "一闪一闪"), true);
  const copy = duplicateSong(store, "a", 2);
  const songs = readMySongs(store);
  assert.deepEqual(songs.map((song) => song.title), ["一闪一闪 副本", "一闪一闪"]);
  assert.equal(songs[0].id, copy);
  assert.equal(songs[0].pinned, true);
  assert.match(songs[1].incipit, /^1 1 5 5/);
});

test("same-title automatic archives collapse to the newest and leave hand-saves alone", async () => {
  const { upsertScore, compactSameTitleAutos, clearAutoSongs, restoreSongs, readMySongs } = await import("./my-songs.ts");
  const { upsertDraft } = await import("./draft-history.ts");
  const data = new Map<string, string>();
  const store = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
    removeItem: (key: string) => { data.delete(key); },
  };
  const named = (title: string) => ({ ...createBlankScore(), title });
  upsertDraft(store, isScore, { id: "old", value: named("小星星") }, 1);
  upsertDraft(store, isScore, { id: "older-blank", value: named(" ") }, 2);
  upsertDraft(store, isScore, { id: "pinned", value: named("小星星"), pinned: true }, 3);
  upsertScore(store, { id: "new", value: named("小星星") }, 4);
  upsertScore(store, { id: "blank", value: named("") }, 5);
  let songs = readMySongs(store);
  assert.deepEqual(
    songs.map((song) => [song.id, song.title, Boolean(song.pinned)]),
    [
      ["blank", "未命名乐谱", false],
      ["new", "小星星", false],
      ["pinned", "小星星", true],
    ],
  );

  // Existing duplicates left by older clients are folded on compact.
  const stale = new Map<string, string>();
  const staleStore = {
    getItem: (key: string) => stale.get(key) ?? null,
    setItem: (key: string, value: string) => { stale.set(key, value); },
    removeItem: (key: string) => { stale.delete(key); },
  };
  upsertDraft(staleStore, isScore, { id: "a", value: named("同一首") }, 10);
  upsertDraft(staleStore, isScore, { id: "b", value: named("同一首") }, 20);
  upsertDraft(staleStore, isScore, { id: "c", value: named("另一首") }, 30);
  compactSameTitleAutos(staleStore);
  assert.deepEqual(readMySongs(staleStore).map((song) => song.id), ["c", "b"]);

  const removed = clearAutoSongs(store);
  assert.deepEqual(removed.map((draft) => draft.id).sort(), ["blank", "new"]);
  assert.deepEqual(readMySongs(store).map((song) => song.id), ["pinned"]);
  restoreSongs(store, removed);
  songs = readMySongs(store);
  assert.deepEqual(songs.map((song) => song.id).sort(), ["blank", "new", "pinned"]);
});

test("the threeFourStudy example carries chord marks and parses in C major", async () => {
  const { EXAMPLES, scoreFromExample } = await import("./examples.ts");
  const threeFourStudy = EXAMPLES.find((item) => item.id === "three-four-study");
  assert.ok(threeFourStudy);
  const score = scoreFromExample(threeFourStudy!);
  assert.equal(score.title, "三拍练习");
  assert.equal(score.key, "C");
  assert.deepEqual(score.notes.filter((note) => note.pitches.length).slice(0, 3).map((note) => note.pitches[0]), [62, 65, 69]);
  assert.equal(score.beats, 3, "三拍练习 is in 3/4");
  // Two-eighth pickup padded by two beats of rest, so the first full phrase starts on a downbeat.
  assert.deepEqual(score.notes.slice(0, 4).map((note) => note.dur), [1, 1, 0.5, 0.5]);
  assert.equal(score.notes[4]?.pitches[0], 69);
  assert.ok((score.chordSymbols?.length ?? 0) >= 4);
  // Every chord sits on a beat of a 3/4 bar and on a note onset.
  const onsets = new Set<number>();
  let at = 0;
  for (const note of score.notes) {
    onsets.add(at);
    at += note.dur;
  }
  assert.ok(score.chordSymbols!.every((mark) => onsets.has(mark.at) && Number.isInteger(mark.at)));
  assert.equal(score.chordSymbols?.[0]?.at, 3, "first chord on the first full bar");
  assert.equal(score.chordSymbols?.[0]?.symbol, "C");
  const last = score.notes.reduce((sum, note) => sum + note.dur, 0);
  assert.ok(score.chordSymbols!.every((mark) => mark.at >= 0 && mark.at < last));
});
