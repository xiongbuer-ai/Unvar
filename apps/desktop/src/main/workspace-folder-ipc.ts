import { dialog, ipcMain, shell, type BrowserWindow } from 'electron';
import { z } from 'zod';
import { interfacePreferencesSchema, workspaceFolderChannels } from '@unvar/shared';
import { validatedHandler } from './validated-ipc';
import type { TrustedRenderer } from './app-info';
import { assertCopyDestination, validateWorkspace, type WorkspaceFolder } from './workspace-folder';

export function registerWorkspaceFolderIPC(folder: WorkspaceFolder, trusted: () => TrustedRenderer | null, getWindow: () => BrowserWindow | null, restart: (path: string, mode: 'copy' | 'open') => void) {
  const register = <T>(channel: string, schema: z.ZodType<T>, operation: (input: T) => unknown) => ipcMain.handle(channel, validatedHandler(schema, trusted, operation));
  register(workspaceFolderChannels.getWorkspaceFolder, z.tuple([]), () => ({ path: folder.path }));
  register(workspaceFolderChannels.getInterfacePreferences, z.tuple([]), () => folder.preferences());
  register(workspaceFolderChannels.saveInterfacePreferences, z.tuple([interfacePreferencesSchema]), ([input]) => folder.savePreferences(input));
  register(workspaceFolderChannels.revealWorkspaceFolder, z.tuple([]), async () => { if (await shell.openPath(folder.path)) throw new Error('Unable to open folder.'); });
  let choosing = false;
  register(workspaceFolderChannels.chooseWorkspaceFolder, z.tuple([z.enum(['copy', 'open'])]), async ([mode]) => {
    const window = getWindow(); if (!window || choosing) return { canceled: true };
    choosing = true;
    try {
      const zh = folder.preferences()?.locale !== 'en';
      const result = await dialog.showOpenDialog(window, { title: zh ? (mode === 'copy' ? '选择空文件夹以复制当前工作区' : '打开已有 Unvar 工作区') : (mode === 'copy' ? 'Choose an empty folder for a workspace copy' : 'Open an existing Unvar workspace'), properties: ['openDirectory', 'createDirectory'] });
      if (result.canceled || !result.filePaths[0]) return { canceled: true };
      const path = result.filePaths[0];
      try { if (mode === 'copy') assertCopyDestination(folder.path, path); else validateWorkspace(path); }
      catch {
        await dialog.showMessageBox(window, { type: 'error', message: zh ? (mode === 'copy' ? '请选择独立的空文件夹，不能位于当前工作区内。' : '这不是完整的 Unvar 工作区。请等待同步完成后重试。') : (mode === 'copy' ? 'Choose an empty folder outside the current workspace.' : 'This is not a complete Unvar workspace. Wait for sync to finish and retry.') });
        return { canceled: true };
      }
      const confirmation = await dialog.showMessageBox(window, { type: 'question', buttons: zh ? ['取消', '切换并重启'] : ['Cancel', 'Switch and restart'], defaultId: 0, cancelId: 0,
        message: zh ? '切换工作区并重启 Unvar？' : 'Switch workspace and restart Unvar?',
        detail: `${path}\n\n${zh ? '请先保存尚未提交的表单。后台任务将停止，已保存的内容会保留；原工作区不会删除。同步前请完全退出应用，同一时间只在一台设备编辑。' : 'Save unfinished forms first. Background tasks will stop; saved content and the original workspace are retained. Quit before syncing and edit on only one device at a time.'}` });
      if (confirmation.response !== 1) return { canceled: true };
      setImmediate(() => restart(path, mode));
      return { canceled: false };
    } finally { choosing = false; }
  });
}
