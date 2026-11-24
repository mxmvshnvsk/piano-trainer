import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { meterInfo, quarterSeconds, restoreRhythm, rhythmDefaults, rhythmScore, RhythmJudge, type Meter } from '../src/rhythm';

describe('rhythm score and grading',()=>{
  it('fills four complete bars for all meters and note-value choices',()=>{
    for(const meter of ['2/4','3/4','4/4','6/8'] as Meter[])for(const pattern of ['quarter','half','eighth','mixed'] as const) {
      const notes=rhythmScore({...rhythmDefaults,meter,pattern,rests:true});
      for(let bar=0;bar<4;bar++)expect(notes.filter(n=>n.bar===bar).reduce((sum,n)=>sum+n.duration,0)).toBe(meterInfo(meter).quarters);
      expect(notes.every(n=>n.duration>0)).toBe(true);
      expect(notes.map(n=>n.id)).toEqual(notes.map((_,i)=>i));
    }
  });
  it('defines 6/8 BPM as dotted-quarter pulses, not eighth notes',()=>{
    expect(quarterSeconds({...rhythmDefaults,meter:'6/8',bpm:60})*3).toBe(2);
    expect(quarterSeconds({...rhythmDefaults,meter:'3/4',bpm:60})*3).toBe(3);
  });
  it('counts accurate, early, late, missed and extra hits independently',()=>{
    const judge=new RhythmJudge(rhythmScore(rhythmDefaults,1),.6,60);
    judge.hit(.02);judge.hit(.5);judge.hit(1.31);judge.hit(1.5);
    expect(judge.stats()).toMatchObject({expected:4,matched:3,onTime:1,early:1,late:1,missed:1,extra:1,accuracy:20});
  });
  it('does not match count-in, duplicate, out-of-order or non-finite input',()=>{
    const judge=new RhythmJudge(rhythmScore(rhythmDefaults,1),.75,100);
    expect(judge.hit(-.5)).toBeNull();expect(judge.hit(NaN)).toBeNull();
    judge.hit(.01);expect(judge.hit(.02)).toBeNull();expect(judge.hit(-.01)).toBeNull();
    expect(judge.stats(.3)).toMatchObject({expected:1,onTime:1,missed:0});
  });
  it('penalizes attacks in rests and grades intervals including the rest',()=>{
    const notes=rhythmScore({...rhythmDefaults,rests:true},2);
    const judge=new RhythmJudge(notes,.6,50);
    for(const note of notes)judge.hit(note.beat*.6);
    expect(judge.stats()).toMatchObject({expected:7,onTime:7,extra:1,intervals:6,intervalAccuracy:100});
  });
  it('distinguishes steady durations from accurate absolute timing',()=>{
    const judge=new RhythmJudge(rhythmScore(rhythmDefaults,1),.75,60);
    for(const at of [.1,.85,1.6,2.35])judge.hit(at);
    expect(judge.stats()).toMatchObject({late:4,accuracy:0,intervalAccuracy:100,meanError:100,bias:100});
  });
  it('sanitizes persisted settings and keeps meaningful bounds',()=>{
    expect(restoreRhythm({bpm:Infinity,offset:-999,tolerance:0,pattern:'whatever',meter:'5/9',input:'file'})).toMatchObject({bpm:80,offset:-300,tolerance:40,pattern:'quarter',meter:'4/4',input:'microphone'});
  });
});

describe('microphone rhythm attack detector',()=>{
  function detect(signal:(at:number)=>number,duration:number) {
    const events:{type:string;at?:number}[]=[];
    let Processor:any;
    const scope:any={AudioWorkletProcessor:class {port={postMessage:(event:typeof events[number])=>events.push(event)};},registerProcessor:(_name:string,processor:unknown)=>{Processor=processor;},sampleRate:48000,currentFrame:0};
    runInNewContext(readFileSync('public/rhythm-worklet.js','utf8'),scope);
    const processor=new Processor({processorOptions:{threshold:.01}});
    for(let frame=0;frame<48000*duration;frame+=128) {
      scope.currentFrame=frame;
      const input=Float32Array.from({length:128},(_,i)=>signal((frame+i)/48000));
      processor.process([[input]]);
    }
    return events.filter(e=>e.type==='attack').map(e=>e.at!);
  }
  it('timestamps two piano-like attacks and does not retrigger their decays',()=>{
    const onsets=[.2,.9];
    const attacks=detect(at=>onsets.reduce((sum,start)=>{
      const age=at-start;
      return sum+(age>=0?.14*Math.min(1,age/.004)*Math.exp(-age*7)*(Math.sin(2*Math.PI*261.63*age)+.2*Math.sin(2*Math.PI*523.26*age)):0);
    },0),1.8);
    expect(attacks).toHaveLength(2);
    expect(Math.abs(attacks[0]-.2)).toBeLessThan(.03);expect(Math.abs(attacks[1]-.9)).toBeLessThan(.03);
  });
  it('ignores silence and quiet background noise',()=>{
    expect(detect(()=>0,1)).toEqual([]);
    expect(detect(at=>.001*Math.sin(at*15000)+.0005*Math.sin(at*9300),1)).toEqual([]);
  });
});
