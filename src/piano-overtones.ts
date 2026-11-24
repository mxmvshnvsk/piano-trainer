// An octave partial has a real spectral peak, so the fundamental check alone
// cannot distinguish it from an independently played upper note. Only suppress
// a weak, synchronous upper hypothesis when a much stronger lower note explains
// it. Strong pitch evidence, a clear attack, and a separate entry all preserve it.
const SIZE = 4096, HOP = 1024;
const hann = Float32Array.from({length:SIZE},(_,i)=>.5-.5*Math.cos(2*Math.PI*i/(SIZE-1)));
export class PianoOvertoneMemory {
  readonly notes = new Map<number,{independent:boolean;last:number}>();
  clear() { this.notes.clear(); }
}
export function filterPianoOvertones(frames: Float32Array, onsets: Float32Array, samples?: Float32Array, memory?: PianoOvertoneMemory, startTime = 0) {
  const count = frames.length / 88;
  const peaks = new Float32Array(88), attacks = new Float32Array(88);
  const first = new Int32Array(88).fill(-1);
  const last = new Int32Array(88).fill(-1), active = new Uint16Array(88), removed = new Uint16Array(88);
  for (let i = 0; i < count; i++) for (let n = 0; n < 88; n++) {
    peaks[n] = Math.max(peaks[n], frames[i * 88 + n]);
    attacks[n] = Math.max(attacks[n], onsets[i * 88 + n]);
    if (first[n] < 0 && frames[i * 88 + n] >= .32) first[n] = i;
    if(frames[i*88+n]>=.32){last[n]=i;active[n]++;}
  }
  const ambiguous = new Uint8Array(88);
  for (let upper = 12; upper < 88; upper++) {
    const lower = upper - 12;
    if (first[upper] < 0 || first[lower] < 0) continue;
    // The first few frames of an overlapping window can rise from padding
    // even when both sounds are already held. That is not a separate attack.
    const borrowedAttack = attacks[upper] > peaks[upper] * 1.1 || (first[upper] <= 4 && first[lower] <= 4 && peaks[upper] < .55);
    // A harmonic can produce a large onset-head score too. With audio present,
    // preserve it by independent spectral support rather than that score alone.
    ambiguous[upper] = +(peaks[upper] < .65 && borrowedAttack && (attacks[upper] < .8 || !!samples) && peaks[lower] >= .7 &&
      peaks[upper] < peaks[lower] * .75 && Math.abs(first[upper] - first[lower]) * 256 / 22050 <= .08);
  }
  const spectra = new Map<number,{fundamental:number;second:number;independent:boolean}>();
  function spectrum(note: number, bucket: number) {
    if (!samples) return {fundamental:0,second:0,independent:false};
    const key=bucket*88+note;
    const cached=spectra.get(key);if(cached!==undefined)return cached;
    const f=440*2**((note+21-69)/12);
    const frequencies=[f*.988,f,f*1.012,f*2*.988,f*2,f*2*1.012];
    const coefficients=frequencies.map(value=>2*Math.cos(2*Math.PI*value/22050));
    const previous=new Float64Array(6),older=new Float64Array(6);
    const start=bucket*HOP-SIZE/2;
    for(let i=0;i<SIZE;i++) {
      const value=(samples[start+i]||0)*hann[i];
      for(let k=0;k<6;k++){const next=value+coefficients[k]*previous[k]-older[k];older[k]=previous[k];previous[k]=next;}
    }
    const powers=coefficients.map((c,k)=>Math.max(0,previous[k]**2+older[k]**2-c*previous[k]*older[k]));
    // Preserve a soft real upper tone with its own overtone series. Merely
    // sharing the lower note's strong second partial is insufficient evidence.
    let tuning=0;
    for(let i=1;i<3;i++)if(powers[i]>powers[tuning])tuning=i;
    // Both partials must agree on tuning: an unrelated chord tone near 2f
    // must not count as this note's harmonic at a different detuning offset.
    const supported=powers[3+tuning]>=powers[tuning]*.1;
    const result={fundamental:powers[tuning],second:powers[3+tuning],independent:supported};
    spectra.set(key,result);return result;
  }
  function hasUpperSpectrum(note:number,frame:number) { return spectrum(note,Math.round(frame*256/HOP)).independent; }
  function freshSpectralAttack(note:number,after:number) {
    if(!samples)return false;
    for(let i=0;i<count;i++) {
      if(startTime+i*256/22050<=after || frames[i*88+note]<.32 || onsets[i*88+note]<.35 || i>0&&onsets[(i-1)*88+note]>=.35)continue;
      const bucket=Math.round(i*256/HOP),current=spectrum(note,bucket),previous=spectrum(note,bucket-4);
      const parent=spectrum(note-12,bucket),oldParent=spectrum(note-12,bucket-4);
      // A newly struck upper note adds energy to its own partials without
      // restriking the lower fundamental. A repeated lower note must not unlock
      // the same rejected octave partial again.
      if(current.fundamental>Math.max(1e-10,previous.fundamental*1.3) &&
        current.second>Math.max(1e-10,previous.second*2) && parent.fundamental<=oldParent.fundamental*1.3)return true;
    }
    return false;
  }
  const explained = new Uint8Array(88);
  if(samples)for(let upper=12;upper<88;upper++) {
    const lower=upper-12;
    if(first[upper]<0 || first[lower]<0 || peaks[upper]>=.65 || peaks[lower]<.7 || peaks[upper]>=peaks[lower]*.75)continue;
    const separated=(first[upper]-first[lower])*256/22050>.08;
    // A late model hypothesis is not a separately played note when its actual
    // acoustic partials were already present in the lower note's decay.
    const oldPartial=separated && !freshSpectralAttack(upper,startTime+first[lower]*256/22050+.08);
    const weakShared=peaks[upper]<.5 && Math.abs(first[upper]-first[lower])*256/22050<=.08;
    if(oldPartial || weakShared){ambiguous[upper]=1;explained[upper]=1;}
  }
  const confirmed = new Uint8Array(88), inherited = new Uint8Array(88);
  if(memory)for(let n=0;n<88;n++) {
    let previous=memory.notes.get(n);
    const firstAt=startTime+first[n]*256/22050,lastAt=startTime+last[n]*256/22050;
    if(previous && (first[n]<0 ? startTime+count*256/22050-previous.last>.15 : firstAt-previous.last>.12)) {memory.notes.delete(n);previous=undefined;}
    if(first[n]<0)continue;
    if(peaks[n]>=.65 || previous?.independent || previous && freshSpectralAttack(n,previous.last)) {
      confirmed[n]=1;memory.notes.set(n,{independent:true,last:Math.max(lastAt,previous?.last??-Infinity)});
    } else if(previous) {inherited[n]=1;ambiguous[n]=1;previous.last=Math.max(previous.last,lastAt);}
  }
  for (let i = 0; i < count; i++) for (let n = 12; n < 88; n++) {
    if (!confirmed[n] && ambiguous[n] && frames[i*88+n]>=.32 && frames[i * 88 + n - 12] >= .5 && (inherited[n] || explained[n] || !hasUpperSpectrum(n,i))) { frames[i * 88 + n] = 0; onsets[i * 88 + n] = 0;removed[n]++; }
  }
  if(memory)for(let n=12;n<88;n++) {
    if(confirmed[n] || inherited[n] || first[n]<0)continue;
    const lastAt=startTime+last[n]*256/22050;
    if(removed[n]>=4 && removed[n]>=active[n]*.6)memory.notes.set(n,{independent:false,last:lastAt});
    else if(peaks[n]>=.5 && active[n]>=4 && removed[n]<=active[n]*.2) {
      let supported=0;
      for(let i=first[n];i<=last[n];i++)if(frames[i*88+n]>=.32 && hasUpperSpectrum(n,i))supported++;
      if(supported>=active[n]*.8)memory.notes.set(n,{independent:true,last:lastAt});
    }
  }
  return { frames, onsets };
}
