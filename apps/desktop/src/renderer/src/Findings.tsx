import { useEffect, useState } from 'react';
import type { Experiment, Finding, FindingCandidate, FindingRun, ProviderSettings } from '@unvar/shared';
import { useI18n } from './i18n';

function FindingCard({ item, experiments, perform }: { item: Finding; experiments: Experiment[]; perform: (action: () => Promise<unknown>) => Promise<void> }) {
  const { t, locale } = useI18n();
  const [draft, setDraft] = useState<FindingCandidate>({ text: item.text, confidence: item.confidence, counterEvidence: item.counterEvidence, evidence: item.evidence });
  const [reason, setReason] = useState('');
  const [dirty, setDirty] = useState(false);
  function change(values: Partial<FindingCandidate>) { setDraft({ ...draft, ...values }); setDirty(true); }
  return <article className="panel finding-card" aria-label={t('Finding candidate')}>
    <div className="signal-meta"><span>{t('status.' + item.status)}</span><span>{t('Finding')}</span>{item.confirmedAt && <time dateTime={item.confirmedAt}>{t('Confirmed on')} {new Date(item.confirmedAt).toLocaleString(locale)}</time>}</div>
    <h2>{item.text}</h2>
    <p className="muted">{t('AI suggestions require your review. Editing an accepted finding requires confirmation again.')}</p>
    <details><summary>{t('Original AI proposal')}</summary><p className="preserve-lines">{item.aiProposal.text}</p><p>{t('Confidence')}: {t('confidence.' + item.aiProposal.confidence)}</p><p className="preserve-lines">{item.aiProposal.counterEvidence}</p></details>
    <form onSubmit={event => { event.preventDefault(); void perform(() => window.unvar.editFinding({ ...draft, id: item.id, revision: item.revision, reason })); }}>
      <label>{t('Finding text')}<textarea aria-label={t('Finding text')} rows={4} required maxLength={12000} value={draft.text} onChange={event => change({ text: event.target.value })} /></label>
      <label>{t('Confidence')}<select aria-label={t('Confidence')} value={draft.confidence} onChange={event => change({ confidence: event.target.value as Finding['confidence'] })}>{(['low','medium','high'] as const).map(value => <option key={value} value={value}>{t('confidence.' + value)}</option>)}</select></label>
      <label>{t('Counter-evidence and limitations')}<textarea aria-label={t('Counter-evidence and limitations')} rows={3} maxLength={12000} value={draft.counterEvidence} onChange={event => change({ counterEvidence: event.target.value })} /></label>
      <h3>{t('Experiment evidence')}</h3>
      {experiments.map(experiment => {
        const ref = draft.evidence.find(value => value.experimentId === experiment.id);
        return <div className="evidence-row" key={experiment.id}>
          <label className="checkbox"><input type="checkbox" checked={Boolean(ref)} onChange={event => change({ evidence: event.target.checked ? [...draft.evidence, { experimentId: experiment.id, relation: 'supports', note: '' }] : draft.evidence.filter(value => value.experimentId !== experiment.id) })} />{experiment.title}</label>
          {ref && <><div className="form-row"><label>{t('Evidence relation')}<select aria-label={`${t('Evidence relation')}: ${experiment.title}`} value={ref.relation} onChange={event => change({ evidence: draft.evidence.map(value => value.experimentId === experiment.id ? { ...value, relation: event.target.value as typeof ref.relation } : value) })}>{(['supports','contradicts','contextual'] as const).map(value => <option key={value} value={value}>{t('relation.' + value)}</option>)}</select></label><label>{t('Evidence note')}<input aria-label={`${t('Evidence note')}: ${experiment.title}`} maxLength={4000} value={ref.note} onChange={event => change({ evidence: draft.evidence.map(value => value.experimentId === experiment.id ? { ...value, note: event.target.value } : value) })} /></label></div>
            <details><summary>{t('View recorded evidence')}</summary><p className="muted">{experiment.sourceTitle} · {experiment.sourceUrl}</p><p>{t('Question')}: {experiment.question}</p><p className="preserve-lines">{t('Result')}: {experiment.result}</p><p className="preserve-lines">{t('Limitations')}: {experiment.limitations}</p></details></>}
        </div>;
      })}
      {!draft.evidence.length && <p className="notice">{t('At least one completed experiment is required to accept a finding.')}</p>}
      <label>{t('Your review reason')}<textarea aria-label={t('Your review reason')} rows={2} maxLength={4000} required value={reason} onChange={event => setReason(event.target.value)} placeholder={t('Explain your edit, acceptance or rejection in your own words.')} /></label>
      <div className="actions"><button disabled={!dirty || !reason.trim()} type="submit">{t('Save finding edits')}</button>
        {item.status !== 'archived' && item.status !== 'accepted' && <><button className="primary" type="button" disabled={dirty || !reason.trim() || !item.evidence.length} onClick={() => void perform(() => window.unvar.reviewFinding({ id: item.id, revision: item.revision, action: 'accept', reason }))}>{t('Confirm finding')}</button><button type="button" disabled={dirty || !reason.trim()} onClick={() => void perform(() => window.unvar.reviewFinding({ id: item.id, revision: item.revision, action: 'reject', reason }))}>{t('Reject finding')}</button></>}
      </div>{dirty && <p role="status" className="muted">{t('Save edits before confirming. Confirmation is always a separate action.')}</p>}
    </form>
  </article>;
}

