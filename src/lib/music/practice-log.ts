/**
 * 练琴记录：本机按天累计的练习时长、每日目标与连续天数（只存在这台设备的 localStorage，
 * 不写进谱子、草稿、导出或云端）。时间按本地日历日计，跨午夜的一段会拆到两天。
 */
export const PRACTICE_LOG_KEY = "puxian-practice-log-v1";
/** Days kept; older ones are dropped on write. */
export const PRACTICE_LOG_DAYS = 400;
/** One sitting longer than this is cut (a tab left playing all night is not practice). */
export const PRACTICE_SESSION_MAX_S = 3 * 60 * 60;
/** A day counts toward the streak once it has this much practice. */
export const STREAK_MIN_S = 60;
export const GOAL_OPTIONS = [0, 5, 10, 15, 20, 30, 45, 60] as const;
export const DEFAULT_GOAL = 10;

/** Songs kept in the per-song list (most recently practiced first). */
export const PRACTICE_SONG_LIMIT = 50;
export const PRACTICE_NOTE_MAX = 200;

export type PracticeSong = {
  title: string;
  /** Total seconds practiced on this song. */
  seconds: number;
  /** Epoch ms of the last practice. */
  last: number;
  /** Short practice note for this song (e.g. 第 12 小节换指不稳). */
  note?: string;
};

export type PracticeLog = {
  /** Daily goal in minutes; 0 = no goal. */
  goal: number;
  /** "YYYY-MM-DD" (local) → seconds practiced. */
  days: Record<string, number>;
  /** Song key (draft id) → time and note. */
  songs?: Record<string, PracticeSong>;
  /** Seconds of 听音练耳: in the day totals, kept apart from any song. */
  ear?: number;
};

/** Which song a stretch of practice belongs to (key = the editor's draft id, set at mount). */
export type PracticeTarget = { key: string; title: string };
/** 听音练耳 counts toward the day and the streak, under its own line instead of a song. */
export const EAR_PRACTICE = "ear" as const;
export type PracticeCredit = PracticeTarget | typeof EAR_PRACTICE;

type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function dayKey(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

export function emptyLog(): PracticeLog {
  return { goal: DEFAULT_GOAL, days: {} };
}

export function cleanLog(value: unknown): PracticeLog {
  if (!value || typeof value !== "object") return emptyLog();
  const raw = value as Record<string, unknown>;
  const goal = (GOAL_OPTIONS as readonly number[]).includes(raw.goal as number) ? (raw.goal as number) : DEFAULT_GOAL;
  const days: Record<string, number> = {};
  if (raw.days && typeof raw.days === "object") {
    for (const [key, seconds] of Object.entries(raw.days as Record<string, unknown>)) {
      if (!DAY_RE.test(key) || typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) continue;
      days[key] = Math.min(Math.round(seconds), 24 * 60 * 60);
    }
  }
  const songs = cleanSongs(raw.songs);
  const ear = typeof raw.ear === "number" && Number.isFinite(raw.ear) && raw.ear > 0 ? Math.round(raw.ear) : 0;
  return { goal, days, ...(Object.keys(songs).length ? { songs } : {}), ...(ear ? { ear } : {}) };
}

function cleanSongs(value: unknown): Record<string, PracticeSong> {
  const songs: Record<string, PracticeSong> = {};
  if (!value || typeof value !== "object") return songs;
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (!key || !entry || typeof entry !== "object") continue;
    const { title, seconds, last, note } = entry as Record<string, unknown>;
    if (typeof title !== "string" || typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0) continue;
    if (typeof last !== "number" || !Number.isFinite(last)) continue;
    const text = typeof note === "string" ? note.slice(0, PRACTICE_NOTE_MAX) : "";
    songs[key] = { title: title.slice(0, 120), seconds: Math.round(seconds), last, ...(text.trim() ? { note: text } : {}) };
  }
  return songs;
}

export function readLog(storage: Storage): PracticeLog {
  try {
    const raw = storage.getItem(PRACTICE_LOG_KEY);
    return raw ? cleanLog(JSON.parse(raw)) : emptyLog();
  } catch {
    return emptyLog();
  }
}

/** Keeps the newest PRACTICE_LOG_DAYS days and the PRACTICE_SONG_LIMIT most recent songs. */
function trim(log: PracticeLog): PracticeLog {
  const keys = Object.keys(log.days).sort();
  let next = log;
  if (keys.length > PRACTICE_LOG_DAYS) {
    const days: Record<string, number> = {};
    for (const key of keys.slice(-PRACTICE_LOG_DAYS)) days[key] = log.days[key];
    next = { ...next, days };
  }
  const songs = Object.entries(log.songs ?? {});
  if (songs.length > PRACTICE_SONG_LIMIT) {
    next = { ...next, songs: Object.fromEntries(songs.sort((a, b) => b[1].last - a[1].last).slice(0, PRACTICE_SONG_LIMIT)) };
  }
  return next;
}

export function writeLog(storage: Storage, log: PracticeLog): boolean {
  try {
    storage.setItem(PRACTICE_LOG_KEY, JSON.stringify(trim(log)));
    return true;
  } catch {
    return false;
  }
}

/**
 * Adds the practice between `start` and `end` (epoch ms), split at local midnights.
 * Under a second, negative or non-finite spans add nothing; one sitting is capped.
 */
