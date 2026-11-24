import { describe, expect, it } from 'vitest';
import { decodePianoFrames, limitPianoTail } from '../src/audio-decoder';
import { Evaluator } from '../src/evaluation';

function prediction(notes: { midi: number; at: number; until?: number; strength?: number; onset?: number }[], count = 100) {
  const frames = new Float32Array(count * 88), onsets = new Float32Array(count * 88);
  for (const note of notes) for (let i = note.at; i < (note.until ?? count); i++) {
    frames[i * 88 + note.midi - 21] = note.strength ?? .8;
    onsets[i * 88 + note.midi - 21] = i === note.at ? note.onset ?? .12 : 0;
  }
  return { frames, onsets };
}
describe('soft piano attacks', () => {
  it('does not call a block chord rolled when the onset head responds late', () => {
    const notes = [61,64,68];
    const input = prediction(notes.map(midi => ({ midi, at: 5, onset: 0 })));
    // All three pitches begin together; their onset-head peaks arrive later.
    for (const [n, at] of [5,25,40].entries()) input.onsets[at * 88 + notes[n] - 21] = .8;
    const evaluator = new Evaluator([{label:'C♯m',notes,left:[],right:notes,requireTogether:true}]);
    for (const frame of decodePianoFrames(input.frames,input.onsets,0)) evaluator.push(frame);
    expect(evaluator.index).toBe(1);
  });
  it('ignores onset peaks that have no supporting piano pitch', () => {
    const input = prediction([]);
    input.onsets[5 * 88 + 40] = .9;
    expect(decodePianoFrames(input.frames,input.onsets,0).every(frame=>!frame.onsets?.length)).toBe(true);
  });
  it('identifies a sustained G-flat without requiring a staccato onset', () => {
    const input = prediction([{ midi: 66, at: 5 }]);
    const decoded = decodePianoFrames(input.frames, input.onsets, 0);
    expect(decoded[5].notes).toEqual([66]);
    expect(decoded[5].onsets).toEqual([66]);
  });
  it('rejects weak harmonics and brief frame spikes without convincing attacks', () => {
    const input = prediction([{ midi: 66, at: 5, strength: .48 }, { midi: 78, at: 5, until: 10 }]);
    expect(decodePianoFrames(input.frames, input.onsets, 0).every(frame => !frame.notes.length && !frame.onsets?.length)).toBe(true);
  });
  it('does not invent an attack for a held note at an overlapping window boundary', () => {
    const input = prediction([{ midi: 66, at: 0 }]);
    const decoded = decodePianoFrames(input.frames, input.onsets, 2);
    expect(decoded.some(frame => frame.notes.includes(66))).toBe(true);
    expect(decoded.every(frame => !frame.onsets?.length)).toBe(true);
    input.onsets[66-21]=.9;
    expect(decodePianoFrames(input.frames,input.onsets,2).every(frame=>!frame.onsets?.length)).toBe(true);
  });
  it('accepts simultaneous soft attacks but still rejects rolled-and-held chords', () => {
    const step = { label: 'G♭', notes: [66, 70, 73], left: [], right: [66, 70, 73], requireTogether: true };
    const together = prediction(step.notes.map(midi => ({ midi, at: 5 })));
    const correct = new Evaluator([step]);
    for (const frame of decodePianoFrames(together.frames, together.onsets, 0)) correct.push(frame);
    expect(correct.index).toBe(1);
    const rolled = prediction(step.notes.map((midi, i) => ({ midi, at: 5 + 25 * i })));
    const incorrect = new Evaluator([step]);
    for (const frame of decodePianoFrames(rolled.frames, rolled.onsets, 0)) incorrect.push(frame);
    expect(incorrect.index).toBe(0); expect(incorrect.feedback().type).toBe('timing');
  });
});

describe('deadline evidence',()=>{
  it('preserves heard pitches while denying credit for newly played notes after the cutoff',()=>{
    const frames=[{at:.98,notes:[60],onsets:[60],confidence:.9},{at:1.02,notes:[60],onsets:[],confidence:.9},{at:1.2,notes:[64],onsets:[64],confidence:.9}];
    const result=limitPianoTail(frames,1,new Set());
    expect(result[1].eligible).toBe(true);
    expect(result[2]).toMatchObject({notes:[64],onsets:[],eligible:false});
  });
});
