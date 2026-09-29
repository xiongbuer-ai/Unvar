import { JevScoreHistory } from './JevScoreHistory';
import { useI18n } from './i18n';
import { useEffect, useState } from 'react';
import { scoreKeys, type Signal, type ProviderSettings, type RadarQuestion, type WorkflowRun, type QuestionScores } from '@unvar/shared';

const labels = { workRelevance: 'Work relevance', experimentability: 'Experimentability', evidencePotential: 'Evidence potential', uniqueness: 'Uniqueness', seriesPotential: 'Series potential' };

function QuestionCard({ question, perform }: { question: RadarQuestion; perform: (operation: () => Promise<unknown>) => Promise<void> }) {
  const { t } = useI18n();
  const [mode, setMode] = useState<'edit' | 'score' | null>(null);
  const [text, setText] = useState(question.text);
  const [method, setMethod] = useState(question.proposedExperiment);
  const [scores, setScores] = useState<QuestionScores>(question.scores);
  const [reason, setReason] = useState('');
  const [experiment, setExperiment] = useState('');
  return <article className="panel signal">
    <div className="signal-meta"><span>{t('status.' + question.status)}</span><span>{question.estimatedMinutes}{t("min")}</span><span>{t(question.humanOverride ? 'Human score' : 'AI score')}</span></div>
    <h2>{question.text}</h2><p className="muted">{t("Source:")}{question.sourceTitle}</p><p className="source">{question.sourceUrl}</p>
    <blockquote>{question.claim}</blockquote><p>{question.whyRelevant}</p><p><strong>{t("Proposed experiment:")}</strong> {question.proposedExperiment}</p>
    <dl className="score-grid">{scoreKeys.map((key) => <div key={key}><dt>{t(labels[key])}</dt><dd>{question.scores[key]}{t("/ 3")}</dd></div>)}</dl>
    <JevScoreHistory question={question} onUpdated={()=>perform(async()=>{})} />
    {question.overrideReason && <p className="muted">{t("Override:")}{question.overrideReason}</p>}
    {mode && <form onSubmit={(event) => {
      event.preventDefault();
      void perform(async () => {
        if (mode === 'edit') await window.unvar.editQuestion({ id: question.id, text, proposedExperiment: method, reason });
        else await window.unvar.overrideScore({ id: question.id, scores, reason });
        setMode(null); setReason('');
      });
    }}>
      {mode === 'edit' ? <><label>{t("Question")}<textarea aria-label={t("Question")} value={text} required maxLength={2000} onChange={(event) => setText(event.target.value)} /></label><label>{t("Proposed experiment")}<textarea aria-label={t("Proposed experiment")} value={method} required maxLength={4000} onChange={(event) => setMethod(event.target.value)} /></label></> : <div className="score-grid">{scoreKeys.map((key) => <label key={key}>{t(labels[key])}<input type="number" min={0} max={3} step={1} required value={scores[key]} onChange={(event) => setScores({ ...scores, [key]: Number(event.target.value) })} /></label>)}</div>}
      <label>{t("Reason for your change")}<textarea aria-label={t("Reason for your change")} required value={reason} maxLength={2000} onChange={(event) => setReason(event.target.value)} /></label><div className="actions"><button className="primary" type="submit">{t("Save change")}</button><button type="button" onClick={() => setMode(null)}>{t("Cancel")}</button></div>
    </form>}
    <div className="actions"><button onClick={() => void perform(async () => { const result = await window.unvar.createExperiment(question.id); setExperiment(result.id); })}>{t("Create experiment")}</button><button onClick={() => { setText(question.text); setMethod(question.proposedExperiment); setMode('edit'); }}>{t("Edit question")}</button><button onClick={() => { setScores(question.scores); setMode('score'); }}>{t("Override score")}</button>{(['candidate', 'backlog', 'archived'] as const).filter((status) => status !== question.status).map((status) => <button key={status} onClick={() => void perform(() => window.unvar.setQuestionStatus({ id: question.id, status }))}>{t(status === 'candidate' ? 'Candidate' : status === 'backlog' ? 'Later' : 'Archive')}</button>)}</div>
    {experiment && <p role="status">{t("Experiment saved as an idea:")}{experiment}</p>}
  </article>;
}

