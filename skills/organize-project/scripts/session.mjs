import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {mkdir,open,readFile,writeFile,rename,rm,realpath} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {createInterface} from 'node:readline';

const emit = value => process.stdout.write(JSON.stringify(value)+'\n');
const pending = new Set(['dispatched','indeterminate','ui_pending']);
const object = value => value && typeof value==='object' && !Array.isArray(value);
const inside = (parent,child) => child===parent || child.startsWith(parent+path.sep);
const pluginRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');

export async function runSession(projectPath,directory) {
 if(!path.isAbsolute(projectPath||'') || path.extname(projectPath).toLowerCase()!=='.prproj' || !path.isAbsolute(directory||''))throw Error('Exact absolute .prproj path and shared journal directory required');
 projectPath=path.resolve(projectPath);directory=path.resolve(directory);
 if(inside(pluginRoot,directory))throw Error('Keep the journal outside the installed plugin');
 await mkdir(directory,{recursive:true});
 directory=await realpath(directory);
 if(inside(await realpath(pluginRoot),directory))throw Error('Keep the journal outside the installed plugin');
 const journal=path.join(directory,'journal.json'),lock=path.join(directory,'writer.lock');
 const operationId='organize-'+randomUUID();
 const now=()=>new Date().toISOString();
 let ownsLock=false,record=null,finished=false;
 async function ledger() {
  let data;
  try {data=JSON.parse(await readFile(journal,'utf8'));} catch(error) {if(error.code==='ENOENT')return {};throw error;}
  if(!object(data)||Object.values(data).some(entry=>!object(entry)))throw Error('Invalid shared execution journal; inspect before recovery');
  if(Object.values(data).some(entry=>entry.projectPath && path.resolve(entry.projectPath)!==projectPath))throw Error('Journal belongs to another project');
  return data;
 }
 function checkPending(data) {
  if(Object.entries(data).some(([id,entry])=>id!==operationId && pending.has(entry.status)))throw Error('An uncertain or active edit blocks organization until reconciled');
 }
 async function persist() {
  const data=await ledger();checkPending(data);data[operationId]=record;
  const temp=journal+'.tmp-'+operationId;
  await writeFile(temp,JSON.stringify(data,null,2)+'\n',{mode:0o600});
  await rename(temp,journal);
 }
 async function release() {
  if(!ownsLock)return;
  const owner=JSON.parse(await readFile(lock,'utf8'));
  if(owner.pid!==process.pid || owner.operationId!==operationId)throw Error('Writer lock ownership changed; inspect before recovery');
  await rm(lock);ownsLock=false;
 }
 let input;
 const interrupt=()=>input?.close();
 try {
  checkPending(await ledger());
  let handle;
  try {handle=await open(lock,'wx',0o600);} catch(error) {if(error.code==='EEXIST')throw Error('Existing writer lock blocks organization; do not remove it automatically');throw error;}
  ownsLock=true;
  try {await handle.writeFile(JSON.stringify({pid:process.pid,operationId,projectPath}));} finally {await handle.close();}
  checkPending(await ledger());
  record={operationId,kind:'organize_project',projectPath,status:'dispatched',startedAt:now(),operations:Object.create(null)};
  await persist();
  input=createInterface({input:process.stdin,crlfDelay:Infinity,terminal:false});
  process.on('SIGINT',interrupt);process.on('SIGTERM',interrupt);
  emit({ok:true,status:'ready',operationId,pid:process.pid,journalDirectory:directory});
  for await(const line of input) {
   if(!line.trim())continue;
   const command=JSON.parse(line);
   if(!object(command))throw Error('Expected a JSON command');
   if(command.action==='dispatch') {
    if(!/^[a-zA-Z0-9_.-]{1,128}$/.test(command.id||'') || !object(command.operation) || !Object.keys(command.operation).length)throw Error('Unique operation ID and intended operation required');
    if(Object.hasOwn(record.operations,command.id))throw Error('Operation already recorded; inspect instead of replaying');
    if(Object.values(record.operations).some(entry=>entry.status==='dispatched'))throw Error('Verify the previous mutation before dispatching another');
    record.operations[command.id]={status:'dispatched',intended:command.operation,startedAt:now()};
   } else if(command.action==='verify') {
    const entry=record.operations[command.id];
    if(!entry || entry.status!=='dispatched' || !object(command.observed) || !Object.keys(command.observed).length)throw Error('Pending operation and observed readback required');
    Object.assign(entry,{status:'verified',observed:command.observed,completedAt:now()});
   } else if(command.action==='finish') {
    if(Object.values(record.operations).some(entry=>entry.status!=='verified'))throw Error('Unresolved mutations block completion');
    if(!object(command.summary))throw Error('Final verification summary required');
    Object.assign(record,{status:'verified',summary:command.summary,completedAt:now()});
    await persist();await release();finished=true;
    emit({ok:true,status:'finished',operationId});break;
   } else if(command.action==='fail') {
    throw Error(typeof command.reason==='string' && command.reason.trim() ? command.reason : 'Host outcome unresolved');
   } else throw Error('Unknown session action');
   await persist();
   emit({ok:true,status:command.action==='dispatch'?'recorded':'readback_recorded',id:command.id});
  }
  if(!finished)throw Error('Session input ended before verified completion');
 } catch(error) {
  if(record) {
   Object.assign(record,{status:'indeterminate',hostError:error.message,stoppedAt:now()});
   try {await persist();} catch(journalError) {
    emit({ok:false,error:error.message,journalError:journalError.message,operationId,lockRetained:true});
    throw error;
   }
  }
  await release();throw error;
 } finally {
  input?.close();process.removeListener('SIGINT',interrupt);process.removeListener('SIGTERM',interrupt);
 }
}

if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
 const args=process.argv.slice(2);
 if(args.length===1 && args[0]==='--help')emit({usage:'node session.mjs /absolute/project.prproj /absolute/shared-journal',actions:['dispatch','verify','finish','fail'],scope:'Local writer lock and journal only; no Premiere inspection or mutations'});
 else if(args.length!==2) {emit({ok:false,error:'Expected project path and shared journal directory'});process.exitCode=1;}
 else runSession(...args).catch(error=>{emit({ok:false,error:error.message});process.exitCode=1;});
}