export function addPractice(log: PracticeLog, start: number, end: number, song?: PracticeCredit): PracticeLog {
  if (!Number.isFinite(start) || !Number.isFinite(end) || end - start < 1000) return log;
  const from = Math.max(start, end - PRACTICE_SESSION_MAX_S * 1000);
  const days = { ...log.days };
  let at = from;
  while (at < end) {
    const day = new Date(at);
    const midnight = addDays(day, 1).getTime();
    const stop = Math.min(end, midnight);
    const key = dayKey(day);
    days[key] = Math.min((days[key] ?? 0) + Math.round((stop - at) / 1000), 24 * 60 * 60);
    at = stop;
  }
  if (!song) return { ...log, days };
  const seconds = Math.round((end - from) / 1000);
  if (song === EAR_PRACTICE) return { ...log, days, ear: (log.ear ?? 0) + seconds };
  const before = log.songs?.[song.key];
  const entry: PracticeSong = { ...before, title: song.title.trim() || "未命名乐谱", seconds: (before?.seconds ?? 0) + seconds, last: end };
  return { ...log, days, songs: { ...log.songs, [song.key]: entry } };
}

/** Sets (or, when blank, removes) the note on one song; a song with no time yet gets an entry. */
export function setSongNote(log: PracticeLog, song: PracticeTarget, note: string, now: number): PracticeLog {
  const text = note.slice(0, PRACTICE_NOTE_MAX);
  const before = log.songs?.[song.key];
  if (!before && !text.trim()) return log;
  const { note: _old, ...rest } = before ?? { title: song.title.trim() || "未命名乐谱", seconds: 0, last: now };
  const entry: PracticeSong = text.trim() ? { ...rest, note: text } : rest;
  return { ...log, songs: { ...log.songs, [song.key]: entry } };
}

/** Songs with practice time, most practiced first. */
export function topSongs(log: PracticeLog, count = 3): (PracticeSong & { key: string })[] {
  return Object.entries(log.songs ?? {})
    .filter(([, song]) => song.seconds >= STREAK_MIN_S)
    .sort((a, b) => b[1].seconds - a[1].seconds || b[1].last - a[1].last)
    .slice(0, count)
    .map(([key, song]) => ({ key, ...song }));
}

/** 「清空记录」: drops every day, song time, note and ear time; the daily goal stays. */
export function clearLog(log: PracticeLog): PracticeLog {
  return { goal: log.goal, days: {} };
}

/** "这首曲子：累计 12 分钟 · 上次 11月11日" or a first-time line. */
export function songSummary(log: PracticeLog, key: string): string {
  const song = log.songs?.[key];
  if (!song || song.seconds <= 0) return "这首曲子还没有练琴记录。";
  const last = new Date(song.last);
  return `这首曲子：累计 ${formatPractice(song.seconds)} · 上次 ${last.getMonth() + 1}月${last.getDate()}日`;
}

export function setGoal(log: PracticeLog, goal: number): PracticeLog {
  return (GOAL_OPTIONS as readonly number[]).includes(goal) ? { ...log, goal } : log;
}

/**
 * Days in a row with at least STREAK_MIN_S of practice, ending today — or yesterday when
 * today has none yet (the streak is still alive until today is over).
 */
export function streakDays(log: PracticeLog, today: Date): number {
  const done = (date: Date) => (log.days[dayKey(date)] ?? 0) >= STREAK_MIN_S;
  let day = done(today) ? today : addDays(today, -1);
  let count = 0;
  while (done(day) && count < PRACTICE_LOG_DAYS) {
    count += 1;
    day = addDays(day, -1);
  }
  return count;
}

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

/** The last seven days, oldest first, for the small bar chart. */
export function lastWeek(log: PracticeLog, today: Date) {
  return Array.from({ length: 7 }, (_, i) => {
    const date = addDays(today, i - 6);
    const key = dayKey(date);
    return { key, label: i === 6 ? "今天" : `周${WEEKDAYS[date.getDay()]}`, seconds: log.days[key] ?? 0 };
  });
}

/** "12 分钟", "1 小时 5 分", "不到 1 分钟". */
export function formatPractice(seconds: number): string {
  const minutes = Math.floor(Math.max(0, seconds) / 60);
  if (minutes < 1) return seconds > 0 ? "不到 1 分钟" : "0 分钟";
  if (minutes < 60) return `${minutes} 分钟`;
  const rest = minutes % 60;
  return rest ? `${Math.floor(minutes / 60)} 小时 ${rest} 分` : `${minutes / 60} 小时`;
}

/** One-line Chinese status for today and the streak. */
export function practiceSummary(log: PracticeLog, today: Date): string {
  const seconds = log.days[dayKey(today)] ?? 0;
  const streak = streakDays(log, today);
  const goal = log.goal * 60;
  const head = goal
    ? seconds >= goal
      ? `今天已练 ${formatPractice(seconds)}，达成每日目标 ${log.goal} 分钟`
      : `今天已练 ${formatPractice(seconds)}，离每日目标 ${log.goal} 分钟还差 ${Math.ceil((goal - seconds) / 60)} 分钟`
    : `今天已练 ${formatPractice(seconds)}`;
  const tail = streak > 0 ? `已连续练习 ${streak} 天` : "今天练满 1 分钟就开始连续打卡";
  return `${head}；${tail}。`;
}

/**
 * Banks practice in stretches. Each stretch is credited to the song that was open when it
 * started, so opening another song mid-session (the editor swaps the id before the timer
 * stops) cannot hand the old song's minutes to the new one.
 */
export function practiceTimer<T extends PracticeCredit>(
  target: () => T,
  write: (start: number, end: number, song: T) => boolean,
  now: () => number = Date.now,
) {
  let start = now();
  let song = target();
  return {
    /** Credit start→now to the stretch's song; the next stretch starts now, for whatever is open. */
    flush() {
      const end = now();
      if (write(start, end, song)) start = end;
      song = target();
    },
  };
}
