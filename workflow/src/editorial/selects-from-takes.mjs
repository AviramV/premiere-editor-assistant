import {contentState, digest, predictKeep, predictReorder, revision} from '../premiere/state.mjs';
import {verifySavedLabels, verifySavedDerivation, savedNativeRevision} from '../premiere/saved-evidence.mjs';

// These ranges are on the finished Takes timeline, not the original recording.
export function projectSelectsRanges(takesPlan, selectsPlan) {
  if (takesPlan?.kind !== 'takes' || selectsPlan?.kind !== 'selects' ||
      takesPlan.policyVersion !== 2 || selectsPlan.policyVersion !== 2 ||
      takesPlan.unresolved?.length !== 0 || selectsPlan.unresolved?.length !== 0 ||
      !takesPlan.sections?.length || !selectsPlan.sections?.length ||
      !takesPlan.planId || !selectsPlan.planId) throw new Error('Complete Takes and Selects delivery plans required');
  for (const key of ['sequenceId', 'beforeRevision', 'inventoryRevision', 'transcriptRevision', 'additionalTranscriptRevisions', 'order', 'partColors']) {
    if (digest(takesPlan[key]) !== digest(selectsPlan[key])) throw new Error('Takes and Selects plans have different provenance or part colors');
  }
  if (new Set(takesPlan.sections.map(s => s.takeId)).size !== takesPlan.sections.length ||
      new Set(takesPlan.sections.map(s => s.performanceKey)).size !== takesPlan.sections.length) throw new Error('Repeated Takes performance');
  if (selectsPlan.sections.length !== selectsPlan.order.length ||
      selectsPlan.sections.some((s, i) => s.passageId !== selectsPlan.order[i])) throw new Error('One selection per recorded part in Takes order is required');
  let previousEnd = 0n;
  return selectsPlan.sections.map(selected => {
    const matches = takesPlan.sections.filter(t => t.takeId === selected.takeId && t.passageId === selected.passageId &&
      t.performanceKey === selected.performanceKey && t.voiceSourceRevision === selected.voiceSourceRevision);
    if (matches.length !== 1) throw new Error(`Selected performance is absent or ambiguous in Takes: ${selected.takeId}`);
    const take = matches[0], a = BigInt(selected.range.startTicks), b = BigInt(selected.range.endTicks);
    if (take.keepRanges.length !== 1 || selected.keepRanges.length !== 1 ||
        digest(take.keepRanges[0]) !== digest(take.range) || digest(selected.keepRanges[0]) !== digest(selected.range) ||
        a < BigInt(take.range.startTicks) || b > BigInt(take.range.endTicks) || b <= a) {
      throw new Error(`Selected interval is not contained in usable Takes: ${selected.takeId}; reconcile the inventory before building`);
    }
    if (BigInt(take.destination.endTicks) - BigInt(take.destination.startTicks) !== BigInt(take.range.endTicks) - BigInt(take.range.startTicks)) {
      throw new Error('Takes source-to-timeline mapping changed');
    }
    const start = BigInt(take.destination.startTicks) + a - BigInt(take.range.startTicks), end = start + b - a;
    if (start < previousEnd) throw new Error('Selections would require reordering or repeated Takes footage');
    previousEnd = end;
    return {startTicks: String(start), endTicks: String(end)};
  });
}

// Prepared cameras, labels, enabled states and track mutes belong to Takes.
// Their values are inherited; their geometry and recording identity must agree
// with the revision-bound delivery plan before any duplication is dispatched.
function geometry(sequence) {
  return {frameTicks: sequence.frameTicks, width: sequence.width, height: sequence.height,
    videoDisplayFormat: sequence.videoDisplayFormat, durationTicks: sequence.durationTicks,
    tracks: sequence.tracks.map(t => ({kind: t.kind, index: t.index, name: t.name,
      clips: t.clips.map(c => Object.fromEntries(['sourceId', 'name', 'mediaPath', 'startTicks', 'endTicks', 'inTicks', 'outTicks', 'speed', 'reversed', 'timeRemapped'].map(k => [k, c[k]])))}))};
}

