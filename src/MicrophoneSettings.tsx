import { useEffect, useId, useRef, useState } from 'react';
import { Mic, Square, LoaderCircle } from 'lucide-react';
import { MicrophoneError, type AudioActivity, type MicrophoneMetrics, type PianoListener } from './audio';
import { microphoneAudible, microphoneGain, microphoneThreshold } from './audio-signal';
import { diagnosticNoteName } from './notation';
import type { Frame } from './evaluation';
import type { Language } from './i18n';
import './microphone.css';

export function microphoneErrorText(reason: string, language: Language) {
  const messages: Record<string, [string, string]> = {
    permission: ['Разреши доступ к микрофону в браузере', 'Allow microphone access in your browser'],
    unavailable: ['Микрофон недоступен. Открой приложение по HTTPS в браузере', 'Microphone unavailable. Open the app over HTTPS in a browser'],
    device: ['Не удалось подключить микрофон. Проверь устройство и повтори', 'Could not connect the microphone. Check the device and retry'],
    model: ['Не удалось подготовить распознавание. При первом запуске нужна сеть', 'Could not prepare recognition. The first launch needs a connection'],
    slow: ['Распознавание заняло слишком долго. Останови проверку и попробуй ещё раз', 'Recognition took too long. Stop and try again'],
  };
  return (messages[reason] || messages.model)[language === 'ru' ? 0 : 1];
}

function dominantNotes(frames: Frame[]) {
  const groups = new Map<string, { count: number; notes: number[] }>();
  for (const frame of frames) if (frame.notes.length) {
    const key = frame.notes.join(',');
    const group = groups.get(key) || { count: 0, notes: frame.notes };
    group.count++; groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => b.count - a.count)[0]?.notes || [];
}

