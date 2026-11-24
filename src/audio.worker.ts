import * as tf from '@tensorflow/tfjs';
import { setWasmPaths } from '@tensorflow/tfjs-backend-wasm';
import { evaluatePianoWindow } from './piano-model';
import { MIN_ANALYSIS_SAMPLES } from './audio-timing';

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
  const { type, id, samples, base, start, final = false } = event.data;
  try {
    if (type === 'init') {
      loading ??= initialize(base);
      await loading;
      self.postMessage({ type: 'ready', backend: tf.getBackend() });
      return;
    }
    await loading;
    const { frames, onsets } = await evaluatePianoWindow(model, samples, final);
    self.postMessage({ type: 'frames', id, start, frames, onsets }, { transfer: [frames.buffer, onsets.buffer] });
  } catch (error) {
    self.postMessage({ type: 'error', id, message: error instanceof Error ? error.message : String(error) });
  }
};
