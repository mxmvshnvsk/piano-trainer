import type { Frame } from './evaluation';
import type { PianoDiagnostic } from './audio';

export function encodeCalibrationAudio(chunks: Float32Array[]) {
  const size = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const bytes = new Uint8Array(size * 4), view = new DataView(bytes.buffer);
  let offset = 0;
  for (const chunk of chunks) for (const value of chunk) { view.setFloat32(offset, value, true); offset += 4; }
  let binary = '';
  for (let start = 0; start < bytes.length; start += 8192) binary += String.fromCharCode(...bytes.subarray(start, start + 8192));
  return { sampleRate: 22050, format: 'f32le-base64', samples: size, data: btoa(binary) };
}

// Compact at save time too: a listener created before hot reload can still
// contain full-precision values. Recognition never uses this serialization.
export function compactCalibrationWindows(windows: PianoDiagnostic[]): PianoDiagnostic[] {
  const compact = (values: number[]) => values.map(value => Math.round(value * 10000) / 10000);
  return windows.map(window => ({ start: window.start, rawFrames: compact(window.rawFrames), rawOnsets: compact(window.rawOnsets), frames: compact(window.frames), onsets: compact(window.onsets), source: window.source }));
}

export function parseCalibrationNotes(text: string): number[] | null {
  if (!text.trim()) return [];
  const result: number[] = [];
  for (const token of text.trim().split(/[\s,;·]+/)) {
    const match = /^([a-g])([#♯b♭]?)([0-8])$/i.exec(token);
    if (!match) return null;
    const pitch = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[match[1].toUpperCase()]!;
    const midi = (+match[3] + 1) * 12 + pitch + (/[#♯]/.test(match[2]) ? 1 : /[b♭]/.test(match[2]) ? -1 : 0);
    if (midi < 21 || midi > 108) return null;
    result.push(midi);
  }
  return [...new Set(result)].sort((a, b) => a - b);
}

// Keep the latest interpretation of each audio frame, rather than counting
// overlapping inference windows as additional evidence of a note.
export function summarizeCalibration(frames: Frame[]) {
  const unique = new Map<number, Frame>();
  for (const frame of frames) unique.set(Math.round(frame.at * 22050 / 256), frame);
  const notes = new Map<number, { note: number; milliseconds: number; confidence: number }>();
  for (const frame of unique.values()) for (const note of frame.notes) {
    const item = notes.get(note) || { note, milliseconds: 0, confidence: 0 };
    item.milliseconds += 256 / 22050 * 1000;
    item.confidence = Math.max(item.confidence, frame.confidence);
    notes.set(note, item);
  }
  return [...notes.values()].sort((a, b) => a.note - b.note);
}
