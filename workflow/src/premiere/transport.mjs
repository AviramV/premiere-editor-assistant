import {runtimeRoot, dataRoot} from '../core/environment.mjs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { unpack } from './state.mjs';
import { clearExactSequenceMarkers, renameExactSequence, ensureProxyPlayback, duplicateNamed, markerRead, reorderClips, selectLabelTargets, updateMarkerText,saveExactProject,setAudioStates,removeEmptyAudioTrack } from './host.mjs';
import {mkdir,copyFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PremierePreflightRefusal} from './errors.mjs';

export const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export class PremiereUxpTransport {
  async connect() {
    const sdk = path.join(runtimeRoot, 'quadlzzz/node_modules/@modelcontextprotocol/sdk/dist/esm');
    const {Client} = await import(pathToFileURL(path.join(sdk, 'client/index.js')));
    const {StdioClientTransport} = await import(pathToFileURL(path.join(sdk, 'client/stdio.js')));
    this.client = new Client({name: 'premiere-transcript-import', version: '0.1.0'});
    this.transport = new StdioClientTransport({command: '/bin/bash',
      args: [path.join(workspace, 'tools/start-quadlzzz.sh')], env: {...process.env}});
    await this.client.connect(this.transport);
    const {tools} = await this.client.listTools();
    if (!tools.some(tool => tool.name === 'ppro_transcript_import')) {
      throw new Error('Transcript import bridge is unavailable; update the packaged runtime and reload its UXP panel');
    }
    return this;
  }
  async call(name, args = {}) {
    if (name !== 'ppro_transcript_import') throw new Error('Only fixed transcript operations are exposed by this client');
    return unpack(await this.client.callTool({name, arguments: args}, undefined, {timeout: 60000}));
  }
  async close() { await this.client?.close(); }
}

export function crossBridgeReorderTargets(dump,moves) {
  // Native items carry track strings such as A2. Normalize after spreading
  // their fields so those strings cannot overwrite the numeric track index.
  const rows=dump.tracks.flatMap(t=>t.items.map(item=>({...item,kind:t.id[0]==='V'?'video':'audio',track:Number(t.id.slice(1))})));
  if(rows.length!==moves.length) throw new PremierePreflightRefusal('Cross-bridge clip count mismatch');
  const near=(a,b)=>{const d=BigInt(a)-BigInt(b);return d>=-512n&&d<=512n;};
  const used=new Set();
  return moves.map(m=>{
    const matches=rows.filter(r=>r.kind===m.kind&&r.track===m.track&&r.name===m.name&&near(r.start.ticks,m.startTicks)&&near(r.end.ticks,m.endTicks)&&near(r.inPoint.ticks,m.inTicks)&&near(r.outPoint.ticks,m.outTicks));
    if(matches.length!==1||used.has(matches[0])) throw new PremierePreflightRefusal('Cross-bridge source identity is stale or ambiguous');
    const row=matches[0];used.add(row);
    if(!row.projectItemId) throw new PremierePreflightRefusal('Native source identity unavailable');
    return {kind:m.kind,track:m.track,name:m.name,sourceUid:String(row.projectItemId),startTicks:m.startTicks,endTicks:m.endTicks,
      inTicks:m.inTicks,outTicks:m.outTicks,destinationTicks:m.destinationTicks};
  });
}

