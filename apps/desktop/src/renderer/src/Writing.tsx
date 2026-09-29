import { useEffect, useState } from 'react';
import type { Article, ArticleVersionInput, Interview, ProviderSettings, WritingRun, WritingStage } from '@unvar/shared';
import { PiInterview } from './PiInterview';
import { useI18n } from './i18n';

function ArticleEditor({ article, providerId, running, perform }: { article: Article; providerId: string; running: boolean; perform: (operation: () => Promise<unknown>) => Promise<void> }) {
  const { t } = useI18n();
  const [title, setTitle] = useState(article.title);
  const [answers, setAnswers] = useState<Interview>(article.interview);
  const [outline, setOutline] = useState(article.outlineMd);
  const [body, setBody] = useState(article.finalMd);
  const [piBusy, setPiBusy] = useState(false);
  const [reason, setReason] = useState('');
  const version: ArticleVersionInput = { id: article.id, revision: article.revision };
  const interviewDirty = title !== article.title || JSON.stringify(answers) !== JSON.stringify(article.interview);
  const contentDirty = outline !== article.outlineMd || body !== article.finalMd;
  const pack = article.factPack;
  const generate = (stage: WritingStage) => perform(() => window.unvar.generateWriting({ articleId: article.id, providerId, stage, operationId: crypto.randomUUID() }));
  const canGenerate = Boolean(providerId && article.confirmationValid && !interviewDirty && !contentDirty && !running && !piBusy);
  return <article className="writing-editor">
    <div className="signal-meta"><span>{t('writing.status.' + article.status)}</span><span>{t(article.source.kind === 'finding' ? 'Finding' : 'Experiment')}</span></div>
    <PiInterview article={article} providerId={providerId} disabled={interviewDirty || contentDirty || running} onBusyChange={setPiBusy} onApplied={() => perform(async () => {})} />
    <section className="writing-section"><h2>{t('Author interview')}</h2><p className="muted">{t('Record your own observations, experiences and opinions. Models cannot answer for you.')}</p>
      <form onSubmit={event => { event.preventDefault(); void perform(() => window.unvar.saveInterview({ ...version, title, answers })); }}>
        <label>{t('Article title')}<input aria-label={t('Article title')} required maxLength={240} value={title} onChange={event => setTitle(event.target.value)} /></label>
        {([['observations','Your observations'],['experience','Your experience'],['opinions','Your opinions'],['unknowns','Open questions']] as const).map(([key,label]) => <label key={key}>{t(label)}<textarea aria-label={t(label)} rows={3} maxLength={12000} value={answers[key]} onChange={event => setAnswers({ ...answers, [key]: event.target.value })} /></label>)}
        <button disabled={!interviewDirty || running}>{t('Save interview')}</button>
      </form>
    </section>
    <section className="writing-section"><h2>{t('Fact Pack')}</h2><p className="muted">{t('Check the evidence and your answers before confirming. Any source or interview change requires confirmation again.')}</p>
      <div className="actions"><button disabled={interviewDirty || running || !Object.values(article.interview).some(value => value.trim())} onClick={() => void perform(() => window.unvar.buildFactPack(version))}>{t('Build Fact Pack')}</button>{pack && <button className="primary" disabled={article.confirmationValid || interviewDirty || running} onClick={() => void perform(() => window.unvar.confirmFactPack({ ...version, version: pack.version }))}>{t('Confirm Fact Pack')}</button>}</div>
      {pack && <><p role="status" className={article.confirmationValid ? 'notice' : 'muted'}>{t(article.confirmationValid ? 'Fact Pack confirmed' : 'Fact Pack needs confirmation')} · {t('Version')} {pack.version}</p>
        <div className="fact-pack"><h3>{t('Recorded facts')}</h3>{pack.confirmedFacts.map((fact,index) => <p key={index} className="preserve-lines">{fact.text}<small>{fact.evidenceIds.length ? fact.evidenceIds.join(', ') : t('Author observation')}</small></p>)}
          {([['userOpinions','Your opinions'],['userExperiences','Your experience'],['limitations','Limitations'],['unknowns','Open questions']] as const).map(([key,label]) => <div key={key}><h3>{t(label)}</h3>{pack[key].length ? pack[key].map((value,index) => <p className="preserve-lines" key={index}>{value}</p>) : <p className="muted">{t('Not provided')}</p>}</div>)}
          <details><summary>{t('Source evidence')}</summary>{pack.evidence.map(evidence => <div key={evidence.id}><h4>{evidence.title}</h4><p className="source">{evidence.sourceUrl}</p><p className="preserve-lines">{evidence.text}</p><p>{evidence.limitations}</p>{evidence.relation && <p>{t('relation.' + evidence.relation)} · {evidence.note}</p>}<small>{evidence.id}</small></div>)}</details>
        </div></>}
    </section>
    <section className="writing-section"><h2>{t('Outline and draft')}</h2><p className="muted">{t('Generation sends the confirmed Fact Pack to the selected provider. Save edits before starting another step.')}</p>
      <div className="actions"><button disabled={!canGenerate} onClick={() => void generate('outline')}>{t('Generate outline')}</button><button disabled={!canGenerate || article.outlineVersion !== pack?.version || !article.outlineMd} onClick={() => void generate('draft')}>{t('Generate draft')}</button></div>
      <label>{t('Outline')}<textarea aria-label={t('Outline')} rows={6} maxLength={100000} value={outline} onChange={event => setOutline(event.target.value)} /></label>
      <label>{t('Article body')}<textarea aria-label={t('Article body')} className="markdown-editor" rows={12} maxLength={100000} value={body} onChange={event => setBody(event.target.value)} /></label>
      <label>{t('Your editorial reason')}<textarea aria-label={t('Your editorial reason')} rows={2} maxLength={4000} value={reason} onChange={event => setReason(event.target.value)} /></label>
      <div className="actions"><button disabled={running || interviewDirty || !article.confirmationValid || !outline.trim() || outline === article.outlineMd || !reason.trim() || body !== article.finalMd} onClick={() => void perform(() => window.unvar.editArticle({ ...version, part: 'outline', markdown: outline, reason }))}>{t('Save outline')}</button><button disabled={running || interviewDirty || !article.confirmationValid || article.draftVersion !== pack?.version || !body.trim() || body === article.finalMd || !reason.trim() || outline !== article.outlineMd} onClick={() => void perform(() => window.unvar.editArticle({ ...version, part: 'draft', markdown: body, reason }))}>{t('Save draft edits')}</button></div>
      {contentDirty && <p className="notice">{t('Save one edited section at a time. Editing the outline requires a new draft.')}</p>}
    </section>
    <section className="writing-section"><h2>{t('Review and export')}</h2><button disabled={!canGenerate || article.draftVersion !== pack?.version || !article.finalMd} onClick={() => void generate('review')}>{t('Review draft')}</button>
      {article.review && <><p className="preserve-lines">{article.review.summary}</p><ul>{article.review.issues.map((issue,index) => <li key={index}>{issue}</li>)}</ul>{!article.reviewCurrent && <p className="notice">{t('This review is outdated. Review the current draft again.')}</p>}</>}
      <p className="muted">{t('Ready is your decision. Check all review issues and explain your decision in the editorial reason above.')}</p>
      <div className="actions"><button className="primary" disabled={running || interviewDirty || contentDirty || !article.confirmationValid || !article.reviewCurrent || !reason.trim() || article.status === 'ready'} onClick={() => void perform(() => window.unvar.readyArticle({ ...version, reason }))}>{t('Mark Ready')}</button><button disabled={interviewDirty || contentDirty || article.status !== 'ready' || !article.confirmationValid || !article.reviewCurrent} onClick={() => void perform(() => window.unvar.exportArticle(article.id))}>{t('Export article Markdown')}</button></div>
    </section>
  </article>;
}

