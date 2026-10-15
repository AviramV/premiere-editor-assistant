#!/usr/bin/env node
import {helperPath, pythonPath} from '../src/core/environment.mjs';
import { readFile } from 'node:fs/promises';
import { extractAudio } from '../src/media/audio.mjs';
import { transcribeWithFallback } from '../src/transcription/pipeline.mjs';
import { scribe, localWhisper } from '../src/transcription/providers.mjs';
import { atomicJson } from '../src/premiere/coordinator.mjs';

const configFile = process.argv[2];
if (!configFile) throw new Error('Usage: node tools/transcribe.mjs config.json');
const config = JSON.parse(await readFile(configFile, 'utf8'));
const source = await extractAudio(config.extraction);
await atomicJson(`${source.audioPath}.source.json`, source);
console.log(JSON.stringify({ phase: 'extracted', ...source }));
const providers = [];
for (const provider of config.providers) {
  if (provider.name === 'existing') providers.push({ name: 'existing', run: async () => JSON.parse(await readFile(provider.path, 'utf8')) });
  else if (provider.name === 'scribe') providers.push({ name: 'scribe', run: async ({ rawOutput }) => scribe({ audioPath: source.audioPath, rawOutput, credentials: provider.credentials, model: provider.model }) });
  else if (provider.name === 'mlx-whisper') providers.push({ name: 'mlx-whisper', run: async ({ rawOutput }) => localWhisper({ audioPath: source.audioPath, rawOutput,
    python: provider.python || pythonPath(), helper: helperPath('local-transcribe.py'), model: provider.model, initialPrompt: provider.initialPrompt }) });
  else throw new Error(`Unknown transcript provider: ${provider.name}`);
}
const result = await transcribeWithFallback({ source, directory: config.cacheDirectory, providers,
  policy: { providers: config.providers.map(({ credentials, ...p }) => p), schemaVersion: 1 } });
await atomicJson(config.output, result);
console.log(JSON.stringify({ phase: 'transcribed', provider: result.transcript.provider,
  words: result.transcript.words.length, issues: result.transcript.issues.length, cached: result.cached, output: config.output }));
