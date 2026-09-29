# Packaging and installation verification

Installer work is in progress. These commands prepare unsigned local test artifacts; they do not publish a release or establish that every platform has been verified.

Use Node 24.12.x and pnpm 11.0.9 on the target platform with its native compiler tools installed. Run `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm typecheck` and `pnpm test` first.

| Native build machine | Command | Artifact |
| --- | --- | --- |
| Apple Silicon Mac | `pnpm package:mac:arm64` | arm64 DMG |
| Intel Mac | `pnpm package:mac:x64` | x64 DMG |
| Windows x64 | `pnpm package:win:x64` | x64 NSIS installer |

Artifacts are written to `dist/installers/`. Run `node scripts/checksums.mjs` to create SHA256SUMS.txt. The manually triggered GitHub packaging workflow builds on separate native runners and uploads temporary workflow artifacts only. It has not been run unless an execution report explicitly records the run.

The current packages have no verified developer signature or notarization. macOS or Windows may show an unidentified-developer or reputation warning. Only test an artifact you built or whose origin and checksum you have verified; do not disable system-wide protections. Public release remains a separate milestone.

For macOS, open the DMG and copy Unvar to Applications. For Windows, run the per-user installer and choose an installation folder. Close all Unvar windows and quit the application before replacing an existing installation. Application uninstall does not intentionally remove your workspace; separately manage workspace backups and credentials.

Before upgrading, quit the app and copy your entire workspace to a backup location. Launch the new version and select the original workspace if it has moved. Migration takes a SQLite backup first and must not drop/recreate research data. A backup does not contain your OS credential keys. Do not open a migrated workspace in an older application; restore a separate pre-upgrade copy if necessary.

A build succeeding is only the first check. On each clean target environment, verify installation and launch, native database/keychain access, note/tag persistence, a complete Signal → Writing path, human confirmation gates, all four Pi/Jev on/off combinations, failure/cancellation behavior, export, quit/restart and upgrade from an older workspace. Record actual model/engine, OS/architecture, artifact checksum and signing status. Tests must not substitute synthetic fixtures for real user research or a four-week usage period.

See [model configuration](network-setup.md) and [workspace backups](workspace-folders.md).

For isolated troubleshooting or installer verification, launch the executable with `--unvar-profile=/absolute/path/to/empty-profile`. Use a new empty folder: this selects a separate application profile and workspace, without changing the default profile.
