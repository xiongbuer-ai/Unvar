import { JevSettingsPanel } from './JevSettings';
import { WorkspaceFolderSettings } from './WorkspaceFolderSettings';
import { useI18n, type Locale } from './i18n';
import { useEffect, useRef, useState } from 'react';
import { providerInputSchema, type ProviderInput, type ProviderSettings } from '@unvar/shared';

const defaults: ProviderInput = { providerType: 'openai-compatible', displayName: '', baseUrl: 'https://api.openai.com/v1', model: '', enabled: true };

export function Settings() {
  const { t, locale, setLocale } = useI18n();
  const [providers, setProviders] = useState<ProviderSettings[]>([]);
  const [input, setInput] = useState<ProviderInput>(defaults);
  const [focus, setFocus] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const secret = useRef<HTMLInputElement>(null);
  const refresh = async () => setProviders(await window.unvar.listProviders());
  useEffect(() => {
    void Promise.all([refresh(), window.unvar.getResearchSettings().then((value) => setFocus(value.researchFocus))]).catch(() => setError('Unable to load settings. Check access to the system credential store.'));
  }, []);
  async function run(operation: () => Promise<void>) {
    setBusy(true); setError(''); setMessage('');
    try { await operation(); setMessage('Settings saved.'); }
    catch { setError('Unable to complete this operation. Check system credential access and retry.'); }
    finally { setBusy(false); }
  }
  const selected = providers.find((provider) => provider.id === input.id);
  return <div className="settings-grid">
    <WorkspaceFolderSettings />
    <JevSettingsPanel />
    <section className="panel"><h2>{t('Interface preferences')}</h2><p className="muted">{t('Choose your display language. Research content is never translated automatically.')}</p><label>{t('Language')}<select aria-label={t('Language')} value={locale} onChange={event => setLocale(event.target.value as Locale)}><option value="zh-CN">中文</option><option value="en">English</option></select></label></section>
    <form className="panel" onSubmit={(event) => { event.preventDefault(); void run(() => window.unvar.saveResearchSettings({ researchFocus: focus })); }}>
      <h2>{t("Research context")}</h2><p className="muted">{t("Your research direction will inform relevance scoring in Radar.")}</p>
      <label>{t("Research focus")}<textarea aria-label={t("Research focus")} rows={4} value={focus} maxLength={4000} onChange={(event) => setFocus(event.target.value)} /></label>
      <button disabled={busy} type="submit">{t("Save research context")}</button>
    </form>
    <section className="panel provider-settings"><h2>{t("Model providers")}</h2><p className="muted">{t("Configure a model for source analysis. Connection tests make a small request to that provider.")}</p>
      <div className="provider-switcher" role="group" aria-label={t("Model providers")}>{providers.map((provider) => <button key={provider.id} aria-pressed={input.id === provider.id} disabled={busy} onClick={() => {
        if (secret.current) secret.current.value = '';
        setInput({ id: provider.id, providerType: provider.providerType, displayName: provider.displayName, baseUrl: provider.baseUrl, model: provider.model, enabled: provider.enabled });
      }}>{provider.displayName}</button>)}<button className="new-provider" aria-pressed={!input.id} disabled={busy} onClick={() => { setInput(defaults); if (secret.current) secret.current.value = ''; }}>{t("New provider")}</button></div>
      <form onSubmit={(event) => {
        event.preventDefault(); const result = providerInputSchema.safeParse(input);
        if (!result.success) { setError('Check the required fields and their limits.'); return; }
        void run(async () => { const saved = await window.unvar.saveProvider(result.data); setInput({ ...result.data, id: saved.id }); await refresh(); });
      }}><fieldset disabled={busy}>
        <div className="provider-fields">
        <label>{t("Provider type")}<select aria-label={t("Provider type")} value={input.providerType} onChange={(event) => {
          const providerType = event.target.value as ProviderInput['providerType'];
          setInput({ ...input, providerType, baseUrl: providerType === 'anthropic' ? 'https://api.anthropic.com/v1' : providerType === 'deepseek' ? 'https://api.deepseek.com' : 'https://api.openai.com/v1', model: providerType === 'deepseek' ? 'deepseek-flash' : '' });
        }}><option value="openai-compatible">{t("OpenAI-compatible")}</option><option value="anthropic">{t("Anthropic")}</option><option value="deepseek">{t("DeepSeek")}</option></select></label>
        <label>{t("Display name")}<input aria-label={t("Display name")} required value={input.displayName} maxLength={80} onChange={(event) => setInput({ ...input, displayName: event.target.value })} /></label>
        <label className="provider-url">{t("Base URL")}<input aria-label={t("Base URL")} required type="url" value={input.baseUrl} onChange={(event) => setInput({ ...input, baseUrl: event.target.value })} /></label>
        <label>{t("Model")}<input aria-label={t("Model")} required value={input.model} maxLength={160} onChange={(event) => setInput({ ...input, model: event.target.value })} /></label>
        </div>
        <div className="provider-save-row"><label className="checkbox"><input type="checkbox" checked={input.enabled} onChange={(event) => setInput({ ...input, enabled: event.target.checked })} />{t("Enabled")}</label>
        <button type="submit">{t("Save provider")}</button></div>
      </fieldset></form>
      {input.id && <form className="credential-form" onSubmit={(event) => {
        event.preventDefault(); const value = secret.current?.value ?? ''; if (!value) return;
        if (secret.current) secret.current.value = '';
        void run(async () => { await window.unvar.setCredential({ providerId: input.id!, secret: value }); await refresh(); });
      }}><fieldset disabled={busy}>
        <p className="credential-status">{t("Credential:")}<strong>{t(selected?.configured ? 'Configured' : 'Not configured')}</strong></p>
        <label>{t("New API key")}<input aria-label={t("New API key")} ref={secret} type="password" autoComplete="off" maxLength={8192} required /></label>
        <p className="muted">{t("Stored in your system credential store. Saved keys are never displayed.")}</p>
        <div className="actions"><button type="submit">{t(selected?.configured ? 'Replace key' : 'Save key')}</button><button type="button" disabled={!selected?.configured} onClick={() => void run(async () => { await window.unvar.deleteCredential(input.id!); await refresh(); })}>{t("Delete key")}</button><button type="button" className="test-connection" disabled={busy || !selected?.configured} onClick={() => {
        setBusy(true); setError(''); setMessage('');
        void window.unvar.testProvider(input.id!).then((result) => { if (result.ok) setMessage(result.message); else setError(result.message); }).catch(() => setError('Connection test failed.')).finally(() => setBusy(false));
      }}>{t("Test connection")}</button></div>
      </fieldset></form>}

    </section>
    {error && <p role="alert" className="error">{t(error)}</p>}{message && <p role="status">{t(message)}</p>}
  </div>;
}
