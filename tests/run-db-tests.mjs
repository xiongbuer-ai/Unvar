import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const require = createRequire(new URL('../apps/desktop/package.json', import.meta.url));
const filename = fileURLToPath(new URL('../.cache/db-integration.cjs', import.meta.url));
await build({ entryPoints: [fileURLToPath(new URL('./db.integration.ts', import.meta.url))], outfile: filename,
  bundle: true, platform: 'node', format: 'cjs', plugins: [{ name: 'native-dependencies', setup(builder) {
    builder.onResolve({ filter: /^(better-sqlite3|jsdom|@napi-rs\/keyring)$/ }, (args) => ({ path: require.resolve(args.path), external: true }));
  } }],
});
const result = spawnSync(require('electron'), [filename], { stdio: 'inherit', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
process.exit(result.status ?? 1);
