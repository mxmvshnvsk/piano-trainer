import { Select } from './Select';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { CircleCheck, Mic, Play, SlidersHorizontal, Square, Volume2, VolumeX } from 'lucide-react';
import { RhythmAudio } from './rhythm-audio';
import { MicrophoneError } from './audio';
import { meterInfo, quarterSeconds, restoreRhythm, rhythmScore, RhythmJudge, type RhythmHit, type RhythmNote, type RhythmSettings, type RhythmStats } from './rhythm';
import { read, write } from './storage';
import { rhythmDurationName, type Language } from './i18n';
import { RhythmGlyph } from './MusicNotation';
import './rhythm.css';

type Session = { date:number; meter:string; bpm:number; stats:RhythmStats; complete:boolean };
type Phase = 'ready'|'loading'|'count-in'|'playing'|'finished'|'stopped'|'error';
const labels = { quarter:['Четверти','Quarter notes'], eighth:['Восьмые','Eighth notes'], half:['Половинные','Half notes'], mixed:['Смешанные','Mixed'] } as const;
export function RhythmTrainer({language}:{language:Language}) {
  const t=(ru:string,en:string)=>language==='ru'?ru:en;
  const [settings,setSettings]=useState(()=>restoreRhythm(read('rhythm-settings',null)));
  const [history,setHistory]=useState<Session[]>(()=>{
    const data=read<unknown>('rhythm-history',[]);
    return Array.isArray(data)?data.filter(s=>s && Number.isFinite(s.date) && s.stats && Number.isFinite(s.stats.expected) && Number.isFinite(s.stats.onTime) && Number.isFinite(s.stats.extra)).slice(-20):[];
  });
  const [advanced,setAdvanced]=useState(false);
  const [bpmText,setBpmText]=useState(String(settings.bpm));
  const validTempo=Number(bpmText)>=40 && Number(bpmText)<=180;
  const [phase,setPhase]=useState<Phase>('ready');
  const phaseRef=useRef<Phase>('ready');
  const [elapsed,setElapsed]=useState(0);
  const [hits,setHits]=useState<RhythmHit[]>([]);
  const [level,setLevel]=useState(0);
  const [error,setError]=useState('');
  const audio=useRef(new RhythmAudio());
  const judge=useRef<RhythmJudge | null>(null);
  const frame=useRef(0), token=useRef(0), playAt=useRef(0), elapsedRef=useRef(0);
  const finishRef=useRef<(complete:boolean)=>void>(()=>{});
  const notes=rhythmScore(settings);
  const info=meterInfo(settings.meter), seconds=quarterSeconds(settings);
  const duration=info.quarters*seconds*4;
  const active=['loading','count-in','playing'].includes(phase);
  const changePhase=(next:Phase)=>{phaseRef.current=next;setPhase(next);};
  const patch=<K extends keyof RhythmSettings>(key:K,value:RhythmSettings[K])=>{
    if(settings[key]===value)return;
    judge.current=null;setHits([]);setElapsed(0);setError('');changePhase('ready');
    setSettings(s=>({...s,[key]:value}));
  };
  useEffect(()=>write('rhythm-settings',settings),[settings]);
  useEffect(()=>write('rhythm-history',history),[history]);
  useEffect(()=>{
    const hidden=()=>{if(document.hidden && ['count-in','playing','loading'].includes(phaseRef.current))finishRef.current(false);};
    document.addEventListener('visibilitychange',hidden);
    return()=>{token.current++;cancelAnimationFrame(frame.current);audio.current.stop();document.removeEventListener('visibilitychange',hidden);};
  },[]);
  function finish(complete:boolean) {
    token.current++;cancelAnimationFrame(frame.current);audio.current.stop();setLevel(0);
    const running=['count-in','playing'].includes(phaseRef.current);
    if(running && judge.current && elapsedRef.current>0 && !settings.metronomeOnly) {
      const stats=judge.current.stats(complete?Infinity:elapsedRef.current-.25);
      if(stats.expected) setHistory(h=>[...h,{date:Date.now(),meter:settings.meter,bpm:settings.bpm,stats,complete}].slice(-20));
    }
    changePhase(complete?'finished':'stopped');
  }
  finishRef.current=finish;
  function record(at:number) {
    if(!['count-in','playing'].includes(phaseRef.current) || settings.metronomeOnly)return;
    const relative=at-playAt.current-settings.offset/1000;
    // The count-in is for listening, never part of the scored attempt.
    if(relative<-.25 || relative>duration+.25)return;
    const hit=judge.current?.hit(relative);
    if(hit)setHits([...judge.current!.hits]);
  }
  const recordRef=useRef(record);recordRef.current=record;
  const tap=()=>{if(settings.input==='tap')recordRef.current(audio.current.now);};
  useEffect(()=>{
    const key=(event:KeyboardEvent)=>{
      if(event.code!=='Space' || event.repeat || settings.input!=='tap' || !['count-in','playing'].includes(phaseRef.current))return;
      if(event.target instanceof Element && event.target.closest('button,input,select,textarea,a'))return;
      event.preventDefault();tap();
    };
    window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);
  });
  async function start() {
    setAdvanced(false);
    const id=++token.current;
    cancelAnimationFrame(frame.current);audio.current.stop();
    judge.current=new RhythmJudge(notes,seconds,settings.tolerance);setHits([]);setError('');setLevel(0);setElapsed(0);elapsedRef.current=0;
    changePhase('loading');
    try {
      const started=await audio.current.start(settings,at=>recordRef.current(at),setLevel,()=>{
        finishRef.current(false);setError(t('Микрофон отключён. Подключи его и начни снова.','Microphone disconnected. Reconnect and start again.'));changePhase('error');
      });
      if(!started || token.current!==id)return;
      playAt.current=audio.current.startAt+(settings.metronomeOnly?0:info.quarters*seconds);
      setElapsed(audio.current.now-playAt.current);changePhase(settings.metronomeOnly?'playing':'count-in');
      let lastPaint=-Infinity;
      const animate=()=>{
        if(token.current!==id)return;
        const now=audio.current.now-playAt.current;elapsedRef.current=now;
        if(now>=0 && phaseRef.current==='count-in')changePhase('playing');
        if(!settings.metronomeOnly && now>=duration+.3){setElapsed(duration);finishRef.current(true);return;}
        if(now-lastPaint>1/30){setElapsed(now);lastPaint=now;}
        frame.current=requestAnimationFrame(animate);
      };
      frame.current=requestAnimationFrame(animate);
    } catch(reason) {
      if(token.current!==id)return;
      changePhase('error');
      setError(reason instanceof MicrophoneError && reason.reason==='permission' ? t('Разреши доступ к микрофону или выбери экранную клавишу.','Allow microphone access or choose the on-screen key.') : t('Не удалось запустить аудио. Проверь микрофон и повтори.','Could not start audio. Check your microphone and retry.'));
    }
  }
  const quarter=Math.max(0,elapsed/seconds);
  const bar=phase==='count-in'?0:Math.min(3,Math.floor(quarter/info.quarters));
  const displayBar=settings.metronomeOnly?Math.floor(quarter/info.quarters):bar;
  const within=((elapsed/seconds)%info.quarters+info.quarters)%info.quarters;
  const beat=Math.floor(within/info.unit)%info.beats;
  const played=phase==='playing' || phase==='count-in';
  const ticking=played && audio.current.now>=audio.current.startAt;
  const recent=hits.at(-1);
  const fresh=!!recent && elapsed-recent.at>=0 && elapsed-recent.at<.45;
  const current=notes.find(n=>quarter>=n.beat && quarter<n.beat+n.duration);
  const stats=judge.current?.stats(phase==='finished'?Infinity:Math.max(-1,elapsed-.25));
  const total=history.reduce((sum,s)=>({expected:sum.expected+s.stats.expected,onTime:sum.onTime+s.stats.onTime,extra:sum.extra+s.stats.extra}),{expected:0,onTime:0,extra:0});
  const hitLabel=(hit:RhythmHit)=>hit.kind==='extra'?t('Лишний звук','Extra attack'):hit.kind==='on-time'?t('Вовремя','On time'):hit.kind==='early'?t('Раньше','Early'):t('Позже','Late');
  const status=phase==='loading'?t('Готовлю метроном…','Preparing the metronome…'):phase==='count-in'?t('Отсчёт — приготовься','Count-in — get ready'):phase==='finished'?t('Упражнение завершено','Exercise complete'):phase==='stopped'?t('Тренировка остановлена','Practice stopped'):phase==='error'?error:fresh?`${hitLabel(recent!)}${recent!.delta!==null?' · '+Math.round(recent!.delta!)+' '+t('мс','ms'):''}`:settings.metronomeOnly?t('Метроном','Metronome'):phase==='playing'?(current?.rest?t('Пауза — не играй','Rest — do not play'):t('Играй C4 по ритму','Play C4 to the rhythm')):t('Четыре такта · одна клавиша C4','Four bars · one C4 key');
  const durationName=(n:RhythmNote)=>rhythmDurationName(n.duration,n.rest,language);
  return <main className={`rhythm-trainer ${!['ready','error'].includes(phase)&&!advanced?'has-attempt':''}`}>
    <div className="rhythm-title"><h1>{t('Ритм','Rhythm')}</h1><span className="tempo-mark" role="img" aria-label={t(`Размер ${settings.meter}, темп ${settings.bpm} ударов в минуту`,`Time signature ${settings.meter}, tempo ${settings.bpm} beats per minute`)}>{settings.meter} · <RhythmGlyph duration={settings.meter==='6/8'?1.5:1}/> = {settings.bpm}</span><button disabled={active} aria-expanded={advanced} onClick={()=>setAdvanced(v=>!v)}><SlidersHorizontal/>{t('Настроить','Configure')}</button></div>
    <fieldset className="rhythm-settings" disabled={active}>
      <label>{t('Темп, BPM','Tempo, BPM')}<input aria-label={t('Темп, BPM','Tempo, BPM')} type="number" min="40" max="180" value={bpmText} onChange={e=>{setBpmText(e.target.value);const value=Number(e.target.value);if(value>=40&&value<=180)patch('bpm',value);}} onBlur={()=>{const value=Math.max(40,Math.min(180,Number(bpmText)||80));setBpmText(String(value));patch('bpm',value);}} /></label>
      <label>{t('Размер','Time signature')}<Select aria-label={t('Размер','Time signature')} value={settings.meter} onChange={e=>patch('meter',e.target.value as RhythmSettings['meter'])}>{['2/4','3/4','4/4','6/8'].map(m=><option key={m}>{m}</option>)}</Select></label>
      <label>{t('Длительности','Note values')}<Select aria-label={t('Длительности','Note values')} disabled={settings.metronomeOnly} value={settings.pattern} onChange={e=>patch('pattern',e.target.value as RhythmSettings['pattern'])}>{Object.entries(labels).map(([value,label])=><option key={value} value={value}>{t(label[0],label[1])}</option>)}</Select></label>
      <label>{t('Ввод','Input')}<Select aria-label={t('Ввод','Input')} disabled={settings.metronomeOnly} value={settings.input} onChange={e=>patch('input',e.target.value as RhythmSettings['input'])}><option value="microphone">{t('Микрофон','Microphone')}</option><option value="tap">{t('Экран / пробел','Screen / Space')}</option></Select></label>
      {advanced && <><label>{t('Громкость','Volume')}<input aria-label={t('Громкость','Volume')} type="range" min="0" max="100" value={settings.volume} onChange={e=>patch('volume',+e.target.value)} /></label><label>{t('Допуск, мс','Tolerance, ms')+' · '+settings.tolerance}<input type="range" min="40" max="200" step="10" value={settings.tolerance} onChange={e=>patch('tolerance',Math.max(40,Math.min(200,+e.target.value||40)))} /></label><label>{t('Поправка задержки, мс','Latency correction, ms')+' · '+settings.offset}<input type="range" min="-300" max="300" step="10" value={settings.offset} onChange={e=>patch('offset',Math.max(-300,Math.min(300,+e.target.value)))} /></label><label>{t('Чувствительность микрофона','Microphone sensitivity')}<input type="range" min="0" max="100" value={settings.sensitivity} onChange={e=>patch('sensitivity',+e.target.value)} /></label></>}
      <div className="rhythm-switches"><label><input type="checkbox" checked={settings.sound} onChange={e=>patch('sound',e.target.checked)}/>{settings.sound?<Volume2/>:<VolumeX/>}{t('Звук метронома','Metronome sound')}</label><label><input type="checkbox" checked={settings.metronomeOnly} onChange={e=>patch('metronomeOnly',e.target.checked)}/>{t('Только метроном','Metronome only')}</label>{advanced && <><label><input type="checkbox" checked={settings.subdivision} onChange={e=>patch('subdivision',e.target.checked)}/>{t('Пульсация восьмыми','Eighth-note subdivisions')}</label><label><input type="checkbox" disabled={settings.metronomeOnly} checked={settings.rests} onChange={e=>patch('rests',e.target.checked)}/>{t('Добавить паузы','Include rests')}</label></>}</div>
    </fieldset>
    {advanced && <p className="rhythm-help">{t('В размере 6/8 удар метронома — четверть с точкой: две основные доли на такт. Поправка задержки компенсирует задержку аудиоустройства, а не ошибки исполнения.','In 6/8, the metronome pulse is a dotted quarter: two main beats per bar. Latency correction compensates for audio-device delay, not performance errors.')}</p>}
    {settings.sound && settings.input==='microphone' && !settings.metronomeOnly && <p className="rhythm-help">{t('Метроном — в наушниках, чтобы микрофон не считал его щелчки.','Use headphones so the microphone does not count metronome clicks.')}</p>}
    <div className={`metronome ${played?'running':''}`} aria-label={t('Счёт в такте','Bar count')}>
      {Array.from({length:info.beats},(_,i)=><span key={i} className={`${i===0?'strong':''} ${settings.meter==='6/8'&&i===3?'secondary':''} ${ticking&&beat===i?'current':''}`}><b>{i+1}</b></span>)}
      <small>{phase==='count-in'?t('Отсчёт','Count-in'):settings.metronomeOnly?`${t('Такт','Bar')} ${displayBar+1}`:`${t('Такт','Bar')} ${bar+1} / 4`}</small>
    </div>
    {!settings.metronomeOnly && <>
      <div className="rhythm-score" aria-label={t('Ритмический рисунок','Rhythm pattern')}>
        {[0,1,2,3].map(b=><div className={`rhythm-bar ${phase==='playing'&&bar===b?'active':''}`} key={b}>
          <span className="bar-number">{b+1}</span>
          {notes.filter(n=>n.bar===b).map(n=>{
            const hit=hits.find(h=>h.index===n.id),missed=!n.rest && !hit && elapsed>n.beat*seconds+.25;
            const on=phase==='playing'&&current?.id===n.id;
            return <div className={`rhythm-note ${n.rest?'rest':''} ${on?'now':''} ${hit?.kind|| (missed?'missed':'')}`} key={n.id} style={{flex:n.duration,'--fill':`${Math.max(0,Math.min(100,(quarter-n.beat)/n.duration*100))}%`} as CSSProperties} aria-label={`${t('Такт','Bar')} ${b+1}: ${durationName(n)}${hit?' · '+hitLabel(hit):missed?' · '+t('Пропуск','Miss'):''}`}>
              <RhythmGlyph duration={n.duration} rest={n.rest}/><small title={t('Длительность в единицах счёта такта','Duration in the bar’s counting units')}>{n.duration/info.unit===.5?'½':n.duration/info.unit===1.5?'1½':n.duration/info.unit}</small>
              <span className="note-fill"/>{hit&&<i className="hit-position" style={{left:`${Math.max(5,Math.min(95,50+hit.delta!/Math.max(100,settings.tolerance)*30))}%`}}/>}
            </div>;
          })}
          {played && <span className="rhythm-cursor" style={{left:`${Math.max(0,Math.min(100,(quarter-b*info.quarters)/info.quarters*100))}%`,opacity:phase==='playing'&&bar===b?1:0}}/>}
        </div>)}
      </div>
      <div className={`rhythm-feedback ${fresh?recent?.kind:''}`} role="status">{phase==='finished'&&<CircleCheck/>}{settings.input==='microphone'&&phase==='playing'&&<Mic/>}<span>{status}</span>{settings.input==='microphone'&&played&&<span className="rhythm-level"><i style={{width:`${level*100}%`}}/></span>}</div>
      <div className="rhythm-keyboard" aria-label={t('Клавиша для ритма','Rhythm practice key')}>
        {['C4','D4','E4','F4','G4','A4','B4'].map((name,i)=><button key={name} disabled={i!==0||settings.input!=='tap'||!played} className={`${i===0?'target':''} ${i===0&&phase==='playing'&&current&&!current.rest?'cue':''} ${i===0&&fresh?'hit-'+recent?.kind:''}`} aria-label={name} onPointerDown={event=>{if(i===0){event.preventDefault();tap();}}} onKeyDown={event=>{if(i===0&&!event.repeat&&['Space','Enter'].includes(event.code)){event.preventDefault();tap();}}} onClick={event=>{if(event.detail===0&&i===0)tap();}}><span>{name}</span>{![2,6].includes(i)&&<i className="black-key-shape"/>}</button>)}
      </div>
      <p className="rhythm-help">{t('Играй C4, соблюдая длительности и паузы. Проверяем время между началами нот; высоту звука и отпускание клавиш не оцениваем.','Play C4 with the written note values and rests. We assess time between note onsets; pitch and key releases are not graded.')}{settings.input==='tap'&&' '+t('Можно нажимать пробел.','You can press Space.')}</p>
      <div className="rhythm-stats" aria-label={t('Статистика попытки','Attempt statistics')}>
        <span><b>{stats?.accuracy||0}%</b>{t('Точность ритма','Rhythm accuracy')}</span><span><b>{stats?.meanError===null||!stats?'—':stats.meanError+' '+t('мс','ms')}</b>{t('Среднее отклонение','Mean timing error')}</span><span title={t('Сравниваем время между началами соседних нот, не момент отпускания клавиши.','Compares time between neighbouring note onsets, not key-release timing.')}><b>{stats?.intervalAccuracy===null||!stats?'—':stats.intervalAccuracy+'%'}</b>{t('Точность длительностей','Duration accuracy')}</span>
        <span><b>{stats?.onTime||0} / {stats?.early||0} / {stats?.late||0}</b>{t('Вовремя / раньше / позже','On time / early / late')}</span><span><b>{stats?.missed||0} / {stats?.extra||0}</b>{t('Пропуски / лишние','Misses / extra')}</span>
      </div>
      {!!history.length && <div className="rhythm-history"><span>{t('Последние попытки','Recent attempts')}: {history.length} · {total.expected?Math.round(total.onTime/(total.expected+total.extra)*100):0}% {t('попаданий','on time')} · {t('сохранено на устройстве','saved on this device')}</span><button onClick={()=>setHistory([])}>{t('Сбросить историю','Clear history')}</button></div>}
    </>}
    {settings.metronomeOnly && <div className="rhythm-feedback" role="status">{status}</div>}
    <div className="rhythm-controls"><button className="primary" disabled={phase==='loading'||!active&&!validTempo} onClick={()=>active?finish(false):void start()}>{active?<Square/>:<Play/>}{active?t('Остановить','Stop'):phase==='ready'?t('Начать','Start'):t('Повторить','Try again')}</button></div>
  </main>;
}

