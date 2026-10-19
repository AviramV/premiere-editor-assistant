const {sameTranscript, transcriptWords} = require('./transcript-format.js');

// Fixed operation only. Never accepts scripts, creates captions or changes media.
async function importTranscript(ppro, params) {
  const {projectPath, clipId, sourcePath, transcript, mode} = params;
  if (!projectPath || !clipId || !sourcePath || !['inspect', 'import'].includes(mode)) throw new Error('Exact transcript target and mode required');
  const words = transcriptWords(transcript);
  if (!words.length || words.length > 50000 || !sameTranscript(transcript, transcript) ||
      words.some(w => w.start < 0 || w.duration < 0)) throw new Error('Invalid bounded transcript payload');
  for (const method of ['importFromJSON', 'createImportTextSegmentsAction', 'exportToJSON', 'hasTranscript']) {
    if (typeof ppro.Transcript?.[method] !== 'function') throw new Error(`Native transcript API unavailable: ${method}`);
  }
  const project = await ppro.Project.getActiveProject();
  if (!project || project.path !== projectPath) throw new Error('Wrong transcript project');
  const matches = [];
  async function visit(folder, depth = 0) {
    if (depth > 32) throw new Error('Project bin depth exceeds transcript lookup bound');
    for (const item of await folder.getItems()) {
      const child = ppro.FolderItem.cast(item);
      if (child) await visit(child, depth + 1);
      else if (String(item.getId()) === clipId) {
        const clip = ppro.ClipProjectItem.cast(item);
        if (clip) matches.push({item, clip});
      }
    }
  }
  await visit(await project.getRootItem());
  if (matches.length !== 1) throw new Error('Transcript source item missing or ambiguous');
  const {item, clip} = matches[0];
  if (await clip.isSequence() || await clip.isMergedClip() || await clip.isMulticamClip()) {
    throw new Error('Map transcript to an original media item; nested, merged and multicam clocks require reconciliation');
  }
  const mediaPath = await clip.getMediaFilePath();
  const proxyPath = await clip.hasProxy() ? await clip.getProxyPath() : null;
  if (sourcePath !== mediaPath && sourcePath !== proxyPath) throw new Error('Transcript extraction does not match source media or attached proxy');
  const hasTranscript = await ppro.Transcript.hasTranscript(clip);
  const matchesExisting = hasTranscript && sameTranscript(await ppro.Transcript.exportToJSON(clip), transcript);
  if (mode === 'inspect') return {projectPath, clipId, sourcePath, hasTranscript, matches: Boolean(matchesExisting)};
  if (hasTranscript && !matchesExisting) throw new Error('Existing native transcript differs; reconcile rather than overwrite');
  if ((await ppro.Project.getActiveProject())?.path !== projectPath) throw new Error('Transcript project changed before import');
  if (await project.save() === false) throw new Error('Could not save project before transcript import');
  if ((await ppro.Project.getActiveProject())?.path !== projectPath) throw new Error('Transcript project changed while saving');
  if (!matchesExisting) {
    project.lockedAccess(() => {
      if (project.path !== projectPath || String(item.getId()) !== clipId || ppro.Transcript.hasTranscript(clip)) {
        throw new Error('Transcript target changed before transaction');
      }
      const action = ppro.Transcript.createImportTextSegmentsAction(ppro.Transcript.importFromJSON(JSON.stringify(transcript)), clip);
      if (project.executeTransaction(tx => tx.addAction(action), 'Assistant: import source transcript') === false) {
        throw new Error('Transcript transaction refused; inspect before retrying');
      }
    });
  }
  const verify = async () => {
    if ((await ppro.Project.getActiveProject())?.path !== projectPath ||
        !await ppro.Transcript.hasTranscript(clip) || !sameTranscript(await ppro.Transcript.exportToJSON(clip), transcript)) {
      throw new Error('Transcript readback differs; inspect before retrying');
    }
  };
  await verify();
  if (await project.save() === false) throw new Error('Transcript readback passed but project save failed');
  await verify();
  return {projectPath, clipId, sourcePath, status: matchesExisting ? 'already_present' : 'imported',
    verified: true, saved: true, words: words.length};
}

module.exports = {importTranscript};
