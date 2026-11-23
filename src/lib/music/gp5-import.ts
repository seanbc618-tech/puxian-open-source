import { importer, model } from "@coderline/alphatab";
import type { Score, ScoreNote, KeyName } from "./theory.ts";
import { canonicalChanges, clampChangeBpm, clampChangeBeats, changeBeatUnit } from "./score-timeline.ts";
import { parseChordSymbol } from "./chord-symbol.ts";
import { MAX_VOICES } from "./voices.ts";

export const MAX_GP5_BYTES = 4 * 1024 * 1024;
export type Gp5Preview = { score: Score; losses: string[]; notes: string[] };

/** Pure local import. The caller must preview this result before publishing it. */
export function importGp5(bytes: Uint8Array, fallbackTitle = "Guitar Pro 乐谱"): Gp5Preview {
  if (bytes.length > MAX_GP5_BYTES) throw new Error("GP5 文件过大，请使用不超过 4 MB 的文件。");
  const header = new TextDecoder().decode(bytes.subarray(1, 1 + bytes[0]!));
  if (bytes.length < 32 || bytes[0]! > 30 || !/^FICHIER GUITAR PRO v5\.(00|10)$/.test(header)) {
    throw new Error("请选择 Guitar Pro 5（.gp5）文件。");
  }
  try {
    return mapGp5(importer.ScoreLoader.loadScoreFromBytes(bytes), fallbackTitle);
  } catch (error) {
    throw new Error(`GP5 文件损坏或包含无法读取的内容，现有谱未更改。${error instanceof Error ? `（${error.message}）` : ""}`);
  }
}

