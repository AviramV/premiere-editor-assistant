import path from 'node:path';
import {readFile,mkdir} from 'node:fs/promises';
import {readFileSync,existsSync} from 'node:fs';
import {digest,modelIdentity,resource,markResource,managedPath,withStoreLock,safeDirectory} from './lifecycle.mjs';
import {atomicJson,acquireSetupLock} from './setup-recovery.mjs';
import {localModels} from './setup-runtime.mjs';

export const modelReference=(store,requirements)=>path.join(store,'model-references',digest(JSON.stringify({requirements:digest(requirements),platform:process.platform,arch:process.arch}))+'.json');
export function savedModel(store,requirements) {
 try {
  const record=JSON.parse(readFileSync(modelReference(store,requirements),'utf8'));
  if(record.schema!==1||record.requirements!==digest(requirements)||!path.isAbsolute(record.path)||/[\r\n\0]/.test(record.path))throw new Error('Invalid model environment reference');
  return existsSync(record.path)?record.path:undefined;
 }catch(error){if(error.code==='ENOENT')return undefined;throw error;}
}
export function requirementsSatisfied(requirements,versions) {
 const compare=(a,b)=>{const x=a.replace(/\+.*/,''),y=b.replace(/\+.*/,'');if(!/^\d+(?:\.\d+)*$/.test(x)||!/^\d+(?:\.\d+)*$/.test(y))return undefined;const p=x.split('.').map(Number),q=y.split('.').map(Number);for(let i=0;i<Math.max(p.length,q.length);i++)if((p[i]||0)!==(q[i]||0))return (p[i]||0)>(q[i]||0)?1:-1;return 0;};
 for(const line of String(requirements).split('\n').map(s=>s.trim()).filter(s=>s&&!s.startsWith('#'))) {
  const match=/^([A-Za-z0-9_-]+)((?:>=|<=|==|>|<).+)$/.exec(line);if(!match||typeof versions[match[1]]!=='string')return false;
  for(const bound of match[2].split(',')) {
   const constraint=/^(>=|<=|==|>|<)(\d+(?:\.\d+)*)$/.exec(bound.trim());if(!constraint)return false;
   const order=compare(versions[match[1]],constraint[2]);if(order===undefined||!({'==':order===0,'>=':order>=0,'<=':order<=0,'>':order>0,'<':order<0}[constraint[1]]))return false;
  }
 }
 return true;
}
export async function adoptLegacyModels({root,store,candidates,run,env,hold}) {
 if(env.PREMIERE_ASSISTANT_PYTHON)return {status:'configured_environment_retained',path:env.PREMIERE_ASSISTANT_PYTHON};
 const requirements=await readFile(path.join(root,'requirements-local.txt'));
 const existing=savedModel(store,requirements);if(existing)return {status:'shared_environment_available',path:existing};
 const packages=String(requirements).split('\n').map(line=>/^([A-Za-z0-9_-]+)(?:>=|<=|==|>|<)/.exec(line.trim())?.[1]).filter(Boolean);
 const failures=[];
 const ordered=[...new Set(candidates)].filter(directory=>/^0\.1\.\d+$/.test(path.basename(directory))).sort((a,b)=>Number(path.basename(b).split('.')[2])-Number(path.basename(a).split('.')[2]));
 for(const directory of ordered) {
  const python=path.join(directory,'python/bin/python');if(!existsSync(python))continue;
  await hold(python);
  try {
   await run(python,[path.join(root,'workflow/tools/local_models.py')],{timeout:45000});
   const versions=JSON.parse(await run(python,['-c','import importlib.metadata,json,sys; print(json.dumps({name:importlib.metadata.version(name) for name in sys.argv[1:]}))',...packages],{timeout:15000}));
   if(!requirementsSatisfied(requirements,versions))throw new Error('Existing local models do not satisfy this package requirements');
   await withStoreLock(store,async()=>{const file=modelReference(store,requirements);await safeDirectory(path.dirname(file));await atomicJson(file,{schema:1,requirements:digest(requirements),path:python,legacy:true,versions});});
   return {status:'adopted_legacy_environment',path:python,reused:true,external:true,requirementsVerified:true,modelWeightsVerified:false};
  }catch(error){failures.push({path:python,reason:error.message});}
 }
 return {status:failures.length?'legacy_environments_preserved':'no_legacy_environment',failures};
}
export async function prepareModels({root,store,python,run,report,env,hold,watch=()=>()=>{}}) {
 const requirements=await readFile(path.join(root,'requirements-local.txt'));
 const probe=[path.join(root,'workflow/tools/local_models.py')];
 await run(python,[...probe,'--metal-only'],{timeout:15000});
 // Explicit interpreters, including old versioned venvs, are validated and adopted in place.
 if(env.PREMIERE_ASSISTANT_PYTHON) {
  try {await run(python,probe,{timeout:45000});return {path:python,reused:true,external:true,modelWeightsVerified:false};}catch{}
 }
 const pythonIdentity=JSON.parse(await run(python,['-c','import sys,json; print(json.dumps({"version":list(sys.version_info[:3]),"implementation":sys.implementation.name,"cacheTag":sys.implementation.cache_tag}))'],{timeout:15000}));
 if(!Array.isArray(pythonIdentity.version)||pythonIdentity.version.length!==3||!pythonIdentity.version.every(Number.isInteger)||typeof pythonIdentity.implementation!=='string'||typeof pythonIdentity.cacheTag!=='string')throw new Error('Invalid Python identity');
 const item=resource(store,'models',modelIdentity({requirements:digest(requirements),python:pythonIdentity}));
 await hold(item.path);
 await managedPath(store,item,{missing:true});await mkdir(item.path,{recursive:true});
 const lockDirectory=path.join(store,'model-setup',item.id);await safeDirectory(lockDirectory);
 const lock=await acquireSetupLock(lockDirectory);
 const unwatch=watch(lock);
 try {
  await safeDirectory(path.join(store,'model-receipts'));
  const result=await localModels({root,state:item.path,python,run,report,receiptFile:path.join(store,'model-receipts',item.id+'.json')});
  await markResource(store,item);
  if(!env.PREMIERE_ASSISTANT_PYTHON)await withStoreLock(store,async()=>{
   const file=modelReference(store,requirements);await safeDirectory(path.dirname(file));
   await atomicJson(file,{schema:1,requirements:digest(requirements),path:result.path,resource:item});
  });
  return {...result,requiresConfiguration:Boolean(env.PREMIERE_ASSISTANT_PYTHON)&&result.path!==python,resource:item};
 }finally{unwatch();await lock.release();}
}
