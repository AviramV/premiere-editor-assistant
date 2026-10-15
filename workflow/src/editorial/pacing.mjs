import {digest} from '../premiere/state.mjs';
import {secondsToTicks,sourceToTimeline,snapTicks,ticksToSeconds} from '../core/timing.mjs';

export const PACING={natural:{threshold:1.2,target:0.5},tight:{threshold:0.6,target:0.25}};

export function gapIdentity(transcript,afterWord) {
  const left=transcript.words[afterWord],right=transcript.words[afterWord+1];
  if(!left||!right) throw new Error('Invalid pacing word pair');
  return digest({source:transcript.sourceRevision,transcript:transcript.revision,afterWord,start:left.end,end:right.start});
}

// Intent is an editorial decision. Silence alone cannot establish that a pause
// is nonexpressive; explicit classification and a bounded silent interval are
// required before any part of a pause is removed.
export function planPacing({transcript,firstWord,lastWord,placement,frameTicks,mode='natural',decisions=[]}) {
  if(!Object.hasOwn(PACING,mode)) throw new Error('Unknown pacing mode');
  if(!Number.isInteger(firstWord)||!Number.isInteger(lastWord)||firstWord<0||lastWord<firstWord||lastWord>=transcript.words.length) throw new Error('Invalid pacing word selection');
  const frame=BigInt(frameTicks),settings=PACING[mode],gaps=[],removals=[],issues=[];
  if(frame<=0n) throw new Error('Positive pacing timebase required');
  const byId=new Map();
  for(const decision of decisions) {
    if(byId.has(decision.gapId)||!['nonexpressive','breath','emphasis','unknown'].includes(decision.classification)) throw new Error('Invalid or repeated pacing decision');
    byId.set(decision.gapId,decision);
  }
  for(let i=firstWord;i<lastWord;i++) {
    const left=transcript.words[i],right=transcript.words[i+1],id=gapIdentity(transcript,i);
    const gapTicks=secondsToTicks(right.start)-secondsToTicks(left.end),duration=ticksToSeconds(gapTicks);
    if(gapTicks<0n) throw new Error('Unordered pacing word timing');
    if(gapTicks<=secondsToTicks(settings.threshold)) continue;
    const decision=byId.get(id),gap={gapId:id,afterWord:i,sourceStart:left.end,sourceEnd:right.start,duration,
      classification:decision?.classification||'unknown',retainedDuration:duration};
    gaps.push(gap);
    if((transcript.issues||[]).some(issue=>issue.wordIndex===i||issue.wordIndex===i+1)) {
      issues.push({gapId:id,code:'pacing_word_timing_requires_review'});continue;
    }
    if(['breath','emphasis'].includes(gap.classification)) continue;
    if(gap.classification!=='nonexpressive') {issues.push({gapId:id,code:'pause_intent_requires_review'});continue;}
    const silence=decision.silence;
    if(!silence||silence.sourceRevision!==transcript.sourceRevision||!Number.isFinite(silence.start)||!Number.isFinite(silence.end)||
      silence.start<left.end||silence.end>right.start||silence.start>=silence.end) throw new Error('Stale or invalid pacing silence evidence');
    const leftEdge=sourceToTimeline(left.end,placement),rightEdge=sourceToTimeline(right.start,placement);
    const silentStart=sourceToTimeline(silence.start,placement),silentEnd=sourceToTimeline(silence.end,placement);
    const a=snapTicks(silentStart>leftEdge+frame?silentStart:leftEdge+frame,frame,'ceil');
    const b=snapTicks(silentEnd<rightEdge-frame?silentEnd:rightEdge-frame,frame,'floor');
    const wanted=snapTicks(gapTicks-secondsToTicks(settings.target),frame,'floor'),available=b>a?b-a:0n;
    const amount=wanted<available?wanted:available;
    if(amount<=0n) {issues.push({gapId:id,code:'no_safe_silent_frame'});continue;}
    const start=a+((available-amount)/(2n*frame))*frame,end=start+amount;
    removals.push({gapId:id,startTicks:String(start),endTicks:String(end)});
    gap.retainedDuration=duration-ticksToSeconds(amount);
    if(amount<wanted) issues.push({gapId:id,code:'pause_target_limited_by_preserved_audio',retainedDuration:gap.retainedDuration});
  }
  return {mode,settings,gaps,removals,issues,revision:digest({transcript:transcript.revision,source:transcript.sourceRevision,firstWord,lastWord,mode,decisions,frameTicks})};
}

export function pacingKeepRanges(range,removals) {
  let cursor=BigInt(range.startTicks);const end=BigInt(range.endTicks),result=[];
  for(const removal of removals) {
    const a=BigInt(removal.startTicks),b=BigInt(removal.endTicks);
    if(a<cursor||a>=b||b>end) throw new Error('Pacing removals must be ordered within the performance');
    if(a>cursor) result.push({startTicks:String(cursor),endTicks:String(a)});
    cursor=b;
  }
  if(cursor<end) result.push({startTicks:String(cursor),endTicks:String(end)});
  return result;
}
