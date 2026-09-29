import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { Signal, SignalInput } from '@unvar/shared';
import { Capture, kindLabels } from './Capture';
import { Settings } from './Settings';
import { SettingsMenu } from './SettingsMenu';
import { Radar } from './Radar';
import { Lab } from './Lab';
import { Writing } from './Writing';
import { DecisionLog } from './DecisionLog';
import { ResearchOverview, type ResearchTarget } from './ResearchOverview';
import { QuickComposer } from './QuickComposer';
import { LanguageProvider, useI18n } from './i18n';
import './styles.css';
import brandMark from './assets/unvar.svg?no-inline';
import { IconButton, TooltipButton } from './IconButton';

if (navigator.platform.startsWith('Mac')) document.documentElement.dataset.platform = 'macos';

function NavIcon({ name }: { name: string }) {
  const paths: Record<string, string> = {
    Today: 'M4 5h16v15H4z M8 3v4 M16 3v4 M4 10h16',
    Inbox: 'M4 4h16v16H4z M4 14h5l2 3h2l2-3h5',
    Lab: 'M9 3h6 M10 3v7l-6 9q-1 2 2 2h12q3 0 2-2l-6-9V3 M7 16h10',
    Radar: 'M12 3a9 9 0 1 0 9 9 M12 7a5 5 0 1 0 5 5 M12 12l8-8',
    Writing: 'M4 20h16 M5 15l10-10 4 4-10 10H5z M13 7l4 4',
    Library: 'M4 4h4v16H4z M10 4h4v16h-4z M17 5l3-1 3 15-3 1z',
    Settings: 'M4 7h16 M4 17h16 M8 4v6 M16 14v6',
    Search: 'M16 16l5 5 M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
    Panel: 'M3 4h18v16H3z M15 4v16',
    Menu: 'M4 6h16 M4 12h16 M4 18h16',
    Plus: 'M12 4v16 M4 12h16',
  };
  return <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}
