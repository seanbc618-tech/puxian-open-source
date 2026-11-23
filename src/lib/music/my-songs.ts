import { newDraftId, readDrafts, upsertDraft, writeDrafts, type Draft, type DraftStore } from "./draft-history.ts";
import { formatJianpu } from "./notation.ts";
import { isScore } from "./score-storage.ts";
import type { Score } from "./theory.ts";

/** Homepage projection of the shared archive; never persists a second copy. */
export function readMySongs(store: DraftStore) {
  return readDrafts(store, isScore).reverse().map((draft) => ({
    ...draft,
    title: draft.value.title.trim() || "未命名乐谱",
    incipit: songIncipit(draft.value),
  }));
}

/** First few notes of voice one in numbered notation, for recognising a song at a glance. */
export function songIncipit(score: Score, count = 8): string {
  const notes = score.notes.slice(0, count);
  if (!notes.some((note) => note.pitches.length)) return "";
  try {
    const text = formatJianpu({ ...score, notes }).replace(/\s+\|\s*$/u, "").trim();
    return score.notes.length > count ? `${text} …` : text;
  } catch {
    return "";
  }
}


/** Title shown in「我的曲子」; blank names share this label and can merge. */
export function displaySongTitle(title: string): string {
  return title.trim() || "未命名乐谱";
}

/**
 * Among automatic entries that share a title, keep one: the `keep` id if present,
 * otherwise the newest. Hand-saved (pinned) songs are never merged or dropped here.
 */
export function mergeSameTitleAutos<T extends { title: string }>(
  drafts: Draft<T>[],
  keep?: string,
): Draft<T>[] {
  const groups = new Map<string, Draft<T>[]>();
  for (const draft of drafts) {
    if (draft.pinned) continue;
    const title = displaySongTitle(draft.value.title);
    const list = groups.get(title) ?? [];
    list.push(draft);
    groups.set(title, list);
  }
  const drop = new Set<string>();
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const preferred =
      keep && list.some((draft) => draft.id === keep)
        ? keep
        : list.reduce((best, draft) => (draft.at >= best.at ? draft : best)).id;
    for (const draft of list) if (draft.id !== preferred) drop.add(draft.id);
  }
  return drop.size ? drafts.filter((draft) => !drop.has(draft.id)) : drafts;
}

/** Roll a score into the archive, then fold older automatic copies of the same title. */
export function upsertScore(
  store: DraftStore,
  entry: { id: string; value: Score; pinned?: boolean },
  at = Date.now(),
): Draft<Score>[] {
  upsertDraft(store, isScore, entry, at);
  const drafts = readDrafts(store, isScore);
  const next = mergeSameTitleAutos(drafts, entry.id);
  if (next.length !== drafts.length) writeDrafts(store, next, entry.id);
  return readDrafts(store, isScore);
}

/** Fold same-title automatic copies already in storage (home load / repair). */
export function compactSameTitleAutos(store: DraftStore): Draft<Score>[] {
  const drafts = readDrafts(store, isScore);
  const next = mergeSameTitleAutos(drafts);
  if (next.length !== drafts.length) writeDrafts(store, next);
  return readDrafts(store, isScore);
}

/** Remove every automatic entry. Returns the removed rows so the homepage can undo. */
export function clearAutoSongs(store: DraftStore): Draft<Score>[] {
  const drafts = readDrafts(store, isScore);
  const removed = drafts.filter((draft) => !draft.pinned);
  if (removed.length) writeDrafts(store, drafts.filter((draft) => draft.pinned));
  return removed;
}

/** Put previously cleared automatic entries back (undo). Does not re-fold them. */
export function restoreSongs(store: DraftStore, removed: readonly Draft<Score>[]): Draft<Score>[] {
  if (!removed.length) return readDrafts(store, isScore);
  const drafts = readDrafts(store, isScore);
  const have = new Set(drafts.map((draft) => draft.id));
  const pending = removed.filter((draft) => !have.has(draft.id) && isScore(draft.value));
  if (!pending.length) return drafts;
  return writeDrafts(store, [...drafts, ...pending]);
}

/** "小星星 副本", then "小星星 副本 2", … — never collides with an existing title. */
export function copyTitle(title: string, taken: Iterable<string>): string {
  const used = new Set([...taken].map((name) => name.trim()));
  const base = `${title.trim() || "未命名乐谱"} 副本`;
  if (!used.has(base)) return base;
  for (let n = 2; ; n += 1) if (!used.has(`${base} ${n}`)) return `${base} ${n}`;
}

/** Rename one archived song in place (keeps its position and pinned state). */
export function renameSong(store: DraftStore, id: string, title: string): boolean {
  const name = title.trim();
  if (!name) return false;
  const drafts = readDrafts(store, isScore);
  const index = drafts.findIndex((draft) => draft.id === id);
  if (index < 0) return false;
  drafts[index] = { ...drafts[index], value: { ...drafts[index].value, title: name } };
  writeDrafts(store, drafts, id);
  return true;
}

/** Duplicate an archived song as a new hand-saved song. Returns the new id. */
export function duplicateSong(store: DraftStore, id: string, at = Date.now()): string | null {
  const drafts = readDrafts(store, isScore);
  const source = drafts.find((draft) => draft.id === id);
  if (!source) return null;
  const title = copyTitle(source.value.title, drafts.map((draft) => draft.value.title));
  const next = newDraftId(at);
  upsertDraft(store, isScore, { id: next, value: { ...source.value, title }, pinned: true }, at);
  return next;
}