export function Findings({ initialFindingId }: { initialFindingId?: string }) {
  const { t } = useI18n();
  const [items, setItems] = useState<Finding[]>([]);
  const [experiments, setExperiments] = useState<Experiment[]>([]);
  const [providers, setProviders] = useState<ProviderSettings[]>([]);
  const [providerId, setProviderId] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [runs, setRuns] = useState<FindingRun[]>([]);
  const [filter, setFilter] = useState(initialFindingId ? 'all' : 'candidate');
  const [focused, setFocused] = useState(initialFindingId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function refresh() {
    const [saved, evidence, configured, history] = await Promise.all([window.unvar.listFindings(), window.unvar.listExperiments(), window.unvar.listProviders(), window.unvar.listFindingRuns()]);
    setItems(saved); setExperiments(evidence.filter(value => ['done','archived'].includes(value.status) && value.result.trim()));
    setProviders(configured.filter(value => value.enabled && value.configured)); setRuns(history);
    setProviderId(value => value || configured.find(item => item.enabled && item.configured)?.id || '');
  }
  useEffect(() => { void refresh().catch(() => setError('Unable to load findings. Retry to reload.')); }, []);
  const running = runs.some(run => run.status === 'running');
  useEffect(() => { if (!running) return; const timer = setInterval(() => { void refresh().catch(() => setError('Unable to refresh analysis status.')); }, 1000); return () => clearInterval(timer); }, [running]);
  async function perform(action: () => Promise<unknown>) {
    setBusy(true); setError('');
    try { await action(); await refresh(); } catch { setError('Could not save the finding. Check evidence, review reason and current revision, then retry.'); } finally { setBusy(false); }
  }
  function generate(ids: string[]) { return window.unvar.generateFinding({ experimentIds: ids, providerId, operationId: crypto.randomUUID() }); }
  return <>
    <p className="muted">{t('Turn completed experiments into evidence-linked findings. Models only propose; you decide.')}</p>
    {error && <p className="error" role="alert">{t(error)} <button onClick={() => void perform(refresh)}>{t('Retry')}</button></p>}
    <fieldset disabled={busy}><section className="panel"><h2>{t('Generate a finding candidate')}</h2><p className="muted">{t('Selected experiment records will be sent to your model. No candidate is accepted automatically.')}</p>
      <fieldset><legend>{t('Completed experiments')}</legend>{experiments.map(experiment => <label key={experiment.id} className="checkbox"><input type="checkbox" checked={selected.includes(experiment.id)} disabled={!selected.includes(experiment.id) && selected.length >= 10} onChange={event => setSelected(event.target.checked ? [...selected, experiment.id] : selected.filter(id => id !== experiment.id))} />{experiment.title}</label>)}</fieldset>
      {!experiments.length && <p>{t('Complete an experiment with a recorded result first.')}</p>}
      <label>{t('Analysis provider')}<select aria-label={t('Analysis provider')} value={providerId} onChange={event => setProviderId(event.target.value)}><option value="">{t('Select a configured provider')}</option>{providers.map(provider => <option key={provider.id} value={provider.id}>{provider.displayName} · {provider.model}</option>)}</select></label>
      <button className="primary" disabled={running || !selected.length || !providerId} onClick={() => void perform(() => generate(selected))}>{t(running ? 'Generating candidate…' : 'Generate candidate')}</button>
    </section></fieldset>
    {runs.length > 0 && <section className="panel"><h2>{t('Finding generation history')}</h2>{runs.slice(0, 5).map(run => <div className="run-row" key={run.id}><p><strong>{t('status.' + run.status)}</strong><span className="muted"> · {run.calls.map(call => call.model).join(', ')}</span>{run.error && <span className="error run-error">{t(run.error)}</span>}</p>{run.status === 'running' ? <button disabled={busy} onClick={() => void perform(() => window.unvar.cancelFindingRun(run.id))}>{t('Cancel generation')}</button> : ['failed','canceled'].includes(run.status) && <button disabled={busy || running || !providerId} onClick={() => void perform(() => generate(run.experimentIds))}>{t('Retry generation')}</button>}</div>)}</section>}
    <label>{t('Finding status')}<select aria-label={t('Finding status')} value={filter} onChange={event => { setFilter(event.target.value); setFocused(undefined); }}>{['candidate','accepted','archived','all'].map(value => <option key={value} value={value}>{t(value === 'all' ? 'All' : 'status.' + value)}</option>)}</select></label>
    <fieldset disabled={busy}>{items.filter(item => (!focused || focused === item.id) && (filter === 'all' || filter === item.status)).map(item => <FindingCard key={`${item.id}:${item.revision}`} item={item} experiments={experiments} perform={perform} />)}</fieldset>
    {!items.some(item => filter === 'all' || filter === item.status) && <p className="empty">{t('No findings in this view yet.')}</p>}
  </>;
}
