import { registerJevIPC } from './jev-ipc';
import { app, BrowserWindow, ipcMain, dialog, nativeImage } from 'electron';
import appIconPath from './assets/app-icon.png?asset';
import { isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { APP_INFO_CHANNEL } from '@unvar/shared';
import { createAppInfoHandler } from './app-info';
import { mkdir, cp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { WorkspaceFolder, initializeWorkspace, copyWorkspace, atomicJSON, validateWorkspace } from './workspace-folder';
import { registerWorkspaceFolderIPC } from './workspace-folder-ipc';
import { openStore, type Store } from '@unvar/db';
import { SystemCredentialStore } from './credentials';
import { WorkspaceService } from './workspace-service';
import { registerWorkspaceIPC } from './ipc';
import { registerPiIPC } from './pi-ipc';
import { registerDecisionIPC } from './decision-ipc';
import { registerWritingIPC } from './writing-ipc';
import { registerFindingIPC } from './finding-ipc';
import { registerLabIPC } from './lab-ipc';
import { registerRadarIPC } from './radar-ipc';
import type { RadarWorkflow } from '@unvar/workflows';

let mainWindow: BrowserWindow | null = null;
let rendererUrl = '';
let store: Store | undefined;
let radar: RadarWorkflow | undefined;
let quitting = false;
let canQuit = false;
let jevScoring:ReturnType<typeof registerJevIPC>|undefined;
let piWorkflow: ReturnType<typeof registerPiIPC> | undefined;
let writingWorkflow: ReturnType<typeof registerWritingIPC> | undefined;
let findingWorkflow: ReturnType<typeof registerFindingIPC> | undefined;

// An explicit absolute profile isolates installer verification and troubleshooting.
const profile = app.commandLine.getSwitchValue('unvar-profile');
if (profile) {
  if (!isAbsolute(profile)) throw new Error('Unvar profile must be an absolute path.');
  app.setPath('userData', profile);
}
// Development environment override stays unavailable to packaged applications.
if (!profile && !app.isPackaged && process.env.UNVAR_USER_DATA) app.setPath('userData', process.env.UNVAR_USER_DATA);

app.setName('Unvar');
// A second process must not write to the same selected database.
const primaryInstance = app.requestSingleInstanceLock();
if (!primaryInstance) app.quit();
app.on('second-instance', () => { if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); } });
let folder: WorkspaceFolder;
let switching: { path: string; mode: 'copy' | 'open' } | undefined;

async function createWindow(): Promise<void> {
  const window = new BrowserWindow({
    title: 'Unvar',
    icon: appIconPath,
    width: 1280,
    height: 820,
    minWidth: 560,
    minHeight: 480,
    backgroundColor: '#ffffff',
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 20, y: 28 } } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
    },
  });
  mainWindow = window;
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.on('will-frame-navigate', (event) => event.preventDefault());
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  window.webContents.session.setPermissionCheckHandler(() => false);
  window.on('closed', () => { if (mainWindow === window) mainWindow = null; });

  const developmentUrl = !app.isPackaged ? process.env.ELECTRON_RENDERER_URL : undefined;
  rendererUrl = developmentUrl
    ? new URL(developmentUrl).href
    : pathToFileURL(join(__dirname, '../renderer/index.html')).href;
  await window.loadURL(rendererUrl);
}

function failStartup(error: unknown): void {
  console.error('Unvar failed to start:', error);
  dialog.showErrorBox('Unvar — 工作区无法打开 / Workspace unavailable', '请确认工作区已完成同步且可读写。原数据未删除；可检查应用数据目录中的 workspace-location.json。\nCheck the selected folder and workspace-location.json in the app data directory. Original data has been retained.');
  app.exit(1);
}

