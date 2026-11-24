import { describe, expect, it } from 'vitest';
import { estimateNoiseProfile, NOISE_PROFILE_SIZE, restoreNoiseProfile, suppressPianoNoise } from '../src/piano-noise';
import { signalLevel } from '../src/audio-signal';
import { streetNoise } from './fixtures/piano-audio';
const profile = estimateNoiseProfile(streetNoise(44100,.003,247));
describe('piano noise profile',()=>{
  it('rejects invalid persisted profiles and keeps an independent copy',()=>{
    expect(restoreNoiseProfile(profile)).toHaveLength(NOISE_PROFILE_SIZE);
    expect(restoreNoiseProfile(profile)).not.toBe(profile);
    for(const invalid of [null,[],[1,2],new Array(NOISE_PROFILE_SIZE).fill(-1),new Array(NOISE_PROFILE_SIZE).fill(Infinity)]) expect(restoreNoiseProfile(invalid)).toEqual([]);
  });
  it('suppresses an independently sampled background without adding delay or samples',()=>{
    const input=streetNoise(22050,.003,64);
    const cleaned=suppressPianoNoise(input,profile);
    expect(cleaned).toHaveLength(input.length);
    expect(signalLevel(cleaned).rms).toBeLessThan(signalLevel(input).rms*.3);
  });
  it.each([65.406,130.813,369.994,1046.502])('preserves a piano fundamental at %f Hz',frequency=>{
    const input=Float32Array.from({length:22050},(_,i)=>.025*Math.sin(2*Math.PI*frequency*i/22050));
    const cleaned=suppressPianoNoise(input,profile);
    let correlation=0,original=0,result=0;
    for(let i=2048;i<input.length-2048;i++){correlation+=input[i]*cleaned[i];original+=input[i]**2;result+=cleaned[i]**2;}
    expect(correlation/Math.sqrt(original*result)).toBeGreaterThan(.98);
    expect(Math.sqrt(result/original)).toBeGreaterThan(.9);
  });
  it('keeps profile units correct when the user changes microphone gain',()=>{
    const input=streetNoise(12000,.003,11);
    const normal=suppressPianoNoise(input,profile);
    const boosted=suppressPianoNoise(input.map(value=>value*4),profile,4);
    expect(Math.max(...normal.map((value,i)=>Math.abs(value-boosted[i]/4)))).toBeLessThan(.000001);
  });
  it('does not modify input without a measured profile',()=>{
    const input=streetNoise(4096);
    expect(suppressPianoNoise(input,[])).toEqual(input);
    expect(estimateNoiseProfile(new Float32Array(100))).toEqual([]);
  });
});