export function Writing({ initialArticleId }: { initialArticleId?: string }) {
  const { t } = useI18n();
  const [items,setItems] = useState<Article[]>([]);
  const [sources,setSources] = useState<{ id: string; kind: 'experiment'|'finding'; title: string }[]>([]);
  const [providers,setProviders] = useState<ProviderSettings[]>([]);
  const [providerId,setProviderId] = useState('');
  const [selected,setSelected] = useState(initialArticleId ?? '');
  const [source,setSource] = useState('');
  const [title,setTitle] = useState('');
  const [runs,setRuns] = useState<WritingRun[]>([]);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  async function refresh() {
    const [articles,experiments,findings,configured,history] = await Promise.all([window.unvar.listArticles(),window.unvar.listExperiments(),window.unvar.listFindings(),window.unvar.listProviders(),window.unvar.listWritingRuns()]);
    setItems(articles); setRuns(history); setSelected(value => value || articles[0]?.id || '');
    setSources([...findings.filter(value => value.status === 'accepted').map(value => ({ id: value.id,kind: 'finding' as const,title: value.text })),...experiments.filter(value => ['done','archived'].includes(value.status) && value.result.trim()).map(value => ({ id: value.id,kind: 'experiment' as const,title: value.title }))]);
    setProviders(configured.filter(value => value.enabled && value.configured)); setProviderId(value => value || configured.find(item => item.enabled && item.configured)?.id || '');
  }
  useEffect(() => { void refresh().catch(() => setError('Unable to load Writing. Retry to reload.')); }, []);
  const anyRunning = runs.some(run => run.status === 'running');
  useEffect(() => { if (!anyRunning) return; const timer = setInterval(() => { void refresh().catch(() => setError('Unable to refresh analysis status.')); },1000); return () => clearInterval(timer); },[anyRunning]);
  async function perform(operation: () => Promise<unknown>) { setBusy(true); setError(''); try { await operation(); await refresh(); } catch { setError('Could not save Writing. Check the current evidence, confirmation and revision, then retry.'); } finally { setBusy(false); } }
  const article = items.find(item => item.id === selected);
  const running = runs.some(run => run.articleId === selected && run.status === 'running');
  return <>
    <p className="muted">{t('Write from verified experiments and findings, with your own perspective.')}</p>
    {error && <p className="error" role="alert">{t(error)} <button onClick={() => void perform(refresh)}>{t('Retry')}</button></p>}
    <fieldset disabled={busy || running}><details className="writing-create" open={!items.length}><summary>{t('New article')}</summary><form onSubmit={event => { event.preventDefault(); const picked = sources.find(item => item.id === source); if (picked) void perform(async () => { const created = await window.unvar.createArticle({ title, source: { kind: picked.kind,id: picked.id },operationId: crypto.randomUUID() }); setSelected(created.id); setTitle(''); }); }}>
      <label>{t('Article title')}<input aria-label={t('Article title')} required maxLength={240} value={title} onChange={event => setTitle(event.target.value)} /></label>
      <label>{t('Article source')}<select aria-label={t('Article source')} required value={source} onChange={event => setSource(event.target.value)}><option value="">{t('Select a completed experiment or accepted finding')}</option>{sources.map(item => <option key={item.id} value={item.id}>{t(item.kind === 'finding' ? 'Finding' : 'Experiment')} · {item.title}</option>)}</select></label><button className="primary" disabled={!source || !title.trim()}>{t('Create article')}</button>
    </form></details>
    <div className="form-row"><label>{t('Article')}<select aria-label={t('Article')} value={selected} onChange={event => setSelected(event.target.value)}>{items.map(item => <option key={item.id} value={item.id}>{item.title} · {t('writing.status.' + item.status)}</option>)}</select></label><label>{t('Analysis provider')}<select aria-label={t('Analysis provider')} value={providerId} onChange={event => setProviderId(event.target.value)}><option value="">{t('Select a configured provider')}</option>{providers.map(item => <option key={item.id} value={item.id}>{item.displayName} · {item.model}</option>)}</select></label></div>
    {article && <ArticleEditor key={`${article.id}:${article.revision}`} article={article} providerId={providerId} running={running} perform={perform} />}</fieldset>
    {runs.some(run => run.articleId === selected) && <section className="writing-section"><h2>{t('Writing generation history')}</h2>{runs.filter(run => run.articleId === selected).slice(0,6).map(run => <div className="run-row" key={run.id}><p>{t('writing.status.' + run.stage)} · {t('status.' + run.status)} · {run.calls.map(call => call.model).join(', ')}{run.error && <span className="error run-error">{t(run.error)}</span>}</p>{run.status === 'running' ? <button onClick={() => void perform(() => window.unvar.cancelWritingRun(run.id))}>{t('Cancel generation')}</button> : ['failed','canceled'].includes(run.status) && <button disabled={busy || running || !providerId} onClick={() => void perform(() => window.unvar.generateWriting({ articleId: run.articleId, providerId, stage: run.stage, operationId: crypto.randomUUID() }))}>{t('Retry generation')}</button>}</div>)}</section>}
  </>;
}
