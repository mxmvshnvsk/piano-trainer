import * as tf from '@tensorflow/tfjs';
import { setWasmPaths } from '@tensorflow/tfjs-backend-wasm';
import { BasicPitch } from '@spotify/basic-pitch';

let model: BasicPitch;
let loading: Promise<void> | undefined;
async function initialize(base: string) {
  setWasmPaths(new URL('wasm/', base).href);
  const load = async () => {
    model = new BasicPitch(new URL('model/model.json', base).href);
    await model.model;
    // Keep weights outside the per-inference scope. Dispose intermediate tensors,
    // including ones retained by the upstream evaluateModel implementation.
    tf.engine().startScope();
    try { await model.evaluateModel(new Float32Array(43844), () => {}, () => {}); }
    finally { tf.engine().endScope(); }
  };
  try { await tf.setBackend('wasm'); await tf.ready(); await load(); }
  catch {
    try { (await model?.model)?.dispose(); } catch { /* A failed load has no weights. */ }
    await tf.setBackend('cpu'); await tf.ready(); await load();
  }
}
self.onmessage = async (event: MessageEvent) => {
  const { type, id, samples, base, start } = event.data;
  try {
    if (type === 'init') {
      loading ??= initialize(base);
      await loading;
      self.postMessage({ type: 'ready', backend: tf.getBackend() });
      return;
    }
    await loading;
    const frames: number[][] = [], onsets: number[][] = [];
    tf.engine().startScope();
    try {
      await model.evaluateModel(samples, (f, o) => { frames.push(...f); onsets.push(...o); }, () => {});
    } finally { tf.engine().endScope(); }
    const packed = new Float32Array(frames.length * 88);
    for (let i = 0; i < frames.length; i++) for (let n = 0; n < 88; n++) packed[i * 88 + n] = frames[i][n];
    // Onset strengths help suppress weak, sustained harmonics.
    const attacks = new Float32Array(frames.length * 88);
    for (let i = 0; i < onsets.length; i++) for (let n = 0; n < 88; n++) attacks[i * 88 + n] = onsets[i][n];
    self.postMessage({ type: 'frames', id, start, frames: packed, onsets: attacks }, { transfer: [packed.buffer, attacks.buffer] });
  } catch (error) {
    self.postMessage({ type: 'error', id, message: error instanceof Error ? error.message : String(error) });
  }
};
