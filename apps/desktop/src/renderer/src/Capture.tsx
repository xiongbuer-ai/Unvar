import { useI18n } from './i18n';
import { useState } from 'react';
import { signalInputSchema, signalKinds, type Signal, type SignalInput } from '@unvar/shared';

export const kindLabels = { url: 'URL', note: 'Note', question: 'Question', judgment: 'Judgment', experiment_idea: 'Experiment idea', code: 'Code snippet' };

export function Capture({ signal, onSave, onCancel }: { signal?: Signal; onSave: (input: SignalInput) => Promise<void>; onCancel: () => void }) {
  const { t } = useI18n();
  const [kind, setKind] = useState<SignalInput['kind']>(signal?.kind ?? 'note');
  const [title, setTitle] = useState(signal?.title ?? '');
  const [text, setText] = useState(signal?.text ?? '');
  const [url, setUrl] = useState(signal?.url ?? '');
  const [tags, setTags] = useState(signal?.tags.join(', ') ?? '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return <form className="panel capture" onSubmit={(event) => {
    event.preventDefault();
    const result = signalInputSchema.safeParse({ id: signal?.id, kind, title, text, url, tags: tags.split(',').map((tag) => tag.trim()).filter(Boolean) });
    if (!result.success) { setError('Check the required fields and their limits.'); return; }
    setBusy(true); setError('');
    void onSave(result.data).catch(() => setError('Unable to save. Your input is still here; please try again.')).finally(() => setBusy(false));
  }}>
    <h2>{t(signal ? 'Edit capture' : 'Quick capture')}</h2>
    <fieldset disabled={busy}>
      <div className="form-row"><label>{t("Kind")}<select aria-label={t("Kind")} value={kind} onChange={(event) => setKind(event.target.value as SignalInput['kind'])}>{signalKinds.map((value) => <option key={value} value={value}>{t(kindLabels[value])}</option>)}</select></label>
      <label>{t("Title")}<input aria-label={t("Title")} value={title} maxLength={240} onChange={(event) => setTitle(event.target.value)} placeholder={t("Optional title")} /></label></div>
      {kind === 'url' && <label>{t("Source URL")}<input aria-label={t("Source URL")} type="url" required value={url} maxLength={4096} onChange={(event) => setUrl(event.target.value)} placeholder={t("https://…")} /></label>}
      <label>{t(kind === 'code' ? 'Code' : 'Content')}<textarea aria-label={t(kind === "code" ? "Code" : "Content")} required={kind !== 'url'} value={text} maxLength={100000} rows={5} onChange={(event) => setText(event.target.value)} placeholder={t("Save an observation, question, or idea…")} /></label>
      <label>{t("Tags")}<input aria-label={t("Tags")} value={tags} onChange={(event) => setTags(event.target.value)} placeholder={t("Comma-separated tags")} /></label>
      {error && <p role="alert" className="error">{t(error)}</p>}
      <div className="actions"><button className="primary" type="submit">{t(busy ? 'Saving…' : 'Save capture')}</button><button type="button" onClick={onCancel}>{t("Cancel")}</button></div>
    </fieldset>
  </form>;
}
