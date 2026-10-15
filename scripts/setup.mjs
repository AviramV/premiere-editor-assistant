import path from 'node:path';
import {homedir} from 'node:os';
import {mkdir,readFile,writeFile,mkdtemp,rename,cp,readdir,rm} from 'node:fs/promises';
import {root,state,runtimes,hash,run,environment,executable,exists,runtimeReady} from './common.mjs';
const flags=new Set(process.argv.slice(2));
if([...flags].some(f=>!['--local-models','--install-cep','--help'].includes(f)))throw new Error('Usage: setup.mjs [--local-models] [--install-cep]');
if(flags.has('--help')){console.log('Prepare pinned bridges and an installable UXP panel. --local-models adds a Python environment; --install-cep installs the CEP panel. Each option is explicit; no Premiere projects are edited.');process.exit(0);}
if(process.platform!=='darwin')throw new Error('This release supports macOS. Windows needs a separately validated adapter.');
if(Number(process.versions.node.split('.')[0])<22)throw new Error('Node.js 22+ is required');
const python=process.env.PREMIERE_ASSISTANT_PYTHON || executable('python3');
await run(python,['-c','import sys; assert sys.version_info >= (3,9), "Python 3.9+ required"']);
await mkdir(state,{recursive:true});
const lockDirectory=path.join(state,'setup.lock');
try {await mkdir(lockDirectory);} catch {throw new Error(`Another setup may be active. Inspect ${lockDirectory} before retrying.`);}
try {
 if(await exists(runtimes)) {
  await runtimeReady();console.error('Pinned bridge runtime is already installed and verified.');
 } else {
  const staging=await mkdtemp(path.join(state,'setup-'));
  const lockText=await readFile(path.join(root,'runtime-lock.json'));
  const pins=JSON.parse(lockText);
  const stagedRuntimes=path.join(staging,'integrations');await mkdir(stagedRuntimes);
  for(const [name,pin] of Object.entries(pins)) {
   console.error(`Downloading pinned ${name} ${pin.version}…`);
   const response=await fetch(pin.url,{signal:AbortSignal.timeout(180000)});
   if(!response.ok)throw new Error(`${name} download failed: HTTP ${response.status}`);
   const bytes=Buffer.from(await response.arrayBuffer());
   if(hash(bytes)!==pin.sha256)throw new Error(`${name} checksum mismatch; nothing installed`);
   const archive=path.join(staging,`${name}.zip`);await writeFile(archive,bytes);
   await run(python,[path.join(root,'scripts/safe-extract.py'),archive,path.join(stagedRuntimes,name==='leancoder'?'leancoder-runtime':'quadlzzz'),name==='leancoder'?'0':'1']);
  }
  console.error('Installing locked bridge dependencies…');
  await run(executable('npm'),['ci','--ignore-scripts','--legacy-peer-deps','--omit=dev','--no-audit','--no-fund','--registry',process.env.PREMIERE_ASSISTANT_NPM_REGISTRY || 'https://registry.npmjs.org','--fetch-retries=1','--fetch-timeout=60000'],{cwd:path.join(stagedRuntimes,'quadlzzz'),timeout:600000});
  await run(process.execPath,[path.join(root,'workflow/tools/install-guarded-reorder.mjs')],{env:{...environment(),PREMIERE_ASSISTANT_RUNTIME:stagedRuntimes}});
  const panel=path.join(stagedRuntimes,'quadlzzz/panel');
  const manifestFile=path.join(panel,'manifest.json');
  const manifest=JSON.parse(await readFile(manifestFile,'utf8'));
  if(manifest.id!=='com.premieremcp.agent')throw new Error('Unexpected UXP panel identity');
  if(Array.isArray(manifest.host))manifest.host=manifest.host[0];
  await writeFile(manifestFile,JSON.stringify(manifest,null,2)+'\n');
  await cp(path.join(root,'vendor/leancoder/cep-plugin'),path.join(stagedRuntimes,'cep-panel'),{recursive:true});
  await cp(path.join(root,'vendor/leancoder/LICENSE'),path.join(stagedRuntimes,'leancoder-runtime/LICENSE'));
  const files={};
  for(const file of ['leancoder-runtime/server/dist/index.js','quadlzzz/mcp/server.js','quadlzzz/panel/main.js','quadlzzz/panel/guarded-reorder.js','quadlzzz/panel/manifest.json'])files[file]=hash(await readFile(path.join(stagedRuntimes,file)));
  await writeFile(path.join(stagedRuntimes,'installation.json'),JSON.stringify({lockSha256:hash(lockText),patchSha256:hash(await readFile(path.join(root,'workflow/src/premiere/uxp-reorder.cjs'))),files},null,2)+'\n');
  await rename(stagedRuntimes,runtimes);
  await rm(staging,{recursive:true});
 }
 const ccx=path.join(state,'premiere-editor-assistant-panel.ccx');
 await run(python,['-c','import pathlib,sys,zipfile; root=pathlib.Path(sys.argv[1]); z=zipfile.ZipFile(sys.argv[2],"w",zipfile.ZIP_DEFLATED); [z.write(p,p.relative_to(root)) for p in sorted(root.rglob("*")) if p.is_file()]; z.close()',path.join(runtimes,'quadlzzz/panel'),ccx]);
 if(flags.has('--local-models')) {
  if(process.arch!=='arm64')throw new Error('Local MLX transcription requires Apple Silicon. Use an existing transcript or configure Scribe on Intel Macs.');
  const venv=path.join(state,'python');
  if(!await exists(path.join(venv,'bin/python')))await run(python,['-m','venv',venv]);
  await run(path.join(venv,'bin/python'),['-m','pip','install','-r',path.join(root,'requirements-local.txt')],{timeout:1200000});
 }
 if(flags.has('--install-cep')) {
  const target=path.join(homedir(),'Library/Application Support/Adobe/CEP/extensions/MCPBridgeCEP');
  if(await exists(target)) {
   // Existing installations belong to the user. Compare all packaged files before calling it current.
   async function compare(dir,relative='') {for(const entry of await readdir(path.join(dir,relative),{withFileTypes:true})) {const name=path.join(relative,entry.name);if(entry.isDirectory())await compare(dir,name);else if(hash(await readFile(path.join(dir,name)))!==hash(await readFile(path.join(target,name))))throw new Error(`Existing CEP panel differs at ${name}; review the existing installation before replacing it.`);}}
   await compare(path.join(runtimes,'cep-panel'));
  } else {await mkdir(path.dirname(target),{recursive:true});await cp(path.join(runtimes,'cep-panel'),target,{recursive:true,errorOnExist:true,force:false});}
  // Adobe's unsigned CEP development panel needs this preference. This only runs with --install-cep.
  for(const version of [8,9,10,11,12,13,14])await run('/usr/bin/defaults',['write',`com.adobe.CSXS.${version}`,'PlayerDebugMode','1']);
 }
 console.log(JSON.stringify({status:'runtime_ready',dataDirectory:state,uxpInstaller:ccx,cepPanel:path.join(runtimes,'cep-panel'),next:'Install/open the Adobe panels, then run doctor.mjs and a read-only live connection check.'},null,2));
} finally {await rm(lockDirectory,{recursive:true});}
