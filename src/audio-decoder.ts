import type { Frame } from './evaluation';

export function decodePianoFrames(frames: Float32Array, onsets: Float32Array, start: number): Frame[] {
  const count = frames.length / 88, output: Frame[] = [];
  const peaks = new Float32Array(88), sustained = new Uint8Array(88);
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
    const notes: number[] = [], attacks: number[] = []; let strength = 0;
    for (let n = 0; n < 88; n++) {
      const probability = frames[i * 88 + n], previous = i ? frames[(i - 1) * 88 + n] : 0;
      const soft = peaks[n] < .35 && sustained[n] === 1;
      if (probability >= (soft ? .5 : .32) && (peaks[n] >= .3 || soft)) { notes.push(n + 21); strength += probability; }
      const modelAttack = onsets[i * 88 + n] >= .35 && (i === 0 || onsets[(i - 1) * 88 + n] < .35);
      // An overlapping window beginning on an already held note is not a new attack.
      const softAttack = soft && probability >= .5 && previous < .5 && (i > 0 || start === 0);
      if (modelAttack || softAttack) attacks.push(n + 21);
    }
    output.push({ at: start + i * 256 / 22050, notes, onsets: attacks, confidence: notes.length ? strength / notes.length : 0 });
  }
  return output;
}
