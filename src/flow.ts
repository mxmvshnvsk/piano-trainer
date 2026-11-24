import type { Frame } from './evaluation';
import type { Settings } from './music';

export const flowSettings = (settings: Settings): Settings => ({ ...settings, kind: 'chord', chordPlaying: 'together', keyboard: true, hints: true, heard: true, auto: true });

// Capture timestamps remain continuous across tasks. Ignore overlapping windows
// and held notes until a fresh attack or a change in the sounding notes.
export class FlowGate {
  private boundary = -Infinity;
  private previous: number[] | null = null;
  private quietSince: number | null = null;
  private armedAt = -Infinity;
  get waiting() { return this.previous !== null; }
  arm(boundary: number, previous: number[]) { this.boundary = boundary; this.armedAt = boundary; this.previous = [...previous]; this.quietSince = null; }
  clear() { this.boundary = -Infinity; this.previous = null; this.quietSince = null; }
  accept(frame: Frame): boolean {
    if (frame.at <= this.boundary) return false;
    this.boundary = frame.at;
    if (this.previous) {
      if (!frame.notes.length) {
        this.quietSince ??= frame.at;
        if (frame.at - this.quietSince >= .08) this.previous = null;
        return false;
      }
      this.quietSince = null;
      const attackCandidates=[...new Set([...(frame.onsets||[]),...Object.keys(frame.onsetTimes||{}).map(Number)])];
      const fresh = attackCandidates.filter(note => frame.notes.includes(note) &&
        (frame.onsetTimes?.[note] ?? frame.at) > this.armedAt && (frame.strengths?.[note] ?? frame.confidence)>=.65);
      const newAttack = fresh.some(note => !this.previous!.includes(note));
      const repeatedAttack = fresh.length >= Math.min(2, this.previous.length);
      // A fading chord loses notes and may reveal harmonics. Neither a changed
      // set nor a lone release/onset peak can start the next exercise.
      if (frame.confidence >= .65 && (newAttack || repeatedAttack)) this.previous = null;
      else return false;
    }
    return true;
  }
}
