import test from "node:test";
import assert from "node:assert/strict";
import {
  SETLIST_KEY,
  cleanSetlists,
  readSetlists,
  addSetlist,
  addToSetlist,
  moveSetlistSong,
  removeSetlistSong,
  removeSetlist,
  nextSetlistSong,
} from "./setlists.ts";

test("坏数据丢弃，去重并自动移除已删除曲子", () => {
  const raw = [
    null,
    {},
    { id: "a", name: " 演出 ", songs: ["one", "one", "deleted", 3] },
    { id: "a", name: "重复", songs: [] },
    { id: "b", name: " ", songs: [] },
  ];
  const before = JSON.stringify(raw);
  assert.deepEqual(cleanSetlists(raw, ["one"]), [{ id: "a", name: "演出", songs: ["one"] }]);
  assert.equal(JSON.stringify(raw), before);
  assert.deepEqual(cleanSetlists({}, []), []);
  let data = JSON.stringify(raw);
  const store = {
    getItem: () => data,
    setItem: (key: string, value: string) => {
      assert.equal(key, SETLIST_KEY);
      data = value;
    },
    removeItem() {},
  };
  assert.equal(readSetlists(store, ["one"])[0].songs.length, 1);
  assert.deepEqual(readSetlists(store, [])[0].songs, []);
  assert.deepEqual(readSetlists(store, ["one"])[0].songs, [], "恢复曲子不应复活歌单成员");
  data = "broken";
  assert.deepEqual(readSetlists(store, []), []);
  data = "x".repeat(100_001);
  assert.deepEqual(readSetlists(store, []), []);
  assert.deepEqual(
    readSetlists(
      {
        ...store,
        getItem() {
          throw Error();
        },
      },
      [],
    ),
    [],
  );
});
test("新建、添加、上下排序、移出、顺序切歌不修改原数据", () => {
  const lists = addSetlist([], "a", "演出");
  assert.deepEqual(addSetlist(lists, "a", "重复"), lists);
  assert.deepEqual(addSetlist(lists, "b", " "), lists);
  let list = addToSetlist(addToSetlist(lists[0], "one"), "two");
  assert.deepEqual(lists[0].songs, []);
  assert.deepEqual(removeSetlist(lists, "a"), []);
  assert.equal(lists.length, 1);
  assert.equal(addToSetlist(list, "one"), list);
  assert.equal(nextSetlistSong(list, "one"), "two");
  assert.equal(nextSetlistSong(list, "two"), undefined);
  assert.equal(nextSetlistSong(list, "missing"), undefined);
  assert.equal(moveSetlistSong(list, 0, -1), list);
  assert.equal(moveSetlistSong(list, 1, 1), list);
  assert.equal(moveSetlistSong(list, -1, 1), list);
  list = moveSetlistSong(list, 0, 1);
  assert.deepEqual(list.songs, ["two", "one"]);
  assert.deepEqual(moveSetlistSong(list, 1, -1).songs, ["one", "two"]);
  assert.deepEqual(removeSetlistSong(list, "two").songs, ["one"]);
});
