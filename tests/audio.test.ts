import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PianoListener } from '../src/audio';

describe('microphone attempts', () => {
  let listener: PianoListener;
  let contexts: Context[];
  let workers: ModelWorker[];
  let nodes: Capture[];
  let tracks: { stop: ReturnType<typeof vi.fn>; onended: null | (() => void) }[];
  const link = () => ({ connect: vi.fn(), disconnect: vi.fn() });
  class Context {
    state = 'suspended'; sampleRate = 48000; destination = {};
    audioWorklet = { addModule: vi.fn(async () => {}) };
    resume = vi.fn(async () => { this.state = 'running'; });
    close = vi.fn(async () => { this.state = 'closed'; });
    createMediaStreamSource = vi.fn(link);
    createGain = () => ({ ...link(), gain: { value: 1 } });
    constructor() { contexts.push(this); }
  }
  class ModelWorker {
    onmessage?: (event: { data: unknown }) => void;
    onerror?: () => void;
    terminate = vi.fn();
    postMessage = vi.fn((data: { type: string; id: number; start: number; samples: Float32Array }) => {
      queueMicrotask(() => this.onmessage?.({ data: data.type === 'init' ? { type: 'ready' } : { type: 'frames', id: data.id, start: data.start, frames: new Float32Array(0), onsets: new Float32Array(0) } }));
    });
    constructor() { workers.push(this); }
  }
  class Capture {
    port = { onmessage: undefined as undefined | ((event: { data: Float32Array }) => void), close: vi.fn() };
    connect = vi.fn(); disconnect = vi.fn();
    constructor() { nodes.push(this); }
  }
  beforeEach(() => {
    contexts = []; workers = []; nodes = []; tracks = []; listener = new PianoListener();
    vi.stubGlobal('AudioContext', Context); vi.stubGlobal('Worker', ModelWorker);
    vi.stubGlobal('AudioWorkletNode', Capture); vi.stubGlobal('window', { AudioWorkletNode: Capture });
    vi.stubGlobal('location', { href: 'https://example.test/piano-trainer/' });
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn(async () => {
      // Safari can interrupt audio when switching to microphone capture.
      contexts[0].state = 'interrupted';
      const track = { stop: vi.fn(), onended: null }; tracks.push(track);
      return { getTracks: () => [track] };
    }) } });
  });
  afterEach(() => { listener.dispose(); vi.unstubAllGlobals(); });
  it('reuses the unlocked context and loaded model on Next, and closes old capture', async () => {
    expect(await listener.start(vi.fn(), vi.fn(), vi.fn())).toBe(true);
    expect(contexts[0].resume).toHaveBeenCalledTimes(2);
    listener.stop();
    expect(tracks[0].stop).toHaveBeenCalledOnce();
    expect(nodes[0].port.close).toHaveBeenCalledOnce();
    expect(contexts[0].close).not.toHaveBeenCalled();
    expect(await listener.start(vi.fn(), vi.fn(), vi.fn())).toBe(true);
    expect(contexts).toHaveLength(1); expect(workers).toHaveLength(1);
    expect(contexts[0].state).toBe('running');
    listener.dispose(); expect(contexts[0].close).toHaveBeenCalledOnce();
  });
  it('submits quiet playing at native device rate with bounded gain', async () => {
    const activity = vi.fn(), level = vi.fn();
    await listener.start(vi.fn(), level, vi.fn(), activity);
    for (let block = 0; block < 48; block++) {
      nodes[0].port.onmessage?.({ data: Float32Array.from({ length: 2048 }, (_, i) => .005 * Math.sin(2 * Math.PI * 440 * (block * 2048 + i) / 48000)) });
    }
    const analysis = workers[0].postMessage.mock.calls.map(([data]) => data).find(data => data.type === 'analyze');
    expect(analysis).toBeDefined();
    expect(analysis!.samples).toHaveLength(44100);
    expect(Math.max(...analysis!.samples)).toBeCloseTo(.08, 3);
    expect(activity).toHaveBeenCalledWith('heard');
    expect(activity).toHaveBeenCalledWith('processing');
    expect(level.mock.calls.at(-1)![0]).toBeGreaterThan(.15);
  });
});
