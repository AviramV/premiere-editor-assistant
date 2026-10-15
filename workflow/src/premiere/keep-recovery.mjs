import {contentState,digest,predictCuts,revision} from './state.mjs';

// A successful ripple can leave touching keep ranges as one native clip. Only
// the exact expected state obtainable by splitting those clips is recoverable.
export function classifyMergedKeep(entry,observed) {
  if(!entry||!['indeterminate','dispatched'].includes(entry.status)||!entry.response?.ranges?.length||entry.hostError||entry.sequenceId!==observed.id||entry.expected?.id!==observed.id)throw new Error('No matching uncertain completed keep operation');
  if(observed.durationUnderreported||observed.reportedDurationTicks!==entry.expected.durationTicks)throw new Error('Keep duration is unverified');
  const boundaries=[...new Set(entry.expected.tracks.flatMap(t=>t.clips.map(c=>c.endTicks)))].filter(p=>BigInt(p)>0n&&BigInt(p)<BigInt(observed.durationTicks));
  const cuts=boundaries.filter(p=>observed.tracks.some(t=>t.clips.some(c=>BigInt(c.startTicks)<BigInt(p)&&BigInt(c.endTicks)>BigInt(p))));
  if(!cuts.length||cuts.length>300||cuts.some(p=>BigInt(p)%BigInt(observed.frameTicks)))throw new Error('No bounded missing performance cuts');
  const expected=predictCuts(observed,cuts);
  if(digest(contentState(expected))!==digest(contentState(entry.expected)))throw new Error('Result differs beyond the missing performance cuts');
  return {kind:'split_merged_performance_boundaries',sequenceId:observed.id,beforeRevision:revision(observed),cutTicks:cuts,expected:entry.expected};
}
