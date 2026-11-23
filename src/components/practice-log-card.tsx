import { useEffect, useRef, useState } from "react";
import {
  clearLog,
  formatPractice,
  GOAL_OPTIONS,
  PRACTICE_NOTE_MAX,
  setSongNote,
  songSummary,
  topSongs,
  type PracticeTarget,
  lastWeek,
  practiceSummary,
  readLog,
  setGoal,
  writeLog,
  type PracticeLog,
} from "@/lib/music/practice-log";
import { dangerQuiet, quiet } from "./ui/styles";
import "./practice-log.css";

/** Whether 「笔记、目标与清空」 was left open; kept while the page lives so reopening the panel keeps it. */
let moreOpen = false;

/**
 * 练琴记录：today against the daily goal, the last seven days and the streak.
 * Playing the score or 等你弹 is timed by the editor; this card only reads and sets the goal.
 */
export default function PracticeLogCard({ running, tick, song }: { running: boolean; tick: number; song: PracticeTarget }) {
  const [log, setLog] = useState<PracticeLog>(() => readLog(localStorage));
  const [now, setNow] = useState(() => new Date());
  const [clearing, setClearing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [open, setOpen] = useState(moreOpen);
  const [note, setNote] = useState(() => readLog(localStorage).songs?.[song.key]?.note ?? "");
  useEffect(() => {
    setLog(readLog(localStorage));
    setNow(new Date());
  }, [tick]);
  // An edit still in the box when the panel closes or the song changes is saved, not dropped.
  const draft = useRef<{ song: PracticeTarget; note: string } | null>(null);
  const flushDraft = () => {
    const pending = draft.current;
    draft.current = null;
    if (!pending) return;
    const latest = readLog(localStorage);
    if ((latest.songs?.[pending.song.key]?.note ?? "") !== pending.note) writeLog(localStorage, setSongNote(latest, pending.song, pending.note, Date.now()));
  };
  useEffect(() => {
    setNote(readLog(localStorage).songs?.[song.key]?.note ?? "");
    return flushDraft;
  }, [song.key]);
  const save = (next: PracticeLog, message: string | null = null) => {
    setNotice(writeLog(localStorage, next) ? message : "没能保存到本机，可能空间不足。");
    setLog(next);
  };
  const saveNote = () => {
    draft.current = null;
    const latest = readLog(localStorage);
    if ((latest.songs?.[song.key]?.note ?? "") === note) return;
    save(setSongNote(latest, song, note, Date.now()), note.trim() ? "笔记已存在本机。" : null);
  };
  const top = topSongs(log);
  const week = lastWeek(log, now);
  const today = week[week.length - 1].seconds;
  const goal = log.goal * 60;
  const tallest = Math.max(goal, ...week.map((day) => day.seconds), 60);
  return (
    <div className="tool-group practice-log" data-practice-log>
      <p className="tool-group-title">练琴记录<span>播放、节拍器、持续音、练耳和拍节奏自动记时，只存本机</span></p>
      {goal ? (
        <div className="practice-log-meter" role="progressbar" aria-label="今日目标进度"
          aria-valuemin={0} aria-valuemax={log.goal} aria-valuenow={Math.min(log.goal, Math.floor(today / 60))}>
          <span style={{ width: `${Math.min(100, (today / goal) * 100)}%` }} data-done={today >= goal ? "" : undefined} />
        </div>
      ) : null}
      <p className="practice-log-summary" role="status">
        {practiceSummary(log, now)}
        {running ? " 正在计时，停下后记入。" : ""}
      </p>
      <ol className="practice-log-week" aria-label="最近 7 天练习时长">
        {week.map((day) => {
          const minutes = Math.floor(day.seconds / 60);
          return (
            <li key={day.key} title={`${day.label} ${minutes} 分钟`} aria-label={`${day.label} ${minutes} 分钟`}>
              <span className="practice-log-bar" aria-hidden="true">
                <span style={{ height: `${Math.min(100, (day.seconds / tallest) * 100)}%` }}
                  data-goal={goal && day.seconds >= goal ? "" : undefined} />
              </span>
              <small aria-hidden="true">{day.label}</small>
            </li>
          );
        })}
      </ol>
      <details className="practice-fold" data-practice-log-more open={open}
        onToggle={(event) => { moreOpen = event.currentTarget.open; setOpen(moreOpen); }}>
      <summary>这首笔记、每日目标与清空</summary>
      <div className="practice-log-song">
        <p data-song-summary>{songSummary(log, song.key)}</p>
        <label>
          <span>这首的练习笔记</span>
          <textarea aria-label="这首的练习笔记" maxLength={PRACTICE_NOTE_MAX} rows={2} value={note}
            placeholder="例如：第 12 小节换指不稳，先慢练"
            onChange={(event) => { setNote(event.target.value); draft.current = { song, note: event.target.value }; }} onBlur={saveNote} />
        </label>
      </div>
      {top.length ? (
        <div className="practice-log-top">
          <p>练得最多</p>
          <ol aria-label="练得最多的曲子">
            {top.map((item) => <li key={item.key}><span>{item.title}</span><span>{formatPractice(item.seconds)}</span></li>)}
          </ol>
        </div>
      ) : null}
      {log.ear ? <p className="practice-log-ear" data-ear-time>听音练耳累计 {formatPractice(log.ear)}（算进每天时长，不记到曲子）</p> : null}
      <label className="practice-log-goal">
        每日目标
        <select aria-label="每日练琴目标" className="practice-select" value={log.goal}
          onChange={(event) => {
            const next = setGoal(readLog(localStorage), Number(event.target.value));
            writeLog(localStorage, next);
            setLog(next);
          }}>
          {GOAL_OPTIONS.map((minutes) => <option key={minutes} value={minutes}>{minutes ? `${minutes} 分钟` : "不设"}</option>)}
        </select>
      </label>
      <div className="practice-log-clear">
        {clearing ? (
          <>
            <p>将清空本机的练琴时长、连续天数、练耳时长和每首的笔记，每日目标保留。</p>
            <button type="button" className={dangerQuiet} onClick={() => {
              setClearing(false);
              draft.current = null;
              setNote("");
              save(clearLog(readLog(localStorage)), "练琴记录已清空。");
            }}>确认清空</button>
            <button type="button" className={quiet} onClick={() => setClearing(false)}>取消</button>
          </>
        ) : (
          <button type="button" className={quiet} disabled={running}
            onClick={() => { setNotice(null); setClearing(true); }}>清空记录</button>
        )}
        {notice ? <p role="status" data-log-notice>{notice}</p> : null}
      </div>
      </details>
    </div>
  );
}
