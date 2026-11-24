import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import * as tf from '@tensorflow/tfjs';
import { setWasmPaths } from '@tensorflow/tfjs-backend-wasm';
import { evaluatePianoWindow } from '../src/piano-model';
import { validatePianoPitches } from '../src/piano-spectrum';
import { filterPianoOvertones, PianoOvertoneMemory } from '../src/piano-overtones';
import { decodePianoFrames, limitPianoTail } from '../src/audio-decoder';
import { preparePianoWindow } from '../src/audio-signal';
import { Evaluator } from '../src/evaluation';
import { estimateNoiseProfile,suppressPianoNoise } from '../src/piano-noise';
import { shortPiano,streetNoise,mixPianoNoise } from './fixtures/piano-audio';
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
  let overtoneMemory: PianoOvertoneMemory;
  beforeEach(()=>{overtoneMemory=new PianoOvertoneMemory();});
  beforeAll(async () => {
    setWasmPaths(resolve('public/wasm') + '/');
    await tf.setBackend('wasm'); await tf.ready();
    const json = JSON.parse(await readFile('public/model/model.json', 'utf8'));
    const weights = await readFile('public/model/group1-shard1of1.bin');
    model = await tf.loadGraphModel(tf.io.fromMemory({ modelTopology: json.modelTopology, weightSpecs: json.weightsManifest.flatMap((group: {weights: tf.io.WeightsManifestEntry[]}) => group.weights), weightData: weights.buffer.slice(weights.byteOffset, weights.byteOffset + weights.byteLength) }));
    await evaluatePianoWindow(model, new Float32Array(MIN_ANALYSIS_SAMPLES));
  });
  afterAll(() => model?.dispose());
  async function recognize(samples:Float32Array,final=false,start=0){
    const result=await evaluatePianoWindow(model,samples,final);
    validatePianoPitches(samples,result.frames,result.onsets);
    return filterPianoOvertones(result.frames,result.onsets,samples,overtoneMemory,start);
  }
  it.each([.25,.5,1])('keeps a genuine added upper octave at relative amplitude %s', async amplitude => {
    const base=piano([60,64,67]),upper=piano([72]);
    const input=base.map((value,i)=>value+upper[i]*amplitude);
    const evaluator=new Evaluator([{label:'C',notes:[60,64,67],left:[],right:[60,64,67],requireTogether:true}]);
    let octaveSeen=false;
    for(let end=MIN_ANALYSIS_SAMPLES;end<=30000;end+=ANALYSIS_HOP_SAMPLES){
      const start=Math.max(0,end-MAX_ANALYSIS_SAMPLES);
      const result=await recognize(preparePianoWindow(input.slice(start,end)),false,start/22050);
      for(const frame of decodePianoFrames(result.frames,result.onsets,start/22050)){
        octaveSeen ||= frame.notes.includes(72);
        evaluator.push(frame);
      }
    }
    expect(octaveSeen).toBe(true);expect(evaluator.index).toBe(0);
  });
  it.each([.25,.5,1])('preserves a short independently played octave at amplitude %s', async amplitude => {
    const base=shortPiano([60,64,67],.12),upper=shortPiano([72],.12);
    const input=base.map((value,i)=>value+upper[i]*amplitude);
    let before=false,after=false;
    for(let end=MIN_ANALYSIS_SAMPLES;end<=22050;end+=ANALYSIS_HOP_SAMPLES){
      const samples=preparePianoWindow(input.slice(0,end));
      const result=await evaluatePianoWindow(model,samples);
      validatePianoPitches(samples,result.frames,result.onsets);
      before ||= decodePianoFrames(result.frames,result.onsets,0).some(frame=>frame.notes.includes(72));
      filterPianoOvertones(result.frames,result.onsets,samples,overtoneMemory,0);
      after ||= decodePianoFrames(result.frames,result.onsets,0).some(frame=>frame.notes.includes(72));
    }
    expect(before).toBe(true);expect(after).toBe(true);
  });
  it.each([[60, 64, 67], [66, 70, 73]])('accepts quiet chord %j through consecutive short windows', async (...pitches) => {
    const input = piano(pitches);
    const evaluator = new Evaluator([{ label: 'test', notes: pitches, left: [], right: pitches, requireTogether: true }]);
    let completedAt = Infinity;
    for (let end = MIN_ANALYSIS_SAMPLES; end <= 22050; end += ANALYSIS_HOP_SAMPLES) {
      const start = Math.max(0, end - MAX_ANALYSIS_SAMPLES);
      const prediction = await recognize(preparePianoWindow(input.slice(start, end)),false,start/22050);
      for (const frame of decodePianoFrames(prediction.frames, prediction.onsets, start / 22050)) evaluator.push(frame);
      if (evaluator.index === 1) { completedAt = end / 22050; break; }
    }
    expect(completedAt).toBeLessThan(.8);
  });
  it('follows sequential notes with overlapping piano decay on the real model',async()=>{
    const notes=[60,64,67],input=piano(notes,true);
    const evaluator=new Evaluator(notes.map(note=>({label:'C',notes:[note],left:[],right:[note]})));
    for(let end=MIN_ANALYSIS_SAMPLES;end<=input.length;end+=ANALYSIS_HOP_SAMPLES){
      const start=Math.max(0,end-MAX_ANALYSIS_SAMPLES);
      const result=await recognize(preparePianoWindow(input.slice(start,end)),false,start/22050);
      for(const frame of decodePianoFrames(result.frames,result.onsets,start/22050))evaluator.push(frame);
      if(evaluator.index===3)break;
    }
    expect(evaluator.index).toBe(3);
  });
  it('keeps rolled chords incorrect across overlapping live windows', async () => {
    const pitches = [60, 64, 67], input = piano(pitches, true);
    const evaluator = new Evaluator([{ label: 'C', notes: pitches, left: [], right: pitches, requireTogether: true }]);
    for (let end = MIN_ANALYSIS_SAMPLES; end <= 38000; end += ANALYSIS_HOP_SAMPLES) {
      const start = Math.max(0, end - MAX_ANALYSIS_SAMPLES);
      const prediction = await recognize(preparePianoWindow(input.slice(start, end)),false,start/22050);
      for (const frame of decodePianoFrames(prediction.frames, prediction.onsets, start / 22050)) evaluator.push(frame);
    }
    expect(evaluator.index).toBe(0);
  });
  it.each([{pitches:[66,70,73],onset:.94, accepted:true},{pitches:[66,70,73],onset:1.12, accepted:false},{pitches:[60,64,67],onset:.84, accepted:true},{pitches:[60,64,67],onset:.94, accepted:true},{pitches:[60,64,67],onset:1.12, accepted:false}])('handles pitches $pitches at $onset seconds around a 1-second deadline', async ({pitches,onset,accepted}) => {
    const input = piano(pitches,false,onset);
    const evaluator = new Evaluator([{label:'G♭',notes:pitches,left:[],right:pitches,requireTogether:true}]);
    const before = await recognize(preparePianoWindow(input.slice(0,22050)));
    for (const frame of decodePianoFrames(before.frames,before.onsets,0)) evaluator.push(frame);
    expect(evaluator.index).toBe(0);
    const end=Math.floor(1.5*22050), start=Math.max(0,end-MAX_ANALYSIS_SAMPLES);
    const final = await recognize(preparePianoWindow(input.slice(start,end)),true,start/22050);
    for (const frame of limitPianoTail(decodePianoFrames(final.frames,final.onsets,start/22050),1,new Set())) evaluator.push(frame);
    expect(evaluator.index===1).toBe(accepted);
    if(!accepted) expect(evaluator.feedback().type).toBe('unconfirmed');
  });
  const noiseProfile=estimateNoiseProfile(streetNoise(44100,.003,247));
  async function recognizeNoisy(input:Float32Array,expected:number[],profile=noiseProfile){
    const evaluator=new Evaluator([{label:'test',notes:expected,left:[],right:expected,requireTogether:expected.length>1}]);
    for(let end=MIN_ANALYSIS_SAMPLES;end<=input.length;end+=ANALYSIS_HOP_SAMPLES){
      const start=Math.max(0,end-MAX_ANALYSIS_SAMPLES);
      const cleaned=suppressPianoNoise(input.slice(start,end),profile);
      const prediction=await recognize(preparePianoWindow(cleaned),false,start/22050);
      for(const frame of decodePianoFrames(prediction.frames,prediction.onsets,start/22050))evaluator.push(frame);
      if(evaluator.index===1)return true;
    }
    return false;
  }
  it.each([{notes:[60,64,67],hold:.08},{notes:[60,64,67],hold:.12},{notes:[66,70,73],hold:.08},{notes:[66,70,73],hold:.12},{notes:[69],hold:.08},{notes:[66],hold:.18}])('accepts a $hold s piano gesture $notes with background noise',async({notes,hold})=>{
    const input=mixPianoNoise(shortPiano(notes,hold),streetNoise(22050));
    expect(await recognizeNoisy(input,notes)).toBe(true);
  });
  it.each([[60,64,66],[60,64,67,70],[60,64,67,72]])('does not turn a wrong chord %j into the target after filtering',async(...notes)=>{
    const input=mixPianoNoise(shortPiano(notes,.12),streetNoise(22050));
    expect(await recognizeNoisy(input,[60,64,67])).toBe(false);
  });
  it('does not turn a noisy arpeggio into a simultaneous chord',async()=>{
    const notes=[60,64,67],input=mixPianoNoise(shortPiano(notes,.12,.004,true),streetNoise(22050));
    expect(await recognizeNoisy(input,notes)).toBe(false);
  });
  it.each([4,25,63])('does not transcribe independently sampled background %i as notes',async seed=>{
    const cleaned=suppressPianoNoise(streetNoise(16000,.003,seed),noiseProfile);
    const prediction=await recognize(preparePianoWindow(cleaned));
    expect(decodePianoFrames(prediction.frames,prediction.onsets,0).every(frame=>!frame.notes.length)).toBe(true);
  });
  it('rejects a rising traffic-like noise floor without treating it as music',async()=>{
    const noise=streetNoise(16000,.003,64).map((value,i)=>value*(1+2*i/16000));
    const cleaned=suppressPianoNoise(noise,noiseProfile);
    const prediction=await recognize(preparePianoWindow(cleaned));
    expect(decodePianoFrames(prediction.frames,prediction.onsets,0).every(frame=>!frame.notes.length)).toBe(true);
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
