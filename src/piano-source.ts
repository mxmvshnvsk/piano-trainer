export type PianoSourceEvidence = { piano: number; keyboard: number; music: number; speech: number; noise: number; accepted: boolean };

// YAMNet scores are independent class scores, not calibrated probabilities.
// Permit piano mixed with background; an ambiguous source stays unrecognized.
export function pianoSourceEvidence(scores: ArrayLike<number>): PianoSourceEvidence {
  const piano = Math.max(scores[148] || 0, scores[149] || 0);
  const keyboard = scores[147] || 0, music = scores[132] || 0;
  const speech = scores[0] || 0;
  const noise = Math.max(scores[277] || 0, scores[279] || 0, scores[294] || 0, scores[507] || 0);
  const support = Math.max(piano, keyboard * .5);
  return { piano, keyboard, music, speech, noise, accepted: support >= .025 && music >= .12 && support >= Math.max(speech, noise) * .12 };
}
