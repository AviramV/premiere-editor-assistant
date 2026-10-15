#!/usr/bin/env node
import {readFile} from 'node:fs/promises';
import {extractAudio} from '../src/media/audio.mjs';
import {readMonoWav} from '../src/media/measurements.mjs';
import {validateScript} from '../src/editorial/script.mjs';
import {assessTakes} from '../src/editorial/assessment.mjs';
import {atomicJson} from '../src/premiere/coordinator.mjs';

const configFile=process.argv[2];
if (!configFile) throw new Error('Usage: node tools/assess-takes.mjs config.json');
const read=async f=>JSON.parse(await readFile(f,'utf8'));
const config=await read(configFile);
if (config.extraction.normalize!==false) throw new Error('Assessment must preserve original audio levels');
const source=await extractAudio(config.extraction), value=await read(config.transcriptFile);
const result=assessTakes({script:validateScript(await read(config.scriptFile)),transcript:value.transcript||value,
  matching:await read(config.matchingFile),audio:await readMonoWav(source.audioPath),source,
  overrides:config.overrides||{}});
await atomicJson(config.output,result);
console.log(JSON.stringify({output:config.output,measured:Object.keys(result.measurements).length,
  selected:result.passages.filter(p=>p.selected).length,review:result.review.length,issues:result.issues.length}));
