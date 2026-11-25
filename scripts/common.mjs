import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readFile, access} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync} from 'node:fs';
import {executable} from '../workflow/src/core/environment.mjs';
import {configuredExecutables,settingsDirectory} from './settings.mjs';
import {runtimeLocation} from './runtime-location.mjs';
import {bridgeIdentity,acquireLease,registerRelease,legacyCandidates,absolute,storeRoot} from './lifecycle.mjs';
import {savedModel} from './models.mjs';
for(const [variable,value] of Object.entries(configuredExecutables()))if(!process.env[variable])process.env[variable]=value;
export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const metadata = JSON.parse(await readFile(path.join(root, 'plugin.json'), 'utf8'));
export const identity=await bridgeIdentity(root);
export const location = runtimeLocation(metadata.version,process.env,undefined,identity);
export const state = location.setupDirectory;
export const runtimes = path.join(location.directory, 'integrations');
export const persistentState=absolute(process.env.PREMIERE_ASSISTANT_STATE||path.join(location.store,'state'),'PREMIERE_ASSISTANT_STATE');
export const hash = value => createHash('sha256').update(value).digest('hex');
let requirements;try{requirements=await readFile(path.join(root,'requirements-local.txt'));}catch(error){if(error.code!=='ENOENT')throw error;}
const managedPython=requirements?savedModel(location.store,requirements):undefined;
let preparedPython;
export function selectPreparedPython(file){preparedPython=file;}
export {executable};
export async function exists(file) { try { await access(file); return true; } catch { return false; } }
export function environment() {
  return {...process.env, PREMIERE_ASSISTANT_INTERNAL_CHECK:'1', PREMIERE_ASSISTANT_RUNTIME:runtimes, PREMIERE_ASSISTANT_DATA:location.directory,
    PREMIERE_ASSISTANT_STATE:persistentState,
    PREMIERE_ASSISTANT_NODE:process.execPath,
    PREMIERE_ASSISTANT_PYTHON:process.env.PREMIERE_ASSISTANT_PYTHON || preparedPython || managedPython || (existsSync(path.join(location.directory,'python/bin/python'))?path.join(location.directory,'python/bin/python'):executable('python3')),
    PATH:[path.dirname(process.execPath), '/opt/homebrew/bin', '/usr/local/bin', process.env.PATH || '/usr/bin:/bin'].join(path.delimiter)};
}
let processObserver;
const additionalObservers=new Set();
export function watchProcesses(observer){additionalObservers.add(observer);return ()=>additionalObservers.delete(observer);}
let resourceObserver;
export async function beginUse(extra=[]) {
 const paths=[location.directory,state,persistentState,environment().PREMIERE_ASSISTANT_PYTHON,process.env.PREMIERE_ASSISTANT_UXP_PANEL,...extra].filter(Boolean);
 resourceObserver=await acquireLease(location.store,paths);
 return resourceObserver;
}
export async function endUse(){const observer=resourceObserver;resourceObserver=undefined;await observer?.release();}
export async function holdPath(file){await resourceObserver?.add([file]);}
let livePanelPath;
export function selectLivePanelPath(file){livePanelPath=absolute(file,'live panel path');}
export async function recordRelease(healthy=false) {
 return registerRelease({store:location.store,pluginRoot:root,version:metadata.version,
  paths:[location.directory,persistentState,environment().PREMIERE_ASSISTANT_PYTHON,process.env.PREMIERE_ASSISTANT_UXP_PANEL].filter(Boolean).map(p=>absolute(p,'dependency')),healthy,configuration:settingsDirectory(),panelPath:livePanelPath});
}
export async function migrationCandidates() {
 return [...new Set([location.legacyDirectory,location.hostLegacyDirectory,...await legacyCandidates(location.store,location.registration),...await legacyCandidates(storeRoot({}))].filter(Boolean))];
}
export function spawnManaged(command,args,options={}) {
 resourceObserver?.beforeSpawn();
 let child;
 try{child=spawn(command,args,{...options,detached:process.platform!=='win32'});resourceObserver?.started(child.pid);}
 catch(error){if(!child)resourceObserver?.started();throw error;}
 child.once('close',()=>resourceObserver?.finished());return child;
}
export function observeSetupProcesses(observer){processObserver=observer;}
export async function run(command,args,{cwd=root,env=environment(),inherit=false,timeout=600000}={}) {
 return await new Promise((resolve,reject)=>{
  const observers=[processObserver,resourceObserver,...additionalObservers].filter(Boolean);
  const observer=observers.length?{beforeSpawn:()=>observers.forEach(o=>o.beforeSpawn()),started:pid=>observers.forEach(o=>o.started(pid)),finished:()=>observers.forEach(o=>o.finished())}:undefined;
  const grouped=Boolean(observer)&&process.platform!=='win32';
  try{observer?.beforeSpawn();}catch(error){reject(error);return;}
  let child;
  try{child=spawn(command,args,{cwd,env,detached:grouped,stdio:inherit?'inherit':['ignore','pipe','pipe']});}
  catch(error){observer?.started();reject(error);return;}
  let out='',err='',timedOut=false,spawnError,killTimer;
  const kill=signal=>{try{grouped&&child.pid?process.kill(-child.pid,signal):child.kill(signal);}catch(error){if(error.code!=='ESRCH')spawnError??=error;}};
  try{observer?.started(child.pid);}catch(error){spawnError=error;kill('SIGTERM');}
  const timer=setTimeout(()=>{timedOut=true;kill('SIGTERM');killTimer=setTimeout(()=>kill('SIGKILL'),2000);},timeout);
  child.stdout?.on('data',b=>{out+=b;if(out.length>8e6)out=out.slice(-4e6);});
  child.stderr?.on('data',b=>{err+=b;if(err.length>8e6)err=err.slice(-4e6);});
  child.once('error',error=>{spawnError=error;});
  child.once('close',(code,signal)=>{
   clearTimeout(timer);clearTimeout(killTimer);
   try{observer?.finished();}catch(error){spawnError??=error;}
   if(!spawnError&&!timedOut&&code===0){resolve(out);return;}
   const error=spawnError||new Error(`${path.basename(command)} ${timedOut?'timed out':`failed (${code??signal})`}: ${err.slice(-3000)}`);
   Object.assign(error,{stdout:out,stderr:err,exitCode:code,signal,timedOut});reject(error);
  });
 });
}
export async function runtimeReady(directory=runtimes) {
  const marker=JSON.parse(await readFile(path.join(directory,'installation.json'),'utf8'));
  const lock=await readFile(path.join(root,'runtime-lock.json'));
  if(marker.lockSha256!==hash(lock)||marker.patchSha256!==await bridgePatchHash())throw new Error('Runtime version differs from this package; run the packaged setup in a fresh data directory.');
  if(marker.runtimeId&&marker.runtimeId!==identity.id)throw new Error('Runtime dependencies, recipe or platform differ from this package; prepare its matching managed runtime or a fresh custom directory.');
  for(const [file,expected] of Object.entries(marker.files)) {
    if(hash(await readFile(path.join(directory,file)))!==expected)throw new Error(`Installed runtime file changed: ${file}`);
  }
  return marker;
}
export async function bridgePatchHash() {
  const files=['src/premiere/uxp-reorder.cjs','src/premiere/uxp-transcript.cjs','src/transcription/premiere-format.cjs','src/premiere/uxp-runtime-info.cjs','tools/install-guarded-reorder.mjs'];
  return hash(Buffer.concat(await Promise.all(files.map(file=>readFile(path.join(root,'workflow',file))))));
}
