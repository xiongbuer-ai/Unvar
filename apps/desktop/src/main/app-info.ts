import { assertAppInfoRequest, type AppInfo } from '@unvar/shared';

interface FrameIdentity { url: string }

export interface Invocation {
  sender: object;
  senderFrame: FrameIdentity | null;
}

export interface TrustedRenderer {
  sender: object;
  mainFrame: FrameIdentity;
  url: string;
}

export function assertTrustedRenderer(event: Invocation, trusted: TrustedRenderer | null): void {
  if (!trusted || event.sender !== trusted.sender || event.senderFrame !== trusted.mainFrame || event.senderFrame?.url !== trusted.url) {
    throw new Error('Untrusted app-info sender.');
  }
}

export function createAppInfoHandler(
  getTrustedRenderer: () => TrustedRenderer | null,
  getAppInfo: () => AppInfo,
) {
  return (event: Invocation, ...args: unknown[]): AppInfo => {
    assertTrustedRenderer(event, getTrustedRenderer());
    assertAppInfoRequest(args);
    return getAppInfo();
  };
}
