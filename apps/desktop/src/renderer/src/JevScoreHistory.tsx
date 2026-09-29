import { useEffect,useState } from 'react';
import type { JevEvaluation,RadarQuestion } from '@unvar/shared';
import { useI18n } from './i18n';
export function JevScoreHistory({question,onUpdated}:{question:RadarQuestion;onUpdated:()=>Promise<void>}) {
  const {t}=useI18n();const [history,setHistory]=useState<JevEvaluation[]>([]);const [enabled,setEnabled]=useState(false);const [busy,setBusy]=useState(false);const [error,setError]=useState('');
  useEffect(()=>{let active=true;void Promise.all([window.unvar.listJevEvaluations(question.id),window.unvar.getJevSettings()]).then(([rows,settings])=>{if(active){setHistory(rows);setEnabled(settings.enabled);}}).catch(()=>{if(active)setError('Unable to load scoring history.');});return()=>{active=false;};},[question]);
  async function score(){setBusy(true);setError('');try{await window.unvar.scoreWithJev(question.id);setHistory(await window.unvar.listJevEvaluations(question.id));await onUpdated();}catch{setError('Scoring canceled or failed. Retry explicitly.');}finally{setBusy(false);}}
  return <section><p className="muted">{t('Actual scoring engine')}: {question.engine}</p><div className="actions"><button type="button" disabled={busy||!enabled} onClick={()=>void score()}>{t('Rescore with Jev')}</button>{busy&&<button type="button" onClick={()=>void window.unvar.cancelJevScore(question.id).catch(()=>setError('Unable to cancel scoring.'))}>{t('Cancel scoring')}</button>}</div>
    {busy&&<p role="status">{t('Scoring question…')}</p>}{error&&<p role="alert" className="error">{t(error)}</p>}
    {history[0]?.error&&<p className="notice">{t('Rules fallback')}: {t(history[0].error)}</p>}
    {history.length>0&&<details><summary>{t('Scoring provenance')} ({history.length})</summary>{history.map(row=><div key={row.id}><p><strong>{row.engine}</strong> · {row.model??row.ruleVersion} · {row.origin} · {row.durationMs} ms</p><p className="muted">{row.createdAt}</p>{row.error&&<p>{t(row.error)}</p>}<pre>{JSON.stringify({input:row.input,scores:row.scores,answers:row.rawAnswers,usage:row.usage,ruleVersion:row.ruleVersion},null,2)}</pre></div>)}</details>}
  </section>;
}
