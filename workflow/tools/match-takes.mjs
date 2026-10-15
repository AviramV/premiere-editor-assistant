#!/usr/bin/env node
import {helperPath} from '../src/core/environment.mjs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { validateScript } from '../src/editorial/script.mjs';
import { identifyTakes, lexicalCandidates, semanticWindows } from '../src/editorial/matching.mjs';
import { atomicJson } from '../src/premiere/coordinator.mjs';
import { run } from '../src/core/process.mjs';

const [scriptFile, transcriptFile, outputFile, mode = 'semantic'] = process.argv.slice(2);
if (!scriptFile || !transcriptFile || !outputFile) throw new Error('Usage: node tools/match-takes.mjs script.json transcript.json output.json [semantic|lexical]');
if (!['semantic','lexical'].includes(mode)) throw new Error('Invalid matcher mode');
const script = validateScript(JSON.parse(await readFile(scriptFile, 'utf8')));
const value = JSON.parse(await readFile(transcriptFile, 'utf8'));
const transcript = value.transcript || value;
let semanticResults = [];
if (mode === 'semantic') {
  const input = `${outputFile}.semantic-input.json`, output = `${outputFile}.semantic.json`;
  await atomicJson(input, { passages: script.passages, windows: semanticWindows(transcript),
    candidates: script.passages.flatMap(p => lexicalCandidates(p, transcript)) });
  await run(process.env.PREMIERE_ASSISTANT_PYTHON || path.resolve('.local/semantic-runtime/bin/python'), [helperPath('semantic-match.py'), '--input', input,
    '--output', output, '--cache', path.resolve('.local/semantic-models')], { timeoutMs: 3600000 });
  semanticResults = JSON.parse(await readFile(output, 'utf8')).candidates;
}
const result = identifyTakes(script, transcript, semanticResults);
await atomicJson(outputFile, result);
console.log(JSON.stringify({ output: outputFile, takes: result.takes.length, unresolved: result.unresolved.length, mode }));
