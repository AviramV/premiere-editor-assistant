import { digest, revision, predictCuts } from '../premiere/state.mjs';
import { sourceToTimeline, snapTicks, secondsToTicks, ticksToSeconds } from '../core/timing.mjs';
import { wordInterval, WORD_BOUNDARY_VERSION } from '../transcription/schema.mjs';

export const LABELS = ['Violet','Iris','Caribbean','Lavender','Cerulean','Forest','Rose','Mango',
  'Purple','Blue','Teal','Magenta','Tan','Green','Brown','Yellow'];

// A placement is separate from a performance: the same recording can be used
// at multiple timeline positions without conflating its transcript identity.
export function planOrganization({ sequence, script, bundles, handlesFrames = 4 }) {
  const colors = Object.fromEntries(script.passages.map((p,i) => [p.id,{ index: i % LABELS.length, name: LABELS[i % LABELS.length], marker: i % 8 }]));
  const markers = [], performances = [], unresolved = [];
  for (const { transcript, matching, placement, placementId } of bundles) {
    if (matching.scriptRevision !== script.revision || matching.transcriptRevision !== transcript.revision) throw new Error('Stale script or transcript matching');
    if (!placementId || !sequence.tracks.some(t => t.clips.some(c => digest(c) === digest(placement)))) throw new Error('Placement must come from this sequence');
    const grouped = new Map();
    for (const take of matching.takes) {
      if (!colors[take.passageId] || take.sourceRevision !== transcript.sourceRevision) throw new Error('Invalid take identity');
      const key = `${placementId}:${take.performanceKey}`;
      const entry = grouped.get(key) || { key, takeIds: [], passageIds: [], takes: [] };
      entry.takeIds.push(take.id); entry.passageIds.push(take.passageId); entry.takes.push(take); grouped.set(key,entry);
    }
    for (const group of grouped.values()) {
      const take = group.takes[0];
      let start, end, range;
      const issues = group.takes.flatMap(t => t.issues || []);
      if (!group.takes.every(t => t.automaticEligible) && !issues.length) {
        issues.push({code:group.takes.some(t => t.coverageStatus === 'partial') ? 'partial_performance' : 'unverified_performance'});
      }
      try {
        start = sourceToTimeline(transcript.words[take.firstWord].start, placement);
        end = sourceToTimeline(transcript.words[take.lastWord].end, placement);
        if (end <= start) throw new Error('Performance has no positive duration');
      } catch (error) { unresolved.push({ key:group.key, takeIds: group.takeIds, code:'unmapped_performance', reason:error.message }); continue; }
      if (group.takes.every(t => t.automaticEligible)) {
        try { range = wordInterval(transcript,take.firstWord,take.lastWord,placement,sequence.frameTicks,handlesFrames); }
        catch(error) {
          issues.push({code:'word_timing_requires_review',reason:error.message});
          if (error.message.startsWith('No safe frame')) issues.push({code:'no_safe_frame_between_performances'});
        }
      }
      const passage = group.passageIds[0];
      const angles = sequence.tracks.filter(t => t.kind === 'video' && t.clips.some(c => BigInt(c.startTicks) < end && BigInt(c.endTicks) > start))
        .map(t => `${t.name} (${t.clips.some(c => c.multicam) ? 'native multicam' : 'existing camera choice'})`);
      const entry = { key:group.key, takeIds: group.takeIds, passageIds: [...new Set(group.passageIds)], startTicks:String(start), endTicks:String(end),
        range, label: colors[passage], issues, text:take.text, firstWord:take.firstWord,lastWord:take.lastWord,placementId,
        performanceKey:take.performanceKey, angles };
      if (entry.passageIds.length > 1) { entry.range = undefined; entry.issues.push({code:'ambiguous_passage_identity'}); }
      performances.push(entry);
    }
  }
  const chronological = [...performances].sort((a,b) => BigInt(a.startTicks) < BigInt(b.startTicks) ? -1 : 1);
  for (let i=0;i<chronological.length;i++) for (let j=i+1;j<chronological.length;j++) {
    const left=chronological[i], right=chronological[j];
    if (BigInt(left.endTicks) > BigInt(right.startTicks)) {
      if (!left.issues.some(x=>x.code==='overlapping_performance')) left.issues.push({code:'overlapping_performance'});
      if (!right.issues.some(x=>x.code==='overlapping_performance')) right.issues.push({code:'overlapping_performance'});
    }
  }
  const independent=chronological.filter(p=>p.range && !p.issues.length);
  for (let i=1;i<independent.length;i++) {
    const left=independent[i-1], right=independent[i];
    if (BigInt(left.range.endTicks) <= BigInt(right.range.startTicks)) continue;
    const minimum=snapTicks(left.endTicks,sequence.frameTicks,'ceil'), maximum=snapTicks(right.startTicks,sequence.frameTicks,'floor');
    if (minimum > maximum) {
      left.issues.push({code:'no_safe_frame_between_performances'});right.issues.push({code:'no_safe_frame_between_performances'});continue;
    }
    const proposed=snapTicks((BigInt(left.endTicks)+BigInt(right.startTicks))/2n,sequence.frameTicks);
    const middle=proposed<minimum?minimum:proposed>maximum?maximum:proposed;
    left.range.endTicks=String(middle); right.range.startTicks=String(middle);
  }
  const final = performances.filter(p => p.range && !p.issues.length);
  for (const entry of performances) markers.push({
    name:`${entry.takeIds.join(' / ')}${entry.range && !entry.issues.length ? '' : ' [review]'} / ${entry.angles.join(', ')}`.slice(0,255),
    comments:`${entry.text}\nPerformance ${entry.performanceKey}\n${entry.issues.map(i=>i.code).join(', ')}`.slice(0,2000),
    startTicks:String(snapTicks(entry.startTicks,sequence.frameTicks,'floor')),
    endTicks:String(snapTicks(entry.endTicks,sequence.frameTicks,'ceil')),color:entry.label.marker });
  const cutTicks=[...new Set(final.flatMap(p => [p.range.startTicks,p.range.endTicks]))].filter(p => BigInt(p)>0n && BigInt(p)<BigInt(sequence.durationTicks))
    .sort((a,b) => BigInt(a)<BigInt(b)?-1:1);
  const expected=predictCuts(sequence,cutTicks);
  const labels=final.flatMap(p => expected.tracks.flatMap(t => t.clips.filter(c => BigInt(c.startTicks)>=BigInt(p.range.startTicks) && BigInt(c.endTicks)<=BigInt(p.range.endTicks))
    .map(c => ({kind:t.kind,track:t.index,sourceId:c.sourceId,startTicks:c.startTicks,endTicks:c.endTicks,inTicks:c.inTicks,labelIndex:p.label.index,performanceKey:p.key}))));
  return { schemaVersion:1,kind:'takes',sequenceId:sequence.id,beforeRevision:revision(sequence),scriptRevision:script.revision,
    colors,performances,cutTicks,markers,labels,unresolved:[...unresolved,...performances.filter(p => p.issues.length).map(p => ({key:p.key,takeIds:p.takeIds,issues:p.issues}))],
    expectedRevision:revision(expected), planId:digest({wordBoundaryVersion:WORD_BOUNDARY_VERSION,sequence:revision(sequence),script:script.revision,bundles:bundles.map(b=>[b.transcript.revision,b.placementId,digest(b.matching)]),handlesFrames}) };
}

