import { describe, expect, it } from 'vitest';
import { translate } from '../apps/desktop/src/renderer/src/locales';
import { en } from '../apps/desktop/src/renderer/src/locales/en';
import { zhCN } from '../apps/desktop/src/renderer/src/locales/zh-CN';

describe('interface language packs', () => {
  it('keeps both catalogs complete with matching interpolation values', () => {
    expect(Object.keys(zhCN).sort()).toEqual(Object.keys(en).sort());
    for (const key of Object.keys(en)) {
      expect(zhCN[key].trim(), key).not.toBe('');
      expect(zhCN[key].match(/\{\w+\}/g) ?? [], key).toEqual(en[key].match(/\{\w+\}/g) ?? []);
    }
  });
  it('localizes counts and safe provider messages without changing model identifiers', () => {
    expect(translate('zh-CN', 'inboxCount', { count: 3 })).toContain('3');
    expect(translate('en', 'Connected to deepseek-flash.')).toBe('Connected to deepseek-flash.');
    expect(translate('zh-CN', 'Connected to deepseek-flash.')).toContain('deepseek-flash');
    expect(translate('zh-CN', 'Source returned HTTP 403.')).toBe('来源返回 HTTP 403。');
    expect(translate('zh-CN', 'ready → running')).toBe('就绪 → 进行中');
  });
  it('preserves unknown messages and does not lose missing placeholder values', () => {
    expect(translate('zh-CN', 'Unknown diagnostic')).toBe('Unknown diagnostic');
    expect(translate('en', 'inboxCount')).toContain('{count}');
  });
});
