export function shortPiano(notes: number[], hold = .12, amplitude = .004, rolled = false) {
  const samples = new Float32Array(22050);
  for (let i = 0; i < samples.length; i++) for (const [index, midi] of notes.entries()) {
    const time = i / 22050, age = time - .15 - (rolled ? index * .3 : 0);
    if (age < 0) continue;
    const envelope = Math.min(1, age * 180) * Math.exp(-age * 1.4) * Math.exp(-Math.max(0, age - hold) / .028);
    const frequency = 440 * 2 ** ((midi - 69) / 12);
    for (let h = 1; h <= 6; h++) samples[i] += amplitude / h ** 1.4 * envelope * Math.sin(2 * Math.PI * frequency * h * time);
  }
  return samples;
}
// Synthetic broadband hiss + correlated low-frequency rumble + mains-like hum.
// This is a repeatable stress fixture, not a recording of real street traffic.
export function streetNoise(length: number, level = .003, seed = 42) {
  const samples = new Float32Array(length); let low = 0, energy = 0;
  for (let i = 0; i < length; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const white = seed / 2 ** 31 - 1;
    low = .97 * low + .03 * white;
    samples[i] = low * 3 + white * .2 + .1 * Math.sin(2 * Math.PI * 53 * i / 22050);
    energy += samples[i] ** 2;
  }
  const rms = Math.sqrt(energy / length);
  return samples.map(value => value * level / rms);
}
export function mixPianoNoise(piano: Float32Array, noise: Float32Array) {
  return piano.map((value, i) => value + noise[i]);
}
