import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync, readdirSync, statSync, realpathSync, openSync, readSync, closeSync, unlinkSync } from 'node:fs';
import { cp } from 'node:fs/promises';
import { join, relative, isAbsolute, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { interfacePreferencesSchema, type InterfacePreferences } from '@unvar/shared';

const manifestName = 'unvar-workspace.json';
const folders = ['materials', 'exports', 'backups', 'config', 'cache', 'logs'];
export function atomicJSON(filename: string, value: unknown) {
  const temporary = `${filename}.${randomUUID()}.tmp`;
  try { writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 }); renameSync(temporary, filename); }
  finally { if (existsSync(temporary)) unlinkSync(temporary); }
}
export function validateWorkspace(path: string) {
  const manifest = JSON.parse(readFileSync(join(path, manifestName), 'utf8'));
  if (manifest.format !== 'unvar-workspace' || manifest.version !== 1 || !statSync(join(path, 'unvar.db')).isFile()) throw new Error('Invalid workspace.');
  const fd = openSync(join(path, 'unvar.db'), 'r');
  try { const header = Buffer.alloc(16); readSync(fd, header, 0, 16, 0); if (header.toString() !== 'SQLite format 3\0') throw new Error('Invalid workspace database.'); }
  finally { closeSync(fd); }
  return realpathSync(path);
}
export function initializeWorkspace(path: string) {
  mkdirSync(path, { recursive: true });
  for (const folder of folders) mkdirSync(join(path, folder), { recursive: true });
  if (!existsSync(join(path, manifestName))) atomicJSON(join(path, manifestName), { format: 'unvar-workspace', version: 1 });
  if (!existsSync(join(path, '.gitignore'))) writeFileSync(join(path, '.gitignore'), '# Sync only after closing Unvar. Do not merge databases.\n/unvar.db-wal\n/unvar.db-shm\n/cache/\n/logs/\n*.tmp\n.DS_Store\n');
  if (!existsSync(join(path, 'README.md'))) writeFileSync(join(path, 'README.md'), '# Unvar 工作区 / Workspace\n\n研究内容、研究方向和模型配置保存在 unvar.db；界面偏好位于 config/interface.json。资料、导出、备份分别位于 materials、exports、backups。API Key 使用本机系统钥匙串，不随工作区同步。\n\n同步前完全退出 Unvar，等待另一台设备同步完成后再打开。不要同时在多台设备修改，不要自动合并数据库；发生冲突请先保留两份副本再选择要打开的版本。\n\nClose Unvar completely before Git/cloud sync. Wait for sync to finish before opening on another device. Never edit on two devices simultaneously or merge SQLite files. API keys remain in each device’s credential store.\n');
}
export function assertCopyDestination(source: string, target: string) {
  const from = realpathSync(source); const to = realpathSync(target);
  const inside = (parent: string, child: string) => { const path = relative(parent, child); return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path)); };
  if (inside(from, to) || inside(to, from) || readdirSync(to).length) throw new Error('Choose an empty, separate folder.');
}
/** Uses SQLite backup, never copies a live database or its WAL files. Source is retained. */
export async function copyWorkspace(source: string, target: string, backup: (filename: string) => Promise<unknown>) {
  assertCopyDestination(source, target);
  // A failed transfer is left visibly incomplete, never selected as a valid workspace.
  await backup(join(target, 'unvar.db'));
  for (const name of ['materials', 'exports', 'backups', 'config']) {
    if (existsSync(join(source, name))) await cp(join(source, name), join(target, name), { recursive: true, errorOnExist: true, force: false });
  }
  initializeWorkspace(target);
}
export class WorkspaceFolder {
  readonly pointer: string;
  path: string;
  constructor(readonly userData: string) {
    this.pointer = join(userData, 'workspace-location.json');
    if (existsSync(this.pointer)) {
      const saved = JSON.parse(readFileSync(this.pointer, 'utf8'));
      if (typeof saved.path !== 'string' || !isAbsolute(saved.path)) throw new Error('Invalid workspace location.');
      this.path = validateWorkspace(saved.path);
    } else this.path = join(userData, 'workspace');
  }
  select(path: string) { atomicJSON(this.pointer, { path: validateWorkspace(path) }); }
  preferences(): InterfacePreferences | null {
    const file = join(this.path, 'config', 'interface.json');
    return existsSync(file) ? interfacePreferencesSchema.parse(JSON.parse(readFileSync(file, 'utf8'))) : null;
  }
  savePreferences(input: InterfacePreferences) { atomicJSON(join(this.path, 'config', 'interface.json'), interfacePreferencesSchema.parse(input)); }
}
