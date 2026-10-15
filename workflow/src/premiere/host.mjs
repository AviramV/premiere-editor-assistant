// Fixed ES3 operations. Values are serialized as literals, never interpreted as
// host code. Every operation checks the project and exact sequence in the host.
export function hostTarget(projectPath, sequenceId, active = false) {
  return `if (!app.project || String(app.project.path) !== ${JSON.stringify(projectPath)}) return __error("Wrong project path");
var seq = null;
for (var i = 0; i < app.project.sequences.numSequences; i++) {
  var candidate = app.project.sequences[i];
  if (String(candidate.sequenceID) === ${JSON.stringify(sequenceId)}) { seq = candidate; break; }
}
if (!seq) return __error("Exact sequence not found");
${active ? `if (!app.project.activeSequence || String(app.project.activeSequence.sequenceID) !== ${JSON.stringify(sequenceId)}) return __error("Wrong active sequence");` : ''}`;
}

export function markerRead(projectPath, sequenceId) {
  return `${hostTarget(projectPath, sequenceId)}
var result = [], m = seq.markers.getFirstMarker();
while (m) {
  if (result.length >= 1000) return __error("Marker inspection exceeded supported limit");
  var color = null;
  try { color = m.getColorByIndex(); } catch (e) {}
  result.push({name: String(m.name || ""), comments: String(m.comments || ""), startSeconds: m.start.seconds, endSeconds: m.end.seconds, color: color});
  m = seq.markers.getNextMarker(m);
}
return __result({id: String(seq.sequenceID), markers: result});`;
}

export function duplicateNamed(projectPath, sequenceId, name) {
  return `${hostTarget(projectPath, sequenceId)}
var known = {};
for (var j = 0; j < app.project.sequences.numSequences; j++) {
  var existing = app.project.sequences[j];
  if (String(existing.name) === ${JSON.stringify(name)}) return __error("Output sequence name already exists");
  known[String(existing.sequenceID)] = true;
}

seq.clone();
var copy = null, added = 0;
for (var k = 0; k < app.project.sequences.numSequences; k++) {
  var item = app.project.sequences[k];
  if (!known[String(item.sequenceID)]) { copy = item; added++; }
}
if (added !== 1 || !copy) return __error("A unique duplicate was not proven");
copy.name = ${JSON.stringify(name)};
copy.projectItem.name = ${JSON.stringify(name)};
return __result({id: String(copy.sequenceID), name: String(copy.name), projectItemId: String(copy.projectItem.nodeId)});`;
}

export function reorderClips() {
  throw new Error('Direct clip movement cannot reorder safely; a verified clone-and-remove route is required');
}

export function saveExactProject(projectPath,sequenceId) {
  return `${hostTarget(projectPath,sequenceId,true)}
app.project.save();
return __result({saved:true,path:String(app.project.path),sequenceId:String(seq.sequenceID)});`;
}

export function setAudioStates(projectPath,sequenceId,{clips,tracks}) {
  if(!Array.isArray(clips)||!Array.isArray(tracks)||clips.length+tracks.length<1||clips.length+tracks.length>300) throw new Error('One to 300 audio state targets required');
  return `${hostTarget(projectPath,sequenceId,true)}
var clipTargets=${JSON.stringify(clips)}, trackTargets=${JSON.stringify(tracks)}, resolved=[], resolvedTracks=[];
function near(a,b) { return Math.abs(parseFloat(a)-parseFloat(b))<=512; }
for(var i=0;i<clipTargets.length;i++) {
  var target=clipTargets[i];
  if(target.kind!=="audio" || target.track<0 || target.track>=seq.audioTracks.numTracks) return __error("Wrong audio clip track; no state changed");
  var track=seq.audioTracks[target.track], matches=[];
  if(typeof track.isLocked!=="function" || track.isLocked()) return __error("Audio track lock cannot be verified; no state changed");
  for(var j=0;j<track.clips.numItems;j++) {
    var clip=track.clips[j];
    if(clip.projectItem && String(clip.projectItem.nodeId)===target.sourceId && near(clip.start.ticks,target.startTicks) && near(clip.end.ticks,target.endTicks) && near(clip.inPoint.ticks,target.inTicks) && near(clip.outPoint.ticks,target.outTicks)) matches.push(clip);
  }
  if(matches.length!==1 || !matches[0].disabled!==target.beforeEnabled) return __error("Stale or ambiguous audio clip state; no state changed");
  resolved.push(matches[0]);
}
for(var k=0;k<trackTargets.length;k++) {
  var requested=trackTargets[k];
  if(requested.track<0 || requested.track>=seq.audioTracks.numTracks) return __error("Wrong audio mute track; no state changed");
  var audioTrack=seq.audioTracks[requested.track];
  if(String(audioTrack.name)!==requested.name || audioTrack.clips.numItems!==requested.clipCount || typeof audioTrack.isMuted!=="function" || typeof audioTrack.setMute!=="function" || typeof audioTrack.isLocked!=="function" || audioTrack.isLocked() || audioTrack.isMuted()!==requested.beforeMuted) return __error("Stale or unavailable audio track state; no state changed");
  resolvedTracks.push(audioTrack);
}
for(var setClip=0;setClip<resolved.length;setClip++) resolved[setClip].disabled=!clipTargets[setClip].enabled;
for(var setTrack=0;setTrack<resolvedTracks.length;setTrack++) resolvedTracks[setTrack].setMute(trackTargets[setTrack].muted?1:0);
for(var verifyClip=0;verifyClip<resolved.length;verifyClip++) if(!resolved[verifyClip].disabled!==clipTargets[verifyClip].enabled) return __error("Audio clip state did not persist; inspect before any further edit");
for(var verifyTrack=0;verifyTrack<resolvedTracks.length;verifyTrack++) if(resolvedTracks[verifyTrack].isMuted()!==trackTargets[verifyTrack].muted) return __error("Audio mute state did not persist; inspect before any further edit");
return __result({id:String(seq.sequenceID),clips:resolved.length,tracks:resolvedTracks.length});`;
}

