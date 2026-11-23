import { voiceList } from "./voices.ts";
import { hasPlayOrder, unrollScore } from "./repeats.ts";
import { canonicalChanges, changeBeatUnit, clampChangeBeats, clampChangeBpm } from "./score-timeline.ts";
import type { ScoreChange } from "./theory.ts";
// RH/LH concepts adapted from genshin-jianpu-editor (MIT).
// Original work Copyright (c) 2026 lodebar2026
// Modifications Copyright (c) 2026 StarryCosmosPiano
// Full notice: public/third-party/genshin-jianpu-editor-LICENSE.txt
import { quantizeMidi, quantizeNotice, type QuantizeReport } from "./midi-quantize.ts";
import { noteGains } from "./expression.ts";
import { scoreWithFermataTempo, scoreWithGradualTempo } from "./fermata.ts";
import { KEY_NAMES, type Score, type ScoreNote, guessKey, inferTonicOctave, isKeyName } from "./theory.ts";

function writeVarLen(value: number): number[] {
  const bytes = [value & 0x7f];
  let rest = value >> 7;
  while (rest > 0) {
    bytes.push((rest & 0x7f) | 0x80);
    rest >>= 7;
  }
  return bytes.reverse();
}

export const MAX_MIDI_BYTES = 16 * 1024 * 1024;
const invalidMidi = () => new Error("MIDI 文件损坏或被截断，请重新导出后再试");

function readVarLen(data: Uint8Array, offset: number, end: number): { value: number; offset: number } {
  let value = 0;
  for (let i = 0; i < 4; i++) {
    if (offset >= end) throw invalidMidi();
    const byte = data[offset++];
    value = value * 128 + (byte & 0x7f);
    if (!(byte & 0x80)) return { value, offset };
  }
  throw invalidMidi();
}

function u16(value: number): number[] {
  return [(value >> 8) & 0xff, value & 0xff];
}

