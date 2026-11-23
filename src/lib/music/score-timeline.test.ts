import { test } from 'node:test';
import assert from 'node:assert/strict';
import { midiToScore, previewMidiImport, scoreToMidi } from './midi.ts';
import { scoreToMusicXml, musicXmlToScore } from './musicxml.ts';
import { scoreToJianpuLy } from './jianpu-ly-export.ts';
import { scoreToJianpu } from './jianpu-render.ts';
import { engraveAbc } from './notation.ts';
import { createBlankScore, isScore } from './score-storage.ts';
import { playbackPlan } from './playback.ts';
import { secondsAt, quarterAtSeconds } from './playback-clock.ts';
import { nextBar, remapChangesForNotes, stateAt } from './score-timeline.ts';
import { emptyHistory, rememberHistory, travelHistory } from './history-stack.ts';
import { replaceVoiceAndRemap } from './voices.ts';
import { transposeScore, type Score } from './theory.ts';
import { checkScoreBars } from './bar-check.ts';
const fixture = (): Score => ({ ...createBlankScore(), bpm: 120,
  notes: [{ pitches: [60], dur: 6 }, { pitches: [67], dur: 2 }],
  changes: [ { at: 1, bpm: 60 }, { at: 2.5, beats: 3, beatUnit: 8, key: 'G', mode: 'major' },
    { at: 4, bpm: 180, beats: 2, beatUnit: 4, key: 'A', mode: 'minor' }, { at: 6, bpm: 90, key: 'F', mode: 'major' } ] });

test('MIDI → Score → MIDI / MusicXML 保留变化、长音与音高', () => {
  const score = midiToScore(scoreToMidi(fixture()), 'fixture');
  assert.deepEqual(score.changes, fixture().changes);
  for (const back of [midiToScore(scoreToMidi(score),'back'), musicXmlToScore(scoreToMusicXml(score),'back').score]) {
    assert.deepEqual(back.changes, score.changes);
    assert.deepEqual(back.notes, score.notes);
    assert.equal(back.bpm,120); assert.equal(back.key,'C');
  }
});

test('增强量化按短小节、新拍号和变化点切分，边界不重复', () => {
  const score = previewMidiImport(scoreToMidi(fixture()),'fixture').score;
  assert.deepEqual(score.changes, fixture().changes);
  assert.deepEqual(score.notes.map(n => n.dur), [1,1.5,1.5,2,2]);
  assert.deepEqual(score.notes.map(n => n.pitches), [[60],[60],[60],[60],[67]]);
  assert.equal(nextBar(score,0),2.5); assert.equal(nextBar(score,2.5),4);
  assert.equal(nextBar(score,4),6);
});

test('四分音符速度积分、反算和变拍第一拍一致', () => {
  const score = fixture();
  assert.equal(secondsAt(score,1),.5);
  assert.equal(secondsAt(score,4),3.5);
  assert.ok(Math.abs(secondsAt(score,6)-(3.5+2/3))<1e-9);
  for (const q of [0,.25,1,2.5,4,5,6,8]) assert.ok(Math.abs(quarterAtSeconds(score,secondsAt(score,q))-q)<1e-8);
  const clicks = playbackPlan(score).clicks;
  assert.deepEqual(clicks.map(c => c.quarter),[0,1,2,2.5,3,3.5,4,5,6,7]);
  assert.ok(clicks.filter(c => [0,2.5,4,6].includes(c.quarter)).every(c => c.accent));
  assert.equal(clicks.find(c => c.quarter===3)!.seconds,2.5);
});

test('简谱数据、五线谱及 jly 在变化处有速度、调号和拍号', () => {
  const score = fixture();
  const info = scoreToJianpu(score)[0].info;
  assert.deepEqual(info.tempos!.map(t => t.start),[0,1,4,6]);
  assert.deepEqual(info.timeSignatures!.map(t => t.start),[0,2.5,4]);
  assert.deepEqual(info.keySignatures!.map(t => t.key),[0,7,9,5]);
  const abc = engraveAbc(score).abc;
  for (const mark of ['[Q:1/4=60]','[M:3/8]','[K:G]','[K:Amin]']) assert.ok(abc.includes(mark),abc);
  const jly = scoreToJianpuLy(score);
  for (const mark of ['4=60','3/8','1=G','6=A','2/4','1=F']) assert.ok(jly.text.includes(mark),jly.text);
  assert.match(jly.warnings.join(' '),/短小节/);
});

test('旧草稿无变化表仍可播放；变化表严格验证且移调同步', () => {
  const old = createBlankScore(); old.notes = [{pitches:[60],dur:4}];
  assert.equal(isScore(JSON.parse(JSON.stringify(old))),true);
  assert.equal(playbackPlan(old).clicks.length,4);
  assert.equal(isScore(fixture()),true);
  for (const c of [{at:NaN,bpm:90},{at:0,bpm:90},{at:1,bpm:0},{at:1,beats:0,beatUnit:4},{at:1,key:'Z',mode:'major'},{at:1,beats:3}]) assert.equal(isScore({...old,changes:[c]}),false);
  assert.equal(transposeScore(fixture(),2).changes![1].key,'A');
});

