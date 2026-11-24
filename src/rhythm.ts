export type Meter = '2/4' | '3/4' | '4/4' | '6/8';
export type RhythmSettings = { meter: Meter; bpm: number; pattern: 'quarter' | 'eighth' | 'half' | 'mixed'; rests: boolean; sound: boolean; subdivision: boolean; volume: number; tolerance: number; offset: number; sensitivity: number; input: 'microphone' | 'tap'; metronomeOnly: boolean };
export const rhythmDefaults: RhythmSettings = { meter:'4/4', bpm:80, pattern:'quarter', rests:false, sound:false, subdivision:false, volume:40, tolerance:100, offset:0, sensitivity:50, input:'microphone', metronomeOnly:false };
export function restoreRhythm(value: unknown): RhythmSettings {
  const next = { ...rhythmDefaults };
  if (!value || typeof value !== 'object') return next;
  const v = value as Record<string,unknown>;
  if (['2/4','3/4','4/4','6/8'].includes(v.meter as string)) next.meter = v.meter as Meter;
  if (['quarter','eighth','half','mixed'].includes(v.pattern as string)) next.pattern = v.pattern as RhythmSettings['pattern'];
  if (['microphone','tap'].includes(v.input as string)) next.input = v.input as RhythmSettings['input'];
  for (const key of ['rests','sound','subdivision','metronomeOnly'] as const) if (typeof v[key] === 'boolean') next[key] = v[key];
  const limits = {bpm:[40,180],volume:[0,100],tolerance:[40,200],offset:[-300,300],sensitivity:[0,100]};
  for (const key of Object.keys(limits) as (keyof typeof limits)[]) if (typeof v[key] === 'number' && Number.isFinite(v[key])) next[key] = Math.max(limits[key][0],Math.min(limits[key][1],v[key]));
  return next;
}
export const meterInfo = (meter: Meter) => ({ beats: meter==='6/8' ? 6 : +meter[0], unit: meter==='6/8' ? .5 : 1, quarters: meter==='6/8' ? 3 : +meter[0] });
export const quarterSeconds = (s: RhythmSettings) => 60/s.bpm/(s.meter==='6/8' ? 1.5 : 1);
export type RhythmNote = { id:number; bar:number; beat:number; duration:number; rest:boolean };
export function rhythmScore(s: RhythmSettings, bars=4): RhythmNote[] {
  const notes: RhythmNote[]=[];
  const {quarters}=meterInfo(s.meter);
  for(let bar=0;bar<bars;bar++) {
    let beat=0,index=0;
    const values = s.pattern==='eighth' ? [.5] : s.pattern==='half' ? [2] : s.pattern==='mixed' ? (s.meter==='6/8' ? [1.5,.5,.5,.5] : [1,.5,.5,2]) : [1];
    while(beat<quarters) {
      const duration=Math.min(values[index%values.length],quarters-beat);
      notes.push({id:notes.length,bar,beat:bar*quarters+beat,duration,rest:s.rests && index>0 && beat+duration===quarters && bar%2===1});
      beat+=duration; index++;
    }
  }
  return notes;
}
export type RhythmHit = { at:number; index:number | null; delta:number | null; kind:'on-time'|'early'|'late'|'extra' };
export type RhythmStats = { expected:number; matched:number; onTime:number; early:number; late:number; missed:number; extra:number; accuracy:number; meanError:number | null; bias:number | null; intervals:number; intervalAccuracy:number | null };
export class RhythmJudge {
  readonly hits: RhythmHit[]=[];
  readonly expected: {id:number;at:number}[];
  private last = -Infinity;
  constructor(notes:RhythmNote[],readonly seconds:number,readonly tolerance:number) { this.expected=notes.filter(n=>!n.rest).map(n=>({id:n.id,at:n.beat*seconds})); }
  hit(at:number):RhythmHit | null {
    // Worklet and keyboard events can be delivered more than once, or out of order.
    if(!Number.isFinite(at) || at-this.last<.07 || at < -.25) return null;
    this.last=at;
    const used = new Set(this.hits.map(h=>h.index));
    const candidate=this.expected.filter(n=>!used.has(n.id)).sort((a,b)=>Math.abs(a.at-at)-Math.abs(b.at-at))[0];
    const window=Math.min(.25,this.seconds*.45);
    const delta=candidate ? (at-candidate.at)*1000 : null;
    const hit:RhythmHit = candidate && Math.abs(at-candidate.at)<=window ? {at,index:candidate.id,delta,kind:Math.abs(delta!)<=this.tolerance?'on-time':delta!<0?'early':'late'} : {at,index:null,delta:null,kind:'extra'};
    this.hits.push(hit); return hit;
  }
  stats(until=Infinity):RhythmStats {
    const due=this.expected.filter(n=>n.at<=until);
    const matched=this.hits.filter(h=>h.index!==null && due.some(n=>n.id===h.index));
    const deltas=matched.map(h=>h.delta!);
    const intervals:number[]=[];
    for(let i=1;i<this.expected.length;i++) {
      const a=matched.find(h=>h.index===this.expected[i-1].id),b=matched.find(h=>h.index===this.expected[i].id);
      if(a&&b) intervals.push(Math.abs((b.at-a.at)-(this.expected[i].at-this.expected[i-1].at))*1000);
    }
    const onTime=matched.filter(h=>h.kind==='on-time').length;
    return {expected:due.length,matched:matched.length,onTime,early:matched.filter(h=>h.kind==='early').length,late:matched.filter(h=>h.kind==='late').length,missed:due.length-matched.length,extra:this.hits.filter(h=>h.kind==='extra').length,accuracy:due.length?Math.round(onTime/(due.length+this.hits.filter(h=>h.kind==='extra').length)*100):0,meanError:deltas.length?Math.round(deltas.reduce((n,d)=>n+Math.abs(d),0)/deltas.length):null,bias:deltas.length?Math.round(deltas.reduce((n,d)=>n+d,0)/deltas.length):null,intervals:intervals.length,intervalAccuracy:intervals.length?Math.round(intervals.filter(d=>d<=this.tolerance).length/intervals.length*100):null};
  }
}
