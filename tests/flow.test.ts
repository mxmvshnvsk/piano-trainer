import { describe, expect, it } from 'vitest';
import { FlowGate, flowSettings } from '../src/flow';
import { defaults } from '../src/music';
import { Evaluator } from '../src/evaluation';

describe('continuous chord flow', () => {
  it('uses simultaneous chords and visible guidance without mutating practice preferences', () => {
    const preferences = { ...defaults, kind: 'scale' as const, keyboard: false, auto: false };
    expect(flowSettings(preferences)).toMatchObject({ kind: 'chord', chordPlaying: 'together', keyboard: true, hints: true, heard: true, auto: true });
    expect(preferences).toMatchObject({ kind: 'scale', keyboard: false, auto: false });
  });
  it('ignores overlapping windows and a held chord after switching tasks', () => {
    const gate = new FlowGate(); gate.arm(2, [60,64,67]);
    expect(gate.accept({ at:1.9,notes:[60,64,67],confidence:1,onsets:[60,64,67] })).toBe(false);
    expect(gate.accept({ at:2.1,notes:[60,64,67],confidence:1,onsets:[] })).toBe(false);
    expect(gate.accept({ at:2.2,notes:[60,64,67],confidence:1,onsets:[60,64,67] })).toBe(true);
    expect(gate.accept({ at:2.2,notes:[60,64,67],confidence:1 })).toBe(false);
  });
  it('accepts a new chord on the continuous capture timeline without a restart', () => {
    const gate = new FlowGate(); gate.arm(10, [60,64,67]);
    const evaluator = new Evaluator([{label:'Am',notes:[60,64,69],left:[],right:[60,64,69],requireTogether:true}]);
    for (const at of [10.1,10.16,10.23]) {
      const frame = {at,notes:[60,64,69],confidence:.95,onsets: at===10.1 ? [60,64,69] : []};
      if(gate.accept(frame))evaluator.push(frame);
    }
    expect(evaluator.index).toBe(1);
  });
  it('allows repeating after release and resets capture timestamps after pause', () => {
    const gate = new FlowGate(); gate.arm(20,[60,64,67]);
    expect(gate.accept({at:20.1,notes:[],confidence:0})).toBe(false);
    expect(gate.accept({at:20.19,notes:[],confidence:0})).toBe(false);
    expect(gate.accept({at:20.2,notes:[60,64,67],confidence:1})).toBe(true);
    gate.clear(); expect(gate.accept({at:0,notes:[60,64,67],confidence:1})).toBe(true);
  });
  it('does not mistake decay, a weak extra harmonic, or an old recovered onset for a new chord', () => {
    const gate=new FlowGate();gate.arm(2,[60,64,67]);
    expect(gate.accept({at:2.1,notes:[60,64],confidence:.8,onsets:[]})).toBe(false);
    expect(gate.accept({at:2.2,notes:[60,64,72],confidence:.8,strengths:{60:.9,64:.9,72:.4},onsets:[72],onsetTimes:{72:2.2}})).toBe(false);
    expect(gate.accept({at:2.3,notes:[60,64,69],confidence:.8,onsets:[69],onsetTimes:{69:1.9}})).toBe(false);
    expect(gate.waiting).toBe(true);
    expect(gate.accept({at:2.4,notes:[60,64,69],confidence:.8,onsets:[69],onsetTimes:{69:2.4}})).toBe(true);
    expect(gate.waiting).toBe(false);
  });
  it('opens for a new soft attack once its recovered pitch becomes confident',()=>{
    const gate=new FlowGate();gate.arm(2,[60,64,67]);
    expect(gate.accept({at:2.1,notes:[60,64,69],confidence:.8,strengths:{69:.4},onsets:[69],onsetTimes:{69:2.1}})).toBe(false);
    expect(gate.accept({at:2.2,notes:[60,64,69],confidence:.8,strengths:{69:.7},onsets:[],onsetTimes:{69:2.1}})).toBe(true);
  });
});
