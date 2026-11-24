import { useEffect, useRef, useState } from 'react';
import { PianoListener, type PianoDiagnostic, type MicrophoneMetrics } from './audio';
import type { Frame } from './evaluation';
import { defaults, restoreSettings } from './music';
import { diagnosticNoteName } from './notation';
import { microphoneErrorText } from './MicrophoneSettings';
import { compactCalibrationWindows, encodeCalibrationAudio, parseCalibrationNotes, summarizeCalibration } from './calibration-data';
import { read } from './storage';
import './calibration.css';

export function Calibration() {
  const language = read<{language?: 'ru' | 'en'}>('preferences', {}).language || (navigator.language.startsWith('ru') ? 'ru' : 'en');
  const t = (ru: string, en: string) => language === 'ru' ? ru : en;
  const listener = useRef<PianoListener | null>(null);
  const settings = useRef(restoreSettings(read('settings', defaults)));
  const data = useRef({ frames: [] as Frame[], windows: [] as PianoDiagnostic[], metrics: [] as MicrophoneMetrics[] });
  const token = useRef(0), timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [phase, setPhase] = useState<'off' | 'loading' | 'recording' | 'finishing' | 'review'>('off');
  const [level, setLevel] = useState(0), [notes, setNotes] = useState<number[]>([]);
  const [expected, setExpected] = useState(''), [comment, setComment] = useState('');
  const [message, setMessage] = useState(''), [summary, setSummary] = useState<ReturnType<typeof summarizeCalibration>>([]);
  const [saving, setSaving] = useState(false), [saved, setSaved] = useState(false);
  const [gate, setGate] = useState(false);
  const [source, setSource] = useState<string>('');
  const [includeAudio, setIncludeAudio] = useState(false);
  const audioChunks = useRef<Float32Array[]>([]), audioLength = useRef(0);
  useEffect(() => {
    const preferences = read<{theme?: string}>('preferences', {});
    document.documentElement.dataset.theme = preferences.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    return () => { token.current++; clearTimeout(timer.current); listener.current?.dispose(); };
  }, []);
  async function finish(id: number) {
    if (id !== token.current) return;
    setPhase('finishing'); clearTimeout(timer.current);
    try { await listener.current?.finish(); }
    catch { setMessage(t('Не удалось завершить обработку', 'Could not finish processing')); }
    if (id !== token.current) return;
    listener.current?.stop(); setLevel(0); setPhase('review');
    setSummary(summarizeCalibration(data.current.frames));
  }
  async function start() {
    const id = ++token.current;
    clearTimeout(timer.current); setPhase('loading'); setMessage(''); setSaved(false); setSummary([]); setNotes([]); setExpected(''); setComment('');
    data.current = { frames: [], windows: [], metrics: [] };
    audioChunks.current = []; audioLength.current = 0;
    const audio = listener.current ??= new PianoListener();
    audio.pianoGate = gate; setSource('');
    audio.onDiagnosticSamples = includeAudio ? samples => {
      if (id !== token.current || audioLength.current >= 22050 * 6) return;
      const chunk = samples.slice(0, 22050 * 6 - audioLength.current);
      audioChunks.current.push(chunk); audioLength.current += chunk.length;
    } : undefined;
    const s = settings.current;
    audio.setSensitivity(s.microphoneSensitivity); audio.setNoiseFloor(s.microphoneNoiseFloor); audio.setNoiseProfile(s.microphoneNoiseProfile);
    audio.onDiagnostic = window => {
      if (id !== token.current) return;
      data.current.windows.push(window);
      if (window.source) setSource(`${window.source.accepted ? t('Похоже на пианино', 'Piano-like sound') : gate ? t('Источник не подтверждён · ноты скрыты', 'Source not confirmed · notes hidden') : t('Источник не подтверждён · сравнение без фильтра', 'Source not confirmed · unfiltered comparison')} · ${t('оценка класса пианино', 'piano class score')} ${window.source.piano.toFixed(3)}`);
    };
    const fail = (error: Error) => {
      if (id !== token.current) return;
      token.current++; clearTimeout(timer.current); audio.stop(); setLevel(0); setPhase('off');
      setMessage(microphoneErrorText('reason' in error ? String(error.reason) : 'model', language));
    };
    try {
      const ready = await audio.start(frames => {
        if (id !== token.current) return;
        data.current.frames.push(...frames);
        // Show the newest nonempty frame in the recent audio, not notes left
        // over from the beginning of the model window.
        const end = frames.at(-1)?.at ?? 0;
        setNotes(frames.filter(f => f.at >= end - .12 && f.notes.length).at(-1)?.notes || []);
      }, value => { if (id === token.current) setLevel(value); }, fail, () => {}, value => {
        if (id === token.current && data.current.metrics.length < 200) data.current.metrics.push(value);
      });
      if (!ready || id !== token.current) return;
      setPhase('recording'); timer.current = setTimeout(() => void finish(id), 4000);
    } catch (error) { fail(error as Error); }
  }
  async function save() {
    const actual = parseCalibrationNotes(expected);
    if (actual === null) { setMessage(t('Формат: C4 E4 G4 или G♭4. Для шума оставь поле пустым.', 'Use C4 E4 G4 or G♭4. Leave empty for noise.')); return; }
    setSaving(true); setMessage('');
    try {
      const response = await fetch('/__calibration', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version: 1, at: new Date().toISOString(), actual, comment, settings: settings.current, pianoGate: gate, userAgent: navigator.userAgent, ...data.current, windows: compactCalibrationWindows(data.current.windows), audio: includeAudio ? encodeCalibrationAudio(audioChunks.current) : undefined }) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const result = await response.json(); setSaved(true); setMessage(`${t('Сохранено локально:', 'Saved locally:')} ${result.file}`);
    } catch (error) { setMessage(`${t('Не удалось сохранить. Не закрывай страницу и попробуй ещё раз.', 'Could not save. Keep this page open and try again.')} ${error instanceof Error ? error.message : ''}`); }
    finally { setSaving(false); }
  }
  const busy = ['loading', 'recording', 'finishing'].includes(phase);
  return <main className="calibration"><header><a href="/">← {t('Тренажёр', 'Trainer')}</a><span>{t('Локальная калибровка', 'Local calibration')}</span></header>
    <h1>{t('Сверим, что слышит тренажёр', 'Check the piano recognition')}</h1>
    <p>{t('Нажми «Записать», дождись «Играй» и сыграй одну ноту или короткий аккорд без педали. Затем укажи реальные ноты. Для проверки ложных срабатываний запиши только фон.', 'Press Record, wait for Play, then play a single note or short chord without the pedal. Enter the actual notes afterwards. To check false positives, record only background noise.')}</p>
    <div className="calibration-status" role="status">{phase === 'loading' ? t('Готовлю микрофон и модель…', 'Preparing microphone and model…') : phase === 'recording' ? t('Играй · запись 4 секунды', 'Play · recording for 4 seconds') : phase === 'finishing' ? t('Завершаю обработку…', 'Finishing analysis…') : phase === 'review' ? t('Сверь результат', 'Check the result') : t('Микрофон выключен', 'Microphone off')}</div>
    <progress max={1} value={level} aria-label={t('Уровень микрофона', 'Microphone level')} />
    <div className="calibration-live">{notes.length ? notes.map(diagnosticNoteName).join(' · ') : '—'}</div>
    <label><input type="checkbox" disabled={busy || phase === 'review' && !saved} checked={gate} onChange={e => setGate(e.target.checked)} />{t('Скрывать ноты, если пианино не подтверждено · эксперимент', 'Hide notes unless piano is confirmed · experimental')}</label>
    <label><input type="checkbox" disabled={busy || phase === 'review' && !saved} checked={includeAudio} onChange={e => setIncludeAudio(e.target.checked)} />{t('Сохранить короткое аудио этой попытки только на этом Mac', 'Save this attempt’s short audio only on this Mac')}</label>
    <p role="status">{source}</p>
    <button disabled={busy || saving} onClick={() => void start()}>{t('Записать · 4 с', 'Record · 4 s')}</button>
    {phase === 'recording' && <button onClick={() => void finish(token.current)}>{t('Закончить раньше', 'Finish early')}</button>}
    {busy && <button onClick={() => { token.current++; clearTimeout(timer.current); listener.current?.stop(); setPhase('off'); setLevel(0); }}>{t('Отмена', 'Cancel')}</button>}
    {phase === 'review' && <section><h2>{t('Распознано за попытку', 'Detected during the attempt')}</h2>
      <p>{t('Включая короткие предположения. Время — суммарная длительность обнаружения; не длительность нажатия. Уверенность — средняя по нотам кадра, не вероятность каждой отдельной ноты.', 'Includes brief hypotheses. Time is total detection duration, not key hold duration. Confidence is the frame average, not each note’s probability.')}</p>
      {summary.length ? <table><thead><tr><th>{t('Нота', 'Note')}</th><th>{t('Время', 'Time')}</th><th>{t('Макс. уверенность кадра', 'Max. frame confidence')}</th></tr></thead><tbody>{summary.map(item => <tr key={item.note}><td>{diagnosticNoteName(item.note)}</td><td>{Math.round(item.milliseconds)} ms</td><td>{Math.round(item.confidence * 100)}%</td></tr>)}</tbody></table> : <p>{t('Ноты не обнаружены', 'No notes detected')}</p>}
      <label>{t('Что сыграл на самом деле', 'What you actually played')}<input disabled={saved} value={expected} onChange={e => setExpected(e.target.value)} placeholder="C4 E4 G4" autoComplete="off" spellCheck={false} /></label>
      <small>{t('C4 — до первой октавы. Пусто = только шум. Для последовательности перечисли все сыгранные ноты и опиши порядок ниже.', 'C4 is middle C. Empty = noise only. For a sequence, list all notes and describe their order below.')}</small>
      <label>{t('Комментарий', 'Comment')}<input disabled={saved} value={comment} onChange={e => setComment(e.target.value)} placeholder={t('Например: фантомная нота, короткий аккорд', 'For example: phantom note, short chord')} /></label>
      <button disabled={saving || saved} onClick={() => void save()}>{saved ? t('Сохранено', 'Saved') : saving ? t('Сохраняю…', 'Saving…') : t('Сохранить попытку локально', 'Save attempt locally')}</button>
    </section>}
    <p role="status">{message}</p><footer>{t('Данные сохраняются в output/calibration на этом Mac. Аудио сохраняется только при включённой галочке, вместе с попыткой; вне компьютера ничего не отправляется. Настройки микрофона взяты из тренажёра на этом адресе.', 'Data is saved to output/calibration on this Mac. Audio is saved with the attempt only when its checkbox is enabled; nothing leaves this computer. Microphone settings come from the trainer at this address.')}</footer>
  </main>;
}
