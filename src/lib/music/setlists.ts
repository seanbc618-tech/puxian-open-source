import type { DraftStore } from "./draft-history.ts";

export const SETLIST_KEY = "puxian-setlists-v1";
export type Setlist = { id: string; name: string; songs: string[] };

/** Drop corrupt entries, duplicate IDs and references to removed songs; never mutate inputs. */
export function cleanSetlists(value: unknown, songIds: readonly string[]): Setlist[] {
  if (!Array.isArray(value)) return [];
  const songs = new Set(songIds),
    seen = new Set<string>();
  return value.slice(0, 100).flatMap((item) => {
    if (
      !item ||
      typeof item.id !== "string" ||
      !item.id.trim() ||
      item.id.length > 120 ||
      seen.has(item.id) ||
      typeof item.name !== "string" ||
      !item.name.trim() ||
      !Array.isArray(item.songs)
    )
      return [];
    seen.add(item.id);
    return [
      {
        id: item.id,
        name: item.name.trim().slice(0, 80),
        songs: [
          ...new Set<string>(
            item.songs.filter(
              (id: unknown): id is string => typeof id === "string" && songs.has(id),
            ),
          ),
        ],
      },
    ];
  });
}
export function readSetlists(store: DraftStore, songIds: readonly string[]): Setlist[] {
  try {
    const raw = store.getItem(SETLIST_KEY);
    if (!raw || raw.length > 100_000) return [];
    const lists = cleanSetlists(JSON.parse(raw), songIds);
    // Remove dangling IDs persistently, so restoring an old draft cannot resurrect membership.
    const next = JSON.stringify(lists);
    if (next !== raw) {
      try {
        store.setItem(SETLIST_KEY, next);
      } catch {
        /* read-only storage */
      }
    }
    return lists;
  } catch {
    return [];
  }
}
export function addSetlist(lists: readonly Setlist[], id: string, name: string): Setlist[] {
  if (!id.trim() || !name.trim() || lists.some((list) => list.id === id) || lists.length >= 100)
    return [...lists];
  return [...lists, { id, name: name.trim().slice(0, 80), songs: [] }];
}
export function addToSetlist(list: Setlist, song: string): Setlist {
  return !song || list.songs.includes(song) ? list : { ...list, songs: [...list.songs, song] };
}
export function moveSetlistSong(list: Setlist, index: number, direction: -1 | 1): Setlist {
  const target = index + direction;
  if (
    !Number.isInteger(index) ||
    index < 0 ||
    index >= list.songs.length ||
    target < 0 ||
    target >= list.songs.length
  )
    return list;
  const songs = [...list.songs];
  [songs[index], songs[target]] = [songs[target], songs[index]];
  return { ...list, songs };
}
export function removeSetlistSong(list: Setlist, song: string): Setlist {
  return { ...list, songs: list.songs.filter((id) => id !== song) };
}
export function nextSetlistSong(list: Setlist, current: string): string | undefined {
  const index = list.songs.indexOf(current);
  return index < 0 ? undefined : list.songs[index + 1];
}

export function removeSetlist(lists: readonly Setlist[], id: string): Setlist[] {
  return lists.filter((list) => list.id !== id);
}
