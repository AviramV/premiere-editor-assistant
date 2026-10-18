import { mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { normalizeSequence, contentState, revision, digest, ensureEditable, predictKeep, predictCuts, predictReorder, removalRanges,locateInstance } from './state.mjs';
import { ticksToSeconds } from '../core/timing.mjs';
import {PremierePreflightRefusal} from './errors.mjs';
import {helperPath,pythonPath} from '../core/environment.mjs';
import {run} from '../core/process.mjs';

export async function atomicJson(filename, value) {
  await mkdir(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  await rename(temporary, filename);
}

export class PremiereCoordinator {
  constructor({ transport, projectPath, protectedIds = [], directory, settleMs = 65000, intervalMs = 1000 }) {
    if (!path.isAbsolute(projectPath) || !directory) throw new Error('Exact absolute project path and journal directory required');
    Object.assign(this, { transport, projectPath, protectedIds, directory, settleMs, intervalMs });
  }
  async inspect(sequenceId, { active = false, editable = false } = {}) {
    const context = await this.transport.call('get_project_info');
    if (context.path !== this.projectPath) throw new Error('Wrong project path');
    if (active && context.activeSequence?.id !== sequenceId) throw new Error('Wrong active sequence');
    let pageLimit=this.readPageLimit||200;
    const readPage=async(offset=0)=>{
      while(true) {
        try {
          const page=await this.transport.call('get_full_sequence_info',{sequence_id:sequenceId,clip_limit:pageLimit,clip_offset:offset});
          this.readPageLimit=pageLimit;return page;
        }
        catch(error) {
          // This is a read-only payload refusal, never a mutation retry. Keep
          // the same offset so no clip is lost when the page size shrinks.
          if(!error.message.includes('Sequence page exceeds the bounded payload budget.')||pageLimit===1) throw error;
          pageLimit=Math.max(1,Math.floor(pageLimit/2));
        }
      }
    };
    const raw = await readPage();
    if (raw.id !== sequenceId) throw new Error('Wrong sequence identity');
    let offset = raw.pagination?.nextOffset;
    const header = value => digest({ id: value.id, duration: value.durationSeconds,
      frameRate: value.frameRate, width: value.width, height: value.height,
      tracks: ['videoTracks', 'audioTracks'].map(key => value[key].map(t => ({ index: t.index,
        clipCount: t.clipCount, name: t.name, muted: t.isMuted, locked: t.isLocked }))) });
    const initialHeader = header(raw);
    while (offset !== null && offset !== undefined) {
      const page = await readPage(offset);
      if (header(page) !== initialHeader || (page.pagination?.nextOffset !== null && page.pagination?.nextOffset <= offset)) {
        throw new Error('Sequence changed during paginated inspection');
      }
      for (const key of ['videoTracks', 'audioTracks']) for (let i = 0; i < raw[key].length; i++) raw[key][i].clips.push(...page[key][i].clips);
      offset = page.pagination?.nextOffset;
    }
    if (raw.pagination) raw.pagination.truncated = false;
    if (raw.markersTruncated) {
      const extra = await this.transport.fixed('markerRead', { projectPath:this.projectPath, sequenceId });
      if (extra.id !== sequenceId || !Array.isArray(extra.markers)) throw new Error('Incomplete marker inspection');
      raw.markers = extra.markers;
      raw.markersTruncated = false;
    }
    const state = normalizeSequence(raw);
    if (editable) {
      if (this.protectedIds.includes(sequenceId)) throw new Error('Source sequence is protected');
      ensureEditable(state);
    }
    return state;
  }
  async lock() {
    await mkdir(this.directory, { recursive: true });
    const filename = path.join(this.directory, 'writer.lock');
    try {
      const handle = await open(filename, 'wx', 0o600);
      await handle.writeFile(JSON.stringify({ pid: process.pid }));
      await handle.close();
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let prior;
      try { prior = JSON.parse(await readFile(filename, 'utf8')); } catch { throw new Error('Writer lock is unreadable; inspect before recovery'); }
      try { process.kill(prior.pid, 0); throw new Error('Another Premiere writer is running'); }
      catch (alive) { if (alive.code !== 'ESRCH') throw alive; }
      await rm(filename);
      return this.lock();
    }
    return () => rm(filename, { force: true });
  }
  async readSavedSequence(sequenceId) {
    if(!/^[a-zA-Z0-9_.-]{1,128}$/.test(sequenceId||''))throw new Error('Exact sequence identity required for saved evidence');
    const release=await this.lock();
    try {
      if(Object.values(await this.ledger()).some(e=>['dispatched','indeterminate','ui_pending'].includes(e.status)))throw new Error('An uncertain edit blocks saved-state verification until reconciled');
      const before=await this.inspect(sequenceId);
      await this.transport.call('save_project');
      const output=path.resolve(this.directory,'native-evidence',`${sequenceId}.json`);
      await run(pythonPath(),[helperPath('read-project.py'),'--project',this.projectPath,'--sequence',sequenceId,'--output',output]);
      const saved=JSON.parse(await readFile(output,'utf8')),after=await this.inspect(sequenceId);
      if(saved.projectPath!==this.projectPath||saved.sequenceId!==sequenceId||saved.name!==before.name||revision(after)!==revision(before))throw new Error('Saved evidence target or timeline changed during verification');
      return saved;
    } finally {await release();}
  }
  async clearMarkers({operationId,sequenceId,beforeRevision}) {
    const before=await this.inspect(sequenceId,{active:true,editable:true});
    if(revision(before)!==beforeRevision)throw new Error('Stale marker clearing plan');
    if(!before.markers.length)return {status:'unchanged',observed:before};
    const expected={...before,markers:[]};
    return this.mutate({operationId,sequenceId,beforeRevision,expected,dispatch:()=>this.transport.fixed('clearExactSequenceMarkers',{
      projectPath:this.projectPath,sequenceId,markerBaseline:before.markers})});
  }
  async ledger() {
    try { return JSON.parse(await readFile(path.join(this.directory, 'journal.json'), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return {}; throw error; }
  }
  async persist(ledger) { await atomicJson(path.join(this.directory, 'journal.json'), ledger); }
  async duplicate({ operationId, sourceId, beforeRevision, name }) {
    if (!/^[a-zA-Z0-9_.-]{1,128}$/.test(operationId || '') || !name || name.length > 200) throw new Error('Stable operation ID and bounded output name required');
    const release = await this.lock();
    try {
      const ledger = await this.ledger();
      if (ledger[operationId]) throw new Error('Operation ID already recorded; inspect rather than resending');
      if (Object.values(ledger).some(e => ['dispatched','indeterminate','ui_pending'].includes(e.status))) throw new Error('An uncertain edit blocks all further mutations until reconciled');
      const before = await this.inspect(sourceId);
      ensureEditable(before);
      if (revision(before) !== beforeRevision) throw new Error('Stale duplication plan');
      const entry = ledger[operationId] = { operationId, kind: 'duplicate', sourceId, name, before,
        projectPath: this.projectPath, status: 'dispatched', startedAt: new Date().toISOString() };
      await this.persist(ledger);
      try {
        const response = await this.transport.fixed('duplicateNamed', { projectPath:this.projectPath, sequenceId:sourceId, name });
        entry.response = response;
        if (!response.id || response.id === sourceId || this.protectedIds.includes(response.id)) throw new Error('Invalid duplicate identity');
        entry.sequenceId = response.id;
        entry.observed = await this.inspect(response.id, { active: true, editable: true });
        const sourceAfter = await this.inspect(sourceId);
        if (entry.observed.name !== name || digest(contentState(entry.observed)) !== digest(contentState(before)) || revision(sourceAfter) !== beforeRevision) throw new Error('Duplicate or source preservation mismatch');
        entry.status = 'verified';
        entry.completedAt = new Date().toISOString();
        await this.persist(ledger);
        return entry;
      } catch (error) {
        entry.status = 'indeterminate'; entry.hostError = error.message;
        await this.persist(ledger);
        throw new Error(`Duplication ${operationId} is indeterminate; inspect before any further mutation`);
      }
    } finally { await release(); }
  }
  async resolveUndispatched(operationId) {
    const release=await this.lock();
    try {
      const ledger=await this.ledger(), entry=ledger[operationId];
      // This exact protocol refusal means the server never invoked a host
      // handler. Timeout, generic failure and partial commits cannot use this.
      if(entry?.kind!=='duplicate' || entry.status!=='indeterminate' || entry.hostError!=='MCP error -32602: Tool execute_extendscript not found') throw new Error('No proven pre-dispatch refusal');
      const observed=await this.inspect(entry.sourceId);
      const project=await this.transport.call('get_full_project_overview',{include_bin_tree:false});
      if(revision(observed)!==revision(entry.before) || project.sequences.some(s=>s.name===entry.name)) throw new Error('Unexpected project state; refusal cannot be resolved');
      entry.status='not_dispatched';entry.observed=observed;entry.completedAt=new Date().toISOString();
      await this.persist(ledger);return entry;
    } finally {await release();}
  }
  async cutBoundaries({ operationId, sequenceId, beforeRevision, cutTicks }) {
    const before = await this.inspect(sequenceId, { active: true, editable: true });
    const points = [...new Set(cutTicks.map(String))].map(BigInt).sort((a,b) => a < b ? -1 : 1);
    if (!points.length || points.length > 16 || points.some(p => p <= 0n || p >= BigInt(before.durationTicks) || p % BigInt(before.frameTicks))) throw new Error('One to sixteen interior frame-aligned cuts required');
    const pending = points.filter(p => before.tracks.some(t => t.clips.some(c => BigInt(c.startTicks) < p && BigInt(c.endTicks) > p)));
    if (!pending.length) return { status: 'unchanged', observed: before };
    return this.mutate({ operationId, sequenceId, beforeRevision, expected: predictCuts(before, pending), dispatch: async () => {
      const results = [];
      for (const point of pending) {
        const context = await this.transport.call('get_project_info');
        if (context.path !== this.projectPath || context.activeSequence?.id !== sequenceId) throw new Error('Target changed during cut batch');
        results.push(await this.transport.call('razor_all_tracks', { time_seconds: ticksToSeconds(point), track_type: 'both' }));
      }
      return results;
    } });
  }
  async addMarkers({ operationId, sequenceId, beforeRevision, markers }) {
    if (!markers.length || markers.length > 200) throw new Error('One to 200 markers required');
    const before = await this.inspect(sequenceId, { active: true, editable: true });
    const expected = structuredClone(before);
    for (const marker of markers) {
      const a = BigInt(marker.startTicks), b = BigInt(marker.endTicks);
      if (a < 0n || a > b || b > BigInt(before.durationTicks) || a % BigInt(before.frameTicks) || b % BigInt(before.frameTicks) || !Number.isInteger(marker.color) || marker.color < 0 || marker.color > 7 || marker.name.length > 255 || marker.comments.length > 2000) throw new Error('Invalid marker specification');
      expected.markers.push(marker);
    }
    expected.markers.sort((a,b) => BigInt(a.startTicks) < BigInt(b.startTicks) ? -1 : BigInt(a.startTicks) > BigInt(b.startTicks) ? 1 : a.name.localeCompare(b.name));
    return this.mutate({ operationId, sequenceId, beforeRevision, expected, dispatch: () => this.transport.call('add_markers_batch', {
      sequence_id: sequenceId, markers: markers.map(m => ({ time_seconds: ticksToSeconds(m.startTicks), name: m.name, comments: m.comments,
        color: m.color, duration_seconds: ticksToSeconds(BigInt(m.endTicks) - BigInt(m.startTicks)) })) }) });
  }
  async setAudioStates({operationId,sequenceId,beforeRevision,clips=[],tracks=[]}) {
    if(!Array.isArray(clips)||!Array.isArray(tracks)||clips.length+tracks.length<1||clips.length+tracks.length>300) throw new Error('One to 300 audio state targets required');
    const before=await this.inspect(sequenceId,{active:true,editable:true}),expected=structuredClone(before),keys=new Set(),changedClips=[],changedTracks=[];
    for(const target of clips) {
      if(target.kind!=='audio'||typeof target.enabled!=='boolean')throw new Error('Audio clip state target required');
      const clip=locateInstance(before,target),copy=locateInstance(expected,target),key=digest({kind:target.kind,track:target.track,startTicks:target.startTicks});
      if(keys.has(key)||clip.endTicks!==target.endTicks||clip.outTicks!==target.outTicks)throw new Error('Repeated or stale audio clip target');keys.add(key);
      if(clip.enabled!==target.enabled){changedClips.push({...target,beforeEnabled:clip.enabled});copy.enabled=target.enabled;}
    }
    for(const target of tracks) {
      const track=before.tracks.find(t=>t.kind==='audio'&&t.index===target.track),key=`track:${target.track}`;
      if(!track||track.locked||typeof target.muted!=='boolean'||keys.has(key))throw new Error('Wrong, locked or repeated audio mute target');keys.add(key);
      if(track.muted!==target.muted){changedTracks.push({...target,name:track.name,clipCount:track.clips.length,beforeMuted:track.muted});expected.tracks.find(t=>t.kind==='audio'&&t.index===target.track).muted=target.muted;}
    }
    if(revision(before)!==beforeRevision)throw new Error('Stale audio state plan');
    if(!changedClips.length&&!changedTracks.length)return {status:'unchanged',observed:before};
    return this.mutate({operationId,sequenceId,beforeRevision,expected,dispatch:()=>this.transport.fixed('setAudioStates',{projectPath:this.projectPath,sequenceId,audioStates:{clips:changedClips,tracks:changedTracks}})});
  }
  async removeEmptyAudioTrack({operationId,sequenceId,beforeRevision,track:index}) {
    const before=await this.inspect(sequenceId,{active:true,editable:true}),audio=before.tracks.filter(t=>t.kind==='audio'),track=audio.find(t=>t.index===index);
    if(!track||track.locked||track.clips.length)throw new Error('Only an unlocked, genuinely empty audio track can be removed');
    const expected=structuredClone(before);expected.tracks=expected.tracks.filter(t=>t.kind!=='audio'||t.index!==index);
    for(const t of expected.tracks)if(t.kind==='audio'&&t.index>index)t.index--;
    return this.mutate({operationId,sequenceId,beforeRevision,expected,dispatch:()=>this.transport.fixed('removeEmptyAudioTrack',{projectPath:this.projectPath,sequenceId,emptyAudioTrack:{track:index,count:audio.length,name:track.name,muted:track.muted}})});
  }
  async mutate({ operationId, sequenceId, beforeRevision, expected, dispatch, requireReportedDuration = false }) {
    if (!/^[a-zA-Z0-9_.-]{1,128}$/.test(operationId || '')) throw new Error('Stable operation ID required');
    const release = await this.lock();
    try {
      const ledger = await this.ledger();
      if (ledger[operationId]) throw new Error('Operation ID already recorded; inspect its result rather than resending');
      if (Object.values(ledger).some(entry => ['dispatched', 'indeterminate', 'ui_pending'].includes(entry.status))) throw new Error('An uncertain edit blocks all further mutations until reconciled');
      const before = await this.inspect(sequenceId, { active: true, editable: true });
      if (revision(before) !== beforeRevision) throw new Error('Stale edit plan');
      const entry = ledger[operationId] = { operationId, sequenceId, projectPath: this.projectPath,
        before, expected, requireReportedDuration, status: 'dispatched', startedAt: new Date().toISOString() };
      // Persist before sending: a crashed process cannot accidentally retry the host edit.
      await this.persist(ledger);
      let response, error, preflightRefused=false;
      try { response = await dispatch(); } catch (e) { error = e.message;preflightRefused=e instanceof PremierePreflightRefusal; }
      entry.hostError = error;
      entry.response = response;
      if(preflightRefused)entry.noMutationDispatched=true;
      const deadline = Date.now() + this.settleMs;
      do {
        try {
          const observed = await this.inspect(sequenceId);
          entry.observed = observed;
          if (!preflightRefused && digest(contentState(observed)) === digest(contentState(expected)) &&
              (!requireReportedDuration || (!observed.durationUnderreported && observed.reportedDurationTicks === expected.durationTicks))) {
            entry.status = 'verified';
            entry.completedAt = new Date().toISOString();
            await this.persist(ledger);
            return entry;
          }
        } catch (e) { entry.inspectionError = e.message; }
        // Even an unchanged immediate readback cannot prove a timeout had no effect.
        if (preflightRefused || !error || Date.now() >= deadline) break;
        await sleep(Math.min(this.intervalMs, Math.max(1, deadline - Date.now())));
      } while (Date.now() <= deadline);
      if(preflightRefused&&entry.observed&&revision(entry.observed)===revision(before)&&entry.observed.reportedDurationTicks===before.reportedDurationTicks) {
        entry.status='refused';entry.completedAt=new Date().toISOString();await this.persist(ledger);
        throw new Error(`Edit ${operationId} refused before host mutation: ${error}`);
      }
      entry.status = 'indeterminate';
      await this.persist(ledger);
      throw new Error(`Edit ${operationId} is indeterminate; further mutations blocked. Inspect and reconcile its journal.`);
    } finally { await release(); }
  }
  async reconcile(operationId) {
    const release = await this.lock();
    try {
      const ledger = await this.ledger(), entry = ledger[operationId];
      if (!entry || !['dispatched', 'indeterminate'].includes(entry.status)) throw new Error('No uncertain operation with that ID');
      if(entry.kind==='ui_labels') throw new Error('Native label reconciliation requires saved-project label evidence');
      const observed = await this.inspect(entry.sequenceId);
      entry.observed = observed;
      if (digest(contentState(observed)) !== digest(contentState(entry.expected)) ||
          (entry.requireReportedDuration && (observed.durationUnderreported || observed.reportedDurationTicks !== entry.expected.durationTicks))) {
        await this.persist(ledger);
        throw new Error('Expected edit has not been proven; restore a verified snapshot before continuing');
      }
      entry.status = 'verified';
      entry.completedAt = new Date().toISOString();
      await this.persist(ledger);
      return entry;
    } finally { await release(); }
  }
  async keepRanges({ operationId, sequenceId, beforeRevision, ranges }) {
    let before = await this.inspect(sequenceId, { active: true, editable: true });
    if(revision(before)!==beforeRevision) throw new Error('Stale keep plan');
    const removals = removalRanges(before, ranges);
    if (removals.length > 50) throw new Error('Too many removal ranges for one verified transaction');
    // Ripple removal cannot create a cut when two kept performances touch.
    // Split their shared source boundary first, with independently verified IDs.
    const sorted=[...ranges].sort((a,b)=>BigInt(a.startTicks)<BigInt(b.startTicks)?-1:1);
    const joins=sorted.slice(1).filter((r,i)=>r.startTicks===sorted[i].endTicks).map(r=>r.startTicks);
    for(let offset=0;offset<joins.length;offset+=16) {
      const split=await this.cutBoundaries({operationId:`${operationId}-joins-${offset/16}`,sequenceId,beforeRevision:revision(before),cutTicks:joins.slice(offset,offset+16)});
      before=split.observed;
    }
    beforeRevision=revision(before);
    if (!removals.length) return { status: 'unchanged', sequence: before,observed:before };
    return this.mutate({ operationId, sequenceId, beforeRevision, expected: predictKeep(before, ranges), dispatch: async () => {
      const args = { sequence_id: sequenceId, ranges: removals, scope: 'sync_locked', range_content: 'delete', allow_large_ripple: true };
      const preview = await this.transport.call('ripple_remove_timeline_ranges', { ...args, dry_run: true });
      if (!preview.confirmationToken) throw new Error('Missing preview token');
      return this.transport.call('ripple_remove_timeline_ranges', { ...args, dry_run: false, confirmation_token: preview.confirmationToken });
    } });
  }
  async keepRangesBatched({operationId,sequenceId,beforeRevision,ranges,batchSize=24}) {
    if(!Number.isInteger(batchSize)||batchSize<1||batchSize>50)throw new Error('One to fifty removal ranges per batch required');
    let state=await this.inspect(sequenceId,{active:true,editable:true});
    if(revision(state)!==beforeRevision)throw new Error('Stale batched keep plan');
    const expected=predictKeep(state,ranges),removals=[];let end=0n;
    for(const r of ranges){const start=BigInt(r.startTicks);if(start>end)removals.push({startTicks:String(end),endTicks:String(start)});end=BigInt(r.endTicks);}
    if(end<BigInt(state.durationTicks))removals.push({startTicks:String(end),endTicks:state.durationTicks});
    if(removals.length<=50)return this.keepRanges({operationId,sequenceId,beforeRevision,ranges});
    const joins=ranges.slice(1).filter((r,i)=>r.startTicks===ranges[i].endTicks).map(r=>r.startTicks);
    for(let offset=0;offset<joins.length;offset+=16){const cut=await this.cutBoundaries({operationId:`${operationId}-joins-${offset/16}`,sequenceId,beforeRevision:revision(state),cutTicks:joins.slice(offset,offset+16)});state=cut.observed;}
    // Remove the latest source gaps first. Earlier source coordinates therefore
    // remain exact across batches; each host apply is verified before the next.
    removals.reverse();const entries=[];
    for(let offset=0;offset<removals.length;offset+=batchSize){
      const batch=removals.slice(offset,offset+batchSize).reverse(),keep=[];let cursor=0n;
      for(const gap of batch){const start=BigInt(gap.startTicks),finish=BigInt(gap.endTicks);if(start<cursor||finish>BigInt(state.durationTicks))throw new Error('Batched source gap changed');if(start>cursor)keep.push({startTicks:String(cursor),endTicks:String(start)});cursor=finish;}
      if(cursor<BigInt(state.durationTicks))keep.push({startTicks:String(cursor),endTicks:state.durationTicks});
      const entry=await this.keepRanges({operationId:`${operationId}-batch-${offset/batchSize}`,sequenceId,beforeRevision:revision(state),ranges:keep});state=entry.observed;entries.push(entry.operationId);
    }
    if(digest(contentState(state))!==digest(contentState(expected))||state.durationUnderreported||state.reportedDurationTicks!==expected.durationTicks)throw new Error('Final batched keep differs from the complete plan; inspect before continuing');
    return {status:'verified',observed:state,batches:entries};
  }
  async reorderBlocks({operationId,sequenceId,beforeRevision,ranges}) {
    const before=await this.inspect(sequenceId,{active:true,editable:true}), expected=predictReorder(before,ranges);
    if(revision(before)!==beforeRevision) throw new Error('Stale reorder plan');
    if(digest(contentState(before))===digest(contentState(expected))) return {status:'unchanged',observed:before};
    if(typeof this.transport.cloneReorder!=='function') throw new Error('Verified clone-and-remove reordering is unavailable; direct movement is disabled');
    const moves=[];
    let destination=0n;
    for(const r of ranges) {
      for(const track of before.tracks) for(const c of track.clips) {
        if(BigInt(c.startTicks)>=BigInt(r.startTicks)&&BigInt(c.endTicks)<=BigInt(r.endTicks)) moves.push({kind:track.kind,track:track.index,
          sourceId:c.sourceId,name:c.name,startTicks:c.startTicks,endTicks:c.endTicks,inTicks:c.inTicks,outTicks:c.outTicks,
          destinationTicks:String(destination+BigInt(c.startTicks)-BigInt(r.startTicks))});
      }
      destination+=BigInt(r.endTicks)-BigInt(r.startTicks);
    }
    return this.mutate({operationId,sequenceId,beforeRevision,expected,requireReportedDuration:true,dispatch:()=>this.transport.cloneReorder({
      projectPath:this.projectPath,sequenceId,frameTicks:before.frameTicks,moves})});
  }
  async updateMarkerText({operationId,sequenceId,beforeRevision,updates}) {
    if(!updates.length||updates.length>200) throw new Error('One to 200 marker text updates required');
    const before=await this.inspect(sequenceId,{active:true,editable:true}),expected=structuredClone(before);
    const used=new Set();
    for(const update of updates) {
      const index=expected.markers.findIndex(m=>digest(m)===digest(update.before));
      if(index<0||used.has(index)) throw new Error('Stale or repeated marker update');
      used.add(index);
      const {name,comments,...rest}=update.after, {name:oldName,comments:oldComments,...oldRest}=update.before;
      if(digest(rest)!==digest(oldRest)||typeof name!=='string'||name.length>255||typeof comments!=='string'||comments.length>2000) throw new Error('Only bounded marker name/comments may change');
      expected.markers[index]=update.after;
    }
    expected.markers.sort((a,b)=>BigInt(a.startTicks)<BigInt(b.startTicks)?-1:BigInt(a.startTicks)>BigInt(b.startTicks)?1:a.name.localeCompare(b.name));
    return this.mutate({operationId,sequenceId,beforeRevision,expected,dispatch:()=>this.transport.fixed('updateMarkerText',{
      projectPath:this.projectPath,sequenceId,updates})});
  }
}
