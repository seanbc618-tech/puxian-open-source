import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_PRACTICE,
  PRACTICE_STORE_KEY,
  PRACTICE_STORE_LIMIT,
  cleanPractice,
  loadPractice,
  savePractice,
} from "./practice-store.ts";

function memory() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

test("练习设置按曲保存、读取，互不串曲", () => {
  const store = memory();
  savePractice(store, "song-a", { speed: 0.7, countInBars: 2, loopOn: true, loopRange: { from: 4, to: 12 } }, 1);
  savePractice(store, "song-b", { speed: 0.9, countInBars: 0, loopOn: false, loopRange: null }, 2);
  assert.deepEqual(loadPractice(store, "song-a"), { speed: 0.7, countInBars: 2, loopOn: true, loopRange: { from: 4, to: 12 } });
  assert.deepEqual(loadPractice(store, "song-b"), { speed: 0.9, countInBars: 0, loopOn: false, loopRange: null });
  assert.deepEqual(loadPractice(store, "song-c"), DEFAULT_PRACTICE);
  // Back to defaults forgets the song; the last one removes the key entirely.
  savePractice(store, "song-a", DEFAULT_PRACTICE, 3);
  assert.deepEqual(loadPractice(store, "song-a"), DEFAULT_PRACTICE);
  savePractice(store, "song-b", DEFAULT_PRACTICE, 4);
  assert.equal(store.data.has(PRACTICE_STORE_KEY), false);
});

test("坏数据、越界值都被清洗；只留最近 50 首", () => {
  const store = memory();
  store.setItem(PRACTICE_STORE_KEY, "{not json");
  assert.deepEqual(loadPractice(store, "x"), DEFAULT_PRACTICE);
  assert.deepEqual(cleanPractice({ speed: 9, countInBars: 5, loopOn: true, loopRange: { from: 3, to: 1 } }), {
    speed: 1.2, countInBars: 0, loopOn: false, loopRange: null,
  });
  assert.deepEqual(loadPractice(undefined, "x"), DEFAULT_PRACTICE);
  for (let i = 0; i < PRACTICE_STORE_LIMIT + 5; i += 1)
    savePractice(store, `s${i}`, { ...DEFAULT_PRACTICE, speed: 0.8 }, i);
  const kept = Object.keys(JSON.parse(store.getItem(PRACTICE_STORE_KEY)!));
  assert.equal(kept.length, PRACTICE_STORE_LIMIT);
  assert.ok(!kept.includes("s0") && kept.includes(`s${PRACTICE_STORE_LIMIT + 4}`));
  const throwing = { ...memory(), setItem: () => { throw new Error("quota"); } };
  assert.doesNotThrow(() => savePractice(throwing, "q", { ...DEFAULT_PRACTICE, speed: 0.5 }));
});

test('渐进加速与收藏片段按曲保存，兼容旧数据，丢弃坏片段并限制数量', async () => {
  const { cleanClips, PRACTICE_CLIP_LIMIT } = await import('./practice-store.ts');
  const store = memory();
  const clips = Array.from({ length: 20 }, (_, i) => ({ id: String(i), name: ` 第 ${i + 1} 小节 `, range: { from: i, to: i + 1 }, speed: .8 }));
  const training = { start: 50, target: 100, step: 7, repeats: 4, countEach: true };
  savePractice(store, 'new', { ...DEFAULT_PRACTICE, training, clips });
  assert.deepEqual(loadPractice(store, 'new').training, training);
  assert.equal(loadPractice(store, 'new').clips?.length, PRACTICE_CLIP_LIMIT);
  assert.equal(loadPractice(store, 'new').clips?.[0].name, '第 1 小节');
  assert.deepEqual(cleanClips([null, {}, { ...clips[0], range: { from: 3, to: 2 } }, { ...clips[0], speed: NaN }]), []);
  assert.equal(cleanClips([clips[0], clips[0]]).length, 1);
  savePractice(store, 'new', { ...DEFAULT_PRACTICE, training, clips: [] });
  assert.equal(loadPractice(store, 'new').clips, undefined);
  assert.deepEqual(loadPractice(store, 'old'), DEFAULT_PRACTICE);
  store.setItem(PRACTICE_STORE_KEY, JSON.stringify({ bad: null, new: { ...DEFAULT_PRACTICE, training, clips: [null, clips[1]] } }));
  assert.doesNotThrow(() => savePractice(store, 'x', { ...DEFAULT_PRACTICE, speed: .8 }));
  assert.equal(loadPractice(store, 'new').clips?.length, 1);
});
