import { MicrophoneError } from './audio';
import { meterInfo, quarterSeconds, type RhythmSettings } from './rhythm';

export class RhythmAudio {
  context?:AudioContext;
  private stream?:MediaStream;
  private source?:MediaStreamAudioSourceNode;
  private node?:AudioWorkletNode;
  private mute?:GainNode;
  private poll?:ReturnType<typeof setInterval>;
  private clicks=new Set<OscillatorNode>();
  private generation=0;
  startAt=0;
  quarter=0;
  get now() { return this.context?.currentTime || 0; }
  async start(s:RhythmSettings,onAttack:(at:number)=>void,onLevel:(level:number)=>void,onError:()=>void) {
    this.stop(); const generation=this.generation;
    const context=new AudioContext({latencyHint:'interactive'}); this.context=context;
    try {
      await context.resume();
      if(s.input==='microphone' && !s.metronomeOnly) {
        if(!navigator.mediaDevices?.getUserMedia || !window.AudioWorkletNode)throw new MicrophoneError('unavailable');
        const stream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:false,noiseSuppression:false,autoGainControl:false}});
        if(generation!==this.generation) { stream.getTracks().forEach(t=>t.stop()); return false; }
        this.stream=stream;
        await context.audioWorklet.addModule(`${import.meta.env.BASE_URL}rhythm-worklet.js`);
        if(generation!==this.generation)return false;
        this.source=context.createMediaStreamSource(stream);
        this.node=new AudioWorkletNode(context,'rhythm-capture',{processorOptions:{threshold:.018-.00015*s.sensitivity}});
        this.mute=context.createGain(); this.mute.gain.value=0;
        this.source.connect(this.node); this.node.connect(this.mute); this.mute.connect(context.destination);
        this.node.port.onmessage=({data})=>{
          if(generation!==this.generation)return;
          if(data.type==='attack')onAttack(data.at);
          if(data.type==='level')onLevel(data.value);
        };
        stream.getTracks().forEach(track=>track.onended=()=>{if(generation===this.generation){this.stop();onError();}});
      }
      if(generation!==this.generation)return false;
      this.quarter=quarterSeconds(s); this.startAt=context.currentTime+.2;
      const {quarters}=meterInfo(s.meter);
      const unit=s.subdivision ? .5 : s.meter==='6/8' ? 1.5 : 1;
      let tick=0;
      const schedule=()=>{
        while(this.startAt+tick*unit*this.quarter<context.currentTime+.12) {
          const position=(tick*unit)%quarters;
          const accent=position===0 ? 2 : s.meter==='6/8' && position===1.5 ? 1 : 0;
          if(s.sound && s.volume>0) {
            const at=this.startAt+tick*unit*this.quarter;
            if(at>=context.currentTime) {
              const oscillator=context.createOscillator(),gain=context.createGain();
              oscillator.frequency.value=accent===2?1400:accent===1?1100:850;
              gain.gain.setValueAtTime(0,at);gain.gain.linearRampToValueAtTime(s.volume/100*.12,at+.002);gain.gain.exponentialRampToValueAtTime(.0001,at+.045);
              oscillator.connect(gain);gain.connect(context.destination);oscillator.start(at);oscillator.stop(at+.05);
              this.clicks.add(oscillator);oscillator.onended=()=>{this.clicks.delete(oscillator);oscillator.disconnect();gain.disconnect();};
            }
          }
          tick++;
        }
      };
      schedule();this.poll=setInterval(schedule,25);
      return true;
    } catch(error) {
      if(generation!==this.generation)return false;
      this.stop();throw error instanceof MicrophoneError?error:new MicrophoneError(error instanceof DOMException && error.name==='NotAllowedError'?'permission':'device');
    }
  }
  stop() {
    this.generation++;clearInterval(this.poll);this.poll=undefined;
    this.stream?.getTracks().forEach(track=>{track.onended=null;track.stop();});this.stream=undefined;
    this.node?.port.close();this.source?.disconnect();this.node?.disconnect();this.mute?.disconnect();
    this.source=undefined;this.node=undefined;this.mute=undefined;
    this.clicks.forEach(click=>{try{click.stop();}catch{/* Already ended. */}});this.clicks.clear();
    void this.context?.close().catch(()=>{});this.context=undefined;
  }
}
