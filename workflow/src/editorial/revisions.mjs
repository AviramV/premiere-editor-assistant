import {mkdir,readdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {digest,revision} from '../premiere/state.mjs';
import {atomicJson} from '../premiere/coordinator.mjs';
import {ticksToSeconds} from '../core/timing.mjs';
import {reassessCached} from './assessment.mjs';
import {planAssembly} from './assembly.mjs';
import {planSelects} from './selects.mjs';

export const REVISION_FORMAT_VERSION=3;

export function planRevision(input,changes={}) {
  const allowed=new Set(['takeOverrides','order','selectsOrder','pacingMode','pacingDecisions','maxAlternatives','handlesFrames']);
  if(Object.keys(changes).some(key=>!allowed.has(key))) throw new Error('Unknown revision request');
  const overrides={...(input.assessment.overrides||{})};
  for(const [passageId,takeId] of Object.entries(changes.takeOverrides||{})) {
    if(!input.script.passages.some(p=>p.id===passageId)) throw new Error('Editor override has a wrong passage or take');
    if(takeId===null) delete overrides[passageId];else overrides[passageId]=takeId;
  }
  const assessment=reassessCached({...input,overrides});
  const handlesFrames=changes.handlesFrames??input.handlesFrames??4;
  if(!Number.isInteger(handlesFrames)||handlesFrames<0||handlesFrames>50) throw new Error('Zero to fifty boundary handle frames required');
  const settings={order:changes.order??input.order??input.script.passages.map(p=>p.id),
    selectsOrder:changes.selectsOrder??input.selectsOrder??input.script.passages.map(p=>p.id),
    pacingMode:changes.pacingMode??input.pacingMode??'natural',pacingDecisions:changes.pacingDecisions??input.pacingDecisions??[],
    maxAlternatives:changes.maxAlternatives??input.maxAlternatives??2,handlesFrames};
  const assembly=planAssembly({...input,assessment,...settings});
  // Selects preserves each whole performance so delivery alternatives remain
  // reviewable; pacing choices affect Assembly only.
  const selects=planSelects({...input,assessment,order:settings.selectsOrder,pacingMode:'natural'},settings);
  return {schemaVersion:1,formatVersion:REVISION_FORMAT_VERSION,sourceSequenceId:input.sequence.id,sourceSequenceRevision:revision(input.sequence),
    analysisRevision:assessment.measurementRevision,assessment,settings,plans:{assembly,selects},
    revisionId:digest({formatVersion:REVISION_FORMAT_VERSION,source:revision(input.sequence),assessment:assessment.revision,settings})};
}

export function decisionReport({script,transcript,matching,assessment,plans,version,names,snapshotOnly}) {
  const takeById=new Map(matching.takes.map(t=>[t.id,t]));
  const passages=script.passages.map(p=>{
    const d=assessment.passages.find(d=>d.passageId===p.id),take=takeById.get(d?.selected);
    const assembled=plans.assembly.sections.find(s=>s.passageId===p.id);
    return {id:p.id,required:p.text,selected:d?.selected||null,spoken:take?.text||null,confidence:d?.confidence||'missing',
      sourceInterval:take?{start:transcript.words[take.firstWord].start,end:transcript.words[take.lastWord].end}:null,
      assemblyInterval:assembled?{start:ticksToSeconds(assembled.destination.startTicks),end:ticksToSeconds(assembled.destination.endTicks)}:null,
      measurements:take?assessment.measurements[take.id]||null:null,
      assembled:!!assembled,includedSelects:plans.selects.passages.find(s=>s.passageId===p.id)?.included||[],
      needsReview:!take?.automaticEligible||!!d?.review||!!assembled?.review,
      reasons:d?.reasons||[],alternatives:(d?.alternatives||[]).map(a=>({...a,automaticEligible:!!takeById.get(a.takeId)?.automaticEligible})),
      issues:[...plans.assembly.unresolved,...plans.selects.unresolved,...(plans.assembly.pacingReview||[])].filter(i=>i.passageId===p.id)};
  });
  return {schemaVersion:1,version,names,status:'planned',requiresFreshHostInspection:snapshotOnly,
    scope:'Dialogue organization, editable Selects and Assembly. Gemini delivery comparison is deferred.',
    provenance:{script:script.revision,transcript:assessment.transcriptRevision,matching:assessment.matchingRevision,
      source:assessment.sourceRevision,measurements:assessment.measurementRevision,assessment:assessment.revision,
      sequence:plans.assembly.beforeRevision},passages,
    outputs:Object.entries(plans).map(([kind,p])=>({kind,name:names[kind],durationSeconds:ticksToSeconds(p.durationTicks),
      sections:p.sections.length,unresolved:p.unresolved,planId:p.planId})),
    pendingAcceptance:['Native instance labels','Word boundaries and rendered sync','Microphone choices and clip/track state','Save/reopen and camera editability'],
    overrides:assessment.overrides,pacingMode:plans.assembly.pacingMode};
}

const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
export function renderDecisionReport(report) {
  const rows=report.passages.map(p=>`<tr><th scope="row">${escape(p.id)}</th><td>${escape(p.required)}</td><td><strong>${escape(p.selected||'Coverage review')}</strong><br>${escape(p.spoken||'No complete eligible performance')}<br><small>${escape(p.confidence)}${p.sourceInterval?`<br>Source ${p.sourceInterval.start.toFixed(2)}–${p.sourceInterval.end.toFixed(2)} s`:''}</small></td><td>${p.assembled?'Included':'Unassembled'}${p.assemblyInterval?`<br>Assembly ${p.assemblyInterval.start.toFixed(2)}–${p.assemblyInterval.end.toFixed(2)} s`:''}<br>${p.includedSelects.length} Selects performances</td><td>${p.needsReview?'Review required':'Editor choice'}<ul>${[...p.reasons,...p.issues.map(i=>i.code)].map(r=>`<li>${escape(r)}</li>`).join('')}</ul><details><summary>${p.alternatives.length} alternatives</summary><ul>${p.alternatives.map(a=>`<li>${escape(a.takeId)} — ${a.automaticEligible?'complete candidate':'coverage or timing review'}${a.technicalScore===null||a.technicalScore===undefined?'':`; technical score ${Number(a.technicalScore).toFixed(1)}`}</li>`).join('')}</ul></details></td></tr>`).join('');
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Dialogue decision report v${report.version}</title><style>body{font:16px/1.5 system-ui;margin:32px;color:#20303b;background:#f7f9fa}main{max-width:1450px;margin:auto}h1{margin-bottom:.25em}table{border-collapse:collapse;width:100%;background:white}th,td{border:1px solid #d8e0e5;text-align:left;vertical-align:top;padding:12px}thead{background:#e8eff4}td{max-width:360px}ul{padding-left:20px}small{color:#526674}code{overflow-wrap:anywhere}.notice{padding:16px;border-left:4px solid #a36200;background:#fff1d8}.outputs{display:flex;flex-wrap:wrap;gap:16px}.output{padding:16px;background:white;border:1px solid #d8e0e5}details{margin-top:10px}@media(max-width:800px){body{margin:12px}.table{overflow:auto}table{min-width:1000px}}</style><main><h1>Dialogue decision report · v${report.version}</h1><p>${escape(report.scope)}</p><p class="notice">${report.requiresFreshHostInspection?'Prepared from a saved inspection. Fresh Premiere inspection is required before editing.':'Prepared from a fresh Premiere inspection.'} Output sequences are planned. Live editorial acceptance remains pending.</p><div class="outputs">${report.outputs.map(o=>`<div class="output"><strong>${escape(o.name)}</strong><br>${o.sections} performances · ${o.durationSeconds.toFixed(2)} seconds<br>${o.unresolved.length} unresolved issues</div>`).join('')}</div><h2>Passages and decisions</h2><div class="table"><table><thead><tr><th>Passage</th><th>Script</th><th>Chosen performance</th><th>Output coverage</th><th>Evidence and review</th></tr></thead><tbody>${rows}</tbody></table></div><h2>Remaining acceptance</h2><ul>${report.pendingAcceptance.map(p=>`<li>${escape(p)}</li>`).join('')}</ul><details><summary>Analysis provenance</summary><dl>${Object.entries(report.provenance).map(([k,v])=>`<dt>${escape(k)}</dt><dd><code>${escape(v)}</code></dd>`).join('')}</dl></details></main></html>`;
}

// Each reserved directory is immutable. A crashed publication leaves no ready
// manifest, and a repeated ready plan returns the existing revision unchanged.
export async function saveRevision({directory,name,input,changes={},snapshotOnly=true}) {
  if(!name||name.length>120||/[\r\n]/.test(name)) throw new Error('A bounded output name is required');
  const planned=planRevision(input,changes),identity=digest({revisionId:planned.revisionId,name,snapshotOnly});
  await mkdir(directory,{recursive:true});
  const directories=(await readdir(directory)).filter(n=>/^v\d{3,}$/.test(n)).sort((a,b)=>Number(b.slice(1))-Number(a.slice(1)));
  for(const entry of directories) {
    let manifest;
    try {manifest=JSON.parse(await readFile(path.join(directory,entry,'manifest.json'),'utf8'));}
    catch(error) {if(error.code==='ENOENT') continue;throw error;}
    if(manifest.identity===identity) {
      const bundle=JSON.parse(await readFile(path.join(directory,entry,'bundle.json'),'utf8'));
      const report=JSON.parse(await readFile(path.join(directory,entry,'decision-report.json'),'utf8'));
      const html=await readFile(path.join(directory,entry,'decision-report.html'),'utf8');
      if(manifest.bundleRevision!==digest(bundle)||manifest.reportRevision!==digest(report)||manifest.htmlRevision!==digest(html)) throw new Error('Published revision was changed; inspect before reuse');
      return {...manifest,directory:path.resolve(directory,entry),reused:true};
    }
  }
  let version=directories.length?Number(directories[0].slice(1))+1:1,folder;
  while(true) {
    folder=path.join(directory,`v${String(version).padStart(3,'0')}`);
    try {await mkdir(folder);break;} catch(error) {if(error.code!=='EEXIST') throw error;version++;}
  }
  const suffix=`v${String(version).padStart(3,'0')}`,names={selects:`${name} - Selects ${suffix}`,assembly:`${name} - Assembly ${suffix}`};
  const bundle={...planned,version,names,snapshotOnly};
  const report=decisionReport({...input,...planned,version,names,snapshotOnly});
  await atomicJson(path.join(folder,'bundle.json'),bundle);
  await atomicJson(path.join(folder,'decision-report.json'),report);
  const html=renderDecisionReport(report);
  await writeFile(path.join(folder,'decision-report.html'),html,{flag:'wx',mode:0o600});
  const manifest={schemaVersion:1,identity,version,names,revisionId:planned.revisionId,bundleRevision:digest(bundle),reportRevision:digest(report),htmlRevision:digest(html),status:'planned',snapshotOnly};
  await atomicJson(path.join(folder,'manifest.json'),manifest);
  return {...manifest,directory:path.resolve(folder),reused:false};
}
