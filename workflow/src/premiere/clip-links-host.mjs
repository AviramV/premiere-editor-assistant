import {hostTarget} from './host.mjs';

// Fixed ES3 only. Clip node IDs are used locally together with full geometry
// and media type to resolve native link members; they never bind an edit plan.
const readers = `
function linkRows() {
  var rows=[];
  for(var k=0;k<2;k++) {
    var tracks=k===0?seq.videoTracks:seq.audioTracks;
    for(var t=0;t<tracks.numTracks;t++) for(var c=0;c<tracks[t].clips.numItems;c++) {
      if(rows.length>=5000) throw new Error("Clip-link inspection limit exceeded");
      var clip=tracks[t].clips[c];
      if(!clip.projectItem || typeof clip.getLinkedItems!=="function") throw new Error("Native clip links unavailable");
      rows.push({clip:clip,nativeId:String(clip.nodeId),mediaType:String(clip.mediaType),kind:k===0?"video":"audio",track:t,sourceId:String(clip.projectItem.nodeId),name:String(clip.name),
        startTicks:String(clip.start.ticks),endTicks:String(clip.end.ticks),inTicks:String(clip.inPoint.ticks),outTicks:String(clip.outPoint.ticks)});
    }
  }
  return rows;
}
function nearLink(a,b) { return Math.abs(parseFloat(a)-parseFloat(b))<=512; }
function sameLink(a,b) {
  return a.kind===b.kind && a.track===b.track && a.sourceId===b.sourceId && a.name===b.name &&
    nearLink(a.startTicks,b.startTicks) && nearLink(a.endTicks,b.endTicks) && nearLink(a.inTicks,b.inTicks) && nearLink(a.outTicks,b.outTicks);
}
function linkEvidence(rows) {
  var memberships=[],groups=[],seen={},slots={};
  for(var slot=0;slot<rows.length;slot++) {
    var identity="id:"+rows[slot].nativeId+":"+rows[slot].mediaType;
    if(!slots[identity])slots[identity]=[];
    slots[identity].push(slot);
  }
  for(var i=0;i<rows.length;i++) {
    var linked=rows[i].clip.getLinkedItems(),members=[i];
    if(linked===undefined || (linked && (typeof linked.numItems!=="number" || !isFinite(linked.numItems) || linked.numItems<0 || Math.floor(linked.numItems)!==linked.numItems || linked.numItems>rows.length))) throw new Error("Incomplete native link membership");
    for(var j=0;linked && j<linked.numItems;j++) {
      var member=linked[j],found=-1;
      if(!member || !member.projectItem) throw new Error("Missing native linked member");
      var candidates=slots["id:"+String(member.nodeId)+":"+String(member.mediaType)]||[];
      var source=String(member.projectItem.nodeId),start=String(member.start.ticks),end=String(member.end.ticks),sourceIn=String(member.inPoint.ticks),sourceOut=String(member.outPoint.ticks);
      for(var candidate=0;candidate<candidates.length;candidate++) {
        var r=candidates[candidate],row=rows[r];
        if(source===row.sourceId && nearLink(start,row.startTicks) && nearLink(end,row.endTicks) && nearLink(sourceIn,row.inTicks) && nearLink(sourceOut,row.outTicks)) {
          if(found!==-1) throw new Error("Ambiguous native linked member");
          found=r;
        }
      }
      if(found<0) throw new Error("Native link points outside inspected sequence");
      var present=false;for(var m=0;m<members.length;m++)if(members[m]===found)present=true;
      if(!present)members.push(found);
    }
    members.sort(function(a,b){return a-b;});memberships.push(members);
  }
  for(var n=0;n<memberships.length;n++) {
    var group=memberships[n],key=group.join(",");
    for(var p=0;p<group.length;p++)if(memberships[group[p]].join(",")!==key)throw new Error("Asymmetric native clip links");
    if(group.length>1 && !seen[key]){groups.push(group);seen[key]=true;}
  }
  var clips=[];
  for(var q=0;q<rows.length;q++){var e=rows[q];clips.push({kind:e.kind,track:e.track,sourceId:e.sourceId,name:e.name,startTicks:e.startTicks,endTicks:e.endTicks,inTicks:e.inTicks,outTicks:e.outTicks});}
  return {schemaVersion:1,sequenceId:String(seq.sequenceID),clips:clips,groups:groups};
}
`;