function bindPreparedTakes(source, takes, takesPlan) {
  const planned = predictReorder(predictKeep(source, takesPlan.keepRanges), takesPlan.reorderRanges);
  const header = s => ({...geometry(s), tracks: s.tracks.map(t => ({kind: t.kind, index: t.index, name: t.name}))});
  if (digest(header(takes)) !== digest(header(planned)) || takes.durationUnderreported || takes.reportedDurationTicks !== takes.durationTicks) {
    throw new Error('Prepared Takes geometry differs from the current delivery plan');
  }
  const sections = takesPlan.sections.map(section => {
    const expected = predictKeep(planned, [section.destination]);
    const anchorTrack = expected.tracks.find(t => t.clips.length), anchor = anchorTrack?.clips[0];
    if (!anchor) throw new Error('A Takes performance has no recorded clips');
    const actualTrack = takes.tracks.find(t => t.kind === anchorTrack.kind && t.index === anchorTrack.index);
    const duration = BigInt(section.destination.endTicks) - BigInt(section.destination.startTicks);
    const candidates = actualTrack.clips.filter(c => ['sourceId','name','inTicks','outTicks'].every(k => c[k] === anchor[k])).map(c => {
      const start = BigInt(c.startTicks) - BigInt(anchor.startTicks);
      return {startTicks: String(start), endTicks: String(start + duration)};
    }).filter(r => BigInt(r.startTicks) >= 0n && BigInt(r.endTicks) <= BigInt(takes.durationTicks) &&
      digest(geometry(predictKeep(takes, [r]))) === digest(geometry(expected)));
    if (candidates.length !== 1) throw new Error(`Prepared Takes geometry is missing or ambiguous for ${section.takeId}`);
    return {...section, destination: candidates[0]};
  });
  // Alternatives can have a different order inside their part. Every planned
  // performance must still appear exactly once, grouped by part, without gaps.
  const ordered = [...sections].sort((a,b) => BigInt(a.destination.startTicks) < BigInt(b.destination.startTicks) ? -1 : 1);
  let cursor = 0n, part = -1;
  for (const section of ordered) {
    const index = takesPlan.order.indexOf(section.passageId);
    if (BigInt(section.destination.startTicks) !== cursor || index < part) throw new Error('Prepared Takes contains gaps, repeats or changed part order');
    cursor = BigInt(section.destination.endTicks); part = index;
  }
  if (cursor !== BigInt(takes.durationTicks)) throw new Error('Prepared Takes contains unplanned footage');
  const labels = sections.flatMap(s => takes.tracks.flatMap(t => t.clips.filter(c => BigInt(c.startTicks) >= BigInt(s.destination.startTicks) &&
    BigInt(c.endTicks) <= BigInt(s.destination.endTicks)).map(c => ({kind:t.kind,track:t.index,sourceId:c.sourceId,
      startTicks:c.startTicks,endTicks:c.endTicks,inTicks:c.inTicks,labelIndex:takesPlan.partColors[s.passageId].labelIndex}))));
  return {...takesPlan, sections, labels};
}

export function planSelectsFromTakes({source, takes, takesPlan, selectsPlan}) {
  projectSelectsRanges(takesPlan, selectsPlan);
  if (source.id !== takesPlan.sequenceId || revision(source) !== takesPlan.beforeRevision || takes.id === source.id) throw new Error('Stale delivery source or invalid Takes identity');
  const bound = bindPreparedTakes(source, takes, takesPlan), ranges = projectSelectsRanges(bound, selectsPlan);
  const clean = {...takes, markers: []}, expected = predictKeep(clean, ranges);
  const independent = predictReorder(predictKeep(source, selectsPlan.keepRanges), selectsPlan.reorderRanges);
  if (digest(geometry(expected)) !== digest(geometry(independent))) throw new Error('Derived Selects would change the intended source intervals');
  return {...selectsPlan, construction: 'duplicate_takes_and_keep', sequenceId: takes.id, beforeRevision: revision(takes),
    originalSourceId: source.id, originalSourceRevision: revision(source), takesPlanId: takesPlan.planId,
    takesLabels: bound.labels,
    keepRanges: ranges, expectedRevision: revision(expected),
    sections: selectsPlan.sections.map((s, i) => ({...s, originalSourceRange: s.range, range: ranges[i], keepRanges: [ranges[i]]})),
    planId: digest({strategy: 'duplicate_takes_and_keep_v1', takes: revision(takes), takesPlan: takesPlan.planId, selectsPlan: selectsPlan.planId, ranges})};
}

