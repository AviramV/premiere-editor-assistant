#!/usr/bin/env node
import {readFile} from 'node:fs/promises';import path from 'node:path';
import {PremiereTransport} from '../src/premiere/transport.mjs';import {PremiereCoordinator,atomicJson} from '../src/premiere/coordinator.mjs';
import {revision} from '../src/premiere/state.mjs';import {planDelivery,executeDeliverySequence} from '../src/editorial/delivery.mjs';
const [file,mode='plan']=process.argv.slice(2);if(!file||!['plan','execute'].includes(mode))throw new Error('Usage: node tools/deliver.mjs config.json [plan|execute]');
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
 if(mode==='execute'){
  const outputs={};for(const kind of ['takes','selects']){const output=c.outputs[kind];if(!output?.name||!output.prefix)throw new Error('Both named delivery outputs required');}
  for(const kind of ['takes','selects']){const output=c.outputs[kind];outputs[kind]=await executeDeliverySequence(a,{sourceId:sequence.id,sourceRevision:revision(sequence),plan:pair.plans[kind],name:output.name,prefix:output.prefix});await atomicJson(c.evidenceFile,{status:kind==='selects'?'pair_created_labels_audio_and_render_pending':'takes_created',outputs});}
  console.log(JSON.stringify(Object.fromEntries(Object.entries(outputs).map(([k,o])=>[k,{sequenceId:o.sequenceId,sections:o.sections.length}]))));
 }else console.log(JSON.stringify({planFile:c.planFile,parts:pair.plans.selects.sections.length,takes:pair.plans.takes.sections.length}));
}finally{await t.close();}
