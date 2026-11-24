import { describe, expect, it } from 'vitest';
import { Evaluator } from '../src/evaluation';
import { feedbackText } from '../src/feedback';
import { defaults, restoreSettings } from '../src/music';

const step={label:'Am',notes:[69,72,76],left:[],right:[69,72,76]};
describe('live feedback',()=>{
  it('reports a sustained wrong note before the attempt ends and allows correction',()=>{
    const evaluator=new Evaluator([step]);
    for(const at of [0,.1,.24])evaluator.push({at,notes:[69,72,75],confidence:.9});
    expect(evaluator.index).toBe(0);
    expect(evaluator.liveFeedback()?.feedback).toEqual({type:'notes',missing:[76],extra:[75]});
    evaluator.push({at:.4,notes:[69,72,76],confidence:.9});
    expect(evaluator.liveFeedback()).toBeNull();
    expect(evaluator.push({at:.52,notes:[69,72,76],confidence:.9}).complete).toBe(true);
  });
  it('does not flash an error during a staggered attack, silence, or uncertain input',()=>{
    const evaluator=new Evaluator([step]);
    evaluator.push({at:0,notes:[69],confidence:.95});
    evaluator.push({at:.15,notes:[69,72],confidence:.95});
    expect(evaluator.liveFeedback()).toBeNull();
    evaluator.push({at:.3,notes:[69,72,75],confidence:.4});
    evaluator.push({at:.6,notes:[69,72,75],confidence:.4});
    expect(evaluator.liveFeedback()).toBeNull();
    evaluator.push({at:.7,notes:[],confidence:0});
    expect(evaluator.liveFeedback()).toBeNull();
  });
  it('gives held incomplete chords a longer grace period',()=>{
    const evaluator=new Evaluator([step]);
    for(const at of [0,.15,.3,.45])evaluator.push({at,notes:[69,72],confidence:.9});
    expect(evaluator.liveFeedback()).toBeNull();
    evaluator.push({at:.6,notes:[69,72],confidence:.9});
    evaluator.push({at:.75,notes:[69,72],confidence:.9});
    expect(evaluator.liveFeedback()?.feedback.missing).toEqual([76]);
  });
});
describe('held-note onset noise',()=>{
  it('does not move a held note attack to a later noise peak',()=>{
    const e=new Evaluator([{...step,requireTogether:true}]);
    e.push({at:0,notes:[69],onsets:[69],confidence:.9});
    for(const at of [.04,.08,.12,.16,.2])e.push({at,notes:[69],onsets:[],confidence:.9});
    e.push({at:.22,notes:[69],onsets:[69],confidence:.9});
    e.push({at:.25,notes:step.notes,onsets:[72,76],confidence:.9});
    expect(e.push({at:.38,notes:step.notes,onsets:[],confidence:.9}).complete).toBe(false);
    expect(e.feedback().type).toBe('timing');
  });
});
describe('feedback without a keyboard',()=>{
  it('does not claim that notes were missed when all pitches were heard briefly',()=>{
    const evaluator=new Evaluator([{...step,requireTogether:true}]);
    evaluator.push({at:14.99,notes:step.notes,onsets:step.notes,confidence:.9});
    expect(evaluator.index).toBe(0);
    expect(evaluator.feedback()).toEqual({type:'unconfirmed',missing:[],extra:[]});
    expect(feedbackText(evaluator.feedback(),step.notes,0,'ru').title).toBe('Ноты верные · повтори');
    expect(feedbackText(evaluator.feedback(),step.notes,0,'en').title).toBe('Right notes · try again');
    expect(feedbackText(new Evaluator([step]).feedback(),step.notes,0,'ru').title).toBe('Не удалось распознать ноты');
  });
  it('names the third chord note and its direction, not a finger',()=>{
    const message=feedbackText({type:'notes',missing:[76],extra:[75]},step.notes,0,'ru');
    expect(message.title).toBe('Сыграй третью ноту выше');
    expect(message.detail).toContain('на полтона');
    expect(feedbackText({type:'notes',missing:[76],extra:[77]},step.notes,0,'en').title).toBe('Play the third note lower');
  });
  it('uses sequence position for single-note steps and persists the explicit keyboard setting',()=>{
    expect(feedbackText({type:'notes',missing:[76],extra:[75]},[76],2,'ru').title).toBe('Сыграй третью ноту выше');
    expect(restoreSettings({...defaults,keyboard:false}).keyboard).toBe(false);
    expect(restoreSettings({hints:false,heard:false}).keyboard).toBe(false);
    expect(restoreSettings({hints:true,heard:false}).keyboard).toBe(true);
  });
});
