import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
const require=createRequire(process.cwd()+'/apps/desktop/package.json');
await build({entryPoints:['tests/jev-live.ts'],outfile:'.cache/jev-live.cjs',bundle:true,platform:'node',format:'cjs',external:['electron'],plugins:[{name:'external',setup(b){b.onResolve({filter:/^(better-sqlite3|jsdom|@napi-rs\/keyring)$/},a=>({path:require.resolve(a.path),external:true}));}}]});
const result=spawnSync(require('electron'),['.cache/jev-live.cjs'],{stdio:'inherit',env:{...process.env,ELECTRON_RUN_AS_NODE:'',UNVAR_LIVE_ACCEPTANCE:'1'}});process.exit(result.status??1);