export function Radar({ initialSignalId }: { initialSignalId?: string }) {
  const { t } = useI18n();
  const [signals, setSignals] = useState<Signal[]>([]);
  const [providers, setProviders] = useState<ProviderSettings[]>([]);
  const [questions, setQuestions] = useState<RadarQuestion[]>([]);
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [signalId, setSignalId] = useState(initialSignalId ?? '');
  const [providerId, setProviderId] = useState('');
  const [filter, setFilter] = useState('candidate');
  const [error, setError] = useState('');
  const [hasFocus, setHasFocus] = useState(true);
  const [busy, setBusy] = useState(false);
  async function refresh() {
    const [saved, configured, candidates, history, settings] = await Promise.all([window.unvar.listSignals({ status: 'inbox' }), window.unvar.listProviders(), window.unvar.listQuestions(), window.unvar.listRuns(), window.unvar.getResearchSettings()]);
    setSignals(saved); setProviders(configured.filter((item) => item.enabled && item.configured)); setQuestions(candidates); setRuns(history); setHasFocus(Boolean(settings.researchFocus));
    setSignalId((value) => value || saved[0]?.id || '');
    setProviderId((value) => value || configured.find((item) => item.enabled && item.configured)?.id || '');
  }
  useEffect(() => { void refresh().catch(() => setError('Unable to load Radar. Check Settings and retry.')); }, []);
  const running = runs.some((run) => run.status === 'running');
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => { void refresh().catch(() => setError('Unable to refresh analysis status.')); }, 1000);
    return () => clearInterval(timer);
  }, [running]);
  async function perform(operation: () => Promise<unknown>) {
    setBusy(true); setError('');
    try { await operation(); await refresh(); } catch { setError('Unable to complete this action. Check your settings and input, then retry.'); } finally { setBusy(false); }
  }
  return <>
    <section className="panel"><h2>{t("Find a question worth testing")}</h2><p className="muted">{t("Choose a saved source. Analysis sends its readable text and research focus to your selected model.")}</p>
      <fieldset disabled={busy}><label>{t("Source")}<select aria-label={t("Source")} value={signalId} onChange={(event) => setSignalId(event.target.value)}><option value="">{t("Select a capture")}</option>{signals.map((item) => <option key={item.id} value={item.id}>{item.title || item.url || item.text.slice(0,70)}</option>)}</select></label>
      <label>{t("Analysis provider")}<select aria-label={t("Analysis provider")} value={providerId} onChange={(event) => setProviderId(event.target.value)}><option value="">{t("Select a configured provider")}</option>{providers.map((item) => <option key={item.id} value={item.id}>{item.displayName}{t("·")}{item.model}</option>)}</select></label>
      {!providers.length && <p>{t("Configure a provider and save its API key in Settings.")}</p>}{!hasFocus && <p className="notice">{t("Add your research focus in Settings. Until then, relevance remains 0 and questions go to Backlog for human review.")}</p>}
      <button className="primary" disabled={!signalId || !providerId || runs.some((run) => run.entityId === signalId && run.status === 'running')} onClick={() => void perform(() => window.unvar.analyzeSignal({ signalId, providerId }))}>{t("Analyze source")}</button></fieldset>
    </section>
    {error && <p role="alert" className="error">{t(error)}<button onClick={() => void perform(refresh)}>{t("Retry")}</button></p>}
    {runs.length > 0 && <section className="panel"><h2>{t("Recent analyses")}</h2>{runs.slice(0,5).map((run) => <div key={run.id} className="run-row"><p><strong>{t('status.' + run.status)}</strong>{t("·")}{t('stage.' + run.stage)}<br /><span className="muted">{signals.find((item) => item.id === run.entityId)?.title || run.entityId}</span>{run.errorMessage && <span className="error run-error">{t(run.errorMessage)}</span>}</p>{run.status === 'running' ? <button onClick={() => void perform(() => window.unvar.cancelAnalysis(run.id))}>{t("Cancel analysis")}</button> : run.status !== 'completed' && <button disabled={!providerId} onClick={() => void perform(() => window.unvar.analyzeSignal({ signalId: run.entityId, providerId }))}>{t("Retry analysis")}</button>}</div>)}</section>}
    <label>{t("Question status")}<select aria-label={t("Question status")} value={filter} onChange={(event) => setFilter(event.target.value)}><option value="candidate">{t("Candidate")}</option><option value="backlog">{t("Backlog")}</option><option value="archived">{t("Archive")}</option><option value="all">{t("All")}</option></select></label>
    <fieldset disabled={busy}>{questions.filter((question) => filter === 'all' || question.status === filter).map((question) => <QuestionCard key={question.id} question={question} perform={perform} />)}</fieldset>
    {!questions.some((question) => filter === 'all' || question.status === filter) && <p className="empty">{t("No questions in this view yet.")}</p>}
  </>;
}
