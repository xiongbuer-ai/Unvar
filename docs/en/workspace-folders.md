# Local workspaces and synchronization

English | [简体中文](../zh/workspace-folders.md)

Open **Settings → Workspace folder** to choose an action:

- **Show in folder** opens the current workspace in your file manager.
- **Copy workspace to…** copies current data to a separate empty folder and switches to it. The original is retained. The destination cannot be the current workspace, its parent or a subfolder.
- **Open workspace…** opens a complete Unvar workspace obtained through synchronization or backup, then restarts the app. It does not merge two workspaces.

Save unfinished forms before switching. Before restarting, the app stops background analysis, waits for tasks to exit, completes the database backup, and records the new location. A failed copy does not overwrite the source, and an incomplete destination cannot be used as the new workspace. When upgrading from the older storage layout, the app copies `userData/unvar.db`, materials, exports and backups into `userData/workspace`, retaining the originals.

## Folder structure

```text
workspace/
  unvar-workspace.json     # Format and version identifier
  unvar.db                # Research content, model settings, focus and tasks
  config/interface.json   # Interface language preference
  materials/              # Local materials
  exports/                # Default location for Markdown exports
  backups/                # Database migration backups
  cache/                  # Rebuildable cache; excluded from Git
  logs/                   # Runtime logs; excluded from Git
  .gitignore
  README.md
```

The database contains captures, tags, webpage text, claims, questions, scores, experiments and logs, findings, articles, provider configuration and workflow state. API keys are not written to the database or workspace. They remain in the current device's system credential store and must be configured on each new device. Existing credentials are neither migrated nor deleted.

The device records the selected absolute folder path in Electron's `userData/workspace-location.json`. This location file is not synchronized. Electron's browser cache and runtime data remain on the device. A workspace can be opened from a different path on another computer. If the selected folder cannot be found, startup prompts you to locate it instead of silently creating an empty database.

## Synchronize with Git or a cloud drive

1. Quit Unvar completely. On macOS, use Cmd+Q; closing the window is not enough. Normal shutdown writes the write-ahead log (WAL) back to the database.
2. Wait for the cloud upload to finish, or commit and push the workspace through Git.
3. On the other device, finish downloading or pulling before opening the workspace.
4. Edit on only one device at a time.

SQLite is a binary database, so edits from two devices cannot be combined with a normal text merge. Unvar supports sequential synchronization and versioning of the complete workspace, without real-time collaboration or conflict merging. If a conflict occurs, keep both complete copies before choosing which one to open. Do not let a cloud drive overwrite an active local database with a remote version.

The workspace `.gitignore` excludes `unvar.db-wal`, `unvar.db-shm`, cache, logs and temporary files. **Do not copy or commit only `unvar.db` while the app is running**: recent data may still be in the WAL. The in-app copy operation uses SQLite backup and includes committed WAL writes. Cloud drives usually do not honor `.gitignore`, so synchronize only after quitting completely; pause cloud sync while the app is running if necessary.

Git does not preserve empty folders. The app recreates materials, exports, backups, configuration, cache and log folders on startup. Additional top-level files and Git history in the source workspace are outside the in-app copy scope and must be copied separately if needed. The app copies the business-data folders listed above and generates workspace instructions and ignore rules.

## Backup and restore

Use **Copy workspace to…** to create a complete copy. This also switches the active workspace; choose **Open workspace…** again if you want to return to the original folder. Alternatively, quit the app completely and back up the entire workspace folder.

To restore, choose **Open workspace…** and select the complete backup folder. Restore does not merge existing data, so retain your current workspace in case you need to return to it. Backups do not include API keys.
