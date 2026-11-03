import path from 'node:path';
import {homedir} from 'node:os';
import {root,state,location,runtimes,executable,run,exists,runtimeReady,hash,environment} from './common.mjs';
import {settingsDirectory} from './settings.mjs';
import {readFile,readdir} from 'node:fs/promises';

const legacyRuntime=location.legacyDirectory&&await exists(path.join(location.legacyDirectory,'integrations/installation.json'))?{path:location.legacyDirectory,compatibility:'unverified',remedy:'To reuse this installation, run setup with PREMIERE_ASSISTANT_DATA set to this exact directory. Setup verifies it before registering it for both agents. Preserve all existing directories and journals.'}:undefined;
const checks=[];
checks.push({name:'macOS',required:true,ok:process.platform==='darwin'});
checks.push({name:'Node.js 22+',required:true,ok:Number(process.versions.node.split('.')[0])>=22,version:process.versions.node,path:process.execPath});
for(const [name,args] of [['ffmpeg',['-version']],['ffprobe',['-version']],['python3',['-c','import sys; assert sys.version_info >= (3,9), "Python 3.9+ required"; print(sys.version.splitlines()[0])']]]) {
 const file=name==='python3'?environment().PREMIERE_ASSISTANT_PYTHON:executable(name);
 try {const version=(await run(file,args,{timeout:15000})).trim().split('\n')[0];checks.push({name,required:true,ok:true,version,path:file});}
 catch(error){checks.push({name,required:true,ok:false,path:file,detail:error.message,remedy:`Reuse an existing executable with launch.sh configure --${name==='python3'?'python':name} /absolute/path, or install it through your package manager.`});}
}
try {await runtimeReady();checks.push({name:'pinned_bridge_runtime',required:true,ok:true});}
catch(error){checks.push({name:'pinned_bridge_runtime',required:true,ok:false,detail:error.message,remedy:'Run setup through this package\'s launcher to prepare its versioned runtime. Keep previous runtime directories and project journals.'});}

const localPython=environment().PREMIERE_ASSISTANT_PYTHON;
try {
 await run(localPython,['-c','import mlx_whisper, torch, transformers, sentencepiece; print("Local transcription imports passed; model weights untested")'],{timeout:45000});
 checks.push({name:'local_models_environment',required:false,ok:true,path:localPython,modelWeightsVerified:false});
} catch(error) {
 checks.push({name:'local_models_environment',required:false,ok:false,path:localPython,detail:error.message,remedy:'Optional: configure a compatible existing environment with configure --python /absolute/venv/bin/python, or run setup --local-models. Premiere-native transcripts, existing timed transcripts and explicitly authorized ElevenLabs (Scribe) are alternatives.'});
}
// Suggest previous environments; never move a venv (its paths may be absolute) or reuse it silently.
const previousPythonEnvironments=[];
const bases=new Set([path.dirname(state),path.join(homedir(),'Library/Application Support/Premiere Editor Assistant')]);
for(const base of bases) {
 let entries=[];try {entries=await readdir(base,{withFileTypes:true});}catch{}
 for(const entry of entries) {
  if(!entry.isDirectory()||!/^\d+\.\d+\.\d+(?:[-+].*)?$/.test(entry.name))continue;
  const file=path.join(base,entry.name,'python/bin/python');
  if(file!==localPython&&await exists(file)&&!previousPythonEnvironments.some(candidate=>candidate.path===file))previousPythonEnvironments.push({path:file,compatibility:'unverified',keepDirectoryWhileInUse:true});
 }
}

const cep=path.join(homedir(),'Library/Application Support/Adobe/CEP/extensions/MCPBridgeCEP');
async function comparePanel(source,target,relative='') {
 for(const entry of await readdir(path.join(source,relative),{withFileTypes:true})) {
  const name=path.join(relative,entry.name);
  if(entry.isDirectory())await comparePanel(source,target,name);
  else if(hash(await readFile(path.join(source,name)))!==hash(await readFile(path.join(target,name))))throw new Error(`Installed CEP panel differs at ${name}`);
 }
}
try {await comparePanel(path.join(root,'vendor/leancoder/cep-plugin'),cep);checks.push({name:'CEP_panel_current',required:true,ok:true,path:cep});}
catch(error){checks.push({name:'CEP_panel_current',required:true,ok:false,path:cep,detail:error.message,remedy:'Run setup --install-cep if absent. A differing panel requires review and a backup before replacement.'});}

const external=path.join(homedir(),'Library/Application Support/Adobe/UXP/Plugins/External');
const candidates=[];
if(process.env.PREMIERE_ASSISTANT_UXP_PANEL)candidates.push(path.resolve(process.env.PREMIERE_ASSISTANT_UXP_PANEL));
else {
 let entries=[];try {entries=await readdir(external,{withFileTypes:true});}catch{}
 for(const entry of entries)if(entry.isDirectory()) {
  const directory=path.join(external,entry.name);
  try {if(JSON.parse(await readFile(path.join(directory,'manifest.json'),'utf8')).id==='com.premieremcp.agent')candidates.push(directory);}catch{}
 }
}
const helpers=[['UXP_guarded_panel_present','guarded-reorder.js','src/premiere/uxp-reorder.cjs'],
 ['UXP_transcript_import_present','import-transcript.js','src/premiere/uxp-transcript.cjs'],
 ['UXP_transcript_format_present','transcript-format.js','src/transcription/premiere-format.cjs'],
 ['UXP_panel_entrypoint_current','main.js',null]];
const inspected=[];
for(const directory of candidates) {
 const matches=[];
 for(const [,installed,source] of helpers) {
  try {
   const manifest=JSON.parse(await readFile(path.join(directory,'manifest.json'),'utf8'));
   const expected=source?path.join(root,'workflow',source):path.join(runtimes,'quadlzzz/panel/main.js');
   matches.push(manifest.id==='com.premieremcp.agent'&&hash(await readFile(path.join(directory,installed)))===hash(await readFile(expected)));
  }catch{matches.push(false);}
 }
 inspected.push({directory,matches});
}
// All helpers must match in the same panel, never combine files from different installations.
inspected.sort((a,b)=>b.matches.filter(Boolean).length-a.matches.filter(Boolean).length);
for(const [index,[name]] of helpers.entries())checks.push({name,required:true,ok:inspected[0]?.matches[index]||false,path:inspected[0]?.directory,
 remedy:'Install the generated CCX through Adobe Creative Cloud, or load the prepared manifest in UXP Developer Tool. For a developer-loaded panel, set PREMIERE_ASSISTANT_UXP_PANEL to its directory for this check.'});

const ready=checks.filter(c=>c.required).every(c=>c.ok);
console.log(JSON.stringify({status:ready?'dependencies_ready':'setup_needed',dataDirectory:state,runtimeLocation:location,legacyRuntime,executableSettingsDirectory:settingsDirectory(),checks,previousPythonEnvironments,
 uxpInstaller:path.join(state,'premiere-editor-assistant-panel.ccx'),
 livePremiereConnectionVerified:false,codexConnectionsVerified:false,modelWeightsVerified:false,
 next:ready?'Open both panels and a Premiere project, then run smoke --live. After a launcher/configuration change, reload Codex connections or restart Codex and verify both bridges from the chat.':'Resolve required checks, then rerun doctor. Optional local models do not block setup.'},null,2));
if(!ready)process.exitCode=1;
