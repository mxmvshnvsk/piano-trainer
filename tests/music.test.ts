import { describe, expect, it } from 'vitest';
import { chords, compareNotes, createExercise, defaults, exerciseSteps, moods, playingMode, restoreSettings } from '../src/music';
import { Evaluator } from '../src/evaluation';
import { chordName } from '../src/i18n';

describe('exercise generation', () => {
  it('offers valid three/four-note exercises in every mood', () => {
    for (const mood of Object.keys(moods)) for (const level of ['triads','extended'] as const) {
      const e = createExercise({ ...defaults, mood, level });
      expect(chords[e.chord].intervals).toHaveLength(level === 'triads' ? 3 : 4);
      expect(moods[mood]).toContain(e.chord);
    }
  });
  it('keeps beginner exercises familiar in every mood, including old basic settings', () => {
    for (const mood of Object.keys(moods)) for (const random of [()=>0,()=>.99]) {
      const e=createExercise(restoreSettings({level:'basic',mood}),undefined,random);
      expect(['major','minor']).toContain(e.chord);
      expect(exerciseSteps(e).every(s=>!s.label.includes('aug')&&!s.label.includes('dim')&&!s.label.includes('sus'))).toBe(true);
    }
  });
  it('explains symbols and carries the actual chord of each progression step', () => {
    expect(chordName(64,'minor','ru')).toBe('Ми минор');
    expect(chordName(64,'dim','ru')).toBe('Ми · уменьшённое трезвучие');
    expect(chordName(69,'aug','en')).toBe('A · augmented triad');
    const e={id:'names',root:60,chord:'minor' as const,settings:{...defaults,kind:'progression' as const}};
    const steps=exerciseSteps(e);
    expect(chordName(steps[2].root!,steps[2].chord!,'ru')).toBe('Соль мажор');
  });
  it('moves in both directions around the circle and avoids immediate random repeats', () => {
    const first = createExercise(defaults, undefined, () => 0);
    expect(createExercise({ ...defaults, order:'fifths' }, first).root % 12).toBe(7);
    expect(createExercise({ ...defaults, order:'fourths' }, first).root % 12).toBe(5);
    expect(createExercise(defaults, first, () => 0).root % 12).not.toBe(first.root % 12);
  });
  it('keeps every tone of extended inversions and puts the open bass in the great octave', () => {
    const settings = { ...defaults, hand:'both' as const, voicing:'wide' as const };
    const e = { id:'test',root:69,chord:'maj7' as const,settings };
    const step = exerciseSteps(e)[0];
    expect(step.left).toEqual([45]); expect(step.right).toEqual([73,76,80]);
    expect(exerciseSteps({ ...e, settings:{ ...settings, hand:'right',voicing:'first' } })[0].notes).toEqual([73,76,80,81]);
  });
  it('requires both hands on each scale step, without alternating them', () => {
    const steps = exerciseSteps({ id:'scale',root:60,chord:'major',settings:{ ...defaults, hand:'both',kind:'scale' } });
    expect(steps).toHaveLength(8); expect(steps[0].notes).toEqual([48,60]); expect(steps[7].notes).toEqual([60,72]);
  });
  it('breaks a chord into its voiced notes without adding a tonic', () => {
    const e = { id:'broken',root:69,chord:'minor' as const,settings:{ ...defaults,chordPlaying:'sequential' as const,voicing:'first' as const } };
    expect(exerciseSteps(e).map(s=>s.notes)).toEqual([[72],[76],[81]]);
    const wide = exerciseSteps({ ...e,settings:{ ...e.settings,hand:'both',voicing:'wide' } });
    expect(wide.map(s=>s.notes)).toEqual([[45],[72],[76]]);
    expect(wide[0].left).toEqual([45]); expect(wide[1].right).toEqual([72]);
  });
  it('alternates styles but freezes a saved exercise style and identity', () => {
    const settings = { ...defaults,chordPlaying:'alternating' as const };
    const first=createExercise(settings,undefined,()=>0), second=createExercise(settings,first,()=>0), third=createExercise(settings,second,()=>0);
    expect([first,second,third].map(playingMode)).toEqual(['together','sequential','together']);
    expect(playingMode(JSON.parse(JSON.stringify(second)))).toBe('sequential');
    expect(createExercise({...defaults,chordPlaying:'together'},undefined,()=>0).id).not.toBe(createExercise({...defaults,chordPlaying:'sequential'},undefined,()=>0).id);
    expect(restoreSettings({}).chordPlaying).toBe('together');
  });
  it('plays each chord of a progression sequentially when requested', () => {
    const e={id:'progression',root:60,chord:'major' as const,settings:{...defaults,kind:'progression' as const,chordPlaying:'sequential' as const}};
    const steps=exerciseSteps(e);
    expect(steps).toHaveLength(9);
    expect(steps.map(s=>s.label)).toEqual(['C','C','C','F','F','F','G','G','G']);
    expect(steps.every(s=>s.notes.length===1)).toBe(true);
  });
  it('keeps device noise profiles out of saved exercise settings',()=>{
    const settings={...defaults,microphoneNoiseProfile:new Array(1025).fill(.001)};
    expect(createExercise(settings).settings.microphoneNoiseProfile).toEqual([]);
    expect(settings.microphoneNoiseProfile).toHaveLength(1025);
  });
  it('restores microphone sensitivity without breaking older saved exercises', () => {
    expect(restoreSettings({}).microphoneSensitivity).toBe(50);
    expect(restoreSettings({}).microphoneNoiseFloor).toBe(0);
    expect(restoreSettings({microphoneNoiseFloor:.003}).microphoneNoiseProfile).toEqual([]);
    const profile=new Array(1025).fill(.001);
    expect(restoreSettings({microphoneNoiseProfile:profile}).microphoneNoiseProfile).toEqual(profile);
    expect(restoreSettings({microphoneNoiseProfile:[NaN]}).microphoneNoiseProfile).toEqual([]);
    expect(restoreSettings({microphoneNoiseFloor:.003}).microphoneNoiseFloor).toBe(.003);
    expect(restoreSettings({microphoneNoiseFloor:Infinity}).microphoneNoiseFloor).toBe(0);
    expect(restoreSettings({microphoneSensitivity:78}).microphoneSensitivity).toBe(78);
    expect(restoreSettings({microphoneSensitivity:1000}).microphoneSensitivity).toBe(100);
    expect(restoreSettings({microphoneSensitivity:-10}).microphoneSensitivity).toBe(0);
    expect(restoreSettings({microphoneSensitivity:NaN}).microphoneSensitivity).toBe(50);
  });
  it('validates corrupt persisted settings', () => {
    expect(restoreSettings({ hand:'feet', kind:'free', seconds:NaN, octave:7, mood:'unknown' })).toEqual(defaults);
    expect(restoreSettings({ seconds:10000, gap:-5 }).seconds).toBe(60);
    expect(restoreSettings(null)).toEqual(defaults);
  });
});
describe('evaluation', () => {
  const chord = [{ label:'Am', notes:[69,72,76], left:[],right:[69,72,76] }];
  it('never accepts arpeggiated notes as a simultaneous chord', () => {
    const e = new Evaluator(chord);
    for (let i=0;i<30;i++) e.push({at:i*.03,notes:[[69],[72],[76]][Math.floor(i/10)],confidence:.95});
    expect(e.index).toBe(0);
  });
  it('requires stable matching evidence and rejects low confidence', () => {
    const e = new Evaluator(chord);
    expect(e.push({at:0,notes:[69,72,76],confidence:.3}).complete).toBe(false);
    expect(e.push({at:.2,notes:[69,72,76],confidence:.9}).complete).toBe(false);
    expect(e.push({at:.32,notes:[69,72,76],confidence:.9}).complete).toBe(true);
  });
  it('rejects a rolled-and-held chord in together mode', () => {
    const e = new Evaluator([{...chord[0],requireTogether:true}]);
    e.push({at:0,notes:[69],onsets:[69],confidence:.9});
    e.push({at:.3,notes:[69,72],onsets:[72],confidence:.9});
    e.push({at:.6,notes:[69,72,76],onsets:[76],confidence:.9});
    expect(e.push({at:.8,notes:[69,72,76],onsets:[],confidence:.9}).complete).toBe(false);
    expect(e.feedback().type).toBe('timing');
    e.push({at:1.2,notes:[69,72,76],onsets:[69,72,76],confidence:.9});
    expect(e.push({at:1.35,notes:[69,72,76],onsets:[],confidence:.9}).complete).toBe(true);
  });
  it('requires a broken chord in order and does not accept a block chord for it', () => {
    const steps = exerciseSteps({id:'sequential',root:69,chord:'minor',settings:{...defaults,chordPlaying:'sequential'}});
    const e=new Evaluator(steps);
    for(let i=0;i<5;i++)e.push({at:i*.2,notes:[69,72,76],confidence:.9});
    expect(e.index).toBe(0);
    for(const [i,note] of [69,72,76].entries()){
      e.push({at:2+i*.4,notes:[note],confidence:.9});e.push({at:2.15+i*.4,notes:[note],confidence:.9});
    }
    expect(e.index).toBe(3);
  });
  it('ignores duplicated/overlapping frames and checks sequence order', () => {
    const e = new Evaluator([{...chord[0],notes:[60]},{...chord[0],notes:[62]}]);
    e.push({at:0,notes:[62],confidence:.9}); e.push({at:.2,notes:[62],confidence:.9});
    expect(e.index).toBe(0);
    e.push({at:.4,notes:[60],confidence:.9}); e.push({at:.52,notes:[60],confidence:.9});
    e.push({at:.3,notes:[62],confidence:.9}); expect(e.index).toBe(1);
    e.push({at:.8,notes:[62],confidence:.9}); expect(e.push({at:.93,notes:[62],confidence:.9}).complete).toBe(true);
  });
  it('distinguishes wrong notes, wrong octaves, and silence', () => {
    expect(compareNotes([69,72,76],[57,60,64]).type).toBe('octave');
    expect(compareNotes([69,72,76],[69,72,75])).toEqual({type:'notes',missing:[76],extra:[75]});
    expect(compareNotes([69,72,76],[]).type).toBe('uncertain');
  });
});