export class PremiereTransport {
  constructor({ fixedScripts = false } = {}) { this.fixedScripts = fixedScripts; }
  async connect() {
    const sdk = path.join(runtimeRoot, 'quadlzzz/node_modules/@modelcontextprotocol/sdk/dist/esm');
    const { Client } = await import(pathToFileURL(path.join(sdk, 'client/index.js')));
    const { StdioClientTransport } = await import(pathToFileURL(path.join(sdk, 'client/stdio.js')));
    this.client = new Client({ name: 'premiere-workflow-adapter', version: '0.1.0' });
    this.transport = new StdioClientTransport({ command: process.execPath,
      args: [path.join(runtimeRoot, 'leancoder-runtime/server/dist/index.js')],
      env: { ...process.env, PREMIERE_MCP_PROTOCOL_MODE: 'legacy',
        ...(this.fixedScripts ? { PREMIERE_MCP_CAPABILITIES: 'inspect,edit,export,filesystem,unsafe-script' } : {}) } });
    await this.client.connect(this.transport);
    return this;
  }
  async call(name, args = {}, timeout = 60000) {
    if (['execute_extendscript','send_raw_script','evaluate_expression'].includes(name)) throw new Error('Arbitrary host scripting is not exposed by this adapter');
    return unpack(await this.client.callTool({ name, arguments: args }, undefined, { timeout }));
  }
  async fixed(operation, { projectPath, sequenceId, name, moves, targets, updates, audioStates, emptyAudioTrack, workingProxies, sequenceRename, markerBaseline }) {
    if (!this.fixedScripts) throw new Error('Fixed host operations are not enabled for this client');
    const builders = { clearExactSequenceMarkers, renameExactSequence, ensureProxyPlayback, duplicateNamed, markerRead, reorderClips, selectLabelTargets, updateMarkerText,saveExactProject,setAudioStates,removeEmptyAudioTrack };
    if (!Object.hasOwn(builders,operation)) throw new Error('Unknown fixed host operation');
    const values={clearExactSequenceMarkers:markerBaseline,renameExactSequence:sequenceRename,ensureProxyPlayback:workingProxies,duplicateNamed:name,reorderClips:moves,selectLabelTargets:targets,updateMarkerText:updates,setAudioStates:audioStates,removeEmptyAudioTrack:emptyAudioTrack};
    const code=builders[operation](projectPath,sequenceId,values[operation]);
    return unpack(await this.client.callTool({ name:'execute_extendscript',arguments:{code} },undefined,{timeout:60000}));
  }
  async cloneReorder({projectPath,sequenceId,frameTicks,moves}) {
    const sdk=path.join(runtimeRoot,'quadlzzz/node_modules/@modelcontextprotocol/sdk/dist/esm');
    const {Client}=await import(pathToFileURL(path.join(sdk,'client/index.js')));
    const {StdioClientTransport}=await import(pathToFileURL(path.join(sdk,'client/stdio.js')));
    const client=new Client({name:'guarded-clone-reorder',version:'0.1.0'});
    const transport=new StdioClientTransport({command:'/bin/bash',args:[path.join(workspace,'tools/start-quadlzzz.sh')],env:{...process.env,PPRO_CALL_TIMEOUT_MS:'185000'}});
    const call=async(name,args={})=>unpack(await client.callTool({name,arguments:args},undefined,{timeout:name==='ppro_guarded_reorder'?180000:60000}));
    try {
      await client.connect(transport);
      const context=await call('ppro_env');
      if(context.project?.path!==projectPath||context.sequence?.guid!==sequenceId) throw new PremierePreflightRefusal('Wrong clone-reorder project or sequence');
      const dump=await call('ppro_timeline_dump');
      if(dump.sequence?.guid!==sequenceId) throw new PremierePreflightRefusal('Clone-reorder target changed');
      const targets=crossBridgeReorderTargets(dump,moves);
      await this.fixed('saveExactProject',{projectPath,sequenceId});
      const snapshotDirectory=path.join(dataRoot,'workflow/execution/snapshots');
      await mkdir(snapshotDirectory,{recursive:true});
      const snapshot=path.join(snapshotDirectory,`before-clone-reorder-${randomUUID()}.prproj`);
      await copyFile(projectPath,snapshot);
      const request={projectPath,sequenceId,frameTicks,moves:targets,deferFinalShift:moves.length>100};
      let result;
      if(moves.length>100){
        for(let step=0;step<120;step++){
          result=await call('ppro_guarded_reorder',{...request,step});
          if(!result.ok||!result.verified||!result.checkpoint||result.sequenceId!==sequenceId||result.completedStep!==step||result.nextStep!==step+1||result.totalSteps<1||result.totalSteps>120)throw new Error('Native reorder checkpoint proof mismatch');
          if(result.parked){if(result.nextStep!==result.totalSteps)throw new Error('Premature parked checkpoint');break;}
          if(result.nextStep>=result.totalSteps)throw new Error('Incomplete final native checkpoint');
        }
        if(!result?.parked)throw new Error('Native reorder checkpoints exceeded bound');
      }else result=await call('ppro_guarded_reorder',request);
      let collectiveRipple;
      if(result.parked) {
        if(!result.ok||!result.verified||result.sequenceId!==sequenceId||result.cloned!==moves.length||BigInt(result.parkTicks)<=0n||BigInt(result.parkTicks)%BigInt(frameTicks))throw new Error('Parked clone proof mismatch');
        const context=await this.call('get_project_info');if(context.path!==projectPath||context.activeSequence?.id!==sequenceId)throw new Error('Target changed after parked clone');
        const args={sequence_id:sequenceId,ranges:[{start:0,end:Number(result.parkTicks)/254016000000}],scope:'sync_locked',range_content:'delete',allow_large_ripple:true};
        const preview=await this.call('ripple_remove_timeline_ranges',{...args,dry_run:true});
        if(!preview.confirmationToken||preview.clipsRemoved!==0||preview.clipsShifted!==moves.length)throw new Error('Parked lead-in is not proven empty with exact shifted clip count');
        collectiveRipple=await this.call('ripple_remove_timeline_ranges',{...args,dry_run:false,confirmation_token:preview.confirmationToken});
      }
      return {...result,collectiveRipple,snapshot};
    } finally {await client.close();}
  }
  async close() { await this.client?.close(); }
}
