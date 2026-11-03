import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readFile, access} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync} from 'node:fs';
import {executable} from '../workflow/src/core/environment.mjs';
import {configuredExecutables} from './settings.mjs';
import {runtimeLocation} from './runtime-location.mjs';
for(const [variable,value] of Object.entries(configuredExecutables()))if(!process.env[variable])process.env[variable]=value;
export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const metadata = JSON.parse(await readFile(path.join(root, 'plugin.json'), 'utf8'));
export const location = runtimeLocation(metadata.version);
export const state = location.directory;
export const runtimes = path.join(state, 'integrations');
export const hash = value => createHash('sha256').update(value).digest('hex');
export {executable};
export async function exists(file) { try { await access(file); return true; } catch { return false; } }
export function environment() {
  return {...process.env, PREMIERE_ASSISTANT_RUNTIME:runtimes, PREMIERE_ASSISTANT_DATA:state,
    PREMIERE_ASSISTANT_NODE:process.execPath,
    PREMIERE_ASSISTANT_PYTHON:process.env.PREMIERE_ASSISTANT_PYTHON || (existsSync(path.join(state,'python/bin/python'))?path.join(state,'python/bin/python'):executable('python3')),
    PATH:[path.dirname(process.execPath), '/opt/homebrew/bin', '/usr/local/bin', process.env.PATH || '/usr/bin:/bin'].join(path.delimiter)};
}
let processObserver;
export function observeSetupProcesses(observer){processObserver=observer;}
export async function run(command,args,{cwd=root,env=environment(),inherit=false,timeout=600000}={}) {
 return await new Promise((resolve,reject)=>{
  const observer=processObserver,grouped=Boolean(observer)&&process.platform!=='win32';
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
  for(const [file,expected] of Object.entries(marker.files)) {
    if(hash(await readFile(path.join(directory,file)))!==expected)throw new Error(`Installed runtime file changed: ${file}`);
  }
  return marker;
}
export async function bridgePatchHash() {
  const files=['src/premiere/uxp-reorder.cjs','src/premiere/uxp-transcript.cjs','src/transcription/premiere-format.cjs','tools/install-guarded-reorder.mjs'];
  return hash(Buffer.concat(await Promise.all(files.map(file=>readFile(path.join(root,'workflow',file))))));
}
