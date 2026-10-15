import {wordInterval} from '../transcription/schema.mjs';
import {digest} from '../premiere/state.mjs';

// Retaining an uncut review passage is different from choosing an uncertain
// word cut. Only its outer, positively timed word boundaries may be cut.
export function retainTakeContexts(sections,{transcript,placement,frameTicks,extraTailFrames=4,order}) {
  const bounded=(first,last)=>{
    const originalFirst=first,originalLast=last;let reason;
    for(let attempt=0;attempt<=40;attempt++) {
      const outer={...transcript,issues:transcript.issues.filter(i=>i.wordIndex<=first||i.wordIndex>=last)};
      try {
        const range=wordInterval(outer,first,last,placement,frameTicks,{headFrames:4,tailFrames:4+extraTailFrames});
        return {range,first,last,expanded:first!==originalFirst||last!==originalLast,reason};
      } catch(error) {
        reason=error.message;
        if(!/word timing requires review|No safe frame between neighboring words/.test(reason))throw error;
        const issues=new Set(outer.issues.map(i=>i.wordIndex));
        let left=issues.has(first)||issues.has(first-1),right=issues.has(last)||issues.has(last+1);
        if(!left&&!right){left=true;right=true;}
        const nextFirst=left&&first>0?first-1:first,nextLast=right&&last+1<transcript.words.length?last+1:last;
        if(nextFirst===first&&nextLast===last)throw new Error('No safe outer boundary for retained take context');
        first=nextFirst;last=nextLast;
        if(first<originalFirst-40||last>originalLast+40||transcript.words[last].end-transcript.words[first].start>90)throw new Error('Take context exceeds its bounded review window');
      }
    }
    throw new Error('No safe outer boundary within bounded take context');
  };
  const groups=sections.map(s=>{
    const b=bounded(s.firstWord,s.lastWord);
    return {...b,members:[s]};
  }).sort((a,b)=>BigInt(a.range.startTicks)<BigInt(b.range.startTicks)?-1:1);
  const merged=[];
  for(const group of groups) {
    const prior=merged.at(-1);
    if(prior&&BigInt(group.range.startTicks)<BigInt(prior.range.endTicks)) {
      prior.members.push(...group.members);const b=bounded(Math.min(prior.first,group.first),Math.max(prior.last,group.last));Object.assign(prior,b,{expanded:true,reason:'Overlapping review handles or retained neighboring speech; context stays uncut'});
    } else merged.push(group);
  }
  const result=merged.map(g=>{
    const ids=g.members.map(m=>m.takeId),primary=[...g.members].sort((a,b)=>order.indexOf(a.passageId)-order.indexOf(b.passageId))[0];
    const contextual=g.expanded||g.members.length>1;
    return {...primary,range:g.range,keepRanges:[g.range],firstWord:g.first,lastWord:g.last,
      takeId:contextual?`context-${digest(ids).slice(0,12)}`:primary.takeId,
      text:transcript.words.slice(g.first,g.last+1).map(w=>w.text).join(' '),
      retainedMembers:g.members,review:contextual||primary.review,
      contextReview:contextual?{kind:'uncut_review_context',reason:g.reason||'Adjacent performances retained together',memberTakeIds:ids,partIds:[...new Set(g.members.map(m=>m.passageId))],outerBoundariesVerified:true}:null};
  }).sort((a,b)=>order.indexOf(a.passageId)-order.indexOf(b.passageId)||(BigInt(a.range.startTicks)<BigInt(b.range.startTicks)?-1:1));
  const expected=sections.map(s=>s.takeId).sort(),actual=result.flatMap(g=>g.retainedMembers.map(s=>s.takeId)).sort();
  if(digest(expected)!==digest(actual))throw new Error('Retained context lost or repeated a recorded performance');
  return result;
}
