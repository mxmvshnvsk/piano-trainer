import { describe, expect, it } from 'vitest';
import { pianoSourceEvidence } from '../src/piano-source';
import { pianoSourceWaveform } from '../src/piano-source-model';

function scores(values: Record<number, number>) { const scores = new Float32Array(521); for (const [index, value] of Object.entries(values)) scores[+index] = value; return scores; }
describe('experimental piano source filter', () => {
  it('keeps acoustic and digital piano, including a mixed background', () => {
    expect(pianoSourceEvidence(scores({148:.08,147:.11,132:.88})).accepted).toBe(true);
    expect(pianoSourceEvidence(scores({149:.09,147:.08,132:.71,0:.15,507:.2})).accepted).toBe(true);
  });
  it('rejects speech, traffic, silence and generic music without piano support', () => {
    const examples: Record<number, number>[] = [{0:.9,148:.001,132:.2},{294:.8,148:.01,132:.15},{494:1},{132:.9,133:.8}];
    for(const values of examples) expect(pianoSourceEvidence(scores(values)).accepted).toBe(false);
  });
  it('left pads a short signal instead of stretching it or waiting for more audio', () => {
    const input = Float32Array.from({length:2205}, (_,i) => i / 2205);
    const waveform = pianoSourceWaveform(input);
    expect(waveform).toHaveLength(15600);
    expect(waveform.slice(0,14000).every(v=>v===0)).toBe(true);
    expect(waveform.at(-1)).toBeCloseTo(1,2);
    expect(input).toHaveLength(2205);
  });
});
