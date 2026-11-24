import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import * as tf from '@tensorflow/tfjs';
import { setWasmPaths } from '@tensorflow/tfjs-backend-wasm';
import { evaluatePianoWindow } from '../src/piano-model';
import { decodePianoFrames, limitPianoTail } from '../src/audio-decoder';
import { preparePianoWindow } from '../src/audio-signal';
import { Evaluator } from '../src/evaluation';
import { ANALYSIS_HOP_SAMPLES, MAX_ANALYSIS_SAMPLES, MIN_ANALYSIS_SAMPLES } from '../src/audio-timing';

function piano(pitches: number[], rolled = false, onset = .15) {
  const samples = new Float32Array(44100);
  for (let i = 0; i < samples.length; i++) for (const [index, midi] of pitches.entries()) {
    const time = i / 22050, age = time - onset - (rolled ? index * .3 : 0);
    if (age < 0) continue;
    const envelope = Math.min(1, age * 8) * Math.exp(-age * 1.4);
    const frequency = 440 * 2 ** ((midi - 69) / 12);
    for (let h = 1; h <= 6; h++) samples[i] += .0035 / h ** 1.4 * envelope * Math.sin(2 * Math.PI * frequency * h * time);
  }
  return samples;
}
describe('streaming piano recognition on the real WASM model', () => {
  let model: tf.GraphModel;
  beforeAll(async () => {
    setWasmPaths(resolve('public/wasm') + '/');
    await tf.setBackend('wasm'); await tf.ready();
    const json = JSON.parse(await readFile('public/model/model.json', 'utf8'));
    const weights = await readFile('public/model/group1-shard1of1.bin');
    model = await tf.loadGraphModel(tf.io.fromMemory({ modelTopology: json.modelTopology, weightSpecs: json.weightsManifest.flatMap((group: {weights: tf.io.WeightsManifestEntry[]}) => group.weights), weightData: weights.buffer.slice(weights.byteOffset, weights.byteOffset + weights.byteLength) }));
    await evaluatePianoWindow(model, new Float32Array(MIN_ANALYSIS_SAMPLES));
  });
  afterAll(() => model?.dispose());
  it.each([[60, 64, 67], [66, 70, 73]])('accepts quiet chord %j through consecutive short windows', async (...pitches) => {
    const input = piano(pitches);
    const evaluator = new Evaluator([{ label: 'test', notes: pitches, left: [], right: pitches, requireTogether: true }]);
    let completedAt = Infinity;
    for (let end = MIN_ANALYSIS_SAMPLES; end <= 22050; end += ANALYSIS_HOP_SAMPLES) {
      const start = Math.max(0, end - MAX_ANALYSIS_SAMPLES);
      const prediction = await evaluatePianoWindow(model, preparePianoWindow(input.slice(start, end)));
      for (const frame of decodePianoFrames(prediction.frames, prediction.onsets, start / 22050)) evaluator.push(frame);
      if (evaluator.index === 1) { completedAt = end / 22050; break; }
    }
    expect(completedAt).toBeLessThan(.8);
  });
  it('keeps rolled chords incorrect across overlapping live windows', async () => {
    const pitches = [60, 64, 67], input = piano(pitches, true);
    const evaluator = new Evaluator([{ label: 'C', notes: pitches, left: [], right: pitches, requireTogether: true }]);
    for (let end = MIN_ANALYSIS_SAMPLES; end <= 38000; end += ANALYSIS_HOP_SAMPLES) {
      const start = Math.max(0, end - MAX_ANALYSIS_SAMPLES);
      const prediction = await evaluatePianoWindow(model, preparePianoWindow(input.slice(start, end)));
      for (const frame of decodePianoFrames(prediction.frames, prediction.onsets, start / 22050)) evaluator.push(frame);
    }
    expect(evaluator.index).toBe(0);
  });
  it.each([{pitches:[66,70,73],onset:.94, accepted:true},{pitches:[66,70,73],onset:1.12, accepted:false},{pitches:[60,64,67],onset:.84, accepted:true},{pitches:[60,64,67],onset:.94, accepted:false},{pitches:[60,64,67],onset:1.12, accepted:false}])('handles pitches $pitches at $onset seconds around a 1-second deadline', async ({pitches,onset,accepted}) => {
    const input = piano(pitches,false,onset);
    const evaluator = new Evaluator([{label:'G♭',notes:pitches,left:[],right:pitches,requireTogether:true}]);
    const before = await evaluatePianoWindow(model, preparePianoWindow(input.slice(0,22050)));
    for (const frame of decodePianoFrames(before.frames,before.onsets,0)) evaluator.push(frame);
    expect(evaluator.index).toBe(0);
    const end=Math.floor(1.5*22050), start=Math.max(0,end-MAX_ANALYSIS_SAMPLES);
    const final = await evaluatePianoWindow(model, preparePianoWindow(input.slice(start,end)),true);
    for (const frame of limitPianoTail(decodePianoFrames(final.frames,final.onsets,start/22050),1,new Set())) evaluator.push(frame);
    expect(evaluator.index===1).toBe(accepted);
    if(!accepted) expect(evaluator.feedback().type).toBe('unconfirmed');
  });
  it('flushes the withheld tail on finalization and releases all intermediate tensors', async () => {
    const input = preparePianoWindow(piano([66]).slice(0, MIN_ANALYSIS_SAMPLES));
    const baseline = tf.memory().numTensors;
    const live = await evaluatePianoWindow(model, input);
    const final = await evaluatePianoWindow(model, input, true);
    expect(final.frames.length - live.frames.length).toBe(15 * 88);
    expect(tf.memory().numTensors).toBe(baseline);
  });
});
