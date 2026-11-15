import path from 'node:path';
import {stat,realpath} from 'node:fs/promises';
import {root,environment,beginUse,endUse,spawnManaged,recordRelease} from './common.mjs';
export const tools=['workflow','transcribe','match-takes','assess-takes','audit-coverage','deliver','audio-cleanup','native-label-session','native-camera-session','reconcile-native-labels','recover-parked-reorder','read-project'];
const [directory,name,...args]=process.argv.slice(2);
if(!directory||!tools.includes(name))throw new Error(`Usage: run.mjs /absolute/working-directory <${tools.join('|')}> [arguments]`);
if(!path.isAbsolute(directory))throw new Error('An absolute project working directory is required');
const cwd=await realpath(directory);
if(!(await stat(cwd)).isDirectory()||cwd===root||cwd.startsWith(root+path.sep))throw new Error('Use a project working directory outside the installed plugin');
const env=environment();
const script=path.join(root,'workflow/tools',name+(name==='read-project'?'.py':'.mjs'));
await beginUse();
try {
await recordRelease();
const child=spawnManaged(name==='read-project'?env.PREMIERE_ASSISTANT_PYTHON:process.execPath,[script,...args],{cwd,env,stdio:'inherit'});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{try{process.kill(-child.pid,signal);}catch{child.kill(signal);}});
await new Promise(resolve=>{child.once('error',error=>{console.error(error.message);process.exitCode=1;resolve();});child.once('close',code=>{process.exitCode=code??1;resolve();});});
}finally{await endUse();}
