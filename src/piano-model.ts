import * as tf from '@tensorflow/tfjs';
import { MODEL_CONTEXT_FRAMES, MODEL_HOP_SAMPLES, MODEL_INPUT_SAMPLES, MAX_ANALYSIS_SAMPLES } from './audio-timing.ts';

// Preserve Basic Pitch's 15-frame left overlap and output alignment, without
// tf.signal.frame's padEnd/fill(dtype=undefined) path, which fails on TFJS WASM.
// A live check needs only one fixed network window and the two 88-note heads.
export async function evaluatePianoWindow(model: tf.GraphModel, samples: Float32Array, final = false) {
  if (samples.length > MAX_ANALYSIS_SAMPLES) throw new Error('Piano window is too long');
  // The newest frames lack right-hand context. Wait for the next capture
  // before committing them: later windows can otherwise revise a note onset
  // that the evaluator has already passed. Flush the tail only on finalization.
  const count = Math.max(0, Math.floor(samples.length / MODEL_HOP_SAMPLES) - (final ? 0 : MODEL_CONTEXT_FRAMES));
  if (!count) return { frames: new Float32Array(0), onsets: new Float32Array(0) };
  const padded = new Float32Array(MODEL_INPUT_SAMPLES);
  padded.set(samples, MODEL_CONTEXT_FRAMES * MODEL_HOP_SAMPLES);
  tf.engine().startScope();
  try {
    const input = tf.tensor3d(padded, [1, MODEL_INPUT_SAMPLES, 1], 'float32');
    const results = model.execute(input, ['Identity_1', 'Identity_2']) as tf.Tensor3D[];
    const shape: [number, number, number] = [1, count, 88];
    const frames = results[0].slice([0, MODEL_CONTEXT_FRAMES, 0], shape);
    const onsets = results[1].slice([0, MODEL_CONTEXT_FRAMES, 0], shape);
    const [frameValues, onsetValues] = await Promise.all([frames.data(), onsets.data()]);
    return { frames: new Float32Array(frameValues), onsets: new Float32Array(onsetValues) };
  } finally { tf.engine().endScope(); }
}
