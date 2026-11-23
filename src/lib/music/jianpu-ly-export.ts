import { voiceList } from "./voices.ts";
import { nextBar, nextChange, stateAt } from "./score-timeline.ts";
import { degreeToken, KEY_NAMES, PC, transposeKey, type Score } from "./theory.ts";
import { canonicalFermatas } from "./fermata.ts";
import type { ScoreWithGradual } from "./gradual-tempo.ts";
import { cleanGradualTempos, gradualWordsLabel } from "./text-mid-marks.ts";

export type JianpuLyOptions = {
  /** Same semitone shift passed to engraveAbc for the selected instrument. */
  instrumentShift?: number;
  pitch?: "written" | "concert";
};

/** Independent text adapter; no upstream implementation or LilyPond runtime bundled. */
export function scoreToJianpuLy(score: Score, options: JianpuLyOptions = {}) {
  const warnings = new Set<string>();
  const shift = options.pitch === "concert" ? 0 : (options.instrumentShift ?? 0);
  if (!Number.isInteger(shift)) throw new Error("移调必须是整数半音。");
  const key = transposeKey(score.key, shift);
  // jianpu-ly minor uses la-based degrees, unlike the editor's do-based minor.
  const majorKey = score.mode === "minor" ? KEY_NAMES[(PC[key] + 3) % 12] : key;
  const bar = (score.beats * 4) / score.beatUnit;
  if (
    ![1, 2, 4, 8, 16, 32, 64].includes(score.beatUnit) ||
    !Number.isInteger(score.beats) ||
    score.beats < 1 ||
    !Number.isFinite(bar)
  ) {
    throw new Error("此拍号暂不能导出 jianpu-ly。");
  }
  if (!Number.isFinite(score.bpm) || score.bpm <= 0) throw new Error("速度必须大于零。");
  // Text fields never become executable LilyPond syntax.
  const safeText = (value: string) => {
    const clean = value
      .replace(/[^\p{L}\p{N} ，。！？、：；（）《》·,.!?():;—-]/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (clean !== value)
      warnings.add("曲名或歌词中的控制符、引号或特殊字符已替换为空格，请核对文字。");
    return clean;
  };
  const voices = voiceList(score);
  for (const notes of voices)
    for (const note of notes) {
      if (note.pitches.length > 1)
        throw new Error(
          "当前 jianpu-ly 导出暂不支持和弦；已停止导出以免丢失旋律，请使用 MusicXML 或浏览器打印。",
        );
      if (
        !Number.isFinite(note.dur) ||
        note.dur <= 0 ||
        // Dotted 64ths are supported but fall halfway between the 64th-note grid.
        (Math.abs(note.dur * 16 - Math.round(note.dur * 16)) > 1e-7 &&
          Math.abs(note.dur - 0.09375) > 1e-7)
      ) {
        throw new Error(
          "当前 jianpu-ly 导出支持至六十四分音符；三连音或其他非二进制时值暂不支持，请使用 MusicXML 或浏览器打印。",
        );
      }
      if (note.pitches.some((p) => !Number.isInteger(p) || p < 0 || p > 127))
        throw new Error("音高超出 MIDI 整数范围，无法导出。");
      if (
        note.dynamic ||
        note.hairpin ||
        note.hairpinEnd ||
        note.articulations?.length ||
        note.ornament ||
        note.slurStart ||
        note.slurEnd
      ) {
        warnings.add("力度、连线、渐强渐弱、奏法与装饰音未写入 .jly；音高和主音时值保留。");
      }
      if (
        note.lyric &&
        (note.lyric.syllabic !== "single" ||
          note.lyric.extend ||
          note.lyric.fragments?.length ||
          note.lyric.extendType ||
          note.lyric.extendEnd)
      ) {
        warnings.add("歌词保留第 1 段文字；分词连字符和延长线未保留，请核对歌词对位。");
      }
    }
  const lengths = voices.map((notes) => notes.reduce((n, note) => n + note.dur, 0));
  const length = Math.max(...lengths, bar);
  const target = nextBar(score, length - 1e-7);
  if (lengths.some((length) => Math.abs(length - target) > 1e-7))
    warnings.add("末尾已补休止至完整小节，并将两声部补齐；原曲不变。");
  // Every token explicitly sets its duration (no KeepLength). Dashes sustain across bars.
  const durations = [
    [1.5, "", "."],
    [1, "", ""],
    [0.75, "q", "."],
    [0.5, "q", ""],
    [0.375, "s", "."],
    [0.25, "s", ""],
    [0.1875, "d", "."],
    [0.125, "d", ""],
    [0.09375, "h", "."],
    [0.0625, "h", ""],
    // Internal bar-split remainder only; input validation still stops at dotted 64ths.
    [0.03125, "", ""],
  ] as const;
  const fermatas = canonicalFermatas(score.fermatas) ?? [];
  const graduals = cleanGradualTempos((score as ScoreWithGradual).gradualTempos) ?? [];
  const parts = voices.map((notes, voice) => {
    const tokens: string[] = [];
    const lyrics: string[] = [];
    let at = 0;
    let barStart = 0;
    let helperMeter = false;
    const nextMarkAt = (from: number) => {
      let next = nextChange(score, from);
      for (const f of fermatas) if (f.voice === voice && f.at > from + 1e-8) next = Math.min(next, f.at);
      for (const span of graduals) {
        if (span.from > from + 1e-8) next = Math.min(next, span.from);
        if (span.to > from + 1e-8) next = Math.min(next, span.to);
      }
      return next;
    };
    const attachMarks = (when: number) => {
      if (fermatas.some((f) => f.voice === voice && Math.abs(f.at - when) < 1e-8)) tokens.push("\\fermata");
      for (const span of graduals) {
        if (Math.abs(span.from - when) < 1e-8) tokens.push(`^"${gradualWordsLabel(span.kind, span.toBpm)}"`);
        if (Math.abs(span.to - when) < 1e-8) {
          const hasTempo = score.changes?.some((c) => c.bpm !== undefined && Math.abs(c.at - when) < 1e-8);
          if (!hasTempo) tokens.push('^"a tempo"');
        }
      }
    };
    const emit = (midi: number | undefined, duration: number, lyric?: string) => {
      let left = duration;
      let first = true;
      while (left > 1e-7) {
        const active = stateAt(score, at);
        const c = score.changes?.find(c => Math.abs(c.at-at)<1e-8);
        const activeKey = transposeKey(active.key, shift);
        const relativeMajor = active.mode === 'minor' ? KEY_NAMES[(PC[activeKey]+3)%12] : activeKey;
        const pitch = midi === undefined ? '0' : degreeToken(midi + shift, relativeMajor, 'major', 4);
        if (c?.key !== undefined && !first && midi !== undefined) tokens.push('~');
        if (c?.key !== undefined) tokens.push(`${c.mode === 'minor' ? '6' : '1'}=${activeKey}`);
        if (c?.bpm !== undefined) tokens.push(`4=${c.bpm}`);
        if (c?.beats !== undefined || (helperMeter && Math.abs(at-barStart)<1e-8)) {
          tokens.push(`${active.beats}/${active.beatUnit}`); helperMeter = false;
        }
        const boundary = nextBar(score, at);
        if (Math.abs(at-barStart)<1e-8 && boundary-at < active.beats*4/active.beatUnit-1e-8) {
          // jianpu-ly's bar checker needs an explicit length for a truncated measure.
          let numerator = Math.round((boundary-at)*16), denominator = 64;
          if (Math.abs(numerator/16-(boundary-at))>1e-7) throw new Error('变拍位置不能用六十四分音符表示，无法导出。');
          while (numerator%2===0 && denominator>1) { numerator/=2; denominator/=2; }
          tokens.push(`${numerator}/${denominator}`); helperMeter = true;
          warnings.add('小节中途变拍前的短小节用辅助拍号表示实际长度；变化点和音符时值保留。');
        }
        const room = boundary-at;
        const available = Math.min(left, room, nextMarkAt(at)-at);
        const choice =
          durations.find(([dur]) => Math.abs(dur - available) < 1e-7) ??
          (available >= 1
            ? durations[1]
            // Leave at least a 64th; a dotted 64th can otherwise leave an unrepresentable 128th.
            : durations.find(
                ([dur]) => dur <= available + 1e-7 && available - dur >= 0.0625 - 1e-7,
              ));
        if (!choice) throw new Error("小节边界不能用支持的时值表示，无法导出。");
        const [dur, prefix, dot] = choice;
        const figure = first || pitch === "0" || c?.key !== undefined ? pitch : "-";
        // Bare "-." is upstream's staccato alias, not a dotted sustain.
        // Upstream accepts five postfix backslashes for a 128th (no letter prefix).
        const suffix = dur === 0.03125 ? "\\".repeat(5) : dot;
        const startAt = at;
        tokens.push(`${figure === "-" && dot && !prefix ? "c" : prefix}${figure}${suffix}`);
        if (first) attachMarks(startAt);
        if (pitch !== "0" && first) lyrics.push(lyric || '""');
        first = false;
        at += dur;
        if (Math.abs(at-boundary)<1e-8) barStart = at;
        left -= dur;
      }
    };
    for (const note of notes) {
      const pitch = note.pitches.length
        ? degreeToken(note.pitches[0] + shift, majorKey, "major", 4)
        : "0";
      if ((pitch.match(/'/g)?.length ?? 0) > 3 || (pitch.match(/,/g)?.length ?? 0) > 3) {
        throw new Error("音高超过 jianpu-ly 支持的上下三组八度，请使用 MusicXML 或浏览器打印。");
      }
      const text = note.lyric?.text ? safeText(note.lyric.text) : "";
      // H: inserts spaces between Hanzi. Underscores keep a multi-character syllable on one note.
      const syllable = text
        ? text.replace(/([\p{Script=Han}])(?=[\p{Script=Han}])/gu, "$1_")
        : undefined;
      if (text.includes(" ")) warnings.add("含空格的歌词音节已合并，请核对歌词对位。");
      emit(note.pitches[0], note.dur, syllable?.replace(/ /g, "_"));
    }
    if (at < target) emit(undefined, target - at);
    const header = `${score.mode === "minor" ? "6" : "1"}=${key} ${score.beats}/${score.beatUnit} 4=${Math.round(score.bpm)}`;
    return [
      header,
      tokens.join(" "),
      ...(notes.some((n) => n.lyric?.text && n.pitches.length) ? [`H: ${lyrics.join(" ")}`] : []),
    ].join("\n");
  });
  return {
    text: `title=${safeText(score.title) || "未命名"}\n${parts.join("\nNextPart\n")}\n`,
    warnings: [...warnings],
  };
}