export function removeEmptyAudioTrack(projectPath,sequenceId,target) {
  return `${hostTarget(projectPath,sequenceId,true)}
var target=${JSON.stringify(target)};
if(seq.audioTracks.numTracks!==target.count || target.track<0 || target.track>=seq.audioTracks.numTracks) return __error("Audio track list changed; nothing removed");
var track=seq.audioTracks[target.track];
if(String(track.name)!==target.name || track.clips.numItems!==0 || typeof track.isLocked!=="function" || track.isLocked() || typeof track.isMuted!=="function" || track.isMuted()!==target.muted) return __error("Audio track is occupied, locked or stale; nothing removed");
app.enableQE();
var editor=qe.project.getActiveSequence();
if(!editor || typeof editor.removeAudioTrack!=="function") return __error("Native audio track removal unavailable; nothing removed");
editor.removeAudioTrack(target.track);
if(seq.audioTracks.numTracks!==target.count-1) return __error("Audio track removal did not verify; inspect before any further edit");
return __result({id:String(seq.sequenceID),removedTrack:target.track,remainingTracks:seq.audioTracks.numTracks});`;
}

export function selectLabelTargets(projectPath,sequenceId,targets) {
  if(!Array.isArray(targets)||!targets.length||targets.length>300) throw new Error('One to 300 exact selection targets required');
  return `${hostTarget(projectPath,sequenceId,true)}
var targets=${JSON.stringify(targets)}, cache=[], selected=[];
for(var kind=0;kind<2;kind++) {
  var tracks=kind===0?seq.videoTracks:seq.audioTracks;
  for(var ti=0;ti<tracks.numTracks;ti++) for(var ci=0;ci<tracks[ti].clips.numItems;ci++) {
    var c=tracks[ti].clips[ci];
    cache.push({clip:c,kind:kind===0?"video":"audio",track:ti,sourceId:c.projectItem?String(c.projectItem.nodeId):null,
      start:parseFloat(c.start.ticks),end:parseFloat(c.end.ticks),sourceIn:parseFloat(c.inPoint.ticks)});
  }
}
for(var target=0;target<targets.length;target++) {
  var t=targets[target],matches=[];
  for(var item=0;item<cache.length;item++) {
    var e=cache[item];
    if(e.kind===t.kind&&e.track===t.track&&e.sourceId===t.sourceId&&Math.abs(e.start-parseFloat(t.startTicks))<512&&
      Math.abs(e.end-parseFloat(t.endTicks))<512&&Math.abs(e.sourceIn-parseFloat(t.inTicks))<512) matches.push(e.clip);
  }
  if(matches.length!==1) return __error("Stale or ambiguous selection target; nothing selected");
  selected.push(matches[0]);
}
for(var clear=0;clear<cache.length;clear++) cache[clear].clip.setSelected(0,false);
for(var apply=0;apply<selected.length;apply++) selected[apply].setSelected(1,false);
var count=0;
for(var verify=0;verify<cache.length;verify++) if(cache[verify].clip.isSelected()) count++;
if(count!==selected.length) return __error("Native selection count is unverified");
return __result({id:String(seq.sequenceID),selectedCount:count});`;
}

