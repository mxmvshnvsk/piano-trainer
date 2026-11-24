import * as tf from '@tensorflow/tfjs';
import { validatePianoPitches } from './piano-spectrum';
import { filterPianoOvertones, PianoOvertoneMemory } from './piano-overtones';
import { setWasmPaths } from '@tensorflow/tfjs-backend-wasm';
import { evaluatePianoWindow } from './piano-model';
import { MIN_ANALYSIS_SAMPLES, MODEL_CONTEXT_FRAMES, MODEL_HOP_SAMPLES } from './audio-timing';
import { suppressPianoNoise } from './piano-noise';
import { MIN_PIANO_RMS, preparePianoWindow, signalLevel } from './audio-signal';

let model: tf.GraphModel;
let sourceBase = '';
const overtoneMemory=new PianoOvertoneMemory();
let captureRevision='';
let loading: Promise<void> | undefined;
async function initialize(base: string) {
  setWasmPaths(new URL('wasm/', base).href);
  const load = async () => {
    // Keep model weights outside the per-inference tensor scope.
    model = await tf.loadGraphModel(new URL('model/model.json', base).href);
    await evaluatePianoWindow(model, new Float32Array(MIN_ANALYSIS_SAMPLES));
  };
  try { await tf.setBackend('wasm'); await tf.ready(); await load(); }
  catch (error) {
    model?.dispose();
    console.warn('Piano WASM unavailable; using CPU', error);
    await tf.setBackend('cpu'); await tf.ready(); await load();
  }
}
self.onmessage = async (event: MessageEvent) => {
  const { type, id, samples, base, start, final = false, noiseProfile = [], inputGain = 1 } = event.data;
  try {
    if (type === 'init') {
      loading ??= initialize(base);
      await loading;
      sourceBase = base;
      if (import.meta.env.DEV && (event.data.pianoGate || event.data.diagnostics)) await (await import('./piano-source-model')).preparePianoSource(base);
      self.postMessage({ type: 'ready', backend: tf.getBackend() });
      return;
    }
    await loading;
    const revision=`${id}:${event.data.revision??0}`;
    if(revision!==captureRevision){captureRevision=revision;overtoneMemory.clear();}
    const cleaned = suppressPianoNoise(samples, noiseProfile, inputGain);
    const noiseReduced=noiseProfile.length>0 && signalLevel(samples).rms>signalLevel(cleaned).rms*2.5;
    const quiet = signalLevel(cleaned).rms < MIN_PIANO_RMS;
    const count = Math.max(0, Math.floor(samples.length / MODEL_HOP_SAMPLES) - (final ? 0 : MODEL_CONTEXT_FRAMES));
    // Keep capture timestamps/release evidence, but do not run the network on
    // a window that normalization would mute anyway.
    const prepared = quiet ? cleaned : preparePianoWindow(cleaned);
    // Source classification happens before pitch interpretation. Keep this
    // experiment opt-in until the user's piano and background are validated.
    const source = import.meta.env.DEV && (event.data.pianoGate || event.data.diagnostics) && !quiet
      ? await (await import('./piano-source-model')).classifyPianoSource(sourceBase, prepared) : undefined;
    const { frames, onsets } = quiet ? { frames: new Float32Array(count * 88), onsets: new Float32Array(count * 88) }
      : await evaluatePianoWindow(model, prepared, final);
    const diagnostics = import.meta.env.DEV && event.data.diagnostics;
    const rawFrames = diagnostics ? frames.slice() : undefined, rawOnsets = diagnostics ? onsets.slice() : undefined;
    if (!quiet) validatePianoPitches(prepared, frames, onsets);
    filterPianoOvertones(frames, onsets, prepared, overtoneMemory, start);
    if (event.data.pianoGate && source && !source.accepted) { frames.fill(0); onsets.fill(0); }
    self.postMessage({ type: 'frames', id, start, frames, onsets, rawFrames, rawOnsets, source, noiseReduced, noiseOnly: quiet && noiseProfile.length > 0 }, { transfer: [frames.buffer, onsets.buffer, ...(rawFrames && rawOnsets ? [rawFrames.buffer, rawOnsets.buffer] : [])] });
  } catch (error) {
    self.postMessage({ type: 'error', id, message: error instanceof Error ? error.message : String(error) });
  }
};
