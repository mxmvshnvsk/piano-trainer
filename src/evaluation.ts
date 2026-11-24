import { compareNotes, type Feedback, type Step } from './music';
export type Frame = { at: number; notes: number[]; confidence: number; onsets?: number[]; eligible?: boolean };
export type LiveFeedback = { feedback: Feedback; step: number; expected: number[] };
// Evidence must be simultaneous and repeated. We never union all notes in a recording.
export class Evaluator {
  index = 0;
  private stableSince: number | null = null;
  private lastTime = -1;
  private lastAdvance = -1;
  private attacks = new Map<number, number>();
  private lastHeard = new Map<number, number>();
  private timingMismatch = false;
  private wrongSince: number | null = null;
  private wrongSignature = '';
  private latestError: LiveFeedback | null = null;
  private best: { score: number; heard: number[] } = { score: -Infinity, heard: [] };
  constructor(readonly steps: Step[]) {}
  push(frame: Frame): { complete: boolean; index: number } {
    if (frame.at <= this.lastTime || this.index >= this.steps.length) return { complete: this.index >= this.steps.length, index: this.index };
    if (frame.at - this.lastTime > .3) { this.stableSince = null; this.wrongSince = null; }
    this.lastTime = frame.at;
    const expected = this.steps[this.index].notes;
    const heard = [...new Set(frame.notes)];
    // Noise and the release can produce a second onset peak for a held note.
    // Preserve its first attack until there has been a meaningful pitch gap.
    for (const note of frame.onsets || []) if (expected.includes(note) &&
      (!this.attacks.has(note) || frame.at - (this.lastHeard.get(note) ?? -Infinity) > .08)) this.attacks.set(note, frame.at);
    for (const note of heard) this.lastHeard.set(note, frame.at);
    const attackTimes = expected.map(n => this.attacks.get(n));
    const together = !this.steps[this.index].requireTogether || frame.onsets === undefined ||
      attackTimes.every(time => time !== undefined) && Math.max(...attackTimes as number[]) - Math.min(...attackTimes as number[]) <= .18;
    const pitchesMatch = heard.length === expected.length && expected.every(n => heard.includes(n));
    if (pitchesMatch && frame.confidence >= .5 && !together && attackTimes.every(time => time !== undefined)) this.timingMismatch = true;
    const match = frame.eligible !== false && together && pitchesMatch;
    // A wrong attack must persist. Incomplete attacks get a longer grace period
    // so the first finger of a correct chord does not flash as an error.
    if (match || frame.confidence < .65 || !heard.length) {
      this.wrongSince = null; this.wrongSignature = ''; this.latestError = null;
    } else {
      const problem = compareNotes(expected, heard);
      if (pitchesMatch) problem.type = this.timingMismatch ? 'timing' : 'uncertain';
      const signature = JSON.stringify(problem);
      if (signature !== this.wrongSignature) { this.wrongSignature = signature; this.wrongSince = frame.at; this.latestError = null; }
      this.wrongSince ??= frame.at;
      const grace = problem.extra.length || problem.type === 'timing' ? .22 : .65;
      if (problem.type !== 'uncertain' && frame.at - this.wrongSince >= grace) this.latestError = { feedback: problem, step: this.index, expected: [...expected] };
    }
    if (frame.confidence >= .4 && heard.length) {
      const score = expected.filter(n => heard.includes(n)).length * 2 - heard.filter(n => !expected.includes(n)).length;
      if (score >= this.best.score) this.best = { score, heard };
    }
    if (!match || frame.confidence < .5 || frame.at - this.lastAdvance < .12) this.stableSince = null;
    else {
      this.stableSince ??= frame.at;
      if (frame.at - this.stableSince >= .1) {
        this.index++;
        this.lastAdvance = frame.at;
        this.stableSince = null;
        this.best = { score: -Infinity, heard: [] };
        this.attacks.clear();
        this.lastHeard.clear();
        this.timingMismatch = false;
        this.latestError = null; this.wrongSince = null; this.wrongSignature = '';
      }
    }
    return { complete: this.index >= this.steps.length, index: this.index };
  }
  liveFeedback(): LiveFeedback | null { return this.latestError; }
  feedback(): Feedback {
    const step = this.steps[Math.min(this.index, this.steps.length - 1)];
    const result = compareNotes(step.notes, this.best.heard);
    if (result.type === 'notes' && !result.missing.length && !result.extra.length) return { ...result, type: this.timingMismatch ? 'timing' : 'unconfirmed' };
    return result;
  }
}
