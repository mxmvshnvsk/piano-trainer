import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {RhythmAudio} from '../src/rhythm-audio';
import {rhythmDefaults} from '../src/rhythm';

describe('audio-clock metronome scheduling',()=>{
  let starts:{at:number;frequency:number}[];
  let closed:boolean;
  let engine:RhythmAudio;
  beforeEach(()=>{
    vi.useFakeTimers();vi.setSystemTime(0);starts=[];closed=false;engine=new RhythmAudio();
    class Context {
      destination={};get currentTime(){return Date.now()/1000;}
      resume=async()=>{};close=async()=>{closed=true;};
      createOscillator(){return {frequency:{value:0},connect:()=>{},disconnect:()=>{},onended:null,start(at:number){starts.push({at,frequency:this.frequency.value});},stop:()=>{}};}
      createGain(){return {gain:{value:0,setValueAtTime:()=>{},linearRampToValueAtTime:()=>{},exponentialRampToValueAtTime:()=>{}},connect:()=>{},disconnect:()=>{}};}
    }
    vi.stubGlobal('AudioContext',Context);
  });
  afterEach(()=>{engine.stop();vi.unstubAllGlobals();vi.useRealTimers();});
  it('schedules two dotted-quarter pulses per 6/8 bar and accents each bar',async()=>{
    await engine.start({...rhythmDefaults,meter:'6/8',bpm:60,sound:true,metronomeOnly:true},()=>{},()=>{},()=>{});
    await vi.advanceTimersByTimeAsync(2300);
    expect(starts.map(s=>s.at)).toEqual([.2,1.2,2.2]);
    expect(starts.map(s=>s.frequency)).toEqual([1400,1100,1400]);
  });
  it('subdivides into eighths while preserving the main accents',async()=>{
    await engine.start({...rhythmDefaults,meter:'6/8',bpm:60,sound:true,subdivision:true,metronomeOnly:true},()=>{},()=>{},()=>{});
    await vi.advanceTimersByTimeAsync(2100);
    expect(starts.slice(0,6).map(s=>s.frequency)).toEqual([1400,850,850,1100,850,850]);
    expect(starts[1].at-starts[0].at).toBeCloseTo(1/3);
  });
  it('stops scheduling and closes audio, including when sound is disabled',async()=>{
    await engine.start({...rhythmDefaults,sound:true,metronomeOnly:true},()=>{},()=>{},()=>{});
    await vi.advanceTimersByTimeAsync(500);const count=starts.length;
    engine.stop();await vi.advanceTimersByTimeAsync(5000);
    expect(starts).toHaveLength(count);expect(closed).toBe(true);
    await engine.start({...rhythmDefaults,sound:false,metronomeOnly:true},()=>{},()=>{},()=>{});
    await vi.advanceTimersByTimeAsync(1000);expect(starts).toHaveLength(count);
  });
});
