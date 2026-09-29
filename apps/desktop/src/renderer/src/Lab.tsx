import { Findings } from './Findings';
import { useI18n } from './i18n';
import { useEffect, useRef, useState } from 'react';
import type { Experiment, ExperimentInput, ExperimentLog, ExperimentStatus } from '@unvar/shared';

function draftOf(item: Experiment): ExperimentInput {
  const { id, revision, title, prediction, baseline, method, metrics, result, limitations, trust, humanTimeMinutes, interventionCount, bugCount, reworkCount } = item;
  return { id, revision, title, prediction, baseline, method, metrics, result, limitations, trust, humanTimeMinutes, interventionCount, bugCount, reworkCount };
}
const next: Record<ExperimentStatus, ExperimentStatus[]> = { idea: ['ready'], ready: ['idea', 'running'], running: ['analyzing'], analyzing: ['running', 'done'], done: ['archived'], archived: [] };
const names: Record<ExperimentStatus, string> = { idea: 'Return to idea', ready: 'Mark ready', running: 'Start experiment', analyzing: 'Analyze results', done: 'Complete experiment', archived: 'Archive experiment' };
function ExperimentDetail({ item, logs, perform }: { item: Experiment; logs: ExperimentLog[]; perform: (operation: () => Promise<unknown>) => Promise<void> }) {
  const { t, locale } = useI18n();
  const [draft, setDraft] = useState(() => draftOf(item));
  const [dirty, setDirty] = useState(false);
  const [note, setNote] = useState('');
  const operation = useRef(crypto.randomUUID());
  const [ticks, setTicks] = useState(0);
  useEffect(() => {
    if (!item.timerStartedAt) return;
    const timer = setInterval(() => setTicks(value => value + 1), 1000);
    return () => clearInterval(timer);
  }, [item.timerStartedAt]);
  const locked = item.status === 'done' || item.status === 'archived';
  function change<K extends keyof ExperimentInput>(key: K, value: ExperimentInput[K]) { setDraft({ ...draft, [key]: value }); setDirty(true); }
  const designReady = Boolean(item.prediction.trim() && item.baseline.trim() && item.method.trim() && item.metrics.trim());
  return <>
    <section className="panel"><div className="signal-meta"><span>{t('status.' + item.status)}</span><span>{t("Experiment")}</span></div><h2>{item.title}</h2>
      <p className="muted">{t("Source:")}{item.sourceTitle}{item.sourceUrl && ` · ${item.sourceUrl}`}</p><blockquote>{item.claim}</blockquote><p><strong>{t("Question:")}</strong> {item.question}</p>
      <p className="muted">{t("Prediction is yours to write. It is locked when you first start the experiment.")}</p>
      <form onSubmit={event => { event.preventDefault(); void perform(() => window.unvar.saveExperiment(draft)); }}>
        <fieldset disabled={locked}>
          <label>{t("Experiment title")}<input aria-label={t("Experiment title")} required maxLength={300} value={draft.title} onChange={event => change('title', event.target.value)} /></label>
          <label>{t("Your prediction")}<textarea aria-label={t("Your prediction")} rows={3} readOnly={Boolean(item.startedAt)} value={draft.prediction} onChange={event => change('prediction', event.target.value)} maxLength={20000} placeholder={t("What do you expect to observe, before running the experiment?")} /></label>
          {(['baseline', 'method', 'metrics', 'result', 'limitations'] as const).map(key => <label key={key}>{t(key[0].toUpperCase() + key.slice(1))}<textarea aria-label={t(key[0].toUpperCase() + key.slice(1))} rows={3} maxLength={20000} value={draft[key]} onChange={event => change(key, event.target.value)} /></label>)}
          <div className="score-grid">{([['humanTimeMinutes', 'Human time (minutes)'], ['interventionCount', 'Interventions'], ['bugCount', 'Bugs'], ['reworkCount', 'Rework']] as const).map(([key, label]) => <label key={key}>{t(label)}<input type="number" min={0} max={1000000} step={1} required value={draft[key]} onChange={event => change(key, Number(event.target.value))} /></label>)}</div>
          <label>{t("Trust")}<select aria-label={t("Trust")} value={draft.trust ?? ''} onChange={event => change('trust', event.target.value ? Number(event.target.value) : null)}><option value="">{t("Not assessed")}</option><option value="1">{t("1 — Cannot rely on it")}</option><option value="2">{t("2 — Check every line")}</option><option value="3">{t("3 — Focused review needed")}</option><option value="4">{t("4 — Spot checks are enough")}</option><option value="5">{t("5 — Ready for the next step")}</option></select></label>
          <button className="primary" disabled={!dirty}>{t("Save experiment")}</button>
        </fieldset>
      </form>
      {dirty && <p role="status" className="notice">{t("Save your edits before changing status or timer.")}</p>}
      {!designReady && !locked && <p className="muted">{t("Prediction, Baseline, Method and Metrics are required before starting.")}</p>}
      <div className="actions">{next[item.status].map(status => <button key={status} disabled={dirty || (['ready', 'running'].includes(status) && !designReady) || (status === 'analyzing' && !item.result.trim()) || (status === 'done' && (!item.result.trim() || !item.limitations.trim() || item.trust === null))} onClick={() => void perform(() => window.unvar.transitionExperiment({ id: item.id, revision: item.revision, status }))}>{t(names[status])}</button>)}<button disabled={dirty} onClick={() => void perform(() => window.unvar.exportExperiment(item.id))}>{t("Export experiment Markdown")}</button></div>
    </section>
    <section className="panel"><h2>{t("Timer and logs")}</h2><p>{t("Elapsed:")}{Math.floor((item.elapsedSeconds + ticks) / 60)}{t("m")}{(item.elapsedSeconds + ticks) % 60}{t("s ·")}{t(item.timerStartedAt ? 'Running · continues across restarts' : 'Paused')}</p>
      {item.status === 'running' && <button disabled={dirty} onClick={() => void perform(() => window.unvar.controlExperimentTimer({ id: item.id, action: item.timerStartedAt ? 'pause' : 'start' }))}>{t(item.timerStartedAt ? 'Pause timer' : 'Resume timer')}</button>}
      {!locked && <form onSubmit={event => { event.preventDefault(); void perform(async () => { await window.unvar.appendExperimentLog({ experimentId: item.id, operationId: operation.current, text: note }); setNote(''); operation.current = crypto.randomUUID(); }); }}><label>{t("Your observation")}<textarea aria-label={t("Your observation")} rows={3} required maxLength={20000} value={note} onChange={event => { setNote(event.target.value); operation.current = crypto.randomUUID(); }} /></label><button disabled={dirty || !note.trim()}>{t("Add log")}</button></form>}
      {logs.length ? <ol className="experiment-logs">{logs.map(log => <li key={log.id}><div className="signal-meta"><time dateTime={log.createdAt}>{new Date(log.createdAt).toLocaleString(locale)}</time><span>{t('log.' + log.eventType)}</span><span>{log.elapsedSeconds}{t("s")}</span></div><p>{log.eventType === 'human_note' ? log.text : t(log.text)}</p></li>)}</ol> : <p className="muted">{t("No logs yet. Record what actually happened.")}</p>}
    </section>
  </>;
}
export function Lab({ initialExperimentId, initialFindingId }: { initialExperimentId?: string; initialFindingId?: string }) {
  const [section, setSection] = useState<'experiments' | 'findings'>(initialFindingId ? 'findings' : 'experiments');
  useEffect(() => { document.querySelector('.content-scroll')?.scrollTo(0, 0); }, [section]);
  const { t } = useI18n();
  const [items, setItems] = useState<Experiment[]>([]);
  const [selected, setSelected] = useState(initialExperimentId ?? '');
  const [logs, setLogs] = useState<ExperimentLog[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [generation, setGeneration] = useState(0);
  async function refresh(id?: string) {
    const experiments = await window.unvar.listExperiments(); setItems(experiments);
    const nextId = id || selected || experiments[0]?.id || '';
    setSelected(nextId); setLogs(nextId ? await window.unvar.listExperimentLogs(nextId) : []); setGeneration(value => value + 1);
  }
  useEffect(() => { void refresh().catch(() => setError('Unable to load Lab. Retry to reload.')); }, []);
  async function perform(operation: () => Promise<unknown>) {
    setBusy(true); setError('');
    try { await operation(); await refresh(); } catch { setError('Could not save the change. Check required fields and reload if another operation changed this experiment. Your unsaved edits are still shown.'); } finally { setBusy(false); }
  }
  const item = items.find(candidate => candidate.id === selected);
  return <>
    <div className="section-switch" role="group" aria-label={t('Lab sections')}><button aria-pressed={section === 'experiments'} onClick={() => setSection('experiments')}>{t('Experiments')}</button><button aria-pressed={section === 'findings'} onClick={() => setSection('findings')}>{t('Findings')}</button></div>
    {section === 'findings' ? <Findings initialFindingId={initialFindingId} /> : <>
    <p className="muted">{t("Test a question against evidence. Create an experiment from a Radar question to begin.")}</p>
    {error && <p role="alert" className="error">{t(error)} <button onClick={() => void perform(refresh)}>{t("Reload Lab")}</button></p>}
    <label>{t("Experiment")}<select aria-label={t("Experiment")} disabled={busy} value={selected} onChange={event => { const id = event.target.value; setBusy(true); void refresh(id).catch(() => setError('Unable to load experiment.')).finally(() => setBusy(false)); }}>{items.map(experiment => <option key={experiment.id} value={experiment.id}>{experiment.title}{t("·")}{t('status.' + experiment.status)}</option>)}</select></label>
    {!item ? <p className="empty">{t("No experiments yet. Create an idea in Radar.")}</p> : <fieldset disabled={busy}><ExperimentDetail key={`${item.id}:${generation}`} item={item} logs={logs} perform={perform} /></fieldset>}
    </>}
  </>;
}
