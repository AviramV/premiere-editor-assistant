import {digest,revision,predictKeep,predictReorder} from '../premiere/state.mjs';
import {wordInterval} from '../transcription/schema.mjs';
import {compileSections,executeAssembly} from './assembly.mjs';
import {editorStartFromPreview} from './editor-boundary.mjs';
import {leadingWordNeedsReview,audioStartFromOnset} from './speech-boundary.mjs';
import {LABELS} from './organizer.mjs';
import {projectSelectsRanges} from './selects-from-takes.mjs';

// Delivery consumes an explicit inventory of independent recorded parts. Script
// retrieval candidates (including cross-part aliases) are not that inventory.
export const DELIVERY_POLICY_VERSION=2;
export const DELIVERY_POLICY=Object.freeze({outputs:['Takes','Selects'],hooksFirst:true,allRecordedParts:true,
  takes:'all_assessed_usable_attempts',headFrames:4,extraTailFrames:4,wording:'on_topic_variants_included',transcription:'main_voice_only'});

function boundary(transcript,take,placement,frameTicks,selected,extraTailFrames,sequenceRevision) {
  const words=selected&&take.selectedWords?take.selectedWords:take.usableWords;
  const first=words?words.first:take.firstWord;
  const last=words?words.last:take.lastWord;
  if(first<take.firstWord||last>take.lastWord||last<first) throw new Error('Usable excerpt words must belong to the recorded take');
  // Keeping a whole performance does not cut at collapsed interior words.
  // Its outer and neighboring boundaries still require valid timing.
  const outerTranscript={...transcript,issues:transcript.issues.filter(i=>i.wordIndex<=first||i.wordIndex>=last)};
  const range=wordInterval(outerTranscript,first,last,placement,frameTicks,{headFrames:selected?(take.selectedHeadFrames??4):4,tailFrames:4+extraTailFrames});
  let editorBoundary=null;
  const cutBoundary=selected&&take.selectedBoundary?take.selectedBoundary:take.usableBoundary;
  if(leadingWordNeedsReview(transcript.words[first])&&!cutBoundary)throw new Error(`${take.id}: leading-word timing requires audio or editor boundary review`);
  if(cutBoundary) {
    const context={sequenceRevision,sourceRevision:transcript.sourceRevision,performanceKey:take.performanceKey,placement,frameTicks,range};
    const resolved=cutBoundary.kind==='audio_onset'?audioStartFromOnset(cutBoundary,context):editorStartFromPreview(cutBoundary,context);
    if(BigInt(resolved.startTicks)>=BigInt(range.endTicks))throw new Error('Editor trim leaves no performance');
    Object.assign(range,{startTicks:resolved.startTicks,start:resolved.start});editorBoundary=resolved.evidence;
  }
  return {range,editorBoundary,firstWord:first,lastWord:last,text:transcript.words.slice(first,last+1).map(w=>w.text).join(' ')};
}

