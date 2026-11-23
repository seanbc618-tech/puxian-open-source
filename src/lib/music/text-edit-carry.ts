import type { NoteLyric, ScoreNote } from "./theory.ts";

/**
 * Pair old notes with new notes after a text rewrite of a whole voice.
 *
 * Notes whose pitches survive (longest common subsequence) stay paired. The
 * stretches between those anchors are paired in order, so a fresh melody with
 * the same number of notes keeps every slot, and an inserted or deleted note
 * only shifts its own stretch. Returns, for each old index, the new index or -1.
 */
export function alignNoteSlots(prev: readonly ScoreNote[], next: readonly ScoreNote[]): number[] {
  const key = (note: ScoreNote) => (note.pitches.length ? note.pitches.join(",") : "r");
  const a = prev.map(key);
  const b = next.map(key);
  const n = a.length;
  const m = b.length;
  const map = new Array<number>(n).fill(-1);
  if (!n || !m) return map;
  // A melody this long is never typed by hand; fall back to order-only pairing.
  if (n * m > 4_000_000) {
    for (let i = 0; i < Math.min(n, m); i += 1) map[i] = i;
    return map;
  }
  const width = m + 1;
  const table = new Uint16Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      table[i * width + j] =
        a[i] === b[j]
          ? table[(i + 1) * width + j + 1] + 1
          : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
    }
  }
  const anchors: Array<[number, number]> = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      anchors.push([i, j]);
      i += 1;
      j += 1;
    } else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) i += 1;
    else j += 1;
  }
  // Sparse, scattered matches mean the melody was replaced, not edited: pair in order.
  if (anchors.length * 2 < Math.min(n, m)) {
    for (let k = 0; k < Math.min(n, m); k += 1) map[k] = k;
    return map;
  }
  let pi = 0;
  let pj = 0;
  for (const [ai, aj] of [...anchors, [n, m] as [number, number]]) {
    const span = Math.min(ai - pi, aj - pj);
    for (let k = 0; k < span; k += 1) map[pi + k] = pj + k;
    if (ai < n) map[ai] = aj;
    pi = ai + 1;
    pj = aj + 1;
  }
  return map;
}

function sungIndexes(notes: readonly ScoreNote[]): number[] {
  const out: number[] = [];
  notes.forEach((note, index) => {
    if (note.pitches.length) out.push(index);
  });
  return out;
}

export type LyricCarry = {
  notes: ScoreNote[];
  /** Syllables that were on the old melody. */
  before: number;
  /** Syllables written onto the new melody. */
  kept: number;
  /** Text of syllables the new melody has no sung note for, in order. */
  lost: string[];
};

/**
 * Move verse-1 lyrics from the old sung notes onto the new ones.
 * Rests never take a syllable. Syllables with nowhere to go are reported, not hidden.
 */
export function carryLyrics(prev: readonly ScoreNote[], next: readonly ScoreNote[]): LyricCarry {
  const oldSung = sungIndexes(prev);
  const newSung = sungIndexes(next);
  const before = oldSung.filter((index) => prev[index]?.lyric?.text).length;
  const notes = next.map((note) => {
    const copy: ScoreNote = { ...note, pitches: note.pitches.slice() };
    if (note.articulations) copy.articulations = note.articulations.slice();
    return copy;
  });
  if (!before) return { notes, before: 0, kept: 0, lost: [] };
  const oldNotes = oldSung.map((index) => prev[index]!);
  const newNotes = newSung.map((index) => next[index]!);
  // Lyrics are one stream: pair by surviving notes when that keeps as much as plain
  // order does, otherwise in order (a rewritten tune with as many notes keeps every word).
  const aligned = alignNoteSlots(oldNotes, newNotes);
  const ordered = oldSung.map((_, k) => (k < newSung.length ? k : -1));
  const place = (map: number[]) => {
    const out = notes.map((note) => ({ ...note }));
    let kept = 0;
    const lost: string[] = [];
    oldSung.forEach((oldIndex, k) => {
      const lyric = prev[oldIndex]?.lyric;
      if (!lyric?.text) return;
      const target = map[k] ?? -1;
      const newIndex = target >= 0 ? newSung[target] : undefined;
      if (newIndex == null || out[newIndex]!.lyric) {
        lost.push(lyric.text);
        return;
      }
      out[newIndex]!.lyric = copyLyric(lyric);
      kept += 1;
    });
    return { notes: out, kept, lost };
  };
  const byAnchor = place(aligned);
  const byOrder = place(ordered);
  const best = byAnchor.lost.length <= byOrder.lost.length ? byAnchor : byOrder;
  return { notes: best.notes, before, kept: best.kept, lost: best.lost };
}

function copyLyric(lyric: NoteLyric): NoteLyric {
  const next: NoteLyric = { ...lyric };
  if (lyric.fragments) next.fragments = lyric.fragments.map((fragment) => ({ ...fragment }));
  return next;
}

export function lyricCarryNotice(carry: LyricCarry): string | undefined {
  if (!carry.before) return undefined;
  if (!carry.lost.length) return undefined;
  const sample = carry.lost.slice(0, 6).join("");
  const more = carry.lost.length > 6 ? "…" : "";
  return `旋律改了，${carry.kept} 个字已对到新音上；还有 ${carry.lost.length} 个字（${sample}${more}）新旋律放不下，没写上谱。改回旋律、点「撤销」或在「歌词」里重新填入都能找回。`;
}