test('开头休止不裁切，元数据偏移与音符一致', () => {
  const score = fixture(); score.notes.unshift({pitches:[],dur:2});
  const back = midiToScore(scoreToMidi(score),'rest');
  assert.deepEqual(back.notes,score.notes); assert.deepEqual(back.changes,score.changes);
});

test('MusicXML 保留非网格 tick、小节中途变化、末音结束及结束后的变化', () => {
  const score = fixture();
  score.changes = [{at:1/480, bpm:80}, {at:2.25,beats:5,beatUnit:8}, {at:8,key:'D',mode:'minor'}, {at:9,bpm:100}];
  const back = musicXmlToScore(scoreToMusicXml(score),'precise').score;
  assert.deepEqual(back.changes,score.changes);
  assert.deepEqual(back.notes,score.notes);
});

test('双声部长度不同仍保留较长声部内的变化及独立音符', () => {
  const score = fixture(); score.voice2 = score.notes; score.notes = [{pitches:[48],dur:2}];
  const back = musicXmlToScore(scoreToMusicXml(score),'two').score;
  assert.deepEqual(back.changes,score.changes);
  assert.deepEqual(back.notes,score.notes); assert.deepEqual(back.voice2,score.voice2);
});

test('变化表范围与 MIDI 导入归一化一致：存储拒绝越界，MusicXML 导入同样收紧', () => {
  const old = createBlankScore(); old.notes = [{pitches:[60],dur:8}];
  for (const c of [{at:1,bpm:40},{at:1,bpm:220},{at:1,beats:12,beatUnit:16},{at:1,beats:1,beatUnit:2}]) assert.equal(isScore({...old,changes:[c]}),true);
  for (const c of [{at:1,bpm:39},{at:1,bpm:221},{at:1,bpm:20},{at:1,bpm:400},{at:1,beats:13,beatUnit:4},{at:1,beats:16,beatUnit:4},{at:1,beats:3,beatUnit:1},{at:1,beats:3,beatUnit:32}]) assert.equal(isScore({...old,changes:[c]}),false);
  const wide: Score = { ...old, changes: [{at:2,bpm:300},{at:4,bpm:25},{at:6,beats:3,beatUnit:4}] };
  const back = musicXmlToScore(scoreToMusicXml(wide),'wide').score;
  assert.deepEqual(back.changes!.map(c => c.bpm).filter(Boolean),[220,40]);
  assert.equal(isScore(back),true);
  assert.equal(isScore(midiToScore(scoreToMidi(wide),'wide')),true);
});

test('删音后 changes.at 随被替换区间移动；双声部不改共享时间轴；撤销还原', () => {
  const score = fixture();
  const dropped = replaceVoiceAndRemap(score, 0, score.notes.slice(0, -1));
  assert.deepEqual(dropped.notes.map(n => n.dur), [6]);
  // last note started at 6; the change at 6 is dropped, earlier marks stay
  assert.deepEqual(dropped.changes, fixture().changes!.filter(c => c.at < 6));
  // Shorten the first note (6→3); the trailing G is a common suffix and keeps the change at its downbeat.
  const mid = replaceVoiceAndRemap(score, 0, [
    { pitches: [60], dur: 3 },
    { pitches: [67], dur: 2 },
  ]);
  assert.deepEqual(mid.changes, [{ at: 3, bpm: 90, key: 'F', mode: 'major' }]);
  const appended = replaceVoiceAndRemap(score, 0, [...score.notes, { pitches: [64], dur: 1 }]);
  assert.deepEqual(appended.changes, score.changes);
  const two = { ...fixture(), voice2: [{ pitches: [48], dur: 8 }] };
  const kept = replaceVoiceAndRemap(two, 0, two.notes.slice(0, -1));
  assert.deepEqual(kept.changes, two.changes);
  const hist = rememberHistory(emptyHistory<Score>(), score);
  const traveled = travelHistory(hist, dropped, 'undo');
  assert.ok(traveled);
  assert.deepEqual(traveled.value.changes, score.changes);
  assert.deepEqual(traveled.value.notes, score.notes);
  const shifted = transposeScore(score, 2);
  assert.equal(shifted.changes![1].key, 'A');
  assert.equal(shifted.changes![1].at, 2.5);
  assert.deepEqual(stateAt(score, 2.5).key, 'G');
  assert.equal('at' in stateAt(score, 2.5), false);
});

test('拍号核对待中途变拍的短小节为完整小节，只报告最后不足的尾巴', () => {
  const complete = { beats: 4, beatUnit: 4, notes: [{ pitches: [60], dur: 1 }, { pitches: [62], dur: 3 }], changes: [{ at: 1, beats: 3, beatUnit: 4 }] };
  assert.deepEqual(checkScoreBars(complete), []);
  const shortTail = { ...complete, notes: [{ pitches: [60], dur: 1 }, { pitches: [62], dur: 2 }] };
  assert.deepEqual(checkScoreBars(shortTail), [{ voice: 0, measure: 2, actual: 2, expected: 3, missing: 1 }]);
});
