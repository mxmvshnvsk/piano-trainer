import type { Feedback } from './music';
import { noteName } from './music';
import type { Language } from './i18n';

export function feedbackText(feedback: Feedback, expected: number[], position: number, language: Language, names:Record<number,string>={}): { title: string; detail: string } {
  const ru = language === 'ru';
  const label=(n:number)=>names[n]||noteName(n);
  if (feedback.type === 'uncertain') return { title: ru ? 'Не удалось распознать ноты' : 'Could not identify the notes', detail: ru ? 'Попробуй ещё раз' : 'Try again' };
  if (feedback.type === 'octave') return { title: ru ? 'Ноты верные, но не та октава' : 'Right notes, wrong octave', detail: ru ? 'Проверь октаву в задании' : 'Check the octave in the task' };
  if (feedback.type === 'timing') return { title: ru ? 'Сыграй все ноты одновременно' : 'Play all notes together', detail: ru ? 'Ноты верные, но прозвучали не одновременно' : 'Right notes, but the attacks were not simultaneous' };
  if (feedback.missing.length === 1 && feedback.extra.length === 1) {
    const target = feedback.missing[0], played = feedback.extra[0];
    const index = expected.length === 1 ? position : Math.max(0, expected.indexOf(target));
    const ordinals = ['первую','вторую','третью','четвёртую','пятую','шестую','седьмую','восьмую'];
    const english = ['first','second','third','fourth','fifth','sixth','seventh','eighth'];
    const up = target > played;
    return {
      title: ru ? `Сыграй ${ordinals[index] || `${index+1}-ю`} ноту ${up ? 'выше' : 'ниже'}` : `Play the ${english[index] || `#${index+1}`} note ${up ? 'higher' : 'lower'}`,
      detail: `${label(played)} → ${label(target)}${Math.abs(target-played)===1 ? ru ? ' · на полтона' : ' · one semitone' : ''}`,
    };
  }
  return {
    title: ru ? 'Проверь ноты' : 'Check the notes',
    detail: [feedback.missing.length ? `${ru ? 'Не распознаны' : 'Not detected'}: ${feedback.missing.map(label).join(', ')}` : '', feedback.extra.length ? `${ru ? 'Лишние ноты' : 'Extra notes'}: ${feedback.extra.map(label).join(', ')}` : ''].filter(Boolean).join(' · '),
  };
}