if (primaryInstance) app.whenReady().then(async () => {
  const appIcon = nativeImage.createFromPath(appIconPath);
  if (appIcon.isEmpty()) throw new Error('Unable to load the Unvar application icon.');
  // BrowserWindow.icon does not control the macOS Dock, including dev/preview runs.
  if (process.platform === 'darwin') app.dock?.setIcon(appIcon);
  const userData = app.getPath('userData');
  await mkdir(userData, { recursive: true });
  try { folder = new WorkspaceFolder(userData); }
  catch {
    const recovery = await dialog.showMessageBox({ type: 'warning', buttons: ['退出 / Quit', '重新定位工作区 / Locate workspace'], defaultId: 1, cancelId: 0,
      message: '原工作区无法访问 / Workspace unavailable', detail: '文件夹可能已移动或尚未同步完成。请选择原工作区或另一份完整副本，不会自动创建空数据库。\nLocate the moved folder or another complete copy. No empty replacement database will be created.' });
    if (recovery.response !== 1) { app.quit(); return; }
    const picked = await dialog.showOpenDialog({ properties: ['openDirectory'], title: '定位 Unvar 工作区 / Locate Unvar workspace' });
    if (picked.canceled || !picked.filePaths[0]) { app.quit(); return; }
    atomicJSON(join(userData, 'workspace-location.json'), { path: validateWorkspace(picked.filePaths[0]) });
    folder = new WorkspaceFolder(userData);
  }
  // First launch after upgrade: take a SQLite-consistent copy; retain the legacy database.
  if (!existsSync(join(folder.path, 'unvar-workspace.json'))) {
    await mkdir(folder.path, { recursive: true });
    if (existsSync(join(folder.path, 'unvar.db'))) throw new Error('Incomplete workspace migration. Preserve this folder and inspect it before retrying.');
    if (existsSync(join(userData, 'unvar.db'))) {
      const legacy = await openStore(join(userData, 'unvar.db'), join(userData, 'backups'));
      try { await legacy.db.backup(join(folder.path, 'unvar.db')); } finally { legacy.close(); }
      for (const name of ['materials', 'exports', 'backups']) if (existsSync(join(userData, name))) await cp(join(userData, name), join(folder.path, name), { recursive: true });
    }
  }
  initializeWorkspace(folder.path);
  store = await openStore(join(folder.path, 'unvar.db'), join(folder.path, 'backups'));
  folder.select(folder.path);
  const trusted = () => !switching && mainWindow && !mainWindow.isDestroyed() ? {
    sender: mainWindow.webContents, mainFrame: mainWindow.webContents.mainFrame, url: rendererUrl,
  } : null;
  registerWorkspaceFolderIPC(folder, trusted, () => mainWindow, (path, mode) => {
    switching = { path, mode }; app.quit();
  });
  const service = new WorkspaceService(store, new SystemCredentialStore());
  registerWorkspaceIPC(service, trusted, () => mainWindow, join(folder.path, 'exports'));
  registerDecisionIPC(store, trusted);
  jevScoring=registerJevIPC(service,trusted);
  piWorkflow = registerPiIPC(service, trusted,jevScoring);
  radar = registerRadarIPC(service, trusted,jevScoring);
  findingWorkflow = registerFindingIPC(service, trusted);
  writingWorkflow = registerWritingIPC(service, trusted, () => mainWindow, join(folder.path, 'exports'));
  registerLabIPC(store, trusted, () => mainWindow, join(folder.path, 'exports'));
  ipcMain.handle(APP_INFO_CHANNEL, createAppInfoHandler(
    () => mainWindow && !mainWindow.isDestroyed() ? {
      sender: mainWindow.webContents,
      mainFrame: mainWindow.webContents.mainFrame,
      url: rendererUrl,
    } : null,
    () => ({ name: app.getName(), version: app.getVersion() }),
  ));
  await createWindow();
  app.on('activate', () => {
    if (!quitting && BrowserWindow.getAllWindows().length === 0) void createWindow().catch(failStartup);
  });
}).catch(failStartup);

app.on('window-all-closed', () => {
  if (!quitting && process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => { store?.close(); });
app.on('before-quit', (event) => {
  if (canQuit) return;
  event.preventDefault();
  if (quitting) return;
  quitting = true;
  // Closing the renderer prevents new writes while workflows drain and backup runs.
  mainWindow?.destroy();
  jevScoring?.stop(); radar?.stop(); findingWorkflow?.stop(); writingWorkflow?.stop(); piWorkflow?.stop();
  void (async () => {
    try {
      await Promise.all([jevScoring?.waitForIdle(), radar?.waitForIdle(), findingWorkflow?.waitForIdle(), writingWorkflow?.waitForIdle(), piWorkflow?.waitForIdle()]);
      if (switching) {
        if (switching.mode === 'copy') await copyWorkspace(folder.path, switching.path, file => store!.db.backup(file));
        folder.select(switching.path);
      }
      store?.db.pragma('wal_checkpoint(TRUNCATE)');
    } catch {
      dialog.showErrorBox('Unvar — 工作区切换失败 / Workspace switch failed', '未完成的目标文件夹不会覆盖原工作区。请检查磁盘空间和文件夹权限。\nCheck disk space and folder permissions. The original workspace has been retained.');
    } finally {
      if (switching) app.relaunch();
      canQuit = true; app.quit();
    }
  })();
});
