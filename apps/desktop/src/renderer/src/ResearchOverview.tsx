import { useEffect, useState } from 'react';
import type { Article, ClaimRecord, Experiment, Finding, RadarQuestion } from '@unvar/shared';
import { useI18n } from './i18n';
export type ResearchTarget = { view: 'Lab'|'Writing'; experimentId?: string; findingId?: string; articleId?: string };

export function ResearchOverview({ search = '', next = false, onOpen }: { search?: string; next?: boolean; onOpen: (target: ResearchTarget) => void }) {
  const { t } = useI18n();
  const [data,setData] = useState<{ experiments: Experiment[]; findings: Finding[]; articles: Article[]; questions: RadarQuestion[]; claims: ClaimRecord[] }>({ experiments: [],findings: [],articles: [],questions: [],claims: [] });
  const [error,setError] = useState(false);
  async function refresh() { const [experiments,findings,articles,questions,claims] = await Promise.all([window.unvar.listExperiments(),window.unvar.listFindings(),window.unvar.listArticles(),window.unvar.listQuestions(),window.unvar.listClaims()]); setData({ experiments,findings,articles,questions,claims }); setError(false); }
  useEffect(() => { void refresh().catch(() => setError(true)); }, []);
  const rows = [
    ...data.experiments.map(item => ({ id: item.id,kind: 'Experiment',title: item.title,text: [item.question,item.prediction,item.result,item.limitations,item.sourceTitle,item.sourceUrl].filter(Boolean).join('\n\n'),pending: !['done','archived'].includes(item.status),status: item.status,target: { view: 'Lab' as const,experimentId: item.id },action: 'Continue this experiment' })),
    ...data.findings.map(item => ({ id: item.id,kind: 'Finding',title: item.text,text: item.counterEvidence,pending: item.status === 'candidate',status: item.status,target: { view: 'Lab' as const,findingId: item.id },action: 'Review this finding' })),
    ...data.articles.map(item => ({ id: item.id,kind: 'Article',title: item.title,text: [item.finalMd,...Object.values(item.interview)].filter(Boolean).join('\n\n'),pending: item.status !== 'ready' || !item.confirmationValid,status: 'writing.' + item.status,target: { view: 'Writing' as const,articleId: item.id },action: 'Continue this article' })),
  ].filter(item => (!next || item.pending) && `${item.title}\n${item.text}`.toLowerCase().includes(search.toLowerCase()));
  const visible = next ? rows.slice(0,5) : rows;
  const questions = next ? [] : data.questions.filter(item => `${item.text}\n${item.claim}\n${item.sourceTitle}\n${item.proposedExperiment}`.toLowerCase().includes(search.toLowerCase()));
  return <section className="research-results" aria-label={t(next ? 'Suggested next actions' : 'Research results')}><h2>{t(next ? 'Suggested next actions' : 'Research results')}</h2>
    {error && <p className="error" role="alert">{t('Unable to load your workspace. Please retry.')} <button onClick={() => void refresh().catch(() => setError(true))}>{t('Retry')}</button></p>}
    {!error && !visible.length && !questions.length && !(!next && data.claims.some(item => `${item.text} ${item.evidenceText} ${item.sourceTitle}`.toLowerCase().includes(search.toLowerCase()))) && <p className="muted">{t(next ? 'No pending research actions. Capture a source to begin.' : 'No matching research results.')}</p>}
    {visible.map(item => <article key={item.id} className="research-row"><div className="signal-meta"><span>{t(item.kind)}</span><span>{t(item.status.startsWith('writing.') ? 'writing.status.' + item.status.slice(8) : 'status.' + item.status)}</span></div><h3>{item.title}</h3>{!next && <details><summary>{t('View research details')}</summary><p className="preserve-lines">{item.text}</p></details>}<button onClick={() => onOpen(item.target)}>{t(item.action)}</button></article>)}
    {!next && data.claims.filter(item => `${item.text} ${item.evidenceText} ${item.sourceTitle}`.toLowerCase().includes(search.toLowerCase())).map(item => <article className="research-row" key={item.id}><div className="signal-meta">{t('Claim')}</div><h3>{item.text}</h3><details><summary>{t('View research details')}</summary><blockquote>{item.evidenceText}</blockquote><p>{item.sourceTitle}</p><p className="source">{item.sourceUrl}</p></details></article>)}
    {questions.map(item => <article className="research-row" key={item.id}><div className="signal-meta">{t('Question')} · {t('status.' + item.status)}</div><h3>{item.text}</h3><details><summary>{t('View research details')}</summary><blockquote>{item.claim}</blockquote><p>{item.sourceTitle}</p><p className="source">{item.sourceUrl}</p><p className="preserve-lines">{item.proposedExperiment}</p></details></article>)}
  </section>;
}
