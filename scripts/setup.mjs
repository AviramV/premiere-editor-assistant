import path from 'node:path';
import {homedir} from 'node:os';
import {mkdir} from 'node:fs/promises';
import {root,state,metadata,location,runtimes,run,environment,executable,runtimeReady,bridgePatchHash,observeSetupProcesses,beginUse,endUse,holdPath,recordRelease,migrationCandidates,selectPreparedPython,exists,watchProcesses} from './common.mjs';
import {acquireSetupLock,createReport,redact} from './setup-recovery.mjs';
import {registerRuntime} from './runtime-location.mjs';
import {provisionRuntime,prepareInstaller,installCep} from './setup-runtime.mjs';
import {resource,markResource,adoptBridge,managedPath,safeDirectory} from './lifecycle.mjs';
import {prepareModels,adoptLegacyModels} from './models.mjs';
import {settingsDirectory} from './settings.mjs';

import {checkInstalledUpgrade,upgradeReceipt} from './upgrade-maintenance.mjs';

const flags=new Set(process.argv.slice(2));
if([...flags].some(f=>!['--local-models','--install-cep','--help'].includes(f)))throw new Error('Usage: setup.mjs [--local-models] [--install-cep]');
if(flags.has('--help')){console.log('Prepare pinned bridges and an installable UXP panel with bounded network retries and verified resume. --local-models optionally prepares local Whisper; --install-cep installs the CEP panel. Existing Premiere-native transcripts and authorized ElevenLabs (Scribe) are alternatives. No Premiere projects are edited.');process.exit(0);}
const quote=value=>"'"+value.replaceAll("'","'\\''")+"'";
const retryValues={PREMIERE_ASSISTANT_STORE:location.store,PREMIERE_ASSISTANT_NODE:process.execPath,PREMIERE_ASSISTANT_CONFIG:settingsDirectory(),
 ...(!location.managed?{PREMIERE_ASSISTANT_DATA:location.directory}:{}),
 ...Object.fromEntries(['PREMIERE_ASSISTANT_PYTHON','PREMIERE_ASSISTANT_STATE','PREMIERE_ASSISTANT_UXP_PANEL'].filter(name=>process.env[name]).map(name=>[name,process.env[name]]))};
