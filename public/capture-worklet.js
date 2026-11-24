class PianoCapture extends AudioWorkletProcessor {
  constructor() { super(); this.buffer = new Float32Array(2048); this.position = 0; }
  process(inputs) {
    const channels = inputs[0];
    if (!channels?.length) return true;
    for (let i = 0; i < channels[0].length; i++) {
      let sample = 0;
      for (const channel of channels) sample += channel[i] || 0;
      this.buffer[this.position++] = sample / channels.length;
      if (this.position === this.buffer.length) {
        this.port.postMessage(this.buffer, [this.buffer.buffer]);
        this.buffer = new Float32Array(2048); this.position = 0;
      }
    }
    return true;
  }
}
registerProcessor('piano-capture', PianoCapture);
