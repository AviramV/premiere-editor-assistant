import path from 'node:path';
import {readFile,mkdir,cp,readdir,lstat,rename,rm,rmdir} from 'node:fs/promises';
import {homedir} from 'node:os';
import {execFile} from 'node:child_process';
import {gunzipSync} from 'node:zlib';
import {promisify} from 'node:util';
import {absolute,digest,ordinaryPath,safeDirectory,overlaps,referenceTargets,deletionInventory} from './lifecycle.mjs';
import {treeDigest,atomicJson} from './setup-recovery.mjs';

const execute=promisify(execFile);
const json=async file=>JSON.parse(await readFile(file,'utf8'));
const entries=async directory=>{try{return await readdir(directory,{withFileTypes:true});}catch(error){if(error.code==='ENOENT')return [];throw error;}};
const legacyVersion=value=>/^0\.1\.(?:0|[1-9]\d*)$/.test(value);
const hashPattern=/^[a-f0-9]{64}$/;
const safeName=name=>typeof name==='string'&&!path.isAbsolute(name)&&!name.includes('\\')&&!name.includes('\0')&&name.split('/').every(p=>p&&p!=='.'&&p!=='..');
const patchedPaths=new Set(['leancoder-runtime/server/dist/index.js','quadlzzz/mcp/server.js','quadlzzz/panel/main.js','quadlzzz/panel/guarded-reorder.js','quadlzzz/panel/guarded-reorder.cjs','quadlzzz/panel/import-transcript.js','quadlzzz/panel/transcript-format.js','quadlzzz/panel/manifest.json']);
export async function createLegacyBaseline({root,pins,work,dependencies}) {
 return {schema:1,lockSha256:digest(await readFile(path.join(root,'runtime-lock.json'))),
  archives:Object.fromEntries(Object.entries(pins).map(([name,pin])=>[name,pin.sha256])),
  leancoder:await treeDigest(path.join(work,'sources/leancoder')),quadSource:await treeDigest(path.join(work,'sources/quadlzzz')),
  quadDependencies:await treeDigest(dependencies),cep:await treeDigest(path.join(root,'vendor/leancoder/cep-plugin')),
  license:digest(await readFile(path.join(root,'vendor/leancoder/LICENSE')))};
}
export async function readLegacyBaseline(runtimes) {
 const marker=await json(path.join(runtimes,'installation.json')),file=path.join(runtimes,'legacy-baseline.json');
 if(!marker.files?.['legacy-baseline.json']||digest(await readFile(file))!==marker.files['legacy-baseline.json'])throw new Error('Verified historical cleanup baseline is unavailable; rerun the current setup');
 const baseline=await json(file);
 if(baseline.schema!==1||baseline.lockSha256!==marker.lockSha256)throw new Error('Historical cleanup baseline differs from the installed runtime');
 return validateBaseline(baseline);
}
function validateBaseline(baseline) {
 for(const key of ['leancoder','quadSource','quadDependencies','cep'])validateMap(baseline[key]);
 if(!hashPattern.test(baseline.license)||!Object.values(baseline.archives||{}).every(v=>hashPattern.test(v)))throw new Error('Invalid historical baseline');
 return baseline;
}
function validateMap(files) {
 if(!files||typeof files!=='object'||Array.isArray(files))throw new Error('Invalid legacy inventory');
 for(const [name,value] of Object.entries(files))if(!safeName(name)||!(typeof value==='string'&&hashPattern.test(value)||value&&typeof value.symlink==='string'))throw new Error('Unsafe legacy inventory entry');
 return files;
}
function prefixed(files,prefix) {return Object.fromEntries(Object.entries(files).map(([name,value])=>[path.join(prefix,name),value]));}
export function legacyRuntimeFiles(baseline,marker) {
 if(marker.lockSha256!==baseline.lockSha256||!hashPattern.test(marker.patchSha256))throw new Error('Unsupported historical runtime pins');
 const paths=Object.keys(validateMap(marker.files));
 if(paths.length<5||paths.some(name=>!patchedPaths.has(name)||!hashPattern.test(marker.files[name])))throw new Error('Unrecognized historical runtime receipt');
 return {...prefixed(baseline.leancoder,'leancoder-runtime'),...prefixed(baseline.quadDependencies,'quadlzzz'),...prefixed(baseline.cep,'cep-panel'),
  'leancoder-runtime/LICENSE':baseline.license,...marker.files};
}

