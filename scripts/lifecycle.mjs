import path from 'node:path';
import {hostname,homedir} from 'node:os';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,readFile,readdir,lstat,rename,rm,readlink} from 'node:fs/promises';
import {writeFileSync,renameSync} from 'node:fs';
import {acquireSetupLock,atomicJson,treeDigest,pause} from './setup-recovery.mjs';

export const digest=value=>createHash('sha256').update(value).digest('hex');
export const absolute=(value,label)=>{
 if(typeof value!=='string'||!path.isAbsolute(value)||/[\r\n\0]/.test(value))throw new Error(`${label} must be one absolute path`);
 return path.normalize(value);
};
export const storeRoot=(env=process.env,home=homedir())=>absolute(env.PREMIERE_ASSISTANT_STORE||path.join(home,'Library/Application Support/Premiere Editor Assistant'),'PREMIERE_ASSISTANT_STORE');
const idPattern=/^[a-f0-9]{64}$/;
const kinds=new Set(['bridges','models','scratch']);
const markerName='.assistant-resource.json';
const json=async file=>JSON.parse(await readFile(file,'utf8'));
const entries=async directory=>{try{return await readdir(directory,{withFileTypes:true});}catch(error){if(error.code==='ENOENT')return [];throw error;}};
export async function bridgeIdentity(root,target={platform:process.platform,arch:process.arch,nodeAbi:process.versions.modules}) {
 const lockSha256=digest(await readFile(path.join(root,'runtime-lock.json')));
 const patched=['src/premiere/uxp-reorder.cjs','src/premiere/uxp-transcript.cjs','src/transcription/premiere-format.cjs','src/premiere/uxp-runtime-info.cjs','tools/install-guarded-reorder.mjs'];
 const patchSha256=digest(Buffer.concat(await Promise.all(patched.map(file=>readFile(path.join(root,'workflow',file))))));
 const recipe={schema:1,lockSha256,patchSha256,target,
  installer:digest(await readFile(path.join(root,'scripts/setup-runtime.mjs'))),
  cep:await treeDigest(path.join(root,'vendor/leancoder/cep-plugin'))};
 return {...recipe,id:digest(JSON.stringify(recipe))};
}
export const modelIdentity=({requirements,python,platform=process.platform,arch=process.arch})=>digest(JSON.stringify({schema:1,requirements,python,platform,arch}));
export function resource(store,kind,id) {
 if(!kinds.has(kind)||!idPattern.test(id))throw new Error('Invalid managed resource identity');
 return {kind,id,path:path.join(absolute(store,'store'),kind,id)};
}
export async function ordinaryPath(file,allowMissing=false) {
 let current=path.parse(file).root;
 for(const part of file.slice(current.length).split(path.sep).filter(Boolean)) {
  current=path.join(current,part);
  try{if((await lstat(current)).isSymbolicLink())throw new Error(`Managed path contains a symlink: ${current}`);}
  catch(error){if(allowMissing&&error.code==='ENOENT')return;throw error;}
 }
}
export async function safeDirectory(directory) {await ordinaryPath(directory,true);await mkdir(directory,{recursive:true,mode:0o700});await ordinaryPath(directory);return directory;}
export async function managedPath(store,item,{missing=false}={}) {
 const expected=resource(store,item.kind,item.id);
 if(item.path!==expected.path)throw new Error('Managed resource path differs from its identity');
 await ordinaryPath(expected.path,missing);return expected.path;
}
export async function markResource(store,item,{inventory=false,createdAt=Date.now()}={}) {
 const directory=await managedPath(store,item);
 try {
  const existing=await json(path.join(directory,markerName));
  if(existing.schema!==1||existing.kind!==item.kind||existing.id!==item.id)throw new Error('Conflicting resource ownership');
  return item;
 }catch(error){if(error.code!=='ENOENT')throw error;}
 const marker={schema:1,kind:item.kind,id:item.id,createdAt};
 if(inventory){
  if(item.kind==='bridges'&&(await entries(directory)).some(entry=>entry.name!=='integrations'))throw new Error('Unknown files in bridge directory; preserve before setup');
  marker.files=await treeDigest(directory);delete marker.files[markerName];
 }
 await atomicJson(path.join(directory,markerName),marker);
 return item;
}
async function owned(store,item) {
 const directory=await managedPath(store,item);return readOwnership(directory,item);
}
async function readOwnership(directory,item) {
 const marker=await json(path.join(directory,markerName));
 if(marker.schema!==1||marker.kind!==item.kind||marker.id!==item.id||!Number.isFinite(marker.createdAt))throw new Error('Missing or invalid ownership receipt');
 if(marker.files) {
  const files=await treeDigest(directory);delete files[markerName];
  if(JSON.stringify(files)!==JSON.stringify(marker.files))throw new Error('Managed files changed; preserve for inspection');
 }else {
  const allowed=item.kind==='models'?['python',markerName]:item.kind==='scratch'?['work',markerName]:[];
  if((await entries(directory)).some(entry=>!allowed.includes(entry.name)))throw new Error('Unknown files in managed directory');
 }
 return marker;
}
export async function withStoreLock(store,action) {
 store=absolute(store,'store');
 await ordinaryPath(store,true);await mkdir(store,{recursive:true,mode:0o700});
 // This short lock covers reference/lease changes and deletion, never a download or host call.
 let lock;
 for(let attempt=0;attempt<1200;attempt++) {
  try{lock=await acquireSetupLock(store);break;}
  catch(error){if(!/still running|Another lock recovery|acquired the lock first|no readable ownership record/.test(error.message)||attempt===1199)throw error;await pause(25);}
 }
 try{return await action();}finally{await lock.release();}
}
const alive=(pid,group=false)=>{try{process.kill(group?-pid:pid,0);return true;}catch(error){if(error.code==='ESRCH')return false;return true;}};
const validOwner=owner=>owner?.host===hostname()&&Number.isSafeInteger(owner.pid)&&owner.pid>0&&typeof owner.spawning==='boolean'&&Array.isArray(owner.groups)&&owner.groups.every(pid=>Number.isSafeInteger(pid)&&pid>0);
export async function acquireLease(store,paths) {
 paths=[...new Set(paths.filter(Boolean).map(value=>absolute(value,'lease path')))];
 const owner={schema:1,host:hostname(),pid:process.pid,token:randomUUID(),spawning:false,groups:[],paths};
 const file=path.join(store,'leases',owner.token+'.json');
 const save=()=>{const temporary=file+'.tmp';writeFileSync(temporary,JSON.stringify(owner),{mode:0o600});renameSync(temporary,file);};
 await withStoreLock(store,async()=>{await safeDirectory(path.dirname(file));save();});
 let released=false;
 return {
  async add(paths){await withStoreLock(store,async()=>{owner.paths=[...new Set([...owner.paths,...paths.map(p=>absolute(p,'lease path'))])];save();});},
  beforeSpawn(){owner.spawning=true;save();},
  started(pid){if(pid)owner.groups.push(pid);owner.spawning=false;save();},
  finished(){owner.groups=owner.groups.filter(pid=>alive(pid,true));save();},
  async release(){if(released)return;owner.groups=owner.groups.filter(pid=>alive(pid,true));if(owner.spawning||owner.groups.length){save();return;}await withStoreLock(store,()=>rm(file,{force:true}));released=true;}
 };
}
export function installationSlot(pluginRoot) {
 // Host caches have one slot per marketplace/plugin, regardless of the release directory.
 const parts=absolute(pluginRoot,'plugin root').split(path.sep),index=parts.lastIndexOf('cache');
 return index>=0&&parts[index-1]==='plugins'&&parts.length===index+4?parts.slice(0,-1).join(path.sep):pluginRoot;
}
export async function registerRelease({store,pluginRoot,version,paths,healthy=false,configuration,panelPath}) {
 const slot=installationSlot(pluginRoot),file=path.join(store,'references',digest(slot)+'.json');
 return withStoreLock(store,async()=>{
  await safeDirectory(path.dirname(file));
  let prior;try{prior=await json(file);}catch(error){if(error.code!=='ENOENT')throw error;}
  if(prior&&(prior.schema!==1||prior.slot!==slot||!Array.isArray(prior.current?.paths)||prior.previous&&!Array.isArray(prior.previous.paths)))throw new Error('Invalid installation reference; preserve and reconcile it');
  const current={pluginRoot:absolute(pluginRoot,'plugin root'),version,paths:[...new Set(paths.map(p=>absolute(p,'release path')))],healthy,updatedAt:Date.now()};
  const same=prior&&prior.current.version===version&&JSON.stringify(prior.current.paths)===JSON.stringify(current.paths);
  current.panelPaths=panelPath?[absolute(panelPath,'live panel path')]:same?prior.current.panelPaths||[]:[];
  // A failed/new setup must not evict the last known working rollback installation.
  const previous=same?prior.previous:prior?.current.healthy?prior.current:prior?.previous;
  if(same)current.healthy||=prior.current.healthy;
  if(prior?.cached&&!Array.isArray(prior.cached))throw new Error('Invalid cached installation references');
  const cached=slot!==pluginRoot?[...(prior?.cached||[]).filter(release=>release.pluginRoot!==current.pluginRoot),current]:[];
  await atomicJson(file,{schema:1,slot,configuration:configuration?absolute(configuration,'configuration'):prior?.configuration,current,previous,cached});return {slot,current,previous};
 });
}
export async function registerConfiguration(store,directory) {
 return withStoreLock(store,async()=>{
  await safeDirectory(path.join(store,'configurations'));
  await atomicJson(path.join(store,'configurations',digest(directory)+'.json'),{schema:1,directory:absolute(directory,'configuration')});
 });
}
export const overlaps=(a,b)=>a===b||a.startsWith(b+path.sep)||b.startsWith(a+path.sep);
export async function referenceTargets(file) {
 const targets=[];let current=file;
 for(let hops=0;hops<40;hops++) {
  const parts=current.slice(path.parse(current).root.length).split(path.sep).filter(Boolean);let prefix=path.parse(current).root,linked=false;
  for(let index=0;index<parts.length;index++) {
   prefix=path.join(prefix,parts[index]);let info;
   try{info=await lstat(prefix);}catch(error){if(error.code==='ENOENT')return targets;throw error;}
   if(info.isSymbolicLink()) {
    current=path.resolve(path.dirname(prefix),await readlink(prefix),...parts.slice(index+1));targets.push(current);linked=true;break;
   }
  }
  if(!linked)return targets;
 }
 throw new Error('Too many symlinks in a protected reference');
}
export async function deletionInventory(directory,prefix='') {
 const files=Object.create(null);
 for(const entry of await readdir(path.join(directory,prefix),{withFileTypes:true})) {
  const name=path.join(prefix,entry.name),file=path.join(directory,name);
  if(entry.isSymbolicLink())files[name]={symlink:await readlink(file)};
  else if(entry.isDirectory()){files[name]={directory:true};Object.assign(files,await deletionInventory(directory,name));}
  else if(entry.isFile())files[name]={sha256:digest(await readFile(file))};
  else throw new Error(`Unknown filesystem entry in cleanup resource: ${name}`);
 }
 return files;
}
export function remainingInventoryMatches(expected,remaining) {
 if(!expected||typeof expected!=='object'||Array.isArray(expected))throw new Error('Missing quarantine inventory');
 for(const [name,value] of Object.entries(remaining))if(!Object.hasOwn(expected,name)||JSON.stringify(expected[name])!==JSON.stringify(value))throw new Error('Quarantined files changed; preserve for inspection');
}
export async function cleanup({store,protectedPaths=[],apply=false,now=Date.now(),graceMs=7*86400000,cacheAgeMs=30*86400000,legacyPlanner}) {
 return withStoreLock(store,async()=>{
  const keep=new Set(protectedPaths.filter(Boolean).map(p=>absolute(p,'protected path'))),blocked=[],removed=[],candidates=[],preserved=[],staleLeases=[],recovered=[],retiredReferences=[];
  const registrations=[];let hasHealthyRollback=false;
  const protectConfiguration=async directory=>{
   for(const name of ['python','node','ffmpeg','ffprobe']) {
    try{keep.add(absolute((await readFile(path.join(absolute(directory,'configuration'),name),'utf8')).trim(),'configured executable'));}
    catch(error){if(error.code!=='ENOENT')throw error;}
   }
   for(const subdirectory of ['runtimes','runtime-overrides'])for(const entry of await entries(path.join(directory,subdirectory))) {
    if(!entry.isFile())throw new Error('Unknown saved runtime reference');
    const file=path.join(directory,subdirectory,entry.name),saved=absolute((await readFile(file,'utf8')).trim(),'saved runtime');
    if(legacyPlanner&&subdirectory==='runtimes'&&/^0\.1\.\d+$/.test(entry.name)&&path.basename(saved)===entry.name){if(!registrations.some(r=>r.file===file))registrations.push({file,path:saved,version:entry.name});}
    else keep.add(saved);
   }
  };
  await ordinaryPath(path.join(store,'references'),true);await ordinaryPath(path.join(store,'leases'),true);
  for(const entry of await entries(path.join(store,'references'))) {
   try {
    if(!entry.isFile()||!entry.name.endsWith('.json'))throw new Error('Unknown reference entry');
    const record=await json(path.join(store,'references',entry.name));
    if(record.schema!==1||typeof record.slot!=='string'||!record.current||!Array.isArray(record.current.paths))throw new Error('Invalid installation reference');
    const present=async release=>{
     try {
      const manifest=await json(path.join(absolute(release.pluginRoot,'plugin root'),'plugin.json'));
      if(manifest.name!=='premiere-editor-assistant'||manifest.version!==release.version)throw new Error('Registered plugin identity changed');
      return true;
     }catch(error){if(error.code==='ENOENT')return false;throw error;}
    };
    let installed=await present(record.current);
    if(installed&&record.current.healthy&&record.previous?.healthy&&record.previous.version!==record.current.version) {
     const bridges=(record.previous.paths||[]).filter(p=>path.dirname(p)===path.join(store,'bridges')&&idPattern.test(path.basename(p)));
     let available=bridges.length>0;
     for(const directory of bridges)try{await owned(store,resource(store,'bridges',path.basename(directory)));}
     catch(error){available=false;preserved.push({path:directory,reason:'Shared rollback unavailable: '+error.message});}
     if(available)hasHealthyRollback=true;
    }
    if(record.cached&&!Array.isArray(record.cached))throw new Error('Invalid cached package references');
    for(const release of record.cached||[]) {
     try {
      if(!await present(release))continue;
      installed=true;
      for(const p of [...release.paths,...release.panelPaths||[]])keep.add(absolute(p,'cached dependency'));
     }catch(error){if(error.code!=='ENOENT')throw error;}
    }
    if(!Number.isFinite(record.current.updatedAt))throw new Error('Missing installation reference timestamp');
    if(installed||now-record.current.updatedAt<graceMs)for(const release of [record.current,record.previous].filter(Boolean))for(const p of [...release.paths,...release.panelPaths||[]])keep.add(absolute(p,'reference'));
    else retiredReferences.push(path.join(store,'references',entry.name));
    if(record.configuration)await protectConfiguration(record.configuration);
   }catch(error){blocked.push({file:entry.name,reason:error.message});}
  }
  await ordinaryPath(path.join(store,'configurations'),true);
  for(const entry of await entries(path.join(store,'configurations')))try {
   if(!entry.isFile())throw new Error('Unknown configuration reference');
   const record=await json(path.join(store,'configurations',entry.name));
   if(record.schema!==1)throw new Error('Invalid configuration reference');
   await protectConfiguration(record.directory);
  }catch(error){blocked.push({file:entry.name,reason:error.message});}
  for(const entry of await entries(path.join(store,'leases'))) {
   try {
    if(!entry.isFile()||!entry.name.endsWith('.json'))throw new Error('Unknown lease entry');
    const owner=await json(path.join(store,'leases',entry.name));
    if(!validOwner(owner)||!Array.isArray(owner.paths))throw new Error('Unknown lease owner');
    if(owner.spawning||alive(owner.pid)||owner.groups.some(pid=>alive(pid,true)))for(const p of owner.paths)keep.add(absolute(p,'lease'));
    else staleLeases.push(path.join(store,'leases',entry.name));
   }catch(error){blocked.push({file:entry.name,reason:error.message});}
  }
  for(const p of [...keep])try{for(const target of await referenceTargets(p))keep.add(target);}catch(error){blocked.push({path:p,reason:error.message});}
  let migration;
  if(legacyPlanner) {
   if(blocked.length)migration={checked:false,candidates:[],preserved:[],blocked:[{reason:'Resolve uncertain runtime references or leases before historical cleanup'}]};
   else migration=await legacyPlanner({keep,blocked,registrations,hasHealthyRollback,apply,now});
   if(migration.checked&&!migration.blocked.length)candidates.push(...migration.candidates);
  }
  for(const kind of kinds) {
   await ordinaryPath(path.join(store,kind),true);
   for(const entry of await entries(path.join(store,kind))) {
   const directory=path.join(store,kind,entry.name);
   if(!entry.isDirectory()||!idPattern.test(entry.name)){preserved.push({path:directory,reason:'unrecognized or linked directory'});continue;}
   const item=resource(store,kind,entry.name);
   if([...keep].some(p=>overlaps(p,directory))){preserved.push({...item,reason:'referenced or in use'});continue;}
   try {
    const marker=await owned(store,item);
    if(now-marker.createdAt<(kind==='scratch'?cacheAgeMs:graceMs)){preserved.push({...item,reason:'retention period'});continue;}
    if(blocked.length){preserved.push({...item,reason:'uncertain references or leases'});continue;}
    candidates.push(item);
   }catch(error){preserved.push({...item,reason:error.message});}
   }
  }
  // Downloads are checksum-addressed files written by this installer. Unknown files survive.
  await ordinaryPath(path.join(store,'downloads'),true);
  for(const entry of await entries(path.join(store,'downloads'))) {
   const file=path.join(store,'downloads',entry.name),match=/^([a-f0-9]{64})\.zip$/.exec(entry.name);
   if(!entry.isFile()||!match){preserved.push({path:file,reason:'unrecognized cache file'});continue;}
   const info=await lstat(file);
   if(blocked.length||now-info.mtimeMs<cacheAgeMs||[...keep].some(p=>overlaps(p,file))){preserved.push({path:file,reason:'retained cache'});continue;}
   await ordinaryPath(file);
   if(digest(await readFile(file))!==match[1]){preserved.push({path:file,reason:'cache checksum mismatch'});continue;}
   candidates.push({kind:'download',path:file});
  }
  const trash=path.join(store,'trash');await ordinaryPath(trash,true);
  const legacyTools=legacyPlanner?await import('./legacy-migration.mjs'):undefined;
  let legacyReady=Boolean(migration?.checked&&!migration.blocked.length);
  if(apply&&legacyReady)try{await migration.beforeApply?.();}catch(error){migration.blocked.push({reason:error.message});legacyReady=false;}
  for(const entry of await entries(trash)) {
   if(!entry.isFile()||!/^([a-f0-9-]{36})\.json$/.test(entry.name))continue;
   const receipt=path.join(trash,entry.name);let destination=receipt.slice(0,-5);
   try {
    const record=await json(receipt),item=record.item;
    if(![1,2,3].includes(record.schema)||!item)throw new Error('Invalid interrupted cleanup receipt');
    if(item.kind==='legacy') {
     if(!legacyReady){preserved.push({path:record.quarantinePath||destination,reason:'Fresh legacy ownership checks are required'});continue;}
     await legacyTools.validateLegacyItem(store,item);
     const expected=path.join(path.dirname(item.legacyRoot),'.premiere-assistant-migration-trash',path.basename(receipt,'.json'));
     if(record.quarantinePath!==expected||legacyTools.legacyInventoryHash(record.inventory)!==item.inventoryHash)throw new Error('Historical quarantine evidence differs');
     destination=expected;
    }
    if(item.kind==='download') {
     if(path.dirname(item.path)!==path.join(store,'downloads')||!/^[a-f0-9]{64}\.zip$/.test(path.basename(item.path)))throw new Error('Unsafe interrupted cache cleanup');
    }else if(item.kind!=='legacy'&&item.path!==resource(store,item.kind,item.id).path)throw new Error('Unsafe interrupted resource cleanup');
    try{await lstat(destination);}catch(error){if(error.code==='ENOENT'){if(apply&&!blocked.length)await rm(receipt);continue;}throw error;}
    await ordinaryPath(item.entryType==='symlink'?path.dirname(destination):destination);
    if(item.kind==='download'){if(digest(await readFile(destination))!==path.basename(item.path,'.zip'))throw new Error('Quarantined archive changed');}
    else if(item.kind==='legacy')remainingInventoryMatches(record.inventory,await legacyTools.legacyItemInventory({...item,path:destination}));
    else if(record.schema===1)await readOwnership(destination,item);
    else {
     if(!record.inventory?.[markerName]?.sha256)throw new Error('Quarantine receipt lacks original ownership evidence');
     remainingInventoryMatches(record.inventory,await deletionInventory(destination));
    }
    if(blocked.length||[...keep].some(p=>overlaps(p,destination)||item.kind==='legacy'&&overlaps(p,item.path))){preserved.push({path:destination,reason:'quarantined data is referenced or ownership is uncertain'});continue;}
    if(apply){await rm(destination,{recursive:true});await rm(receipt);recovered.push(destination);}
    else candidates.push({kind:'quarantine',path:destination,receipt});
   }catch(error){preserved.push({path:destination,reason:error.message});}
  }
  const removedItems=[];
  if(apply)for(const item of candidates) {
   if(item.kind==='legacy'&&(migration.blocked.length||[...keep].some(p=>overlaps(p,item.path)))){preserved.push({path:item.path,reason:'Historical use changed during cleanup'});continue;}
   // Rename while holding the same lock used by launchers; nothing can acquire this resource mid-delete.
   await safeDirectory(trash);
   const token=randomUUID(),receipt=path.join(trash,token+'.json');
   const destination=item.kind==='legacy'?path.join(path.dirname(item.legacyRoot),'.premiere-assistant-migration-trash',token):path.join(trash,token);
   let inventory;
   if(item.kind==='legacy') {
    await legacyTools.validateLegacyItem(store,item);await ordinaryPath(item.entryType==='symlink'?path.dirname(item.path):item.path);
    inventory=await legacyTools.legacyItemInventory(item);
    if(legacyTools.legacyInventoryHash(inventory)!==item.inventoryHash){preserved.push({path:item.path,reason:'Historical files changed after preview'});continue;}
    await safeDirectory(path.dirname(destination));
   }else inventory=item.kind==='download'?undefined:await deletionInventory(item.path);
   await atomicJson(receipt,{schema:item.kind==='legacy'?3:2,item,createdAt:now,inventory,...(item.kind==='legacy'?{quarantinePath:destination}:{})});
   await rename(item.path,destination);await rm(destination,{recursive:true});await rm(receipt);removed.push(item.path);removedItems.push(item);
  }
  if(apply&&legacyReady&&!migration.blocked.length)await migration.afterApply?.(removedItems);
  if(apply&&!blocked.length)for(const file of staleLeases)await rm(file,{force:true});
  const legacy=(await entries(store)).filter(e=>e.isDirectory()&&/^\d+\.\d+\.\d+$/.test(e.name)).map(e=>({path:path.join(store,e.name),reason:legacyPlanner?'remaining historical contents retained by migration policy':'legacy installation; preserved in place'}));
  const migrationReport=migration?Object.fromEntries(Object.entries(migration).filter(([,value])=>typeof value!=='function')):undefined;
  return {mode:apply?'apply':'preview',store,candidates,preserved,legacy,blocked,removed,recovered,staleLeases,retiredReferences,migration:migrationReport};
 });
}
export async function legacyCandidates(store,registration) {
 const candidates=[];
 if(registration)try{candidates.push(absolute((await readFile(registration,'utf8')).trim(),'legacy registration'));}catch(error){if(error.code!=='ENOENT')throw error;}
 for(const entry of await entries(store))if(entry.isDirectory()&&/^\d+\.\d+\.\d+$/.test(entry.name))candidates.push(path.join(store,entry.name));
 return [...new Set(candidates)];
}
export async function adoptBridge({store,item,candidates,checkRuntime,identity}) {
 for(const candidate of candidates) {
  const source=path.join(candidate,'integrations');
  try {
   await ordinaryPath(source);const marker=await checkRuntime(source);
   if(Object.keys(marker.files||{}).length<7)continue;
   const files=await treeDigest(source);
   if(identity) {
    if(JSON.stringify(await treeDigest(path.join(source,'cep-panel')))!==JSON.stringify(identity.cep))continue;
    if(Object.keys(files).some(name=>/(?:\.node|\.dylib|\.so(?:\.\d+)*)$/.test(name))&&JSON.stringify(marker.target)!==JSON.stringify(identity.target))continue;
   }
   const {cp}=await import('node:fs/promises');
   const temporary=item.path+'.adopt-'+randomUUID();await mkdir(temporary,{recursive:true});
   try {
    await cp(source,path.join(temporary,'integrations'),{recursive:true,verbatimSymlinks:true});
    if(JSON.stringify(files)!==JSON.stringify(await treeDigest(path.join(temporary,'integrations'))))throw new Error('Legacy bridge changed during adoption');
    if(identity)await atomicJson(path.join(temporary,'integrations/installation.json'),{...marker,runtimeId:identity.id,target:identity.target});
    await checkRuntime(path.join(temporary,'integrations'));
    await managedPath(store,item,{missing:true});await rename(temporary,item.path);
    await markResource(store,item,{inventory:true});return {adoptedFrom:candidate};
   }finally{await rm(temporary,{recursive:true,force:true});}
  }catch(error){if(!['ENOENT','ENOTDIR'].includes(error.code)&&/symlink|changed during adoption/.test(error.message))throw error;}
 }
 return undefined;
}
