export const APP_INFO_CHANNEL = 'unvar:app-info';

export interface AppInfo {
  name: string;
  version: string;
}

import type { WorkspaceAPI } from './contracts';
export * from './contracts';
export * from './radar';
export * from './lab';

import type { WorkspaceFolderAPI } from './workspace-folder';
export * from './workspace-folder';

export interface UnvarAPI extends WorkspaceAPI, WorkspaceFolderAPI, JevAPI {
  getAppInfo(): Promise<AppInfo>;
}

/** This read-only endpoint accepts no arguments, including explicit undefined. */
export function assertAppInfoRequest(args: unknown[]): asserts args is [] {
  if (args.length !== 0) {
    throw new Error('Invalid app-info request: no arguments expected.');
  }
}

export * from './finding';

export * from './writing';

export * from './decisions';

export * from './pi';

import type { JevAPI } from './jev';
export * from './jev';
