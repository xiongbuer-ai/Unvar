import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { translate, type Locale } from './locales';
export type { Locale } from './locales';
const Context = createContext({ locale: 'zh-CN' as Locale, setLocale: (() => {}) as (value: Locale) => void, t: (key: string, values?: Record<string, string | number>) => translate('zh-CN', key, values) });
export function LanguageProvider({ children }: { children: ReactNode }) {
  const [locale, updateLocale] = useState<Locale>('zh-CN');
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const saving = useRef(Promise.resolve());
  useEffect(() => {
    let active = true;
    void window.unvar.getInterfacePreferences().then(async saved => {
      let initial: Locale = saved?.locale ?? 'zh-CN';
      if (!saved) {
        // Import the pre-workspace preference once; the folder is authoritative thereafter.
        try { if (localStorage.getItem('unvar.locale') === 'en') initial = 'en'; } catch { /* Legacy storage may be unavailable. */ }
        await window.unvar.saveInterfacePreferences({ locale: initial });
      }
      if (active) { updateLocale(initial); setReady(true); }
    }).catch(() => { if (active) { setFailed(true); setReady(true); } });
    return () => { active = false; };
  }, []);
  function setLocale(value: Locale) {
    saving.current = saving.current.catch(() => {}).then(async () => {
      try { await window.unvar.saveInterfacePreferences({ locale: value }); updateLocale(value); setFailed(false); }
      catch { setFailed(true); }
    });
  }
  useEffect(() => { document.documentElement.lang = locale; }, [locale]);
  if (!ready) return null;
  return <Context.Provider value={{ locale, setLocale, t: (key, values) => translate(locale, key, values) }}>
    {failed && <div role="alert" className="error">{translate(locale, 'Unable to save interface preferences. Check workspace folder permissions.')}</div>}
    {children}
  </Context.Provider>;
}
export function useI18n() { return useContext(Context); }
