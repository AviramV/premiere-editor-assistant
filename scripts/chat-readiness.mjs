import path from 'node:path';
import {compareChatCatalog} from './tool-catalog.mjs';

const cep=['get_capabilities','verify_premiere_connection','get_project_info'];
export const workflowTools={
 'organize-project':{premiere_cep:[...cep,'list_sequences','get_bin_contents','get_project_item_info','create_bin','move_items_to_bin','rename_project_item','save_project','create_project_backup']},
 'create-proxies':{premiere_cep:[...cep,'get_project_item_info','has_proxy','manage_proxies','save_project','create_project_backup']},
 'edit-video':{premiere_cep:[...cep,'get_full_sequence_info','list_sequences','save_project'],premiere_uxp:['ppro_env','ppro_capabilities','ppro_transcript_probe','ppro_guarded_reorder','ppro_transcript_import']},
 'export-omf':{premiere_cep:[...cep,'list_sequences','get_full_sequence_info','duplicate_sequence','rename_project_item','set_active_sequence','preview_edit_plan','apply_edit_plan','delete_track','clear_sequence_in_out','export_omf','verify_delivery_file','save_project','create_project_backup']},
};
const operation=name=>typeof name==='string'?name.slice(name.lastIndexOf('__')+2):'';
const toolName=name=>name.includes('__')?operation(name):name;
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);

function payload(response) {
 if(!object(response)||response.isError===true||response.structuredContent?.ok===false)throw new Error('Read-only chat probe failed');
 let value=response.structuredContent?.data;
 if(value===undefined) {
  const text=response.content?.find(item=>item.type==='text')?.text;
  try{value=JSON.parse(text);}catch{throw new Error('Read-only chat probe has no recognizable native result');}
 }
 if(!object(value)||value.ok===false||value.success===false||value.error)throw new Error('Read-only chat probe returned an error');
 return value;
}

// This checks evidence supplied by the actual agent. It cannot independently
// observe a chat's tools or prove the origin of an arbitrary JSON file.
export function checkChatReadiness(inventory,{workflow,projectPath,now=Date.now(),maxAgeMs=300000}={}) {
 if(!Object.hasOwn(workflowTools,workflow))throw new Error('Unknown readiness workflow');
 if(!path.isAbsolute(projectPath||'')||path.extname(projectPath).toLowerCase()!=='.prproj')throw new Error('Readiness requires the exact absolute .prproj path');
 const issues=[],requirements=workflowTools[workflow],observations=[];
 const fresh=(value,label)=>{
  const timestamp=Date.parse(value);
  if(!Number.isFinite(timestamp)||timestamp>now+30000||now-timestamp>maxAgeMs)throw new Error(`${label} is missing, stale or in the future; collect fresh evidence in this chat`);
 };
 try{fresh(inventory?.collectedAt,'Chat inventory');}catch(error){issues.push(error.message);}
 for(const [backend,required]of Object.entries(requirements)) {
  try {
   const comparison=compareChatCatalog(backend,{tools:required.map(name=>({name}))},inventory);
   if(!comparison.chatInventoryCompared)throw new Error('Actual chat inventory is required');
   const rows=inventory.servers[backend];
   for(const name of required) {
    const row=rows.find(row=>toolName(row.name)===name);
    if(!row?.callable)issues.push(`${backend}.${name}: callable chat binding missing`);
    else if(row.schemaAvailable!==true)issues.push(`${backend}.${name}: current chat schema unverified`);
   }
   const probeName=backend==='premiere_cep'?'get_project_info':'ppro_env';
   const probe=inventory.readOnlyChecks?.find(check=>check.backend===backend&&toolName(check.name||'')===probeName);
   if(!probe)throw new Error(`${backend}: read-only ${probeName} response from this chat is required`);
   // Validate the probe's registration too, not just its operation suffix.
   compareChatCatalog(backend,{tools:[{name:probeName}]},{...inventory,servers:{[backend]:[{name:probe.name,callable:true}]}});
   fresh(probe.collectedAt,`${backend} read-only probe`);
   const value=payload(probe.response),observed=backend==='premiere_cep'?value.path:value.project?.path;
   if(typeof observed!=='string'||!path.isAbsolute(observed)||path.resolve(observed)!==path.resolve(projectPath))throw new Error(`${backend}: live project identity does not match the requested project`);
   if(backend==='premiere_uxp') {
    const match=/^(\d+)\.(\d+)(?:\.\d+){0,2}(?:[-+].*)?$/.exec(value.appVersion||'');
    if(!match||Number(match[1])<26||Number(match[1])===26&&Number(match[2])<3||Number(match[1])>27)throw new Error('UXP host version needs compatibility review');
    for(const feature of ['executeTransaction','lockedAccess','transcribeClipProjectItem','exportToJSON'])if(value.features?.[feature]!==true)throw new Error(`UXP host capability missing: ${feature}`);
   }
   observations.push({backend,probe:probeName,projectPath:observed,collectedAt:probe.collectedAt});
  }catch(error){issues.push(error.message);}
 }
 return {schema:1,status:issues.length?'not_ready':'prerequisites_verified',workflow,projectPath:path.resolve(projectPath),checkedAt:new Date(now).toISOString(),
  requirements,observations,issues,writeBehaviorVerified:false,
  scope:'Checks supplied current chat schemas, bindings and read-only native responses. It does not inspect a hidden host registry, prove evidence origin, grant authority, or verify editing behavior.'};
}

export function requireChatReadiness(inventory,options) {
 const result=checkChatReadiness(inventory,options);
 if(result.status!=='prerequisites_verified')throw new Error('Chat readiness failed: '+result.issues.join('; '));
 return result;
}
