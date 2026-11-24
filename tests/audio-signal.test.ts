import { describe, expect, it, vi, afterEach } from 'vitest';
import { preparePianoWindow, resumeAudio, signalLevel, StreamingResampler } from '../src/audio-signal';

describe('quiet microphone signal', () => {
  it('amplifies a quiet musical waveform and removes DC without clipping louder input', () => {
    const quiet = Float32Array.from({ length: 44100 }, (_, i) => .005 * Math.sin(2 * Math.PI * 440 * i / 22050) + .01);
    const prepared = preparePianoWindow(quiet);
    expect(signalLevel(prepared).rms / signalLevel(quiet).rms).toBeCloseTo(16);
    expect(signalLevel(prepared).mean).toBeCloseTo(0, 6);
    const loud = Float32Array.from(quiet, n => (n - .01) * 120);
    expect(signalLevel(preparePianoWindow(loud)).peak).toBeCloseTo(.6);
  });
  it('does not amplify silence, DC offset or low-level noise', () => {
    expect(preparePianoWindow(new Float32Array(2048))).toEqual(new Float32Array(2048));
    expect(signalLevel(preparePianoWindow(new Float32Array(2048).fill(.02))).peak).toBe(0);
    const noise = Float32Array.from({ length: 2048 }, (_, i) => i % 2 ? .0003 : -.0003);
    expect(preparePianoWindow(noise)).toEqual(new Float32Array(noise.length));
  });
});

describe('device sample rate conversion', () => {
  it.each([44100, 48000])('keeps pitch and duration at %i Hz across worklet blocks', from => {
    const input = Float32Array.from({ length: from }, (_, i) => Math.sin(2 * Math.PI * 440 * i / from));
    const resampler = new StreamingResampler(from, 22050);
    const blocks: number[] = [];
    for (let i = 0; i < input.length; i += 2048) blocks.push(...resampler.push(input.slice(i, i + 2048)));
    const whole = new StreamingResampler(from, 22050).push(input);
    expect(blocks.length).toBe(22050);
    expect(blocks.length).toBe(whole.length);
    expect(Math.max(...blocks.map((sample, i) => Math.abs(sample - whole[i])))).toBeLessThan(.00001);
    const crossings = blocks.filter((sample, i) => i > 0 && sample >= 0 && blocks[i - 1] < 0).length;
    expect(crossings).toBeGreaterThanOrEqual(439); expect(crossings).toBeLessThanOrEqual(440);
  });
});

describe('browser audio activation', () => {
  afterEach(() => vi.useRealTimers());
  it('does not resume an already running context', async () => {
    const context = { state: 'running', resume: vi.fn() };
    await resumeAudio(context as unknown as AudioContext);
    expect(context.resume).not.toHaveBeenCalled();
  });
  it('resumes a context interrupted when microphone access is granted', async () => {
    const context = { state: 'interrupted', resume: vi.fn(async () => { context.state = 'running'; }) };
    await resumeAudio(context as unknown as AudioContext);
    expect(context.state).toBe('running');
  });
  it('bounds a pending Safari resume instead of leaving preparation stuck', async () => {
    vi.useFakeTimers();
    const context = { state: 'suspended', resume: () => new Promise(() => {}) };
    const result = expect(resumeAudio(context as unknown as AudioContext)).rejects.toThrow('audio-resume-timeout');
    await vi.advanceTimersByTimeAsync(5000); await result;
    expect(vi.getTimerCount()).toBe(0);
  });
});
