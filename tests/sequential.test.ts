import { describe, expect, it } from 'vitest';
import { Evaluator, type Frame } from '../src/evaluation';
const steps=(notes=[60,64,67])=>notes.map(note=>({label:'C',notes:[note],left:[],right:[note]}));
function frame(at:number,notes:number[],onsetTimes:Record<number,number>,onsets:number[]=[]):Frame {
  return {at,notes,onsetTimes,onsets,confidence:.85,strengths:Object.fromEntries(notes.map(n=>[n,.85]))};
}
describe('sequential piano notes',()=>{
  it('accepts ordered notes while earlier accepted tones are still sounding',()=>{
    const e=new Evaluator(steps());
    for(const at of [0,.05,.11])e.push(frame(at,[60],{60:0},at===0?[60]:[]));
    expect(e.index).toBe(1);
    for(const at of [.3,.35,.41])e.push(frame(at,[60,64],{60:0,64:.3},at===.3?[64]:[]));
    expect(e.index).toBe(2);expect(e.liveFeedback()).toBeNull();
    for(const at of [.6,.65,.71])e.push(frame(at,[60,64,67],{60:0,64:.3,67:.6},at===.6?[67]:[]));
    expect(e.index).toBe(3);
  });
  it('does not accept a simultaneous chord or a note played out of order',()=>{
    const e=new Evaluator(steps());
    for(const at of [0,.1,.2,.3])e.push(frame(at,[60,64,67],{60:0,64:0,67:0},at===0?[60,64,67]:[]));
    expect(e.index).toBe(0);
    for(const at of [.6,.71])e.push(frame(at,[60],{60:.6},at===.6?[60]:[]));
    for(const at of [1,1.12,1.24])e.push(frame(at,[60,67],{60:.6,67:1},at===1?[67]:[]));
    expect(e.index).toBe(1);expect(e.liveFeedback()?.feedback.extra).toEqual([67]);
  });
  it('does not ignore a genuinely rearticulated wrong previous note',()=>{
    const e=new Evaluator(steps());
    for(const at of [0,.11])e.push(frame(at,[60],{60:0},at===0?[60]:[]));
    expect(e.relevantNotes(frame(.4,[60,64],{60:.4,64:.4},[60,64]))).toEqual([60,64]);
    expect(e.relevantNotes(frame(.4,[60,64],{60:0,64:.4},[64]))).toEqual([64]);
  });
  it('requires a fresh attack when the same pitch is requested again',()=>{
    const e=new Evaluator(steps([60,60]));
    for(const at of [0,.11,.2,.31,.42])e.push(frame(at,[60],{60:0},at===0?[60]:[]));
    expect(e.index).toBe(1);
    e.push(frame(.55,[],{}));
    for(const at of [.7,.81])e.push(frame(at,[60],{60:.7},at===.7?[60]:[]));
    expect(e.index).toBe(2);
  });
});
