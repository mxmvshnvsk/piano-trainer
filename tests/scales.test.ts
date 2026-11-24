import {describe,expect,it} from 'vitest';
import {createExercise,defaults,exerciseScale,exerciseSteps,restoreSettings,type Exercise} from '../src/music';
import {diatonicModes,scales,type ScaleType} from '../src/scales';

describe('explicit scales and modes',()=>{
  it('builds D Dorian with its natural sixth regardless of mood and chord complexity',()=>{
    const exercise=createExercise({...defaults,kind:'scale',scaleMode:'dorian',scaleTonic:2,mood:'oppressive',level:'extended'},undefined,()=>0);
    expect(exercise.root).toBe(62);expect(exercise.scale).toBe('dorian');
    expect(exerciseSteps(exercise).map(s=>s.notes)).toEqual([[62],[64],[65],[67],[69],[71],[72],[74]]);
    expect(exerciseSteps(exercise).every(s=>s.label==='D')).toBe(true);
  });
  it('transposes every scale to all twelve tonics with exactly one upper tonic',()=>{
    for(const scaleMode of Object.keys(scales) as ScaleType[])for(let scaleTonic=0;scaleTonic<12;scaleTonic++) {
      const e=createExercise({...defaults,kind:'scale',scaleMode,scaleTonic},undefined,()=>0);
      const values=exerciseSteps(e).map(s=>s.notes[0]);
      expect(values).toEqual([...scales[scaleMode].notes,12].map(n=>60+scaleTonic+n));
      expect(new Set(values).size).toBe(values.length);
      expect(values.every((n,i)=>!i||n>values[i-1])).toBe(true);
    }
  });
  it('freezes the randomly resolved mode in saved exercises and identity',()=>{
    const e=createExercise({...defaults,kind:'scale',scaleMode:'diatonic'},undefined,()=>.4);
    expect(diatonicModes).toContain(e.scale);
    expect(exerciseScale(JSON.parse(JSON.stringify(e)))).toBe(e.scale);
    const settings={...defaults,kind:'scale' as const,scaleTonic:0};
    expect(createExercise({...settings,scaleMode:'dorian'},undefined,()=>0).id).not.toBe(createExercise({...settings,scaleMode:'aeolian'},undefined,()=>0).id);
  });
  it('retains the actual notes of legacy saved mood-based scales',()=>{
    const old={id:'old',root:60,chord:'major',settings:{...defaults,kind:'scale',mood:'fantasy'}} as Exercise;
    expect(exerciseScale(old)).toBe('lydian');
    expect(exerciseSteps(old).map(s=>s.notes[0])).toEqual([60,62,64,66,67,69,71,72]);
    const next=createExercise({...old.settings,scaleMode:'auto'},undefined,()=>0);
    expect(next.scale).toBe('ionian');
  });
  it('validates persisted mode/tonic and keeps hand and octave assignments',()=>{
    expect(restoreSettings({scaleMode:'dorian',scaleTonic:2})).toMatchObject({scaleMode:'dorian',scaleTonic:2});
    expect(restoreSettings({scaleMode:'unknown',scaleTonic:12})).toMatchObject({scaleMode:'auto',scaleTonic:'any'});
    const e=createExercise({...defaults,kind:'scale',scaleMode:'minorPentatonic',scaleTonic:9,hand:'both',octave:5},undefined,()=>0);
    expect(exerciseSteps(e)[0]).toMatchObject({left:[69],right:[81],notes:[69,81]});
    expect(exerciseSteps(e)).toHaveLength(6);
  });
});
