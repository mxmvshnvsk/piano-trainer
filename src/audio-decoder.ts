import type { Frame } from './evaluation';

export function hasRecentPianoEvidence(frames: Frame[]): boolean {
  let since: number | undefined, signature = '';
  const newest=frames.at(-1)?.at ?? -Infinity;
  for(const frame of frames) {
    const current=frame.notes.join(',');
    if(!frame.notes.length || frame.confidence<(frame.notes.length===1?.65:.5)) {
      since=undefined;signature='';continue;
    }
    if(current!==signature){signature=current;since=frame.at;}
    since??=frame.at;
    if(frame.at-since>=.07 && newest-frame.at<=.15)return true;
  }
  return false;
}

export function offsetPianoFrames(frames: Frame[], offset: number): Frame[] {
  return frames.map(frame => ({ ...frame, at: frame.at + offset, onsetTimes: frame.onsetTimes &&
    Object.fromEntries(Object.entries(frame.onsetTimes).map(([note, at]) => [note, at + offset])) }));
}

// The short tail after a deadline supplies context and sustain for notes that
// already sounded. A newly played note after the deadline cannot complete a task.
export function limitPianoTail(frames: Frame[], cutoff: number, eligible: Set<number>): Frame[] {
  return frames.map(frame => {
    if (frame.at <= cutoff) {
      if (frame.at >= cutoff - .12) {
        frame.onsets?.forEach(note => eligible.add(note));
        if (frame.confidence >= .5) frame.notes.forEach(note => eligible.add(note));
      }
      return frame;
    }
    // Preserve what was heard for honest keyboard/feedback rendering, while
    // preventing new post-deadline notes from advancing the exercise.
    return { ...frame, eligible: frame.notes.every(note => eligible.has(note)), onsets: [], onsetTimes: frame.onsetTimes &&
      Object.fromEntries(Object.entries(frame.onsetTimes).filter(([, at]) => at <= cutoff)) };
  });
}

export function decodePianoFrames(frames: Float32Array, onsets: Float32Array, start: number): Frame[] {
  const count = frames.length / 88, output: Frame[] = [];
  const peaks = new Float32Array(88), sustained = new Uint8Array(88);
  const starts = new Map<number, number>();
  for (let n = 0; n < 88; n++) {
    let run = 0;
    for (let i = 0; i < count; i++) {
      peaks[n] = Math.max(peaks[n], onsets[i * 88 + n]);
      run = frames[i * 88 + n] >= .65 ? run + 1 : 0;
      // A soft piano onset can be weak even when pitch is clear for ~100 ms.
      // Harmonics with weak frame evidence must still be rejected.
      if (run >= 9) sustained[n] = 1;
    }
  }
  for (let i = 0; i < count; i++) {
    const notes: number[] = [], attacks: number[] = [], onsetTimes: Record<number, number> = {}; let strength = 0;
    for (let n = 0; n < 88; n++) {
      const probability = frames[i * 88 + n], previous = i ? frames[(i - 1) * 88 + n] : 0;
      const soft = peaks[n] < .35 && sustained[n] === 1;
      if (probability >= (soft ? .5 : .32) && (peaks[n] >= .3 || soft)) { notes.push(n + 21); strength += probability; }
      const modelAttack = onsets[i * 88 + n] >= .35 && (i > 0 ? onsets[(i - 1) * 88 + n] < .35 : start === 0);
      // Pitch and onset heads can peak at different times for the same attack.
      // Use the supported pitch's leading edge too, rather than making a block
      // chord look rolled simply because one onset head responds late.
      const threshold = soft ? .5 : .32;
      const pitchAttack = notes.includes(n + 21) && previous < threshold && (i > 0 || start === 0);
      // Unsupported onset-head peaks (speech/noise, with no pitch) are not notes.
      if (modelAttack && notes.includes(n + 21) || pitchAttack) attacks.push(n + 21);
      if (!notes.includes(n + 21)) starts.delete(n + 21);
      else {
        if (pitchAttack) starts.set(n + 21, start + i * 256 / 22050);
        const at = starts.get(n + 21);
        if (at !== undefined) onsetTimes[n + 21] = at;
      }
    }
    output.push({ at: start + i * 256 / 22050, notes, onsets: attacks, onsetTimes, confidence: notes.length ? strength / notes.length : 0 });
  }
  return output;
}
