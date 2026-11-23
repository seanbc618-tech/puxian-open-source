import assert from "node:assert/strict";
import { test } from "node:test";
import {
  appendDraft,
  readDrafts,
  writeDrafts,
  DRAFT_KEY,
  DRAFT_SIZE_LIMIT,
} from "./draft-history.ts";
function memory() {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      data.set(k, v);
    },
    removeItem: (k: string) => {
      data.delete(k);
    },
  };
}
const valid = (v: unknown): v is string => typeof v === "string";
test("draft reload, deduplication, count limit, delete one and all", () => {
  const store = memory();
  for (let i = 0; i < 25; i++) appendDraft(store, valid, String(i), i);
  assert.equal(appendDraft(store, valid, "24").length, 20);
  assert.equal(readDrafts(store, valid)[0].value, "5");
  writeDrafts(store, readDrafts(store, valid).slice(1));
  assert.equal(readDrafts(store, valid).length, 19);
  store.removeItem(DRAFT_KEY);
  assert.deepEqual(readDrafts(store, valid), []);
});
test("invalid data and unavailable storage are handled; oversized drafts do not erase saved work", () => {
  const store = memory();
  store.setItem(DRAFT_KEY, "{bad");
  assert.deepEqual(readDrafts(store, valid), []);
  store.setItem(DRAFT_KEY, JSON.stringify([{ id: "x", at: 1, value: 123 }]));
  assert.deepEqual(readDrafts(store, valid), []);
  appendDraft(store, valid, "safe");
  assert.throws(() => appendDraft(store, valid, "x".repeat(DRAFT_SIZE_LIMIT)));
  assert.equal(readDrafts(store, valid)[0].value, "safe");
  const blocked = {
    ...store,
    setItem() {
      throw new Error("quota");
    },
  };
  assert.throws(() => appendDraft(blocked, valid, "new"));
  assert.equal(readDrafts(store, valid)[0].value, "safe");
});
test("size limit evicts oldest drafts", () => {
  const store = memory();
  appendDraft(store, valid, "a".repeat(600000));
  appendDraft(store, valid, "b".repeat(600000));
  assert.equal(readDrafts(store, valid).length, 1);
});

test("autosave rolls one entry per song forward instead of appending versions", async () => {
  const { upsertDraft } = await import("./draft-history.ts");
  const store = memory();
  for (let i = 0; i < 30; i++) upsertDraft(store, valid, { id: "song-a", value: `edit ${i}` }, i);
  const drafts = readDrafts(store, valid);
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].value, "edit 29");
  assert.equal(drafts[0].at, 29);
  // Unchanged value is a no-op (no timestamp churn).
  upsertDraft(store, valid, { id: "song-a", value: "edit 29" }, 99);
  assert.equal(readDrafts(store, valid)[0].at, 29);
  // Pinning is sticky across later autosaves.
  upsertDraft(store, valid, { id: "song-a", value: "manual", pinned: true }, 100);
  upsertDraft(store, valid, { id: "song-a", value: "after manual" }, 101);
  assert.equal(readDrafts(store, valid)[0].pinned, true);
});

test("automatic entries never push hand-saved songs out of the archive", async () => {
  const { upsertDraft, DRAFT_LIMIT } = await import("./draft-history.ts");
  const store = memory();
  for (let i = 0; i < 5; i++) upsertDraft(store, valid, { id: `pin-${i}`, value: `p${i}`, pinned: true }, i);
  for (let i = 0; i < 40; i++) upsertDraft(store, valid, { id: `auto-${i}`, value: `a${i}` }, 100 + i);
  const drafts = readDrafts(store, valid);
  assert.equal(drafts.length, DRAFT_LIMIT);
  assert.equal(drafts.filter((draft) => draft.pinned).length, 5, "all pinned survive");
  assert.equal(drafts.at(-1)?.id, "auto-39", "newest autosave kept");
  // With the archive full of pinned songs, a new autosave drops itself, not a pinned one.
  const full = memory();
  for (let i = 0; i < DRAFT_LIMIT; i++) upsertDraft(full, valid, { id: `pin-${i}`, value: `p${i}`, pinned: true }, i);
  upsertDraft(full, valid, { id: "auto", value: "a" }, 999);
  const kept = readDrafts(full, valid);
  assert.equal(kept.length, DRAFT_LIMIT);
  assert.ok(kept.every((draft) => draft.pinned));
  // A new hand save may replace the oldest hand save.
  upsertDraft(full, valid, { id: "pin-new", value: "n", pinned: true }, 1000);
  assert.equal(readDrafts(full, valid)[0].id, "pin-1");
});
