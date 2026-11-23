import test from "node:test";
import assert from "node:assert/strict";
import {
  PRACTICE_LOG_DAYS,
  PRACTICE_LOG_KEY,
  PRACTICE_NOTE_MAX,
  PRACTICE_SONG_LIMIT,
  EAR_PRACTICE,
  addPractice,
  clearLog,
  cleanLog,
  setSongNote,
  practiceTimer,
  songSummary,
  topSongs,
  dayKey,
  emptyLog,
  formatPractice,
  lastWeek,
  practiceSummary,
  readLog,
  setGoal,
  streakDays,
  writeLog,
} from "./practice-log.ts";

const at = (y: number, m: number, d: number, h = 12, min = 0) => new Date(y, m - 1, d, h, min).getTime();

function memory() {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), data };
}

test("addPractice：按本地日期累计秒数", () => {
  let log = addPractice(emptyLog(), at(2026, 11, 11, 9), at(2026, 11, 11, 9, 5));
  log = addPractice(log, at(2026, 11, 11, 20), at(2026, 11, 11, 20, 3));
  assert.deepEqual(log.days, { "2026-11-11": 480 });
});

test("addPractice：跨午夜拆到两天", () => {
  const log = addPractice(emptyLog(), at(2026, 11, 10, 23, 50), at(2026, 11, 11, 0, 10));
  assert.deepEqual(log.days, { "2026-11-10": 600, "2026-11-11": 600 });
});

test("addPractice：不到 1 秒、倒序、非数不记；一段最多记 3 小时", () => {
  const empty = emptyLog();
  assert.equal(addPractice(empty, 1000, 1500), empty);
  assert.equal(addPractice(empty, 5000, 1000), empty);
  assert.equal(addPractice(empty, Number.NaN, 1000), empty);
  const long = addPractice(empty, at(2026, 11, 11, 6), at(2026, 11, 11, 18));
  assert.deepEqual(long.days, { "2026-11-11": 3 * 3600 });
});

test("streakDays：今天没练时从昨天往回数，断一天就重来", () => {
  const log = cleanLog({ goal: 10, days: { "2026-11-08": 300, "2026-11-09": 120, "2026-11-10": 61, "2026-11-06": 900 } });
  assert.equal(streakDays(log, new Date(2026, 10, 11)), 3, "today empty: streak still alive");
  assert.equal(streakDays({ ...log, days: { ...log.days, "2026-11-11": 60 } }, new Date(2026, 10, 11)), 4);
  assert.equal(streakDays({ ...log, days: { ...log.days, "2026-11-10": 30 } }, new Date(2026, 10, 11)), 0, "under a minute does not count");
  assert.equal(streakDays(log, new Date(2026, 10, 13)), 0);
});

test("lastWeek：最近 7 天，最后一格是今天", () => {
  const week = lastWeek(cleanLog({ days: { "2026-11-11": 600, "2026-11-05": 60 } }), new Date(2026, 10, 11));
  assert.equal(week.length, 7);
  assert.deepEqual(week.map((d) => d.label), ["周四", "周五", "周六", "周日", "周一", "周二", "今天"]);
  assert.deepEqual(week.map((d) => d.seconds), [60, 0, 0, 0, 0, 0, 600]);
  assert.equal(week[0].key, "2026-11-05");
});

test("practiceSummary：目标进度与连续天数的中文", () => {
  const today = new Date(2026, 10, 11);
  assert.equal(practiceSummary(emptyLog(), today), "今天已练 0 分钟，离每日目标 10 分钟还差 10 分钟；今天练满 1 分钟就开始连续打卡。");
  const log = cleanLog({ goal: 10, days: { "2026-11-10": 600, "2026-11-11": 250 } });
  assert.equal(practiceSummary(log, today), "今天已练 4 分钟，离每日目标 10 分钟还差 6 分钟；已连续练习 2 天。");
  assert.equal(practiceSummary({ ...log, goal: 0 }, today), "今天已练 4 分钟；已连续练习 2 天。");
  assert.equal(practiceSummary({ ...log, goal: 5, days: { "2026-11-11": 300 } }, today), "今天已练 5 分钟，达成每日目标 5 分钟；已连续练习 1 天。");
});

test("formatPractice", () => {
  assert.equal(formatPractice(0), "0 分钟");
  assert.equal(formatPractice(30), "不到 1 分钟");
  assert.equal(formatPractice(59 * 60), "59 分钟");
  assert.equal(formatPractice(3600), "1 小时");
  assert.equal(formatPractice(3900), "1 小时 5 分");
});

test("cleanLog / setGoal：坏数据与不在选项里的目标被丢掉", () => {
  assert.deepEqual(cleanLog({ goal: 7, days: { bad: 5, "2026-11-11": -1, "2026-11-10": "9", "2026-11-09": 12.6 } }), { goal: 10, days: { "2026-11-09": 13 } });
  assert.deepEqual(cleanLog(null), emptyLog());
  assert.equal(setGoal(emptyLog(), 30).goal, 30);
  assert.equal(setGoal(emptyLog(), 0).goal, 0);
  assert.equal(setGoal(emptyLog(), 7).goal, 10);
});

test("readLog / writeLog：本机存取，只留最近的天数，坏 JSON 当空", () => {
  const store = memory();
  const days: Record<string, number> = {};
  for (let i = 0; i < PRACTICE_LOG_DAYS + 5; i += 1) days[dayKey(new Date(2025, 0, 1 + i))] = 60;
  assert.equal(writeLog(store, { goal: 15, days }), true);
  const back = readLog(store);
  assert.equal(back.goal, 15);
  assert.equal(Object.keys(back.days).length, PRACTICE_LOG_DAYS);
  assert.equal(back.days["2025-01-01"], undefined, "oldest days dropped");
  store.setItem(PRACTICE_LOG_KEY, "{not json");
  assert.deepEqual(readLog(store), emptyLog());
  assert.equal(writeLog({ getItem: () => null, setItem: () => { throw new Error("full"); } }, emptyLog()), false);
});

