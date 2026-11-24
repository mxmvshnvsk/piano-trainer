import type { ChordType } from './music';
import type { ScaleType } from './scales';

export const rootSpellings=['C','C♯','D','E♭','E','F','F♯','G','A♭','A','B♭','B'];
const letters=['C','D','E','F','G','A','B'];
const naturals=[0,2,4,5,7,9,11];
export function parseChordSymbol(label:string) {
  const match=/^([A-G])([♭♯b#]?)(.*)$/.exec(label);
  if(!match)return null;
  const suffix=match[3],minor=/^m(?:$|7|\()/.test(suffix);
  return {root:match[1],accidental:match[2].replace('b','♭').replace('#','♯'),minor,quality:minor?suffix.slice(1):suffix,raised:!['','dim','aug','sus2','sus4'].includes(minor?suffix.slice(1):suffix)};
}
export const musicGlyphs={flat:'\uE260',sharp:'\uE262',doubleFlat:'\uE264',doubleSharp:'\uE263',half:'\uE1D3',quarter:'\uE1D5',eighth:'\uE1D7',dot:'\uE1E7',restHalf:'\uE4E4',restQuarter:'\uE4E5',restEighth:'\uE4E6'};
export function rhythmGlyph(duration:number,rest:boolean){return rest?duration>=2?musicGlyphs.restHalf:duration===.5?musicGlyphs.restEighth:musicGlyphs.restQuarter:duration>=2?musicGlyphs.half:duration===.5?musicGlyphs.eighth:musicGlyphs.quarter;}

const chordDegrees:Record<ChordType,number[]>={major:[0,2,4],minor:[0,2,4],sus2:[0,1,4],sus4:[0,3,4],dim:[0,2,4],aug:[0,2,4],maj7:[0,2,4,6],m7:[0,2,4,6],six:[0,2,4,5],seven:[0,2,4,6],dim7:[0,2,4,6],add9:[0,2,4,8],mMaj7:[0,2,4,6],sus7:[0,3,4,6]};
const scaleDegrees:Partial<Record<ScaleType,number[]>>={majorPentatonic:[0,1,2,4,5],minorPentatonic:[0,2,3,4,6],blues:[0,2,3,4,4,6]};
export function chordDegree(type:ChordType,index:number){return chordDegrees[type][index];}
export function scaleDegree(type:ScaleType,index:number){return scaleDegrees[type]?.[index]??index;}
// Keep interval spelling (G♯ in E major, B♯ in C♯ major) independently of MIDI pitch.
export function spellPitch(root:number,degree:number,midi:number):string {
  const rootName=rootSpellings[((root%12)+12)%12],letter=letters.indexOf(rootName[0]);
  const alteration=rootName.includes('♯')?1:rootName.includes('♭')?-1:0;
  const rootOctave=Math.floor((root-alteration)/12)-1;
  const index=rootOctave*7+letter+degree;
  let octave=Math.floor(index/7),pc=naturals[((index%7)+7)%7];
  let natural=(octave+1)*12+pc;
  const shift=Math.round((midi-natural)/12);natural+=shift*12;octave+=shift;
  const accidental=midi-natural;
  const sign=accidental===-2?'𝄫':accidental===-1?'♭':accidental===1?'♯':accidental===2?'𝄪':'';
  return `${letters[((index%7)+7)%7]}${sign}${octave}`;
}
