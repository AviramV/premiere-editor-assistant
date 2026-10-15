// Called only by the fixed, project-owned UXP bridge operation. No eval or
// arbitrary command input. Partial transactions are never retried.
async function guardedReorder(ppro,params) {
  const {projectPath,sequenceId,moves,frameTicks}=params;
  if(!projectPath||!sequenceId||!Array.isArray(moves)||!moves.length||moves.length>600) throw new Error('Exact bounded reorder target required');
  if(params.deferFinalShift!==undefined&&typeof params.deferFinalShift!=='boolean')throw new Error('Invalid final shift mode');
  const step=params.step;
  if(step!==undefined&&(!Number.isInteger(step)||step<0||step>119||params.deferFinalShift!==true))throw new Error('Invalid reorder checkpoint');
  const frame=BigInt(frameTicks);
  if(frame<=0n) throw new Error('A positive frame grid is required');
  const project=await ppro.Project.getActiveProject();
  if(!project||project.path!==projectPath) throw new Error('Wrong project or active sequence');
  const sequence=await project.getActiveSequence();
  if(!sequence||String(sequence.guid)!==sequenceId) throw new Error('Wrong project or active sequence');
  const tracks=[];
  for(const kind of ['video','audio']) {
    const count=await sequence[kind==='video'?'getVideoTrackCount':'getAudioTrackCount']();
    for(let index=0;index<count;index++) tracks.push({kind,index,track:await sequence[kind==='video'?'getVideoTrack':'getAudioTrack'](index)});
  }
  const read=async()=>{
    const rows=[];
    for(const t of tracks) {
      t.track=await sequence[t.kind==='video'?'getVideoTrack':'getAudioTrack'](t.index);
      const count=(t.track.getTrackItems(ppro.Constants.TrackItemType.CLIP,false)||[]).length;
      for(let itemIndex=0;itemIndex<count;itemIndex++) {
        // Do not retain the whole native item list across asynchronous reads.
        const items=t.track.getTrackItems(ppro.Constants.TrackItemType.CLIP,false)||[];
        if(items.length!==count)throw new Error('Clip count changed during readback');
        const item=items[itemIndex];if(!item)continue;
        const tick=promise=>Promise.resolve(promise).then(time=>String(time.ticks));
        const [startTicks,endTicks,inTicks,outTicks,name,sourceUid]=await Promise.all([
          tick(item.getStartTime()),tick(item.getEndTime()),tick(item.getInPoint()),tick(item.getOutPoint()),
          item.getName(),Promise.resolve(item.getProjectItem()).then(pi=>String(pi.getId()))]);
        rows.push({kind:t.kind,index:t.index,itemIndex,name,sourceUid,startTicks,endTicks,inTicks,outTicks});
      }
    }
    return rows;
  };
  const near=(a,b)=>{const d=BigInt(a)-BigInt(b);return d>=-512n&&d<=512n;};
  const match=(row,m,start)=>row.kind===m.kind&&row.index===m.track&&row.sourceUid===m.sourceUid&&row.name===m.name&&
    near(row.startTicks,start)&&near(row.endTicks,BigInt(start)+BigInt(m.endTicks)-BigInt(m.startTicks))&&near(row.inTicks,m.inTicks)&&near(row.outTicks,m.outTicks);
  const readVerified=async (predicate,phase)=>{
    let lastError;
    for(let attempt=0;attempt<10;attempt++) {
      try {const rows=await read();if(predicate(rows))return rows;lastError=null;}
      catch(error) {
        if(!['The script object is no longer valid','Clip count changed during readback'].some(message=>String(error.message).includes(message)))throw new Error(`${phase}: ${error.message}`);
        lastError=error;
      }
      if(attempt<9)await new Promise(resolve=>setTimeout(resolve,50));
    }
    throw new Error(`${phase}: ${lastError?.message||'Transaction readback unverified'}; inspect before another mutation`);
  };
  let before=await readVerified(()=>true,'initial native readback');
  if(step===undefined&&before.length!==moves.length) throw new Error('Clip count changed before reorder');
  const selected=new Set(),originals=[];
  let contentEnd=0n;
  for(const m of moves) {
    const start=BigInt(m.startTicks),end=BigInt(m.endTicks),destination=BigInt(m.destinationTicks);
    if(start<0n||end<=start||destination<0n||start%frame||end%frame||destination%frame) throw new Error('Invalid frame-aligned reorder move');
    if(BigInt(m.inTicks)<0n||!near(BigInt(m.outTicks)-BigInt(m.inTicks),end-start)) throw new Error('Unsupported source-clock mapping');
    const matches=before.filter(row=>match(row,m,start));
    const key=matches.length===1?`${m.kind}:${m.track}:${matches[0].itemIndex}`:null;
    if((step===undefined&&matches.length!==1)||matches.length>1||(key&&selected.has(key))) throw new Error('Stale or ambiguous reorder source');
    originals.push(matches[0]);if(key)selected.add(key);if(end>contentEnd)contentEnd=end;
  }
  // Reject any overlapping destinations before constructing the first action.
  for(const t of tracks) {
    const ranges=moves.filter(m=>m.kind===t.kind&&m.track===t.index).map(m=>({start:BigInt(m.destinationTicks),end:BigInt(m.destinationTicks)+BigInt(m.endTicks)-BigInt(m.startTicks)})).sort((a,b)=>a.start<b.start?-1:1);
    for(let i=1;i<ranges.length;i++) if(ranges[i].start<ranges[i-1].end) throw new Error('Reorder destinations overlap');
  }
  const park=contentEnd+frame*10n;
  const commit=async(build,label,expectedRows)=>{try{
    const freshProject=await ppro.Project.getActiveProject();
    if(!freshProject||freshProject.path!==projectPath)throw new Error('Native project handle changed');
    const freshSequence=await freshProject.getActiveSequence();
    if(!freshSequence||String(freshSequence.guid)!==sequenceId)throw new Error('Native sequence handle changed');
    const actionTracks=await Promise.all(tracks.map(async t=>({...t,track:await freshSequence[t.kind==='video'?'getVideoTrack':'getAudioTrack'](t.index)})));
    freshProject.lockedAccess(()=>{
    // Native editor/items expire across awaits. Read only their slots outside
    // the lock, then acquire fresh native objects here for action construction.
    const editor={
      createCloneTrackItemAction:(...args)=>ppro.SequenceEditor.getEditor(freshSequence).createCloneTrackItemAction(...args),
      createRemoveItemsAction:(...args)=>ppro.SequenceEditor.getEditor(freshSequence).createRemoveItemsAction(...args)
    };
    const key=t=>`${t.kind}:${t.index}`;
    const items=new Map(actionTracks.map(t=>[key(t),t.track.getTrackItems(ppro.Constants.TrackItemType.CLIP,false)||[]]));
    if(project.path!==projectPath||tracks.some(t=>items.get(key(t)).filter(Boolean).length!==expectedRows.filter(row=>key(row)===key(t)).length))throw new Error('Native clip slots changed before transaction');
    const itemAt=row=>{
      // A native action constructor can invalidate sibling wrappers returned
      // by a previous getTrackItems call, even while the project is locked.
      // Reacquire this one wrapper immediately before consuming it.
      const track=actionTracks.find(t=>key(t)===key(row));
      const freshItems=track.track.getTrackItems(ppro.Constants.TrackItemType.CLIP,false)||[];
      if(freshItems.filter(Boolean).length!==expectedRows.filter(r=>key(r)===key(row)).length)throw new Error('Native clip slots changed before action');
      const item=freshItems[row.itemIndex];if(!item)throw new Error('Native clip slot changed');return item;
    };
    const apply=actions=>{
      // Build every action before opening the transaction; the host does not
      // roll back actions added before a later constructor throws.
      if(freshProject.executeTransaction(tx=>{for(const action of actions)tx.addAction(action);},label)===false)throw new Error('Native transaction refused');
    };
    build({editor,itemAt,apply});
  });}catch(error){throw new Error(`${label}: ${error.message}`);}};
  const ordered=moves.map((m,i)=>({m,row:originals[i]})).sort((a,b)=>BigInt(a.m.destinationTicks)<BigInt(b.m.destinationTicks)?-1:1);
  // Premiere accepted 127 actions but partially committed before refusing the
  // 128th in live acceptance. Whole synchronized groups fit bounded batches.
  const batches=[];let batch=[],group=[],key;
  const append=()=>{if(!group.length)return;if(group.length>48)throw new Error('Synchronized group exceeds action bound');if(batch.length+group.length>48){batches.push(batch);batch=[];}batch.push(...group);group=[];};
  for(const pair of ordered){const k=pair.m.destinationTicks;if(key!==undefined&&key!==k)append();group.push(pair);key=k;}append();if(batch.length)batches.push(batch);
  if(step!==undefined) {
    const totalSteps=batches.length*2;
    if(step>=totalSteps)throw new Error('Checkpoint exceeds this exact plan');
    const cloning=step<batches.length,batchIndex=cloning?step:step-batches.length;
    const prior=batches.slice(0,batchIndex).flat().map(p=>p.m),all=batches.flat().map(p=>p.m);
    const presentOriginals=cloning?all:all.filter(m=>!prior.includes(m));
    const presentClones=cloning?prior:all;
    const valid=rows=>rows.length===presentOriginals.length+presentClones.length&&presentOriginals.every(m=>rows.filter(row=>match(row,m,m.startTicks)).length===1)&&presentClones.every(m=>rows.filter(row=>match(row,m,park+BigInt(m.destinationTicks))).length===1);
    if(!valid(before))before=await readVerified(valid,'Native checkpoint state differs from the exact prior result');
    const batch=batches[batchIndex];
    if(cloning) {
      const fresh=batch.map(({m})=>({m,row:before.find(row=>match(row,m,m.startTicks))}));
      await commit(({editor,itemAt,apply})=>apply(fresh.map(({m,row})=>editor.createCloneTrackItemAction(itemAt(row),ppro.TickTime.createWithTicks(String(park+BigInt(m.destinationTicks)-BigInt(m.startTicks))),0,0,m.kind==='video',false))),'assistant: clone checkpoint',before);
      presentClones.push(...batch.map(p=>p.m));
    } else {
      const rows=batch.map(({m})=>before.find(row=>match(row,m,m.startTicks)));
      await commit(({editor,itemAt,apply})=>{let applied=false;ppro.TrackItemSelection.createEmptySelection(selection=>{
        for(const row of rows)if(selection.addItem(itemAt(row),true)===false)throw new Error('Native selection refused');
        apply([editor.createRemoveItemsAction(selection,false,ppro.Constants.MediaType.ANY,false)]);applied=true;
      });if(!applied)throw new Error('Native selection unavailable');},'assistant: remove checkpoint',before);
      for(const {m} of batch)presentOriginals.splice(presentOriginals.indexOf(m),1);
    }
    await readVerified(valid,'checkpoint readback');
    const parked=step===totalSteps-1;
    return {ok:true,verified:true,checkpoint:true,completedStep:step,nextStep:step+1,totalSteps,parked,parkTicks:String(park),sequenceId,cloned:parked?moves.length:presentClones.length,reportedDurationTicks:String((await sequence.getEndTime()).ticks)};
  }
  let current=before,cloned=[];
  for(const batch of batches){
    const fresh=batch.map(({m})=>({m,row:current.find(row=>match(row,m,m.startTicks))}));
    await commit(({editor,itemAt,apply})=>apply(fresh.map(({m,row})=>editor.createCloneTrackItemAction(itemAt(row),
      ppro.TickTime.createWithTicks(String(park+BigInt(m.destinationTicks)-BigInt(m.startTicks))),0,0,m.kind==='video',false))),'assistant: clone clips in script order',current);
    cloned.push(...batch.map(p=>p.m));
    current=await readVerified(rows=>rows.length===before.length+cloned.length&&moves.every(m=>rows.filter(row=>match(row,m,m.startTicks)).length===1)&&cloned.every(m=>rows.filter(row=>match(row,m,park+BigInt(m.destinationTicks))).length===1),'clone readback');
  }
  let removed=[];
  for(const batch of batches){
    const originals=batch.map(({m})=>current.find(row=>match(row,m,m.startTicks)));
    await commit(({editor,itemAt,apply})=>{let applied=false;ppro.TrackItemSelection.createEmptySelection(selection=>{
      for(const row of originals)if(selection.addItem(itemAt(row),true)===false)throw new Error('Native selection refused');
      apply([editor.createRemoveItemsAction(selection,false,ppro.Constants.MediaType.ANY,false)]);applied=true;
    });if(!applied)throw new Error('Native selection unavailable');},'assistant: remove duplicated originals without ripple',current);
    removed.push(...batch.map(p=>p.m));const remaining=moves.filter(m=>!removed.includes(m));
    current=await readVerified(rows=>rows.length===moves.length+remaining.length&&moves.every(m=>rows.filter(row=>match(row,m,park+BigInt(m.destinationTicks))).length===1)&&remaining.every(m=>rows.filter(row=>match(row,m,m.startTicks)).length===1),'removal readback');
  }
  if(params.deferFinalShift===true)return {ok:true,verified:true,parked:true,parkTicks:String(park),sequenceId,cloned:moves.length,reportedDurationTicks:String((await sequence.getEndTime()).ticks)};
  if(params.deferFinalShift!==undefined&&params.deferFinalShift!==false)throw new Error('Invalid final shift mode');
  let shifted=[];
  for(const batch of batches){
    const rows=batch.map(({m})=>current.find(row=>match(row,m,park+BigInt(m.destinationTicks))));
    await commit(({itemAt,apply})=>apply(rows.map(row=>itemAt(row).createMoveAction(ppro.TickTime.createWithTicks(String(-park))))),'assistant: shift ordered clones to origin',current);
    shifted.push(...batch.map(p=>p.m));const remaining=moves.filter(m=>!shifted.includes(m));
    current=await readVerified(rows=>rows.length===moves.length&&shifted.every(m=>rows.filter(row=>match(row,m,m.destinationTicks)).length===1)&&remaining.every(m=>rows.filter(row=>match(row,m,park+BigInt(m.destinationTicks))).length===1),'shift readback');
  }

  return {ok:true,verified:true,sequenceId,cloned:moves.length,reportedDurationTicks:String((await sequence.getEndTime()).ticks)};
}
module.exports={guardedReorder};
