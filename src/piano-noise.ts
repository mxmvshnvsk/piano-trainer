// Music-aware spectral noise reduction. Profiles contain averaged spectral
// power, never recorded audio. FFT work stays small relative to model inference.
export const NOISE_FFT_SIZE = 2048;
export const NOISE_PROFILE_SIZE = NOISE_FFT_SIZE / 2 + 1;
const HOP = NOISE_FFT_SIZE / 2;
const window = Float64Array.from({ length: NOISE_FFT_SIZE }, (_, i) => .5 - .5 * Math.cos(2 * Math.PI * i / NOISE_FFT_SIZE));
const reverse = Uint16Array.from({ length: NOISE_FFT_SIZE }, (_, index) => {
  let value = index, result = 0;
  for (let i = 0; i < 11; i++) { result = result * 2 + (value & 1); value >>= 1; }
  return result;
});
const cosine = Float64Array.from({ length: HOP }, (_, i) => Math.cos(2 * Math.PI * i / NOISE_FFT_SIZE));
const sine = Float64Array.from({ length: HOP }, (_, i) => Math.sin(2 * Math.PI * i / NOISE_FFT_SIZE));
function fft(real: Float64Array, imaginary: Float64Array, inverse = false) {
  for (let i = 0; i < NOISE_FFT_SIZE; i++) {
    const j = reverse[i];
    if (i < j) {
      const r = real[i], im = imaginary[i];
      real[i] = real[j]; imaginary[i] = imaginary[j];
      real[j] = r; imaginary[j] = im;
    }
  }
  for (let size = 2; size <= NOISE_FFT_SIZE; size *= 2) {
    const half = size / 2, step = NOISE_FFT_SIZE / size;
    for (let start = 0; start < NOISE_FFT_SIZE; start += size) for (let j = 0; j < half; j++) {
      const index = j * step, c = cosine[index], s = sine[index] * (inverse ? 1 : -1);
      const left = start + j, right = left + half;
      const r = real[right] * c - imaginary[right] * s;
      const im = real[right] * s + imaginary[right] * c;
      real[right] = real[left] - r; imaginary[right] = imaginary[left] - im;
      real[left] += r; imaginary[left] += im;
    }
  }
  if (inverse) for (let i = 0; i < NOISE_FFT_SIZE; i++) { real[i] /= NOISE_FFT_SIZE; imaginary[i] /= NOISE_FFT_SIZE; }
}
function transform(input: Float32Array, start: number, real: Float64Array, imaginary: Float64Array) {
  imaginary.fill(0);
  for (let i = 0; i < NOISE_FFT_SIZE; i++) real[i] = (input[start + i] || 0) * window[i];
  fft(real, imaginary);
}
export function restoreNoiseProfile(value: unknown): number[] {
  if (!Array.isArray(value) || value.length !== NOISE_PROFILE_SIZE || !value.every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1e8)) return [];
  return [...value];
}
export function estimateNoiseProfile(input: Float32Array): number[] {
  if (input.length < NOISE_FFT_SIZE) return [];
  const profile = new Float64Array(NOISE_PROFILE_SIZE);
  const real = new Float64Array(NOISE_FFT_SIZE), imaginary = new Float64Array(NOISE_FFT_SIZE);
  let count = 0;
  for (let start = 0; start + NOISE_FFT_SIZE <= input.length; start += HOP) {
    transform(input, start, real, imaginary); count++;
    for (let k = 0; k < profile.length; k++) profile[k] += real[k] ** 2 + imaginary[k] ** 2;
  }
  return Array.from(profile, power => power / count);
}
export function suppressPianoNoise(input: Float32Array, profile: readonly number[], inputGain = 1): Float32Array {
  if (profile.length !== NOISE_PROFILE_SIZE || !profile.some(power => power > 1e-12)) return input.slice();
  const output = new Float64Array(input.length), weights = new Float64Array(input.length);
  const real = new Float64Array(NOISE_FFT_SIZE), imaginary = new Float64Array(NOISE_FFT_SIZE);
  const power = new Float64Array(NOISE_PROFILE_SIZE), gain = new Float64Array(NOISE_PROFILE_SIZE);
  const ratios = new Float64Array(NOISE_PROFILE_SIZE);
  const gainSquared = inputGain ** 2;
  for (let start = -HOP; start < input.length; start += HOP) {
    transform(input, start, real, imaginary);
    let count = 0;
    for (let k = 0; k < power.length; k++) {
      power[k] = real[k] ** 2 + imaginary[k] ** 2;
      if (k >= 2 && profile[k] > 1e-12) ratios[count++] = power[k] / (profile[k] * gainSquared);
    }
    // Estimate changing background loudness from the broad spectrum. Sparse
    // piano harmonics do not dominate this quantile; sustained notes are not learned.
    const sorted = ratios.subarray(0, count).sort();
    const scale = Math.max(.3, Math.min(16, (sorted[Math.floor(count * .4)] || 0) / .5108));
    let energy = 0, excess = 0, highestRatio = 0;
    for (let k = 2; k < power.length; k++) {
      const noise = profile[k] * gainSquared * scale;
      energy += power[k]; excess += Math.max(0, power[k] - 3 * noise);
      highestRatio = Math.max(highestRatio, power[k] / Math.max(noise, 1e-12));
      // Traffic rumble mainly occupies the low band. Subtract its measured
      // floor more firmly; a tonal bass fundamental still passes above it.
      const subtraction = k < 19 ? 5 : 2.5;
      gain[k] = Math.sqrt(Math.max(.0025, 1 - subtraction * noise / Math.max(power[k], 1e-20)));
    }
    // Noise alone must not become "notes" after automatic input normalization.
    const musicalEnergy = excess > energy * .08 || highestRatio > 25;
    gain[0] = 0; gain[1] = 0; // DC and sub-20 Hz rumble, below piano fundamentals.
    for (let k = 0; k < NOISE_FFT_SIZE; k++) {
      const bin = k <= HOP ? k : NOISE_FFT_SIZE - k;
      const mask = musicalEnergy ? gain[bin] : 0;
      real[k] *= mask; imaginary[k] *= mask;
    }
    fft(real, imaginary, true);
    for (let i = 0; i < NOISE_FFT_SIZE; i++) {
      const position = start + i;
      if (position < 0 || position >= input.length) continue;
      output[position] += real[i] * window[i]; weights[position] += window[i] ** 2;
    }
  }
  return Float32Array.from(output, (value, i) => weights[i] > 1e-12 ? value / weights[i] : 0);
}
