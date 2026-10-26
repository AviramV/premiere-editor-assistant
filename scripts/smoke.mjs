import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {root,runtimes,environment,runtimeReady} from './common.mjs';
import {checkBridge} from './smoke-check.mjs';
import {redact} from './setup-recovery.mjs';
await runtimeReady();
const sdk=path.join(runtimes,'quadlzzz/node_modules/@modelcontextprotocol/sdk/dist/esm');
const {Client}=await import(pathToFileURL(path.join(sdk,'client/index.js')));
const {StdioClientTransport}=await import(pathToFileURL(path.join(sdk,'client/stdio.js')));
const live=process.argv.includes('--live'),results=[];
for(const backend of ['premiere_cep','premiere_uxp']) {
 try {
  results.push(await checkBridge({backend,live,
   createClient:()=>new Client({name:'premiere-editor-assistant-package-check',version:'0.1.0'}),
   createTransport:()=>new StdioClientTransport({command:'/bin/bash',args:[path.join(root,'scripts/launch.sh'),backend],env:environment()}),
   retryOptions:{onRetry:detail=>console.error(`Retrying read-only ${backend} check in ${detail.delayMs/1000}s (${detail.nextAttempt}/3): ${detail.reason}`)}
  }));
 }catch(error){results.push({backend,status:'failed',attempts:error.attempts||1,detail:redact(error.message),
  fallback:'Open the matching Premiere panel and a project, verify the launcher path and duplicate bridge launches, then rerun smoke --live. Use doctor for panel/version mismatches.'});}
}
const verified=results.every(result=>result.status==='handshake_verified');
console.log(JSON.stringify({status:verified?'verified':'connection_check_failed',livePremiereConnectionVerified:live&&verified,codexConnectionsVerified:false,modelWeightsVerified:false,
 next:'This tests the packaged launchers directly using read-only checks. Reload Codex connections or restart Codex after startup changes, then verify both bridges from the chat.',results},null,2));
if(!verified)process.exitCode=1;
