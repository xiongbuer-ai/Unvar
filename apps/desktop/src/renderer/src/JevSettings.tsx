import { useEffect, useRef, useState } from 'react';
import type { JevPublicSettings } from '@unvar/shared';
import { useI18n } from './i18n';
export function JevSettingsPanel() {
  const { t }=useI18n();
  const [settings,setSettings]=useState<JevPublicSettings>({enabled:false,model:'typesafe/jev-1.13',configured:false});
  const [busy,setBusy]=useState(false);const [message,setMessage]=useState('');const [error,setError]=useState('');const secret=useRef<HTMLInputElement>(null);
  const refresh=async()=>{if(typeof window.unvar.getJevSettings!=='function')throw new Error('Restart Unvar to load the Jev settings bridge.');setSettings(await window.unvar.getJevSettings());};
  useEffect(()=>{void refresh().catch(()=>setError('Restart Unvar to load the Jev settings bridge.'));},[]);
  async function run(action:()=>Promise<string>) {setBusy(true);setError('');setMessage('');try{if(typeof window.unvar.setJevCredential!=='function')throw new Error('Restart Unvar to load the Jev settings bridge.');setMessage(await action());await refresh();}catch(error){const text=error instanceof Error?error.message:'';const known=['Unable to save Jev credential.','Unable to delete Jev credential.','Jev connection test is already running.','Restart Unvar to load the Jev settings bridge.','Jev key is not configured.','Jev authentication failed.','OpenRouter balance is insufficient.','Jev rate limit reached.','Jev request failed or returned invalid scores.'];setError(known.find(item=>text.endsWith(item))??'Unable to update Jev settings.');}finally{setBusy(false);}}
  return <section className="panel"><h2>{t('Jev / OpenRouter')}</h2><p className="muted">{t('Independent decision model. Your OpenRouter key is stored in the system credential store.')}</p><p className="muted">{t('When enabled, Radar uses Jev for question scoring. Failures are labeled as Rules fallback. Connection tests make a paid request.')}</p>
    <form onSubmit={event=>{event.preventDefault();void run(async()=>{await window.unvar.saveJevSettings({enabled:settings.enabled,model:settings.model});return 'Settings saved.';});}}><fieldset disabled={busy}>
      <label>{t('Jev model')}<input aria-label={t('Jev model')} required pattern="typesafe/jev-[a-zA-Z0-9.\-]+" value={settings.model} maxLength={120} onChange={event=>setSettings({...settings,model:event.target.value})}/></label>
      <p><code>https://openrouter.ai/api/v1/systemone</code></p>
      <label className="checkbox"><input type="checkbox" checked={settings.enabled} onChange={event=>setSettings({...settings,enabled:event.target.checked})}/>{t('Enable Jev scoring')}</label><button type="submit">{t('Save Jev settings')}</button>
    </fieldset></form>
    <form onSubmit={event=>{event.preventDefault();const value=secret.current?.value??'';if(secret.current)secret.current.value='';if(value)void run(async()=>{await window.unvar.setJevCredential(value);return 'Jev key saved.';});}}><fieldset disabled={busy}>
      <p role="status">{t(settings.configured?'Jev key configured':'Jev key not configured')}</p><label>{t('OpenRouter API Key')}<input ref={secret} aria-label={t('OpenRouter API Key')} type="password" autoComplete="off" maxLength={4096} required/></label><button type="submit">{t('Save or replace Jev key')}</button>
      <button type="button" disabled={!settings.configured} onClick={()=>void run(async()=>{await window.unvar.deleteJevCredential();return 'Jev key deleted.';})}>{t('Delete Jev key')}</button>
      <button type="button" disabled={!settings.configured} onClick={()=>void run(async()=>{await window.unvar.saveJevSettings({enabled:settings.enabled,model:settings.model});const result=await window.unvar.testJevConnection();return `${t('Jev connection verified')}: ${result.model} · ${result.durationMs} ms`;})}>{t('Test Jev connection')}</button>
    </fieldset></form>{busy&&<p role="status">{t('Working…')}</p>}{error&&<p className="error" role="alert">{t(error)}</p>}{message&&<p role="status">{t(message)}</p>}
  </section>;
}
