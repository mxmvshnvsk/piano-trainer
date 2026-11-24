import type { Frame } from './evaluation';
import { MIN_ANALYSIS_SAMPLES, MAX_ANALYSIS_SAMPLES, ANALYSIS_HOP_SAMPLES, PIANO_SAMPLE_RATE } from './audio-timing';
import { microphoneAudible, microphoneGain, microphoneThreshold, requestMicrophone, resumeAudio, signalLevel, StreamingResampler } from './audio-signal';
import { microphoneHealth, type MicrophoneHealth } from './microphone-health';
import { decodePianoFrames, hasRecentPianoEvidence, limitPianoTail } from './audio-decoder';
import { estimateNoiseProfile, restoreNoiseProfile } from './piano-noise';
import type { PianoSourceEvidence } from './piano-source';
export class MicrophoneError extends Error {
  constructor(readonly reason: 'permission' | 'unavailable' | 'model' | 'device' | 'slow') { super(reason); }
}
export type AudioActivity = 'listening' | 'heard' | 'processing' | 'uncertain' | 'background';
export type MicrophoneMetrics = { rms: number; peak: number; inputRms: number; inputPeak: number; sampleRate: number; backend?: string; inferenceMs?: number; health?: MicrophoneHealth; threshold?: number };
export type PianoDiagnostic = { start: number; rawFrames: number[]; rawOnsets: number[]; frames: number[]; onsets: number[]; source?: PianoSourceEvidence };
export class PianoListener {
  // Opt-in local diagnostics; never transferred in a production build.
  onDiagnostic?: (window: PianoDiagnostic) => void;
  onDiagnosticSamples?: (samples: Float32Array) => void;
  pianoGate = import.meta.env.DEV && typeof location !== 'undefined' && new URLSearchParams(location.search).get('pianoGate') === '1';
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
  private sensitivity = 50;
  private noiseFloor = 0;
  private noiseProfile: number[] = [];
  private noiseCapture?: { chunks: Float32Array[]; length: number };
  private recognitionEnabled = true;
  private signalRevision = 0;
  private jobRevision = 0;
  private activity: AudioActivity = 'listening';
  private backend?: string;
  private inferenceMs?: number;
  private lastNotesAt = 0;
  private analysisHealth?: 'good' | 'noise' | 'uncertain';
  private analysisAt = -Infinity;
  private endingAt?: number;
  private endingNotes = new Set<number>();
  private drain?: { target: number; resolve: () => void; timer: ReturnType<typeof setTimeout> };
  setSensitivity(value: number) {
    if (value === this.sensitivity) return;
    this.sensitivity = value;
    this.signalRevision++;
    // Do not interpret a gain change as the attack of a newly played note.
    this.samples = new Float32Array(0); this.lastSubmitted = this.total; this.lastSound = -Infinity;
  }
  setNoiseFloor(value: number) {
    if (value === this.noiseFloor) return;
    this.noiseFloor = Math.max(0, Math.min(.1, Number.isFinite(value) ? value : 0));
    this.signalRevision++;
    this.samples = new Float32Array(0); this.lastSubmitted = this.total; this.lastSound = -Infinity;
  }
  setNoiseProfile(value: number[]) {
    const profile = restoreNoiseProfile(value);
    if (profile.length === this.noiseProfile.length && profile.every((power, i) => power === this.noiseProfile[i])) return;
    this.noiseProfile = profile; this.signalRevision++;
    this.samples = new Float32Array(0); this.lastSubmitted = this.total; this.lastSound = -Infinity;
  }
  beginNoiseMeasurement() {
    this.setRecognitionEnabled(false);
    this.noiseCapture = { chunks: [], length: 0 };
  }
  finishNoiseMeasurement() {
    const capture = this.noiseCapture; this.noiseCapture = undefined;
    if (!capture) return [];
    const samples = new Float32Array(capture.length); let offset = 0;
    for (const chunk of capture.chunks) { samples.set(chunk, offset); offset += chunk.length; }
    const profile = estimateNoiseProfile(samples); this.setNoiseProfile(profile);
    return profile;
  }
  setRecognitionEnabled(value: boolean) {
    if (value === this.recognitionEnabled) return;
    this.recognitionEnabled = value; this.signalRevision++;
    this.samples = new Float32Array(0); this.lastSubmitted = this.total; this.lastSound = -Infinity;
  }
  private reportActivity(value: AudioActivity) { this.activity = value; this.onActivity(value); }
  async prepare() {
    if (!this.initialized) this.initialized = new Promise<void>((resolve, reject) => {
      this.worker = new Worker(new URL('./audio.worker.ts', import.meta.url), { type: 'module' });
      const timer = setTimeout(() => { this.dispose(); reject(new MicrophoneError('model')); }, 90000);
      this.worker.onerror = () => { clearTimeout(timer); reject(new MicrophoneError('model')); this.resolveJob?.(); this.onError(new MicrophoneError('model')); };
      this.worker.onmessage = ({ data }) => {
        if (data.type === 'ready') { this.backend = data.backend; clearTimeout(timer); resolve(); return; }
        if (data.type === 'error') {
          clearTimeout(timer); this.jobError = new MicrophoneError('model'); reject(this.jobError);
          this.resolveJob?.(); if (data.id === this.generation) this.onError(this.jobError); return;
        }
        if (data.type === 'frames') {
          if (data.id === this.generation) {
            if (this.jobRevision === this.signalRevision && this.recognitionEnabled) {
              if (import.meta.env.DEV && data.rawFrames) {
                // Bound local JSON size without changing any recognition values.
                const diagnostic = (values: Float32Array) => Array.from(values, value => Math.round(value * 100000) / 100000);
                this.onDiagnostic?.({ start: data.start, rawFrames: diagnostic(data.rawFrames), rawOnsets: diagnostic(data.rawOnsets), frames: diagnostic(data.frames), onsets: diagnostic(data.onsets), source: data.source });
              }
              const recognized = this.decode(data.frames, data.onsets, data.start);
              if (recognized) this.lastNotesAt=this.total;
              this.analysisHealth=recognized ? 'good' : data.noiseOnly || data.noiseReduced || data.source && !data.source.accepted && Math.max(data.source.speech,data.source.noise)>.3 ? 'noise' : 'uncertain';
              this.analysisAt=this.total;
              if (data.id === this.generation) this.reportActivity(recognized ? 'processing' : 'listening');
            } else this.reportActivity('listening');
          }
          this.resolveJob?.();
        }
      };
      this.worker.postMessage({ type: 'init', base: new URL(import.meta.env.BASE_URL, location.href).href, pianoGate: import.meta.env.DEV && this.pianoGate, diagnostics: import.meta.env.DEV && !!this.onDiagnostic });
    }).catch(error => { this.initialized = undefined; this.worker?.terminate(); this.worker = undefined; throw error; });
    return this.initialized;
  }
  async start(onFrames: (frames: Frame[]) => void, onLevel: (level: number) => void, onError: (error: Error) => void, onActivity: (activity: AudioActivity) => void = () => {}, onMetrics: (metrics: MicrophoneMetrics) => void = () => {}) {
    this.stop();
    const generation = this.generation;
    this.onFrames = onFrames; this.onLevel = onLevel; this.onError = onError; this.onActivity = onActivity;
    if (!navigator.mediaDevices?.getUserMedia || !window.AudioWorkletNode) throw new MicrophoneError('unavailable');
    // Start the audio context and ask permission from the user's click, before
    // awaiting model loading (important for mobile browser gesture policies).
    // Reuse the unlocked context across attempts. Recreating it from an
    // automatic Next transition can lose Safari's user-gesture permission.
    const context = this.context && this.context.state !== 'closed' ? this.context : new AudioContext({ latencyHint: 'interactive' });
    this.context = context;
    try {
      await resumeAudio(context);
      const stream = await requestMicrophone();
      if (generation !== this.generation) { stream.getTracks().forEach(t => t.stop()); return false; }
      this.stream = stream;
      await context.audioWorklet.addModule(`${import.meta.env.BASE_URL}capture-worklet.js`);
      if (generation !== this.generation) return false;
      this.samples = new Float32Array(0); this.total = 0; this.lastSubmitted = 0; this.lastSound = -Infinity;
      this.running = true; this.jobError = undefined;
      this.activity = 'listening'; this.inferenceMs = undefined;
      this.lastNotesAt=0;this.analysisHealth=undefined;this.analysisAt=-Infinity;
      this.endingAt = undefined; this.endingNotes.clear();
      let modelReady = false;
      this.source = context.createMediaStreamSource(stream);
      this.node = new AudioWorkletNode(context, 'piano-capture');
      this.mute = context.createGain(); this.mute.gain.value = 0;
      this.source.connect(this.node); this.node.connect(this.mute); this.mute.connect(context.destination);
      const resampler = new StreamingResampler(context.sampleRate, PIANO_SAMPLE_RATE);
      this.node.port.onmessage = ({ data }: MessageEvent<Float32Array>) => {
        if (!this.running || generation !== this.generation) return;
        const raw = resampler.push(data);
        if (import.meta.env.DEV && modelReady) this.onDiagnosticSamples?.(raw);
        if (this.noiseCapture && this.noiseCapture.length < PIANO_SAMPLE_RATE * 2) {
          const chunk = raw.slice(0, PIANO_SAMPLE_RATE * 2 - this.noiseCapture.length);
          this.noiseCapture.chunks.push(chunk); this.noiseCapture.length += chunk.length;
        }
        const { rms: inputRms, peak: inputPeak } = signalLevel(raw);
        const gain = microphoneGain(this.sensitivity);
        const samples = raw.map(sample => sample * gain);
        const { rms, peak } = signalLevel(samples);
        this.onLevel(Math.min(1, Math.sqrt(rms * 12)));
        const threshold=microphoneThreshold(this.sensitivity,this.noiseFloor,this.noiseProfile.length>0);
        onMetrics({ rms, peak, inputRms, inputPeak, sampleRate: context.sampleRate, backend: this.backend, inferenceMs: this.inferenceMs, threshold, health: microphoneHealth({seconds:this.total/PIANO_SAMPLE_RATE,sinceNotes:(this.total-this.lastNotesAt)/PIANO_SAMPLE_RATE,sinceAudible:(this.total-this.lastSound)/PIANO_SAMPLE_RATE,inputPeak,analysis:this.total-this.analysisAt<PIANO_SAMPLE_RATE*1.5?this.analysisHealth:undefined}) });
        if (microphoneAudible(rms, this.sensitivity, this.noiseFloor, this.noiseProfile.length > 0)) {
          this.lastSound = this.total;
        }
        const next = new Float32Array(this.samples.length + samples.length);
        next.set(this.samples); next.set(samples, this.samples.length);
        this.samples = next.length > MAX_ANALYSIS_SAMPLES ? next.slice(-MAX_ANALYSIS_SAMPLES) : next;
        this.total += samples.length;
        if (this.drain && this.total >= this.drain.target) this.resolveDrain();
        if (modelReady && !this.busy && this.samples.length >= MIN_ANALYSIS_SAMPLES && this.total - this.lastSubmitted >= ANALYSIS_HOP_SAMPLES && this.total - this.lastSound <= MAX_ANALYSIS_SAMPLES) void this.submit();
      };
      stream.getTracks().forEach(track => track.onended = () => { if (this.running) { this.stop(); this.onError(new MicrophoneError('device')); } });
      // Opening the microphone may interrupt an already resumed Safari context.
      await resumeAudio(context);
      if (generation !== this.generation) return false;
      // The level meter works while the local recognition model is loading.
      await this.prepare();
      if (generation !== this.generation) return false;
      this.samples = new Float32Array(0); this.total = 0; this.lastSubmitted = 0; this.lastSound = -Infinity;
      modelReady = true;
      return true;
    } catch (error) {
      if (generation !== this.generation) return false;
      this.stop();
      if (error instanceof MicrophoneError) throw error;
      throw new MicrophoneError(error instanceof DOMException && ['NotAllowedError', 'SecurityError'].includes(error.name) ? 'permission' : 'device');
    }
  }
  private async submit(final = false) {
    if (!this.worker || !this.recognitionEnabled || !this.samples.length || this.total - this.lastSound > MAX_ANALYSIS_SAMPLES) return;
    // Noise spectra are measured before gain. Normalize only after denoising in
    // the worker, otherwise automatic gain would also amplify the residual noise.
    const input = this.samples.slice();
    const start = (this.total - input.length) / PIANO_SAMPLE_RATE;
    this.lastSubmitted = this.total;
    const job = new Promise<void>(resolve => { this.resolveJob = resolve; });
    this.busy = job;
    this.jobRevision = this.signalRevision;
    // Starting a model job is invisible: volume alone is not note evidence.
    // The result handler shows recognition only for supported piano pitches.
    const started = performance.now(), worker = this.worker;
    const timeout = setTimeout(() => {
      if (this.busy !== job || this.worker !== worker) return;
      this.jobError = new MicrophoneError('slow');
      this.dispose(); this.onError(this.jobError);
    }, 30000);
    this.worker.postMessage({ type: 'analyze', id: this.generation, revision:this.jobRevision, samples: input, start, final, noiseProfile: this.noiseProfile, inputGain: microphoneGain(this.sensitivity), diagnostics: import.meta.env.DEV && !!this.onDiagnostic, pianoGate: import.meta.env.DEV && this.pianoGate }, [input.buffer]);
    await job;
    clearTimeout(timeout); this.inferenceMs = performance.now() - started;
    if (this.busy === job) this.busy = undefined;
  }
  private decode(frames: Float32Array, onsets: Float32Array, start: number) {
    const decoded = decodePianoFrames(frames, onsets, start);
    const output = this.endingAt === undefined ? decoded : limitPianoTail(decoded, this.endingAt, this.endingNotes);
    this.onFrames(output);
    return hasRecentPianoEvidence(output);
  }
  async finish() {
    const generation = this.generation;
    if (this.running) {
      // Include the worklet message already in flight at the deadline, then
      // capture a bounded tail for context. The cutoff still excludes new notes.
      this.endingAt = this.total / PIANO_SAMPLE_RATE + Math.min(.05, 2048 / (this.context?.sampleRate || 48000));
      this.endingNotes.clear();
      await new Promise<void>(resolve => {
        const timer = setTimeout(() => this.resolveDrain(), 600);
        this.drain = { target: this.total + Math.ceil(.5 * PIANO_SAMPLE_RATE), resolve, timer };
      });
    }
    if (generation !== this.generation) return;
    this.releaseCapture();
    await this.busy;
    if (generation !== this.generation) return;
    // A live result deliberately withholds the newest context frames.
    // Flush those too, even when no samples arrived since the last live job.
    await this.submit(true);
    if (this.jobError) throw this.jobError;
  }
  private resolveDrain() {
    const drain = this.drain; this.drain = undefined;
    if (drain) { clearTimeout(drain.timer); drain.resolve(); }
  }
  private releaseCapture() {
    this.resolveDrain();
    this.running = false;
    this.stream?.getTracks().forEach(track => { track.onended = null; track.stop(); }); this.stream = undefined;
    this.node?.port.close(); this.source?.disconnect(); this.node?.disconnect(); this.mute?.disconnect();
    this.source = undefined; this.node = undefined; this.mute = undefined;
  }
  stop() { this.generation++; this.recognitionEnabled = true; this.noiseCapture = undefined; this.releaseCapture(); }
  dispose() { this.stop(); void this.context?.close().catch(() => {}); this.context = undefined; this.worker?.terminate(); this.worker = undefined; this.initialized = undefined; this.resolveJob?.(); this.busy = undefined; }
}
