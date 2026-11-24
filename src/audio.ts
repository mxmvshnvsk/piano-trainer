import type { Frame } from './evaluation';
export class MicrophoneError extends Error {
  constructor(readonly reason: 'permission' | 'unavailable' | 'model' | 'device') { super(reason); }
}
export type AudioActivity = 'listening' | 'heard' | 'processing';
export class PianoListener {
  private worker?: Worker;
  private initialized?: Promise<void>;
  private context?: AudioContext;
  private stream?: MediaStream;
  private source?: MediaStreamAudioSourceNode;
  private node?: AudioWorkletNode;
  private mute?: GainNode;
  private samples = new Float32Array(0);
  private total = 0;
  private lastSubmitted = 0;
  private generation = 0;
  private busy?: Promise<void>;
  private resolveJob?: () => void;
  private jobError?: Error;
  private running = false;
  private onFrames: (frames: Frame[]) => void = () => {};
  private onLevel: (level: number) => void = () => {};
  private onError: (error: Error) => void = () => {};
  private onActivity: (activity: AudioActivity) => void = () => {};
  private lastSound = -Infinity;
  async prepare() {
    if (!this.initialized) this.initialized = new Promise<void>((resolve, reject) => {
      this.worker = new Worker(new URL('./audio.worker.ts', import.meta.url), { type: 'module' });
      const timer = setTimeout(() => { this.dispose(); reject(new MicrophoneError('model')); }, 90000);
      this.worker.onerror = () => { clearTimeout(timer); reject(new MicrophoneError('model')); this.resolveJob?.(); this.onError(new MicrophoneError('model')); };
      this.worker.onmessage = ({ data }) => {
        if (data.type === 'ready') { clearTimeout(timer); resolve(); return; }
        if (data.type === 'error') {
          clearTimeout(timer); this.jobError = new MicrophoneError('model'); reject(this.jobError);
          this.resolveJob?.(); if (data.id === this.generation) this.onError(this.jobError); return;
        }
        if (data.type === 'frames') {
          if (data.id === this.generation) { this.onActivity('listening'); this.decode(data.frames, data.onsets, data.start); }
          this.resolveJob?.();
        }
      };
      this.worker.postMessage({ type: 'init', base: new URL(import.meta.env.BASE_URL, location.href).href });
    }).catch(error => { this.initialized = undefined; this.worker?.terminate(); this.worker = undefined; throw error; });
    return this.initialized;
  }
  async start(onFrames: (frames: Frame[]) => void, onLevel: (level: number) => void, onError: (error: Error) => void, onActivity: (activity: AudioActivity) => void = () => {}) {
    this.stop();
    const generation = this.generation;
    this.onFrames = onFrames; this.onLevel = onLevel; this.onError = onError; this.onActivity = onActivity;
    if (!navigator.mediaDevices?.getUserMedia || !window.AudioWorkletNode) throw new MicrophoneError('unavailable');
    // Start the audio context and ask permission from the user's click, before
    // awaiting model loading (important for mobile browser gesture policies).
    const context = new AudioContext({ sampleRate: 22050 });
    this.context = context;
    try {
      await context.resume();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      if (generation !== this.generation) { stream.getTracks().forEach(t => t.stop()); return false; }
      this.stream = stream;
      await Promise.all([this.prepare(), context.audioWorklet.addModule(`${import.meta.env.BASE_URL}capture-worklet.js`)]);
      if (generation !== this.generation) return false;
      this.samples = new Float32Array(0); this.total = 0; this.lastSubmitted = 0; this.lastSound = -Infinity;
      this.running = true; this.jobError = undefined;
      this.source = context.createMediaStreamSource(stream);
      this.node = new AudioWorkletNode(context, 'piano-capture');
      this.mute = context.createGain(); this.mute.gain.value = 0;
      this.source.connect(this.node); this.node.connect(this.mute); this.mute.connect(context.destination);
      this.node.port.onmessage = ({ data }: MessageEvent<Float32Array>) => {
        if (!this.running || generation !== this.generation) return;
        const samples = context.sampleRate === 22050 ? data : resample(data, context.sampleRate, 22050);
        let sum = 0; for (const n of samples) sum += n * n;
        const rms = Math.sqrt(sum / samples.length);
        this.onLevel(Math.min(1, rms * 12));
        if (rms >= .007) {
          if (!this.busy) this.onActivity('heard');
          this.lastSound = this.total;
        }
        const next = new Float32Array(this.samples.length + samples.length);
        next.set(this.samples); next.set(samples, this.samples.length);
        this.samples = next.length > 44100 ? next.slice(-44100) : next;
        this.total += samples.length;
        if (!this.busy && this.total >= 44100 && this.total - this.lastSubmitted >= 17640 && this.total - this.lastSound <= 44100) void this.submit();
      };
      stream.getTracks().forEach(track => track.onended = () => { if (this.running) { this.stop(); this.onError(new MicrophoneError('device')); } });
      return true;
    } catch (error) {
      if (generation !== this.generation) return false;
      this.stop();
      if (error instanceof MicrophoneError) throw error;
      throw new MicrophoneError(error instanceof DOMException && ['NotAllowedError', 'SecurityError'].includes(error.name) ? 'permission' : 'device');
    }
  }
  private async submit() {
    if (!this.worker || !this.samples.length) return;
    const input = this.samples.slice();
    const start = (this.total - input.length) / 22050;
    this.lastSubmitted = this.total;
    const job = new Promise<void>(resolve => { this.resolveJob = resolve; });
    this.busy = job;
    this.onActivity('processing');
    this.worker.postMessage({ type: 'analyze', id: this.generation, samples: input, start }, [input.buffer]);
    await job;
    if (this.busy === job) this.busy = undefined;
  }
  private decode(frames: Float32Array, onsets: Float32Array, start: number) {
    const output: Frame[] = [];
    const count = frames.length / 88;
    // Require a meaningful attack somewhere in this window, then sustained frame evidence.
    const peaks = new Float32Array(88);
    for (let i = 0; i < count; i++) for (let n = 0; n < 88; n++) peaks[n] = Math.max(peaks[n], onsets[i * 88 + n]);
    for (let i = 0; i < count; i++) {
      const notes: number[] = [], attacks: number[] = []; let strength = 0;
      for (let n = 0; n < 88; n++) {
        const probability = frames[i * 88 + n];
        if (probability >= .32 && peaks[n] >= .3) { notes.push(n + 21); strength += probability; }
        if (onsets[i * 88 + n] >= .35 && (i === 0 || onsets[(i - 1) * 88 + n] < .35)) attacks.push(n + 21);
      }
      output.push({ at: start + i * 256 / 22050, notes, onsets: attacks, confidence: notes.length ? strength / notes.length : 0 });
    }
    this.onFrames(output);
  }
  async finish() {
    this.releaseCapture();
    await this.busy;
    if (this.total > this.lastSubmitted) await this.submit();
    if (this.jobError) throw this.jobError;
  }
  private releaseCapture() {
    this.running = false;
    this.stream?.getTracks().forEach(track => { track.onended = null; track.stop(); }); this.stream = undefined;
    this.source?.disconnect(); this.node?.disconnect(); this.mute?.disconnect();
    this.source = undefined; this.node = undefined; this.mute = undefined;
    void this.context?.close().catch(() => {}); this.context = undefined;
  }
  stop() { this.generation++; this.releaseCapture(); }
  dispose() { this.stop(); this.worker?.terminate(); this.worker = undefined; this.initialized = undefined; this.resolveJob?.(); this.busy = undefined; }
}
export function resample(input: Float32Array, from: number, to: number) {
  const result = new Float32Array(Math.floor(input.length * to / from));
  for (let i = 0; i < result.length; i++) {
    const position = i * from / to, left = Math.floor(position), mix = position - left;
    result[i] = input[left] * (1 - mix) + (input[Math.min(left + 1, input.length - 1)] || 0) * mix;
  }
  return result;
}
