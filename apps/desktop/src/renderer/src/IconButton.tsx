import { useEffect, useId, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes } from 'react';
import { createPortal } from 'react-dom';

/** Tooltip lives outside scrolling panes so it remains visible in a collapsed sidebar. */
type TooltipButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { tooltip?: string };
export function TooltipButton({ tooltip, children, onClick, className, ...props }: TooltipButtonProps) {
  const id = useId();
  const button = useRef<HTMLButtonElement>(null);
  const bubble = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  function cancelTimer() { clearTimeout(timer.current); }
  function hide() { cancelTimer(); setVisible(false); }
  function schedule(show: boolean) { cancelTimer(); timer.current = setTimeout(() => setVisible(show), show ? 300 : 100); }
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    if (!visible) return;
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setVisible(false); };
    window.addEventListener('keydown', escape);
    window.addEventListener('resize', hide);
    window.addEventListener('scroll', hide, true);
    return () => { window.removeEventListener('keydown', escape); window.removeEventListener('resize', hide); window.removeEventListener('scroll', hide, true); };
  }, [visible]);
  useLayoutEffect(() => {
    if (!visible || !button.current || !bubble.current) return;
    const anchor = button.current.getBoundingClientRect();
    const bounds = bubble.current.getBoundingClientRect();
    setPosition({ left: Math.max(8, Math.min(anchor.left + (anchor.width - bounds.width) / 2, window.innerWidth - bounds.width - 8)), top: anchor.bottom + bounds.height + 8 <= window.innerHeight ? anchor.bottom + 8 : Math.max(8, anchor.top - bounds.height - 8) });
  }, [visible, tooltip]);
  return <>
    <button {...props} ref={button} type="button" className={className} aria-describedby={visible && tooltip ? id : undefined}
      onMouseEnter={() => { if (tooltip) schedule(true); }} onMouseLeave={() => schedule(false)}
      onFocus={() => { cancelTimer(); if (tooltip) setVisible(true); }} onBlur={hide}
      onClick={event => { hide(); onClick?.(event); }}>{children}</button>
    {visible && tooltip && createPortal(<div id={id} ref={bubble} role="tooltip" className="icon-tooltip" style={position} onMouseEnter={cancelTimer} onMouseLeave={hide}>{tooltip}</div>, document.body)}
  </>;
}

export function IconButton(props: TooltipButtonProps) { return <TooltipButton {...props} className="icon-button" />; }
