import {runtimeRoot, dataRoot} from '../src/core/environment.mjs';
import {readFile,writeFile,copyFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {homedir} from 'node:os';
import {workspace} from '../src/premiere/transport.mjs';
import path from 'node:path';
const base=path.join(runtimeRoot,'quadlzzz');
const marker='// project-owned guarded reorder v1';
const patches=[
 {file:'panel/main.js',hash:'d5a9c8c7ce3607abaa2c44dd3aa6f0c90a2522ceac25f094b95d3b495469b742',anchor:'async function handleCommand(msg) {',
  code:`${marker}\ncommands["timeline.guardedReorder"] = params => require("./guarded-reorder.js").guardedReorder(ppro, params);\n\n`},
 {file:'mcp/server.js',hash:'d5d6181dd14c2c4e0cfb319a75752ce19fb49bab4b62d2830a23fe51debdb0f2',anchor:'await server.connect(new StdioServerTransport());',
  code:`${marker}\nrelay("ppro_guarded_reorder", {\n title: "Reorder an exact disposable sequence by cloning",\n description: "Project-owned bounded clone/remove/collective-shift operation. Exact project and sequence guards; no mutation retries.",\n inputSchema: {projectPath:z.string(),sequenceId:z.string(),frameTicks:z.string(),deferFinalShift:z.boolean().optional(),step:z.number().int().min(0).max(119).optional(),moves:z.array(z.object({kind:z.enum(["video","audio"]),track:z.number().int().nonnegative(),sourceUid:z.string(),name:z.string(),startTicks:z.string(),endTicks:z.string(),inTicks:z.string(),outTicks:z.string(),destinationTicks:z.string()})).min(1).max(600)}\n}, "timeline.guardedReorder");\n\n`}
];
// Share the pinned-file validation and installer with the existing fixed operation.
const transcriptPatches = [
 `${marker} transcript import v1\ncommands["transcript.importExternal"] = params => require("./import-transcript.js").importTranscript(ppro, params);\n\n`,
 `${marker} transcript import v1\nrelay("ppro_transcript_import", {\n title: "Import or inspect an exact source transcript",\n description: "Fixed source-item transcript import with project/media guards, conflict protection, native readback and save. Inspect mode is read-only. Never creates captions or retries mutations.",\n inputSchema: {projectPath:z.string(),clipId:z.string(),sourcePath:z.string(),mode:z.enum(["inspect","import"]),transcript:z.object({language:z.string(),segments:z.array(z.any()).min(1).max(50000),speakers:z.array(z.any()).min(1).max(50000)})}\n}, "transcript.importExternal");\n\n`
];
for (const [index, patch] of patches.entries()) {
 patch.transcriptCode = transcriptPatches[index];
}
if(process.argv.slice(2).some(value=>value!=='--installed'))throw new Error('Usage: node tools/install-guarded-reorder.mjs [--installed]');
if(process.argv.includes('--installed')) {
 const directory=path.join(homedir(),'Library/Application Support/Adobe/UXP/Plugins/External/com.premieremcp.agent_0.1.0');
 const manifest=JSON.parse(await readFile(path.join(directory,'manifest.json'),'utf8'));
 if(manifest.id!=='com.premieremcp.agent'||manifest.version!=='0.1.0')throw new Error('Wrong installed integration');
 patches.push({...patches[0],path:path.join(directory,'main.js'),installed:true});
}
// Validate both pinned files before writing either one.
for(const patch of patches) {
 patch.path??=path.join(base,patch.file);patch.text=await readFile(patch.path,'utf8');
 const priorCheckpoint=patch.code.replace('step:z.number().int().min(0).max(119).optional(),','');
 const prior=patch.code.replace('guarded-reorder.js','guarded-reorder.cjs');
 const priorBound=patch.code.replace('.max(600)','.max(300)');
 const priorShift=patch.code.replace('deferFinalShift:z.boolean().optional(),','');
 const variants=[patch.code,prior,priorBound,priorShift,priorShift.replace('.max(600)','.max(300)'),priorCheckpoint,priorCheckpoint.replace('deferFinalShift:z.boolean().optional(),',''),priorCheckpoint.replace('.max(600)','.max(300)'),priorCheckpoint.replace('deferFinalShift:z.boolean().optional(),','').replace('.max(600)','.max(300)')].flatMap(code=>[code,code.replace('guarded-reorder.js','guarded-reorder.cjs')]);
 const original=variants.reduce((text,code)=>text.replace(code,''),patch.text.replace(patch.transcriptCode,''));
 if(createHash('sha256').update(original).digest('hex')!==patch.hash||!original.includes(patch.anchor))throw new Error(`Unexpected integration revision: ${patch.path}`);
 patch.updated=original.replace(patch.anchor,patch.code+patch.transcriptCode+patch.anchor);
}
for(const patch of patches.filter(p=>p.file==='panel/main.js')) {
 if(patch.installed) {
  const backup=path.join(dataRoot,'workflow/setup-backups');await mkdir(backup,{recursive:true});
  await writeFile(path.join(backup,`quadlzzz-main-${createHash('sha256').update(patch.text).digest('hex')}.js`),patch.text);
 }
 await copyFile(path.join(workspace,'src/premiere/uxp-reorder.cjs'),path.join(path.dirname(patch.path),'guarded-reorder.js'));
 await copyFile(path.join(workspace,'src/premiere/uxp-transcript.cjs'),path.join(path.dirname(patch.path),'import-transcript.js'));
 await copyFile(path.join(workspace,'src/transcription/premiere-format.cjs'),path.join(path.dirname(patch.path),'transcript-format.js'));
}
for(const patch of patches)if(patch.updated!==patch.text)await writeFile(patch.path,patch.updated);
console.log('Guarded reorder and transcript import bridges installed without changing manifest permissions. Reload the UXP panel before live acceptance.');
