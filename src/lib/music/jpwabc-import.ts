/** JP-Word subset, independently implemented from Dolce 6b1d3fc specifications.
 * Reference documentation Copyright (c) 2026 lodebar2026, MIT.
 * See public/third-party/dolce-LICENSE.txt and docs/text-import-jpwabc.md.
 */
import { PC, type KeyName, type Score, type ScoreNote } from "./theory.ts";

export function importJpwabc(input: string | Uint8Array | ArrayBuffer): {
  score: Score;
  warnings: string[];
} {
  let text: string;
  if (typeof input === "string") text = input.replace(/^\uFEFF/, "");
  else {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    if (bytes[0] !== 255 || bytes[1] !== 254 || bytes.length % 2)
      throw new Error("JP-Word 文件必须是 UTF-16LE+BOM；请勿以 UTF-8 保存或打开。");
    try {
      text = new TextDecoder("utf-16le", { fatal: true }).decode(bytes);
    } catch {
      throw new Error("JP-Word UTF-16LE 编码损坏。");
    }
  }
  if (text.includes("\0") || text.includes("\uFFFD"))
    throw new Error("JP-Word 文本编码错误，请使用 UTF-16LE+BOM 原文件。");
  const warnings: string[] = [];
  const warn = (s: string) => {
    if (!warnings.includes(s)) warnings.push(s);
  };
  const sections = new Map<string, string[]>();
  let section = "";
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (/^\.[A-Za-z]+$/.test(line)) {
      section = line.slice(1);
      if (sections.has(section))
        throw new Error(`不支持重复的 .${section} 段，已取消导入以免丢失旋律或歌词。`);
      sections.set(section, []);
      continue;
    }
    if (!line || (section !== "Words" && line.startsWith("//"))) continue;
    if (!section) throw new Error("不是有效的 JP-Word 文件：正文前缺少段头。");
    sections.get(section)!.push(section === "Words" ? line : line.replace(/\/\/.*$/, "").trim());
  }
  if (!sections.has("Voice")) throw new Error("JP-Word 缺少 .Voice 主旋律段。");
  const fields = new Map<string, string>();
  for (const line of sections.get("Title") ?? []) {
    const m = /^(\w+)\s*=\s*\{(.*)\}$/.exec(line);
    if (!m) throw new Error(`标题字段无法解析：${line}`);
    fields.set(m[1], m[2]);
  }
  const km = fields.get("KeyAndMeters");
  const match = km?.match(/^1=([#b]?[A-G]),\s*(\d+)\/(\d+)$/);
  if (km && !match) throw new Error("不支持此调号/拍号，请使用如 {1=G,3/4}。");
  const names: Record<string, KeyName> = {
    bD: "Db",
    bE: "Eb",
    bG: "F#",
    bA: "Ab",
    bB: "Bb",
    "#C": "Db",
    "#D": "Eb",
    "#F": "F#",
    "#G": "Ab",
    "#A": "Bb",
    bC: "B",
    "#B": "C",
    bF: "E",
    "#E": "F",
  };
  const rawKey = match?.[1] ?? "C";
  const key = names[rawKey] ?? (rawKey as KeyName);
  const beats = Number(match?.[2] ?? 4),
    beatUnit = Number(match?.[3] ?? 4);
  if (beats < 1 || beats > 32 || ![1, 2, 4, 8, 16, 32].includes(beatUnit))
    throw new Error("不支持此拍号。");
  if (!km) warn("缺少调号/拍号，采用 C 大调、4/4。");
  const expression = fields.get("Expression");
  const tempo = expression?.match(/^[♩q]\s*=\s*(\d+)$/);
  const bpm = Number(tempo?.[1] ?? 120);
  if (bpm < 20 || bpm > 300) throw new Error("速度超出支持范围（20–300）。");
  if (!tempo)
    warn(expression ? "速度表情无法映射，采用 120；表情文字未保留。" : "缺少速度，采用 120。");
  // B-family tonics start in octave 3; normalization can cross a C boundary.
  const rawTonicOctave = ["B", "bB", "#B"].includes(rawKey) ? 3 : 4;
  const tonicOctave = rawTonicOctave + (rawKey === "#B" ? 1 : rawKey === "bC" ? -1 : 0);
  const score: Score = {
    title: fields.get("Title") || "JP-Word 导入",
    key,
    beats,
    beatUnit,
    bpm,
    mode: "major",
    clef: "treble",
    tonicOctave,
    notes: [],
  };
  const bars: ScoreNote[][] = [[]];
  let body = sections.get("Voice")!.join(" ");
  while (body.length) {
    const space = /^\s+/.exec(body);
    if (space) {
      body = body.slice(space[0].length);
      continue;
    }
    const bar = /^(\[\|\]|:\|:|:\||\|:|::|\|\]|\|\||\|)/.exec(body);
    if (bar) {
      if (bar[0].includes(":")) warn("反复记号只按谱面播放一次，未展开。");
      if (bars.at(-1)!.length) bars.push([]);
      body = body.slice(bar[0].length);
      continue;
    }
    const layout = /^(\$(?:\([^)]*\))?|\{C:[^}]*\}|[()])/.exec(body);
    if (layout) {
      warn("连线、控制参数和版式未保留。");
      if (layout[0].startsWith("$") && bars.at(-1)!.length) bars.push([]);
      body = body.slice(layout[0].length);
      continue;
    }
    const note = /^(#b|#|b)?([0-7])([,']*)/.exec(body);
    // Duration is scanned separately so both ._ and _. keep the same dotted value.
    if (!note)
      throw new Error(`不支持的音乐记号「${body.slice(0, 24)}」，已取消导入以免丢失旋律。`);
    const pitchToken = `${note[1] ?? ""}${note[2]}${note[3]}`;
    body = body.slice(pitchToken.length);
    const duration = /^(-+|_+\.*|\.+_*)/.exec(body)?.[0] ?? "";
    body = body.slice(duration.length);
    const underscores = (duration.match(/_/g) ?? []).length,
      dots = (duration.match(/\./g) ?? []).length;
    const dur = duration.startsWith("-")
      ? 1 + duration.length
      : 2 ** -underscores * (2 - 2 ** -dots);
    let pitches: number[] = [];
    if (note[2] !== "0") {
      const degree = Number(note[2]) - 1;
      let midi = 12 * (tonicOctave + 1) + PC[key] + [0, 2, 4, 5, 7, 9, 11][degree];
      if (note[1] === "#b") {
        const letter = ("CDEFGAB".indexOf(rawKey.at(-1)!) + degree) % 7;
        const natural = [0, 2, 4, 5, 7, 9, 11][letter];
        let delta = natural - (midi % 12);
        if (delta > 6) delta -= 12;
        if (delta < -6) delta += 12;
        midi += delta;
      } else midi += note[1] === "#" ? 1 : note[1] === "b" ? -1 : 0;
      midi += 12 * [...note[3]].reduce((n, c) => n + (c === "'" ? 1 : -1), 0);
      if (midi < 0 || midi > 127) throw new Error("音高超出 MIDI 范围。");
      pitches = [midi];
    }
    const n = { pitches, dur };
    score.notes.push(n);
    bars.at(-1)!.push(n);
  }
  if (!score.notes.some((n) => n.pitches.length)) throw new Error("没有可导入的主旋律音符。");
  const consumedLyricSlots = new Set<ScoreNote>();
  for (const line of sections.get("Words") ?? []) {
    const m = /^W(\d+)(?:-(\d+))?(?:@(\d+),(\d+))?:(.*)$/.exec(line);
    if (!m) throw new Error("歌词段头不支持，无法可靠对齐歌词。");
    if (Number(m[1]) !== 1) {
      warn("只保留第 1 段歌词，其余段未导入。");
      continue;
    }
    if (m[2] && Number(m[2]) > 1) warn("共用歌词只写入第 1 段。");
    const barIndex = Number(m[3] ?? 1) - 1,
      noteIndex = Number(m[4] ?? 1) - 1;
    const singingBars = bars.filter((b) => b.length);
    const start = singingBars[barIndex]?.[noteIndex];
    if (!start) throw new Error("歌词起点超出旋律范围。");
    const targets = score.notes.slice(score.notes.indexOf(start));
    if (/[{}\[\]]/.test(m[5].replace(/\{[^{}\[\]]+\}/g, "")))
      throw new Error("歌词分组或对齐控制不支持，已取消导入。");
    const tokens = m[5].match(/\{[^}]*\}|\/|[A-Za-z]+|[^\s\-()]/gu) ?? [];
    let i = 0;
    for (const token of tokens) {
      if (/^[，。！？；：、,.!?;:”’]$/.test(token) && i > 0) {
        const prev = targets[i - 1].lyric;
        if (prev) prev.text += token;
        continue;
      }
      if (/^[“‘]$/.test(token)) {
        warn("歌词起始引号未保留。");
        continue;
      }
      const target = targets[i++];
      if (!target || consumedLyricSlots.has(target))
        throw new Error("第 1 段歌词超出音符或发生重叠，已取消导入。");
      consumedLyricSlots.add(target);
      if (token !== "/" && !target.pitches.length)
        throw new Error("歌词落在休止符上，请用 / 占位；已取消导入。");
      if (token !== "/") target.lyric = { text: token.replace(/^\{|\}$/g, ""), syllabic: "single" };
    }
  }
  for (const name of sections.keys())
    if (!["Voice", "Title", "Words"].includes(name))
      warn(
        name === "Repeat"
          ? "演唱顺序表未保留，只按谱面播放一次。"
          : `.${name} 版式或附加信息未保留。`,
      );
  if ([...fields.keys()].some((k) => !["Title", "KeyAndMeters", "Expression"].includes(k)))
    warn("署名及其他标题字段未保留。");
  return { score, warnings };
}
