export const PIANO_SAMPLE_RATE = 22050;
export const MODEL_INPUT_SAMPLES = 43844;
export const MODEL_CONTEXT_FRAMES = 15;
export const MODEL_HOP_SAMPLES = 256;
// The network still receives its full input; unavailable future audio is padded.
// Short captures are enough for a first check; later checks include more context.
export const MIN_ANALYSIS_SAMPLES = 8192;
export const MAX_ANALYSIS_SAMPLES = 32768;
export const ANALYSIS_HOP_SAMPLES = 4096;
