import {helperPath, pythonPath} from '../src/core/environment.mjs';
// Holds the one-writer lock across bounded foreground UI actions. A select
// prepares an exact group; confirm saves and checks its actual instance colors.
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {createInterface} from 'node:readline';
import {PremiereTransport} from '../src/premiere/transport.mjs';
import {PremiereCoordinator,atomicJson} from '../src/premiere/coordinator.mjs';
import {revision,locateInstance} from '../src/premiere/state.mjs';
import {verifySavedLabels,savedSourceRevision,savedGeometryRevision} from '../src/premiere/saved-evidence.mjs';
import {run} from '../src/core/process.mjs';
import {LABELS} from '../src/editorial/organizer.mjs';

const read=async f=>JSON.parse(await readFile(f,'utf8'));
const configFile=process.argv[2];
if(!configFile) throw new Error('Usage: node tools/native-label-session.mjs config.json');
const config=await read(configFile),transport=await new PremiereTransport({fixedScripts:true}).connect();
const adapter=new PremiereCoordinator({transport,projectPath:config.projectPath,protectedIds:config.protectedIds,directory:path.resolve(config.journalDirectory)});
let release,entry,ledger;
try {
  release=await adapter.lock();ledger=await adapter.ledger();
  if(ledger[config.operationId]||Object.values(ledger).some(e=>['dispatched','indeterminate','ui_pending'].includes(e.status))) throw new Error('Resolve the existing edit before starting native labels');
  const before=await adapter.inspect(config.sequenceId,{active:true,editable:true});
  if(revision(before)!==config.beforeRevision) throw new Error('Stale native label session');
  const plan=await read(config.planFile),targets=plan.labels;
  if(!targets.length) throw new Error('No label targets');
  for(const target of targets) locateInstance(before,target);
  const sourceSavedBefore=await read(config.savedSourceBefore),groups=[...new Set(targets.map(t=>t.labelIndex))].sort((a,b)=>a-b);
  entry=ledger[config.operationId]={kind:'ui_labels',operationId:config.operationId,sequenceId:config.sequenceId,
    projectPath:config.projectPath,status:'ui_pending',before,targets,groups,verifiedGroups:[],startedAt:new Date().toISOString()};
  await adapter.persist(ledger);
  let pending=null,finished=false;
  const inspectSaved=async(id,file)=>{
    await run(pythonPath(),[helperPath('read-project.py'),'--project',config.projectPath,'--sequence',id,'--output',file]);
    return read(file);
  };
  const requireTarget=async()=>{
    const context=await transport.call('get_project_info');
    if(context.path!==config.projectPath||context.activeSequence?.id!==config.sequenceId) throw new Error('Native label target changed');
  };
  await requireTarget();await transport.call('save_project');
  const baselineSaved=await inspectSaved(config.sequenceId,`${config.evidenceDirectory}/takes-baseline.json`);
  entry.baselineSaved=baselineSaved;entry.sourceSavedBefore=sourceSavedBefore;await adapter.persist(ledger);
  console.log(JSON.stringify({phase:'ready',groups:groups.map(i=>({index:i,name:LABELS[i],clips:targets.filter(t=>t.labelIndex===i).length}))}));
  const input=createInterface({input:process.stdin,terminal:false});
  for await(const line of input) {
    const command=JSON.parse(line);
    if(command.command==='select') {
      const index=command.labelIndex;
      if(pending!==null||!groups.includes(index)||entry.verifiedGroups.includes(index)) throw new Error('Invalid or repeated label group');
      await requireTarget();
      entry.pendingGroup=index;await adapter.persist(ledger);
      const selected=await transport.fixed('selectLabelTargets',{projectPath:config.projectPath,sequenceId:config.sequenceId,targets:targets.filter(t=>t.labelIndex===index)});
      pending=index;
      console.log(JSON.stringify({phase:'selected',labelIndex:index,labelName:LABELS[index],...selected}));
    } else if(command.command==='confirm') {
      if(pending===null) throw new Error('No prepared native label group');
      await requireTarget();
      await transport.call('save_project');
      const saved=await inspectSaved(config.sequenceId,`${config.evidenceDirectory}/takes-saved.json`);
      if(savedGeometryRevision(saved)!==savedGeometryRevision(baselineSaved)) throw new Error('Saved clip geometry or camera state changed during labeling');
      const evidence=verifySavedLabels({saved,sequence:before,targets:targets.filter(t=>t.labelIndex===pending)});
      const source=await inspectSaved(config.sourceSequenceId,`${config.evidenceDirectory}/source-saved.json`);
      if(savedSourceRevision(source)!==savedSourceRevision(sourceSavedBefore)) throw new Error('Source sequence changed during labeling');
      entry.verifiedGroups.push(pending);entry.pendingGroup=null;
      (entry.evidence||=[]).push(evidence);await adapter.persist(ledger);
      console.log(JSON.stringify({phase:'verified',labelIndex:pending,clips:evidence.verified}));pending=null;
    } else if(command.command==='finish') {
      if(pending!==null||entry.verifiedGroups.length!==groups.length) throw new Error('Native label groups remain unverified');
      const final=await adapter.inspect(config.sequenceId,{active:true,editable:true});
      if(revision(final)!==config.beforeRevision) throw new Error('Timeline changed during the native label session');
      entry.status='verified';entry.completedAt=new Date().toISOString();
      await adapter.persist(ledger);await atomicJson(config.evidenceFile,entry);
      console.log(JSON.stringify({phase:'finished',verified:targets.length}));finished=true;input.close();break;
    } else throw new Error('Unknown native label command');
  }
  if(!finished) throw new Error('Native label input ended before verification');
} catch(error) {
  if(entry){entry.status='indeterminate';entry.hostError=error.message;await adapter.persist(ledger);}
  throw error;
} finally {if(release) await release();await transport.close();}
