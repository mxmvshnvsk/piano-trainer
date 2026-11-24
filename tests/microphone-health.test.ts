import { describe, expect, it } from 'vitest';
import { microphoneHealth, microphoneHealthText } from '../src/microphone-health';
const base={seconds:4,sinceNotes:4,sinceAudible:0,inputPeak:.2};
describe('actionable microphone health',()=>{
  it('allows startup and recent successful notes without a warning',()=>{
    expect(microphoneHealth({...base,seconds:1,sinceAudible:10})).toBe('good');
    expect(microphoneHealth({...base,sinceNotes:.5,analysis:'uncertain'})).toBe('good');
  });
  it('distinguishes weak input from confirmed background suppression',()=>{
    expect(microphoneHealth({...base,sinceAudible:2})).toBe('quiet');
    expect(microphoneHealth({...base,analysis:'noise'})).toBe('noise');
    expect(microphoneHealth({...base,analysis:'uncertain'})).toBe('uncertain');
  });
  it('does not infer noise merely from volume and reports clipping immediately',()=>{
    expect(microphoneHealth({...base,inputPeak:.8})).toBe('good');
    expect(microphoneHealth({...base,seconds:.1,inputPeak:.99})).toBe('clipping');
  });
  it('provides actionable copy in both languages',()=>{
    expect(microphoneHealthText('quiet','ru')).toContain('громкость пианино');
    expect(microphoneHealthText('noise','en')).toContain('Background');
  });
});
