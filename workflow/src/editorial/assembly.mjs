import {digest,revision,predictKeep,predictReorder} from '../premiere/state.mjs';
import {wordInterval,WORD_BOUNDARY_VERSION} from '../transcription/schema.mjs';
import {planPacing,pacingKeepRanges} from './pacing.mjs';

export function planAssembly({sequence,script,transcript,matching,assessment,placement,order=script.passages.map(p=>p.id),handlesFrames=4,pacingMode='natural',pacingDecisions=[]}) {
  if(sequence.markers?.length) throw new Error('Assembly starts from an unmarked source duplicate');
  if(matching.scriptRevision!==script.revision||matching.transcriptRevision!==transcript.revision||
    assessment.scriptRevision!==script.revision||assessment.transcriptRevision!==transcript.revision||assessment.matchingRevision!==digest(matching)) throw new Error('Stale assembly analysis');
  if(!sequence.tracks.some(t=>t.clips.some(c=>digest(c)===digest(placement)))) throw new Error('Assembly placement is not from this source sequence');
  if(!order.length||new Set(order).size!==order.length||order.some(id=>!script.passages.some(p=>p.id===id))) throw new Error('Invalid script passage order');
  const sections=[],unresolved=[];
  for(const passageId of order) {
    const decision=assessment.passages.find(p=>p.passageId===passageId),take=matching.takes.find(t=>t.id===decision?.selected&&t.passageId===passageId);
    if(!take||!take.automaticEligible) {unresolved.push({passageId,code:'no_complete_verified_take',candidateTakeId:take?.id||null});continue;}
    if(take.sourceRevision!==transcript.sourceRevision) throw new Error('Assembly take source identity mismatch');
    let range;
    try {range=wordInterval(transcript,take.firstWord,take.lastWord,placement,sequence.frameTicks,handlesFrames);}
    catch(error) {unresolved.push({passageId,takeId:take.id,code:'word_boundary_requires_review',reason:error.message});continue;}
    const pacing=planPacing({transcript,firstWord:take.firstWord,lastWord:take.lastWord,placement,frameTicks:sequence.frameTicks,mode:pacingMode,decisions:pacingDecisions});
    const keepRanges=pacingKeepRanges(range,pacing.removals);
    sections.push({passageId,takeId:take.id,performanceKey:take.performanceKey,range,keepRanges,pacing,confidence:decision.confidence,review:decision.review||pacing.issues.length>0,
      alternatives:decision.alternatives,firstWord:take.firstWord,lastWord:take.lastWord,text:take.text});
  }
  if(!sections.length) throw new Error('No verified complete performances to assemble');
  const compiled=compileSections(sequence,sections);
  return {schemaVersion:1,kind:'assembly',sequenceId:sequence.id,beforeRevision:revision(sequence),scriptRevision:script.revision,
    transcriptRevision:transcript.revision,assessmentRevision:assessment.revision,order,sections,...compiled,unresolved,
    pacingMode,pacingReview:sections.flatMap(s=>s.pacing.issues.map(issue=>({passageId:s.passageId,...issue}))),
    planId:digest({wordBoundaryVersion:WORD_BOUNDARY_VERSION,sequence:revision(sequence),script:script.revision,transcript:transcript.revision,assessment:assessment.revision,order,handlesFrames,pacingMode,pacingDecisions})};
}

export function compileSections(sequence,sections) {
  if(!sections.length) throw new Error('No verified complete performances to assemble');
  const chronological=[...sections].sort((a,b)=>BigInt(a.range.startTicks)<BigInt(b.range.startTicks)?-1:1);
  let sourceEnd=0n,destination=0n;
  for(const s of chronological) {
    if(BigInt(s.range.startTicks)<sourceEnd) throw new Error('Selected performances or their handles overlap; resolve boundaries before assembly');
    sourceEnd=BigInt(s.range.endTicks);
    const duration=s.keepRanges.reduce((n,r)=>n+BigInt(r.endTicks)-BigInt(r.startTicks),0n);
    s.compacted={startTicks:String(destination),endTicks:String(destination+duration)};destination+=duration;
  }
  const keepRanges=chronological.flatMap(s=>s.keepRanges),reorderRanges=sections.map(s=>s.compacted);
  const compacted=predictKeep(sequence,keepRanges),expected=predictReorder(compacted,reorderRanges);
  let start=0n;
  for(const s of sections) {const duration=s.keepRanges.reduce((n,r)=>n+BigInt(r.endTicks)-BigInt(r.startTicks),0n);s.destination={startTicks:String(start),endTicks:String(start+duration)};start+=duration;}
  return {keepRanges,reorderRanges,durationTicks:String(start),expectedRevision:revision(expected)};
}

export async function executeAssembly(adapter,{sourceId,sourceRevision,name,plan,prefix}) {
  if(plan.sequenceId!==sourceId||plan.beforeRevision!==sourceRevision) throw new Error('Assembly plan does not match source revision');
  const copy=await adapter.duplicate({operationId:`${prefix}-copy`,sourceId,beforeRevision:sourceRevision,name});
  const kept=await (adapter.keepRangesBatched?adapter.keepRangesBatched.bind(adapter):adapter.keepRanges.bind(adapter))({operationId:`${prefix}-keep`,sequenceId:copy.sequenceId,beforeRevision:revision(copy.observed),ranges:plan.keepRanges});
  const state=kept.observed||kept.sequence;
  const ordered=await adapter.reorderBlocks({operationId:`${prefix}-order`,sequenceId:copy.sequenceId,beforeRevision:revision(state),ranges:plan.reorderRanges});
  const original=await adapter.inspect(sourceId);
  if(revision(original)!==sourceRevision) throw new Error('Assembly source preservation mismatch');
  return {sequenceId:copy.sequenceId,name,state:ordered.observed,sourceRevisionPreserved:true,planId:plan.planId,
    sections:plan.sections,unresolved:plan.unresolved,review:plan.sections.filter(s=>s.review).map(s=>s.passageId)};
}
