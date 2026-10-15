import { analyzeAudio } from '../media/measurements.mjs';
import { digest } from '../premiere/state.mjs';
import { rankPassage } from './ranking.mjs';

export const ASSESSMENT_VERSION = 2;

function measurementIdentity({script,transcript,matching,source}) {
  if (!source.audioRevision || !source.extractionIdentity) throw new Error('Verified extracted audio fingerprint required');
  return {version:ASSESSMENT_VERSION,scriptRevision:script.revision,scriptContent:digest(script),
    transcriptRevision:transcript.revision,transcriptContent:digest(transcript),matchingRevision:digest(matching),
    sourceRevision:source.sourceRevision,audioRevision:source.audioRevision,extractionIdentity:source.extractionIdentity,
    sourceStart:source.sourceStart,duration:source.duration,sampleRate:source.sampleRate,sourceSampleRate:source.sourceSampleRate,
    stream:source.stream,channel:source.channel,normalized:source.normalized};
}

function rankMeasured({script,transcript,matching,measurements,issues,identity,overrides}) {
  for (const [passageId,takeId] of Object.entries(overrides)) {
    if (!script.passages.some(p=>p.id===passageId) || !matching.takes.some(t=>t.id===takeId && t.passageId===passageId)) throw new Error('Editor override has a wrong passage or take');
  }
  const passages=script.passages.map(p=>{
    const decision=rankPassage(matching.takes.filter(t=>t.passageId===p.id),measurements,null,overrides[p.id]);
    const chosen=decision.evidence?.ranked.find(t=>t.takeId===decision.selected);
    // An editor choice settles delivery preference, but cannot establish missing
    // script coverage, timing or microphone measurements.
    if (decision.selected && chosen?.eligible!==true) {
      decision.review=true;
      decision.reasons=[...decision.reasons,...(chosen?.reasons||[]),'Chosen performance still requires technical or boundary review'];
    }
    return {passageId:p.id,...decision};
  });
  const measurementRevision=digest({identity,measurements,issues});
  return {schemaVersion:1,assessmentVersion:ASSESSMENT_VERSION,scriptRevision:script.revision,transcriptRevision:transcript.revision,
    sourceRevision:transcript.sourceRevision,matchingRevision:digest(matching),measurementIdentity:identity,measurementRevision,
    measurements,passages,issues,overrides:{...overrides},gemini:'deferred',review:passages.filter(p=>p.review).map(p=>p.passageId),
    revision:digest({measurementRevision,overrides})};
}

export function assessTakes({script,transcript,matching,audio,source,overrides={}}) {
  if (matching.scriptRevision!==script.revision || matching.transcriptRevision!==transcript.revision) throw new Error('Stale script or transcript assessment');
  if (source.sourceRevision!==transcript.sourceRevision || source.normalized!==false || source.sampleRate!==audio.sampleRate || source.sampleRate!==source.sourceSampleRate) {
    throw new Error('Original-level audio from the exact transcript source is required');
  }
  const identity=measurementIdentity({script,transcript,matching,source});
  const ids=new Set(matching.takes.map(t=>t.id));
  if (ids.size!==matching.takes.length) throw new Error('Take IDs must be unique');
  const measurements={}, issues=[];
  for (const take of matching.takes) {
    if (take.sourceRevision!==source.sourceRevision || take.transcriptRevision!==transcript.revision) throw new Error('Take source identity mismatch');
    if (!Number.isInteger(take.firstWord) || !Number.isInteger(take.lastWord) || take.firstWord<0 || take.lastWord<take.firstWord) throw new Error('Take word indices are invalid');
    const words=transcript.words.slice(take.firstWord,take.lastWord+1);
    if (!words.length || words.length!==take.lastWord-take.firstWord+1) throw new Error('Take word indices are invalid');
    const start=Math.max(0,words[0].start-source.sourceStart-0.3);
    const end=Math.min(audio.samples.length/audio.sampleRate,words.at(-1).end-source.sourceStart+0.3);
    const first=Math.floor(start*audio.sampleRate), last=Math.ceil(end*audio.sampleRate);
    if (last<=first || words[0].start<source.sourceStart || words.at(-1).end>source.sourceStart+audio.samples.length/audio.sampleRate+0.002) {
      issues.push({takeId:take.id,code:'audio_does_not_cover_take'});continue;
    }
    const ranges=words.filter(w=>w.end>w.start).map(w=>({start:w.start-source.sourceStart-first/audio.sampleRate,end:w.end-source.sourceStart-first/audio.sampleRate}));
    const {frames,...metrics}=analyzeAudio({samples:audio.samples.subarray(first,last),sampleRate:audio.sampleRate},ranges);
    measurements[take.id]={...metrics,sourceStart:source.sourceStart+first/audio.sampleRate,sourceEnd:source.sourceStart+last/audio.sampleRate,
      stream:source.stream,channel:source.channel,sourceRevision:source.sourceRevision,originalLevels:true};
  }
  return rankMeasured({script,transcript,matching,measurements,issues,identity,overrides});
}

export function reassessCached({script,transcript,matching,source,assessment,overrides=assessment.overrides||{}}) {
  const identity=measurementIdentity({script,transcript,matching,source});
  if (assessment.assessmentVersion!==ASSESSMENT_VERSION || digest(identity)!==digest(assessment.measurementIdentity) ||
    assessment.measurementRevision!==digest({identity,measurements:assessment.measurements,issues:assessment.issues})) {
    throw new Error('Stale or unverified assessment cache; measure the current source again');
  }
  return rankMeasured({script,transcript,matching,measurements:assessment.measurements,issues:assessment.issues,identity,overrides});
}
