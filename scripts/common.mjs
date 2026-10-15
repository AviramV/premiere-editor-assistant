import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {homedir} from 'node:os';
import {readFile, access} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {executable} from '../workflow/src/core/environment.mjs';
export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const metadata = JSON.parse(await readFile(path.join(root, 'plugin.json'), 'utf8'));
export const state = path.resolve(process.env.PREMIERE_ASSISTANT_DATA || path.join(process.env.PLUGIN_DATA || path.join(homedir(), 'Library/Application Support/Premiere Editor Assistant'), metadata.version));
export const runtimes = path.join(state, 'integrations');
export const hash = value => createHash('sha256').update(value).digest('hex');
export {executable};
export async function exists(file) { try { await access(file); return true; } catch { return false; } }
export function environment() {
  return {...process.env, PREMIERE_ASSISTANT_RUNTIME:runtimes, PREMIERE_ASSISTANT_DATA:state,
    PREMIERE_ASSISTANT_NODE:process.execPath,
    PREMIERE_ASSISTANT_PYTHON:process.env.PREMIERE_ASSISTANT_PYTHON || path.join(state,'python/bin/python'),
    PATH:[path.dirname(process.execPath), '/opt/homebrew/bin', '/usr/local/bin', process.env.PATH || '/usr/bin:/bin'].join(path.delimiter)};
}
export async function run(command,args,{cwd=root,env=environment(),inherit=false,timeout=600000}={}) {
  return await new Promise((resolve,reject)=>{
    const child=spawn(command,args,{cwd,env,stdio:inherit?'inherit':['ignore','pipe','pipe']});
    let out='',err='';
    const timer=setTimeout(()=>child.kill('SIGTERM'),timeout);
    child.stdout?.on('data',b=>{out+=b;if(out.length>8e6)out=out.slice(-4e6);});
    child.stderr?.on('data',b=>{err+=b;if(err.length>8e6)err=err.slice(-4e6);});
    child.once('error',e=>{clearTimeout(timer);reject(e);});
    child.once('close',code=>{clearTimeout(timer);code===0?resolve(out):reject(new Error(`${path.basename(command)} failed (${code}): ${err.slice(-3000)}`));});
  });
}
export async function runtimeReady() {
  const marker=JSON.parse(await readFile(path.join(runtimes,'installation.json'),'utf8'));
  const lock=await readFile(path.join(root,'runtime-lock.json'));
  const patch=await readFile(path.join(root,'workflow/src/premiere/uxp-reorder.cjs'));
  if(marker.lockSha256!==hash(lock)||marker.patchSha256!==hash(patch))throw new Error('Runtime version differs from this package; run the packaged setup in a fresh data directory.');
  for(const [file,expected] of Object.entries(marker.files)) {
    if(hash(await readFile(path.join(runtimes,file)))!==expected)throw new Error(`Installed runtime file changed: ${file}`);
  }
  return marker;
}
