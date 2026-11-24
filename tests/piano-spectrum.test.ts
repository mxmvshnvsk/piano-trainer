import {describe,it,expect} from 'vitest';
import {validatePianoPitches} from '../src/piano-spectrum';

function tone(notes:number[],amplitudes=notes.map(()=>.01),detune=0){
 return Float32Array.from({length:16000},(_,i)=>notes.reduce((v,n,k)=>v+amplitudes[k]*Math.sin(2*Math.PI*440*2**((n-69+detune/100)/12)*i/22050),0));
}
function hypotheses(notes:number[]){
 const frames=new Float32Array(45*88),onsets=new Float32Array(45*88);
 for(let i=0;i<45;i++)for(const n of notes)frames[i*88+n-21]=.8;
 return{frames,onsets};
}
describe('physical piano pitch support',()=>{
 it('rejects a missing lower fundamental inferred from an upper octave',()=>{
  const input=hypotheses([57,69]);validatePianoPitches(tone([69]),input.frames,input.onsets);
  expect(input.frames[24*88+57-21]).toBe(0);
  expect(input.frames[24*88+69-21]).toBeGreaterThan(.7);
 });
 it('preserves a real quiet bass under a louder octave',()=>{
  const input=hypotheses([57,69]);validatePianoPitches(tone([57,69],[.0005,.02]),input.frames,input.onsets);
  expect(input.frames[24*88+57-21]).toBeGreaterThan(.7);
  expect(input.frames[24*88+69-21]).toBeGreaterThan(.7);
 });
 it.each([-20,0,20])('preserves quiet notes with %i-cent tuning differences',detune=>{
  const notes=[48,66,69,73],input=hypotheses(notes);
  validatePianoPitches(tone(notes,notes.map(()=>.0005),detune),input.frames,input.onsets);
  for(const n of notes)expect(input.frames[24*88+n-21]).toBeGreaterThan(.7);
 });
 it('rejects an unpitched transient even if the model proposes a high-confidence note',()=>{
  const input=hypotheses([69]);const samples=new Float32Array(16000);samples[4096]=.8;
  validatePianoPitches(samples,input.frames,input.onsets);
  expect(input.frames.every(v=>v===0)).toBe(true);
 });
});
