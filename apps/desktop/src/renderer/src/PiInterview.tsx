import { useEffect,useState } from 'react';
import type { Article,PiRun } from '@unvar/shared';
import { useI18n } from './i18n';
export function PiInterview({article,providerId,disabled,onApplied,onBusyChange}:{article:Article;providerId:string;disabled:boolean;onApplied:()=>Promise<void>;onBusyChange:(busy:boolean)=>void}) {
  const {t}=useI18n();const [enabled,setEnabled]=useState(false);const [runs,setRuns]=useState<PiRun[]>([]);const [answers,setAnswers]=useState<Record<number,string>>({});const [busy,setBusy]=useState(false);const [error,setError]=useState('');
  async function refresh(){const [settings,history]=await Promise.all([window.unvar.getPiSettings(),window.unvar.listPiRuns(article.id)]);setEnabled(settings.enabled);setRuns(history);onBusyChange(history.some(run=>run.status==='running'));}
  useEffect(()=>{void refresh().catch(()=>setError('Unable to load Pi interview.'));return()=>onBusyChange(false);},[article.id]);
  const running=runs.find(run=>run.status==='running');const latest=runs[0];
  useEffect(()=>{if(!running)return;const timer=setInterval(()=>{void refresh().catch(()=>setError('Unable to load Pi interview.'));},700);return()=>clearInterval(timer);},[running?.id]);
  async function perform(operation:()=>Promise<unknown>){setBusy(true);setError('');try{await operation();await refresh();}catch{setError('Pi operation failed. Check the article revision or use the fixed interview.');}finally{setBusy(false);}}
  function configure(next:boolean){const before=enabled;setEnabled(next);void perform(async()=>{try{await window.unvar.savePiSettings({enabled:next});}catch(error){setEnabled(before);throw error;}});}
  return <section className="writing-section pi-interview" aria-label={t('Pi evidence interview')}><h2>{t('Pi evidence interview')}</h2><p className="muted">{t('Pi can read related local research and suggest follow-up questions. Only your explicit answers enter the Fact Pack; confirmation stays separate.')}</p>
    <label className="checkbox"><input type="checkbox" checked={enabled} disabled={busy} onChange={event=>configure(event.target.checked)}/>{t('Enable Pi interview')}</label>
    {error&&<p role="alert" className="error">{t(error)}</p>}
    {enabled&&<div className="actions"><button disabled={busy||Boolean(running)||disabled||!providerId} onClick={()=>{setAnswers({});void perform(()=>window.unvar.startPiInterview({articleId:article.id,providerId,operationId:crypto.randomUUID()}));}}>{t('Find evidence and ask questions')}</button>{running&&<button disabled={busy} onClick={()=>void perform(()=>window.unvar.cancelPiRun(running.id))}>{t('Cancel Pi interview')}</button>}<button disabled={busy} onClick={()=>configure(false)}>{t('Use fixed interview')}</button></div>}
    {!enabled&&<p className="muted">{t('Pi is off. The author interview below remains available.')}</p>}
    {latest&&<><p role="status">{t('status.'+latest.status)} · {latest.calls.map(call=>call.model).join(', ')} · {t('Tool calls')}: {latest.traces.length}</p>{latest.error&&<p className="notice">{t(latest.error)}</p>}
      <details><summary>{t('Pi run history')}</summary>{runs.slice(0,8).map(run=><div key={run.id}><p>{t('status.'+run.status)} · {run.calls.map(call=>call.model).join(', ')}</p>{run.traces.map((trace,index)=><p key={index} className="muted">{trace.tool} · {t('status.'+trace.status)} · {trace.evidenceIds.join(', ')}</p>)}</div>)}</details>
      {latest.status==='completed'&&latest.candidate&&<div className="fact-pack"><h3>{t('Evidence summary and gaps')}</h3><p className="preserve-lines">{latest.candidate.summary}</p><small>{latest.candidate.evidenceIds.join(', ')}</small>{latest.applied?<p>{t('Answers saved. Review and confirm the new Fact Pack below.')}</p>:<form onSubmit={event=>{event.preventDefault();void perform(async()=>{await window.unvar.savePiAnswers({runId:latest.id,articleRevision:article.revision,answers:latest.candidate!.questions.map((_question,index)=>({index,text:answers[index]??''})).filter(answer=>answer.text.trim())});await onApplied();});}}>
        {latest.candidate.questions.map((question,index)=><label key={index}>{question.text}<textarea aria-label={question.text} rows={3} maxLength={3000} value={answers[index]??''} onChange={event=>setAnswers({...answers,[index]:event.target.value})}/><small>{t({observations:'Your observations',experience:'Your experience',opinions:'Your opinions',unknowns:'Open questions'}[question.field])}</small></label>)}
        <button disabled={busy||disabled||!Object.values(answers).some(value=>value.trim())}>{t('Save my answers and build Fact Pack')}</button>
      </form>}</div>}
    </>}
  </section>;
}
