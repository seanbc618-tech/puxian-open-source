export const DRAFT_KEY = "puxian-drafts-v1";
export const DRAFT_LIMIT = 20;
// UTF-16 code units: at most ~2 MiB for the serialized archive.
export const DRAFT_SIZE_LIMIT = 1_000_000;
/**
 * One entry per song. `id` doubles as the song id, so autosave rolls the same
 * entry forward instead of appending a new version for every edit.
 * `pinned` marks songs the user saved by hand: automatic entries are evicted
 * first and never push a pinned song out of the archive.
 * Entries written before this field existed read as automatic.
 */
export type Draft<T> = { id: string; at: number; value: T; pinned?: boolean };
export type DraftStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export function readDrafts<T>(
  store: DraftStore,
  valid: (value: unknown) => value is T,
): Draft<T>[] {
  try {
    const raw = store.getItem(DRAFT_KEY);
    if (!raw || raw.length > DRAFT_SIZE_LIMIT) return [];
    const data: unknown = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return data
      .filter(
        (d): d is Draft<T> =>
          !!d && typeof d.id === "string" && Number.isFinite(d.at) && valid(d.value),
      )
      .slice(-DRAFT_LIMIT);
  } catch {
    return [];
  }
}
/** Index of the next entry to evict: oldest automatic first, never `keep`. */
function evictable<T>(drafts: Draft<T>[], keep: string | undefined, allowPinned: boolean): number {
  const auto = drafts.findIndex((draft) => !draft.pinned && draft.id !== keep);
  if (auto >= 0) return auto;
  if (!allowPinned) return -1;
  return drafts.findIndex((draft) => draft.id !== keep);
}

/**
 * Persist within the count and size limits. Automatic entries go first; a
 * pinned (hand-saved) entry is only dropped to make room for another pinned
 * one. When nothing else can go, an automatic `keep` entry is dropped itself
 * rather than evicting a pinned song.
 */
export function writeDrafts<T>(store: DraftStore, drafts: Draft<T>[], keep?: string): Draft<T>[] {
  const next = [...drafts];
  const keeper = keep ? next.find((draft) => draft.id === keep) : undefined;
  const allowPinned = keeper ? keeper.pinned === true : true;
  const over = () => next.length > DRAFT_LIMIT || JSON.stringify(next).length > DRAFT_SIZE_LIMIT;
  while (next.length && over()) {
    let index = evictable(next, keep, allowPinned);
    if (index < 0) index = next.findIndex((draft) => draft.id === keep);
    if (index < 0) index = 0;
    next.splice(index, 1);
  }
  if (drafts.length && !next.length) throw new Error("草稿过大，无法保存到本机。");
  store.setItem(DRAFT_KEY, JSON.stringify(next));
  return next;
}

/**
 * Roll one song's entry forward (moved to newest). Pinning is sticky: an
 * autosave never unpins a song the user saved by hand.
 */
export function upsertDraft<T>(
  store: DraftStore,
  valid: (value: unknown) => value is T,
  entry: { id: string; value: T; pinned?: boolean },
  at = Date.now(),
): Draft<T>[] {
  const drafts = readDrafts(store, valid);
  const old = drafts.find((draft) => draft.id === entry.id);
  const pinned = Boolean(old?.pinned || entry.pinned);
  if (old && JSON.stringify(old.value) === JSON.stringify(entry.value) && Boolean(old.pinned) === pinned) {
    return drafts;
  }
  const next: Draft<T> = { id: entry.id, at, value: entry.value };
  if (pinned) next.pinned = true;
  return writeDrafts(store, [...drafts.filter((draft) => draft.id !== entry.id), next], entry.id);
}

export function newDraftId(at = Date.now()): string {
  return `${at}-${Math.random().toString(36).slice(2)}`;
}
export function appendDraft<T>(
  store: DraftStore,
  valid: (value: unknown) => value is T,
  value: T,
  at = Date.now(),
): Draft<T>[] {
  const drafts = readDrafts(store, valid);
  if (JSON.stringify(drafts.at(-1)?.value) === JSON.stringify(value)) return drafts;
  return writeDrafts(store, [
    ...drafts,
    { id: newDraftId(at), at, value },
  ]);
}
