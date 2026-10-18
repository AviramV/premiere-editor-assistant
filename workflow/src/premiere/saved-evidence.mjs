import {locateInstance,digest,predictKeep} from './state.mjs';

// Native labels, multicamera choices, channel groups and effect fingerprints
// must follow the retained instances, including trims within a performance.
export function verifySavedDerivation({before,saved,takes,selects,ranges}) {
  if(before.sequenceId!==takes.id||before.name!==takes.name||saved.sequenceId!==selects.id||saved.name!==selects.name)throw new Error('Wrong native derivation identity');
  if(before.schemaVersion!==2||saved.schemaVersion!==2||[before,saved].some(s=>s.tracks.some(t=>t.clips.some(c=>!/^[a-f0-9]{64}$/.test(c.effectFingerprint||'')))))throw new Error('Fresh saved effect evidence required for native derivation');
  const expected=predictKeep({...before,frameTicks:takes.frameTicks,durationTicks:takes.durationTicks},ranges);
  expected.sequenceId=selects.id;expected.name=selects.name;
  if(savedNativeRevision(expected)!==savedNativeRevision(saved))throw new Error('Inherited native colors, cameras, channels, effects or source clocks changed');
  return {sequenceId:selects.id,takesSequenceId:takes.id,projectSha256:saved.projectSha256,
    verified:saved.tracks.reduce((n,t)=>n+t.clips.length,0)};
}

export function verifySavedLabels({saved,sequence,targets}) {
  if(saved.sequenceId!==sequence.id||saved.name!==sequence.name) throw new Error('Wrong saved sequence identity');
  const checks=[];
  for(const target of targets) {
    const current=locateInstance(sequence,target);
    const track=saved.tracks.find(t=>t.kind===target.kind&&t.index===target.track);
    const matches=(track?.clips||[]).filter(c=>c.sourceName===current.name&&
      c.startTicks===target.startTicks&&c.endTicks===target.endTicks&&c.inTicks===target.inTicks);
    if(matches.length!==1) throw new Error('Saved clip is absent or ambiguous');
    if(matches[0].labelIndex!==target.labelIndex) throw new Error('Saved timeline label does not match requested passage color');
    checks.push({kind:target.kind,track:target.track,startTicks:target.startTicks,sourceMasterUid:matches[0].sourceMasterUid,labelIndex:matches[0].labelIndex});
  }
  return {sequenceId:sequence.id,projectSha256:saved.projectSha256,verified:checks.length,checks};
}

export function savedSourceRevision(saved) {
  return digest({sequenceId:saved.sequenceId,name:saved.name,tracks:saved.tracks.map(t=>({kind:t.kind,index:t.index,
    clips:t.clips.map(({savedObjectId,effectFingerprint,...c})=>c)}))});
}

// Keep the older label/camera reconciliation signatures compatible with their
// saved baselines. New derivations use this stronger, freshly captured state.
export function savedNativeRevision(saved) {
  return digest({source:savedSourceRevision(saved),effects:saved.tracks.map(t=>({kind:t.kind,index:t.index,
    clips:t.clips.map(c=>c.effectFingerprint)}))});
}

export function savedGeometryRevision(saved) {
  return digest({sequenceId:saved.sequenceId,name:saved.name,tracks:saved.tracks.map(t=>({kind:t.kind,index:t.index,
    clips:t.clips.map(({savedObjectId,labelIndex,effectFingerprint,...c})=>c)}))});
}

// An interrupted UI session can have applied none, some, or all of its colors.
// Reconcile actual saved instance state without replaying any menu action.
export function reconcileSavedLabels({before,saved,sequence,targets,sourceBefore,sourceSaved,verifiedGroups=[],pendingGroup=null}) {
  if(saved.sequenceId!==sequence.id||saved.name!==sequence.name) throw new Error('Wrong saved sequence identity');
  if(savedGeometryRevision(saved)!==savedGeometryRevision(before)) throw new Error('Saved clip geometry or camera state changed during labeling');
  if(savedSourceRevision(sourceSaved)!==savedSourceRevision(sourceBefore)) throw new Error('Source sequence changed during labeling');
  const intended=new Map(),allowed=new Set([...verifiedGroups,pendingGroup]);
  for(const target of targets) {
    const current=locateInstance(sequence,target);
    const key=digest({kind:target.kind,index:target.track,name:current.name,start:target.startTicks,end:target.endTicks,in:target.inTicks});
    if(intended.has(key)) throw new Error('Repeated saved label target');
    intended.set(key,target);
  }
  const checks=[];
  for(let t=0;t<saved.tracks.length;t++) for(let c=0;c<saved.tracks[t].clips.length;c++) {
    const track=saved.tracks[t],clip=track.clips[c],prior=before.tracks[t].clips[c];
    const key=digest({kind:track.kind,index:track.index,name:clip.sourceName,start:clip.startTicks,end:clip.endTicks,in:clip.inTicks});
    const target=intended.get(key);
    if(!target) {
      if(clip.labelIndex!==prior.labelIndex) throw new Error('An unrelated clip label changed');
      continue;
    }
    if(clip.labelIndex!==prior.labelIndex && (!allowed.has(target.labelIndex)||clip.labelIndex!==target.labelIndex)) throw new Error('Unexpected instance color during interrupted label session');
    checks.push({target,complete:clip.labelIndex===target.labelIndex,actualLabelIndex:clip.labelIndex});
  }
  if(checks.length!==targets.length) throw new Error('Saved label targets are absent or ambiguous');
  const groups=[...new Set(targets.map(t=>t.labelIndex))].sort((a,b)=>a-b);
  const completed=groups.filter(i=>checks.filter(c=>c.target.labelIndex===i).every(c=>c.complete));
  if(verifiedGroups.some(i=>!completed.includes(i))) throw new Error('A previously verified label group changed');
  return {sequenceId:sequence.id,projectSha256:saved.projectSha256,verifiedGroups:completed,
    verified:checks.filter(c=>c.complete).length,remainingTargets:checks.filter(c=>!c.complete).map(c=>c.target)};
}

// Verify only the explicitly selected derived multicamera instances changed.
export function verifySavedCameraChoices({before,saved,sequence,targets,cameraIndex}) {
  if(!Number.isInteger(cameraIndex)||cameraIndex<0||cameraIndex>15||!targets?.length||targets.length>300) throw new Error('Bounded camera choice required');
  if(before.sequenceId!==sequence.id||saved.sequenceId!==sequence.id) throw new Error('Wrong camera sequence identity');
  const expected=structuredClone(before),seen=new Set();
  for(const target of targets) {
    if(target.kind!=='video') throw new Error('Camera choice requires a video instance');
    const current=locateInstance(sequence,target),track=expected.tracks.find(t=>t.kind===target.kind&&t.index===target.track);
    const matches=(track?.clips||[]).filter(c=>c.sourceName===current.name&&c.startTicks===target.startTicks&&c.endTicks===target.endTicks&&c.inTicks===target.inTicks);
    if(matches.length!==1||!matches[0].nativeMulticam||seen.has(matches[0])) throw new Error('Stale, repeated or non-multicamera instance');
    seen.add(matches[0]);matches[0].selectedCameraIndex=String(cameraIndex);
  }
  if(savedSourceRevision(expected)!==savedSourceRevision(saved)) throw new Error('Camera choice or unrelated saved state did not verify');
  return {sequenceId:sequence.id,projectSha256:saved.projectSha256,verified:targets.length,cameraIndex};
}