function u32(value: number): number[] {
  return [(value >> 24) & 0xff, (value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

function trackBytes(events: { tick: number; order: number; data: number[] }[]): number[] {
  events.sort((a, b) => a.tick - b.tick || a.order - b.order);
  const track: number[] = [];
  let last = 0;
  for (const event of events) {
    track.push(...writeVarLen(event.tick - last), ...event.data);
    last = event.tick;
  }
  return track;
}

function midiTrack(notes: ScoreNote[], score: Score, channel: number, meta: boolean, voice = 1, tpq = 480, program?: number): number[] {
  const events: { tick: number; order: number; data: number[] }[] = [];
  if (voice >= 15) events.push({ tick: 0, order: 0, data: [0xff, 0x21, 1, Math.floor(voice / 15)] });
  if (program !== undefined && Number.isInteger(program) && program >= 0 && program <= 127) events.push({ tick: 0, order: 0, data: [0xc0 | channel, program] });
  if (meta) {
    for (const c of [{ at: 0, bpm: score.bpm, beats: score.beats, beatUnit: score.beatUnit, key: score.key, mode: score.mode }, ...(score.changes ?? [])]) {
      const tick = Math.round(c.at * tpq);
      if (c.bpm !== undefined) {
        const micros = Math.round(60_000_000 / c.bpm);
        events.push({ tick, order: 0, data: [0xff,0x51,3,(micros >> 16)&255,(micros >> 8)&255,micros&255] });
      }
      if (c.beats !== undefined) events.push({ tick, order: 0, data: [0xff,0x58,4,c.beats,Math.log2(c.beatUnit!),24,8] });
      if (c.key !== undefined) {
        const pc = KEY_NAMES.indexOf(c.key);
        const sf = Array.from({length:15}, (_,i) => i-7).sort((a,b) => Math.abs(a)-Math.abs(b)).find(f => ((f*7+(c.mode === 'minor' ? 9 : 0))%12+12)%12 === pc)!;
        events.push({ tick, order: 0, data: [0xff,0x59,2,sf&255,c.mode === 'minor' ? 1 : 0] });
      }
    }
    const titleBytes = new TextEncoder().encode(score.title.trim().slice(0, 80));
    if (titleBytes.length) {
      events.push({
        tick: 0,
        order: 0,
        data: [0xff, 0x03, ...writeVarLen(titleBytes.length), ...titleBytes],
      });
    }
  } else {
    const name = new TextEncoder().encode(voice === 1 ? "声部二" : `谱线声部 ${voice + 1}`);
    events.push({
      tick: 0,
      order: 0,
      data: [0xff, 0x03, ...writeVarLen(name.length), ...name],
    });
  }

  let tick = 0;
  const gains = noteGains({ ...score, notes });
  const on = 0x90 | (channel & 0x0f);
  const off = 0x80 | (channel & 0x0f);
  notes.forEach((note, index) => {
    const dur = Math.max(1, Math.round(note.dur * tpq));
    const velocity = Math.max(1, Math.min(127, Math.round(78 * (gains[index] ?? 1))));
    for (const pitch of note.pitches) {
      const midi = Math.max(0, Math.min(127, Math.round(pitch)));
      events.push({ tick, order: 2, data: [on, midi, velocity] });
      events.push({ tick: tick + dur, order: 1, data: [off, midi, 0] });
    }
    tick += dur;
  });
  tick = Math.max(tick, ...events.filter(e => e.order === 0).map(e => e.tick));
  events.push({ tick, order: 3, data: [0xff, 0x2f, 0x00] });
  return trackBytes(events);
}

/**
 * One track when voice 2 is absent or empty, so older files stay format 0.
 * Any stored voice 2, including a voice that is only rests, is a second track
 * on its own channel. Its end-of-track tick is that voice's written length.
 * Tempo is written once, on track 1. The metronome is not written.
 */
export function scoreToMidi(written: Score, programs: readonly (number | undefined)[] = []): Uint8Array {
  // MIDI has no repeat signs: write the played order (|: A :| → A A).
  const score = scoreWithFermataTempo(scoreWithGradualTempo(hasPlayOrder(written) ? unrollScore(written).score : written));
  let tpq = 480;
  const voices = voiceList(score);
  const gcd = (a: number, b: number): number => b ? gcd(b, a % b) : a;
  const positions = new Set([...voices.flatMap(v => v.map(n => n.dur)), ...(score.changes ?? []).map(c => c.at)]);
  for (const value of positions) {
    if (!Number.isFinite(value) || value <= 0) throw new Error("MIDI 导出需要有效的正时值。");
    if (Math.abs(value * tpq - Math.round(value * tpq)) < 1e-7) continue;
    let denominator = 1;
    while (denominator <= 32767 && Math.abs(value * denominator - Math.round(value * denominator)) > 1e-7) denominator++;
    tpq = tpq / gcd(tpq, denominator) * denominator;
    if (tpq > 32767) throw new Error("节奏精度超出 MIDI 导出范围，请先量化或改用 MusicXML。");
  }
  const tracks = [midiTrack(voices[0]!, score, 0, true, 0, tpq, programs[0] ?? (score.staffInstrument === "piano" ? 0 : undefined))];
  voices.slice(1).forEach((v,i) => {
    if (v.length || score.extraVoices?.length) {
      const channel = (i + 1) % 15;
      tracks.push(midiTrack(v, score, channel >= 9 ? channel + 1 : channel, false, i + 1, tpq, programs[i + 1] ?? (score.staffInstrument === "piano" ? 0 : undefined)));
    }
  });
  const body: number[] = [];
  for (const track of tracks) {
    body.push(0x4d, 0x54, 0x72, 0x6b, ...u32(track.length), ...track);
  }
  const bytes = [
    0x4d,
    0x54,
    0x68,
    0x64,
    ...u32(6),
    ...u16(tracks.length > 1 ? 1 : 0),
    ...u16(tracks.length),
    ...u16(tpq),
    ...body,
  ];
  return Uint8Array.from(bytes);
}

type RawNote = { start: number; end: number; midi: number; track: number; channel: number };

/** One pitched line: a track and channel that actually contain notes. Channel 10 (9) is drums. */
export type MidiVoice = {
  /** Initial GM program, when present. Playback preferences remain outside Score. */
  program?: number;
  track: number;
  channel: number;
  name: string | null;
  noteCount: number;
  low: number;
  high: number;
};

const PITCH_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

export function midiPitchName(midi: number): string {
  const rounded = Math.round(midi);
  const pc = ((rounded % 12) + 12) % 12;
  return `${PITCH_NAMES[pc]}${Math.floor(rounded / 12) - 1}`;
}

export function describeMidiVoice(voice: MidiVoice): { title: string; detail: string } {
  const name = voice.name?.trim() ?? "";
  const range =
    voice.low === voice.high
      ? midiPitchName(voice.low)
      : `${midiPitchName(voice.low)}–${midiPitchName(voice.high)}`;
  const count = `${voice.noteCount} 个音`;
  if (!name) {
    return {
      title: `轨道 ${voice.track + 1} · 通道 ${voice.channel + 1}`,
      detail: `${count} · ${range}`,
    };
  }
  return {
    title: name,
    detail: `轨道 ${voice.track + 1} · 通道 ${voice.channel + 1} · ${count} · ${range}`,
  };
}

export function midiChoicePrompt(count: number): string {
  return `这份 MIDI 有 ${count} 个声部。选一条放进正在改的声部，不会把整首编曲都导入。`;
}

export function midiImportNotice(voice: MidiVoice, skipped: number, keyText: string): string {
  if (skipped <= 0) return `读入了 MIDI，放进正在改的声部。调性为${keyText}。`;
  const named = voice.name?.trim();
  const label = named ? `「${named}」` : `轨道 ${voice.track + 1} 通道 ${voice.channel + 1}`;
  return `已载入${label}到正在改的声部，其余 ${skipped} 个声部没有放进谱里。调性为${keyText}。`;
}

function parseTrack(
  data: Uint8Array,
  offset: number,
  end: number,
  trackIndex: number,
  into: RawNote[],
  tempo: { micro: number | null; tick: number },
  meter: { beats: number; beatUnit: number; tick: number },
  title: { value: string | null },
  key: { value: Pick<Score, "key" | "mode"> | null; tick: number },
  division: number,
  changes: ScoreChange[],
  extras: MidiExtras,
  endTicks: number[],
  programs: Record<string, number>,
): string | null {
  let tick = 0;
  let status = 0;
  let ended = false;
  let trackName: string | null = null;
  let instrumentName: string | null = null;
  const open = new Map<string, { starts: number[]; head: number }>();
  const close = (key: string, at: number) => {
    const stack = open.get(key);
    if (!stack || stack.head >= stack.starts.length) return;
    const start = stack.starts[stack.head++];
    if (stack.head === stack.starts.length) open.delete(key);
    if (start == null || at <= start) return;
    const [channelText, midiText] = key.split(":");
    into.push({
      start,
      end: at,
      midi: Number(midiText),
      track: trackIndex,
      channel: Number(channelText),
    });
  };

  while (offset < end) {
    const delta = readVarLen(data, offset, end);
    offset = delta.offset;
    tick += delta.value;
    if (tick / division > 1_000_000) throw new Error("MIDI 时间跨度过大，请分段导入");
    if (offset >= end) throw invalidMidi();
    const byte = data[offset];
    if (byte >= 0x80) {
      status = byte;
      offset += 1;
    }
    if (status === 0xff) {
      if (byte < 0x80 || offset >= end) throw invalidMidi();
      const type = data[offset];
      offset += 1;
      const len = readVarLen(data, offset, end);
      offset = len.offset;
      if (offset + len.value > end) throw invalidMidi();
      const payload = data.subarray(offset, offset + len.value);
      offset += len.value;
      status = 0;
      if (type === 0x2f) {
        if (payload.length !== 0 || offset !== end) throw invalidMidi();
        ended = true;
        break;
      }
      if ((type === 0x51 && payload.length !== 3) ||
          (type === 0x58 && payload.length !== 4) ||
          (type === 0x59 && payload.length !== 2)) throw invalidMidi();
      const sf = payload[0] > 127 ? payload[0] - 256 : payload[0];
      if ((type === 0x51 && !(payload[0] || payload[1] || payload[2])) ||
          (type === 0x58 && (!payload[0] || payload[1] > 7)) ||
          (type === 0x59 && (sf < -7 || sf > 7 || payload[1] > 1))) throw invalidMidi();
      const at = tick / division;
      if (type === 0x51) changes.push({ at, bpm: clampChangeBpm(60_000_000 / ((payload[0] << 16) | (payload[1] << 8) | payload[2])) });
      if (type === 0x58) changes.push({ at, beats: clampChangeBeats(payload[0]), beatUnit: changeBeatUnit(2 ** payload[1]) });
      if (type === 0x59) changes.push({ at, key: KEY_NAMES[((sf * 7 + (payload[1] ? 9 : 0)) % 12 + 12) % 12], mode: payload[1] ? 'minor' : 'major' });
      if (type === 0x51 && tick < tempo.tick) {
        tempo.micro = (payload[0] << 16) | (payload[1] << 8) | payload[2];
        tempo.tick = tick;
      } else if (type === 0x58 && tick < meter.tick) {
        meter.tick = tick;
        meter.beats = payload[0];
        const pow = payload[1];
        meter.beatUnit = 2 ** pow || 4;
      } else if (type === 0x59 && tick < key.tick) {
        key.value = { key: KEY_NAMES[((sf * 7 + (payload[1] ? 9 : 0)) % 12 + 12) % 12],
          mode: payload[1] ? "minor" : "major" };
        key.tick = tick;
      } else if (type === 0x05 && payload.length) {
        extras.lyrics = true;
      } else if (type === 0x03 || type === 0x01 || type === 0x04) {
        const text = new TextDecoder().decode(payload).trim();
        if (text) {
          if ((type === 0x03 || type === 0x01) && !title.value) title.value = text;
          if (type === 0x03 && !trackName) trackName = text;
          if (type === 0x04 && !instrumentName) instrumentName = text;
        }
      }
      continue;
    }
    if (status === 0xf0 || status === 0xf7) {
      const len = readVarLen(data, offset, end);
      offset = len.offset + len.value;
      if (offset > end) throw invalidMidi();
      status = 0;
      continue;
    }
    if (status < 0x80 || status >= 0xf0) throw invalidMidi();
    const kind = status & 0xf0;
    const channel = status & 0x0f;
    const needsTwo =
      kind === 0x80 || kind === 0x90 || kind === 0xa0 || kind === 0xb0 || kind === 0xe0;
    if (offset + (needsTwo ? 2 : 1) > end || data[offset] >= 128 ||
        (needsTwo && data[offset + 1] >= 128)) throw invalidMidi();
    const data1 = data[offset];
    offset += 1;
    const data2 = needsTwo ? (data[offset] ?? 0) : 0;
    if (needsTwo) offset += 1;
    if (channel === 9) {
      if (kind === 0x90 && data2 > 0) extras.drums = true;
      continue;
    }
    if (kind === 0xc0 && tick === 0) programs[`${trackIndex}:${channel}`] = data1;
    if (kind === 0xb0 && (data1 === 64 || data1 === 66 || data1 === 67) && data2 >= 64) extras.pedal = true;
    if (kind === 0xe0 && (data1 !== 0 || data2 !== 64)) extras.bend = true;
    if (kind === 0x90 && data2 > 0) {
      extras.velocityLow = Math.min(extras.velocityLow, data2);
      extras.velocityHigh = Math.max(extras.velocityHigh, data2);
    }
    if (kind === 0x90 && data2 > 0) {
      const key = `${channel}:${data1}`;
      const stack = open.get(key) ?? { starts: [], head: 0 };
      stack.starts.push(tick);
      open.set(key, stack);
    } else if (kind === 0x80 || (kind === 0x90 && data2 === 0)) {
      close(`${channel}:${data1}`, tick);
    }
  }
  if (!ended) throw invalidMidi();
  endTicks[trackIndex] = tick;
  // Unmatched note-ons have no reliable duration: discard them.
  return trackName || instrumentName;
}

/** Things a MIDI file carries that the Score cannot hold; listed after import, never silently flattened. */
export type MidiExtras = {
  pedal: boolean;
  bend: boolean;
  lyrics: boolean;
  drums: boolean;
  velocityLow: number;
  velocityHigh: number;
};

type MidiFile = {
  programs: Record<string, number>;
  extras: MidiExtras;
  changes: ScoreChange[];
  division: number;
  notes: RawNote[];
  tempoMicro: number | null;
  beats: number;
  beatUnit: number;
  title: string | null;
  names: (string | null)[];
  endTicks: number[];
  key: Pick<Score, "key" | "mode"> | null;
};

function readMidiFile(data: Uint8Array): MidiFile {
  if (data.length > MAX_MIDI_BYTES) throw new Error("MIDI 文件过大，请使用不超过 16 MB 的文件");
  if (data.length < 14 || String.fromCharCode(data[0], data[1], data[2], data[3]) !== "MThd") {
    throw new Error("这不是 MIDI 文件");
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const headerLength = view.getUint32(4);
  if (headerLength < 6 || 8 + headerLength > data.length) throw new Error("这不是 MIDI 文件");
  const format = view.getUint16(8);
  if (format > 1) throw new Error("暂只支持 Format 0 / 1 MIDI");
  const division = view.getUint16(12);
  if (!division) throw new Error("MIDI 每拍刻度无效");
  if (division & 0x8000) throw new Error("这种时间格式的 MIDI 先不支持");
  const trackCount = view.getUint16(10);
  if (!trackCount || (format === 0 && trackCount !== 1)) throw invalidMidi();
  let offset = 8 + headerLength;
  const notes: RawNote[] = [];
  const changes: ScoreChange[] = [];
  const tempo = { micro: null as number | null, tick: Infinity };
  const key = { value: null as Pick<Score, "key" | "mode"> | null, tick: Infinity };
  const meter = { beats: 4, beatUnit: 4, tick: Infinity };
  const title = { value: null as string | null };
  const names: (string | null)[] = [];
  const endTicks: number[] = [];
  const programs: Record<string, number> = {};
  const extras: MidiExtras = { pedal: false, bend: false, lyrics: false, drums: false, velocityLow: 128, velocityHigh: -1 };

  for (let track = 0; track < trackCount; track += 1) {
    if (offset + 8 > data.length) throw invalidMidi();
    const id = String.fromCharCode(
      data[offset],
      data[offset + 1],
      data[offset + 2],
      data[offset + 3],
    );
    const length = view.getUint32(offset + 4);
    offset += 8;
    const end = offset + length;
    if (id !== "MTrk" || end > data.length) throw invalidMidi();
    names[track] =
      id === "MTrk" ? parseTrack(data, offset, end, track, notes, tempo, meter, title, key, division, changes, extras, endTicks, programs) : null;
    offset = end;
  }

  if (offset !== data.length) throw invalidMidi();

  return {
    programs,
    extras,
    division,
    notes,
    changes: canonicalChanges(changes).filter(c => c.at > 0),
    tempoMicro: tempo.micro,
    beats: meter.beats,
    beatUnit: meter.beatUnit,
    title: title.value,
    names,
    endTicks,
    key: key.value,
  };
}

export function listMidiVoices(data: Uint8Array): MidiVoice[] {
  const file = readMidiFile(data);
  const groups = new Map<
    string,
    { track: number; channel: number; noteCount: number; low: number; high: number }
  >();
  for (const note of file.notes) {
    const key = `${note.track}:${note.channel}`;
    const group = groups.get(key);
    if (!group) {
      groups.set(key, {
        track: note.track,
        channel: note.channel,
        noteCount: 1,
        low: note.midi,
        high: note.midi,
      });
      continue;
    }
    group.noteCount += 1;
    if (note.midi < group.low) group.low = note.midi;
    if (note.midi > group.high) group.high = note.midi;
  }
  return [...groups.values()]
    .sort((a, b) => a.track - b.track || a.channel - b.channel)
    .map((group) => ({
      track: group.track,
      channel: group.channel,
      name: file.names[group.track] ?? null,
      ...(file.programs[`${group.track}:${group.channel}`] !== undefined ? { program: file.programs[`${group.track}:${group.channel}`] } : {}),
      noteCount: group.noteCount,
      low: group.low,
      high: group.high,
    }));
}

function buildScore(
  raw: RawNote[],
  division: number,
  tempoMicro: number | null,
  beatsIn: number,
  beatUnitIn: number,
  title: string | null,
  fallbackTitle: string,
  explicitKey: Pick<Score, "key" | "mode"> | null,
  changes: ScoreChange[],
): Score {
  if (!raw.length) throw new Error("文件里没有音符（打击乐通道 10 已跳过）");

  raw.sort((a, b) => a.start - b.start || b.midi - a.midi);
  const clusters: RawNote[][] = [];
  for (const note of raw) {
    const last = clusters[clusters.length - 1];
    if (last && Math.abs(note.start - last[0].start) <= Math.max(2, division / 64)) last.push(note);
    else clusters.push([note]);
  }

  const grid = division / 4;
  const snap = (tick: number) => Math.round(tick / grid) * grid;
  const notes: ScoreNote[] = [];
  let cursor = 0;
  for (const cluster of clusters) {
    const start = Math.max(cursor, snap(cluster[0].start));
    let clusterEnd = cluster[0].end;
    for (const note of cluster) if (note.end > clusterEnd) clusterEnd = note.end;
    const end = Math.max(start + grid, snap(clusterEnd));
    if (start - cursor >= grid) {
      notes.push({ pitches: [], dur: (start - cursor) / division });
    }
    const pitches = [...cluster]
      .sort((a, b) => b.midi - a.midi)
      .slice(0, 4)
      .map((note) => note.midi)
      .sort((a, b) => a - b);
    notes.push({ pitches, dur: (end - start) / division });
    cursor = end;
  }

  const bpm = tempoMicro ? Math.round(60_000_000 / tempoMicro) : 96;
  const guessed = explicitKey ?? guessKey(notes);
  const midis: number[] = [];
  let highest = -1;
  for (const note of notes) {
    for (const pitch of note.pitches) {
      midis.push(pitch);
      if (pitch > highest) highest = pitch;
    }
  }
  const beatUnit = [2, 4, 8, 16].includes(beatUnitIn) ? beatUnitIn : 4;
  return {
    changes,
    title: title || fallbackTitle,
    bpm: Math.min(220, Math.max(40, bpm)),
    beats: Math.min(12, Math.max(1, beatsIn)),
    beatUnit,
    key: isKeyName(guessed.key) ? guessed.key : "C",
    mode: guessed.mode,
    clef: highest >= 0 && highest < 55 ? "bass" : "treble",
    tonicOctave: inferTonicOctave(midis, guessed.key),
    notes,
  };
}

function markPianoImport(score: Score, file: MidiFile, raw: RawNote[]): Score {
  if (raw.length && raw.every(note => {
    const program = file.programs[`${note.track}:${note.channel}`];
    return program !== undefined && program >= 0 && program <= 7;
  })) score.staffInstrument = "piano";
  return score;
}

export function midiToScore(
  data: Uint8Array,
  fallbackTitle: string,
  voice?: { track: number; channel: number },
): Score {
  const file = readMidiFile(data);
  const raw = voice
    ? file.notes.filter((note) => note.track === voice.track && note.channel === voice.channel)
    : file.notes;
  return markPianoImport(buildScore(
    raw,
    file.division,
    file.tempoMicro,
    file.beats,
    file.beatUnit,
    file.title,
    fallbackTitle,
    file.key,
    file.changes,
  ), file, raw);
}

/** Enhanced import is explicit; legacy midiToScore and track selection stay compatible. */
export function previewMidiImport(
  data: Uint8Array,
  fallbackTitle: string,
  options: {
    hands?: boolean | "auto";
    voice?: { track: number; channel: number };
    grid?: 0.25 | 0.125;
  } = {},
): { score: Score; notice: string; hands: boolean; losses: string[] } {
  const file = readMidiFile(data);
  if (!file.notes.length) throw new Error("文件里没有音符（打击乐通道 10 已跳过）");
  const voices = listMidiVoices(data);
  let right: MidiVoice | undefined, left: MidiVoice | undefined;
  let downgradeReason = "";
  if (options.hands) {
    const side = (v: MidiVoice) => {
      const name = v.name ?? "";
      const r = /(?:\bRH\b|\bRight\b|右手)/i.test(name);
      const l = /(?:\bLH\b|\bLeft\b|左手)/i.test(name);
      return r && l ? "conflict" : r ? "right" : l ? "left" : null;
    };
    if (voices.some((v) => side(v) === "conflict")) {
      downgradeReason = "左右手标记冲突，";
    } else if (voices.length === 2) {
      right = voices.find((v) => side(v) === "right");
      left = voices.find((v) => side(v) === "left");
      if (!right && !left) {
        const sorted = [...voices].sort((a, b) => a.low - b.low);
        if (sorted[0].high + 7 <= sorted[1].low) [left, right] = sorted;
      }
      if (right && left && left.high + 7 > right.low) {
        right = left = undefined;
        downgradeReason = "双手音域交错或间隔不足，";
      }
    }
  }
  const mapped = !!right && !!left;
  const selected = mapped ? right! : (options.voice ?? voices[0]);
  const line = (v: { track: number; channel: number }) =>
    file.notes.filter((n) => n.track === v.track && n.channel === v.channel);
  const raw = line(selected);
  const score = buildScore(
    [...raw],
    file.division,
    file.tempoMicro,
    file.beats,
    file.beatUnit,
    file.title,
    fallbackTitle,
    file.key,
    file.changes,
  );
  markPianoImport(score, file, mapped ? [...raw, ...line(left!)] : raw);
  const bar = (score.beats * 4) / score.beatUnit;
  const upper = quantizeMidi(raw, file.division, bar, options.grid, score);
  score.notes = upper.notes;
  const notices = [quantizeNotice(upper.report)];
  const reports = [upper.report];
  if (mapped) {
    const lower = quantizeMidi(line(left!), file.division, bar, options.grid, score);
    reports.push(lower.report);
    score.voice2 = lower.notes;
    notices.unshift("双手导入：右手放入声部一，左手放入声部二，将替换两个声部。");
    notices.push("左手：" + quantizeNotice(lower.report));
  } else {
    notices.unshift(
      options.hands
        ? `${downgradeReason}无法可靠识别双手，已降级为所选单声部，放入正在改的声部。`
        : "增强量化后放入正在改的声部。",
    );
    if (voices.length > 1) notices.push(`其余 ${voices.length - 1} 个声部未导入。`);
  }
  return { score, notice: notices.join(" "), hands: mapped, losses: lossesOf(file.extras, voices.length - (mapped ? 2 : 1), reports) };
}

function lossesOf(extras: MidiExtras, skippedVoices: number, reports: QuantizeReport[]): string[] {
  const out: string[] = [];
  if (skippedVoices > 0) out.push(`其余 ${skippedVoices} 个声部（一次只导入一条，或左右手两条）`);
  if (extras.drums) out.push("打击乐通道 10");
  if (extras.pedal) out.push("踏板（延音、柔音踏板）");
  if (extras.bend) out.push("弯音（滑音）");
  if (extras.lyrics) out.push("MIDI 内嵌歌词");
  if (extras.velocityHigh - extras.velocityLow >= 8) out.push("按键轻重（力度变化）");
  const discarded = reports.reduce((n, r) => n + r.discarded, 0);
  const overlaps = reports.reduce((n, r) => n + r.overlaps, 0);
  if (discarded) out.push(`量化时丢弃的 ${discarded} 个音`);
  if (overlaps) out.push(`重叠截短 ${overlaps} 处`);
  return out;
}

/** Loss list for the plain track pick (no quantize preview). */
export function midiLosses(data: Uint8Array, voice: { track: number; channel: number }): string[] {
  const file = readMidiFile(data);
  const voices = listMidiVoices(data);
  const out = lossesOf(file.extras, voices.length - 1, []);
  const raw = file.notes.filter((n) => n.track === voice.track && n.channel === voice.channel);
  const starts = new Map<number, number>();
  for (const n of raw) starts.set(n.start, (starts.get(n.start) ?? 0) + 1);
  if ([...starts.values()].some((c) => c > 4)) out.push("同时响超过 4 个音的和弦音");
  return out;
}

/** Full independent track/channel import; uses the same strict reader as legacy import. */
export function previewMidiVoices(data: Uint8Array, fallbackTitle: string): { score: Score; notice: string; hands: boolean; losses: string[] } {
  const file = readMidiFile(data);
  const choices = listMidiVoices(data);
  if (!choices.length) throw new Error("文件里没有音符（打击乐通道 10 已跳过）");
  const ownMulti = file.names.some(n => /^谱线声部 \d+$/.test(n ?? ""));
  if (ownMulti) file.names.forEach((name, track) => {
    if ((track === 0 || name === "声部二" || /^谱线声部 \d+$/.test(name ?? "")) && !choices.some(v => v.track === track)) {
      choices.push({ track, channel: 0, name, noteCount: 0, low: 0, high: 0 });
    }
  });
  choices.sort((a,b) => a.track-b.track || a.channel-b.channel);
  if (choices.length > 16) throw new Error("旋律声部超过十六个，请先选择需要的音轨。");
  const score = buildScore([...file.notes], file.division, file.tempoMicro, file.beats, file.beatUnit, file.title, fallbackTitle, file.key, file.changes);
  const losses = new Set<string>(lossesOf(file.extras, 0, []));
  const voices = choices.map(choice => {
    const raw = file.notes.filter(n => n.track === choice.track && n.channel === choice.channel);
    const events = new Map<number, { pitch: number; delta: number }[]>();
    const push = (tick: number, pitch: number, delta: number) => { const list = events.get(tick) ?? []; list.push({ pitch, delta }); events.set(tick, list); };
    for (const n of raw) { push(n.start,n.midi,1); push(n.end,n.midi,-1); }
    const end = file.endTicks[choice.track] ?? 0;
    if (!events.has(0)) events.set(0,[]);
    if (!events.has(end)) events.set(end,[]);
    const times = [...events.keys()].sort((a,b) => a-b);
    const active = new Map<number,number>();
    const notes: ScoreNote[] = [];
    for (let i=0;i<times.length-1;i++) {
      const at = times[i]!;
      for (const e of events.get(at)!) { const count = (active.get(e.pitch) ?? 0) + e.delta; if (count > 0) active.set(e.pitch,count); else active.delete(e.pitch); }
      let pitches = [...active.keys()].sort((a,b) => a-b);
      if (pitches.length > 8) { pitches = pitches.slice(0,8); losses.add("超过八音的和弦仅保留最低八音。"); }
      if (pitches.some(p => p < 21 || p > 108)) losses.add("钢琴音域外的音高已略过。");
      pitches = pitches.filter(p => p >= 21 && p <= 108);
      const dur = (times[i+1]! - at) / file.division;
      if (dur > 0) notes.push({ pitches, dur });
    }
    // Overlapping note lengths require split chord events in the current Score model.
    const ordered = [...raw].sort((a,b) => a.start-b.start || a.end-b.end);
    let activeUntil = 0, previousStart = -1, previousEnd = -1, split = false;
    for (const n of ordered) {
      if ((n.start !== previousStart && n.start < activeUntil) || (n.start === previousStart && n.end !== previousEnd)) split = true;
      activeUntil = Math.max(activeUntil, n.end); previousStart = n.start; previousEnd = n.end;
    }
    if (split) losses.add("轨内交叠音按起止点拆成和弦，持续音可能重新起音。");
    return notes;
  });
  markPianoImport(score, file, file.notes);
  score.notes = voices[0]!;
  delete score.voice2; delete score.extraVoices;
  if (voices.length > 1) score.voice2 = voices[1];
  if (voices.length > 2) score.extraVoices = voices.slice(2);
  return { score, hands: true, losses: [...losses], notice: `已预览 ${voices.length} 个独立声部，保留原始 MIDI 时值。确认后整谱替换，可撤销。` };
}