type View = 'Today' | 'Inbox' | 'Library' | 'Radar' | 'Lab' | 'Writing' | 'Settings';
function App() {
  const { t, locale } = useI18n();
  const [radarSignal, setRadarSignal] = useState<string>();
  const [librarySection, setLibrarySection] = useState<'records'|'decisions'>('records');
  const [researchTarget, setResearchTarget] = useState<ResearchTarget>();
  const [view, setView] = useState<View>('Today');
  const [signals, setSignals] = useState<Signal[]>([]);
  const [editing, setEditing] = useState<Signal | 'new' | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'inbox' | 'archived' | 'all'>('inbox');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [connected, setConnected] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [overview, setOverview] = useState(() => window.innerWidth >= 1180);
  const refresh = async () => setSignals(await window.unvar.listSignals({ status: 'all' }));
  useEffect(() => { void Promise.all([refresh(), window.unvar.getAppInfo().then(() => setConnected(true))]).catch(() => setError('Unable to load your workspace. Please retry.')); }, []);
  function navigate(name: View) { setLibrarySection('records'); setResearchTarget(undefined); setView(name); setEditing(null); setSelected(null); setSearch(''); }
  function openResearch(target: ResearchTarget) { navigate(target.view); setResearchTarget(target); document.querySelector('.content-scroll')?.scrollTo(0, 0); }
  function openSearch() { navigate('Library'); requestAnimationFrame(() => document.getElementById('library-search')?.focus()); }
  useEffect(() => {
    const handler = (event: KeyboardEvent) => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); openSearch(); } };
    window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler);
  }, []);
  const visible = signals.filter(signal => (!selected || signal.id === selected) && (view === 'Library' || status === 'all' || signal.status === status) && `${signal.title}\n${signal.text}\n${signal.url}\n${signal.tags.join(' ')}`.toLowerCase().includes(search.toLowerCase()));
  const active = signals.find(signal => signal.id === selected);
  const inboxCount = signals.filter(signal => signal.status === 'inbox').length;
  async function save(input: SignalInput) { await window.unvar.saveSignal(input); setEditing(null); setStatus('inbox'); setSearch(''); await refresh(); }
  async function action(operation: () => Promise<unknown>) { setBusy(true); setError(''); try { await operation(); await refresh(); } catch { setError('The operation could not be completed. Please retry.'); } finally { setBusy(false); } }
  function openSignal(signal: Signal) { setView('Library'); setEditing(null); setSearch(''); setSelected(signal.id); }
  return <div className={`workspace${collapsed ? ' navigation-collapsed' : ''}${overview ? ' overview-open' : ''}`}>
    <aside className="sidebar" id="workspace-navigation">
      <div className="sidebar-tools"><IconButton tooltip={t(collapsed ? 'Expand navigation' : 'Collapse navigation')} aria-label={t('Toggle navigation')} aria-expanded={!collapsed} onClick={() => setCollapsed(!collapsed)}><NavIcon name="Panel" /></IconButton><IconButton tooltip={`${t('Search library')} · ${navigator.platform.startsWith('Mac') ? '⌘K' : 'Ctrl+K'}`} aria-label={t('Search library')} onClick={openSearch}><NavIcon name="Search" /></IconButton></div>
      <div className="brand" aria-label="Unvar"><img className="brand-mark" src={brandMark} alt="" width="36" height="36" /><div className="brand-copy"><strong>Unvar</strong><span>{t('Research workspace')}</span></div></div>
      <button className="new-capture" aria-label={t('New capture')} onClick={() => { navigate('Inbox'); setEditing('new'); }}><NavIcon name="Plus" /><span className="nav-label">{t('New capture')}</span></button>
      <nav aria-label={t('Main navigation')}>{(['Today', 'Inbox', 'Radar', 'Lab', 'Writing', 'Library'] as const).map(name => <TooltipButton key={name} tooltip={collapsed ? t(name) : undefined} aria-label={t(name)} aria-current={view === name && (!selected || collapsed) ? 'page' : undefined} onClick={() => navigate(name)}><NavIcon name={name} /><span className="nav-label">{t(name)}</span>{name === 'Inbox' && !collapsed && <span className="nav-count">{inboxCount}</span>}</TooltipButton>)}</nav>
      {!collapsed && <section className="recent-captures"><h2>{t('Recent captures')} <span>{signals.length}</span></h2>{signals.slice(0, 5).map(signal => <button key={signal.id} aria-current={selected === signal.id ? 'page' : undefined} onClick={() => openSignal(signal)}><span>{signal.title || signal.text.slice(0, 40) || signal.url}</span><time dateTime={signal.createdAt}>{new Date(signal.createdAt).toLocaleDateString(locale, { month: 'numeric', day: 'numeric' })}</time></button>)}{!signals.length && <p className="muted">{t('No recent captures')}</p>}</section>}
      <div className="sidebar-bottom"><SettingsMenu icon={<NavIcon name="Settings" />} onOpenSettings={() => navigate('Settings')} /></div>
    </aside>
    <main className="main-workspace"><header className="workspace-topbar"><h1>{active?.title || t(view)}</h1><div className="topbar-actions"><IconButton tooltip={t('Search library')} aria-label={t('Search library')} onClick={openSearch}><NavIcon name="Search" /></IconButton><IconButton tooltip={t(overview ? 'Hide overview' : 'Show overview')} aria-label={t('Toggle overview')} aria-controls="workspace-overview" aria-expanded={overview} onClick={() => setOverview(!overview)}><NavIcon name="Panel" /></IconButton></div></header>
      <div className="content-scroll"><div className="content-inner">
        {error && <div role="alert" className="error">{t(error)} <button onClick={() => void action(refresh)}>{t('Retry')}</button></div>}
        {view === 'Library' && !selected && <div className="section-switch" role="group" aria-label={t('Library sections')}><button aria-pressed={librarySection === 'records'} onClick={() => setLibrarySection('records')}>{t('Research records')}</button><button aria-pressed={librarySection === 'decisions'} onClick={() => setLibrarySection('decisions')}>{t('Decision Log')}</button></div>}
        {view === 'Library' && !selected && librarySection === 'decisions' ? <DecisionLog /> : view === 'Settings' ? <Settings /> : view === 'Writing' ? <Writing key={researchTarget?.articleId} initialArticleId={researchTarget?.articleId} /> : view === 'Lab' ? <Lab key={researchTarget?.experimentId || researchTarget?.findingId} initialExperimentId={researchTarget?.experimentId} initialFindingId={researchTarget?.findingId} /> : view === 'Radar' ? <Radar initialSignalId={radarSignal} /> : view === 'Today' ? <section className="today-start"><p className="eyebrow">{t('RESEARCH → EVIDENCE → WRITING')}</p><h2>{t('Ready to investigate')}</h2><p>{t('Start with a source, a question, or an observation.')}</p><div className="today-actions"><button onClick={() => navigate('Inbox')}><NavIcon name="Inbox" />{t('Review sources')}</button><button onClick={() => navigate('Radar')}><NavIcon name="Radar" />{t('Explore questions')}</button><button onClick={() => navigate('Lab')}><NavIcon name="Lab" />{t('Run an experiment')}</button></div><p className="muted">{t('inboxCount', { count: inboxCount })}</p><button onClick={() => navigate('Inbox')}>{t('Open Inbox')}</button><ResearchOverview next onOpen={openResearch} /></section> : <>
          {editing && <Capture key={editing === 'new' ? 'new' : editing.id} signal={editing === 'new' ? undefined : editing} onSave={save} onCancel={() => setEditing(null)} />}
          {selected ? <button className="back-to-list" onClick={() => setSelected(null)}>{t('Show all captures')}</button> : <div className="toolbar"><label>{t('Search')}<input aria-label={t('Search')} id="library-search" type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder={t('Title, content, URL, or tag')} /></label>{view === 'Inbox' && <label>{t('Status')}<select aria-label={t('Status')} value={status} onChange={event => setStatus(event.target.value as typeof status)}><option value="inbox">{t('Inbox')}</option><option value="archived">{t('Archived')}</option><option value="all">{t('All')}</option></select></label>}</div>}
          {view === 'Library' && !selected && <ResearchOverview search={search} onOpen={openResearch} />}
          <div className="signal-list">{!visible.length && <p className="empty">{t('No captures here yet.')}</p>}{visible.map(signal => <article key={signal.id} className="panel signal"><div className="signal-meta"><span>{t(kindLabels[signal.kind])}</span><span>{t('status.' + signal.status)}</span><time dateTime={signal.createdAt}>{new Date(signal.createdAt).toLocaleDateString(locale)}</time></div><h2>{signal.title || signal.text.slice(0, 70) || signal.url}</h2>{signal.url && <p className="source">{signal.url}</p>}<pre className={signal.kind === 'code' ? 'code' : ''}>{signal.text}</pre><div className="tags">{signal.tags.map(tag => <span key={tag}>{tag}</span>)}</div><div className="actions"><button disabled={busy} onClick={() => { setRadarSignal(signal.id); navigate('Radar'); }}>{t('Send to Radar')}</button><button disabled={busy} onClick={() => setEditing(signal)}>{t('Edit')}</button><button disabled={busy} onClick={() => void action(() => window.unvar.setSignalStatus({ id: signal.id, status: signal.status === 'archived' ? 'inbox' : 'archived' }))}>{t(signal.status === 'archived' ? 'Restore' : 'Archive')}</button><button disabled={busy} onClick={() => void action(() => window.unvar.exportSignal(signal.id))}>{t('Export Markdown')}</button></div></article>)}</div>
        </>}
      </div></div>
      {(view === 'Today' || view === 'Inbox') && !editing && <div className="composer-dock"><QuickComposer onSave={save} /></div>}
      <footer className="workspace-footer"><span className={connected ? 'dot' : 'dot disconnected'} aria-hidden="true" />{t(connected ? 'Desktop connected' : 'Connecting to desktop…')} · {t('Local collection')}</footer>
    </main>
    {overview && <section id="workspace-overview" className="inspector" aria-label={t('Overview')}><header><h2>{t('Overview')}</h2><IconButton tooltip={t('Hide overview')} aria-label={t('Toggle overview')} onClick={() => setOverview(false)}><NavIcon name="Panel" /></IconButton></header><div className="inspector-body"><h3>{t('Workspace')}</h3><dl><div><dt>{t('Records')}</dt><dd>{signals.length}</dd></div><div><dt>{t('Inbox items')}</dt><dd>{inboxCount}</dd></div></dl><h3>{t('Selected source')}</h3>{active ? <><p className="inspector-title">{active.title || active.text.slice(0, 80) || active.url}</p><p className="source">{active.url}</p><div className="tags">{active.tags.map(tag => <span key={tag}>{tag}</span>)}</div><button onClick={() => { setRadarSignal(active.id); navigate('Radar'); }}>{t('Send to Radar')}</button></> : <p className="muted">{t('Select a capture to see its details.')}</p>}<h3>{t('Next steps')}</h3><button onClick={() => navigate('Radar')}>{t('Explore questions')}</button><button onClick={() => navigate('Lab')}>{t('Run an experiment')}</button><p className="inspector-note">{t('Content stays local until you request model analysis.')}</p></div></section>}
  </div>;
}
createRoot(document.getElementById('root')!).render(<StrictMode><LanguageProvider><App /></LanguageProvider></StrictMode>);
