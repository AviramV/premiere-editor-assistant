import {chooseDialogueSources,audioTrackActions} from './audio-selection.mjs';
import {revision,digest,locateInstance,predictCuts} from '../premiere/state.mjs';
import {secondsToTicks,ticksToSeconds} from '../core/timing.mjs';

const locator=(track,clip)=>({kind:'audio',track:track.index,sourceId:clip.sourceId,startTicks:clip.startTicks,endTicks:clip.endTicks,inTicks:clip.inTicks,outTicks:clip.outTicks});

export function planAudioCleanup({sequence,segments,overrides={}}) {
  if(!Array.isArray(segments)||segments.length>300) throw new Error('Bounded audio segments required');
  let previous=0n;const ids=new Set(),bound=[];
  for(const segment of segments) {
    const start=secondsToTicks(segment.start),end=secondsToTicks(segment.end);
    if(!segment.id||ids.has(segment.id)||start<previous||start>=end||end>BigInt(sequence.durationTicks)||start%BigInt(sequence.frameTicks)||end%BigInt(sequence.frameTicks)) throw new Error('Audio segments must be unique, ordered, disjoint and frame aligned');
    ids.add(segment.id);previous=end;
    if(!Array.isArray(segment.sources)||segment.sources.some(s=>typeof s.id!=='string'||!s.id)||new Set(segment.sources.map(s=>s.id)).size!==segment.sources.length) throw new Error('Audio source IDs must be unique within a segment');
    const sources=segment.sources.map(source=>{
      if(source.locator?.kind!=='audio'||source.track!==source.locator.track) throw new Error('Exact audio source locator required');
      const clip=locateInstance(sequence,source.locator),track=sequence.tracks.find(t=>t.kind==='audio'&&t.index===source.track);
      if(clip.endTicks!==source.locator.endTicks||clip.outTicks!==source.locator.outTicks||start<BigInt(clip.startTicks)||end>BigInt(clip.endTicks)) throw new Error('Audio segment extends beyond its source clip');
      if(source.role==='dialogue'&&source.roleConfidence>=0.8&&(!clip.enabled||track.muted)) throw new Error('Verified dialogue source is already disabled or muted; explicit state review required');
      const exact=locator(track,clip);return {...source,locator:exact,clipId:digest(exact)};
    });
    bound.push({...segment,sources});
  }
  if(Object.keys(overrides).some(id=>!ids.has(id))) throw new Error('Audio override references an unknown segment');
  const selection=chooseDialogueSources(bound,overrides);
  const tracks=sequence.tracks.filter(t=>t.kind==='audio').map(t=>({index:t.index,clips:t.clips.map(c=>({id:digest(locator(t,c)),start:ticksToSeconds(c.startTicks),end:ticksToSeconds(c.endTicks)}))}));
  const trackPolicy=audioTrackActions(tracks,bound,selection.decisions).map(action=>sequence.tracks.find(t=>t.kind==='audio'&&t.index===action.track).locked?{...action,action:'preserve_track',reason:'Locked track retained'}:action);
  const disabled=[];const cutTicks=new Set();
  for(let i=0;i<bound.length;i++) {
    const segment=bound[i],decision=selection.decisions[i],a=secondsToTicks(segment.start),b=secondsToTicks(segment.end);
    for(const source of segment.sources.filter(s=>decision.disabledSourceIds.includes(s.id))) {
      const clip=locateInstance(sequence,source.locator);
      disabled.push({source,segment,start:a,end:b});
      if(a>BigInt(clip.startTicks))cutTicks.add(String(a));if(b<BigInt(clip.endTicks))cutTicks.add(String(b));
    }
  }
  const cuts=[...cutTicks].sort((a,b)=>BigInt(a)<BigInt(b)?-1:1),split=predictCuts(sequence,cuts),clips=new Map();
  for(const item of disabled) {
    const track=split.tracks.find(t=>t.kind==='audio'&&t.index===item.source.track),original=locateInstance(sequence,item.source.locator);
    for(const clip of track.clips.filter(c=>c.sourceId===original.sourceId&&BigInt(c.startTicks)>=item.start&&BigInt(c.endTicks)<=item.end&&BigInt(c.inTicks)===BigInt(original.inTicks)+BigInt(c.startTicks)-BigInt(original.startTicks))) {
      const target={...locator(track,clip),enabled:false};clips.set(digest(locator(track,clip)),target);
    }
  }
  const states={clips:[...clips.values()],tracks:trackPolicy.filter(t=>t.action==='mute_redundant').map(t=>({track:t.track,muted:true}))};
  if(states.clips.length+states.tracks.length>300)throw new Error('Audio state plan exceeds the bounded host limit');
  return {schemaVersion:1,kind:'audio_cleanup',sequenceId:sequence.id,beforeRevision:revision(sequence),selection,trackPolicy,cutTicks:cuts,states,
    emptyTracks:trackPolicy.filter(t=>t.action==='delete_empty').map(t=>t.track).sort((a,b)=>b-a),
    planId:digest({sequence:revision(sequence),segments:bound,overrides,policyVersion:1})};
}

export async function executeAudioCleanup(adapter,{plan,prefix}) {
  if(plan.kind!=='audio_cleanup'||!prefix)throw new Error('Exact audio cleanup plan and operation prefix required');
  let state=await adapter.inspect(plan.sequenceId,{active:true,editable:true});
  if(revision(state)!==plan.beforeRevision)throw new Error('Stale audio cleanup plan');
  const steps=[];
  for(let i=0;i<plan.cutTicks.length;i+=16) {
    const result=await adapter.cutBoundaries({operationId:`${prefix}-cut-${i/16}`,sequenceId:state.id,beforeRevision:revision(state),cutTicks:plan.cutTicks.slice(i,i+16)});steps.push(result);state=result.observed;
  }
  if(plan.states.clips.length||plan.states.tracks.length) {
    const result=await adapter.setAudioStates({operationId:`${prefix}-states`,sequenceId:state.id,beforeRevision:revision(state),...plan.states});steps.push(result);state=result.observed;
  }
  for(const track of plan.emptyTracks) {
    const result=await adapter.removeEmptyAudioTrack({operationId:`${prefix}-empty-${track}`,sequenceId:state.id,beforeRevision:revision(state),track});steps.push(result);state=result.observed;
  }
  return {status:steps.length?'verified':'preserved_for_review',sequenceId:state.id,state,planId:plan.planId,decisions:plan.selection.decisions,unresolved:plan.selection.unresolved,steps};
}
