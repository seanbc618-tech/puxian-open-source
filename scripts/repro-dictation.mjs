// Local only: node --experimental-strip-types scripts/repro-dictation.mjs path/to/audio.mp3
// Requires ffmpeg/ffprobe. No audio files are written or uploaded.
import { execFileSync } from 'node:child_process';
import { transcribeBuffer, mixToMono, estimateBpm, quantizeDetected } from '../src/lib/music/audio.ts';
const file = process.argv[2];
if (!file) throw new Error('Provide a local audio path');
const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=sample_rate,channels', '-of', 'json', file], { encoding: 'utf8' }));
const rate = Number(probe.streams[0].sample_rate);
const count = probe.streams[0].channels;
const bytes = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-map', '0:a:0', '-f', 'f32le', '-acodec', 'pcm_f32le', 'pipe:1'], { maxBuffer: 512 * 1024 * 1024 });
const length = bytes.length / 4 / count;
const channels = Array.from({ length: count }, (_, channel) => Float32Array.from({ length }, (_, i) => bytes.readFloatLE((i * count + channel) * 4)));
const buffer = { length, numberOfChannels: count, getChannelData: c => channels[c] };
const start = performance.now();
const take = transcribeBuffer(buffer, rate);
const bpm = estimateBpm(take.notes);
console.log(JSON.stringify({ sampleRate: rate, channels: count, duration: length / rate, analyzedSeconds: take.analyzedSeconds, noteCount: take.notes.length, quantizedNoteCount: quantizeDetected(take.notes, bpm, 0.25).filter(n => n.pitches.length).length, bpm, kind: take.kind, notice: take.notice, lastNote: take.notes.at(-1), elapsedSeconds: (performance.now() - start) / 1000, mixToMonoSeconds: mixToMono(buffer, rate).length / rate }, null, 2));