export function readClipLinks(projectPath, sequenceId) {
  return `${hostTarget(projectPath,sequenceId)}\n${readers}\nreturn __result(linkEvidence(linkRows()));`;
}

export function restoreClipLinks(projectPath, sequenceId, expected) {
  if(expected?.schemaVersion!==1 || expected.sequenceId!==sequenceId || !Array.isArray(expected.clips) || expected.clips.length>5000 || !Array.isArray(expected.groups)) throw new Error('Bounded exact clip-link restoration required');
  return `${hostTarget(projectPath,sequenceId,true)}
${readers}
var wanted=${JSON.stringify(expected)},rows=linkRows(),actual=linkEvidence(rows),mapping=[],used={},membership={},pending=[];
if(rows.length!==wanted.clips.length) return __error("Clip-link geometry changed; nothing linked");
for(var i=0;i<wanted.clips.length;i++) {
  var found=-1;
  for(var r=0;r<rows.length;r++)if(sameLink(rows[r],wanted.clips[i])){if(found!==-1)return __error("Ambiguous clip-link target; nothing linked");found=r;}
  if(found<0 || used[found])return __error("Stale or repeated clip-link target; nothing linked");
  used[found]=true;mapping.push(found);
}
for(var g=0;g<wanted.groups.length;g++) {
  var target=wanted.groups[g],members=[];
  if(target.length<2)return __error("Invalid clip-link group; nothing linked");
  for(var m=0;m<target.length;m++) {
    var index=target[m];
    if(typeof index!=="number" || !isFinite(index) || Math.floor(index)!==index || index<0 || index>=mapping.length || membership[mapping[index]]!==undefined)return __error("Overlapping clip-link groups; nothing linked");
    var slot=mapping[index],tracks=rows[slot].kind==="video"?seq.videoTracks:seq.audioTracks;
    if(typeof tracks[rows[slot].track].isLocked!=="function" || tracks[rows[slot].track].isLocked())return __error("Linked track is locked or unavailable; nothing linked");
    membership[slot]=g;members.push(slot);
  }
  members.sort(function(a,b){return a-b;});pending.push(members);
}
// Only repair missing edges inside an original group. Never unlink a foreign
// group or merge two performances, and never link originally unlinked clips.
for(var a=0;a<actual.groups.length;a++) {
  var observed=actual.groups[a],owner=membership[observed[0]];
  if(owner===undefined)return __error("Unexpected native links; inspect before relinking");
  for(var b=0;b<observed.length;b++)if(membership[observed[b]]!==owner)return __error("Foreign native link group; inspect before relinking");
}
var repair=[];
for(var p=0;p<pending.length;p++) {
  var complete=false;
  for(var v=0;v<actual.groups.length;v++)if(actual.groups[v].join(",")===pending[p].join(","))complete=true;
  if(!complete)repair.push(pending[p]);
}
if(repair.length && typeof seq.linkSelection!=="function")return __error("Native relinking unavailable; nothing linked");
var selected=[];
for(var s=0;s<rows.length;s++)if(rows[s].clip.isSelected())selected.push(s);
function clearLinkSelection(){for(var c=0;c<rows.length;c++)rows[c].clip.setSelected(0,false);}
try {
  for(var j=0;j<repair.length;j++) {
    clearLinkSelection();
    for(var k=0;k<repair[j].length;k++)rows[repair[j][k]].clip.setSelected(1,false);
    var selection=seq.getSelection();
    if(!selection || selection.length!==repair[j].length)throw new Error("Exact relink selection did not verify");
    for(var check=0;check<rows.length;check++) {
      var intended=false;for(var part=0;part<repair[j].length;part++)if(repair[j][part]===check)intended=true;
      if(!!rows[check].clip.isSelected()!==intended)throw new Error("Exact relink members did not verify");
    }
    seq.linkSelection();
  }
} finally {
  if(repair.length){clearLinkSelection();for(var z=0;z<selected.length;z++)rows[selected[z]].clip.setSelected(1,false);}
}
var result=linkEvidence(linkRows()),expectedKeys=[],actualKeys=[];
for(var x=0;x<pending.length;x++)expectedKeys.push(pending[x].join(","));
for(var y=0;y<result.groups.length;y++)actualKeys.push(result.groups[y].join(","));
expectedKeys.sort();actualKeys.sort();
if(expectedKeys.join("|")!==actualKeys.join("|"))return __error("Native clip links did not persist; inspect before any further edit");
return __result({verified:true,relinked:repair.length,evidence:result});`;
}
