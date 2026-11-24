// Sample-clock timestamps avoid main-thread/model inference latency.
class RhythmCapture extends AudioWorkletProcessor {
  constructor(options) {
    super(); this.envelope=.0001; this.previous=0; this.last=-1; this.counter=0;
    this.threshold=options.processorOptions.threshold;
  }
  process(inputs) {
    const input=inputs[0]?.[0]; if(!input?.length)return true;
    let sum=0; for(const n of input)sum+=n*n;
    const rms=Math.sqrt(sum/input.length), at=currentFrame/sampleRate;
    // Only rising energy can produce an attack; a piano's decay cannot retrigger.
    const attack=rms>this.threshold && rms>this.envelope*1.8 && rms>this.previous*1.12 && at-this.last>.09;
    if(attack) { this.last=at; this.port.postMessage({type:'attack',at}); }
    this.envelope=this.envelope*.97+rms*.03; this.previous=rms;
    if(++this.counter%16===0)this.port.postMessage({type:'level',value:Math.min(1,rms*15)});
    return true;
  }
}
registerProcessor('rhythm-capture',RhythmCapture);
