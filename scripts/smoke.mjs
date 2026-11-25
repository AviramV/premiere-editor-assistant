import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {root,runtimes,state,metadata,environment,runtimeReady,beginUse,endUse,recordRelease,run,selectLivePanelPath} from './common.mjs';
import {maintainResources} from './maintenance.mjs';
import {checkBridge} from './smoke-check.mjs';
import {redact,atomicJson} from './setup-recovery.mjs';
import {safeDirectory} from './lifecycle.mjs';
const smokeArgs=process.argv.slice(2),usage='Usage: launch.sh smoke [--live [--preview-cleanup]]';
if(smokeArgs.length===1&&smokeArgs[0]==='--help'){console.log(usage);process.exit(0);}
if(smokeArgs.some(arg=>!['--live','--preview-cleanup'].includes(arg))||new Set(smokeArgs).size!==smokeArgs.length||smokeArgs.includes('--preview-cleanup')&&!smokeArgs.includes('--live'))throw new Error(usage);
await beginUse();
try {
await runtimeReady();
const sdk=path.join(runtimes,'quadlzzz/node_modules/@modelcontextprotocol/sdk/dist/esm');
const {Client}=await import(pathToFileURL(path.join(sdk,'client/index.js')));
const {StdioClientTransport}=await import(pathToFileURL(path.join(sdk,'client/stdio.js')));
const live=process.argv.includes('--live'),results=[];
if(live) {
 let output;
 try {output=await run(process.execPath,[path.join(root,'scripts/doctor.mjs')],{timeout:120000});}
 catch(error) {
  let doctor;try{doctor=JSON.parse(error.stdout);}catch{throw error;}
  const failures=doctor.checks.filter(check=>check.required&&!check.ok);
  throw new Error('Premiere dependency check: '+failures.map(check=>check.detail || check.name).join(', '));
 }
 const doctor=JSON.parse(output);
 if(doctor.status!=='dependencies_ready')throw new Error('Resolve doctor checks before live verification and cleanup');
}
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
let maintenance;
if(live&&verified) {
 const panelPath=results.find(result=>result.backend==='premiere_uxp')?.panelPath;
 if(panelPath)selectLivePanelPath(panelPath);
 await recordRelease(true);
 try{maintenance=await maintainResources({apply:!process.argv.includes('--preview-cleanup'),panelPath});if(maintenance.blocked.length||maintenance.migration?.blocked.length)process.exitCode=2;}
 catch(error){maintenance={status:'cleanup_pending',detail:redact(error.message)};process.exitCode=2;}
}
// Keep the full inventory on disk for the updater. Large project histories can
// exceed a subprocess stdout buffer, even when the sweep succeeded.
if(maintenance?.mode==='apply' && process.env.PREMIERE_ASSISTANT_UPGRADE_REPORT==='1'){
 const directory=await safeDirectory(path.join(state,'upgrades',metadata.version));
 const report=path.join(directory,'cleanup-report.json');
 await atomicJson(report,maintenance);
 maintenance={mode:'apply',report,removedCount:maintenance.removed.length+maintenance.recovered.length,removedBytes:maintenance.removedBytes,
  retainedCount:maintenance.preserved.length+(maintenance.migration?.preserved.length||0),
  blocked:maintenance.blocked,migration:{blocked:maintenance.migration?.blocked||[]}};
}
console.log(JSON.stringify({status:verified?'server_checks_passed_chat_pending':'connection_check_failed',verificationScope:'packaged_servers_only',chatReadiness:'not_verified',livePremiereConnectionVerified:live&&verified,codexConnectionsVerified:false,modelWeightsVerified:false,
 next:'This tests the packaged launchers directly using read-only checks. Reload Codex connections or restart Codex after startup changes, then verify both bridges from the chat.',results,maintenance},null,2));
if(!verified)process.exitCode=1;
}catch(error){
 console.log(JSON.stringify({status:'verification_failed',detail:redact(error.message),livePremiereConnectionVerified:false}));
 process.exitCode=1;
}finally{await endUse();}
