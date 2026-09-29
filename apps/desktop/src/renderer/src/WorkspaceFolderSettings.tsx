import { useEffect, useState } from 'react';
import { useI18n } from './i18n';

export function WorkspaceFolderSettings() {
  const { t } = useI18n();
  const [path, setPath] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  useEffect(() => { void window.unvar.getWorkspaceFolder().then(value => setPath(value.path)).catch(() => setError(true)); }, []);
  async function choose(mode: 'copy' | 'open') {
    setBusy(true); setError(false);
    try { await window.unvar.chooseWorkspaceFolder(mode); }
    catch { setError(true); }
    finally { setBusy(false); }
  }
  return <section className="panel">
    <h2>{t('Workspace folder')}</h2>
    <p className="muted">{t('Your content, model settings, preferences, materials and backups stay together in this folder. API keys stay in the system credential store and are not synced.')}</p>
    <p className="workspace-folder-path">{path || t('Loading…')}</p>
    <div className="actions">
      <button disabled={busy || !path} onClick={() => { void window.unvar.revealWorkspaceFolder().catch(() => setError(true)); }}>{t('Show in folder')}</button>
      <button disabled={busy} onClick={() => void choose('copy')}>{t('Copy workspace to…')}</button>
      <button disabled={busy} onClick={() => void choose('open')}>{t('Open workspace…')}</button>
    </div>
    <p className="muted">{t('Switching restarts Unvar. Save unfinished forms first. The original folder is kept.')}</p>
    <p className="muted">{t('Quit Unvar before Git or cloud sync. Wait for sync to finish before opening on another device. Edit on one device at a time; database conflicts cannot be merged automatically.')}</p>
    {error && <p role="alert" className="error">{t('Unable to access the workspace folder. Check permissions and available disk space.')}</p>}
  </section>;
}
