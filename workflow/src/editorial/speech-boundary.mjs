import {sourceToTimeline,snapTicks,ticksToSeconds} from '../core/timing.mjs';

// Recognition confidence describes the text match, not a measured voice onset.
// These outer-word anomalies must be reconciled before they become edit points.
export function leadingWordNeedsReview(word) {
  if(!Number.isFinite(word?.confidence))return false;
  return word.confidence<0.25||(word.confidence<0.8&&word.end-word.start>0.8);
}

export function audioStartFromOnset(boundary,{sequenceRevision,sourceRevision,performanceKey,placement,frameTicks,range}) {
  if(boundary.kind!=='audio_onset'||boundary.sequenceRevision!==sequenceRevision||boundary.sourceRevision!==sourceRevision||boundary.performanceKey!==performanceKey||!boundary.reference||!/^([a-f0-9]{64})$/.test(boundary.audioSha256||''))throw new Error('Current revision-bound voice-onset evidence required');
  if(!Number.isInteger(boundary.channel)||boundary.channel<0||!Number.isInteger(boundary.headFrames)||boundary.headFrames<0||boundary.headFrames>5||!Number.isFinite(boundary.onsetSourceSeconds))throw new Error('Measured voice onset and bounded head handle required');
  const frame=BigInt(frameTicks),onset=sourceToTimeline(boundary.onsetSourceSeconds,placement),start=snapTicks(onset,frame,'floor')-BigInt(boundary.headFrames)*frame;
  if(onset<BigInt(range.startTicks)||onset>=BigInt(range.endTicks)||start<BigInt(range.startTicks)||start>=BigInt(range.endTicks))throw new Error('Voice onset lies outside the reviewed performance');
  return {startTicks:String(start),start:ticksToSeconds(start),evidence:boundary};
}
