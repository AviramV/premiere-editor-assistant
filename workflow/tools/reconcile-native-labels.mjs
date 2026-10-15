import {helperPath, pythonPath} from '../src/core/environment.mjs';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {PremiereTransport} from '../src/premiere/transport.mjs';
import {PremiereCoordinator,atomicJson} from '../src/premiere/coordinator.mjs';
import {revision} from '../src/premiere/state.mjs';
import {reconcileSavedLabels} from '../src/premiere/saved-evidence.mjs';
import {run} from '../src/core/process.mjs';

const read=async f=>JSON.parse(await readFile(f,'utf8'));
if(!process.argv[2]) throw new Error('Usage: node tools/reconcile-native-labels.mjs config.json');
const config=await read(process.argv[2]),transport=await new PremiereTransport({fixedScripts:true}).connect();
const adapter=new PremiereCoordinator({transport,projectPath:config.projectPath,protectedIds:config.protectedIds,directory:path.resolve(config.journalDirectory)});
let release;
try {
  release=await adapter.lock();
  const ledger=await adapter.ledger(),entry=ledger[config.operationId];
  if(entry?.kind!=='ui_labels'||entry.status!=='indeterminate'||entry.sequenceId!==config.sequenceId||entry.projectPath!==config.projectPath) throw new Error('No matching interrupted native label session');
  const sourceBefore=await read(config.liveSourceBefore),source=await adapter.inspect(config.sourceSequenceId);
  const current=await adapter.inspect(config.sequenceId,{active:true,editable:true});
  if(revision(current)!==revision(entry.before)||revision(source)!==revision(sourceBefore)) throw new Error('Timeline or source changed during interrupted UI session');
  // Save only after geometry is inspected. This persists any successful colors;
  // it neither applies nor repeats a label action.
  await transport.call('save_project');
  const inspectSaved=async(id,file)=>{
    await run(pythonPath(),[helperPath('read-project.py'),'--project',config.projectPath,'--sequence',id,'--output',file]);return read(file);
  };
  const saved=await inspectSaved(config.sequenceId,`${config.evidenceDirectory}/takes-reconciled.json`);
  const sourceSaved=await inspectSaved(config.sourceSequenceId,`${config.evidenceDirectory}/source-reconciled.json`);
  const report=reconcileSavedLabels({before:entry.baselineSaved||await read(`${config.evidenceDirectory}/takes-baseline.json`),saved,sequence:entry.before,targets:entry.targets,
    sourceBefore:entry.sourceSavedBefore||await read(config.savedSourceBefore),sourceSaved,verifiedGroups:entry.verifiedGroups,pendingGroup:entry.pendingGroup});
  const after=await adapter.inspect(config.sequenceId,{active:true,editable:true}),sourceAfter=await adapter.inspect(config.sourceSequenceId);
  if(revision(after)!==revision(current)||revision(sourceAfter)!==revision(sourceBefore)) throw new Error('Timeline changed while reconciling labels');
  entry.reconciliation=report;entry.verifiedGroups=report.verifiedGroups;entry.pendingGroup=null;
  entry.status=report.remainingTargets.length?'reconciled_incomplete':'verified';entry.reconciledAt=new Date().toISOString();
  await adapter.persist(ledger);await atomicJson(config.evidenceFile,entry);
  console.log(JSON.stringify({status:entry.status,verified:report.verified,remaining:report.remainingTargets.length,sequenceId:entry.sequenceId}));
} finally {if(release) await release();await transport.close();}
