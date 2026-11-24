import type { Frame } from './evaluation';
import type { Settings } from './music';

export const flowSettings = (settings: Settings): Settings => ({ ...settings, kind: 'chord', chordPlaying: 'together', keyboard: true, hints: true, heard: true, auto: true });

// Capture timestamps remain continuous across tasks. Ignore overlapping windows
// and held notes until a fresh attack or a change in the sounding notes.
export class FlowGate {
  private boundary = -Infinity;
  private previous: number[] | null = null;
  arm(boundary: number, previous: number[]) { this.boundary = boundary; this.previous = [...previous]; }
  clear() { this.boundary = -Infinity; this.previous = null; }
  accept(frame: Frame): boolean {
    if (frame.at <= this.boundary) return false;
    this.boundary = frame.at;
    if (this.previous) {
      const changed = frame.confidence >= .5 && (frame.notes.length !== this.previous.length || frame.notes.some(n => !this.previous!.includes(n)));
      if (!frame.notes.length || changed || frame.onsets?.length) this.previous = null;
      else return false;
    }
    return true;
  }
}
