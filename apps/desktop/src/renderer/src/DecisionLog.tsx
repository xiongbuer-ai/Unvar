import { useEffect, useState } from 'react';
import type { DecisionRecord } from '@unvar/shared';
import { useI18n } from './i18n';
function DecisionCard({ item, onTimeline, onSaved }: { item: DecisionRecord; onTimeline: () => void; onSaved: () => Promise<void> }) {
  const { t,locale } = useI18n();
  const [outcome,setOutcome] = useState(item.outcome);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState(false);
  const display = (value: unknown) => value === null ? t('Not recorded') : typeof value === 'string' ? value : JSON.stringify(value,null,2);
  return <article className="decision-card"><div className="signal-meta"><span>{t('decision.' + item.type)}</span><span>{t(item.override ? 'Human override' : 'Recorded decision')}</span><time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString(locale)}</time></div><h2>{item.entityTitle}</h2>
    <button onClick={onTimeline}>{t('Entity history')}</button>
    <div className="decision-comparison"><section><h3>{t('AI or previous proposal')}</h3><pre>{display(item.aiRecommendation)}</pre></section><section><h3>{t('Human decision')}</h3><pre>{display(item.humanDecision)}</pre></section></div>
    {item.reason && <><h3>{t('Override or review reason')}</h3><p className="preserve-lines">{item.reason}</p></>}
    <details><summary>{t('Current entity state')}</summary><p>{t(item.entityType === 'article' ? 'writing.status.' + item.entityStatus : 'status.' + item.entityStatus)}</p><p className="preserve-lines">{item.currentResult || t('Not recorded')}</p><small>{item.entityType} · {item.entityId}</small></details>
    <form onSubmit={event => { event.preventDefault(); setBusy(true); setError(false); void window.unvar.saveDecisionOutcome({id:item.id,revision:item.outcomeRevision,text:outcome,operationId:crypto.randomUUID()}).then(onSaved).catch(()=>setError(true)).finally(()=>setBusy(false)); }}>
      <label>{t('Observed outcome')}<textarea aria-label={t('Observed outcome')} rows={3} maxLength={12000} required value={outcome} onChange={event=>setOutcome(event.target.value)} placeholder={t('Record what actually happened later, in your own words.')} /></label>
      <button disabled={busy || !outcome.trim() || outcome === item.outcome}>{t('Save outcome')}</button>{error && <p role="alert" className="error">{t('Could not save the outcome. Reload the history and check for concurrent changes.')}</p>}
    </form>
    {item.outcomeHistory.length > 0 && <details><summary>{t('Outcome history')} · {item.outcomeHistory.length}</summary>{item.outcomeHistory.map(entry=><div key={entry.revision}><p className="muted">{t('Version')} {entry.revision} · {new Date(entry.createdAt).toLocaleString(locale)}</p><p className="preserve-lines">{entry.text}</p></div>)}</details>}
  </article>;
}
export function DecisionLog() {
  const { t } = useI18n();
  const [items,setItems] = useState<DecisionRecord[]>([]);
  const [total,setTotal] = useState(0);
  const [search,setSearch] = useState('');
  const [kind,setKind] = useState<DecisionRecord['entityType']|''>('');
  const [entity,setEntity] = useState<string>();
  const [overrides,setOverrides] = useState(false);
  const [offset,setOffset] = useState(0);
  const [error,setError] = useState(false);
  const [loading,setLoading] = useState(false);
  const [reload,setReload] = useState(0);
  async function refresh() { setReload(value=>value+1); }
  useEffect(()=>{ let canceled=false; setLoading(true); void window.unvar.listDecisions({search,entityType:kind || undefined,entityId:entity,overridesOnly:overrides,offset,limit:20}).then(result=>{if(!canceled){setItems(result.items);setTotal(result.total);setError(false);}}).catch(()=>{if(!canceled)setError(true);}).finally(()=>{if(!canceled)setLoading(false);});return()=>{canceled=true;}; },[search,kind,entity,overrides,offset,reload]);
  return <section aria-label={t('Decision Log')}><p className="muted">{t('Compare suggestions with your decisions, then record the observed outcome. Past proposals and decisions remain unchanged.')}</p>
    <div className="toolbar"><label>{t('Search decisions')}<input type="search" maxLength={240} value={search} onChange={event=>{setSearch(event.target.value);setOffset(0);}} /></label><label>{t('Entity type')}<select aria-label={t('Entity type')} value={kind} onChange={event=>{setKind(event.target.value as typeof kind);setEntity(undefined);setOffset(0);}}><option value="">{t('All')}</option>{(['question','experiment','finding','article'] as const).map(value=><option key={value} value={value}>{t(value[0].toUpperCase()+value.slice(1))}</option>)}</select></label><label className="checkbox"><input type="checkbox" checked={overrides} onChange={event=>{setOverrides(event.target.checked);setOffset(0);}} />{t('Overrides only')}</label></div>
    {entity && <button onClick={()=>{setEntity(undefined);setOffset(0);}}>{t('Show all decisions')}</button>}
    {error && <p role="alert" className="error">{t('Unable to load decision history.')} <button onClick={()=>void refresh().catch(()=>setError(true))}>{t('Retry')}</button></p>}
    <p role="status" className="muted">{loading ? t('Loading…') : t('decisionCount',{count:total})}</p>
    {items.map(item=><DecisionCard key={`${item.id}:${item.outcomeRevision}`} item={item} onTimeline={()=>{setSearch('');setOverrides(false);setKind(item.entityType);setEntity(item.entityId);setOffset(0);}} onSaved={refresh} />)}
    <div className="actions"><button disabled={loading || offset===0} onClick={()=>setOffset(Math.max(0,offset-20))}>{t('Previous page')}</button><button disabled={loading || offset+20>=total} onClick={()=>setOffset(offset+20)}>{t('Next page')}</button></div>
  </section>;
}