export function updateMarkerText(projectPath,sequenceId,updates) {
  if(!Array.isArray(updates)||!updates.length||updates.length>200) throw new Error('One to 200 exact marker updates required');
  return `${hostTarget(projectPath,sequenceId,true)}
var updates=${JSON.stringify(updates)},cache=[],marker=seq.markers.getFirstMarker(),selected=[];
while(marker) {
  cache.push({marker:marker,name:String(marker.name||""),comments:String(marker.comments||""),start:parseFloat(marker.start.ticks),end:parseFloat(marker.end.ticks),color:marker.getColorByIndex()});
  marker=seq.markers.getNextMarker(marker);
}
for(var ui=0;ui<updates.length;ui++) {
  var wanted=updates[ui].before,matches=[];
  for(var mi=0;mi<cache.length;mi++) {
    var m=cache[mi];
    if(m.name===wanted.name&&m.comments===wanted.comments&&m.color===wanted.color&&
      Math.abs(m.start-parseFloat(wanted.startTicks))<512&&Math.abs(m.end-parseFloat(wanted.endTicks))<512) matches.push(m.marker);
  }
  if(matches.length!==1) return __error("Stale or ambiguous marker; text updates refused before mutation");
  selected.push(matches[0]);
}
for(var apply=0;apply<updates.length;apply++) {
  selected[apply].name=updates[apply].after.name;selected[apply].comments=updates[apply].after.comments;
}
return __result({id:String(seq.sequenceID),updated:updates.length});`;
}

export function ensureProxyPlayback(projectPath,sequenceId,targets) {
  if(!Array.isArray(targets)||!targets.length||targets.length>20||targets.some(t=>!t.sourceId||!t.proxyPath))throw new Error('Exact verified working proxies required');
  return `${hostTarget(projectPath,sequenceId,true)}
var targets=${JSON.stringify(targets)},checks=[];
function findMedia(item,id){if(String(item.nodeId)===id)return item;if(item.children)for(var j=0;j<item.children.numItems;j++){var found=findMedia(item.children[j],id);if(found)return found;}return null;}
for(var i=0;i<targets.length;i++){var item=findMedia(app.project.rootItem,targets[i].sourceId);if(!item||!item.hasProxy()||String(item.getProxyPath())!==targets[i].proxyPath||!new File(targets[i].proxyPath).exists)return __error("Working proxy changed or missing; playback setting unchanged");checks.push({sourceId:targets[i].sourceId,proxyPath:String(item.getProxyPath())});}
if(typeof app.getEnableProxies!=="function"||typeof app.setEnableProxies!=="function")return __error("Proxy display controls unavailable");
if(Number(app.getEnableProxies())!==1)app.setEnableProxies(1);
if(Number(app.getEnableProxies())!==1)return __error("Proxy display enablement did not verify");
return __result({proxiesEnabled:true,verified:true,checks:checks});`;
}

export function clearExactSequenceMarkers(projectPath,sequenceId,markers) {
  if(!Array.isArray(markers)||markers.length>1000)throw new Error('Bounded marker baseline required');
  return `${hostTarget(projectPath,sequenceId,true)}
var expected=${JSON.stringify(markers)},actual=[],m=seq.markers.getFirstMarker();
while(m){if(actual.length>=1000)return __error("Marker inspection limit");actual.push(m);m=seq.markers.getNextMarker(m);}
if(actual.length!==expected.length)return __error("Marker baseline changed; nothing removed");
var used={};for(var i=0;i<expected.length;i++){var wanted=expected[i],match=-1;for(var j=0;j<actual.length;j++){var a=actual[j];if(!used[j]&&String(a.name||"")===wanted.name&&String(a.comments||"")===wanted.comments&&Math.abs(parseFloat(a.start.ticks)-parseFloat(wanted.startTicks))<=512&&Math.abs(parseFloat(a.end.ticks)-parseFloat(wanted.endTicks))<=512&&a.getColorByIndex()===wanted.color){match=j;break;}}if(match<0)return __error("Marker baseline changed; nothing removed");used[match]=true;}
for(var k=0;k<actual.length;k++)seq.markers.deleteMarker(actual[k]);
if(seq.markers.getFirstMarker())return __error("Marker removal did not verify; inspect before continuing");
return __result({sequenceId:String(seq.sequenceID),removed:actual.length,verified:true});`;
}

export function renameExactSequence(projectPath,sequenceId,{beforeName,name}) {
  if(typeof beforeName!=='string'||typeof name!=='string'||!name.trim()||name.length>255)throw new Error('Exact sequence names required');
  return `${hostTarget(projectPath,sequenceId,true)}
if(String(seq.name)!==${JSON.stringify(beforeName)})return __error("Sequence name changed; nothing renamed");
for(var i=0;i<app.project.sequences.numSequences;i++)if(String(app.project.sequences[i].sequenceID)!==String(seq.sequenceID)&&String(app.project.sequences[i].name)===${JSON.stringify(name)})return __error("Sequence name already exists");
seq.name=${JSON.stringify(name)};seq.projectItem.name=${JSON.stringify(name)};
if(String(seq.name)!==${JSON.stringify(name)}||String(seq.projectItem.name)!==${JSON.stringify(name)})return __error("Sequence rename did not verify; inspect before continuing");
return __result({id:String(seq.sequenceID),name:String(seq.name),verified:true});`;
}
