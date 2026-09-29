import { describe, expect, it, vi } from 'vitest';
import { assertAppInfoRequest } from '../packages/shared/src/index';
import { createAppInfoHandler, type TrustedRenderer } from '../apps/desktop/src/main/app-info';

describe('app-info request contract', () => {
  it('accepts a request with no arguments', () => {
    expect(() => assertAppInfoRequest([])).not.toThrow();
  });
  it.each([[undefined], [null], [{}], ['unvar'], [1], [true], [[], {}]])('rejects payload %j', (...args) => {
    expect(() => assertAppInfoRequest(args)).toThrow('no arguments expected');
  });
});

describe('app-info handler', () => {
  const url = 'file:///unvar/out/renderer/index.html';
  function fixture() {
    const sender = {};
    const mainFrame = { url };
    let trusted: TrustedRenderer | null = { sender, mainFrame, url };
    const readInfo = vi.fn(() => ({ name: 'Unvar', version: '0.0.0' }));
    const handler = createAppInfoHandler(() => trusted, readInfo);
    return { sender, mainFrame, readInfo, handler, clearWindow: () => { trusted = null; } };
  }

  it('returns app information only to the trusted main frame', () => {
    const { handler, sender, mainFrame, readInfo } = fixture();
    expect(handler({ sender, senderFrame: mainFrame })).toEqual({ name: 'Unvar', version: '0.0.0' });
    expect(readInfo).toHaveBeenCalledOnce();
  });
  it('rejects another webContents even at the same URL', () => {
    const { handler, mainFrame, readInfo } = fixture();
    expect(() => handler({ sender: {}, senderFrame: mainFrame })).toThrow('Untrusted');
    expect(readInfo).not.toHaveBeenCalled();
  });
  it('rejects a child frame even at the same URL', () => {
    const { handler, sender } = fixture();
    expect(() => handler({ sender, senderFrame: { url } })).toThrow('Untrusted');
  });
  it.each(['https://example.com/', `${url}.evil`, `${url}?unexpected=1`])('rejects navigation to %s', (untrustedUrl) => {
    const { handler, sender, mainFrame, readInfo } = fixture();
    mainFrame.url = untrustedUrl;
    expect(() => handler({ sender, senderFrame: mainFrame })).toThrow('Untrusted');
    expect(readInfo).not.toHaveBeenCalled();
  });
  it('rejects a missing sender frame', () => {
    const { handler, sender } = fixture();
    expect(() => handler({ sender, senderFrame: null })).toThrow('Untrusted');
  });
  it('rejects calls after the trusted window closes', () => {
    const { handler, sender, mainFrame, clearWindow } = fixture();
    clearWindow();
    expect(() => handler({ sender, senderFrame: mainFrame })).toThrow('Untrusted');
  });
  it('validates arguments before accessing app information', () => {
    const { handler, sender, mainFrame, readInfo } = fixture();
    expect(() => handler({ sender, senderFrame: mainFrame }, {})).toThrow('Invalid');
    expect(readInfo).not.toHaveBeenCalled();
  });
});
