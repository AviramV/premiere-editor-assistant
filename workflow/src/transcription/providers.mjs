import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { run } from '../core/process.mjs';
import { atomicJson } from '../premiere/coordinator.mjs';

export async function elevenLabsKey({ credentialFile, credentialServer = 'elevenlabs' } = {}) {
  if (process.env.ELEVENLABS_API_KEY) return process.env.ELEVENLABS_API_KEY;
  if (!credentialFile) throw new Error('ElevenLabs API key unavailable');
  const config = JSON.parse(await readFile(credentialFile, 'utf8'));
  const key = config.mcpServers?.[credentialServer]?.env?.ELEVENLABS_API_KEY;
  if (!key) throw new Error('ElevenLabs API key unavailable');
  return key;
}

export async function scribe({ audioPath, rawOutput, credentials, model = 'scribe_v2', fetchImpl = fetch, timeoutMs = 600000 }) {
  const key = await elevenLabsKey(credentials);
  const form = new FormData();
  form.set('file', new Blob([await readFile(audioPath)], { type: 'audio/wav' }), path.basename(audioPath));
  form.set('model_id', model);
  form.set('language_code', 'en');
  form.set('timestamps_granularity', 'word');
  form.set('tag_audio_events', 'false');
  form.set('diarize', 'true');
  // Retain false starts and repeated words for take identification.
  form.set('no_verbatim', 'false');
  const response = await fetchImpl('https://api.elevenlabs.io/v1/speech-to-text', {
    method: 'POST', headers: { 'xi-api-key': key }, body: form, signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`ElevenLabs transcription failed with HTTP ${response.status}`);
  const raw = await response.json();
  await atomicJson(rawOutput, raw);
  return raw;
}

export async function localWhisper({ audioPath, rawOutput, python, helper, model = 'mlx-community/whisper-small.en-mlx', initialPrompt = '', cacheDirectory = path.resolve('.local/huggingface') }) {
  await run(python, [helper, '--audio', audioPath, '--output', rawOutput, '--model', model, '--prompt', initialPrompt], {
    timeoutMs: 3600000, maxBytes: 8 * 1024 * 1024,
    env: { ...process.env, HF_HOME: cacheDirectory } });
  return JSON.parse(await readFile(rawOutput, 'utf8'));
}
