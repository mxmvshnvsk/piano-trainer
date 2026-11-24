import { Select } from './Select';
import { offsetPianoFrames } from './audio-decoder';
import { Crossfade } from './Crossfade';
import { readRoute, routeHash, type Mode, type Panel } from './routes';
import { cloneElement, isValidElement, useEffect, useId, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { AudioLines, Bookmark, BookmarkPlus, Check, CircleCheck, CircleAlert, ChevronRight, Download, Keyboard as KeyboardIcon, Languages, LoaderCircle, Moon, Pause, Piano, Play, Infinity as InfinityIcon, Metronome, Star, SlidersHorizontal, Sun, Trash2, X, WifiOff, Mic } from 'lucide-react';
import { createExercise, defaults, exerciseSteps, exerciseScale, moods, noteName, playingMode, restoreSettings, type Exercise, type Settings, type Feedback } from './music';
import { Evaluator, type Frame, type LiveFeedback } from './evaluation';
import { MicrophoneError, PianoListener, type AudioActivity } from './audio';
import { feedbackText } from './feedback';
import { chordName, tonicName, octaveName, voicingName, text, type Language } from './i18n';
import { scales, scaleName, type ScaleType } from './scales';
import { read, readDifficult, write } from './storage';
import { watchUpdates } from './updates';
import { FlowGate, flowSettings } from './flow';
import { ChordSymbol } from './MusicNotation';
import { RhythmTrainer } from './RhythmTrainer';
import { MicrophoneSettings, microphoneErrorText } from './MicrophoneSettings';

type Phase = 'ready' | 'loading' | 'listening' | 'analyzing' | 'paused' | 'success' | 'feedback' | 'error';
type Preferences = { theme?: 'light' | 'dark'; language?: Language };
type InstallEvent = Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: string }> };
function systemLanguage(): Language { return (navigator.languages.find(l => /^(ru|en)\b/i.test(l)) || 'en').startsWith('ru') ? 'ru' : 'en'; }
export function App() {
  const [settings, setSettings] = useState(() => restoreSettings(read('settings', defaults)));
  const [route, setRoute] = useState(() => readRoute(location.hash));
  const { mode, panel } = route;
  const flow = mode === 'flow', rhythm = mode === 'rhythm';
  const previousRoute = useRef(route);
  const pendingExercise = useRef<Exercise | null>(null);
  const navigate = (nextMode: Mode, nextPanel: Panel = null) => { location.hash = routeHash(nextMode, nextPanel); };
  useEffect(() => {
    const changed = () => setRoute(readRoute(location.hash));
    window.addEventListener('hashchange', changed);
    return () => window.removeEventListener('hashchange', changed);
  }, []);
  const activeSettings = flow ? flowSettings(settings) : settings;
  const [difficult, setDifficult] = useState<Exercise[]>(readDifficult);
  const [preferences, setPreferences] = useState<Preferences>(() => { const p = read<Preferences | null>('preferences', {}) || {}; return { theme: ['light','dark'].includes(p.theme || '') ? p.theme : undefined, language: ['ru','en'].includes(p.language || '') ? p.language : undefined }; });
  const [systemDark, setSystemDark] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches);
  const [systemLang, setSystemLang] = useState(systemLanguage);
  const language = preferences.language || systemLang;
  const theme = preferences.theme || (systemDark ? 'dark' : 'light');
  const t = (ru: string, en?: string) => language === 'ru' ? ru : en || text(ru, language);
  const [exercise, setExercise] = useState(() => createExercise(activeSettings));
  const steps = exerciseSteps(exercise);
  const [stepIndex, setStepIndex] = useState(0);
  const currentStep = steps[Math.min(stepIndex, steps.length - 1)];
  const chordExercise = exercise.settings.kind === 'chord' || exercise.settings.kind === 'progression';
  const sequentialChord = chordExercise && playingMode(exercise) === 'sequential';
  const playingLabel = (item: Exercise) => playingMode(item) === 'together' ? t('Одновременно', 'Together') : t('Последовательно · снизу вверх', 'One note at a time · ascending');
  const [number, setNumber] = useState(1);
  const [phase, setPhase] = useState<Phase>('ready');
  const phaseRef = useRef<Phase>('ready');
  const changePhase = (next: Phase) => { phaseRef.current = next; setPhase(next); };
  const [input, setInput] = useState<'microphone' | 'demo'>('microphone');
  const [heard, setHeard] = useState<number[]>([]);
  const [level, setLevel] = useState(0);
  const [remaining, setRemaining] = useState(settings.seconds);
  const remainingRef = useRef(settings.seconds);
  const [countdown, setCountdown] = useState(settings.gap);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [liveFeedback, setLiveFeedback] = useState<LiveFeedback | null>(null);
  const [activity, setActivity] = useState<AudioActivity>('listening');
  const [cueRevision, setCueRevision] = useState(0);
  const cueSignature = useRef('');
  const demoProcessing = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const demoJob = useRef<Promise<void> | undefined>(undefined);
  const resolveDemo = useRef<(() => void) | undefined>(undefined);
  const [error, setError] = useState('');
  const [offlineReady, setOfflineReady] = useState(false);
  const [offlineError, setOfflineError] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [update, setUpdate] = useState<ServiceWorkerRegistration>();
  const [updating, setUpdating] = useState(false);
  const [install, setInstall] = useState<InstallEvent>();
  const listener = useRef<PianoListener | null>(null);
  const evaluator = useRef(new Evaluator(steps));
  const attemptToken = useRef(0);
  const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const deadline = useRef(0);
  const demoSelected = useRef<number[]>([]);
  const demoTime = useRef(0);
  const pauseFrom = useRef<Phase>('listening');
  const nextRef = useRef<() => void>(() => {});
  const autoStart = useRef(false);
  const acceptRef = useRef<(frames: Frame[]) => void>(() => {});
  const flowGate = useRef(new FlowGate());
  const lastFrame = useRef(-Infinity);

  useEffect(() => { write('settings', settings); }, [settings]);
  useEffect(() => { write('difficult', difficult); }, [difficult]);
  useEffect(() => {
    if (!difficult.length) setSettings(s => s.difficultOnly ? { ...s, difficultOnly: false } : s);
  }, [difficult.length]);
  useEffect(() => { write('preferences', preferences); }, [preferences]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    document.documentElement.lang = language;
    document.querySelector('meta[name=theme-color]')?.setAttribute('content', theme === 'dark' ? '#201e25' : '#faf8f6');
  }, [theme, language]);
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)');
    const appearance = () => setSystemDark(media.matches), lang = () => setSystemLang(systemLanguage());
    media.addEventListener('change', appearance); window.addEventListener('languagechange', lang);
    return () => { media.removeEventListener('change', appearance); window.removeEventListener('languagechange', lang); };
  }, []);
  useEffect(() => {
    let disposed = false;
    let stopUpdates: (() => void) | undefined;
    const offline = () => setOnline(navigator.onLine);
    const offerInstall = (event: Event) => { event.preventDefault(); setInstall(event as InstallEvent); };
    window.addEventListener('online', offline); window.addEventListener('offline', offline); window.addEventListener('beforeinstallprompt', offerInstall);
    if (import.meta.env.PROD && 'serviceWorker' in navigator) {
      void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL, updateViaCache: 'none' }).then(registration => {
        if (disposed) return;
        stopUpdates = watchUpdates(registration, setUpdate);
        return navigator.serviceWorker.ready;
      }).then(() => { if (!disposed) setOfflineReady(true); }).catch(() => { if (!disposed) setOfflineError(true); });
    }
    return () => { disposed = true; stopUpdates?.(); window.removeEventListener('online', offline); window.removeEventListener('offline', offline); window.removeEventListener('beforeinstallprompt', offerInstall); };
  }, []);
  useEffect(() => () => { attemptToken.current++; clearInterval(timer.current); clearTimeout(demoProcessing.current); resolveDemo.current?.(); listener.current?.dispose(); }, []);

  function cancel() { attemptToken.current++; clearInterval(timer.current); clearTimeout(demoProcessing.current); resolveDemo.current?.(); resolveDemo.current = undefined; demoJob.current = undefined; listener.current?.stop(); setLevel(0); setActivity('listening'); }
  function reset(next: Exercise, keepCapture = false) {
    if (keepCapture) flowGate.current.arm(lastFrame.current, evaluator.current.steps.at(-1)!.notes);
    else { cancel(); flowGate.current.clear(); lastFrame.current = -Infinity; }
    setExercise(next); evaluator.current = new Evaluator(exerciseSteps(next), keepCapture ? lastFrame.current : -Infinity);
    setStepIndex(0); setHeard([]); setFeedback(null); setLiveFeedback(null); cueSignature.current=''; setError(''); setRemaining(next.settings.seconds);
    remainingRef.current = next.settings.seconds; demoSelected.current = []; if (!keepCapture) demoTime.current = 0; changePhase(keepCapture ? 'listening' : 'ready');
  }
  useEffect(() => {
    const previous = previousRoute.current;
    previousRoute.current = route;
    if (previous.mode !== mode) {
      autoStart.current = false;
      reset(pendingExercise.current || createExercise(activeSettings));
      pendingExercise.current = null;
    } else if (panel && previous.panel !== panel && ['listening','loading','analyzing','success'].includes(phaseRef.current)) {
      pause();
    }
  }, [route]);
  function practiseSaved(item: Exercise) {
    if (mode !== 'practice') pendingExercise.current = item;
    else reset(item);
    navigate('practice');
  }
  function next(continueSession = false) {
    const pool = flow ? difficult.filter(e => e.settings.kind === 'chord' && playingMode(e) === 'together') : difficult;
    const nextTask = settings.difficultOnly && pool.length ? pool[(pool.findIndex(e => e.id === exercise.id) + 1) % pool.length] : createExercise(activeSettings, exercise);
    const keepCapture = flow && ['listening','success'].includes(phaseRef.current);
    autoStart.current = continueSession && !keepCapture;
    reset(nextTask, keepCapture); setNumber(n => n + 1);
  }
  nextRef.current = () => next(true);
  useEffect(() => { if (autoStart.current) { autoStart.current = false; void start(); } }, [exercise, number]);
  function complete() {
    if (!flow) cancel();
    setLiveFeedback(null); setCueRevision(r=>r+1); setHeard(evaluator.current.steps.at(-1)!.notes); setStepIndex(steps.length); setCountdown(settings.gap); changePhase('success');
  }
  function acceptFrames(frames: Frame[]) {
    lastFrame.current = Math.max(lastFrame.current, ...frames.map(f => f.at));
    if (!['listening', 'analyzing'].includes(phaseRef.current)) return;
    let latest: number[] = [];
    let candidate: LiveFeedback | null = null;
    for (const frame of frames) {
      if (flow && !flowGate.current.accept(frame)) continue;
      latest = frame.confidence >= .5 ? frame.notes : [];
      const before = evaluator.current.index;
      const target = evaluator.current.steps[before]?.notes || [];
      const result = evaluator.current.push(frame);
      setStepIndex(result.index);
      if (result.complete) { complete(); return; }
      const problem = evaluator.current.liveFeedback();
      if (result.index !== before || frame.confidence >= .5 && frame.notes.length === target.length && target.every(n=>frame.notes.includes(n)) && !problem) candidate=null;
      if (problem) candidate=problem;
    }
    const problem = candidate || evaluator.current.liveFeedback();
    setHeard(!latest.length && problem ? [...problem.expected.filter(n=>!problem.feedback.missing.includes(n)),...problem.feedback.extra] : latest);
    const signature = JSON.stringify(problem);
    if (signature !== cueSignature.current) { cueSignature.current=signature; setLiveFeedback(problem); if(problem)setCueRevision(r=>r+1); }
  }
  acceptRef.current = acceptFrames;
  function audioError(reason: Error) {
    cancel(); changePhase('error');
    setError(reason instanceof MicrophoneError ? reason.reason : 'model');
  }
  async function finish() {
    clearInterval(timer.current); changePhase('analyzing');
    const token = attemptToken.current;
    try {
      if (input === 'microphone') await listener.current?.finish();
      else await demoJob.current;
      if (token !== attemptToken.current || phaseRef.current === 'success') return;
      const result = evaluator.current.feedback();
      const target = evaluator.current.steps[Math.min(evaluator.current.index, evaluator.current.steps.length - 1)].notes;
      listener.current?.stop(); setFeedback(result); setHeard([...target.filter(n => !result.missing.includes(n)), ...result.extra]);
      changePhase('feedback'); setLevel(0);
    } catch (reason) { if (token === attemptToken.current) audioError(reason as Error); }
  }
  async function start(resume = false) {
    flowGate.current.clear(); lastFrame.current = -Infinity;
    if (!resume) { evaluator.current = new Evaluator(steps); setStepIndex(0); remainingRef.current = settings.seconds; setRemaining(settings.seconds); setHeard([]); demoSelected.current = []; demoTime.current = 0; }
    setFeedback(null); setLiveFeedback(null); cueSignature.current=''; setActivity('listening'); setError(''); const token = ++attemptToken.current;
    if (input === 'microphone') {
      changePhase('loading');
      try {
        listener.current ??= new PianoListener();
        listener.current.setSensitivity(settings.microphoneSensitivity); listener.current.setNoiseFloor(settings.microphoneNoiseFloor); listener.current.setNoiseProfile(settings.microphoneNoiseProfile);
        const previousTime = resume ? (settings.seconds - remainingRef.current) : 0;
        const started = await listener.current.start(frames => { if (token === attemptToken.current) acceptRef.current(offsetPianoFrames(frames, previousTime)); }, setLevel, audioError, value => { if(token === attemptToken.current)setActivity(value); });
        if (!started || token !== attemptToken.current) return;
      } catch (reason) { if (token === attemptToken.current) audioError(reason as Error); return; }
    }
    changePhase('listening'); deadline.current = performance.now() + remainingRef.current * 1000;
    clearInterval(timer.current);
    if (flow) return;
    timer.current = setInterval(() => {
      remainingRef.current = Math.max(0, (deadline.current - performance.now()) / 1000);
      setRemaining(remainingRef.current);
      if (remainingRef.current <= 0) void finish();
    }, 100);
  }
  function pause() {
    pauseFrom.current = phaseRef.current; cancel(); changePhase('paused');
    // Resume checks the current step afresh rather than joining evidence across a pause.
    const completed = evaluator.current.index;
    evaluator.current = new Evaluator(steps); evaluator.current.index = completed;
  }
  function primary() {
    if (['listening', 'loading', 'analyzing'].includes(phaseRef.current)) pause();
    else if (phaseRef.current === 'paused') { if (flow && pauseFrom.current === 'success') { next(true); } else if (pauseFrom.current === 'success') changePhase('success'); else void start(true); }
    else if (phaseRef.current === 'success') { if (flow || settings.auto) pause(); else void start(); }
    else void start();
  }
  useEffect(() => {
    if (phase === 'success' && flow && !panel) {
      const timeout = setTimeout(() => nextRef.current(), 350);
      return () => clearTimeout(timeout);
    }
    if (phase !== 'success' || !settings.auto || panel) return;
    const target = performance.now() + countdown * 1000;
    const interval = setInterval(() => {
      const left = Math.max(0, (target - performance.now()) / 1000); setCountdown(left);
      if (left === 0) { clearInterval(interval); nextRef.current(); }
    }, 100);
    return () => clearInterval(interval);
    // The countdown is the initial duration; updates must not restart this timer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, settings.auto, panel, flow]);
  useEffect(() => {
    const hidden = () => { if (document.hidden && ['listening','loading','analyzing','success'].includes(phaseRef.current)) pause(); };
    document.addEventListener('visibilitychange', hidden);
    return () => document.removeEventListener('visibilitychange', hidden);
  });

  function playDemo(note: number) {
    if (input !== 'demo' || phaseRef.current !== 'listening' || activity === 'processing') return;
    const step = steps[evaluator.current.index]; if (!step) return;
    demoSelected.current = demoSelected.current.includes(note) ? demoSelected.current.filter(n => n !== note) : [...demoSelected.current, note];
    setHeard(demoSelected.current);
    setActivity('heard');
    if (demoSelected.current.length >= step.notes.length) {
      const notes=[...demoSelected.current], token=attemptToken.current;
      demoSelected.current=[]; setActivity('processing');
      let resolve!: () => void;
      const job = new Promise<void>(done => { resolve = done; });
      demoJob.current = job; resolveDemo.current = resolve;
      demoProcessing.current=setTimeout(()=>{
        if(token===attemptToken.current && ['listening','analyzing'].includes(phaseRef.current)) {
          setActivity('listening'); const at=demoTime.current+=.7;
          acceptRef.current([0,.12,.26,.4].map(offset=>({at:at+offset,notes,onsets:offset===0?notes:[],confidence:1})));
        }
        resolve();
        if(demoJob.current===job) { demoJob.current=undefined; resolveDemo.current=undefined; }
      },300);
    }
  }
  const saved = difficult.some(e => e.id === exercise.id);
  const toggleDifficult = () => setDifficult(list => list.some(item => item.id === exercise.id)
    ? list.filter(item => item.id !== exercise.id)
    : [...list, exercise]);

  const visibleNotes = [...new Set(steps.flatMap(step => step.notes))];
  const noteNames:Record<number,string>=Object.assign({},...steps.map(step=>step.spelling||{}));
  const pitchLabel=(note:number)=>noteNames[note]||noteName(note);
  const shownFeedback = phase === 'feedback' ? feedback : phase === 'listening' && activity !== 'processing' ? liveFeedback?.feedback : null;
  const feedbackStep = phase === 'feedback' ? Math.min(evaluator.current.index,steps.length-1) : liveFeedback?.step ?? stepIndex;
  const feedbackTarget = liveFeedback && phase !== 'feedback' ? liveFeedback.expected : steps[Math.min(feedbackStep,steps.length-1)].notes;
  const ordinal = exercise.settings.kind === 'progression' ? steps.slice(0,feedbackStep).filter(s=>s.label===steps[feedbackStep]?.label).length : feedbackStep;
  const message = shownFeedback ? feedbackText(shownFeedback,feedbackTarget,ordinal,language,noteNames) : null;
  const status = phase === 'ready' ? '' : phase === 'loading' ? t('Готовлю микрофон и распознавание…', 'Preparing microphone and recognition…')
    : phase === 'listening' ? message?.title || (activity === 'processing' ? t('Слышу ноты · проверяю…','Notes heard · checking…') : activity === 'background' ? t('Фон подавлен · жду ноты','Background reduced · waiting for notes') : activity === 'uncertain' ? t('Звук есть · ноты не определены','Sound received · no notes identified') : activity === 'heard' ? t('Слышу ноты','Notes heard') : t('Слушаю','Listening'))
    : phase === 'analyzing' ? t('Проверяю последние ноты…', 'Checking the last notes…')
    : phase === 'paused' ? t('Тренировка на паузе', 'Practice paused') : phase === 'success' ? t('Всё верно', 'All correct')
    : phase === 'feedback' ? message?.title || '' : microphoneErrorText(error, language);
  const cueType = phase === 'success' ? 'success' : phase === 'feedback' && feedback?.type === 'unconfirmed' ? 'heard' : message || phase === 'error' ? 'incorrect' : phase === 'analyzing' || phase === 'loading' || phase === 'listening' && activity === 'processing' ? 'processing' : phase === 'listening' && activity === 'heard' ? 'heard' : 'neutral';
  const primaryLabel = ['listening','loading','analyzing'].includes(phase) || phase === 'success' && (flow || settings.auto) ? t('Пауза', 'Pause')
    : phase === 'paused' ? t('Продолжить', 'Resume') : phase === 'ready' ? t('Начать', 'Start') : t('Повторить', 'Try again');
  const patch = <K extends keyof Settings>(key: K, value: Settings[K]) => setSettings(s => ({ ...s, [key]: value }));

  const displayIdentity = `${exercise.id}:${number}:${Math.min(stepIndex, steps.length - 1)}`;
  return <div className={`shell ${panel ? 'panel-open' : ''} ${flow && !panel ? 'flow-mode' : ''}`} data-result={cueType}>
    <header>
      <a className="brand" href={routeHash('practice')} aria-label={t('На главную · основной тренажёр','Home · main trainer')} title={t('Вернуться в тренажёр','Return to practice')}><Piano aria-hidden="true" />piano practice</a>
      <nav className="mode-nav" aria-label={t('Режимы тренировки','Practice modes')}>
        {([{ id: 'practice', icon: Piano, label: t('Тренажёр','Practice') }, { id: 'flow', icon: InfinityIcon, label: t('Поток','Flow') }, { id: 'rhythm', icon: Metronome, label: t('Ритм','Rhythm') }] as const).map(({id,icon:Icon,label}) => <a key={id} href={routeHash(id)} aria-current={mode === id && !panel ? 'page' : undefined}><Icon aria-hidden="true"/><span>{label}</span></a>)}
      </nav>
      <nav className="utility-nav" aria-label={t('Управление', 'Controls')}>
        <a className="nav-button" href={routeHash(mode, panel === 'difficult' ? null : 'difficult')} aria-label={t('Трудное', 'Difficult')} aria-current={panel === 'difficult' ? 'page' : undefined}><Bookmark aria-hidden="true"/><span className="nav-label">{t('Трудное', 'Difficult')}</span><span className="saved-count">{difficult.length}</span></a>
        <a className="nav-button" href={routeHash(mode, panel === 'settings' ? null : 'settings')} aria-label={t('Настройки', 'Settings')} aria-current={panel === 'settings' ? 'page' : undefined}><SlidersHorizontal aria-hidden="true"/><span className="nav-label">{t('Настройки', 'Settings')}</span></a>
        <button className="icon-button" onClick={() => setPreferences(p => ({ ...p, theme: theme === 'dark' ? 'light' : 'dark' }))} aria-label={t('Переключить тему', 'Toggle theme')} title={t('Переключить тему', 'Toggle theme')}>{theme === 'dark' ? <Sun /> : <Moon />}</button>
        <button className="icon-button" onClick={() => setPreferences(p => ({ ...p, language: language === 'ru' ? 'en' : 'ru' }))} aria-label={language === 'ru' ? 'Switch to English' : 'Переключить на русский'} title={language === 'ru' ? 'English' : 'Русский'}><Languages /></button>
      </nav>
    </header>
    {panel === 'settings' ? <section className="panel">
      <div className="panel-heading"><h2>{t('Настройки тренировки', 'Practice settings')}</h2><button className="icon-button" onClick={() => navigate(mode)} aria-label={t('Закрыть', 'Close')}><X /></button></div>
      <div className="fields">
        <Field label={t('Какую руку тренируем', 'Practice hand')}><div className="hand-picker">{(['left','right','both'] as const).map(hand => <button key={hand} aria-pressed={settings.hand === hand} onClick={() => patch('hand', hand)}>{t(({ left: 'Левую', right: 'Правую', both: 'Обе вместе' })[hand])}</button>)}</div></Field>
        <Field label={t(settings.hand==='both'?'Исходная октава правой руки':'Исходная октава',settings.hand==='both'?'Right-hand reference octave':'Reference octave')}><Select value={settings.octave} onChange={e => patch('octave', +e.target.value)}>{[3,4,5].map(o => <option key={o} value={o}>{octaveName((o+1)*12, language)} · C{o}–B{o}</option>)}</Select></Field>
        <Field label={t('Упражнения', 'Exercises')}><Select disabled={flow} value={flow ? 'chord' : settings.kind} onChange={e => patch('kind', e.target.value as Settings['kind'])}>{[['chord','Аккорды','Chords'],['scale','Гаммы','Scales'],['arpeggio','Арпеджио','Arpeggios'],['progression','Три аккорда подряд','Three-chord sequence']].map(([value,ru,en]) => <option value={value} key={value}>{t(ru,en)}</option>)}</Select></Field>
        {!flow && settings.kind==='scale' && <>
          <Field label={t('Лад / гамма','Mode / scale')}><Select value={settings.scaleMode} onChange={e=>patch('scaleMode',e.target.value as Settings['scaleMode'])}><option value="auto">{t('Мажор или минор · по настроению','Major or minor · by mood')}</option><option value="diatonic">{t('Случайный из семи ладов','Random diatonic mode')}</option>{(Object.keys(scales) as ScaleType[]).map(mode=><option key={mode} value={mode}>{scaleName(mode,language)}</option>)}</Select></Field>
          <Field label={['wholeTone','chromatic'].includes(settings.scaleMode)?t('Начальный звук','Starting pitch'):t('Тоника гаммы','Scale tonic')}><Select value={settings.scaleTonic} onChange={e=>patch('scaleTonic',e.target.value==='any'?'any':+e.target.value)}><option value="any">{t('По выбранному порядку','Follow the selected order')}</option>{Array.from({length:12},(_,pc)=><option key={pc} value={pc}>{tonicName(pc,language)} · {noteName(pc+60).slice(0,-1)}</option>)}</Select></Field>
          <p className="scale-setting-note">{settings.scaleMode==='auto'?t('Мажор и минор выбираются по настроению.','Mood selects major or minor.'):settings.scaleMode==='diatonic'?t('Ионийский, дорийский, фригийский, лидийский, миксолидийский, эолийский и локрийский.','Ionian, Dorian, Phrygian, Lydian, Mixolydian, Aeolian and Locrian.'):scales[settings.scaleMode].hint[language==='ru'?0:1]} {['wholeTone','chromatic'].includes(settings.scaleMode)?t('Здесь выбирается начальный звук гаммы.','Choose the starting pitch of the scale.'):t('Тоника — центральный звук лада. В этом упражнении гамма начинается с тоники.','The tonic is the tonal centre. This exercise starts the scale on its tonic.')}</p>
        </>}
        <Field label={t('Как играть аккорды', 'Chord playing style')}><Select disabled={flow || settings.kind !== 'chord' && settings.kind !== 'progression'} value={flow ? 'together' : settings.chordPlaying} onChange={e => patch('chordPlaying', e.target.value as Settings['chordPlaying'])}>{[['together','Одновременно','Together'],['sequential','Последовательно · снизу вверх','One note at a time, ascending'],['alternating','Чередовать оба способа','Alternate both styles']].map(([value,ru,en]) => <option key={value} value={value}>{t(ru,en)}</option>)}</Select></Field>
        <Field label={t('Порядок заданий', 'Exercise order')}><Select disabled={!flow&&settings.kind==='scale'&&settings.scaleTonic!=='any'} value={settings.order} onChange={e => patch('order', e.target.value as Settings['order'])}>{[['random','Случайный','Random'],['fifths','По квинтам','Circle of fifths'],['fourths','По квартам','Circle of fourths']].map(([value,ru,en]) => <option value={value} key={value}>{t(ru,en)}</option>)}</Select></Field>
        <Field label={t('Вариант аккорда', 'Chord voicing preset')}><Select disabled={settings.kind === 'scale' || settings.kind === 'arpeggio'} value={settings.voicing} onChange={e => patch('voicing', e.target.value as Settings['voicing'])}>{(['root','first','wide'] as const).map(value=><option key={value} value={value}>{voicingName(value,language,true)}</option>)}</Select></Field>
        <Field label={t('Настроение', 'Mood')}><Select disabled={!flow&&settings.kind==='scale'&&settings.scaleMode!=='auto'} value={settings.mood} onChange={e => patch('mood', e.target.value)}>{Object.keys(moods).map((mood,i) => <option key={mood} value={mood}>{t(['Любое настроение','Светлое','Радостное','Грустное','Тёмное','Гнетущее','Напряжённое','Лирическое','Мечтательное','Фэнтезийное'][i])}</option>)}</Select></Field>
        <Field label={t('Типы аккордов', 'Chord types')}><Select disabled={!flow&&settings.kind==='scale'} value={settings.level} onChange={e => patch('level', e.target.value as Settings['level'])}>{[['basic','Мажорные и минорные трезвучия','Major and minor triads'],['triads','Трезвучия и sus-аккорды','Triads and suspended chords'],['extended','Четырёхзвучные аккорды','Four-note chords'],['all','Все типы аккордов','All chord types']].map(([value,ru,en]) => <option key={value} value={value}>{t(ru,en)}</option>)}</Select></Field>
        <Field label={t('Источник заданий', 'Exercise pool')}><Select value={settings.difficultOnly ? 'difficult' : 'all'} onChange={e => patch('difficultOnly', e.target.value === 'difficult')}><option value="all">{t('Все упражнения','All exercises')}</option><option value="difficult" disabled={!difficult.length}>{t('Только трудное','Difficult only')}</option></Select></Field>
        <Field label={`${t('Время попытки','Attempt duration')} · ${settings.seconds} ${t('с','s')}`}><input disabled={flow} type="range" min="5" max="60" step="5" value={settings.seconds} onChange={e => patch('seconds', +e.target.value)} /></Field>
        <Field label={`${t('Пауза между заданиями','Between exercises')} · ${settings.gap} ${t('с','s')}`}><input disabled={flow} type="range" min="0" max="10" value={settings.gap} onChange={e => patch('gap', +e.target.value)} /></Field>
        <Field label={t('Ввод','Input')}><Select value={input} onChange={e => { cancel(); changePhase('ready'); setInput(e.target.value as typeof input); }}><option value="microphone">{t('Микрофон','Microphone')}</option><option value="demo">{t('Демо · экранные клавиши','Demo · on-screen keys')}</option></Select></Field>
      </div>
      {input === 'microphone' && <MicrophoneSettings listener={listener.current ??= new PianoListener()} sensitivity={settings.microphoneSensitivity} noiseFloor={settings.microphoneNoiseFloor} noiseProfile={settings.microphoneNoiseProfile} onSensitivity={value => patch('microphoneSensitivity', value)} onNoiseFloor={(value, profile) => setSettings(s => ({...s, microphoneNoiseFloor:value, microphoneNoiseProfile:profile ?? s.microphoneNoiseProfile}))} language={language} />}
      <div className="switches"><label><input type="checkbox" disabled={flow} checked={flow || settings.keyboard} onChange={e=>patch('keyboard',e.target.checked)} />{t('Показывать клавиатуру','Show keyboard')}</label>{(['hints','heard','auto'] as const).map((key,i) => <label key={key}><input type="checkbox" disabled={flow || key !== 'auto' && !settings.keyboard} checked={flow || settings[key]} onChange={e => patch(key, e.target.checked)} />{t(['Подсвечивать ноты задания','Подсвечивать сыгранные ноты','Переходить автоматически'][i])}</label>)}</div>
      <p className="setting-note">{t('Настроения — условные ассоциации. Играй тембром grand piano без педали.', 'Moods are suggested associations. Use a grand piano sound without pedal.')}</p>
      <button className="primary apply" onClick={() => { reset(!flow && settings.difficultOnly && difficult.length ? difficult[0] : createExercise(activeSettings)); navigate(mode); }}>{t('К практике','Practice')}</button>
    </section> : panel === 'difficult' ? <section className="panel">
      <div className="panel-heading"><h2>{t('Трудные упражнения','Difficult exercises')}</h2><button className="icon-button" onClick={() => navigate(mode)} aria-label={t('Закрыть','Close')}><X /></button></div>
      {!difficult.length && <p className="empty">{t('Здесь появятся упражнения, которые ты отложишь.','Exercises you save will appear here.')}</p>}
      {difficult.map(item => <div className="saved-row" key={item.id}><button className="saved-exercise" onClick={() => { practiseSaved(item); }}><span><ChordSymbol label={exerciseSteps(item)[0].label}/></span>{item.settings.kind==='scale'&&<small>{scaleName(exerciseScale(item),language)}</small>}<small>{t(({left:'Левая рука',right:'Правая рука',both:'Обе руки'})[item.settings.hand])} · {octaveName(item.root,language)}{(item.settings.kind === 'chord' || item.settings.kind === 'progression') && ` · ${playingLabel(item)}`}</small></button><button className="icon-button" aria-label={t('Удалить','Remove')} onClick={() => setDifficult(list => list.filter(e => e.id !== item.id))}><Trash2 /></button></div>)}
      {!!difficult.length && <button className="primary apply" onClick={() => { patch('difficultOnly', true); practiseSaved(difficult[0]); }}>{t('Тренировать трудное','Practise difficult')}</button>}
    </section> : rhythm ? (!updating && <RhythmTrainer language={language}/>) : <>
      <div className="session"><span>{flow && t('Поток · ','Flow · ')}{t(({chord:'Аккорды',scale:'Гаммы',arpeggio:'Арпеджио',progression:'Три аккорда'})[exercise.settings.kind], exercise.settings.kind === 'progression' ? 'Three chords' : undefined)}{input === 'demo' && ' · '+t('Демо','Demo')}</span><div className="session-actions">{!flow && <button className="keyboard-toggle" aria-label={t('Показывать клавиатуру','Show keyboard')} aria-pressed={settings.keyboard} onClick={()=>patch('keyboard',!settings.keyboard)}><KeyboardIcon /><span>{t('Клавиатура','Keyboard')}</span></button>}<span>{t('Упражнение','Exercise')} {number}</span></div></div>
      <div className="practice-content">
      <main className="stage">
        <div className="eyebrow">{chordExercise ? sequentialChord ? t('Сыграй звуки аккорда по очереди', 'Play the chord one note at a time') : t('Сыграй ноты аккорда одновременно', 'Play the chord notes together') : t(exercise.settings.kind === 'scale' ? 'Сыграй гамму вверх' : 'Сыграй арпеджио вверх')}</div>
        <Crossfade identity={displayIdentity} className="task-face-transition">
        <div className={`task-face ${phase === 'paused' ? 'still' : ''} result-${cueType}`}>
          <div role="img" aria-label={t('Левая рука','Left hand')} className={`palm left ${exercise.settings.hand === 'right' ? 'inactive' : ''}`} />
          <h1 aria-label={currentStep.label} className={`chord ${currentStep.label.length > 4 ? 'long' : ''}`}><ChordSymbol label={currentStep.label} decorative/></h1>
          <div role="img" aria-label={t('Правая рука','Right hand')} className={`palm ${exercise.settings.hand === 'left' ? 'inactive' : ''}`} />
        </div>
        </Crossfade>
        <div key={`chord-name:${displayIdentity}`} className="chord-name">{exercise.settings.kind==='scale'?`${tonicName(exercise.root,language)} · ${scaleName(exerciseScale(exercise),language)}`:chordName(currentStep.root ?? exercise.root, currentStep.chord ?? exercise.chord, language)}</div>
        <div key={`octave-cue:${displayIdentity}`} className="octave-cue">{(['left','right'] as const).map(side => currentStep[side].length > 0 && <span key={side}>{exercise.settings.hand === 'both' && (side === 'left' ? t('Л: ','L: ') : t('П: ','R: '))}{octaveName(currentStep[side][0],language,pitchLabel(currentStep[side][0]))} · {pitchLabel(currentStep[side][0])}</span>)}</div>
        <div key={`voicing:${displayIdentity}`} className="voicing">{exercise.settings.kind==='scale'?t('Восходящая гамма · одна октава','Ascending scale · one octave'):exercise.settings.kind==='arpeggio'?t('Восходящее арпеджио','Ascending arpeggio'):voicingName(exercise.settings.voicing,language,true)}{chordExercise && ` · ${playingLabel(exercise)}`}</div>
        {steps.length > 1 && <div className="step-dots" aria-label={`${Math.min(stepIndex+1,steps.length)} / ${steps.length}`}>{steps.map((step,i) => <span className={i < stepIndex ? 'done' : i === stepIndex ? 'current' : ''} key={i}>{exercise.settings.kind === 'progression' && !sequentialChord ? step.label : i+1}</span>)}</div>}
        <div className="result-slot" aria-live="polite" aria-atomic="true">{status && <div key={`${cueType}-${cueRevision}`} className={`result-card ${cueType}`}>
          <span className="result-symbol">{cueType==='success'?<CircleCheck />:cueType==='incorrect'?<CircleAlert />:cueType==='processing'?<LoaderCircle />:cueType==='heard'?<AudioLines />:phase==='paused'?<Pause />:<Mic />}</span>
          <div><p>{status}</p>{message && <small>{message.detail}</small>}{phase === 'success' && settings.auto && !flow && <small>{t('Следующее упражнение через','Next exercise in')} {Math.ceil(countdown)} {t('с','s')}</small>}{phase==='listening' && !message && activity==='uncertain' ? <small>{t('Подстрой микрофон в настройках и повтори','Adjust the microphone in settings and retry')}</small> : phase==='listening' && !message && !flow && <small>{Math.ceil(remaining)} {t('с осталось','s remaining')}</small>}</div>
        </div>}</div>
        <div className="listening-meter-slot">{(phase === 'listening' || phase === 'loading') && input === 'microphone' && <div className="listening-meter" aria-label={t('Уровень микрофона','Microphone level')}><span style={{ width: `${level*100}%` }} /></div>}</div>
      </main>
      {(flow || settings.keyboard && (settings.hints || settings.heard)) && <Keyboard names={noteNames} expected={flow || settings.hints ? currentStep.notes : []} target={currentStep.notes} heard={flow || settings.heard ? heard : []} position={currentStep.notes.length===1 ? stepIndex : 0} range={visibleNotes} language={language} interactive={input === 'demo' && phase === 'listening' && activity!=='processing'} onNote={playDemo} />}
      <div className="transport"><button onClick={toggleDifficult} aria-pressed={saved} aria-label={saved ? t('Убрать из сложного','Remove from difficult') : t('В сложное','To difficult')} title={saved ? t('Убрать из сложного','Remove from difficult') : t('В сложное','To difficult')} className="save-button">{saved ? <Check /> : <BookmarkPlus />}<span>{saved ? t('В сложном','Added') : t('В сложное','To difficult')}</span></button><button className="primary" onClick={primary}>{['listening','loading','analyzing','paused'].includes(phase) || phase === 'success' && (flow || settings.auto) ? phase === 'paused' ? <Play /> : <Pause /> : <Play />}<span>{primaryLabel}</span></button><button className="next-button" onClick={() => next()}>{t('Дальше','Next')}<ChevronRight /></button></div>
      </div>
    </>}
    <footer><a className="author-credit" href="https://github.com/mxmvshnvsk" target="_blank" rel="noopener noreferrer">{t('Сделано mxmvshnvsk','Made by mxmvshnvsk')}</a><span><Mic />{t('Фортепиано · без педали','Piano · no pedal')}</span><span className="footer-end"><span className="footer-status">{offlineReady ? <><WifiOff />{t('Доступно без сети','Available offline')}</> : offlineError ? t('Офлайн-режим недоступен','Offline mode unavailable') : !online ? t('Без сети','Offline') : import.meta.env.DEV ? '' : t('Подготовка к работе без сети…','Preparing offline access…')}</span><a className="star-link" href="https://github.com/mxmvshnvsk/piano-trainer" target="_blank" rel="noopener noreferrer" aria-label={t('Поставить звезду на GitHub','Star this project on GitHub')} title={t('Поставить звезду на GitHub','Star this project on GitHub')}><Star aria-hidden="true"/></a>{install && <button className="install-button" aria-label={t('Установить','Install')} title={t('Установить','Install')} onClick={async () => { await install.prompt(); await install.userChoice; setInstall(undefined); }}><Download /><span>{t('Установить','Install')}</span></button>}</span></footer>
    {update && <div className="update-note" role="status"><Download aria-hidden="true"/><span>{t('Доступна новая версия','A new version is available')}</span><button disabled={updating} onClick={() => {
      if (!update.waiting) { setUpdate(undefined); return; }
      cancel(); setUpdating(true); changePhase('paused');
      navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true });
      update.waiting.postMessage('ACTIVATE');
    }}>{updating ? t('Обновляю…','Updating…') : t('Обновить','Update')}</button></div>}
  </div>;
}
function Field({label,children}:{label:string;children:ReactNode}) {
  const id = useId();
  return <div className="field"><span id={id}>{label}</span>{isValidElement(children) ? cloneElement(children as ReactElement<{'aria-labelledby'?:string}>, {'aria-labelledby': id}) : children}</div>;
}
function Keyboard({names,expected,target,heard,position,range,language,interactive,onNote}:{names:Record<number,string>;expected:number[];target:number[];heard:number[];position:number;range:number[];language:Language;interactive:boolean;onNote:(n:number)=>void}) {
  const label=(n:number)=>names[n]||noteName(n);
  const low = Math.floor(Math.min(...range)/12)*12;
  const high = Math.max(low+23,Math.floor(Math.max(...range)/12)*12+11);
  const whites:number[]=[], blacks:number[]=[];
  for(let n=low;n<=high;n++) ([1,3,6,8,10].includes(n%12)?blacks:whites).push(n);
  const state=(n:number)=>heard.includes(n)?target.includes(n)?'played':'extra':expected.includes(n)?'expected':'';
  const keyContents=(n:number)=><>{expected.includes(n)&&!heard.includes(n)&&<span className="key-number">{position+expected.indexOf(n)+1}</span>}{heard.includes(n)&&<span className="key-heard">{target.includes(n)?'✓':'×'}</span>}<span className="key-note">{expected.includes(n)||heard.includes(n)||n%12===0?label(n):''}</span></>;
  return <div className="piano-area"><div className="piano-info"><span className="expected-instruction">{expected.length>1 ? language==='ru'?'Сыграй подсвеченные ноты':'Play the highlighted notes' : expected.length ? language==='ru'?'Следующая нота подсвечена':'The next note is highlighted' : ''}</span><div className="legend"><span><i />{text('Ноты задания',language)}</span><span><i className="played-dot" />{language==='ru'?'Распознано':'Detected'}</span><span><i className="extra-dot" />{text('Лишние ноты',language)}</span></div></div><div className="keyboard" aria-label={language==='ru'?'Клавиатура':'Keyboard'}>{whites.map(n=><button key={n} type="button" disabled={!interactive} className={`white-key ${state(n)}`} aria-label={label(n)} onClick={()=>onNote(n)}>{keyContents(n)}</button>)}{blacks.map(n=><button key={n} type="button" disabled={!interactive} className={`black-key ${state(n)}`} style={{left:`${whites.filter(w=>w<n).length/whites.length*100-32/whites.length}%`,width:`${64/whites.length}%`}} aria-label={label(n)} onClick={()=>onNote(n)}>{keyContents(n)}</button>)}</div><div className="octave-labels">{Array.from({length:(high-low+1)/12},(_,i)=><span key={i}>{octaveName(low+i*12,language)}</span>)}</div></div>;
}