test("addPractice：带曲子时累计到这首，记下最后练习时间", () => {
  const song = { key: "d1", title: "四拍练习" };
  let log = addPractice(emptyLog(), at(2026, 11, 10, 9), at(2026, 11, 10, 9, 4), song);
  log = addPractice(log, at(2026, 11, 11, 9), at(2026, 11, 11, 9, 2), song);
  assert.deepEqual(log.songs, { d1: { title: "四拍练习", seconds: 360, last: at(2026, 11, 11, 9, 2) } });
  assert.equal(songSummary(log, "d1"), "这首曲子：累计 6 分钟 · 上次 11月11日");
  assert.equal(songSummary(log, "other"), "这首曲子还没有练琴记录。");
});

test("setSongNote：写笔记、清空笔记、限长，时间不变", () => {
  const song = { key: "d1", title: "四拍练习" };
  let log = addPractice(emptyLog(), at(2026, 11, 11, 9), at(2026, 11, 11, 9, 1), song);
  log = setSongNote(log, song, "第 12 小节换指不稳", 0);
  assert.equal(log.songs?.d1.note, "第 12 小节换指不稳");
  assert.equal(log.songs?.d1.seconds, 60);
  log = setSongNote(log, song, "   ", 0);
  assert.equal("note" in (log.songs?.d1 ?? {}), false);
  const fresh = setSongNote(emptyLog(), { key: "d2", title: "新歌" }, "x".repeat(300), 5);
  assert.deepEqual(fresh.songs?.d2, { title: "新歌", seconds: 0, last: 5, note: "x".repeat(PRACTICE_NOTE_MAX) });
  assert.equal(setSongNote(emptyLog(), song, "", 0).songs, undefined, "blank note on an unknown song adds nothing");
});

test("topSongs：按累计时长排，不到 1 分钟不列", () => {
  const log = cleanLog({ days: {}, songs: {
    a: { title: "A", seconds: 600, last: 1 }, b: { title: "B", seconds: 1200, last: 2 },
    c: { title: "C", seconds: 30, last: 3 }, d: { title: "D", seconds: 600, last: 9 }, e: { title: "E", seconds: 90, last: 4 } } });
  assert.deepEqual(topSongs(log).map((s) => s.key), ["b", "d", "a"]);
});

test("clearLog：清空天数、曲子与笔记，保留每日目标", () => {
  const log = cleanLog({ goal: 30, days: { "2026-11-11": 600 }, songs: { a: { title: "A", seconds: 600, last: 1, note: "n" } } });
  assert.deepEqual(clearLog(log), { goal: 30, days: {} });
});

test("cleanLog / writeLog：坏曲子条目丢掉，最多留最近 50 首", () => {
  const cleaned = cleanLog({ days: {}, songs: { ok: { title: "T", seconds: 61.4, last: 7, note: "" }, bad: { title: 3 }, worse: null } });
  assert.deepEqual(cleaned.songs, { ok: { title: "T", seconds: 61, last: 7 } });
  const store = memory();
  const songs: Record<string, unknown> = {};
  for (let i = 0; i < PRACTICE_SONG_LIMIT + 3; i += 1) songs[`s${i}`] = { title: `S${i}`, seconds: 60, last: i };
  writeLog(store, cleanLog({ days: {}, songs }));
  const back = readLog(store);
  assert.equal(Object.keys(back.songs ?? {}).length, PRACTICE_SONG_LIMIT);
  assert.equal(back.songs?.s0, undefined, "least recent song dropped");
});

test("practiceTimer：每段记给开始时打开的曲子，换曲后下一段记给新曲", () => {
  let clock = 0;
  let open = { key: "a", title: "A" };
  const writes: [number, number, string][] = [];
  const timer = practiceTimer(() => open, (start, end, song) => { writes.push([start, end, song.key]); return true; }, () => clock);
  clock = 5000;
  open = { key: "b", title: "B" }; // the editor adopts another song before the timer stops
  timer.flush();
  clock = 9000;
  timer.flush();
  assert.deepEqual(writes, [[0, 5000, "a"], [5000, 9000, "b"]]);
});

test("practiceTimer：写入失败时下一次从原起点补记", () => {
  let clock = 0;
  let ok = false;
  const writes: [number, number][] = [];
  const timer = practiceTimer(() => ({ key: "a", title: "A" }), (start, end) => { writes.push([start, end]); return ok; }, () => clock);
  clock = 3000; timer.flush();
  ok = true; clock = 4000; timer.flush();
  assert.deepEqual(writes, [[0, 3000], [0, 4000]]);
});

test("听音练耳：计入当天和连续天数，单列不记到曲子；清空时一起清", () => {
  const start = at(2026, 11, 11, 9);
  let log = addPractice(emptyLog(), start, start + 90_000, EAR_PRACTICE);
  log = addPractice(log, start + 90_000, start + 150_000, EAR_PRACTICE);
  assert.equal(log.ear, 150);
  assert.equal(log.days["2026-11-11"], 150);
  assert.equal(log.songs, undefined);
  assert.equal(streakDays(log, new Date(start)), 1);
  assert.equal(cleanLog(JSON.parse(JSON.stringify(log))).ear, 150);
  assert.equal(cleanLog({ days: {}, ear: -3 }).ear, undefined);
  assert.equal(clearLog(log).ear, undefined);
});
