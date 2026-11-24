const SIZE = 4096, HOP = 1024, RATE = 22050;
const window = Float32Array.from({length:SIZE},(_,i)=>.5-.5*Math.cos(2*Math.PI*i/(SIZE-1)));

// A model can infer an octave from harmonics that are actually other chord
// tones. Check that each proposed fundamental has its own narrow spectral peak.
// Cache on a coarser audio grid; this is verification, not another pitch model.
export function validatePianoPitches(samples: Float32Array, frames: Float32Array, onsets: Float32Array) {
  const support = new Map<number,boolean>();
  const count=frames.length/88;
  const present=new Uint8Array(88);
  for(let i=0;i<count;i++)for(let n=0;n<88;n++)if(frames[i*88+n]>=.32)present[n]=1;
  for(let i=0;i<count;i++) for(let n=0;n<88;n++) {
    if(frames[i*88+n]<.32)continue;
    const bucket=Math.round(i*256/HOP),key=bucket*88+n;
    let supported=support.get(key);
    if(supported===undefined) {
      const frequency=440*2**((n+21-69)/12),side=Math.max(10,frequency*.045);
      const frequencies=[frequency*.988,frequency,frequency*1.012,frequency-side,frequency+side];
      const coefficients=frequencies.map(f=>2*Math.cos(2*Math.PI*f/RATE));
      const previous=new Float64Array(5),older=new Float64Array(5);
      const start=bucket*HOP-SIZE/2;let energy=0;
      for(let j=0;j<SIZE;j++) {
        const value=(samples[start+j]||0)*window[j];energy+=value*value;
        for(let k=0;k<5;k++){const next=value+coefficients[k]*previous[k]-older[k];older[k]=previous[k];previous[k]=next;}
      }
      const powers=coefficients.map((c,k)=>Math.max(0,previous[k]**2+older[k]**2-c*previous[k]*older[k]));
      const peak=Math.max(...powers.slice(0,3));
      const shoulders=Math.max(powers[3],powers[4]);
      const octaveRival=[n-12,n+12].some(other=>other>=0&&other<88&&present[other]);
      // Octave-confusable notes need either appreciable fundamental energy or
      // a clean local peak. A genuinely quiet bass still qualifies by contrast.
      supported=energy>1e-12 && peak>energy*SIZE*.00005 && peak>shoulders*1.4 &&
        (!octaveRival || peak>energy*SIZE*.002 || peak>shoulders*6);
      support.set(key,supported);
    }
    if(!supported){frames[i*88+n]=0;onsets[i*88+n]=0;}
  }
  return {frames,onsets};
}
