import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PianoListener } from '../src/audio';
import { NOISE_PROFILE_SIZE } from '../src/piano-noise';
import { MIN_ANALYSIS_SAMPLES, MAX_ANALYSIS_SAMPLES } from '../src/audio-timing';

describe('microphone attempts', () => {
  let listener: PianoListener;
  let autoReady = true;
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
    respond = true;
    ready = true;
    postMessage = vi.fn((data: { type: string; id: number; start: number; samples: Float32Array; final?: boolean; noiseProfile?: number[]; inputGain?: number }) => {
      queueMicrotask(() => {
        if (data.type === 'init' && this.ready) this.onmessage?.({ data: { type: 'ready', backend: 'cpu' } });
        else if (data.type !== 'init' && this.respond) this.onmessage?.({ data: { type: 'frames', id: data.id, start: data.start, frames: new Float32Array(0), onsets: new Float32Array(0) } });
      });
    });
    constructor() { this.ready = autoReady; workers.push(this); }
  }
  class Capture {
    port = { onmessage: undefined as undefined | ((event: { data: Float32Array }) => void), close: vi.fn() };
    connect = vi.fn(); disconnect = vi.fn();
    constructor() { nodes.push(this); }
  }
  beforeEach(() => {
    contexts = []; workers = []; nodes = []; tracks = []; autoReady = true; listener = new PianoListener();
    vi.stubGlobal('AudioContext', Context); vi.stubGlobal('Worker', ModelWorker);
    vi.stubGlobal('AudioWorkletNode', Capture); vi.stubGlobal('window', { AudioWorkletNode: Capture });
    vi.stubGlobal('location', { href: 'https://example.test/piano-trainer/' });
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn(async () => {
      // Safari can interrupt audio when switching to microphone capture.
      contexts.at(-1)!.state = 'interrupted';
      const track = { stop: vi.fn(), onended: null }; tracks.push(track);
      return { getTracks: () => [track] };
    }) } });
  });
  afterEach(() => { listener.dispose(); vi.unstubAllGlobals(); vi.useRealTimers(); });
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
    expect(analysis!.samples.length).toBeGreaterThanOrEqual(MIN_ANALYSIS_SAMPLES);
    expect(analysis!.samples.length).toBeLessThan(11025);
    expect(Math.max(...analysis!.samples)).toBeCloseTo(.005, 4);
    expect(activity).not.toHaveBeenCalledWith('heard');
    expect(activity).not.toHaveBeenCalledWith('processing');
    expect(level.mock.calls.at(-1)![0]).toBeGreaterThan(.15);
  });
  function play(amplitude = .005, blocks = 48) {
    for (let block = 0; block < blocks; block++) nodes.at(-1)!.port.onmessage?.({ data: Float32Array.from({ length: 2048 }, (_, i) => amplitude * Math.sin(2 * Math.PI * 440 * (block * 2048 + i) / 48000)) });
  }
  it('starts the first check within half a second and never queues stale windows', async () => {
    await listener.start(vi.fn(), vi.fn(), vi.fn());
    workers[0].respond = false;
    play(.005, 8);
    expect(workers[0].postMessage.mock.calls.filter(([data]) => data.type === 'analyze')).toHaveLength(0);
    play(.005, 1);
    expect(workers[0].postMessage.mock.calls.filter(([data]) => data.type === 'analyze')).toHaveLength(1);
    play(.005, 200);
    const jobs = workers[0].postMessage.mock.calls.filter(([data]) => data.type === 'analyze');
    expect(jobs).toHaveLength(1);
    const old = jobs[0][0];
    workers[0].onmessage?.({data:{type:'frames',id:old.id,start:old.start,frames:new Float32Array(0),onsets:new Float32Array(0)}});
    await Promise.resolve();
    play(.005, 1);
    const latest = workers[0].postMessage.mock.calls.filter(([data]) => data.type === 'analyze').at(-1)![0];
    expect(latest.start).toBeGreaterThan(7);
    expect(latest.samples).toHaveLength(MAX_ANALYSIS_SAMPLES);
  });
  it('drains the deadline tail and waits for the final job before returning feedback', async () => {
    await listener.start(vi.fn(),vi.fn(),vi.fn());
    workers[0].respond=false; play(.005,9);
    const first=workers[0].postMessage.mock.calls.find(([data])=>data.type==='analyze')![0];
    const finishing=listener.finish();
    expect(tracks[0].stop).not.toHaveBeenCalled();
    play(.005,12); await Promise.resolve();
    expect(tracks[0].stop).toHaveBeenCalledOnce();
    workers[0].respond=true;
    workers[0].onmessage?.({data:{type:'frames',id:first.id,start:first.start,frames:new Float32Array(0),onsets:new Float32Array(0)}});
    await finishing;
    const jobs=workers[0].postMessage.mock.calls.filter(([data])=>data.type==='analyze');
    expect(jobs).toHaveLength(2);expect(jobs[1][0].final).toBe(true);
  });
  it('does not finalize a canceled attempt into the next attempt', async () => {
    await listener.start(vi.fn(),vi.fn(),vi.fn());
    const finishing=listener.finish();listener.stop();await finishing;
    expect(workers[0].postMessage.mock.calls.some(([data])=>data.type==='analyze')).toBe(false);
  });
  it('meters audio while recognition is still preparing', async () => {
    autoReady = false;
    const level = vi.fn(), metrics = vi.fn();
    const starting = listener.start(vi.fn(), level, vi.fn(), vi.fn(), metrics);
    await vi.waitFor(() => expect(workers).toHaveLength(1));
    play();
    expect(level).toHaveBeenCalled(); expect(metrics).toHaveBeenCalled();
    expect(workers[0].postMessage.mock.calls.some(([data]) => data.type === 'analyze')).toBe(false);
    workers[0].onmessage?.({ data: { type: 'ready', backend: 'cpu' } });
    expect(await starting).toBe(true);
  });
  it('sensitivity changes the actual signal gate and level, without changing note confidence', async () => {
    const level = vi.fn(), activity = vi.fn();
    await listener.start(vi.fn(), level, vi.fn(), activity);
    play(.0005);
    expect(activity).not.toHaveBeenCalledWith('heard');
    expect(workers[0].postMessage.mock.calls.some(([data]) => data.type === 'analyze')).toBe(false);
    const quietLevel = level.mock.calls.at(-1)![0];
    listener.setSensitivity(100); play(.0005);
    expect(activity).not.toHaveBeenCalledWith('heard');
    expect(workers[0].postMessage.mock.calls.some(([data]) => data.type === 'analyze')).toBe(true);
    expect(level.mock.calls.at(-1)![0]).toBeGreaterThan(quietLevel * 3);
    await Promise.resolve();
    expect(activity).toHaveBeenCalledWith('listening');
  });
  it('does not submit background noise on timeout or finalization after calibration', async () => {
    await listener.start(vi.fn(), vi.fn(), vi.fn());
    listener.setNoiseFloor(.004); play(.006);
    await listener.finish();
    expect(workers[0].postMessage.mock.calls.some(([data]) => data.type === 'analyze')).toBe(false);
  });
  it('ignores results computed before sensitivity was changed', async () => {
    const frames = vi.fn();
    await listener.start(frames, vi.fn(), vi.fn());
    workers[0].respond = false; play();
    const submitted = workers[0].postMessage.mock.calls.map(([data]) => data).find(data => data.type === 'analyze')!;
    listener.setSensitivity(75);
    const probabilities = new Float32Array(88); probabilities[45] = .9;
    workers[0].onmessage?.({ data: { type: 'frames', id: submitted.id, start: 0, frames: probabilities, onsets: probabilities } });
    expect(frames).not.toHaveBeenCalled();
  });
  it('meters audio without submitting recognition during background measurement', async () => {
    const level = vi.fn();
    await listener.start(vi.fn(), level, vi.fn());
    listener.setRecognitionEnabled(false); play();
    expect(level).toHaveBeenCalled();
    expect(workers[0].postMessage.mock.calls.some(([data]) => data.type === 'analyze')).toBe(false);
    listener.setRecognitionEnabled(true); play();
    expect(workers[0].postMessage.mock.calls.some(([data]) => data.type === 'analyze')).toBe(true);
  });
  it('measures raw background spectra, sends only the profile, and discards canceled captures',async()=>{
    await listener.start(vi.fn(),vi.fn(),vi.fn());
    listener.beginNoiseMeasurement();play(.004,48);
    const profile=listener.finishNoiseMeasurement();
    expect(profile).toHaveLength(NOISE_PROFILE_SIZE);
    expect(profile.some(power=>power>0)).toBe(true);
    expect(workers[0].postMessage.mock.calls.some(([data])=>data.type==='analyze')).toBe(false);
    listener.setSensitivity(100);listener.setRecognitionEnabled(true);play(.004,9);
    const job=workers[0].postMessage.mock.calls.find(([data])=>data.type==='analyze')![0];
    expect(job.noiseProfile).toEqual(profile);expect(job.inputGain).toBeGreaterThan(15);
    listener.beginNoiseMeasurement();play(.004,9);listener.stop();
    expect(listener.finishNoiseMeasurement()).toEqual([]);
  });
  it('animates only after the model supplies sustained, confident note evidence',async()=>{
    const activity=vi.fn();await listener.start(vi.fn(),vi.fn(),vi.fn(),activity);
    workers[0].respond=false;play(.004,9);
    const job=workers[0].postMessage.mock.calls.find(([data])=>data.type==='analyze')![0];
    const frames=new Float32Array(32*88),onsets=new Float32Array(32*88);
    for(let i=5;i<32;i++)for(const note of [61,64,68])frames[i*88+note-21]=.8;
    for(const note of [61,64,68])onsets[5*88+note-21]=.8;
    workers[0].onmessage?.({data:{type:'frames',id:job.id,start:job.start,frames,onsets}});
    expect(activity.mock.calls.at(-1)).toEqual(['processing']);
    await Promise.resolve();play(.004,5);
    expect(activity).toHaveBeenCalledWith('processing');
  });
  it.each([{strength:.45,count:32},{strength:.9,count:1}])('does not animate a weak or momentary pitch $strength/$count',async({strength,count})=>{
    const activity=vi.fn();await listener.start(vi.fn(),vi.fn(),vi.fn(),activity);
    workers[0].respond=false;play(.004,9);
    const job=workers[0].postMessage.mock.calls.find(([data])=>data.type==='analyze')![0];
    const frames=new Float32Array(count*88),onsets=new Float32Array(count*88);
    for(let i=0;i<count;i++)frames[i*88+30-21]=strength;
    onsets[30-21]=.8;
    workers[0].onmessage?.({data:{type:'frames',id:job.id,start:job.start,frames,onsets}});
    expect(activity).not.toHaveBeenCalledWith('processing');
    expect(activity.mock.calls.at(-1)).toEqual(['listening']);
  });
  it('keeps suppressed background visually idle',async()=>{
    const activity=vi.fn();await listener.start(vi.fn(),vi.fn(),vi.fn(),activity);
    workers[0].respond=false;play(.004,9);
    const job=workers[0].postMessage.mock.calls.find(([data])=>data.type==='analyze')![0];
    workers[0].onmessage?.({data:{type:'frames',id:job.id,start:job.start,frames:new Float32Array(88),onsets:new Float32Array(88),noiseOnly:true}});
    expect(activity.mock.calls.at(-1)).toEqual(['listening']);
  });
  it('does not animate recognition just because the microphone receives sound', async () => {
    const activity = vi.fn();
    await listener.start(vi.fn(), vi.fn(), vi.fn(), activity);
    play(); await Promise.resolve();
    expect(activity.mock.calls.at(-1)).toEqual(['listening']);
    expect(activity).not.toHaveBeenCalledWith('processing');
    expect(activity).not.toHaveBeenCalledWith('heard');
  });
  it('releases a stuck model job after 30 seconds and can prepare a fresh worker', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const error = vi.fn();
    await listener.start(vi.fn(), vi.fn(), error);
    workers[0].respond = false; play();
    await vi.advanceTimersByTimeAsync(30000);
    expect(error.mock.calls[0][0].reason).toBe('slow');
    expect(workers[0].terminate).toHaveBeenCalledOnce();
    expect(tracks[0].stop).toHaveBeenCalledOnce();
    expect(await listener.start(vi.fn(), vi.fn(), error)).toBe(true);
    expect(workers).toHaveLength(2);
  });

});