/** Isolated adapter: alphaTab objects never enter drafts/history or playback. */
export function mapGp5(source: model.Score, fallbackTitle: string): Gp5Preview {
  const losses = new Set<string>();
  const voices: ScoreNote[][] = [];
  const score: Score = { title: source.title || fallbackTitle, bpm: source.tempo || 120,
    beats: 4, beatUnit: 4, key: "C", mode: "major", clef: "treble", tonicOctave: 4, notes: [], changes: [], chordSymbols: [] };
  const keyNames: KeyName[] = ["B", "F#", "Db", "Ab", "Eb", "Bb", "F", "C", "G", "D", "A", "E", "B", "F#", "Db"];
  const minorKeys: KeyName[] = ["Ab", "Eb", "Bb", "F", "C", "G", "D", "A", "E", "B", "F#", "Db", "Ab", "Eb", "Bb"];
  const keyAt = (bar: model.Bar) => (bar.keySignatureType === 1 ? minorKeys : keyNames)[bar.keySignature + 7] ?? "C";
  const firstStaff = source.tracks.flatMap(t => t.staves).find(s => !s.isPercussion);
  if (!firstStaff) throw new Error("文件里没有可导入的旋律声部");
  let at = 0;
  source.masterBars.forEach((bar, index) => {
    const keyBar = firstStaff.bars[index];
    const mark = { at, beats: bar.timeSignatureNumerator, beatUnit: bar.timeSignatureDenominator,
      key: keyBar ? keyAt(keyBar) : score.key, mode: keyBar?.keySignatureType === 1 ? "minor" as const : "major" as const };
    if (!index) Object.assign(score, { beats: mark.beats, beatUnit: mark.beatUnit, key: mark.key, mode: mark.mode });
    else score.changes!.push(mark);
    for (const tempo of bar.tempoAutomations) {
      if (tempo.value > 0) {
        const position = at + tempo.ratioPosition * bar.calculateDuration() / 960;
        if (position === 0) score.bpm = tempo.value;
        else score.changes!.push({ at: position, bpm: tempo.value });
      }
    }
    if (bar.isRepeatStart || bar.isRepeatEnd || bar.alternateEndings || bar.directions?.size) losses.add("反复、跳房与跳转未展开，按书写顺序导入。");
    if (bar.isFreeTime) losses.add("自由拍子的排版标记未保留。请检查时值与拍号。 ");
    if (bar.tripletFeel) losses.add("摇摆节奏演奏比例未保留；书写时值保留。");
    at += bar.calculateDuration() / 960;
  });
  let totalBeats = 0;
  for (const track of source.tracks) for (const staff of track.staves) {
    if (staff.isPercussion) { losses.add("打击乐轨未导入。"); continue; }
    const count = Math.max(0, ...staff.bars.map(b => b.voices.length));
    for (let vi = 0; vi < count; vi++) {
      if (!staff.bars.some(b => b.voices[vi]?.beats.some(beat => !beat.isEmpty && beat.notes.length))) continue;
      if (voices.length >= MAX_VOICES) { losses.add(`当前最多保留前 ${MAX_VOICES} 个旋律声部，其余声部或乐器轨未导入。`); continue; }
      const notes: ScoreNote[] = [];
      let barStart = 0;
      for (const bar of staff.bars) {
        let cursor = barStart;
        for (const beat of bar.voices[vi]?.beats ?? []) {
          if (++totalBeats > 20000) throw new Error("乐谱事件过多");
          if (beat.isEmpty) continue;
          if (beat.graceType !== model.GraceType.None) { losses.add("装饰小音符的独立节奏未保留。"); continue; }
          const dur = beat.displayDuration / 960;
          if (!Number.isFinite(dur) || dur <= 0) throw new Error("音符时值无效");
          const start = barStart + beat.displayStart / 960;
          if (start > cursor + 1e-8) notes.push({ pitches: [], dur: start - cursor });
          const pitches = [...new Set(beat.notes.map(n => n.realValue))].sort((a, b) => a - b);
          if (pitches.some(p => p < 21 || p > 108)) losses.add("钢琴音域外的音高已略过。");
          const note: ScoreNote = { pitches: pitches.filter(p => p >= 21 && p <= 108), dur };
          if (note.pitches.length > 8) { note.pitches = note.pitches.slice(0, 8); losses.add("超过八音的和弦仅保留最低八音。"); }
          note.dynamic = beat.dynamics <= 2 ? "p" : beat.dynamics === 3 ? "mp" : beat.dynamics === 4 ? "mf" : "f";
          if (beat.dynamics < 2 || beat.dynamics > 5) losses.add("极弱/极强力度已近似为 p / f。");
          if (beat.notes.some(n => n.isStaccato)) note.articulations = ["staccato"];
          if (beat.notes.some(n => n.accentuated)) note.articulations = [...(note.articulations ?? []), "accent"];
          if (beat.brushType !== model.BrushType.None && pitches.length > 1) {
            note.ornament = "arpeggio";
            losses.add("扫弦映射为琶音，方向与扫弦速度未保留。");
          }
          if (beat.notes.some(n => n.isHammerPullOrigin) || beat.isLegatoOrigin) note.slurStart = true;
          if (beat.notes.some(n => n.isHammerPullDestination) || beat.isLegatoDestination) note.slurEnd = true;
          if (note.slurStart || note.slurEnd) losses.add("击弦/勾弦与连奏映射为连线，吉他专用发音未保留。");
          if (beat.notes.some(n => n.isTieDestination)) {
            const previous = notes.at(-1);
            if (beat.notes.every(n => n.isTieDestination) && previous && JSON.stringify(previous.pitches) === JSON.stringify(note.pitches)) previous.dur += dur;
            else { notes.push(note); losses.add("局部延音线无法合并，已保留音高与书写时值，可能重新起音。"); }
          } else notes.push(note);
          if (beat.chordId) {
            const name = staff.getChord(beat.chordId)?.name;
            if (name && parseChordSymbol(name) && !score.chordSymbols!.some(c => c.at === start)) score.chordSymbols!.push({ at: start, symbol: name });
            else if (name) losses.add("无法识别或同一位置冲突的和弦标记已略过。");
          }
          if (beat.text || beat.lyrics?.length) losses.add("歌词与自由文本未导入。");
          if (beat.fade || beat.vibrato || beat.whammyBarType || beat.tap || beat.slap || beat.pop || beat.hasRasgueado || beat.notes.some(n => n.hasBend || n.isPalmMute || n.isLetRing || n.isDead || n.isGhost || n.harmonicType || n.slideInType || n.slideOutType || n.vibrato || n.isLeftHandTapped || n.isTrill)) losses.add("推弦、滑音、泛音、制音、延响、颤音及特殊拨弦等吉他音色技法未保留。");
          cursor = start + dur;
        }
        const end = barStart + bar.masterBar.calculateDuration() / 960;
        if (end > cursor + 1e-8) notes.push({ pitches: [], dur: end - cursor });
        barStart = end;
      }
      voices.push(notes);
    }
  }
  if (!voices.length) throw new Error("文件里没有可导入的音符");
  const events = canonicalChanges([{ at: 0, bpm: score.bpm, beats: score.beats, beatUnit: score.beatUnit, key: score.key, mode: score.mode }, ...score.changes!]);
  for (const event of events) {
    if (event.bpm !== undefined && clampChangeBpm(event.bpm) !== event.bpm) losses.add("超出 40–220 BPM 的速度已限制到可编辑范围。");
    if (event.bpm !== undefined) event.bpm = clampChangeBpm(event.bpm);
    if (event.beats !== undefined) {
      if (clampChangeBeats(event.beats) !== event.beats || changeBeatUnit(event.beatUnit!) !== event.beatUnit) throw new Error("拍号超出现有模型范围");
    }
  }
  const opening = events.find(e => e.at === 0);
  if (opening) { const { at: _at, ...fields } = opening; Object.assign(score, fields); }
  score.changes = events.filter(e => e.at > 0);
  score.notes = voices[0]!;
  if (voices[1]) score.voice2 = voices[1];
  if (voices.length > 2) score.extraVoices = voices.slice(2);
  losses.add("弦号、品位、指法、和弦指板图、音色/混音与页面排版未保留；音高包含定弦与变调夹。");
  return { score, losses: [...losses], notes: [`已读取 ${voices.length} 个旋律声部；确认后整谱替换，可撤销。`, "使用 alphaTab 1.8.3（MPL-2.0），本地解析。"] };
}
