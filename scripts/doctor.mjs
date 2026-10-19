import path from 'node:path';
import {homedir} from 'node:os';
import {root,state,executable,run,exists,runtimeReady,hash} from './common.mjs';
import {readFile} from 'node:fs/promises';
const checks=[];
checks.push({name:'macOS',required:true,ok:process.platform==='darwin'});
checks.push({name:'Node.js 22+',required:true,ok:Number(process.versions.node.split('.')[0])>=22,version:process.versions.node});
for(const [name,args] of [['ffmpeg',['-version']],['ffprobe',['-version']],['python3',['-c','import sys; assert sys.version_info >= (3,9), "Python 3.9+ required"; print(sys.version.splitlines()[0])']]]) {
 try {const version=(await run(name==='python3'?(process.env.PREMIERE_ASSISTANT_PYTHON || executable(name)):executable(name),args,{timeout:10000})).trim().split('\n')[0];checks.push({name,required:true,ok:true,version});}
 catch(error){checks.push({name,required:true,ok:false,detail:error.message});}
}
try {await runtimeReady();checks.push({name:'pinned_bridge_runtime',required:true,ok:true});}
catch(error){checks.push({name:'pinned_bridge_runtime',required:true,ok:false,detail:error.message});}
const localPython=path.join(state,'python/bin/python');
try {await run(localPython,['-c','import importlib.util; assert all(importlib.util.find_spec(m) for m in ["mlx_whisper","torch","transformers"])'],{timeout:15000});checks.push({name:'local_models_environment',required:false,ok:true});}
catch {checks.push({name:'local_models_environment',required:false,ok:false,detail:'Optional: run setup --local-models, or use an existing transcript / explicitly configured Scribe.'});}
const cep=path.join(homedir(),'Library/Application Support/Adobe/CEP/extensions/MCPBridgeCEP/CSXS/manifest.xml');
checks.push({name:'CEP_panel_present',required:false,ok:await exists(cep)});
const uxp=path.join(homedir(),'Library/Application Support/Adobe/UXP/Plugins/External/com.premieremcp.agent_0.1.0');
for(const [name,installed,source] of [
 ['UXP_guarded_panel_present','guarded-reorder.js','src/premiere/uxp-reorder.cjs'],
 ['UXP_transcript_import_present','import-transcript.js','src/premiere/uxp-transcript.cjs'],
 ['UXP_transcript_format_present','transcript-format.js','src/transcription/premiere-format.cjs']
]) {
 let matches=false;try {matches=hash(await readFile(path.join(uxp,installed)))===hash(await readFile(path.join(root,'workflow',source)));} catch {}
 checks.push({name,required:false,ok:matches});
}
const ready=checks.filter(c=>c.required).every(c=>c.ok);
console.log(JSON.stringify({status:ready?'dependencies_ready':'setup_needed',dataDirectory:state,checks,livePremiereConnectionVerified:false},null,2));
if(!ready)process.exitCode=1;
