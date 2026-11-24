import { chords, restoreSettings, type Exercise } from './music';
import { scales } from './scales';
export function read<T>(key: string, fallback: T): T {
  try { const value = localStorage.getItem(`piano.${key}`); return value ? JSON.parse(value) : fallback; } catch { return fallback; }
}
export function write(key: string, value: unknown) { try { localStorage.setItem(`piano.${key}`, JSON.stringify(value)); } catch { /* Private storage can be unavailable; practice still works. */ } }
export function readDifficult(): Exercise[] {
  const data: unknown = read('difficult', []);
  if (!Array.isArray(data)) return [];
  return data.filter(e => e && typeof e.id === 'string' && Number.isInteger(e.root) && e.root >= 48 && e.root <= 83 && Object.hasOwn(chords, e.chord)).slice(0, 200).map(e => ({ ...e, scale:typeof e.scale==='string'&&Object.hasOwn(scales,e.scale)?e.scale:undefined, playing: e.playing === 'together' || e.playing === 'sequential' ? e.playing : undefined, settings: { ...restoreSettings(e.settings), microphoneNoiseProfile: [] } }));
}
