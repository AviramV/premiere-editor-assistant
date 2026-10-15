import {WORD_BOUNDARY_VERSION} from '../transcription/schema.mjs';
import {digest,revision,predictKeep,predictReorder} from '../premiere/state.mjs';
import {planAssembly,compileSections,executeAssembly} from './assembly.mjs';
import {LABELS} from './organizer.mjs';

export function planSelects(input,{maxAlternatives=2,handlesFrames=4}={}) {
  const {sequence,script,transcript,matching,assessment}=input;
  if(!Number.isInteger(maxAlternatives)||maxAlternatives<0||maxAlternatives>9) throw new Error('Zero to nine Selects alternatives required');
  if(matching.scriptRevision!==script.revision||matching.transcriptRevision!==transcript.revision||assessment.matchingRevision!==digest(matching)||
    assessment.scriptRevision!==script.revision||assessment.transcriptRevision!==transcript.revision) throw new Error('Stale Selects analysis');
  const order=input.order||script.passages.map(p=>p.id),sections=[],unresolved=[],passages=[],used=new Set();
  if(!order.length||new Set(order).size!==order.length||order.some(id=>!script.passages.some(p=>p.id===id))) throw new Error('Invalid Selects passage order');
  for(const passageId of order) {
    const decision=assessment.passages.find(p=>p.passageId===passageId);
    const candidates=[...new Set([decision?.selected,...(decision?.shortlist||[])].filter(Boolean))].slice(0,maxAlternatives+1);
    const report={passageId,selected:decision?.selected||null,included:[],alternatives:decision?.alternatives||[],review:decision?.review??true};
    passages.push(report);
    for(const takeId of candidates) {
      const take=matching.takes.find(t=>t.id===takeId&&t.passageId===passageId);
      if(!take?.automaticEligible) {unresolved.push({passageId,takeId,code:'candidate_requires_boundary_or_coverage_review'});continue;}
      if(used.has(take.performanceKey)) {unresolved.push({passageId,takeId,code:'shared_performance_already_in_selects'});continue;}
      const selectedAssessment={...assessment,passages:assessment.passages.map(p=>p.passageId===passageId?{...p,selected:takeId}:p)};
      let single;
      try {single=planAssembly({...input,assessment:selectedAssessment,order:[passageId],handlesFrames,pacingDecisions:[]});}
      catch(error) {
        if(error.message!=='No verified complete performances to assemble') throw error;
        unresolved.push({passageId,takeId,code:'candidate_requires_boundary_or_coverage_review'});continue;
      }
      const section=single.sections[0];
      if(!section) {unresolved.push(...single.unresolved);continue;}
      sections.push({...section,chosen:takeId===decision.selected});used.add(take.performanceKey);report.included.push(takeId);
    }
    if(!report.included.length) unresolved.push({passageId,code:'no_complete_verified_select'});
  }
  // No word may be sacrificed to force overlapping handles into a stringout.
  const chronological=[...sections].sort((a,b)=>BigInt(a.range.startTicks)<BigInt(b.range.startTicks)?-1:1);
  for(let i=1;i<chronological.length;i++) {
    const left=chronological[i-1],right=chronological[i];
    if(BigInt(right.range.startTicks)<BigInt(left.range.endTicks)) throw new Error('Selects performance handles overlap; resolve boundaries before execution');
  }
  const compiled=compileSections(sequence,sections),expected=predictReorder(predictKeep(sequence,compiled.keepRanges),compiled.reorderRanges);
  const markers=sections.map(s=>({name:`${s.passageId} / ${s.takeId} / ${s.chosen?'chosen':'alternative'} [review]`,
    comments:`${s.text}\nPerformance: ${s.performanceKey}\nConfidence: ${s.confidence}`.slice(0,2000),
    startTicks:s.destination.startTicks,endTicks:s.destination.endTicks,color:script.passages.findIndex(p=>p.id===s.passageId)%8}));
  const labels=sections.flatMap(s=>expected.tracks.flatMap(t=>t.clips.filter(c=>BigInt(c.startTicks)>=BigInt(s.destination.startTicks)&&BigInt(c.endTicks)<=BigInt(s.destination.endTicks))
    .map(c=>({kind:t.kind,track:t.index,sourceId:c.sourceId,startTicks:c.startTicks,endTicks:c.endTicks,inTicks:c.inTicks,labelIndex:script.passages.findIndex(p=>p.id===s.passageId)%LABELS.length}))));
  return {schemaVersion:1,kind:'selects',sequenceId:sequence.id,beforeRevision:revision(sequence),scriptRevision:script.revision,
    transcriptRevision:transcript.revision,assessmentRevision:assessment.revision,sections,passages,order,unresolved,markers,labels,...compiled,
    planId:digest({wordBoundaryVersion:WORD_BOUNDARY_VERSION,kind:'selects',source:revision(sequence),script:script.revision,transcript:transcript.revision,assessment:assessment.revision,order,maxAlternatives,handlesFrames})};
}

export async function executeSelects(adapter,request) {
  if(request.plan.kind!=='selects') throw new Error('An exact Selects plan is required');
  const result=await executeAssembly(adapter,request);
  let state=result.state;
  for(let offset=0;offset<request.plan.markers.length;offset+=200) {
    const marked=await adapter.addMarkers({operationId:`${request.prefix}-markers-${offset/200}`,sequenceId:result.sequenceId,beforeRevision:revision(state),markers:request.plan.markers.slice(offset,offset+200)});
    state=marked.observed;
  }
  return {...result,state,kind:'selects',passages:request.plan.passages,labelsPending:request.plan.labels};
}
