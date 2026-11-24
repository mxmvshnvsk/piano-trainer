export type Language = 'ru' | 'en';
import type { ChordType } from './music';
export function voicingName(variant:'root'|'first'|'wide',language:Language,explain=false){
  const names={root:['Основной вид','Root position'],first:['Первое обращение','First inversion'],wide:['Бас в большой октаве','Bass in the great octave']};
  const hints={root:['основной тон внизу','root in the bass'],first:['следующий звук аккорда в басу','next chord tone in the bass'],wide:['нижний звук перенесён в большую октаву','lowest chord tone moved to the great octave']};
  const index=language==='ru'?0:1;
  return names[variant][index]+(explain&&variant!=='wide'?' · '+hints[variant][index]:'');
}
export function rhythmDurationName(duration:number,rest:boolean,language:Language){
  const ru=language==='ru';
  const name=duration>=2?(ru?'Половинная':'Half'):duration===.5?(ru?'Восьмая':'Eighth'):(ru?'Четвертная':'Quarter');
  return ru?`${name} ${rest?'пауза':'нота'}${duration===1.5?' с точкой':''}`:`${duration===1.5?'Dotted ':''}${name.toLowerCase()} ${rest?'rest':'note'}`;
}
export function tonicName(root:number,language:Language){return (language==='ru'?['До','До-диез','Ре','Ми-бемоль','Ми','Фа','Фа-диез','Соль','Ля-бемоль','Ля','Си-бемоль','Си']:['C','C sharp','D','E flat','E','F','F sharp','G','A flat','A','B flat','B'])[((root%12)+12)%12];}
export function chordName(root: number, chord: ChordType, language: Language): string {
  const pc = ((root % 12) + 12) % 12;
  const roots = language === 'ru' ? ['До','До-диез','Ре','Ми-бемоль','Ми','Фа','Фа-диез','Соль','Ля-бемоль','Ля','Си-бемоль','Си'] : ['C','C sharp','D','E flat','E','F','F sharp','G','A flat','A','B flat','B'];
  const descriptions: Record<ChordType,[string,string]> = {
    major:['мажор','major'],minor:['минор','minor'],sus2:['sus2 — секунда вместо терции','suspended second'],sus4:['sus4 — кварта вместо терции','suspended fourth'],
    dim:['уменьшённое трезвучие','diminished triad'],aug:['увеличенное трезвучие','augmented triad'],
    maj7:['большой мажорный септаккорд','major seventh'],m7:['малый минорный септаккорд','minor seventh'],
    six:['мажор с добавленной секстой','major with added sixth'],seven:['малый мажорный септаккорд','dominant seventh'],
    dim7:['уменьшённый септаккорд','diminished seventh'],add9:['мажор с добавленной ноной','major with added ninth'],
    mMaj7:['большой минорный септаккорд','minor major seventh'],sus7:['септаккорд sus4 — кварта вместо терции','dominant seventh suspended fourth'],
  };
  return `${roots[pc]}${chord === 'major' || chord === 'minor' ? ' ' : ' · '}${descriptions[chord][language === 'ru' ? 0 : 1]}`;
}
const dictionary: Record<string,string> = {
  "Любое настроение": "Any mood",
  "Светлое": "Bright",
  "Радостное": "Joyful",
  "Грустное": "Sad",
  "Тёмное": "Dark",
  "Гнетущее": "Oppressive",
  "Напряжённое": "Tense",
  "Лирическое": "Lyrical",
  "Мечтательное": "Dreamy",
  "Фэнтезийное": "Fantasy",
  "Левую": "Left",
  "Правую": "Right",
  "Обе вместе": "Both together",
  "Левая рука": "Left hand",
  "Правая рука": "Right hand",
  "Обе руки": "Both hands",
  "Аккорды": "Chords",
  "Гаммы": "Scales",
  "Арпеджио": "Arpeggios",
  "Ноты задания": "Target notes",
  "Лишние ноты": "Extra notes",
  "Подсвечивать ноты задания": "Highlight target notes",
  "Подсвечивать сыгранные ноты": "Highlight played notes",
  "Переходить автоматически": "Advance automatically",
  "Сыграй гамму вверх": "Play the ascending scale",
  "Сыграй арпеджио вверх": "Play the ascending arpeggio",
  "Субконтроктава": "Subcontra octave",
  "Контроктава": "Contra octave",
  "Большая октава": "Great octave",
  "Малая октава": "Small octave",
  "1-я октава": "1st octave",
  "2-я октава": "2nd octave",
  "3-я октава": "3rd octave",
  "4-я октава": "4th octave",
  "5-я октава": "5th octave"
};
export function text(source: string, language: Language): string {
 if(language==='ru')return source;
 return dictionary[source] || source;
}
export function octaveName(midi:number, language:Language,spelling?:string){const written=spelling?.match(/(-?\d+)$/);const octave=written?+written[1]:Math.floor(midi/12)-1;return text(({0:"Субконтроктава",1:"Контроктава",2:"Большая октава",3:"Малая октава",4:"1-я октава",5:"2-я октава",6:"3-я октава",7:"4-я октава",8:"5-я октава"} as Record<number,string>)[octave] || String(octave),language);}
