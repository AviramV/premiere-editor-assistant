import path from 'node:path';
import {readFile} from 'node:fs/promises';
import {acquireSetupLock, atomicJson} from './setup-recovery.mjs';
import {safeDirectory} from './lifecycle.mjs';

const retryMs = 5 * 60_000;

export function upgradeReceipt(state, version) {
 if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Invalid upgrade version');
 return path.join(state, 'upgrades', version, 'maintenance.json');
}

async function readReceipt(file) {
 try { return JSON.parse(await readFile(file, 'utf8')); }
 catch (error) { if (error.code !== 'ENOENT') throw error; }
}

// Setup creates pending work before probing Premiere. A running host only resumes
// an existing receipt. An interrupted attempt remains pending across restarts.
export async function finishUpgrade({file, setup=false, verify, watch, now=Date.now}) {
 if (!setup) {
  const prior = await readReceipt(file);
  if (!prior || prior.status === 'complete' || now() < prior.retryAfter) return prior;
 }
 const directory = await safeDirectory(path.dirname(file));
 let lock;
 try { lock = await acquireSetupLock(directory); }
 catch (error) {
  if (error.stage === 'setup_lock') return {status:'pending', reason:error.message, file};
  throw error;
 }
 const stopWatching = watch?.(lock);
 try {
  const current = await readReceipt(file);
  if (!setup && (current?.status === 'complete' || now() < current?.retryAfter)) return current;
  const pending = {status:'pending', file, attemptedAt:now(), retryAfter:now()+retryMs};
  await atomicJson(file,pending);
  let result;
  try {
   const smoke = await verify();
   const maintenance = smoke.maintenance;
   if (!smoke.livePremiereConnectionVerified || maintenance?.mode !== 'apply' ||
       maintenance.blocked?.length || maintenance.migration?.blocked?.length) {
    const issues = [smoke.detail, maintenance?.detail, ...(maintenance?.blocked || []).map(i=>i.reason),
     ...(maintenance?.migration?.blocked || []).map(i=>i.reason),
     ...(smoke.results || []).filter(i=>i.status==='failed').map(i=>i.detail)].filter(Boolean);
    result = {...pending, livePremiereConnectionVerified:smoke.livePremiereConnectionVerified===true,
     reason:issues.join('; ') || 'Live verification or cleanup is pending', maintenance};
   } else {
    result = {status:'complete', file, verifiedAt:now(), livePremiereConnectionVerified:true, maintenance};
   }
  } catch (error) { result = {...pending, reason:error.message}; }
  await atomicJson(file,result);
  return result;
 } finally { stopWatching?.(); await lock.release(); }
}

export async function checkInstalledUpgrade(setup=false) {
 const {root,state,metadata,run,watchProcesses} = await import('./common.mjs');
 return finishUpgrade({
  file:upgradeReceipt(state,metadata.version), setup, watch:watchProcesses,
  verify:async()=>{
   const args=[path.join(root,'scripts/smoke.mjs'),'--live'];
   const env={...process.env,PREMIERE_ASSISTANT_INTERNAL_CHECK:'1',PREMIERE_ASSISTANT_UPGRADE_REPORT:'1'};
   try { return JSON.parse(await run(process.execPath,args,{env})); }
   catch (error) {
    // A partially completed sweep or unavailable panel has a structured report.
    if (error.stdout?.trim()) { try { return JSON.parse(error.stdout); } catch {} }
    throw error;
   }
  }
 });
}

// Only the user-facing CEP connection schedules retries. Internal smoke clients
// must never schedule another sweep (in particular during a cleanup preview).
export function resumeOnConnection(check=checkInstalledUpgrade) {
 let active, closed=false;
 const tick=()=>{
  if (closed || active) return;
  active=check().catch(error=>console.error('Upgrade maintenance pending:',error.message)).finally(()=>{active=undefined;});
 };
 const timer=setInterval(tick,retryMs);
 timer.unref();
 tick();
 return async()=>{closed=true;clearInterval(timer);await active;};
}