const matches=(entry,expected)=>typeof expected==='string'?entry?.sha256===expected:expected?.symlink!==undefined&&entry?.symlink===expected.symlink;
const versionOrder=(a,b)=>Number(a.version.split('.')[2])-Number(b.version.split('.')[2]);
const receiptPath=(store,directory)=>path.join(store,'migration-roots',digest(directory)+'.json');
async function savedRoot(store,directory) {
 try{const file=receiptPath(store,directory);await ordinaryPath(file,true);const data=await json(file);if(data.schema!==1||data.root!==directory||!legacyVersion(data.version))throw new Error('Invalid historical migration record');return data;}
 catch(error){if(error.code==='ENOENT')return undefined;throw error;}
}
export async function discoverLegacyRoots({store,home=homedir(),registrations=[]}) {
 const bases=new Set([store,path.join(home,'Library/Application Support/Premiere Editor Assistant')]),roots=new Set();
 for(const base of bases) {
  await ordinaryPath(base,true);
  for(const entry of await entries(base))if(entry.isDirectory()&&legacyVersion(entry.name))roots.add(path.join(base,entry.name));
 }
 for(const registration of registrations)if(legacyVersion(registration.version)&&path.basename(registration.path)===registration.version)roots.add(registration.path);
 await ordinaryPath(path.join(store,'migration-roots'),true);
 for(const entry of await entries(path.join(store,'migration-roots'))) {
  if(!entry.isFile()||!entry.name.endsWith('.json')||!hashPattern.test(entry.name.replace(/\.json$/,'')))throw new Error('Unknown migration root record');
  const record=await json(path.join(store,'migration-roots',entry.name));
  if(record.schema!==1||!legacyVersion(record.version)||path.basename(record.root)!==record.version)throw new Error('Invalid migration root record');
  roots.add(absolute(record.root,'legacy root'));
 }
 return [...roots].sort();
}
function pathMention(text,directory) {
 const normalized=text.normalize('NFD').toLowerCase(),needle=directory.normalize('NFD').toLowerCase();
 let index=normalized.indexOf(needle);
 while(index>=0) {
  const next=normalized[index+needle.length];if(next===undefined||/[\s/"']/.test(next))return true;
  index=normalized.indexOf(needle,index+1);
 }
 return false;
}
export async function inspectLegacyUse(directories) {
 const paths=new Set(),pids=new Set();
 const ps=await execute('/bin/ps',['-ax','-o','pid=','-o','command='],{encoding:'utf8',timeout:10000,maxBuffer:32*1024*1024});
 let premiereInstances=0;
 for(const line of ps.stdout.split('\n').filter(Boolean)) {
  const match=/^\s*(\d+)\s+(.+)$/.exec(line);if(!match)throw new Error('Incomplete process inspection');
  if(/Adobe Premiere Pro[^/]*\.app\/Contents\/MacOS\/Adobe Premiere Pro/.test(match[2]))premiereInstances++;
  for(const directory of directories)if(pathMention(match[2],directory)){paths.add(directory);pids.add(Number(match[1]));}
 }
 const lsof=await execute('/usr/sbin/lsof',['-nP','-Fpn','-a','-u',String(process.getuid())],{encoding:'utf8',timeout:15000,maxBuffer:64*1024*1024});
 if(/WARNING|incomplete|permission denied|not permitted/i.test(lsof.stderr))throw new Error('Open-file inspection was incomplete; legacy cleanup is deferred');
 let pid;
 for(const line of lsof.stdout.split('\n')) {
  if(line.startsWith('p'))pid=Number(line.slice(1));
  if(line.startsWith('n'))for(const directory of directories)if(pathMention(line.slice(1),directory)){paths.add(directory);if(pid)pids.add(pid);}
 }
 return {complete:true,paths:[...paths],pids:[...pids],premiereInstances};
}
async function cachedLegacyRoots({home,env,roots,registrations}) {
 const protectedRoots=new Set(),cacheBases=[path.join(env.CODEX_HOME||path.join(home,'.codex'),'plugins/cache'),path.join(env.CLAUDE_CONFIG_DIR||path.join(home,'.claude'),'plugins/cache')];
 for(const base of cacheBases) {
  await ordinaryPath(base,true);
  for(const market of await entries(base)) {
   if(market.isSymbolicLink())throw new Error('Historical host cache has a linked marketplace');
   if(!market.isDirectory())continue;
   const plugins=path.join(base,market.name,'premiere-editor-assistant');await ordinaryPath(plugins,true);
   for(const entry of await entries(plugins)) {
    if(entry.isSymbolicLink()&&legacyVersion(entry.name))throw new Error('Historical host cache has a linked release');
    if(!entry.isDirectory()||!legacyVersion(entry.name))continue;
    const manifest=await json(path.join(plugins,entry.name,'plugin.json'));
    if(manifest.name!=='premiere-editor-assistant'||manifest.version!==entry.name)throw new Error('Historical host cache identity is uncertain');
    for(const root of roots)if(path.basename(root)===manifest.version)protectedRoots.add(root);
    for(const record of registrations)if(record.version===manifest.version)protectedRoots.add(record.path);
   }
  }
 }
 return [...protectedRoots];
}
async function configurationReferences({home,env,cwd,roots}) {
 const codex=env.CODEX_HOME||path.join(home,'.codex'),claude=env.CLAUDE_CONFIG_DIR||path.join(home,'.claude');
 const configs=new Set([path.join(codex,'config.toml'),path.join(claude,'settings.json'),path.join(claude,'settings.local.json'),path.join(home,'.claude.json')]);
 const workspaces=new Set([cwd].filter(Boolean));
 try {
  const text=await readFile(path.join(codex,'config.toml'),'utf8');
  for(const match of text.matchAll(/\[projects\.((?:"(?:\\.|[^"\\])*"|'[^']*'))\]/g)) {
   const value=match[1][0]==='"'?JSON.parse(match[1]):match[1].slice(1,-1);if(path.isAbsolute(value))workspaces.add(value);
  }
 }catch(error){if(error.code!=='ENOENT')throw error;}
 try{for(const workspace of Object.keys((await json(path.join(home,'.claude.json'))).projects||{}))if(path.isAbsolute(workspace))workspaces.add(workspace);}catch(error){if(error.code!=='ENOENT')throw error;}
 for(const workspace of workspaces)for(const suffix of ['.codex/config.toml','.claude/settings.json','.claude/settings.local.json','.mcp.json','mcp.json'])configs.add(path.join(workspace,suffix));
 const protectedPaths=new Set();
 for(const file of configs) {
  let text;try{text=await readFile(file,'utf8');}catch(error){if(error.code==='ENOENT')continue;throw error;}
  for(const token of text.matchAll(/"(?:\\.|[^"\\])*"|'[^']*'/g)) {
   let value;try{value=token[0][0]==='"'?JSON.parse(token[0]):token[0].slice(1,-1);}catch{if(roots.some(root=>pathMention(token[0],root)))throw new Error('Unresolved historical path in host configuration');continue;}
   if(typeof value!=='string')continue;
   value=value.replace(/^~(?=\/)/,home).replace(/\$\{HOME\}|\$HOME/g,home);
   const resolved=path.isAbsolute(value)?path.normalize(value):path.resolve(path.dirname(file),value);
   for(const root of roots) {
    if(resolved===root||resolved.startsWith(root+path.sep))protectedPaths.add(referenceScope(root,resolved));
    else if(pathMention(value,root))protectedPaths.add(root);
   }
  }
 }
 return [...protectedPaths];
}
function referenceScope(root,file) {
 const relative=path.relative(root,file),first=relative.split(path.sep)[0];
 if(['integrations','python'].includes(first)||/^setup-work-[a-f0-9]{24}$/.test(first))return path.join(root,first);
 return root;
}
function directoryPrefixes(files) {
 const prefixes=new Set();for(const name of Object.keys(files)){let parent=path.dirname(name);while(parent!=='.'){prefixes.add(parent);parent=path.dirname(parent);}}
 return prefixes;
}
// This catalogue is distributed with the plugin, independent of the installed bridge.
const oldLock='3b343f7755c03981a514c922bf7cc26e3ca993706b65e4c7cce7f81fde213ed2';
async function historicalBaseline(lock, baselines) {
 if (baselines.has(lock)) return baselines.get(lock);
 if (lock !== oldLock) throw new Error('Unsupported historical runtime pins');
 const packed=await readFile(new URL('../baselines/'+oldLock+'.json.gz',import.meta.url));
 const raw=gunzipSync(packed);
 if (digest(raw)!=='797fc079038486d102e3a10019a141d8fa60087b0c9e7ff4287c9e66d0c5dbf0') throw new Error('Historical baseline checksum mismatch');
 const baseline=validateBaseline(JSON.parse(raw));
 if (baseline.schema!==1 || baseline.lockSha256!==lock) throw new Error('Historical baseline identity mismatch');
 baselines.set(lock,baseline);
 return baseline;
}

async function checkedRoot({store,directory,baselines}) {
 await ordinaryPath(directory);
 const previous=await savedRoot(store,directory),markerFile=path.join(directory,'integrations/installation.json');
 await ordinaryPath(markerFile,true);
 let marker,markerBytes;
 try{markerBytes=await readFile(markerFile);marker=JSON.parse(markerBytes);}catch(error){if(error.code!=='ENOENT'||!previous?.sourceMarker)throw error;marker=previous.sourceMarker;}
 if(previous&&markerBytes&&previous.markerSha256!==digest(markerBytes))throw new Error('Historical installation changed after migration began');
 if(Object.keys(marker).some(key=>!['lockSha256','patchSha256','files'].includes(key)))throw new Error('Unknown historical runtime metadata');
 const baseline=await historicalBaseline(marker.lockSha256,baselines);
 const runtime=legacyRuntimeFiles(baseline,marker);
 let intact=true;for(const [name,expected] of Object.entries(marker.files))try{if(digest(await readFile(path.join(directory,'integrations',name)))!==expected)intact=false;}catch(error){if(error.code==='ENOENT')intact=false;else throw error;}
 return {path:directory,version:path.basename(directory),marker,markerSha256:markerBytes?digest(markerBytes):previous.markerSha256,runtime,baseline,previous,intact};
}
async function archiveFile({store,root,relative,source,inventory,apply}) {
 const destination=path.join(store,'migration-history',root.version,digest(root.path).slice(0,16),relative);
 if(!apply)return;
 await safeDirectory(path.dirname(destination));
 await ordinaryPath(destination,true);
 try{if(digest(await readFile(destination))!==inventory.sha256)throw new Error('Historical archive differs; original data is preserved');}
 catch(error){if(error.code!=='ENOENT')throw error;await cp(source,destination,{errorOnExist:true,force:false});}
 if(digest(await readFile(destination))!==inventory.sha256)throw new Error('Historical archive copy failed verification');
}
function inventoryHash(inventory){return digest(JSON.stringify(Object.fromEntries(Object.entries(inventory).sort(([a],[b])=>a.localeCompare(b)))));}
export async function authorizeLegacyItem(store,root,item) {
 const file=receiptPath(store,root.path);await safeDirectory(path.dirname(file));
 const previous=await savedRoot(store,root.path);
 const authorization=digest(item.path+':'+item.inventoryHash+':'+item.entryType);
 const record={schema:1,root:root.path,version:root.version,sourceMarker:root.marker,markerSha256:root.markerSha256,authorizations:{...previous?.authorizations,
  [authorization]:{path:item.path,inventoryHash:item.inventoryHash,entryType:item.entryType}},updatedAt:Date.now()};
 await atomicJson(file,record);return {...item,authorization};
}
export async function validateLegacyItem(store,item) {
 const root=absolute(item.legacyRoot,'legacy root');
 if(!legacyVersion(path.basename(root))||!(item.path===root||item.path.startsWith(root+path.sep)))throw new Error('Unsafe historical cleanup target');
 const record=await savedRoot(store,root),authorization=record?.authorizations?.[item.authorization];
 if(!authorization||authorization.path!==item.path||authorization.inventoryHash!==item.inventoryHash||authorization.entryType!==item.entryType)throw new Error('Historical cleanup authorization differs');
 return true;
}
export async function legacyItemInventory(item,size) {
 const info=await lstat(item.path);
 if(item.entryType==='directory'&&info.isDirectory()&&!info.isSymbolicLink())return deletionInventory(item.path,'',size);
 if(item.entryType==='file'&&info.isFile()){
  const bytes=await readFile(item.path);
  if(size)size.bytes+=bytes.length;
  return {'.':{sha256:digest(bytes)}};
 }
 if(item.entryType==='symlink'&&info.isSymbolicLink()){const {readlink}=await import('node:fs/promises');return {'.':{symlink:await readlink(item.path)}};}
 throw new Error('Historical cleanup entry type changed');
}
export const legacyInventoryHash=inventoryHash;

async function historicalInventory(directory,expected,directories,keep,archives) {
 const inventory=Object.create(null),sizes=Object.create(null);
 const recognized=name=>Object.hasOwn(expected,name)||['integrations/installation.json','premiere-editor-assistant-panel.ccx','uxp-installer.json','setup-status.json'].includes(name)||
  /^setup-work-[a-f0-9]{24}\/(?:extract-leancoder|extract-quadlzzz|dependencies)\.json$/.test(name)||
  /^setup-logs\/\d{4}-\d\d-\d\dT[^/]+\.jsonl$/.test(name)||/^downloads\/[a-f0-9]{64}\.zip$/.test(name)&&archives.includes(path.basename(name,'.zip'));
 const walk=async prefix=>{
  for(const entry of await entries(path.join(directory,prefix))) {
   const name=path.join(prefix,entry.name),file=path.join(directory,name),protectedEntry=[...keep].some(p=>p===file||file.startsWith(p+path.sep));
   if(entry.isDirectory()) {
    if(protectedEntry||!directories.has(name))inventory[name]={directory:true,retained:true};
    else {inventory[name]={directory:true};await walk(name);}
   }else if(entry.isSymbolicLink()) {
    if(!protectedEntry&&recognized(name)){const {readlink}=await import('node:fs/promises');inventory[name]={symlink:await readlink(file)};}
    else inventory[name]={retained:true,symlinkEntry:true};
   }else if(entry.isFile()&&!protectedEntry&&recognized(name)) {
    const info=await lstat(file);if(info.size>256*1024*1024){inventory[name]={retained:true};continue;}
    inventory[name]={sha256:digest(await readFile(file))};sizes[name]=info.size;
   }else inventory[name]={retained:true};
  }
 };
 await walk('');return {inventory,sizes};
}

async function rootCandidates({store,root,baseline,keep,apply,inspectArchive}) {
 const maps=[[root.runtime,'integrations']];
 for(const entry of await entries(root.path))if(entry.isDirectory()&&/^setup-work-[a-f0-9]{24}$/.test(entry.name))maps.push([baseline.leancoder,path.join(entry.name,'sources/leancoder')],[baseline.quadSource,path.join(entry.name,'sources/quadlzzz')],[baseline.quadDependencies,path.join(entry.name,'dependencies/quadlzzz')]);
 const expected=Object.assign({},...maps.map(([mapping,prefix])=>prefixed(mapping,prefix)));
 const knownDirectories=directoryPrefixes(expected);knownDirectories.add('downloads');knownDirectories.add('setup-logs');
 const {inventory,sizes}=await historicalInventory(root.path,expected,knownDirectories,keep,Object.values(baseline.archives));
 const eligible=new Set(),reasons=[];
 const addMap=(mapping,prefix)=>{
  const expected=prefixed(mapping,prefix);for(const directory of directoryPrefixes(expected))knownDirectories.add(directory);
  for(const [name,hash] of Object.entries(expected))if(matches(inventory[name],hash))eligible.add(name);
 };
 addMap(root.runtime,'integrations');
 const markerName='integrations/installation.json';if(inventory[markerName]?.sha256===root.markerSha256)eligible.add(markerName);
 for(const entry of await entries(root.path))if(entry.isDirectory()&&/^setup-work-[a-f0-9]{24}$/.test(entry.name)) {
  const prefix=entry.name;
  addMap(baseline.leancoder,path.join(prefix,'sources/leancoder'));addMap(baseline.quadSource,path.join(prefix,'sources/quadlzzz'));addMap(baseline.quadDependencies,path.join(prefix,'dependencies/quadlzzz'));
  for(const [file,expected] of [['extract-leancoder.json',baseline.leancoder],['extract-quadlzzz.json',baseline.quadSource],['dependencies.json',baseline.quadDependencies]]) {
   try{const actual=await json(path.join(root.path,prefix,file));if(inventoryHash(actual.files)===inventoryHash(expected))eligible.add(path.join(prefix,file));}catch(error){if(error.code!=='ENOENT'&&error.name!=='SyntaxError')throw error;}
  }
 }
 for(const [name,info] of Object.entries(inventory)) {
  const full=path.join(root.path,name);
  if(/^downloads\/[a-f0-9]{64}\.zip$/.test(name)&&Object.values(baseline.archives).includes(path.basename(name,'.zip'))&&info.sha256===path.basename(name,'.zip'))eligible.add(name);
  if(/^setup-logs\/\d{4}-\d\d-\d\dT[^/]+\.jsonl$/.test(name)&&info.sha256) {
   try{const lines=(await readFile(full,'utf8')).trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));if(!lines.length||lines.some(line=>typeof line.time!=='string'||typeof line.type!=='string'))throw new Error('Unknown diagnostic log');
    await archiveFile({store,root,relative:name,source:full,inventory:info,apply});eligible.add(name);
   }catch(error){reasons.push({path:full,reason:error.message});}
  }
  if(name==='setup-status.json'&&info.sha256) {
   try{const status=await json(full);if(!['runtime_ready','runtime_ready_with_pending_steps','setup_failed','setup_needed'].includes(status.status)||status.dataDirectory!==root.path)throw new Error('Unknown setup status');
    await archiveFile({store,root,relative:name,source:full,inventory:info,apply});eligible.add(name);
   }catch(error){reasons.push({path:full,reason:error.message});}
  }
 }
 knownDirectories.add('downloads');knownDirectories.add('setup-logs');
 const ccx='premiere-editor-assistant-panel.ccx';
 if(inventory[ccx]?.sha256) {
  try {
   const archive=await inspectArchive(path.join(root.path,ccx));
   const panel=Object.fromEntries(Object.entries(root.runtime).filter(([name])=>name.startsWith('quadlzzz/panel/')).map(([name,hash])=>[name.slice('quadlzzz/panel/'.length),hash]));
   if(archive.pluginId!=='com.premieremcp.agent'||!archive.files['main.js']||!archive.files['manifest.json']||Object.entries(archive.files).some(([name,hash])=>panel[name]!==hash))throw new Error('Unknown or changed legacy panel installer');
   eligible.add(ccx);
   if(inventory['uxp-installer.json']?.sha256) {
    const receipt=await json(path.join(root.path,'uxp-installer.json'));
    if(receipt.sha256===inventory[ccx].sha256&&inventoryHash(receipt.files)===inventoryHash(archive.files))eligible.add('uxp-installer.json');
   }
  }catch(error){reasons.push({path:path.join(root.path,ccx),reason:error.message});}
 }
 // Ownership applies to individual known files. Empty unknown directories and all project/Python contents stay put.
 for(const name of [...eligible])if([...keep].some(p=>overlaps(p,path.join(root.path,name))))eligible.delete(name);
 for(const name of eligible)for(const directory of directoryPrefixes({[name]:true}))knownDirectories.add(directory);
 const selected=[],remaining=new Set(eligible);
 const names=Object.keys(inventory),directories=names.filter(name=>inventory[name].directory).sort((a,b)=>a.split('/').length-b.split('/').length);
 for(const directory of ['',...directories]) {
  if(directory&&!knownDirectories.has(directory))continue;
  const full=directory?path.join(root.path,directory):root.path;
  if(selected.some(item=>overlaps(item.path,full)))continue;
  if([...keep].some(p=>overlaps(p,full)))continue;
  const children=names.filter(name=>!directory||name.startsWith(directory+'/'));
  if(children.some(name=>inventory[name].retained||(inventory[name].directory?!knownDirectories.has(name):!eligible.has(name))))continue;
  const scoped=directory?Object.fromEntries(children.map(name=>[name.slice(directory.length+1),inventory[name]])):inventory;
  selected.push({kind:'legacy',legacyRoot:root.path,path:full,entryType:'directory',inventoryHash:inventoryHash(scoped),bytes:children.reduce((sum,name)=>sum+(sizes[name]||0),0)});
  for(const name of children)remaining.delete(name);
 }
 for(const name of remaining)if(!selected.some(item=>overlaps(item.path,path.join(root.path,name)))) {
  const info=inventory[name],entryType=info.symlink!==undefined?'symlink':'file';
  selected.push({kind:'legacy',legacyRoot:root.path,path:path.join(root.path,name),entryType,inventoryHash:inventoryHash({'.':info}),bytes:sizes[name]||0});
 }
 const candidates=[];
 for(const item of selected)candidates.push(apply?await authorizeLegacyItem(store,root,item):item);
 for(const [name,info] of Object.entries(inventory))if((info.retained||!info.directory)&&!eligible.has(name))reasons.push({path:path.join(root.path,name),reason:name==='python'||name.startsWith('python/')?'Python environment retained in place':name==='workflow'||name.startsWith('workflow/')?'Project evidence retained in place':'referenced, changed, or unknown file'});
 return {candidates,preserved:reasons};
}

export function legacyMigrationPlanner({store,runtimes,root:pluginRoot,configuration,python,run,home=homedir(),env=process.env,cwd=process.cwd(),panelPath,inspection=inspectLegacyUse}) {
 return async context=>{
  const result={checked:false,candidates:[],preserved:[],blocked:[],roots:[],rollback:null};
  try {
   const baseline=await readLegacyBaseline(runtimes);
   const baselines=new Map([[baseline.lockSha256,baseline]]);
   const roots=await discoverLegacyRoots({store,home,registrations:context.registrations});result.roots=roots;
   if(!roots.length){result.checked=true;return result;}
   for(const directory of roots)await ordinaryPath(directory,true);
   const managedBases=[store,path.join(home,'Library/Application Support/Premiere Editor Assistant'),path.join(env.CODEX_HOME||path.join(home,'.codex'),'plugins/data'),path.join(env.CLAUDE_CONFIG_DIR||path.join(home,'.claude'),'plugins/data')];
   for(const registration of context.registrations)if(!managedBases.some(base=>registration.path.startsWith(base+path.sep)))context.keep.add(registration.path);
   if(!panelPath)throw new Error('The loaded UXP panel location is unverified; update the panel and run smoke --live');
   const manifest=await json(path.join(absolute(panelPath,'live panel path'),'manifest.json'));
   if(manifest.id!=='com.premieremcp.agent')throw new Error('Unexpected live UXP panel identity');
   for(const [installed,source] of [['runtime-info.js','src/premiere/uxp-runtime-info.cjs'],['guarded-reorder.js','src/premiere/uxp-reorder.cjs'],['import-transcript.js','src/premiere/uxp-transcript.cjs'],['transcript-format.js','src/transcription/premiere-format.cjs']])if(digest(await readFile(path.join(panelPath,installed)))!==digest(await readFile(path.join(pluginRoot,'workflow',source))))throw new Error('Loaded UXP panel files differ from this package');
   context.keep.add(panelPath);
   for(const directory of await cachedLegacyRoots({home,env,roots,registrations:context.registrations}))context.keep.add(directory);
   for(const file of await configurationReferences({home,env,cwd,roots}))context.keep.add(file);
   const use=await inspection(roots);
   if(!use.complete||use.premiereInstances>1)throw new Error('Historical process or panel ownership is uncertain');
   for(const directory of use.paths)context.keep.add(directory);
   for(const file of [...context.keep])for(const target of await referenceTargets(file))context.keep.add(target);
   const checked=[];
   for(const directory of roots) {
    try{await lstat(directory);}catch(error){if(error.code==='ENOENT')continue;throw error;}
    try {
     const info=await lstat(directory);if(!info.isDirectory()||info.isSymbolicLink())throw new Error('Historical root is not an ordinary directory');
     if((await entries(directory)).some(entry=>['setup.lock','setup-recovery.lock'].includes(entry.name)))throw new Error('An old setup lock needs reconciliation');
     checked.push(await checkedRoot({store,directory,baselines}));
    }catch(error){result.preserved.push({path:directory,reason:error.message});}
   }
   if(!context.hasHealthyRollback&&checked.some(root=>root.intact)) {
    const previous=checked.filter(root=>root.intact).sort(versionOrder).at(-1);context.keep.add(previous.path);result.rollback=previous.path;
   }
   const inspectArchive=async file=>JSON.parse(await run(python,[path.join(pluginRoot,'scripts/archive-inventory.py'),file],{timeout:30000}));
   for(const legacy of checked) {
    if([...context.keep].some(p=>p===legacy.path||legacy.path.startsWith(p+path.sep))){result.preserved.push({path:legacy.path,reason:legacy.path===result.rollback?'prior installation retained for rollback':'installed, pinned, configured or in use'});continue;}
    const plan=await rootCandidates({store,root:legacy,baseline:legacy.baseline,keep:context.keep,apply:context.apply,inspectArchive});result.candidates.push(...plan.candidates);result.preserved.push(...plan.preserved);
   }
   result.checked=true;
   result.beforeApply=async()=>{
    const latest=await inspection(roots);
    if(!latest.complete||latest.premiereInstances>1)throw new Error('Historical use changed during cleanup');
    for(const directory of latest.paths)context.keep.add(directory);
    for(const directory of await cachedLegacyRoots({home,env,roots,registrations:context.registrations}))context.keep.add(directory);
    for(const file of await configurationReferences({home,env,cwd,roots}))context.keep.add(file);
    if(configuration) {
     for(const name of ['python','node','ffmpeg','ffprobe'])try {
      const file=absolute((await readFile(path.join(configuration,name),'utf8')).trim(),'configured executable');
      for(const legacy of roots)if(file===legacy||file.startsWith(legacy+path.sep))context.keep.add(referenceScope(legacy,file));
     }catch(error){if(error.code!=='ENOENT')throw error;}
     for(const entry of await entries(path.join(configuration,'runtime-overrides'))) {
      if(!entry.isFile())throw new Error('Uncertain custom runtime pin');
      context.keep.add(absolute((await readFile(path.join(configuration,'runtime-overrides',entry.name),'utf8')).trim(),'runtime pin'));
     }
    }
   };
   result.afterApply=async removed=>{
    for(const item of removed.filter(item=>item.kind==='legacy')) {
     let parent=path.dirname(item.path);
     while(parent===item.legacyRoot||parent.startsWith(item.legacyRoot+path.sep)) {
      if([...context.keep].some(p=>overlaps(p,parent)))break;
      try{await rmdir(parent);}catch(error){if(!['ENOENT','ENOTEMPTY','EEXIST'].includes(error.code))throw error;break;}
      if(parent===item.legacyRoot)break;parent=path.dirname(parent);
     }
    }
    for(const registration of context.registrations)if(legacyVersion(registration.version)) {
     const directory=registration.path;
     if(!await savedRoot(store,directory))continue;
     try{await lstat(path.join(directory,'integrations'));continue;}catch(error){if(error.code!=='ENOENT')throw error;}
     if([...context.keep].some(p=>p===directory||directory.startsWith(p+path.sep)))continue;
     const destination=path.join(store,'migration-history','registrations',digest(registration.file)+'.txt');await safeDirectory(path.dirname(destination));
     await ordinaryPath(destination,true);
     const bytes=await readFile(registration.file);await cp(registration.file,destination,{force:false});if(digest(await readFile(destination))!==digest(bytes))throw new Error('Registration archive differs; original preserved');
     await rm(registration.file);
    }
   };
  }catch(error){result.blocked.push({reason:error.message});result.candidates=[];}
  return result;
 };
}
