import * as tf from '@tensorflow/tfjs';
import { pianoSourceEvidence } from './piano-source';

let loading: Promise<tf.GraphModel> | undefined;
export function preparePianoSource(base: string) {
  // Local experiment only. Model files are deliberately outside public/ and
  // excluded from git until calibrated and reviewed for release.
  return loading ??= tf.loadGraphModel(new URL('output/sound-classifier/model.json', base).href).catch(error => { loading = undefined; throw error; });
}
export function pianoSourceWaveform(samples: Float32Array) {
  // Fixed YAMNet window: 975 ms at 16 kHz. Left padding supplies context for a
  // short note without waiting for 975 ms of new capture. Validate this path
  // on real short notes; padding does not prove source classification accuracy.
  const waveform = new Float32Array(15600);
  const ratio = 22050 / 16000;
  for (let i = 0; i < waveform.length; i++) {
    const at = samples.length - (waveform.length - i) * ratio;
    if (at < 0) continue;
    const index = Math.floor(at), fraction = at - index;
    waveform[i] = (samples[index] || 0) * (1 - fraction) + (samples[index + 1] || 0) * fraction;
  }
  return waveform;
}
export async function classifyPianoSource(base: string, samples: Float32Array) {
  const model = await preparePianoSource(base);
  const waveform = pianoSourceWaveform(samples);
  tf.engine().startScope();
  try {
    const scores = model.execute(tf.tensor1d(waveform), 'Identity') as tf.Tensor2D;
    return pianoSourceEvidence(await scores.data());
  } finally { tf.engine().endScope(); }
}
