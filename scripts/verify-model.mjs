import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import * as tf from '@tensorflow/tfjs';
import { BasicPitch } from '@spotify/basic-pitch';
import { preparePianoWindow } from '../src/audio-signal.ts';

const json = JSON.parse(await readFile(new URL('../public/model/model.json', import.meta.url), 'utf8'));
const weights = await readFile(new URL('../public/model/group1-shard1of1.bin', import.meta.url));
await tf.setBackend('cpu');
const model = await tf.loadGraphModel(tf.io.fromMemory({ modelTopology: json.modelTopology, weightSpecs: json.weightsManifest.flatMap(group => group.weights), weightData: weights.buffer.slice(weights.byteOffset, weights.byteOffset + weights.byteLength) }));
const basic = new BasicPitch(Promise.resolve(model));
const samples = new Float32Array(44100);
for (let i = 0; i < samples.length; i++) {
  const time = i / 22050;
  if (time < .15 || time > 1.8) continue;
  const age = time - .15;
  const envelope = Math.min(1, age * 120) * Math.exp(-age * 1.4);
  for (const midi of [60, 64, 67]) {
    const f = 440 * 2 ** ((midi - 69) / 12);
    for (let partial = 1; partial <= 6; partial++) samples[i] += .07 / (partial ** 1.4) * envelope * Math.sin(2 * Math.PI * f * partial * time);
  }
}
const run = async input => {
  const frames = [], onsets = [];
  tf.engine().startScope();
  try { await basic.evaluateModel(input, (f, o) => { frames.push(...f); onsets.push(...o); }, () => {}); }
  finally { tf.engine().endScope(); }
  return { frames, onsets };
};
const silent = await run(new Float32Array(44100));
assert.ok(silent.frames.length > 100, 'model must produce frames');
assert.ok(Math.max(...silent.frames.flat()) < .32, 'silence must not be recognized as notes');
const baseline = tf.memory().numTensors;
const result = await run(samples);
const attacks = [60,64,67].map(midi => result.onsets.findIndex((frame,i) => frame[midi-21]>=.35 && (i===0 || result.onsets[i-1][midi-21]<.35)) * 256/22050);
assert.ok(attacks.every(at=>at>=0) && Math.max(...attacks)-Math.min(...attacks)<=.18,'synthetic block chord attacks must satisfy simultaneous timing');
const recognized = Array.from({ length: 88 }, (_, i) => ({ midi: i + 21, strength: Math.max(...result.frames.map(frame => frame[i])), onset: Math.max(...result.onsets.map(frame => frame[i])) })).filter(n => n.strength >= .32 && n.onset >= .3);
let consecutive=0, longest=0;for(const frame of result.frames){const active=frame.map((probability,i)=>({probability,midi:i+21})).filter(n=>n.probability>=.32&&recognized.some(r=>r.midi===n.midi)).map(n=>n.midi);consecutive=JSON.stringify(active)===JSON.stringify([60,64,67])?consecutive+1:0;longest=Math.max(longest,consecutive);}assert.ok(longest>=10,'correct C major must be sustained, despite transient harmonic artifacts');
assert.equal(tf.memory().numTensors, baseline, 'repeated inference must not leak intermediate tensors');
const quiet = samples.map(n => n * .025);
const quietResult = await run(preparePianoWindow(quiet));
for (const midi of [60, 64, 67]) {
  assert.ok(Math.max(...quietResult.frames.map(frame => frame[midi - 21])) >= .32, `quiet chord must retain MIDI ${midi}`);
  assert.ok(Math.max(...quietResult.onsets.map(frame => frame[midi - 21])) >= .3, `quiet chord must retain onset ${midi}`);
}
let seed = 12345;
const noise = Float32Array.from({ length: 44100 }, () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return .0003 * (seed / 2 ** 31 - 1); });
const noiseResult = await run(preparePianoWindow(noise));
assert.ok(!Array.from({ length: 88 }, (_, n) => n).some(n => Math.max(...noiseResult.frames.map(f => f[n])) >= .32 && Math.max(...noiseResult.onsets.map(o => o[n])) >= .3), 'low-level background noise must not pass note confidence and attack thresholds');
console.log('PASS: quiet chord recognized after bounded gain; silence and low-level noise rejected.');
console.log('PASS: bundled model loads, rejects silence, transcribes synthetic C major, and releases tensors.');
console.log(recognized);
model.dispose();
