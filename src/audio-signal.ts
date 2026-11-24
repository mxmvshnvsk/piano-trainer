export function signalLevel(samples: Float32Array) {
  let mean = 0;
  for (const sample of samples) mean += sample;
  mean /= samples.length || 1;
  let energy = 0, peak = 0;
  for (const sample of samples) {
    const value = sample - mean;
    energy += value * value; peak = Math.max(peak, Math.abs(value));
  }
  return { mean, rms: Math.sqrt(energy / (samples.length || 1)), peak };
}

export function microphoneGain(sensitivity: number) {
  const value = Math.max(0, Math.min(100, Number.isFinite(sensitivity) ? sensitivity : 50));
  return 10 ** ((value - 50) * (value < 50 ? .24 : .48) / 20);
}

export function microphoneThreshold(sensitivity: number, noiseFloor = 0) {
  const margin = 3 - Math.max(0, Math.min(100, sensitivity)) * .015;
  return Math.max(.001, noiseFloor * microphoneGain(sensitivity) * margin);
}

export function microphoneAudible(rms: number, sensitivity: number, noiseFloor = 0) {
  return rms >= microphoneThreshold(sensitivity, noiseFloor);
}

// A quiet instrument should reach the model without relaxing note confidence.
// Limit gain and gate very low-level noise before inference: the model can
// otherwise turn even tiny background noise into confident note predictions.
export function preparePianoWindow(samples: Float32Array) {
  const { mean, rms, peak } = signalLevel(samples);
  // A two-second window includes silence and decay; its RMS can be lower
  // than the short worklet block that triggered recognition.
  if (rms < .0005) return new Float32Array(samples.length);
  const gain = peak > .95 ? .95 / peak : Math.min(16, Math.max(1, .2 / peak));
  return samples.map(sample => (sample - mean) * gain);
}

// Keep the interpolation phase across worklet messages, including the sample
// on either side of a message boundary. Input is at the device's native rate.
export class StreamingResampler {
  private tail?: number;
  private position = 0;
  private from: number;
  private to: number;
  constructor(from: number, to: number) { this.from = from; this.to = to; }
  push(input: Float32Array) {
    if (this.from === this.to) return input;
    if (!input.length) return input;
    const joined = new Float32Array(input.length + (this.tail === undefined ? 0 : 1));
    if (this.tail !== undefined) joined[0] = this.tail;
    joined.set(input, this.tail === undefined ? 0 : 1);
    const step = this.from / this.to;
    const output = new Float32Array(Math.ceil(joined.length / step) + 1);
    let count = 0;
    while (this.position < joined.length - 1) {
      const left = Math.floor(this.position), fraction = this.position - left;
      output[count++] = joined[left] * (1 - fraction) + joined[left + 1] * fraction;
      this.position += step;
    }
    this.position -= joined.length - 1;
    this.tail = joined[joined.length - 1];
    return output.slice(0, count);
  }
}

export async function resumeAudio(context: AudioContext) {
  if (context.state === 'running') return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      context.resume(),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('audio-resume-timeout')), 5000); }),
    ]);
    if ((context.state as AudioContextState) !== 'running') throw new Error('audio-not-running');
  } finally { clearTimeout(timer); }
}

export function requestMicrophone(): Promise<MediaStream> {
  return new Promise((resolve, reject) => {
    let expired = false;
    const timer = setTimeout(() => { expired = true; reject(new Error('microphone-timeout')); }, 20000);
    navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false } }).then(stream => {
      clearTimeout(timer);
      // A permission prompt can complete after cancellation/timeout.
      if (expired) stream.getTracks().forEach(track => track.stop());
      else resolve(stream);
    }, error => { clearTimeout(timer); reject(error); });
  });
}
