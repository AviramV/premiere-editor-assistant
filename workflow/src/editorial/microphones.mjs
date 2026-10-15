import {digest} from '../premiere/state.mjs';

// Acoustic classification must be explicit evidence. RMS loudness and names
// alone cannot establish a close microphone or identify a speaker.
export function planMicrophones({sources,mainSourceId,sourceRevision,assessment}) {
  if(!sourceRevision||!sources?.length||new Set(sources.map(s=>s.id)).size!==sources.length)throw new Error('Unique revision-bound microphone sources required');
  const main=sources.find(s=>s.id===mainSourceId);
  if(!main||assessment?.sourceRevision!==sourceRevision||!assessment.evidenceReference)throw new Error('Current microphone assessment required');
  const classification=new Map(assessment.channels.map(c=>[c.sourceId,c]));
  if(classification.size!==assessment.channels.length||sources.some(s=>!classification.has(s.id)))throw new Error('Assess every recorded microphone channel');
  const closest=classification.get(mainSourceId);
  if(closest.role!=='main_voice'||closest.proximity!=='close'||closest.confidence<.8)throw new Error('Main voice proximity requires assessment');
  const keep=[],mute=[],review=[];
  for(const source of sources){
    if(!Number.isInteger(source.stream)||source.stream<0||!Number.isInteger(source.channel)||source.channel<0)throw new Error('Exact audio stream/channel required');
    const c=classification.get(source.id);
    if(c.confidence>=.8&&c.role==='main_voice'&&c.proximity==='close')keep.push(source.id);
    else if(c.confidence>=.8&&['distant','room','non_voice'].includes(c.proximity))mute.push(source.id);
    else review.push(source.id);
  }
  return {mainSourceId,transcriptionSource:{...main},keepSourceIds:keep,muteSourceIds:mute,reviewSourceIds:review,
    assessmentMethod:assessment.method,provisional:assessment.method!=='listening_and_measurement',
    revision:digest({sources,mainSourceId,sourceRevision,assessment})};
}
