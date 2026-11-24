import { scales, diatonicModes, type ScaleType, type ScaleChoice } from './scales';
import { rootSpellings, chordDegree, scaleDegree, spellPitch } from './notation';
export type Hand = 'left' | 'right' | 'both';
export type Kind = 'chord' | 'scale' | 'arpeggio' | 'progression';
export type Playing = 'together' | 'sequential';
export type Settings = {
  hand: Hand; kind: Kind; order: 'random' | 'fifths' | 'fourths';
  chordPlaying: Playing | 'alternating';
  scaleMode: ScaleChoice; scaleTonic: 'any' | number;
  voicing: 'root' | 'first' | 'wide'; octave: number; mood: string;
  level: 'basic' | 'triads' | 'extended' | 'all'; seconds: number; gap: number; microphoneSensitivity: number; microphoneNoiseFloor: number;
  keyboard: boolean; hints: boolean; heard: boolean; auto: boolean; difficultOnly: boolean;
};
export const defaults: Settings = { hand: 'right', kind: 'chord', order: 'random', chordPlaying: 'together', scaleMode:'auto', scaleTonic:'any', voicing: 'root', octave: 4, mood: 'all', level: 'basic', seconds: 15, gap: 3, microphoneSensitivity: 50, microphoneNoiseFloor: 0, keyboard: true, hints: true, heard: true, auto: true, difficultOnly: false };
export const pitchClasses = rootSpellings;
export const noteName = (midi: number) => `${pitchClasses[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
export const octaveIndex = (midi: number) => Math.floor(midi / 12) - 1;
export const chords = {
  major: { suffix: '', intervals: [0, 4, 7] }, minor: { suffix: 'm', intervals: [0, 3, 7] },
  sus2: { suffix: 'sus2', intervals: [0, 2, 7] }, sus4: { suffix: 'sus4', intervals: [0, 5, 7] },
  dim: { suffix: 'dim', intervals: [0, 3, 6] }, aug: { suffix: 'aug', intervals: [0, 4, 8] },
  maj7: { suffix: 'maj7', intervals: [0, 4, 7, 11] }, m7: { suffix: 'm7', intervals: [0, 3, 7, 10] },
  six: { suffix: '6', intervals: [0, 4, 7, 9] }, seven: { suffix: '7', intervals: [0, 4, 7, 10] },
  dim7: { suffix: 'dim7', intervals: [0, 3, 6, 9] }, add9: { suffix: 'add9', intervals: [0, 4, 7, 14] },
  mMaj7: { suffix: 'm(maj7)', intervals: [0, 3, 7, 11] }, sus7: { suffix: '7sus4', intervals: [0, 5, 7, 10] },
};
export type ChordType = keyof typeof chords;
export const moods: Record<string, ChordType[]> = {
  all: Object.keys(chords) as ChordType[], bright: ['major', 'sus2', 'maj7', 'add9'],
  happy: ['major', 'sus4', 'six', 'seven'], sad: ['minor', 'm7', 'mMaj7'],
  dark: ['minor', 'dim', 'm7', 'dim7'], oppressive: ['dim', 'aug', 'dim7', 'mMaj7'],
  tense: ['dim', 'sus4', 'seven', 'dim7'], lyrical: ['major', 'minor', 'maj7', 'm7'],
  dreamy: ['sus2', 'aug', 'maj7', 'add9'], fantasy: ['sus2', 'sus4', 'aug', 'add9', 'sus7'],
};
export type Exercise = { id: string; root: number; chord: ChordType; settings: Settings; playing?: Playing; scale?:ScaleType };
export function exerciseScale(exercise:Exercise):ScaleType {
  if(exercise.scale && Object.hasOwn(scales,exercise.scale))return exercise.scale;
  if(exercise.settings.scaleMode && !['auto','diatonic'].includes(exercise.settings.scaleMode))return exercise.settings.scaleMode as ScaleType;
  // Older saved exercises used mood/chord-derived scales. Preserve their notes.
  if(exercise.settings.mood==='fantasy')return 'lydian';
  if(exercise.settings.mood==='oppressive'||exercise.chord==='mMaj7')return 'harmonicMinor';
  return chords[exercise.chord].intervals.includes(3)?'aeolian':'ionian';
}
export type Step = { notes: number[]; left: number[]; right: number[]; label: string; requireTogether?: boolean; root?: number; chord?: ChordType; spelling?:Record<number,string> };
export const playingMode = (exercise: Exercise): Playing => exercise.playing || (exercise.settings.chordPlaying === 'sequential' ? 'sequential' : 'together');
const randomItem = <T,>(items: T[], random: () => number) => items[Math.floor(random() * items.length)];
export function availableChordTypes(settings: Settings): ChordType[] {
  if (settings.level === 'basic') {
    // Mood must not silently introduce unfamiliar harmonies for beginners.
    if (['bright','happy'].includes(settings.mood)) return ['major'];
    if (['sad','dark','oppressive','tense'].includes(settings.mood)) return ['minor'];
    return ['major','minor'];
  }
  return (moods[settings.mood] || moods.all).filter(type => settings.level === 'all' || chords[type].intervals.length === (settings.level === 'triads' ? 3 : 4));
}
export function createExercise(settings: Settings, previous?: Exercise, random = Math.random): Exercise {
  const pool = availableChordTypes(settings);
  let pc = previous && settings.order !== 'random' ? (previous.root + (settings.order === 'fifths' ? 7 : 5)) % 12 : Math.floor(random() * 12);
  if (previous && settings.order === 'random' && pc === previous.root % 12) pc = (pc + 1) % 12;
  if(settings.kind==='scale' && settings.scaleTonic!=='any')pc=settings.scaleTonic;
  const root = (settings.octave + 1) * 12 + pc;
  const chord = randomItem(pool, random);
  const scale:ScaleType|undefined=settings.kind!=='scale'?undefined:settings.scaleMode==='diatonic'?randomItem(diatonicModes,random):settings.scaleMode==='auto'?(chords[chord].intervals.includes(3)?'aeolian':'ionian'):settings.scaleMode;
  const playing: Playing = settings.chordPlaying === 'alternating' ? previous && playingMode(previous) === 'together' ? 'sequential' : 'together' : settings.chordPlaying;
  const id = [root, settings.kind==='scale'?scale:chord, settings.kind, settings.hand, settings.voicing, settings.mood, settings.kind === 'chord' || settings.kind === 'progression' ? playing : 'sequence'].join(':');
  return { id, root, chord, settings: { ...settings }, playing, scale };
}
function voices(root: number, type: ChordType, settings: Settings): Omit<Step, 'label'> {
  let notes = chords[type].intervals.map(i => root + i);
  if (settings.voicing === 'first') notes = [...notes.slice(1), root + 12].sort((a, b) => a - b);
  if (settings.voicing === 'wide') notes = [root - (settings.octave - 2) * 12, ...notes.slice(1)];
  if (settings.hand === 'both') return settings.voicing === 'wide'
    ? { left: notes.slice(0, 1), right: notes.slice(1), notes }
    : { left: notes.map(n => n - 12), right: notes, notes: [...notes.map(n => n - 12), ...notes] };
  return { notes, left: settings.hand === 'left' ? notes : [], right: settings.hand === 'right' ? notes : [] };
}
export function exerciseSteps(exercise: Exercise): Step[] {
  const { root, chord, settings } = exercise;
  const label = pitchClasses[root % 12] + chords[chord].suffix;
  const chordSteps = (root: number, chord: ChordType, label: string): Step[] => {
    const voice = voices(root, chord, settings);
    const spelling=Object.fromEntries(voice.notes.map(note=>{const index=chords[chord].intervals.findIndex(i=>(root+i)%12===note%12);return [note,spellPitch(root,chordDegree(chord,index),note)];}));
    if (playingMode(exercise) === 'together') return [{ ...voice, label, root, chord, spelling, requireTogether: true }];
    // Exactly one note at a time, even with both hands or a split/open voicing.
    // This retains every chord tone and adds no extra tonic as an arpeggio would.
    return [...voice.notes].sort((a,b) => a-b).map(note => ({
      notes: [note], left: voice.left.includes(note) ? [note] : [],
      right: voice.right.includes(note) ? [note] : [], label, root, chord, spelling,
    }));
  };
  if (settings.kind === 'chord') return chordSteps(root, chord, label);
  if (settings.kind === 'progression') {
    return [0, 5, 7].flatMap((shift, index) => {
      const nextRoot = (settings.octave + 1) * 12 + (root + shift) % 12;
      const type = index === 2 ? (settings.level === 'extended' ? 'seven' : 'major') : chord;
      return chordSteps(nextRoot, type, pitchClasses[nextRoot % 12] + chords[type].suffix);
    });
  }
  const intervals = settings.kind === 'arpeggio' ? [...chords[chord].intervals, (Math.floor(Math.max(...chords[chord].intervals)/12)+1)*12]
    : [...scales[exerciseScale(exercise)].notes,12];
  // Scales and arpeggios have one shared, unambiguous starting octave.
  return intervals.map((i,index) => {
    const n = root + i;
    const left = settings.hand === 'both' ? [n - 12] : settings.hand === 'left' ? [n] : [];
    const right = settings.hand !== 'left' ? [n] : [];
    const all=[...left,...right];
    const mode=exerciseScale(exercise);
    const degree=settings.kind==='arpeggio'?(index===intervals.length-1?Math.round(i/12)*7:chordDegree(chord,index)):(index===intervals.length-1?7:scaleDegree(mode,index));
    const spelling=Object.fromEntries(all.map(note=>[note,settings.kind==='scale'&&['chromatic','wholeTone'].includes(mode)?noteName(note):spellPitch(root,degree,note)]));
    return { notes: all, left, right, spelling, label:settings.kind==='scale'?pitchClasses[root%12]:label };
  });
}
export type Feedback = { type: 'uncertain' | 'unconfirmed' | 'octave' | 'notes' | 'timing'; missing: number[]; extra: number[] };
export function compareNotes(expected: number[], heard: number[]): Feedback {
  const extra = heard.filter(n => !expected.includes(n));
  const missing = expected.filter(n => !heard.includes(n));
  if (!heard.length) return { type: 'uncertain', missing, extra };
  const shifted = [-24, -12, 12, 24].some(shift => expected.length === heard.length && expected.every(n => heard.includes(n + shift)));
  return { type: shifted ? 'octave' : 'notes', missing, extra };
}
export function restoreSettings(value: unknown): Settings {
  const next = { ...defaults };
  if (!value || typeof value !== 'object') return next;
  const v = value as Record<string, unknown>;
  if(v.scaleMode==='auto'||v.scaleMode==='diatonic'||typeof v.scaleMode==='string'&&Object.hasOwn(scales,v.scaleMode))next.scaleMode=v.scaleMode as ScaleChoice;
  if(Number.isInteger(v.scaleTonic)&&Number(v.scaleTonic)>=0&&Number(v.scaleTonic)<12)next.scaleTonic=Number(v.scaleTonic);
  for (const key of ['keyboard', 'hints', 'heard', 'auto', 'difficultOnly'] as const) if (typeof v[key] === 'boolean') next[key] = v[key];
  if (typeof v.keyboard !== 'boolean' && v.hints === false && v.heard === false) next.keyboard = false;
  const enums = { hand: ['left', 'right', 'both'], kind: ['chord', 'scale', 'arpeggio', 'progression'], chordPlaying: ['together','sequential','alternating'], order: ['random', 'fifths', 'fourths'], voicing: ['root', 'first', 'wide'], level: ['basic', 'triads', 'extended', 'all'] } as const;
  for (const key of Object.keys(enums) as (keyof typeof enums)[]) if ((enums[key] as readonly unknown[]).includes(v[key])) Object.assign(next, { [key]: v[key] });
  if (typeof v.mood === 'string' && moods[v.mood]) next.mood = v.mood;
  if ([3, 4, 5].includes(v.octave as number)) next.octave = v.octave as number;
  if (typeof v.seconds === 'number' && Number.isFinite(v.seconds)) next.seconds = Math.max(5, Math.min(60, v.seconds));
  if (typeof v.gap === 'number' && Number.isFinite(v.gap)) next.gap = Math.max(0, Math.min(10, v.gap));
  if (typeof v.microphoneSensitivity === 'number' && Number.isFinite(v.microphoneSensitivity)) next.microphoneSensitivity = Math.max(0, Math.min(100, v.microphoneSensitivity));
  if (typeof v.microphoneNoiseFloor === 'number' && Number.isFinite(v.microphoneNoiseFloor)) next.microphoneNoiseFloor = Math.max(0, Math.min(.1, v.microphoneNoiseFloor));
  return next;
}