const retryEnvironment=Object.entries(retryValues).map(([name,value])=>`${name}=${quote(value)}`).join(' ');
const retryCommand=`${retryEnvironment} /bin/bash ${quote(path.join(root,'scripts/launch.sh'))} setup${flags.has('--install-cep')?' --install-cep':''}${flags.has('--local-models')?' --local-models':''}`;
let lock,report,result,adoption,modelMigration;
try {
 if(process.platform!=='darwin')throw new Error('This release supports macOS. Windows needs a separately validated adapter.');
 if(Number(process.versions.node.split('.')[0])<22)throw new Error('Node.js 22+ is required');
 await safeDirectory(state);
 const scratch=resource(location.store,'scratch',location.identity.id);
 await beginUse([scratch.path,path.join(location.store,'downloads')]);
 await recordRelease();
 lock=await acquireSetupLock(state);observeSetupProcesses(lock);
 report=await createReport(state,retryCommand);
 let python=process.env.PREMIERE_ASSISTANT_PYTHON||executable('python3');
 await report.step('python_requirement',()=>run(python,['-c','import sys; assert sys.version_info >= (3,9), "Python 3.9+ required"']),
  'Use configure --python with an existing Python 3.9+ executable, or install a compatible Python through your package manager or a verified official installer.');
 if(location.managed) {
  await managedPath(location.store,location.bridge,{missing:true});
  if(!await exists(runtimes))adoption=await adoptBridge({store:location.store,item:location.bridge,candidates:await migrationCandidates(),checkRuntime:runtimeReady,identity:location.identity});
  await safeDirectory(location.directory);
  await managedPath(location.store,scratch,{missing:true});await mkdir(scratch.path,{recursive:true});await markResource(location.store,scratch);
 }
 await provisionRuntime({root,state,runtimes,python,npm:executable('npm'),run,env:environment(),checkRuntime:runtimeReady,patchSha256:await bridgePatchHash(),report,identity:location.identity,
  ...(location.managed?{workDirectory:path.join(scratch.path,'work'),downloadsDirectory:path.join(location.store,'downloads')}:{})});
 if(location.managed)await markResource(location.store,location.bridge,{inventory:true});
 await report.step('runtime_registration',()=>location.managed?recordRelease():registerRuntime(location), 'Preserve existing runtimes and reconcile the reported saved location. Setup and both agents must use the same runtime directory.');
 modelMigration=await report.step('legacy_python_migration',async()=>adoptLegacyModels({root,store:location.store,candidates:await migrationCandidates(),run,env:process.env,hold:holdPath}), 'Existing Python environments remain in place. Inspect the reported import/version check before choosing an interpreter.');
 if(modelMigration.path&&!process.env.PREMIERE_ASSISTANT_PYTHON){selectPreparedPython(modelMigration.path);python=modelMigration.path;}
 let installer,installerWarning;
 try{installer=await prepareInstaller({state,runtimes,python,run,report});}
 catch(error){installerWarning={stage:error.stage,attempts:error.attempts||1,detail:redact(error.message),fallback:error.fallback};await report.event('fallback_available',installerWarning);}
 if(flags.has('--install-cep'))await installCep({root,state,target:path.join(homedir(),'Library/Application Support/Adobe/CEP/extensions/MCPBridgeCEP'),run,report});
 let models,modelWarning;
 if(flags.has('--local-models')) {
  try {
   models=await report.step('local_models',async()=>{
    if(process.arch!=='arm64')throw new Error('Local MLX Whisper requires Apple Silicon.');
    return modelMigration.status==='adopted_legacy_environment'?modelMigration:await prepareModels({root,store:location.store,python,run,report,env:process.env,hold:holdPath,watch:watchProcesses});
   },'Local Whisper is optional. Use a verified Premiere-native transcript, an existing timed transcript, or explicitly authorized ElevenLabs (Scribe). No audio is uploaded by setup. Rerun setup --local-models after fixing the reported failure.');
   if(models.requiresConfiguration)modelWarning={stage:'local_models',detail:'The new local environment is installed, but an explicit Python setting takes precedence.',fallback:`Run /bin/bash ${quote(path.join(root,'scripts/launch.sh'))} configure --python ${quote(models.path)}, then doctor.`};
   else selectPreparedPython(models.path);
  }catch(error){modelWarning={stage:error.stage,attempts:error.attempts||1,detail:redact(error.message),fallback:error.fallback};await report.event('optional_failed',modelWarning);}
 }
 await recordRelease();
 result={status:modelWarning||installerWarning?'runtime_ready_with_pending_steps':'runtime_ready',dataDirectory:location.directory,setupDirectory:state,runtimeLocation:location,adoption,modelMigration,
  uxpInstaller:installer,uxpDeveloperManifest:path.join(runtimes,'quadlzzz/panel/manifest.json'),cepPanel:path.join(runtimes,'cep-panel'),
  localModels:models,warnings:[installerWarning,modelWarning].filter(Boolean),
  livePremiereConnectionVerified:false,codexConnectionsVerified:false,modelWeightsVerified:false,retryCommand,
  next:'Install the CCX through Adobe Creative Cloud, or load the prepared manifest in Adobe UXP Developer Tool. Open both panels and a project, then run doctor and smoke --live. After startup changes reload Codex connections or restart Codex and verify both bridges from the chat.'};
 try {
  result.codexRegistration=JSON.parse(await run(python,[path.join(root,'scripts/codex-registration.py'),root]));
 }catch(error){result.codexRegistration={status:'manual_review',detail:redact(error.message)};}
 try {
  result.upgradeMaintenance=await checkInstalledUpgrade(true);
 }catch(error){
  result.upgradeMaintenance={status:'pending',file:upgradeReceipt(state,metadata.version),reason:redact(error.message)};
 }
 result.livePremiereConnectionVerified=result.upgradeMaintenance.livePremiereConnectionVerified===true;
 if(result.upgradeMaintenance.status==='pending'){
  result.status='runtime_ready_with_pending_steps';
  result.next=result.livePremiereConnectionVerified
   ? 'Both bridges answered. See upgradeMaintenance for the cleanup blocker and retry status.'
   : 'Installation prepared. Resolve the reported verification issue and open the matching panels and a project. The connected plugin retries pending cleanup.';
 }else{
  result.next='Upgrade cleanup completed. Verify tool availability in the agent chat after a connection reload.';
 }
 if(modelWarning||installerWarning||result.upgradeMaintenance.status!=='complete')process.exitCode=2;
}catch(error) {
 process.exitCode=1;
 result={status:'setup_failed',stage:error.stage||report?.stage||'preflight',attempts:error.attempts||Math.max(report?.attempt||0,1),detail:redact(error.message),
  fallback:error.retryAfterMs>60000?`Wait at least ${Math.ceil(error.retryAfterMs/1000)} seconds before rerunning setup; the download server requested this delay.`:error.fallback||'Correct the reported error, then rerun the same setup command. Existing runtimes and project journals are preserved.',
  retryCommand,retryAfterMs:error.retryAfterMs,dataDirectory:location.directory,setupDirectory:state,preserved:['installed runtimes','project journals','verified downloads','completed scratch checkpoints'],
  livePremiereConnectionVerified:false,codexConnectionsVerified:false};
}finally {
 if(lock)try{await lock.assertReleasable();}catch(error){process.exitCode=1;result={...result,status:'setup_failed',stage:'setup_lock',detail:redact(error.message),fallback:error.fallback};}
 if(report) {
  try{await report.finish(result);result.log=report.log;result.statusFile=report.statusFile;}
  catch(error){process.exitCode=1;result={...result,status:'setup_failed',stage:'diagnostic_report',detail:redact(error.message)};}
 }
 observeSetupProcesses(undefined);
 if(lock)try{await lock.release();}catch(error){process.exitCode=1;result={...result,status:'setup_failed',stage:'setup_lock',detail:redact(error.message),fallback:error.fallback};}
 await endUse();
}
console.log(JSON.stringify(result,null,2));
