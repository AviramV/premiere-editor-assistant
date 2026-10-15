import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { digest } from '../premiere/state.mjs';
import { atomicJson } from '../premiere/coordinator.mjs';
import { normalizeTranscript } from './schema.mjs';

export async function transcribeWithFallback({ source, directory, providers, policy = {} }) {
  const identity = { sourceRevision: source.sourceRevision, sourceStart: source.sourceStart,
    duration: source.duration, stream: source.stream, channel: source.channel, normalized: source.normalized, policy };
  const cacheFile = path.join(directory, `${digest(identity)}.json`);
  try {
    const cached = JSON.parse(await readFile(cacheFile, 'utf8'));
    if (digest(cached.identity) === digest(identity) && cached.transcript?.sourceRevision === source.sourceRevision) {
      // Validate timing on cache reuse as well as first ingestion.
      const validated = normalizeTranscript({ words: cached.transcript.words.map(w => ({
        word: w.text, start: w.start - source.sourceStart, end: w.end - source.sourceStart,
        probability: w.confidence, speaker_id: w.speaker })) }, {
        provider: cached.transcript.provider, sourceRevision: source.sourceRevision, sourceStart: source.sourceStart,
        duration: source.duration, channel: source.channel });
      return { ...cached, transcript: { ...cached.transcript, words: validated.words, issues: validated.issues }, cached: true };
    }
  } catch (error) {
    if (error.code && !['ENOENT', 'EINVAL'].includes(error.code)) throw error;
    // Corrupt or invalid cached timing is discarded and providers run again.
  }
  const attempts = [];
  for (const provider of providers) {
    const rawOutput = path.join(directory, `${digest(identity)}.${provider.name}.raw.json`);
    try {
      const raw = await provider.run({ source, rawOutput });
      await atomicJson(rawOutput, raw);
      const transcript = normalizeTranscript(raw, { provider: provider.name, sourceRevision: source.sourceRevision,
        sourceStart: source.sourceStart, duration: source.duration, channel: source.channel });
      attempts.push({ provider: provider.name, status: 'usable', issueCount: transcript.issues.length });
      const result = { identity, transcript, attempts, rawOutput, cached: false };
      await atomicJson(cacheFile, result);
      return result;
    } catch (error) {
      // Failures do not create a transcript, and never trigger editing.
      attempts.push({ provider: provider.name, status: 'failed', error: error.message });
    }
  }
  await atomicJson(`${cacheFile}.failure.json`, { identity, attempts });
  const error = new Error('No provider supplied usable timed words');
  error.attempts = attempts;
  throw error;
}
