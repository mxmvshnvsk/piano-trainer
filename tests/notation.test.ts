import {describe,expect,it} from 'vitest';
import {parseChordSymbol,musicGlyphs,rhythmGlyph} from '../src/notation';
import {defaults,exerciseSteps,type ChordType} from '../src/music';
import {chordName,octaveName,rhythmDurationName,voicingName} from '../src/i18n';
import {readFileSync} from 'node:fs';

const chord=(root:number,type:ChordType)=>exerciseSteps({id:'test',root,chord:type,settings:{...defaults}})[0];
describe('music notation and spelling',()=>{
  it('distinguishes the root accidental, minor marker and extensions',()=>{
    expect(parseChordSymbol('E♭m')).toMatchObject({root:'E',accidental:'♭',minor:true,quality:''});
    expect(parseChordSymbol('F#maj7')).toMatchObject({root:'F',accidental:'♯',minor:false,quality:'maj7',raised:true});
    expect(parseChordSymbol('Cm(maj7)')).toMatchObject({minor:true,quality:'(maj7)'});
    expect(parseChordSymbol('Csus4')).toMatchObject({minor:false,quality:'sus4'});
  });
  it('uses the actual chord degrees rather than generic black-key names',()=>{
    expect(chord(64,'major').spelling).toEqual({64:'E4',68:'G♯4',71:'B4'});
    expect(chord(63,'minor').spelling).toEqual({63:'E♭4',66:'G♭4',70:'B♭4'});
    expect(chord(60,'dim7').spelling?.[69]).toBe('B𝄫4');
  });
  it('retains written leading tones and octave names in sharp keys',()=>{
    const notes=exerciseSteps({id:'scale',root:61,chord:'major',settings:{...defaults,kind:'scale',scaleMode:'ionian'}});
    expect(notes[2].spelling?.[65]).toBe('E♯4');expect(notes[6].spelling?.[72]).toBe('B♯4');
    expect(octaveName(72,'ru','B♯4')).toBe('1-я октава');
    expect(octaveName(72,'ru')).toBe('2-я октава');
  });
  it('preserves spelling when voicings change the bass and octave',()=>{
    const notes=exerciseSteps({id:'voicing',root:64,chord:'major',settings:{...defaults,voicing:'first'}})[0];
    expect(notes.notes).toEqual([68,71,76]);expect(notes.spelling).toEqual({68:'G♯4',71:'B4',76:'E5'});
  });
  it('ends an extended arpeggio on a tonic above all chord tones',()=>{
    const notes=exerciseSteps({id:'arp',root:60,chord:'add9',settings:{...defaults,kind:'arpeggio'}});
    expect(notes.map(s=>s.notes[0])).toEqual([60,64,67,74,84]);
    expect(notes[3].spelling?.[74]).toBe('D5');expect(notes[4].spelling?.[84]).toBe('C6');
  });
});
describe('rhythmic glyphs and terminology',()=>{
  it('uses the standard SMuFL glyphs for note values and different rests',()=>{
    expect(rhythmGlyph(2,false)).toBe('\uE1D3');expect(rhythmGlyph(1,false)).toBe('\uE1D5');expect(rhythmGlyph(.5,false)).toBe('\uE1D7');
    expect(rhythmGlyph(2,true)).toBe('\uE4E4');expect(rhythmGlyph(1,true)).toBe('\uE4E5');expect(rhythmGlyph(.5,true)).toBe('\uE4E6');
    expect(musicGlyphs.dot).toBe('\uE1E7');
    expect(readFileSync('src/assets/Bravura.woff2').subarray(0,4).toString()).toBe('wOF2');
  });
  it('names the note/rest value instead of calling every rest a quarter rest',()=>{
    expect(rhythmDurationName(2,true,'ru')).toBe('Половинная пауза');
    expect(rhythmDurationName(1.5,false,'ru')).toBe('Четвертная нота с точкой');
    expect(rhythmDurationName(.5,true,'en')).toBe('eighth rest');
  });
  it('uses distinct terminology for inversion, added sixth and the bass preset',()=>{
    expect(voicingName('root','ru',true)).toContain('Основной вид');
    expect(voicingName('wide','ru')).toBe('Бас в большой октаве');
    expect(chordName(60,'six','ru')).toContain('добавленной секстой');
    expect(chordName(60,'mMaj7','ru')).toContain('большой минорный септаккорд');
  });
});
