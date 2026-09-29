import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { useI18n } from './i18n';

/** Native popover escapes sidebar clipping and provides light dismiss / Escape. */
export function SettingsMenu({ icon, onOpenSettings }: { icon: ReactNode; onOpenSettings: () => void }) {
  const { t, locale, setLocale } = useI18n();
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const reposition = () => { if (menu.current?.matches(':popover-open')) position(); };
    window.addEventListener('resize', reposition);
    return () => window.removeEventListener('resize', reposition);
  }, []);
  function items() { return Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]') ?? []); }
  function close() { menu.current?.hidePopover(); trigger.current?.focus(); }
  function position() {
    if (!trigger.current || !menu.current) return;
    const anchor = trigger.current.getBoundingClientRect();
    const panel = menu.current;
    panel.style.left = `${Math.max(8, Math.min(anchor.left, window.innerWidth - panel.offsetWidth - 8))}px`;
    panel.style.top = `${Math.max(8, anchor.top >= panel.offsetHeight + 16 ? anchor.top - panel.offsetHeight - 8 : Math.min(anchor.bottom + 8, window.innerHeight - panel.offsetHeight - 8))}px`;
  }
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const buttons = items();
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    let next: number;
    if (event.key === 'ArrowDown') next = (index + 1) % buttons.length;
    else if (event.key === 'ArrowUp') next = (index - 1 + buttons.length) % buttons.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = buttons.length - 1;
    else if (event.key === 'Tab') { close(); return; }
    else return;
    event.preventDefault(); buttons[next]?.focus();
  }
  return <>
    <button ref={trigger} type="button" className="settings-link" popoverTarget={id} aria-haspopup="menu" aria-label={t('Settings')}
      onKeyDown={event => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); menu.current?.showPopover(); } }}>
      {icon}<span className="nav-label">{t('Settings')}</span>
    </button>
    <div ref={menu} id={id} popover="auto" role="menu" aria-label={t('Settings')} className="settings-popover" onKeyDown={onKeyDown}
      onToggle={event => {
        const open = event.newState === 'open';
        trigger.current?.setAttribute('aria-expanded', String(open));
        if (open) { position(); items()[0]?.focus(); }
      }}>
      <button type="button" role="menuitem" onClick={() => { close(); onOpenSettings(); }}>{icon}<span>{t('Open settings')}</span><span className="settings-menu-arrow" aria-hidden="true">↗</span></button>
      <div className="settings-menu-divider" role="separator" />
      <div className="settings-menu-label" id={`${id}-language`}>{t('Interface language')}</div>
      <div role="group" aria-labelledby={`${id}-language`}>
        {(['zh-CN', 'en'] as const).map(value => <button key={value} type="button" role="menuitemradio" aria-checked={locale === value} onClick={() => { setLocale(value); close(); }}><span>{value === 'zh-CN' ? '简体中文' : 'English'}</span><span className="settings-menu-check" aria-hidden="true">{locale === value ? '✓' : ''}</span></button>)}
      </div>
      <div className="settings-menu-footer">{t('Local-first workspace')}</div>
    </div>
  </>;
}
