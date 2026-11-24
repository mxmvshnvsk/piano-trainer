import { describe, expect, it } from 'vitest';
import { filterPianoOvertones, PianoOvertoneMemory } from '../src/piano-overtones';
function input(upper = .5, onset = .6, delay = 0) {
  const frames = new Float32Array(80 * 88), onsets = new Float32Array(80 * 88);
  for (let i = 5; i < 80; i++) frames[i * 88 + 60 - 21] = .85;
  for (let i = 5 + delay; i < 80; i++) frames[i * 88 + 72 - 21] = upper;
  onsets[5 * 88 + 60 - 21] = .9; onsets[(5 + delay) * 88 + 72 - 21] = onset;
  return { frames, onsets };
}
describe('weak octave overtone hypotheses', () => {
  it('remembers a rejected partial across windows even when its onset head becomes weak',()=>{
    const memory=new PianoOvertoneMemory(),first=input();
    filterPianoOvertones(first.frames,first.onsets,undefined,memory,0);
    const later=input(.62,.2);
    filterPianoOvertones(later.frames,later.onsets,undefined,memory,.4);
    expect(later.frames[50*88+72-21]).toBe(0);
    const genuine=input(.8,.8);
    filterPianoOvertones(genuine.frames,genuine.onsets,undefined,memory,.8);
    expect(genuine.frames[50*88+72-21]).toBeGreaterThan(.7);
  });
  it('forgets rejected partials after silence or a new capture',()=>{
    const memory=new PianoOvertoneMemory(),first=input();
    filterPianoOvertones(first.frames,first.onsets,undefined,memory,0);
    filterPianoOvertones(new Float32Array(80*88),new Float32Array(80*88),undefined,memory,2);
    expect(memory.notes.size).toBe(0);
    filterPianoOvertones(input().frames,input().onsets,undefined,memory,3);
    memory.clear();expect(memory.notes.size).toBe(0);
  });
  it('allows a quiet genuine upper entry after an earlier rejected partial',()=>{
    const memory=new PianoOvertoneMemory();memory.notes.set(51,{independent:false,last:.5});
    const result=input(.6,.2);result.onsets[35*88+51]=.6;
    const samples=Float32Array.from({length:24000},(_,i)=>{
      const time=i/22050,f=440*2**((60-69)/12);
      let value=Math.sin(2*Math.PI*f*time)+.8*Math.sin(2*Math.PI*f*2*time)+.03*Math.sin(2*Math.PI*f*4*time);
      if(time>=.36)for(let h=1;h<=6;h++)value+=.35/h**1.4*Math.sin(2*Math.PI*f*2*h*time);
      return value*.01;
    });
    filterPianoOvertones(result.frames,result.onsets,samples,memory,.3);
    expect(memory.notes.get(51)?.independent).toBe(true);
    expect(result.frames[50*88+51]).toBeGreaterThan(.5);
  });
  it('rejects a weak upper octave explained by a stronger simultaneous lower note', () => {
    const result = input(); filterPianoOvertones(result.frames, result.onsets);
    expect(result.frames[20 * 88 + 72 - 21]).toBe(0);
    expect(result.frames[20 * 88 + 60 - 21]).toBeGreaterThan(.8);
  });
  it.each([[.8,.6,0],[.5,.85,0],[.6,.55,0],[.5,.6,20]])('keeps a confirmed, clearly attacked, sustained soft, or separately entered upper note (%j)', (strength, onset, delay) => {
    const result = input(strength,onset,delay); filterPianoOvertones(result.frames,result.onsets);
    expect(result.frames[50 * 88 + 72 - 21]).toBeGreaterThan(0);
  });
  it('does not reject a quiet bass or an isolated upper note', () => {
    const result=input(.85,.9);
    for(let i=0;i<80;i++)result.frames[i*88+60-21]=.4;
    filterPianoOvertones(result.frames,result.onsets);
    expect(result.frames[20*88+60-21]).toBeCloseTo(.4);
    expect(result.frames[20*88+72-21]).toBeGreaterThan(.8);
  });
  it('rejects a weak held octave partial at an overlapping window boundary', () => {
    const result=input(.4,.2);
    for(let i=0;i<5;i++) { result.frames[i*88+60-21]=.85;result.frames[i*88+72-21]=.4; }
    result.onsets.fill(0);
    filterPianoOvertones(result.frames,result.onsets);
    expect(result.frames[20*88+72-21]).toBe(0);
  });
});
