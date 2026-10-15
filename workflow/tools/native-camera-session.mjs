import {helperPath, pythonPath} from '../src/core/environment.mjs';
import {readFile} from 'node:fs/promises';
import {createInterface} from 'node:readline';
import path from 'node:path';
import {PremiereTransport} from '../src/premiere/transport.mjs';
import {PremiereCoordinator,atomicJson} from '../src/premiere/coordinator.mjs';
import {revision,locateInstance} from '../src/premiere/state.mjs';
import {verifySavedCameraChoices,savedSourceRevision} from '../src/premiere/saved-evidence.mjs';
import {run} from '../src/core/process.mjs';
const read=async f=>JSON.parse(await readFile(f,'utf8')),c=await read(process.argv[2]);
if(c.protectedIds.includes(c.sequenceId))throw new Error('Source is protected');
const t=await new PremiereTransport({fixedScripts:true}).connect(),a=new PremiereCoordinator({transport:t,projectPath:c.projectPath,protectedIds:c.protectedIds,directory:path.resolve(c.journalDirectory)});
let release,entry,ledger;
try{
 release=await a.lock();ledger=await a.ledger();
 if(ledger[c.operationId]||Object.values(ledger).some(e=>['indeterminate','dispatched','ui_pending'].includes(e.status)))throw new Error('Resolve existing operation first');
 const before=await a.inspect(c.sequenceId,{active:true,editable:true});if(revision(before)!==c.beforeRevision)throw new Error('Stale camera session');
 for(const target of c.targets)locateInstance(before,target);
 const inspect=async(id,suffix)=>{const f=path.join(c.evidenceDirectory,suffix+'.json');await run(pythonPath(),[helperPath('read-project.py'),'--project',c.projectPath,'--sequence',id,'--output',f]);return read(f);};
 const requireTarget=async()=>{const p=await t.call('get_project_info');if(p.path!==c.projectPath||p.activeSequence?.id!==c.sequenceId)throw new Error('Camera target changed');};
 await requireTarget();await t.call('save_project');const baseline=await inspect(c.sequenceId,'before'),protectedBefore={};
 for(const id of c.verifySequenceIds)protectedBefore[id]=await inspect(id,'protected-before-'+id);
 verifySavedCameraChoices({before:baseline,saved:baseline,sequence:before,targets:c.targets,cameraIndex:Number(baseline.tracks.find(t=>t.kind==='video'&&t.index===c.targets[0].track).clips.find(x=>x.startTicks===c.targets[0].startTicks).selectedCameraIndex)});
 entry=ledger[c.operationId]={kind:'ui_camera',operationId:c.operationId,sequenceId:c.sequenceId,projectPath:c.projectPath,status:'ui_pending',before,baseline,targets:c.targets,cameraIndex:c.cameraIndex,startedAt:new Date().toISOString()};await a.persist(ledger);
 const selection=await t.fixed('selectLabelTargets',{projectPath:c.projectPath,sequenceId:c.sequenceId,targets:c.targets});console.log(JSON.stringify({phase:'selected',cameraNumber:c.cameraIndex+1,...selection}));
 const input=createInterface({input:process.stdin,terminal:false});let complete=false;
 for await(const line of input){const cmd=JSON.parse(line);if(cmd.command!=='confirm')throw new Error('Expected confirm');
  await requireTarget();await t.call('save_project');const saved=await inspect(c.sequenceId,'after');
  const evidence=verifySavedCameraChoices({before:baseline,saved,sequence:before,targets:c.targets,cameraIndex:c.cameraIndex});
  for(const id of c.verifySequenceIds)if(savedSourceRevision(await inspect(id,'protected-after-'+id))!==savedSourceRevision(protectedBefore[id]))throw new Error('A protected sequence changed');
  entry.observed=await a.inspect(c.sequenceId,{active:true,editable:true});entry.saved=saved;entry.evidence=evidence;entry.status='verified';entry.completedAt=new Date().toISOString();await a.persist(ledger);await atomicJson(c.evidenceFile,entry);console.log(JSON.stringify({phase:'finished',...evidence}));complete=true;input.close();break;
 }
 if(!complete)throw new Error('Camera session ended before verification');
}catch(error){if(entry){entry.status='indeterminate';entry.hostError=error.message;await a.persist(ledger);}throw error;}finally{if(release)await release();await t.close();}