export async function executeSelectsFromTakes(adapter, {sourceId, takesId, takesPlan, selectsPlan, name, prefix}) {
  const source = await adapter.inspect(sourceId), takes = await adapter.inspect(takesId);
  const plan = planSelectsFromTakes({source, takes, takesPlan, selectsPlan});
  // Read freshly saved native instances, never a user-supplied color checklist.
  const savedSource = await adapter.readSavedSequence(sourceId);
  const savedTakes = await adapter.readSavedSequence(takesId);
  const takesColors = verifySavedLabels({saved: savedTakes, sequence: takes, targets: plan.takesLabels});
  const copy = await adapter.duplicate({operationId: `${prefix}-copy`, sourceId: takesId, beforeRevision: plan.beforeRevision, name});
  let state = copy.observed;
  if (state.markers.length) {
    state = (await adapter.clearMarkers({operationId: `${prefix}-clear-takes-markers`, sequenceId: state.id, beforeRevision: revision(state)})).observed;
  }
  const kept = await (adapter.keepRangesBatched ? adapter.keepRangesBatched.bind(adapter) : adapter.keepRanges.bind(adapter))({
    operationId: `${prefix}-keep`, sequenceId: state.id, beforeRevision: revision(state), ranges: plan.keepRanges});
  state = kept.observed || kept.sequence;
  const expected = predictKeep({...takes, id: state.id, name, markers: []}, plan.keepRanges);
  if (digest(contentState(state)) !== digest(contentState(expected)) || state.durationUnderreported || state.reportedDurationTicks !== expected.durationTicks) {
    throw new Error('Derived Selects state or export duration did not verify');
  }
  for (let offset = 0; offset < plan.markers.length; offset += 200) {
    state = (await adapter.addMarkers({operationId: `${prefix}-markers-${offset / 200}`, sequenceId: state.id,
      beforeRevision: revision(state), markers: plan.markers.slice(offset, offset + 200)})).observed;
  }
  const saved = await adapter.readSavedSequence(state.id);
  const native = verifySavedDerivation({before: savedTakes, saved, takes, selects: state, ranges: plan.keepRanges});
  const colors = verifySavedLabels({saved, sequence: state, targets: selectsPlan.labels});
  const takesAfter = await adapter.inspect(takesId), sourceAfter = await adapter.inspect(sourceId);
  if (revision(takesAfter) !== revision(takes) || revision(sourceAfter) !== revision(source) ||
      savedNativeRevision(await adapter.readSavedSequence(takesId)) !== savedNativeRevision(savedTakes) ||
      savedNativeRevision(await adapter.readSavedSequence(sourceId)) !== savedNativeRevision(savedSource)) {
    throw new Error('Takes or protected source changed during Selects construction');
  }
  if (revision(await adapter.inspect(state.id)) !== revision(state)) throw new Error('Selects changed during final verification');
  return {sequenceId: state.id, name, state, kind: 'selects', planId: plan.planId, sections: plan.sections,
    unresolved: [], review: plan.sections.filter(s => s.review).map(s => s.passageId), labelsPending: [],
    construction: plan.construction, takesSequenceId: takesId, sourceRevisionPreserved: true, takesRevisionPreserved: true,
    nativeVerification: native, colorsVerified: colors.verified, takesColorsVerified: takesColors.verified,
    acceptancePending: ['proxy_review_render', 'save_close_reopen']};
}
