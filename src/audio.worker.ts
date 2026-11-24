import * as tf from '@tensorflow/tfjs';
import { validatePianoPitches } from './piano-spectrum';
import { setWasmPaths } from '@tensorflow/tfjs-backend-wasm';
import { evaluatePianoWindow } from './piano-model';
import { MIN_ANALYSIS_SAMPLES, MODEL_CONTEXT_FRAMES, MODEL_HOP_SAMPLES } from './audio-timing';
import { suppressPianoNoise } from './piano-noise';
import { MIN_PIANO_RMS, preparePianoWindow, signalLevel } from './audio-signal';

let model: tf.GraphModel;
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
      self.postMessage({ type: 'ready', backend: tf.getBackend() });
      return;
    }
    await loading;
    const cleaned = suppressPianoNoise(samples, noiseProfile, inputGain);
    const quiet = signalLevel(cleaned).rms < MIN_PIANO_RMS;
    const count = Math.max(0, Math.floor(samples.length / MODEL_HOP_SAMPLES) - (final ? 0 : MODEL_CONTEXT_FRAMES));
    // Keep capture timestamps/release evidence, but do not run the network on
    // a window that normalization would mute anyway.
    const prepared = quiet ? cleaned : preparePianoWindow(cleaned);
    const { frames, onsets } = quiet ? { frames: new Float32Array(count * 88), onsets: new Float32Array(count * 88) }
      : await evaluatePianoWindow(model, prepared, final);
    if (!quiet) validatePianoPitches(prepared, frames, onsets);
    self.postMessage({ type: 'frames', id, start, frames, onsets, noiseOnly: quiet && noiseProfile.length > 0 }, { transfer: [frames.buffer, onsets.buffer] });
  } catch (error) {
    self.postMessage({ type: 'error', id, message: error instanceof Error ? error.message : String(error) });
  }
};
