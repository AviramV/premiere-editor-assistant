import {contentState,digest,revision} from './state.mjs';

// Recognize only the exact post-removal parking state of guarded clone reorder.
// This produces a read-only recovery plan; it never retries the original edit.
export function classifyParkedReorder(entry,observed) {
  if(!entry||!['indeterminate','dispatched'].includes(entry.status)||entry.requireReportedDuration!==true||!entry.before||!entry.expected||entry.sequenceId!==observed.id||entry.expected.id!==observed.id)throw new Error('No matching uncertain guarded reorder');
  const {before,expected}=entry;
  if(before.markers.length||expected.markers.length||observed.markers.length||before.frameTicks!==expected.frameTicks)throw new Error('Unsupported parked reorder context');
  const sourceSignature=sequence=>digest(sequence.tracks.map(t=>({kind:t.kind,index:t.index,name:t.name,muted:t.muted,locked:t.locked,
    clips:t.clips.map(({instanceId,startTicks,endTicks,...clip})=>({...clip,durationTicks:String(BigInt(endTicks)-BigInt(startTicks))})).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))})));
  if(sourceSignature(before)!==sourceSignature(expected))throw new Error('Reorder changed source content or clip states');
  const offset=BigInt(before.durationTicks)+10n*BigInt(before.frameTicks),parked=structuredClone(expected);
  for(const track of parked.tracks)for(const clip of track.clips){clip.startTicks=String(BigInt(clip.startTicks)+offset);clip.endTicks=String(BigInt(clip.endTicks)+offset);}
  parked.durationTicks=String(BigInt(expected.durationTicks)+offset);
  if(digest(contentState(parked))!==digest(contentState(observed))||observed.durationUnderreported||observed.reportedDurationTicks!==parked.durationTicks)throw new Error('Fresh state is not the complete, exact parked reorder');
  if(!observed.tracks.some(t=>t.clips.length)||observed.tracks.some(t=>t.clips.some(c=>BigInt(c.startTicks)<offset)))throw new Error('Lead-in is not empty');
  return {kind:'remove_empty_reorder_lead_in',sequenceId:observed.id,beforeRevision:revision(observed),offsetTicks:String(offset),
    expected:structuredClone(expected),expectedRevision:revision(expected),clips:observed.tracks.reduce((n,t)=>n+t.clips.length,0)};
}
