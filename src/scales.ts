export const scales = {
  ionian: { notes:[0,2,4,5,7,9,11], names:['Мажор · ионийский','Major · Ionian'], hint:['Мажорная гамма.','The major scale.'] },
  aeolian: { notes:[0,2,3,5,7,8,10], names:['Натуральный минор · эолийский','Natural minor · Aeolian'], hint:['Натуральная минорная гамма.','The natural minor scale.'] },
  dorian: { notes:[0,2,3,5,7,9,10], names:['Дорийский','Dorian'], hint:['Как натуральный минор, но шестая ступень на полтона выше.','Natural minor with the sixth degree raised a semitone.'] },
  phrygian: { notes:[0,1,3,5,7,8,10], names:['Фригийский','Phrygian'], hint:['Как натуральный минор, но вторая ступень на полтона ниже.','Natural minor with the second degree lowered a semitone.'] },
  lydian: { notes:[0,2,4,6,7,9,11], names:['Лидийский','Lydian'], hint:['Как мажор, но четвёртая ступень на полтона выше.','Major with the fourth degree raised a semitone.'] },
  mixolydian: { notes:[0,2,4,5,7,9,10], names:['Миксолидийский','Mixolydian'], hint:['Как мажор, но седьмая ступень на полтона ниже.','Major with the seventh degree lowered a semitone.'] },
  locrian: { notes:[0,1,3,5,6,8,10], names:['Локрийский','Locrian'], hint:['Как натуральный минор, но вторая и пятая ступени на полтона ниже.','Natural minor with the second and fifth degrees lowered a semitone.'] },
  harmonicMinor: { notes:[0,2,3,5,7,8,11], names:['Гармонический минор','Harmonic minor'], hint:['Натуральный минор с повышенной седьмой ступенью.','Natural minor with a raised seventh degree.'] },
  melodicMinor: { notes:[0,2,3,5,7,9,11], names:['Мелодический минор · вверх','Melodic minor · ascending'], hint:['Вверх: натуральный минор с повышенными шестой и седьмой ступенями.','Ascending: natural minor with raised sixth and seventh degrees.'] },
  majorPentatonic: { notes:[0,2,4,7,9], names:['Мажорная пентатоника','Major pentatonic'], hint:['Пять звуков: мажор без четвёртой и седьмой ступеней.','Five pitches: major without its fourth and seventh degrees.'] },
  minorPentatonic: { notes:[0,3,5,7,10], names:['Минорная пентатоника','Minor pentatonic'], hint:['Пять звуков: натуральный минор без второй и шестой ступеней.','Five pitches: natural minor without its second and sixth degrees.'] },
  blues: { notes:[0,3,5,6,7,10], names:['Минорная блюзовая','Minor blues'], hint:['Минорная пентатоника с добавленной пониженной пятой ступенью.','Minor pentatonic with an added flat fifth.'] },
  wholeTone: { notes:[0,2,4,6,8,10], names:['Целотонная','Whole-tone'], hint:['Между соседними звуками — целый тон.','Every adjacent step is a whole tone.'] },
  chromatic: { notes:[0,1,2,3,4,5,6,7,8,9,10,11], names:['Хроматическая','Chromatic'], hint:['Все двенадцать звуков, по полутонам.','All twelve pitches in semitone steps.'] },
} as const;
export type ScaleType=keyof typeof scales;
export type ScaleChoice=ScaleType|'auto'|'diatonic';
export const diatonicModes:ScaleType[]=['ionian','dorian','phrygian','lydian','mixolydian','aeolian','locrian'];
export function scaleName(type:ScaleType,language:'ru'|'en') {return scales[type].names[language==='ru'?0:1];}
