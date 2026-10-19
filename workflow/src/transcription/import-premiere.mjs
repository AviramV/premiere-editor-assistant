import path from 'node:path';
import format from './premiere-format.cjs';
import {digest} from '../premiere/state.mjs';
import {atomicJson, PremiereCoordinator} from '../premiere/coordinator.mjs';
import {PremiereUxpTransport} from '../premiere/transport.mjs';
import {probeMedia} from '../media/audio.mjs';

export function validateTranscriptTarget(target) {
  if (!target || !path.isAbsolute(target.projectPath || '') || !target.clipId ||
      typeof target.clipId !== 'string' || !path.isAbsolute(target.journalDirectory || '')) {
    throw new Error('premiere.projectPath, the observed UXP clipId and an absolute journalDirectory are required for transcript import');
  }
}

export async function importExternalTranscript({result, source, target, output,
  transport = new PremiereUxpTransport(), probe = probeMedia}) {
  validateTranscriptTarget(target);
  if (result.transcript.sourceRevision !== source.sourceRevision) throw new Error('Transcript revision belongs to different source media');
  const payload = format.toPremiereTranscript(result.transcript);
  const payloadFile = `${output}.premiere.json`, evidenceFile = `${output}.premiere-import.json`;
  await atomicJson(payloadFile, payload);
  await atomicJson(evidenceFile, {status: 'pending', payloadFile, transcriptRevision: result.transcript.revision});
  if ((await probe(source.sourcePath)).revision !== source.sourceRevision) throw new Error('Transcript source media changed before import');
  const coordinator = new PremiereCoordinator({projectPath: target.projectPath, directory: target.journalDirectory});
  const operationId = `transcript-${digest({projectPath: target.projectPath, clipId: target.clipId, payload})}`;
  const release = await coordinator.lock();
  try {
    const ledger = await coordinator.ledger();
    if (Object.values(ledger).some(entry => ['dispatched', 'indeterminate', 'ui_pending'].includes(entry.status))) {
      throw new Error('An uncertain Premiere operation blocks transcript import; inspect its journal before continuing');
    }
    await transport.connect();
    const args = {projectPath: target.projectPath, clipId: target.clipId, sourcePath: source.sourcePath, transcript: payload};
    const inspection = await transport.call('ppro_transcript_import', {...args, mode: 'inspect'});
    if (inspection.projectPath !== target.projectPath || inspection.clipId !== target.clipId || inspection.sourcePath !== source.sourcePath) {
      throw new Error('Transcript inspection target mismatch');
    }
    if (inspection.hasTranscript && !inspection.matches) throw new Error('Existing native transcript differs; reconcile before continuing');
    const entry = ledger[operationId] = {operationId, kind: 'transcript_import', projectPath: target.projectPath,
      clipId: target.clipId, transcriptRevision: result.transcript.revision, payloadFile, status: 'dispatched', startedAt: new Date().toISOString()};
    await coordinator.persist(ledger);
    try {
      const response = await transport.call('ppro_transcript_import', {...args, mode: 'import'});
      if (!response.verified || !response.saved || response.projectPath !== target.projectPath || response.clipId !== target.clipId ||
          response.sourcePath !== source.sourcePath || response.words !== result.transcript.words.length) throw new Error('Native import proof mismatch');
      entry.status = 'verified'; entry.response = response; entry.completedAt = new Date().toISOString();
      await coordinator.persist(ledger);
      await atomicJson(evidenceFile, {...entry, status: 'verified', reopenVerification: 'pending'});
      return {evidenceFile, payloadFile, ...response};
    } catch (error) {
      entry.status = 'indeterminate'; entry.error = error.message;
      await coordinator.persist(ledger);
      await atomicJson(evidenceFile, entry);
      throw new Error(`Transcript import is indeterminate: ${error.message}. Inspect native state and the journal; do not replay it automatically.`);
    }
  } finally { try { await transport.close(); } finally { await release(); } }
}
