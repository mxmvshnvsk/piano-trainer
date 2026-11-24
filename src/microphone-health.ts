export type MicrophoneHealth = 'good' | 'quiet' | 'noise' | 'uncertain' | 'clipping';
export function microphoneHealth(input: {seconds:number;sinceNotes:number;sinceAudible:number;inputPeak:number;analysis?:'good'|'noise'|'uncertain'}): MicrophoneHealth {
  if(input.inputPeak>=.98)return 'clipping';
  if(input.seconds<1.5 || input.sinceNotes<1.5)return 'good';
  if(input.analysis==='noise')return 'noise';
  if(input.sinceAudible>1.5)return 'quiet';
  if(input.analysis==='uncertain')return 'uncertain';
  return 'good';
}
export function microphoneHealthText(health: MicrophoneHealth, language:'ru'|'en') {
  const labels:Record<MicrophoneHealth,[string,string]>={
    good:['',''],
    quiet:['Тихий вход · если играешь, повысь громкость пианино или приблизь микрофон','Quiet input · if you are playing, turn up the piano or move the microphone closer'],
    noise:['Мешает фон · уменьши шум или измерь фон в настройках микрофона','Background interference · reduce noise or measure it in microphone settings'],
    uncertain:['Звук есть, ноты неясны · проверь громкость и настройку микрофона','Sound received, notes unclear · check volume and microphone settings'],
    clipping:['Перегрузка входа · убавь громкость пианино или отодвинь микрофон','Input clipping · turn down the piano or move the microphone farther away'],
  };
  return labels[health][language==='ru'?0:1];
}
