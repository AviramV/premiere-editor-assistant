import {digest} from './state.mjs';

const fields = ['kind', 'track', 'sourceId', 'name', 'startTicks', 'endTicks', 'inTicks', 'outTicks'];
const times = ['startTicks', 'endTicks', 'inTicks', 'outTicks'];
const near = (a,b) => { const d=BigInt(a)-BigInt(b); return d>=-512n && d<=512n; };
export const clipLinkRows = sequence => sequence.tracks.flatMap(t => t.clips.map(c =>
  Object.fromEntries(fields.map(k => [k, k==='kind'?t.kind:k==='track'?t.index:c[k]]))));
const matches = (a,b) => fields.every(k => times.includes(k)?near(a[k],b[k]):a[k]===b[k]);

function validate(snapshot) {
  if(snapshot?.schemaVersion!==1 || !snapshot.sequenceId || !Array.isArray(snapshot.clips) || !Array.isArray(snapshot.groups)) throw new Error('Complete native clip-link evidence required');
  const used=new Set();
  for(const group of snapshot.groups) {
    if(!Array.isArray(group) || group.length<2) throw new Error('Invalid native link group');
    for(const index of group) {
      if(!Number.isInteger(index) || index<0 || index>=snapshot.clips.length || used.has(index)) throw new Error('Overlapping or invalid native link groups');
      used.add(index);
    }
  }
}

// Rebind by complete placement, never by transient or repeated clip node IDs.
export function bindClipLinks(sequence, snapshot) {
  validate(snapshot);
  const clips=clipLinkRows(sequence), used=new Set();
  if(snapshot.sequenceId!==sequence.id || snapshot.clips.length!==clips.length) throw new Error('Clip-link target or clip count changed');
  const mapping=snapshot.clips.map(row => {
    const candidates=clips.map((c,i)=>matches(c,row)?i:-1).filter(i=>i>=0);
    if(candidates.length!==1 || used.has(candidates[0])) throw new Error('Native clip-link placement is stale or ambiguous');
    used.add(candidates[0]);return candidates[0];
  });
  return {schemaVersion:1,sequenceId:sequence.id,clips,groups:snapshot.groups.map(g=>g.map(i=>mapping[i]).sort((a,b)=>a-b)).sort((a,b)=>a[0]-b[0])};
}

export function verifyClipLinks(sequence, expected, actual) {
  const wanted=bindClipLinks(sequence,expected), observed=bindClipLinks(sequence,actual);
  if(digest(wanted)!==digest(observed)) throw new Error('Native audio/video clip links did not verify');
  return {verified:true,groups:observed.groups.length,clips:observed.clips.length};
}

// Retained ranges partition each original link group by performance.
// A reorder moves those groups intact, even when members occupy several blocks.
// Disabled microphones participate exactly like enabled clips.
export function projectClipLinks(before, expected, snapshot, edit) {
  const bound=bindClipLinks(before,snapshot);
  const membership=new Map(bound.groups.flatMap((g,i)=>g.map(c=>[c,i])));
  if(!['keep','reorder'].includes(edit.kind))throw new Error('Unsupported clip-link projection');
  const ranges=edit.ranges;
  const projected=[],groupKeys=[];
  let destination=0n;
  for(const [section,range] of ranges.entries()) {
    const a=BigInt(range.startTicks),b=BigInt(range.endTicks);
    for(const [index,c] of bound.clips.entries()) {
      const start=BigInt(c.startTicks),end=BigInt(c.endTicks),left=start>a?start:a,right=end<b?end:b;
      if(right<=left)continue;
      projected.push({...c,startTicks:String(destination+left-a),endTicks:String(destination+right-a),
        inTicks:String(BigInt(c.inTicks)+left-start),outTicks:String(BigInt(c.inTicks)+right-start)});
      groupKeys.push(membership.has(index)?`${membership.get(index)}:${edit.kind==='reorder'?0:section}`:null);
    }
    destination+=b-a;
  }
  const groups=new Map();
  groupKeys.forEach((key,i)=>{if(key!==null){if(!groups.has(key))groups.set(key,[]);groups.get(key).push(i);}});
  return bindClipLinks(expected,{schemaVersion:1,sequenceId:expected.id,clips:projected,groups:[...groups.values()].filter(g=>g.length>1)});
}
