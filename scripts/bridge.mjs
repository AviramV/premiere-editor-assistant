import path from 'node:path';
import {root,runtimes,environment,runtimeReady,beginUse,endUse,spawnManaged,recordRelease} from './common.mjs';
const backend=process.argv[2];
if(!['premiere_cep','premiere_uxp'].includes(backend))throw new Error('Choose premiere_cep or premiere_uxp');
await beginUse();
try {
await runtimeReady();await recordRelease();
const env=environment();
// Host edits are orchestrated through the guarded workflow; no new shell authority is enabled.
if(backend==='premiere_cep') {
  env.PREMIERE_MCP_PROTOCOL_MODE='legacy';
  env.PREMIERE_MCP_CAPABILITIES='inspect,edit,export,filesystem';
}
const child=spawnManaged(backend==='premiere_cep'?process.execPath:'/bin/bash',
  [backend==='premiere_cep'?path.join(runtimes,'leancoder-runtime/server/dist/index.js'):path.join(root,'workflow/tools/start-quadlzzz.sh')],
  {env,stdio:'inherit'});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{try{process.kill(-child.pid,signal);}catch{child.kill(signal);}});
await new Promise(resolve=>{child.once('error',error=>{console.error(error.message);process.exitCode=1;resolve();});child.once('close',code=>{process.exitCode=code??1;resolve();});});
}catch(error){console.error(`Premiere Editor Assistant needs setup: ${error.message}\nRun: node "${path.join(root,'scripts/setup.mjs')}"`);process.exitCode=1;}
finally{await endUse();}
