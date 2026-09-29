import { en } from './en';
import { zhCN } from './zh-CN';
export type Locale = 'zh-CN' | 'en';
export function translate(locale: Locale, key: string, values: Record<string, string | number> = {}): string {
  const connected = /^Connected to ([^{}]+)\.$/.exec(key);
  if (connected) return translate(locale, 'Connected to {model}.', { model: connected[1] });
  const http = /^(Source|Provider) returned HTTP (\d{3})\.(.*)$/.exec(key);
  if (http) return translate(locale, `${http[1]} returned HTTP {status}.${http[3]}`, { status: http[2] });
  const transition = /^(idea|ready|running|analyzing|done|archived) → (idea|ready|running|analyzing|done|archived)$/.exec(key);
  if (transition) return `${translate(locale, 'status.' + transition[1])} → ${translate(locale, 'status.' + transition[2])}`;
  const messages: Record<string, string> = locale === 'zh-CN' ? zhCN : en;
  return (messages[key] ?? key).replace(/\{(\w+)\}/g, (match, name: string) => String(values[name] ?? match));
}
