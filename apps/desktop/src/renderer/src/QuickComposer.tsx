import { useState } from 'react';
import { signalInputSchema, signalKinds, type SignalInput } from '@unvar/shared';
import { kindLabels } from './Capture';
import { useI18n } from './i18n';
export function QuickComposer({ onSave }: { onSave: (input: SignalInput) => Promise<void> }) {
  const { t } = useI18n();
  const [kind, setKind] = useState<SignalInput['kind']>('note');
  const [content, setContent] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  return <form className="quick-composer" onSubmit={event => {
    event.preventDefault(); setMessage('');
    const result = signalInputSchema.safeParse({ kind, title: '', text: kind === 'url' ? '' : content, url: kind === 'url' ? content.trim() : '', tags: [] });
    if (!result.success) { setMessage('Check the required fields and their limits.'); return; }
    setBusy(true);
    void onSave(result.data).then(() => { setContent(''); setMessage('Capture saved.'); }).catch(() => setMessage('Unable to save. Your input is still here; please try again.')).finally(() => setBusy(false));
  }}>
    <textarea aria-label={t('Quick capture')} placeholder={t('Capture an observation worth testing…')} rows={3} maxLength={100000} value={content} disabled={busy} onChange={event => setContent(event.target.value)} />
    <div className="composer-controls"><label className="composer-kind"><span className="sr-only">{t('Kind')}</span><select value={kind} disabled={busy} onChange={event => setKind(event.target.value as SignalInput['kind'])}>{signalKinds.map(value => <option key={value} value={value}>{t(kindLabels[value])}</option>)}</select></label><span className="muted">{t('Saved locally')}</span><button className="primary" disabled={busy || !content.trim()} type="submit">{t(busy ? 'Saving…' : 'Capture')}</button></div>
    {message && <p role="status" className="composer-message">{t(message)}</p>}
  </form>;
}
