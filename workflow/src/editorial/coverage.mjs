import {digest} from '../premiere/state.mjs';
import {sourceToTimeline,ticksToSeconds} from '../core/timing.mjs';
import {tokens,protectedIssues} from './script.mjs';

// This is a literal wording audit. It does not approve paraphrases or establish
// acoustic boundaries, and it never changes take eligibility or source words.
export function compareWording(required,spoken) {
  const a=tokens(required),b=tokens(spoken),width=b.length+1;
  const table=new Uint16Array((a.length+1)*width);
  for(let i=a.length-1;i>=0;i--)for(let j=b.length-1;j>=0;j--)
    table[i*width+j]=a[i]===b[j]?1+table[(i+1)*width+j+1]:Math.max(table[(i+1)*width+j],table[i*width+j+1]);
  let i=0,j=0;const missing=[],added=[];
  while(i<a.length||j<b.length) {
    if(i<a.length&&j<b.length&&a[i]===b[j]){i++;j++;}
    else if(i<a.length&&(j===b.length||table[(i+1)*width+j]>=table[i*width+j+1]))missing.push(a[i++]);
    else added.push(b[j++]);
  }
  return {exact:!missing.length&&!added.length,missing,added,requiredWords:a.length,matchedWords:a.length-missing.length};
}

export function auditCoverage({script,sources}) {
  if(!sources?.length||new Set(sources.map(s=>s.id)).size!==sources.length)throw new Error('Unique transcript sources required');
  const evidence=sources.map(source=>{
    const {transcript,matching}=source;
    if(matching.scriptRevision!==script.revision||matching.transcriptRevision!==transcript.revision)throw new Error('Stale coverage analysis');
    const candidates=matching.takes.map(take=>{
      if(take.sourceRevision!==transcript.sourceRevision||take.transcriptRevision!==transcript.revision||
        !Number.isInteger(take.firstWord)||!Number.isInteger(take.lastWord)||take.firstWord<0||take.lastWord<take.firstWord||take.lastWord>=transcript.words.length)
        throw new Error('Stale coverage candidate');
      const words=transcript.words.slice(take.firstWord,take.lastWord+1),spoken=words.map(w=>w.text).join(' ');
      if(spoken!==take.text)throw new Error('Candidate wording differs from its source transcript');
      const passage=script.passages.find(p=>p.id===take.passageId);
      if(!passage)throw new Error('Unknown coverage passage');
      const issues=[...(take.issues||[])];
      const invalid=words.flatMap((w,i)=>!Number.isFinite(w.start)||!Number.isFinite(w.end)||w.end<=w.start||
        (i&&w.start<words[i-1].end)?[take.firstWord+i]:[]);
      if(invalid.length)issues.push({code:'acoustic_word_timing_review',indices:invalid});
      const sourceInterval={start:words[0].start,end:words.at(-1).end};let timelineInterval=null;
      if(source.placement)try {timelineInterval={start:ticksToSeconds(sourceToTimeline(sourceInterval.start,source.placement)),
        end:ticksToSeconds(sourceToTimeline(sourceInterval.end,source.placement))};}
      catch(error){issues.push({code:'source_placement_review',reason:error.message});}
      return {sourceId:source.id,sourceName:source.name||source.id,takeId:take.id,passageId:passage.id,spoken,sourceInterval,timelineInterval,
        required:compareWording(passage.text,spoken),variants:(passage.variants||[]).map(text=>({text,...compareWording(text,spoken)})),
        storyboard:passage.storyboardVariant?{text:passage.storyboardVariant,...compareWording(passage.storyboardVariant,spoken)}:null,
        protectedWording:protectedIssues(passage,spoken),automaticEligible:!!take.automaticEligible,
        acousticBoundariesVerified:false,issues};
    });
    return {id:source.id,name:source.name||source.id,placement:source.placement||null,transcriptRevision:transcript.revision,sourceRevision:transcript.sourceRevision,
      transcriptContent:digest(transcript),matchingContent:digest(matching),candidates};
  });
  const passages=script.passages.map(p=>{
    const candidates=evidence.flatMap(s=>s.candidates).filter(c=>c.passageId===p.id).sort((a,b)=>
      (b.required.matchedWords/b.required.requiredWords)-(a.required.matchedWords/a.required.requiredWords)||a.required.added.length-b.required.added.length||a.sourceInterval.start-b.sourceInterval.start);
    return {passageId:p.id,required:p.text,storyboardVariant:p.storyboardVariant||null,candidateCount:candidates.length,
      automaticCandidateCount:candidates.filter(c=>c.automaticEligible&&!c.issues.length&&!c.protectedWording.length).length,
      status:candidates.some(c=>c.automaticEligible&&!c.issues.length&&!c.protectedWording.length)?'automatic_candidates_available':candidates.length?'editorial_review':'no_candidate_found',candidates};
  });
  const provenance=evidence.map(({candidates,...s})=>s);
  return {schemaVersion:1,kind:'literal_script_coverage_audit',scope:'Transcript wording evidence; acoustic review and editorial variant decisions remain explicit',
    scriptRevision:script.revision,provenance,passages,revision:digest({script:script.revision,provenance,passages})};
}

const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function renderCoverageAudit(audit) {
  const interval=v=>v?`${v.start.toFixed(2)}–${v.end.toFixed(2)} s`:'Unavailable';
  const rows=audit.passages.map(p=>`<tr><th>${escape(p.passageId)}</th><td>${escape(p.required)}${p.storyboardVariant?`<p><strong>Storyboard wording:</strong> ${escape(p.storyboardVariant)}</p>`:''}</td><td>${p.automaticCandidateCount} automatic candidates · ${p.candidateCount} total<p>${escape(p.status)}</p></td><td>${p.candidates.slice(0,3).map(c=>`<details><summary>${escape(c.sourceName)} · ${escape(c.takeId)} · source ${interval(c.sourceInterval)}</summary><p>${escape(c.spoken)}</p><p>Timeline ${interval(c.timelineInterval)}</p><p>Required words absent from this transcript span: ${escape(c.required.missing.join(' ')||'None')}</p><p>Additional words: ${escape(c.required.added.join(' ')||'None')}</p>${c.storyboard?`<p>Storyboard words absent: ${escape(c.storyboard.missing.join(' ')||'None')}</p>`:''}<p>${escape([...c.protectedWording,...c.issues].map(i=>i.term?`${i.code}: ${i.term}`:i.code).join('; ')||'Acoustic boundary review remains required')}</p></details>`).join('')||'No candidate found in these transcripts'}</td></tr>`).join('');
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Script coverage audit</title><style>body{font:16px/1.5 system-ui;margin:32px;color:#20303b;background:#f7f9fa}main{max-width:1400px;margin:auto}table{border-collapse:collapse;background:white;width:100%}th,td{border:1px solid #d8e0e5;padding:12px;vertical-align:top;text-align:left}td{max-width:440px}.notice{background:#fff1d8;border-left:4px solid #a36200;padding:16px}details{margin:10px 0}.table{overflow:auto}</style><main><h1>Ecomm script coverage</h1><p class="notice">${escape(audit.scope)}. No candidate or variant is approved by this audit. Times locate the source evidence; rendered boundaries remain to verify.</p><div class="table"><table><thead><tr><th>Passage</th><th>Required text</th><th>Coverage</th><th>Closest literal candidates · first three</th></tr></thead><tbody>${rows}</tbody></table></div></main></html>`;
}