export async function executeOrganization(adapter, { sourceId, sourceRevision, name, plan, prefix }) {
  if (plan.sequenceId!==sourceId || plan.beforeRevision!==sourceRevision) throw new Error('Organization plan does not match the source revision');
  const copy=await adapter.duplicate({operationId:`${prefix}-copy`,sourceId,beforeRevision:sourceRevision,name});
  let state=copy.observed;
  for(let i=0;i<plan.cutTicks.length;i+=16) {
    const result=await adapter.cutBoundaries({operationId:`${prefix}-cuts-${i/16}`,sequenceId:copy.sequenceId,beforeRevision:revision(state),cutTicks:plan.cutTicks.slice(i,i+16)});
    state=result.observed;
  }
  for(let i=0;i<plan.markers.length;i+=200) {
    const result=await adapter.addMarkers({operationId:`${prefix}-markers-${i/200}`,sequenceId:copy.sequenceId,beforeRevision:revision(state),markers:plan.markers.slice(i,i+200)});
    state=result.observed;
  }
  const original=await adapter.inspect(sourceId);
  if(revision(original)!==sourceRevision) throw new Error('Source preservation mismatch');
  return {sequenceId:copy.sequenceId,name,state,sourceRevisionPreserved:true,
    labelsPending:plan.labels,unresolved:plan.unresolved,planId:plan.planId};
}