export function MicrophoneSettings({ listener, sensitivity, noiseFloor, onSensitivity, onNoiseFloor, language }: {
  listener: PianoListener; sensitivity: number; noiseFloor: number; onSensitivity: (value: number) => void; onNoiseFloor: (value: number) => void; language: Language;
}) {
  const t = (ru: string, en: string) => language === 'ru' ? ru : en;
  const id = useId();
  const [phase, setPhase] = useState<'off' | 'loading' | 'on' | 'error'>('off');
  const [metrics, setMetrics] = useState<MicrophoneMetrics>();
  const [activity, setActivity] = useState<AudioActivity>('listening');
  const [notes, setNotes] = useState<number[]>([]);
  const [result, setResult] = useState<'waiting' | 'recognized' | 'uncertain'>('waiting');
  const [error, setError] = useState('');
  const token = useRef(0);
  const calibration = useRef<{ until: number; samples: number[] } | null>(null);
  const [calibrating, setCalibrating] = useState(false);
  useEffect(() => { listener.setNoiseFloor(noiseFloor); }, [listener, noiseFloor]);
  useEffect(() => { listener.setSensitivity(sensitivity); }, [listener, sensitivity]);
  useEffect(() => () => { token.current++; listener.stop(); }, [listener]);
  useEffect(() => {
    const hidden = () => { if (document.hidden) stop(); };
    document.addEventListener('visibilitychange', hidden);
    return () => document.removeEventListener('visibilitychange', hidden);
  }, [listener]);
  function stop() { token.current++; calibration.current = null; setCalibrating(false); listener.stop(); setPhase('off'); setMetrics(undefined); setActivity('listening'); setNotes([]); setResult('waiting'); }
  async function start() {
    const attempt = ++token.current;
    setPhase('loading'); setError(''); setMetrics(undefined); setNotes([]); setResult('waiting');
    listener.setSensitivity(sensitivity); listener.setNoiseFloor(noiseFloor);
    const fail = (reason: Error) => {
      if (attempt !== token.current) return;
      calibration.current = null; setCalibrating(false); listener.stop(); setPhase('error'); setMetrics(undefined);
      setError(reason instanceof MicrophoneError ? reason.reason : 'model');
    };
    try {
      const started = await listener.start(frames => {
        if (attempt !== token.current || calibration.current) return;
        const heard = dominantNotes(frames); setNotes(heard); setResult(heard.length ? 'recognized' : 'uncertain');
      }, () => {}, fail, value => { if (attempt === token.current) setActivity(value); }, value => {
        if (attempt !== token.current) return;
        setMetrics(value);
        const measurement = calibration.current;
        if (measurement) {
          measurement.samples.push(value.inputRms);
          if (performance.now() >= measurement.until) {
            const sorted = measurement.samples.sort((a, b) => a - b);
            const floor = Math.max(.0000001, Math.min(.1, sorted[Math.floor((sorted.length - 1) * .9)] || 0));
            calibration.current = null; setCalibrating(false);
            onNoiseFloor(floor); listener.setNoiseFloor(floor); listener.setRecognitionEnabled(true); setResult('waiting'); setNotes([]);
          }
        }
      });
      if (started && attempt === token.current) setPhase('on');
    } catch (reason) { fail(reason as Error); }
  }
  const active = phase === 'on' || phase === 'loading';
  const db = metrics?.rms ? Math.min(0, Math.max(-72, 20 * Math.log10(metrics.rms))) : -72;
  const gainDb = Math.round(200 * Math.log10(microphoneGain(sensitivity))) / 10;
  const loud = !!metrics && (metrics.peak >= .9 || metrics.inputPeak >= .98);
  const audible = !!metrics && microphoneAudible(metrics.rms, sensitivity, noiseFloor);
  const thresholdDb = Math.max(-72, 20 * Math.log10(microphoneThreshold(sensitivity, noiseFloor)));
  const signal = calibrating ? t('Измеряю фон · не играй', 'Measuring background · do not play') : !active || !metrics ? t('Микрофон выключен', 'Microphone off')
    : loud ? metrics.inputPeak >= .98 ? t('Перегрузка входа · сделай инструмент тише', 'Input clipping · turn the instrument down') : t('Слишком громко · снизь чувствительность', 'Too loud · lower sensitivity')
    : audible ? t('Сигнал есть', 'Signal received') : t('Тихо · сыграй ноту или повысь чувствительность', 'Quiet · play a note or raise sensitivity');
  const recognition = calibrating ? t('Измеряю фон · 2 секунды не играй', 'Measuring background · do not play for 2 seconds') : phase === 'error' ? microphoneErrorText(error, language)
    : phase === 'loading' ? t('Готовлю распознавание… Первый запуск может занять больше времени.', 'Preparing recognition… The first launch may take longer.')
    : phase === 'off' ? t('Включи проверку и сыграй несколько нот без педали.', 'Start the check and play a few notes without the pedal.')
    : activity === 'processing' ? t('Звук получен · определяю ноты…', 'Sound received · identifying notes…')
    : result === 'uncertain' ? t('Звук есть, но ноты не определены. Подстрой уровень и повтори.', 'Sound received, but no notes identified. Adjust the level and retry.')
    : result === 'recognized' ? t('Ноты распознаны', 'Notes identified') : t('Сыграй ноту или аккорд', 'Play a note or chord');
  return <section className="microphone-settings" aria-labelledby={`${id}-title`}>
    <div className="microphone-heading"><h3 id={`${id}-title`}>{t('Микрофон', 'Microphone')}</h3><button className="microphone-check" onClick={active ? stop : () => void start()}>{active ? <Square /> : <Mic />}{active ? t('Остановить', 'Stop') : t('Проверить микрофон', 'Check microphone')}</button></div>
    <div className="microphone-slider"><label htmlFor={`${id}-sensitivity`}>{t('Чувствительность', 'Sensitivity')} <strong>{sensitivity}%</strong><small>{gainDb > 0 ? '+' : ''}{gainDb} dB</small></label><input aria-label={t('Чувствительность микрофона', 'Microphone sensitivity')} id={`${id}-sensitivity`} type="range" min="0" max="100" value={sensitivity} onChange={event => { onSensitivity(+event.target.value); listener.setSensitivity(+event.target.value); }} /><span className="microphone-scale"><span>{t('Меньше', 'Lower')}</span><button type="button" onClick={() => onSensitivity(50)}>{t('Сбросить', 'Reset')}</button><span>{t('Больше', 'Higher')}</span></span></div>
    <div className="microphone-calibration"><button disabled={!active || !metrics || calibrating} onClick={() => { calibration.current = { until: performance.now() + 2000, samples: [] }; listener.setRecognitionEnabled(false); setNotes([]); setResult('waiting'); setActivity('listening'); setCalibrating(true); }}>{calibrating ? t('Измеряю фон…', 'Measuring background…') : t('Измерить фон · 2 с тишины', 'Measure background · 2 s of silence')}</button>{noiseFloor > 0 && <button disabled={calibrating} onClick={() => { onNoiseFloor(0); listener.setNoiseFloor(0); }}>{t('Сбросить фон', 'Reset background')}</button>}<span>{noiseFloor > 0 ? `${t('Фон', 'Background')} ${noiseFloor < .0002512 ? '≤ −72' : Math.round(20 * Math.log10(noiseFloor))} dB` : t('Фон не измерен', 'Background not measured')}</span></div>
    <div className={`microphone-meter ${loud ? 'overload' : ''}`} role="meter" aria-label={t('Уровень микрофона после настройки', 'Microphone level after adjustment')} aria-valuemin={-72} aria-valuemax={0} aria-valuenow={Math.round(db)} aria-valuetext={active && metrics ? `${Math.round(db)} dB` : t('Выключен', 'Off')}><span style={{ width: active && metrics ? `${(db + 72) / 72 * 100}%` : '0%' }} /><i aria-hidden="true" style={{ left: `${Math.min(100, (thresholdDb + 72) / 72 * 100)}%` }} /></div>
    <div className="microphone-signal"><span>{active && phase === 'loading' && !metrics ? t('Подключаю микрофон…', 'Connecting microphone…') : signal}</span><span>{active && metrics ? `${Math.round(db)} dB` : '—'}</span></div>
    <div className="microphone-recognition" role="status">{active && (phase === 'loading' || activity === 'processing') && <LoaderCircle className="microphone-spinner" />}<span>{recognition}</span></div>
    <div className="microphone-notes"><span>{t('Распознано:', 'Identified:')}</span><strong>{notes.length ? notes.map(diagnosticNoteName).join(' · ') : '—'}</strong>{metrics?.inferenceMs !== undefined && <small>{t('Проверка', 'Analysis')} {(metrics.inferenceMs / 1000).toFixed(1)} {t('с', 's')}</small>}</div>
    <p className="microphone-help">{t('Сначала измерь фон без игры, затем подстрой чувствительность: пианино должно пересекать отметку на шкале, тишина — нет. Настройки сохраняются на этом устройстве. Чувствительность не меняет строгость проверки нот.', 'Measure the background without playing, then adjust sensitivity: piano should pass the marker and silence should not. Settings are saved on this device. Sensitivity does not change note accuracy requirements.')}</p>
  </section>;
}
