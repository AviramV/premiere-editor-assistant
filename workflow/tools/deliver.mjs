#!/usr/bin/env node
import {readFile} from 'node:fs/promises';import path from 'node:path';
import {PremiereTransport} from '../src/premiere/transport.mjs';import {PremiereCoordinator,atomicJson} from '../src/premiere/coordinator.mjs';
import {revision} from '../src/premiere/state.mjs';import {planDelivery,executeDeliverySequence} from '../src/editorial/delivery.mjs';
import {executeSelectsFromTakes} from '../src/editorial/selects-from-takes.mjs';
const [file,mode='plan']=process.argv.slice(2);if(!file||!['plan','execute','selects'].includes(mode))throw new Error('Usage: node tools/deliver.mjs config.json [plan|execute|selects]');
const read=async f=>JSON.parse(await readFile(f,'utf8')),c=await read(file),t=await new PremiereTransport({fixedScripts:true}).connect(),a=new PremiereCoordinator({transport:t,projectPath:c.projectPath,protectedIds:c.protectedIds,directory:path.resolve(c.journalDirectory)});
try{
 const sequence=await a.inspect(c.sequenceId),v=await read(c.transcriptFile),transcript=v.transcript||v;
 const placements=sequence.tracks.find(t=>t.kind===c.placement.kind&&t.index===c.placement.track)?.clips.filter(x=>x.sourceId===c.placement.sourceId&&x.startTicks===c.placement.startTicks)||[];
 if(placements.length!==1)throw new Error('Exact delivery source placement required');
 const voiceSources=[];
 for(const source of c.voiceSources||[]){
  const value=await read(source.transcriptFile),voiceTranscript=value.transcript||value;
  const candidates=sequence.tracks.find(t=>t.kind===source.placement.kind&&t.index===source.placement.track)?.clips.filter(x=>x.sourceId===source.placement.sourceId&&x.startTicks===source.placement.startTicks)||[];
  if(candidates.length!==1)throw new Error('Exact additional voice source placement required');
  voiceSources.push({transcript:voiceTranscript,placement:candidates[0]});
 }
 const pair=planDelivery({sequence,transcript,placement:placements[0],voiceSources,inventory:await read(c.inventoryFile)},{extraTailFrames:c.extraTailFrames??4,takesBoundaryMode:c.takesBoundaryMode??'strict'});
 await atomicJson(c.planFile,pair);
 if(mode!=='plan'){
  for(const kind of ['takes','selects']){const output=c.outputs[kind];if(!output?.name||!output.prefix)throw new Error('Both named delivery outputs required');}
  if(c.outputs.takes.name===c.outputs.selects.name||c.outputs.takes.prefix===c.outputs.selects.prefix)throw new Error('Distinct delivery names and operation prefixes required');
  if(mode==='execute'){
   const output=c.outputs.takes;
   const takes=await executeDeliverySequence(a,{sourceId:sequence.id,sourceRevision:revision(sequence),plan:pair.plans.takes,name:output.name,prefix:output.prefix});
   await atomicJson(c.evidenceFile,{status:'takes_created_preparation_required',pairRevision:pair.revision,outputs:{takes}});
   console.log(JSON.stringify({status:'takes_created_preparation_required',takesSequenceId:takes.sequenceId,next:'Prepare Takes colors, camera choices and audio routing, then run deliver with selects mode.'}));
  }else{
   let prior;try{prior=await read(c.evidenceFile);}catch(error){if(error.code!=='ENOENT')throw error;}
   if(prior?.pairRevision&&prior.pairRevision!==pair.revision)throw new Error('Delivery plan changed since Takes was built; reconcile before deriving Selects');
   const takesId=c.takesSequenceId||prior?.outputs?.takes?.sequenceId;
   if(!takesId||(c.takesSequenceId&&prior?.outputs?.takes?.sequenceId&&c.takesSequenceId!==prior.outputs.takes.sequenceId))throw new Error('Exact prepared Takes identity required');
   const output=c.outputs.selects;
   try{
    const selects=await executeSelectsFromTakes(a,{sourceId:sequence.id,takesId,takesPlan:pair.plans.takes,selectsPlan:pair.plans.selects,name:output.name,prefix:output.prefix});
    const takes={...prior?.outputs?.takes,sequenceId:takesId,state:await a.inspect(takesId),kind:'takes',planId:pair.plans.takes.planId};
    await atomicJson(c.evidenceFile,{status:'pair_created_native_inheritance_verified_render_and_reopen_pending',pairRevision:pair.revision,outputs:{takes,selects}});
    console.log(JSON.stringify({takesSequenceId:takesId,selectsSequenceId:selects.sequenceId,colorsVerified:selects.colorsVerified,construction:selects.construction,acceptancePending:selects.acceptancePending}));
   }catch(error){await atomicJson(c.evidenceFile,{...prior,status:'selects_failed_inspect_before_retry',pairRevision:pair.revision,takesSequenceId:takesId,error:error.message});throw error;}
  }
 }else console.log(JSON.stringify({planFile:c.planFile,parts:pair.plans.selects.sections.length,takes:pair.plans.takes.sections.length}));
}finally{await t.close();}
