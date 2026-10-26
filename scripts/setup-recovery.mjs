import path from 'node:path';
import {hostname} from 'node:os';
import {randomUUID,createHash} from 'node:crypto';
import {mkdir,readFile,writeFile,rename,rm,readdir,lstat,readlink,appendFile} from 'node:fs/promises';
import {writeFileSync,renameSync} from 'node:fs';

const sha=value=>createHash('sha256').update(value).digest('hex');
export const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export const redact=value=>String(value).replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/g,'$1[redacted]@').replace(/([?&](?:token|key|auth)=)[^\s&]+/gi,'$1[redacted]');
export function transient(error) {
 if(error.retryable!==undefined)return error.retryable;
 const code=error.cause?.code||error.code;
 if(['EACCES','EPERM','ENOSPC','ENOENT','CHECKSUM_MISMATCH'].includes(code))return false;
 const detail=String(error.stderr||error.message);
 if(/certificate|self.signed|permission denied|no space left|EACCES|EPERM|ENOSPC|401|403|404|No matching distribution|Requires-Python|EBADENGINE/i.test(detail))return false;
 return ['ECONNRESET','ECONNREFUSED','ENOTFOUND','EAI_AGAIN','ETIMEDOUT','UND_ERR_CONNECT_TIMEOUT','UND_ERR_SOCKET'].includes(code)||error.name==='TimeoutError'||
  /ECONNRESET|ECONNREFUSED|EAI_AGAIN|ETIMEDOUT|ENOTFOUND|network (?:error|timeout)|connection (?:reset|refused|timed out|aborted)|read timed out|temporary failure|socket hang up|not connected to Premiere|Premiere.*not connected|HTTP (?:408|429|500|502|503|504)\b|E(?:408|429|500|502|503|504)\b/i.test(detail);
}
export async function retry(action,{attempts=3,sleep=pause,onAttempt=()=>{},onRetry=()=>{},baseDelay=1000}={}) {
 for(let attempt=1;attempt<=attempts;attempt++) {
  await onAttempt(attempt);
  try{return await action(attempt);}catch(error) {
   error.attempts=attempt;
   if(attempt===attempts||!transient(error))throw error;
   const delay=Math.max(baseDelay*3**(attempt-1),error.retryAfterMs||0);
   // Do not retry earlier than requested by the server or wait indefinitely inside setup.
   if(delay>60000)throw error;
   await onRetry({attempt,nextAttempt:attempt+1,delayMs:delay,reason:redact(error.message)});
   await sleep(delay);
  }
 }
}
export async function atomicJson(file,value) {
 const temporary=file+'.'+randomUUID()+'.tmp';
 await writeFile(temporary,JSON.stringify(value,null,2)+'\n',{mode:0o600});await rename(temporary,file);
}
export async function downloadPinned(pin,directory,{fetchImpl=fetch,...options}={}) {
 if(!/^[a-f0-9]{64}$/.test(pin.sha256))throw new Error('Invalid pinned download checksum');
 await mkdir(directory,{recursive:true});
 const archive=path.join(directory,pin.sha256+'.zip');
 try {
  const bytes=await readFile(archive);
  if(sha(bytes)!==pin.sha256)throw Object.assign(new Error(`Cached archive checksum mismatch: ${archive}; preserve it for inspection and remove this cache file only after review.`),{code:'CHECKSUM_MISMATCH'});
  return archive;
 }catch(error){if(error.code!=='ENOENT')throw error;}
 return await retry(async()=>{
  const response=await fetchImpl(pin.url,{signal:AbortSignal.timeout(180000)});
  if(!response.ok) {
   const error=Object.assign(new Error(`Bridge download failed: HTTP ${response.status}`),{retryable:[408,429,500,502,503,504].includes(response.status)});
   const after=response.headers?.get('retry-after');
   if(after) {
    const milliseconds=/^\d+$/.test(after)?Number(after)*1000:Date.parse(after)-Date.now();
    if(Number.isFinite(milliseconds)&&milliseconds>0)error.retryAfterMs=milliseconds;
   }
   await response.body?.cancel?.();throw error;
  }
  const bytes=Buffer.from(await response.arrayBuffer());
  if(sha(bytes)!==pin.sha256)throw Object.assign(new Error('Downloaded bridge checksum mismatch; nothing installed. Inspect the pinned source before retrying.'),{code:'CHECKSUM_MISMATCH'});
  const temporary=archive+'.'+randomUUID()+'.tmp';
  await writeFile(temporary,bytes,{mode:0o600});await rename(temporary,archive);
  return archive;
 },options);
}
export async function treeDigest(directory,relative='') {
 if(!relative&&(await lstat(directory)).isSymbolicLink())throw new Error('Unexpected symlink at setup stage root');
 const files={};
 for(const entry of (await readdir(path.join(directory,relative),{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))) {
  const name=path.join(relative,entry.name);
  if(entry.isSymbolicLink()) {
   const target=await readlink(path.join(directory,name)),resolved=path.resolve(directory,path.dirname(name),target);
   if(path.isAbsolute(target)||!resolved.startsWith(path.resolve(directory)+path.sep))throw new Error(`Setup symlink escapes stage: ${name}`);
   files[name]={symlink:target};continue;
  }
  if(entry.isDirectory())Object.assign(files,await treeDigest(directory,name));
  else files[name]=sha(await readFile(path.join(directory,name)));
 }
 return files;
}
export async function checkpoint(work,name,directory,action,onReuse=()=>{}) {
 const receipt=path.join(work,name+'.json');
 let prior;try{prior=JSON.parse(await readFile(receipt,'utf8'));}catch(error){if(!['ENOENT',undefined].includes(error.code))throw error;}
 if(prior) {
  let matches=false;try{matches=JSON.stringify(prior.files)===JSON.stringify(await treeDigest(directory));}catch(error){if(error.code&&!['ENOENT','ENOTDIR'].includes(error.code))throw error;}
  if(matches){await onReuse(name);return;}
 }
 // Only this build's installer-owned scratch output is rebuilt, never an installed runtime.
 await rm(directory,{recursive:true,force:true});await mkdir(path.dirname(directory),{recursive:true});
 await action();await atomicJson(receipt,{files:await treeDigest(directory)});
}

const alive=(pid,group=false)=>{
 try{process.kill(group?-pid:pid,0);return true;}catch(error){if(error.code==='ESRCH')return false;throw error;}
};
function safeOwner(owner) {
 return owner?.host===hostname()&&Number.isSafeInteger(owner.pid)&&owner.pid>0&&typeof owner.token==='string'&&
  typeof owner.spawning==='boolean'&&Array.isArray(owner.groups)&&owner.groups.every(pid=>Number.isSafeInteger(pid)&&pid>0);
}
export async function acquireSetupLock(state) {
 const directory=path.join(state,'setup.lock'),ownerFile=path.join(directory,'owner.json');
 const blocked=detail=>Object.assign(new Error(`${detail} Inspect ${directory}; do not clear it while any setup worker may still be running.`),{stage:'setup_lock',fallback:'Wait for the running setup to finish, then rerun the same setup command. For an unknown/legacy lock, verify the owning process manually before moving that lock aside.'});
 try{await mkdir(directory);}catch(error) {
  if(error.code!=='EEXIST')throw error;
  const guard=path.join(state,'setup-recovery.lock');
  try{await mkdir(guard);}catch(error){if(error.code==='EEXIST')throw blocked('Another lock recovery may be active.');throw error;}
  try {
   let owner;try{owner=JSON.parse(await readFile(ownerFile,'utf8'));}catch{throw blocked('The existing lock has no readable ownership record.');}
   if(!safeOwner(owner)||owner.spawning)throw blocked('The previous setup ownership or worker state is uncertain.');
   if(alive(owner.pid)||owner.groups.some(pid=>alive(pid,true)))throw blocked('A setup process or worker is still running.');
   // The recovery guard serializes stale-lock reclamation. Unknown ownership is never guessed.
   await rename(directory,path.join(state,'setup.lock.stale-'+randomUUID()));
   try{await mkdir(directory);}catch(error){if(error.code==='EEXIST')throw blocked('A new setup acquired the lock first.');throw error;}
  }finally{await rm(guard,{recursive:true});}
 }
 const owner={pid:process.pid,host:hostname(),token:randomUUID(),spawning:false,groups:[]};
 const save=()=>{const temporary=ownerFile+'.'+owner.token+'.tmp';writeFileSync(temporary,JSON.stringify(owner),{mode:0o600});renameSync(temporary,ownerFile);};
 save();
 return {
  beforeSpawn(){owner.spawning=true;save();},
  started(pid){if(pid)owner.groups.push(pid);owner.spawning=false;save();},
  finished(){owner.groups=owner.groups.filter(pid=>alive(pid,true));save();if(owner.groups.length)throw Object.assign(new Error('A setup worker group is still running; do not retry this stage until it exits.'),{retryable:false});},
  async assertReleasable(){
   const current=JSON.parse(await readFile(ownerFile,'utf8'));
   if(current.token!==owner.token)throw blocked('Setup lock ownership changed.');
   if(owner.spawning||owner.groups.some(pid=>alive(pid,true)))throw blocked('A setup worker has not exited.');
  },
  async release(){await this.assertReleasable();await rm(directory,{recursive:true});}
 };
}
export async function createReport(state,retryCommand) {
 const directory=path.join(state,'setup-logs');await mkdir(directory,{recursive:true});
 const log=path.join(directory,new Date().toISOString().replaceAll(':','-')+'-'+randomUUID()+'.jsonl');
 const statusFile=path.join(state,'setup-status.json');
 const report={log,statusFile,stage:'initializing',attempt:0};
 report.event=async(type,detail={})=>{
  if(type==='reused')console.error(`Verified and reused ${detail.checkpoint}.`);
  await appendFile(log,JSON.stringify({time:new Date().toISOString(),type,stage:report.stage,...detail})+'\n',{mode:0o600});
 };
 report.step=async(name,action,fallback)=>{
  report.stage=name;report.attempt=0;console.error(`Setup: ${name.replaceAll('_',' ')}…`);
  await report.event('started');await atomicJson(statusFile,{status:'running',stage:name,log,retryCommand});
  try{const result=await action();await report.event('completed');return result;}
  catch(error){error.stage??=name;error.fallback??=fallback;throw error;}
 };
 report.retryOptions={
  onAttempt:async attempt=>{report.attempt=attempt;await report.event('attempt',{attempt});},
  onRetry:async detail=>{console.error(`Retrying ${report.stage} in ${detail.delayMs/1000}s (${detail.nextAttempt}/3): ${detail.reason}`);await report.event('retry',detail);}
 };
 report.finish=async result=>{await report.event(result.status,{detail:result.detail,attempts:result.attempts,fallback:result.fallback,warnings:result.warnings});await atomicJson(statusFile,{...result,log,retryCommand});};
 return report;
}
