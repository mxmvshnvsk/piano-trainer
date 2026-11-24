import { describe, expect, it } from 'vitest';
import { compactCalibrationWindows, encodeCalibrationAudio, parseCalibrationNotes, summarizeCalibration } from '../src/calibration-data';

describe('local calibration labels', () => {
  it('round trips optional local audio without losing quiet signal precision', () => {
    const samples = new Float32Array([0, .00000013, -.000043, .8]);
    const encoded = encodeCalibrationAudio([samples.slice(0,2), samples.slice(2)]);
    const bytes = Uint8Array.from(atob(encoded.data), char=>char.charCodeAt(0));
    const view = new DataView(bytes.buffer);
    expect(encoded.samples).toBe(4);
    expect(Array.from({length:4},(_,i)=>view.getFloat32(i*4,true))).toEqual(Array.from(samples));
  });
  it('fits a full-precision capture under the local request limit without changing evidence', () => {
    const values = Array.from({length: 128 * 88}, (_, i) => i % 17 ? .00000123456789 : .6172874126434326);
    const windows = Array.from({length: 26}, (_, i) => ({ start: i * .185, rawFrames: values, rawOnsets: values, frames: values, onsets: values }));
    expect(JSON.stringify(windows).length).toBeGreaterThan(8 * 1024 * 1024);
    const compact = compactCalibrationWindows(windows);
    expect(JSON.stringify(compact).length).toBeLessThan(4 * 1024 * 1024);
    expect(compact[0].start).toBe(windows[0].start);
    expect(compact[0].frames[0]).toBeCloseTo(values[0], 4);
    expect(windows[0].frames[0]).toBe(values[0]);
  });
  it('parses pitches with octaves, accidentals, and duplicate enharmonics', () => {
    expect(parseCalibrationNotes('C4, E4 G4')).toEqual([60, 64, 67]);
    expect(parseCalibrationNotes('Gb4 F♯4 A4 C#5')).toEqual([66, 69, 73]);
    expect(parseCalibrationNotes('B#3 Cb4')).toEqual([59, 60]);
  });
  it('requires a specific octave and rejects unsupported or out-of-range input', () => {
    for (const text of ['Am', 'C', 'C0', 'G9', 'C4 garbage', 'C4/E4']) expect(parseCalibrationNotes(text)).toBeNull();
    expect(parseCalibrationNotes(' ')).toEqual([]);
  });
  it('replaces overlapping predictions instead of counting them twice', () => {
    const report = summarizeCalibration([
      { at: 0, notes: [60, 72], confidence: .8 },
      { at: 256 / 22050, notes: [60], confidence: .7 },
      { at: 0, notes: [60], confidence: .9 },
    ]);
    expect(report).toHaveLength(1);
    expect(report[0].note).toBe(60);
    expect(report[0].milliseconds).toBeCloseTo(512 / 22050 * 1000);
    expect(report[0].confidence).toBe(.9);
  });
});
