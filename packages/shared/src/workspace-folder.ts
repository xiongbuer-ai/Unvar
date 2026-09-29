import { z } from 'zod';

export const workspaceFolderChannels = {
  getWorkspaceFolder: 'unvar:workspace-folder:get',
  chooseWorkspaceFolder: 'unvar:workspace-folder:choose',
  revealWorkspaceFolder: 'unvar:workspace-folder:reveal',
  getInterfacePreferences: 'unvar:workspace-folder:preferences',
  saveInterfacePreferences: 'unvar:workspace-folder:save-preferences',
} as const;
export const interfacePreferencesSchema = z.object({ locale: z.enum(['zh-CN', 'en']) }).strict();
export type InterfacePreferences = z.infer<typeof interfacePreferencesSchema>;
export interface WorkspaceFolderAPI {
  getWorkspaceFolder(): Promise<{ path: string }>;
  chooseWorkspaceFolder(mode: 'copy' | 'open'): Promise<{ canceled: boolean }>;
  revealWorkspaceFolder(): Promise<void>;
  getInterfacePreferences(): Promise<InterfacePreferences | null>;
  saveInterfacePreferences(input: InterfacePreferences): Promise<void>;
}
