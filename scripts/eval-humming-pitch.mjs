// Local PCM only. Run: node --experimental-strip-types scripts/eval-humming-pitch.mjs
import { pathToFileURL } from 'node:url';
// Optional absolute module path permits evaluating the identical corpus against git-show HEAD.
const { transcribeBuffer } = await import(process.argv[2] ? pathToFileURL(process.argv[2]).href : '../src/lib/music/audio.ts');
import { hummingFixture, scoreHumming } from '../src/lib/music/humming-fixture.ts';
const start = performance.now();
const cases = [0.25, 0.85].flatMap(breath => [40, 48, 55, 60, 67].map((base, i) => {
  const { samples, sampleRate, truth } = hummingFixture(base, 731 + i, i % 2 ? 0.002 : 0.025, breath);
  const take = transcribeBuffer({ length: samples.length, numberOfChannels: 1, getChannelData: () => samples }, sampleRate);
  return { base, breath, ...scoreHumming(take.notes, truth), kind: take.kind, notes: take.notes };
}));
const sum = key => cases.reduce((a, c) => a + c[key], 0);
console.log(JSON.stringify({ cases, aggregate: { pitchAccuracy: sum('correct') / sum('total'),
  onsetF1: 2 * sum('matches') / (sum('reference') + sum('detected')),
  matched: sum('matches'), reference: sum('reference'), detected: sum('detected') },
  elapsedSeconds: (performance.now() - start) / 1000 }, null, 2));
