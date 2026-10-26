import path from 'node:path';
import {homedir} from 'node:os';
import {mkdir} from 'node:fs/promises';
import {root,state,runtimes,run,environment,executable,runtimeReady,bridgePatchHash,observeSetupProcesses} from './common.mjs';
import {acquireSetupLock,createReport,redact} from './setup-recovery.mjs';
import {provisionRuntime,prepareInstaller,installCep,localModels} from './setup-runtime.mjs';

const flags=new Set(process.argv.slice(2));
if([...flags].some(f=>!['--local-models','--install-cep','--help'].includes(f)))throw new Error('Usage: setup.mjs [--local-models] [--install-cep]');
if(flags.has('--help')){console.log('Prepare pinned bridges and an installable UXP panel with bounded network retries and verified resume. --local-models optionally prepares local Whisper; --install-cep installs the CEP panel. Existing Premiere-native transcripts and authorized ElevenLabs (Scribe) are alternatives. No Premiere projects are edited.');process.exit(0);}
const quote=value=>"'"+value.replaceAll("'","'\\''")+"'";
const retryEnvironment=`PREMIERE_ASSISTANT_DATA=${quote(state)} PREMIERE_ASSISTANT_NODE=${quote(process.execPath)}`+['PREMIERE_ASSISTANT_CONFIG','PREMIERE_ASSISTANT_PYTHON'].filter(name=>process.env[name]).map(name=>` ${name}=${quote(process.env[name])}`).join('');
const retryCommand=`${retryEnvironment} /bin/bash ${quote(path.join(root,'scripts/launch.sh'))} setup${flags.has('--install-cep')?' --install-cep':''}${flags.has('--local-models')?' --local-models':''}`;
let lock,report,result;
try {
 if(process.platform!=='darwin')throw new Error('This release supports macOS. Windows needs a separately validated adapter.');
 if(Number(process.versions.node.split('.')[0])<22)throw new Error('Node.js 22+ is required');
 await mkdir(state,{recursive:true});
 lock=await acquireSetupLock(state);observeSetupProcesses(lock);
 report=await createReport(state,retryCommand);
 const python=process.env.PREMIERE_ASSISTANT_PYTHON||executable('python3');
 await report.step('python_requirement',()=>run(python,['-c','import sys; assert sys.version_info >= (3,9), "Python 3.9+ required"']),
  'Use configure --python with an existing Python 3.9+ executable, or install a compatible Python through your package manager or a verified official installer.');
 await provisionRuntime({root,state,runtimes,python,npm:executable('npm'),run,env:environment(),checkRuntime:runtimeReady,patchSha256:await bridgePatchHash(),report});
 let installer,installerWarning;
 try{installer=await prepareInstaller({state,runtimes,python,run,report});}
 catch(error){installerWarning={stage:error.stage,attempts:error.attempts||1,detail:redact(error.message),fallback:error.fallback};await report.event('fallback_available',installerWarning);}
 if(flags.has('--install-cep'))await installCep({root,state,target:path.join(homedir(),'Library/Application Support/Adobe/CEP/extensions/MCPBridgeCEP'),run,report});
 let models,modelWarning;
 if(flags.has('--local-models')) {
  try {
   models=await report.step('local_models',async()=>{
    if(process.arch!=='arm64')throw new Error('Local MLX Whisper requires Apple Silicon.');
    return await localModels({root,state,python,run,report});
   },'Local Whisper is optional. Use a verified Premiere-native transcript, an existing timed transcript, or explicitly authorized ElevenLabs (Scribe). No audio is uploaded by setup. Rerun setup --local-models after fixing the reported failure.');
   if(models.requiresConfiguration)modelWarning={stage:'local_models',detail:'The new local environment is installed, but an explicit Python setting takes precedence.',fallback:`Run /bin/bash ${quote(path.join(root,'scripts/launch.sh'))} configure --python ${quote(models.path)}, then doctor.`};
  }catch(error){modelWarning={stage:error.stage,attempts:error.attempts||1,detail:redact(error.message),fallback:error.fallback};await report.event('optional_failed',modelWarning);}
 }
 result={status:modelWarning||installerWarning?'runtime_ready_with_pending_steps':'runtime_ready',dataDirectory:state,
  uxpInstaller:installer,uxpDeveloperManifest:path.join(runtimes,'quadlzzz/panel/manifest.json'),cepPanel:path.join(runtimes,'cep-panel'),
  localModels:models,warnings:[installerWarning,modelWarning].filter(Boolean),
  livePremiereConnectionVerified:false,codexConnectionsVerified:false,modelWeightsVerified:false,retryCommand,
  next:'Install the CCX through Adobe Creative Cloud, or load the prepared manifest in Adobe UXP Developer Tool. Open both panels and a project, then run doctor and smoke --live. After startup changes reload Codex connections or restart Codex and verify both bridges from the chat.'};
 if(modelWarning||installerWarning)process.exitCode=2;
}catch(error) {
 process.exitCode=1;
 result={status:'setup_failed',stage:error.stage||report?.stage||'preflight',attempts:error.attempts||Math.max(report?.attempt||0,1),detail:redact(error.message),
  fallback:error.retryAfterMs>60000?`Wait at least ${Math.ceil(error.retryAfterMs/1000)} seconds before rerunning setup; the download server requested this delay.`:error.fallback||'Correct the reported error, then rerun the same setup command. Existing runtimes and project journals are preserved.',
  retryCommand,retryAfterMs:error.retryAfterMs,dataDirectory:state,preserved:['installed runtimes','project journals','verified downloads','completed scratch checkpoints'],
  livePremiereConnectionVerified:false,codexConnectionsVerified:false};
}finally {
 if(lock)try{await lock.assertReleasable();}catch(error){process.exitCode=1;result={...result,status:'setup_failed',stage:'setup_lock',detail:redact(error.message),fallback:error.fallback};}
 if(report) {
  try{await report.finish(result);result.log=report.log;result.statusFile=report.statusFile;}
  catch(error){process.exitCode=1;result={...result,status:'setup_failed',stage:'diagnostic_report',detail:redact(error.message)};}
 }
 observeSetupProcesses(undefined);
 if(lock)try{await lock.release();}catch(error){process.exitCode=1;result={...result,status:'setup_failed',stage:'setup_lock',detail:redact(error.message),fallback:error.fallback};}
}
console.log(JSON.stringify(result,null,2));
