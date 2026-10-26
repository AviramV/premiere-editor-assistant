import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile,rename,cp,rm,lstat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {downloadPinned,checkpoint,retry,atomicJson,treeDigest} from './setup-recovery.mjs';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export async function present(file){try{await lstat(file);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}}
const copy=(source,target)=>cp(source,target,{recursive:true,verbatimSymlinks:true});
export async function provisionRuntime({root,state,runtimes,python,npm,run,env,checkRuntime,patchSha256,report,fetchImpl=fetch,retryOptions={}}) {
 if(await present(runtimes)) {
  await report.step('verify_installed_runtime',()=>checkRuntime(runtimes),'Keep this runtime intact. Inspect the mismatch, or choose a fresh PREMIERE_ASSISTANT_DATA directory and rerun setup.');
  return;
 }
 const lockText=await readFile(path.join(root,'runtime-lock.json')),pins=JSON.parse(lockText),lockSha256=hash(lockText);
 const build=hash(`setup-resume-v1:${lockSha256}:${patchSha256}`).slice(0,24);
 const work=path.join(state,'setup-work-'+build);await mkdir(work,{recursive:true});
 const options={...report.retryOptions,...retryOptions};
 for(const [name,pin] of Object.entries(pins)) {
  if(!['leancoder','quadlzzz'].includes(name))throw new Error('Unexpected pinned bridge name');
  const archive=await report.step('download_'+name,()=>downloadPinned(pin,path.join(state,'downloads'),{fetchImpl,...options}),
   'For a transient network failure, rerun the same setup command; verified downloads are reused. For a checksum mismatch, inspect the source/cache before retrying.');
  const directory=path.join(work,'sources',name);
  await report.step('extract_'+name,()=>checkpoint(work,'extract-'+name,directory,
   ()=>run(python,[path.join(root,'scripts/safe-extract.py'),archive,directory,name==='leancoder'?'0':'1'],{env}),
   stage=>report.event('reused',{checkpoint:stage})),
   'Inspect the archive/extraction error. A rerun rebuilds only this installer-owned scratch stage from the checksum-verified archive.');
 }
 const dependencies=path.join(work,'dependencies/quadlzzz');
 await report.step('bridge_dependencies',()=>checkpoint(work,'dependencies',dependencies,async()=>{
  await copy(path.join(work,'sources/quadlzzz'),dependencies);
  await retry(()=>run(npm,['ci','--ignore-scripts','--legacy-peer-deps','--omit=dev','--no-audit','--no-fund','--registry',process.env.PREMIERE_ASSISTANT_NPM_REGISTRY||'https://registry.npmjs.org','--fetch-retries=0','--fetch-timeout=60000'],{cwd:dependencies,env,timeout:600000}),options);
 },stage=>report.event('reused',{checkpoint:stage})),
 'Rerun setup after fixing connectivity. For a required managed npm mirror, set PREMIERE_ASSISTANT_NPM_REGISTRY for this invocation; global npm configuration is unchanged. Permission, disk-space, certificate and dependency-version errors need correction first.');
 const candidate=path.join(work,'candidate');
 await report.step('prepare_runtime',async()=>{
  if(await present(candidate)) {
   try{await checkRuntime(candidate);await report.event('reused',{checkpoint:'prepared_runtime'});return;}catch{}
  }
  await rm(candidate,{recursive:true,force:true});await mkdir(candidate);
  await copy(path.join(work,'sources/leancoder'),path.join(candidate,'leancoder-runtime'));
  await copy(dependencies,path.join(candidate,'quadlzzz'));
  await run(process.execPath,[path.join(root,'workflow/tools/install-guarded-reorder.mjs')],{env:{...env,PREMIERE_ASSISTANT_RUNTIME:candidate}});
  const manifestFile=path.join(candidate,'quadlzzz/panel/manifest.json');
  const manifest=JSON.parse(await readFile(manifestFile,'utf8'));
  if(manifest.id!=='com.premieremcp.agent')throw new Error('Unexpected UXP panel identity');
  if(Array.isArray(manifest.host))manifest.host=manifest.host[0];
  await writeFile(manifestFile,JSON.stringify(manifest,null,2)+'\n');
  await copy(path.join(root,'vendor/leancoder/cep-plugin'),path.join(candidate,'cep-panel'));
  await cp(path.join(root,'vendor/leancoder/LICENSE'),path.join(candidate,'leancoder-runtime/LICENSE'));
  const files={};
  for(const file of ['leancoder-runtime/server/dist/index.js','quadlzzz/mcp/server.js','quadlzzz/panel/main.js','quadlzzz/panel/guarded-reorder.js','quadlzzz/panel/import-transcript.js','quadlzzz/panel/transcript-format.js','quadlzzz/panel/manifest.json'])files[file]=hash(await readFile(path.join(candidate,file)));
  await atomicJson(path.join(candidate,'installation.json'),{lockSha256,patchSha256,files});
  await checkRuntime(candidate);
 },'The installed runtime is untouched. Inspect the patch/manifest error; rerun setup after correction. Completed extraction and dependency stages are verified before reuse.');
 await report.step('commit_runtime',async()=>{
  if(await present(runtimes))throw new Error('An installed runtime appeared during setup; inspect it before continuing.');
  await rename(candidate,runtimes);await checkRuntime(runtimes);
 },'Inspect the versioned runtime and setup log. Setup never replaces a differing installed runtime automatically.');
}
export async function prepareInstaller({state,runtimes,python,run,report}) {
 const installer=path.join(state,'premiere-editor-assistant-panel.ccx'),receipt=path.join(state,'uxp-installer.json');
 await report.step('uxp_installer',async()=>{
  const files=await treeDigest(path.join(runtimes,'quadlzzz/panel'));
  try {
   const prior=JSON.parse(await readFile(receipt,'utf8'));
   if(JSON.stringify(prior.files)===JSON.stringify(files)&&prior.sha256===hash(await readFile(installer))){await report.event('reused',{checkpoint:'uxp_installer'});return;}
  }catch(error){if(error.code&&!['ENOENT'].includes(error.code))throw error;}
  const temporary=installer+'.'+randomUUID()+'.tmp';
  await run(python,['-c','import pathlib,sys,zipfile; root=pathlib.Path(sys.argv[1]); z=zipfile.ZipFile(sys.argv[2],"w",zipfile.ZIP_DEFLATED); [z.write(p,p.relative_to(root)) for p in sorted(root.rglob("*")) if p.is_file()]; z.close()',path.join(runtimes,'quadlzzz/panel'),temporary]);
  await rename(temporary,installer);await atomicJson(receipt,{files,sha256:hash(await readFile(installer))});
 },'If CCX generation fails, the prepared panel can be loaded using its manifest in Adobe UXP Developer Tool. If CCX installation fails in Creative Cloud, use the same developer-tool alternative and verify with doctor.');
 return installer;
}
export async function installCep({root,state,target,run,report}) {
 const source=path.join(root,'vendor/leancoder/cep-plugin');
 await report.step('cep_panel',async()=>{
  const files=await treeDigest(source);
  if(await present(target)) {
   for(const [file,expected] of Object.entries(files))if(hash(await readFile(path.join(target,file)))!==expected)throw new Error(`Existing CEP panel differs at ${file}; preserve and review it before replacement.`);
  }else {
   await mkdir(path.dirname(target),{recursive:true});
   const staging=path.join(path.dirname(target),'.MCPBridgeCEP-setup-'+randomUUID());
   await copy(source,staging);
   if(JSON.stringify(files)!==JSON.stringify(await treeDigest(staging)))throw new Error('Prepared CEP panel verification failed');
   if(await present(target))throw new Error('A CEP panel appeared during preparation; inspect it before installing.');
   await rename(staging,target);
  }
  for(const version of [8,9,10,11,12,13,14])await run('/usr/bin/defaults',['write',`com.adobe.CSXS.${version}`,'PlayerDebugMode','1']);
 },'An existing differing CEP panel is preserved. Review and back it up before any replacement. Correct permission/disk-space errors and rerun setup --install-cep; a matching panel is reused.');
}
export async function localModels({root,state,python,run,report,retryOptions={}}) {
 const probe=['-c','import mlx_whisper, torch, transformers, sentencepiece'];
 const requirements=hash(await readFile(path.join(root,'requirements-local.txt'))),venv=path.join(state,'python'),localPython=path.join(venv,'bin/python');
 if(process.env.PREMIERE_ASSISTANT_PYTHON) {
  try{await run(python,probe,{timeout:45000});return {path:python,reused:true,modelWeightsVerified:false};}catch{}
 }
 const receipt=path.join(state,'local-models-installation.json');
 try {
  const prior=JSON.parse(await readFile(receipt,'utf8'));
  if(prior.requirements===requirements){await run(localPython,probe,{timeout:45000});return {path:localPython,reused:true,modelWeightsVerified:false};}
 }catch(error){if(error.code&&!['ENOENT'].includes(error.code)&&!error.exitCode)throw error;}
 if(!await present(localPython))await run(python,['-m','venv',venv]);
 await retry(()=>run(localPython,['-m','pip','install','--retries','0','-r',path.join(root,'requirements-local.txt')],{timeout:1200000}),{...report.retryOptions,...retryOptions});
 await run(localPython,probe,{timeout:45000});await atomicJson(receipt,{requirements});
 return {path:localPython,requiresConfiguration:Boolean(process.env.PREMIERE_ASSISTANT_PYTHON)&&python!==localPython,modelWeightsVerified:false};
}