export function planDelivery({sequence,transcript,placement,inventory,voiceSources=[]}, {extraTailFrames=4,takesBoundaryMode='strict'}={}) {
  if(takesBoundaryMode!=='strict')throw new Error('Uncut uncertain contexts belong to internal analysis; delivery requires usable boundaries');
  if(!Number.isInteger(extraTailFrames)||extraTailFrames<3||extraTailFrames>5) throw new Error('Three to five extra tail frames required');
  if(inventory.sourceRevision!==revision(sequence)||inventory.transcriptRevision!==transcript.revision) throw new Error('Stale recorded-part inventory');
  if(sequence.markers?.length) throw new Error('Delivery starts from an unmarked source duplicate');
  if(!sequence.tracks.some(t=>t.clips.some(c=>digest(c)===digest(placement)))) throw new Error('Delivery placement is not from this source');
  const contexts=[{transcript,placement},...voiceSources],sourceKeys=new Set();
  for(const context of contexts) {
    const key=context.transcript.sourceRevision;
    if(sourceKeys.has(key))throw new Error('Ambiguous voice source placement');sourceKeys.add(key);
    if(!sequence.tracks.some(t=>t.clips.some(c=>digest(c)===digest(context.placement))))throw new Error('Voice source placement is not from this source');
    if(context.transcript!==transcript&&inventory.additionalTranscriptRevisions?.[key]!==context.transcript.revision)throw new Error('Stale additional voice transcript');
  }
  const parts=inventory.parts;
  if(!parts?.length||new Set(parts.map(p=>p.id)).size!==parts.length) throw new Error('Unique recorded parts required');
  const ids=new Set(),performances=new Set();
  for(const part of parts) {
    if(!part.id||typeof part.hook!=='boolean'||!part.identityEvidence||!part.takes?.length) throw new Error('Every recorded part requires its identity evidence and takes');
    if(!part.takes.some(t=>t.id===part.selectedTakeId&&t.usability?.status==='usable')) throw new Error(`Usable selected take missing for ${part.id}; delivery cannot omit a part`);
    for(const take of part.takes) {
      if(!['usable','excluded','review'].includes(take.usability?.status)||!take.usability.reason?.trim())throw new Error('Explicit take usability assessment and reason required');
      if(ids.has(take.id)||!take.performanceKey||performances.has(take.performanceKey)) throw new Error('Duplicate recorded performance or take ID');
      ids.add(take.id);performances.add(take.performanceKey);
      if(!sourceKeys.has(take.sourceRevision)) throw new Error('Recorded take source mismatch');
    }
  }
  const order=[...parts.filter(p=>p.hook),...parts.filter(p=>!p.hook)];
  const plans={};
  for(const kind of ['takes','selects']) {
    const excludedTakes=order.flatMap(part=>part.takes.filter(t=>t.usability.status!=='usable').map(t=>({passageId:part.id,takeId:t.id,...t.usability})));
    const sections=order.flatMap(part=>part.takes.filter(t=>t.usability.status==='usable'&&(kind==='takes'||t.id===part.selectedTakeId)).map(take=>{
      const selected=kind==='selects';
      const context=contexts.find(c=>c.transcript.sourceRevision===take.sourceRevision);
      const b=boundary(context.transcript,take,context.placement,sequence.frameTicks,selected,extraTailFrames,revision(sequence));
      return {passageId:part.id,takeId:take.id,voiceSourceRevision:take.sourceRevision,performanceKey:take.performanceKey,...b,keepRanges:[b.range],
        chosen:take.id===part.selectedTakeId,review:take.review!==false,confidence:take.confidence||'provisional',
        identityEvidence:part.identityEvidence,wordingDeviation:take.wordingDeviation||null};
    }));
    const compiled=compileSections(sequence,sections),expected=predictReorder(predictKeep(sequence,compiled.keepRanges),compiled.reorderRanges);
    const markers=sections.flatMap(group=>(group.retainedMembers||[group]).map(s=>({name:`${s.passageId} / ${s.takeId}${s.chosen?' / selected':''}${s.review?' [review]':''}`,
      comments:`${s.text}\n${s.wordingDeviation||''}\n${group.contextReview?'Retained uncut review context: '+group.contextReview.memberTakeIds.join(', '): ""}`.slice(0,2000),startTicks:group.destination.startTicks,endTicks:group.destination.endTicks,color:order.findIndex(p=>p.id===s.passageId)%8})));
    const labels=sections.flatMap(s=>expected.tracks.flatMap(t=>t.clips.filter(c=>BigInt(c.startTicks)>=BigInt(s.destination.startTicks)&&BigInt(c.endTicks)<=BigInt(s.destination.endTicks)).map(c=>({kind:t.kind,track:t.index,sourceId:c.sourceId,startTicks:c.startTicks,endTicks:c.endTicks,inTicks:c.inTicks,labelIndex:order.findIndex(p=>p.id===s.passageId)%LABELS.length}))));
    plans[kind]={schemaVersion:2,kind,excludedTakes,partColors:Object.fromEntries(order.map((p,i)=>[p.id,{labelIndex:i%LABELS.length,labelName:LABELS[i%LABELS.length]}])),policyVersion:DELIVERY_POLICY_VERSION,sequenceId:sequence.id,beforeRevision:revision(sequence),
      takesBoundaryMode,transcriptRevision:transcript.revision,additionalTranscriptRevisions:inventory.additionalTranscriptRevisions||{},inventoryRevision:digest(inventory),order:order.map(p=>p.id),sections,markers,labels,unresolved:[],...compiled,
      planId:digest({policy:DELIVERY_POLICY,source:revision(sequence),transcript:transcript.revision,inventory,kind,extraTailFrames,takesBoundaryMode})};
  }
  plans.selects.construction={strategy:'duplicate_takes_and_keep',takesPlanId:plans.takes.planId,
    ranges:projectSelectsRanges(plans.takes,plans.selects)};
  return {policy:DELIVERY_POLICY,plans,revision:digest(plans)};
}

export async function executeDeliverySequence(adapter,request) {
  if(request.plan.kind!=='takes'||request.plan.policyVersion!==DELIVERY_POLICY_VERSION||request.plan.unresolved.length) throw new Error('Exact complete delivery Takes plan required; derive Selects from prepared Takes');
  const result=await executeAssembly(adapter,request);let state=result.state;
  for(let offset=0;offset<request.plan.markers.length;offset+=200) {
    const marked=await adapter.addMarkers({operationId:`${request.prefix}-markers-${offset/200}`,sequenceId:result.sequenceId,beforeRevision:revision(state),markers:request.plan.markers.slice(offset,offset+200)});state=marked.observed;
  }
  return {...result,state,kind:request.plan.kind,labelsPending:request.plan.labels};
}
