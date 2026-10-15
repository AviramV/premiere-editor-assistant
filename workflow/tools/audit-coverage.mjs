#!/usr/bin/env node
import {readFile,writeFile} from 'node:fs/promises';
import {validateScript} from '../src/editorial/script.mjs';
import {auditCoverage,renderCoverageAudit} from '../src/editorial/coverage.mjs';
import {atomicJson} from '../src/premiere/coordinator.mjs';
const read=async file=>JSON.parse(await readFile(file,'utf8'));
if(!process.argv[2])throw new Error('Usage: node tools/audit-coverage.mjs config.json');
const config=await read(process.argv[2]),script=validateScript(await read(config.scriptFile));
const snapshot=config.sequenceFile?await read(config.sequenceFile):null,sequence=snapshot?.sequence||snapshot;
if(sequence&&sequence.id!==config.sequenceId)throw new Error('Wrong coverage source sequence');
const sources=[];
for(const entry of config.sources) {
  const raw=await read(entry.transcriptFile),transcript=raw.transcript||raw;
  let placement;
  if(entry.placement) {
    const matches=sequence?.tracks.find(t=>t.kind===entry.placement.kind&&t.index===entry.placement.track)?.clips.filter(c=>c.sourceId===entry.placement.sourceId&&c.startTicks===entry.placement.startTicks)||[];
    if(matches.length!==1)throw new Error('Exact coverage source placement unavailable');placement=matches[0];
  }
  sources.push({id:entry.id,name:entry.name,transcript,matching:await read(entry.matchingFile),placement});
}
const audit=auditCoverage({script,sources});
await atomicJson(config.output,audit);
if(config.htmlOutput)await writeFile(config.htmlOutput,renderCoverageAudit(audit));
console.log(JSON.stringify({output:config.output,htmlOutput:config.htmlOutput,revision:audit.revision,
  review:audit.passages.filter(p=>!p.automaticCandidateCount).map(p=>({passageId:p.passageId,status:p.status,candidates:p.candidateCount}))}));
