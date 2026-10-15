import { createHash } from 'node:crypto';
import { secondsToTicks, ticksToSeconds } from '../core/timing.mjs';

export function digest(value) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }

export function unpack(result) {
  let data = result?.structuredContent?.data;
  if (data === undefined) {
    const text = result?.content?.find(c => c.type === 'text')?.text;
    try { data = JSON.parse(text); } catch { data = { message: text }; }
  }
  if (result?.isError || result?.structuredContent?.ok === false || data?.ok === false || data?.success === false) {
    const error = new Error(data?.error || data?.message || 'Premiere operation failed');
    error.hostResult = result;
    throw error;
  }
  return data;
}

export function normalizeSequence(raw) {
  if (!raw?.id || !raw.frameRate?.ticks) throw new Error('Missing exact sequence identity/timebase');
  if (raw.pagination?.truncated) throw new Error('Incomplete sequence inspection');
  const tracks = [];
  for (const kind of ['video', 'audio']) {
    for (const track of raw[`${kind}Tracks`] || []) {
      if (track.clipCount !== undefined && track.clipCount !== track.clips.length) throw new Error('Incomplete track inspection');
      tracks.push({ kind, index: track.index, name: track.name, muted: !!track.isMuted,
        locked: !!track.isLocked, clips: track.clips.map(c => ({
          instanceId: String(c.nodeId), sourceId: String(c.sourceNodeId), name: c.name,
          mediaPath: c.sourceMediaPath || '', offline: c.sourceOffline === true,
          startTicks: String(secondsToTicks(c.startSeconds)), endTicks: String(secondsToTicks(c.endSeconds)),
          inTicks: String(secondsToTicks(c.inPointSeconds)), outTicks: String(secondsToTicks(c.outPointSeconds)),
          enabled: c.enabled !== false, speed: c.speed ?? null, reversed: !!c.reversed,
          timeRemapped: (c.effects || []).some(name => /time.?remap/i.test(name)),
          label: c.label ?? null, multicam: c.multicam ?? null,
        })).sort((a,b)=>{
          for(const key of ['startTicks','endTicks','inTicks','outTicks']) {
            if(BigInt(a[key])!==BigInt(b[key])) return BigInt(a[key])<BigInt(b[key])?-1:1;
          }
          return a.sourceId.localeCompare(b.sourceId);
        }) });
    }
  }
  const reportedDurationTicks=secondsToTicks(raw.durationSeconds);
  const contentEnd=tracks.reduce((end,t)=>t.clips.reduce((n,c)=>BigInt(c.endTicks)>n?BigInt(c.endTicks):n,end),0n);
  // CEP can retain insertion order and a stale seq.end after TrackItem.move.
  // Never lose a moved clip by trusting that shorter reported duration. Keep
  // the discrepancy visible so export/reopen acceptance can check host caches.
  return { id: raw.id, name: raw.name, frameTicks: String(raw.frameRate.ticks),
    width: raw.width, height: raw.height, videoDisplayFormat: raw.videoDisplayFormat,
    durationTicks: String(contentEnd>reportedDurationTicks?contentEnd:reportedDurationTicks),
    reportedDurationTicks:String(reportedDurationTicks),durationUnderreported:contentEnd>reportedDurationTicks,tracks,
    markers: (raw.markers || []).map(m => ({ name: m.name || '', comments: m.comments || '',
      startTicks: String(secondsToTicks(m.startSeconds)), endTicks: String(secondsToTicks(m.endSeconds)),
      color: m.colorIndex ?? m.color ?? null })).sort((a,b) => BigInt(a.startTicks) < BigInt(b.startTicks) ? -1 : BigInt(a.startTicks) > BigInt(b.startTicks) ? 1 : a.name.localeCompare(b.name)) };
}

// Instance IDs change on reopening. Revision keys use actual placements and states;
// any executor resolves instance IDs from a fresh inspection immediately before use.
export function contentState(sequence) {
  return { frameTicks: sequence.frameTicks, width: sequence.width, height: sequence.height,
    videoDisplayFormat: sequence.videoDisplayFormat, durationTicks: sequence.durationTicks,
    markers: sequence.markers || [],
    tracks: sequence.tracks.map(t => ({ kind: t.kind, index: t.index, name: t.name,
      muted: t.muted, locked: t.locked, clips: t.clips.map(({ instanceId, ...c }) => c) })) };
}
export function revision(sequence) { return digest({ id: sequence.id, ...contentState(sequence) }); }

export function locateInstance(sequence, locator) {
  const track = sequence.tracks.find(t => t.kind === locator.kind && t.index === locator.track);
  const matches = (track?.clips || []).filter(c => c.sourceId === locator.sourceId &&
    c.startTicks === locator.startTicks && c.endTicks === locator.endTicks && c.inTicks === locator.inTicks);
  if (matches.length !== 1) throw new Error('Clip locator is stale or ambiguous');
  return matches[0];
}

export function ensureEditable(sequence) {
  for (const track of sequence.tracks) {
    if (track.locked && track.clips.length) throw new Error('Occupied locked track needs review');
    for (const clip of track.clips) {
      if (clip.offline) throw new Error(`Offline source: ${clip.name}`);
      if (clip.speed !== 1 || clip.reversed || clip.timeRemapped) throw new Error('Unsupported speed/time remapping');
      const duration = BigInt(clip.endTicks) - BigInt(clip.startTicks);
      const sourceDuration = BigInt(clip.outTicks) - BigInt(clip.inTicks);
      // 1 ns quantization in inspection values can differ by a few ticks.
      if (duration - sourceDuration > 512n || sourceDuration - duration > 512n) throw new Error('Source mapping has unequal durations');
    }
  }
}

export function predictCuts(sequence, cutTicks) {
  const next = structuredClone(sequence);
  const cuts = [...new Set(cutTicks.map(String))].map(BigInt).sort((a,b) => a < b ? -1 : a > b ? 1 : 0);
  for (const track of next.tracks) {
    track.clips = track.clips.flatMap(c => {
      const start = BigInt(c.startTicks), end = BigInt(c.endTicks);
      const boundaries = [start, ...cuts.filter(p => p > start && p < end), end];
      return boundaries.slice(0,-1).map((a,i) => ({ ...c, startTicks: String(a), endTicks: String(boundaries[i+1]),
        inTicks: String(BigInt(c.inTicks) + a - start), outTicks: String(BigInt(c.inTicks) + boundaries[i+1] - start) }));
    });
  }
  return next;
}

export function validateRanges(ranges, sequence) {
  let previous = 0n;
  for (const range of ranges) {
    const a = BigInt(range.startTicks), b = BigInt(range.endTicks);
    if (a < previous || a >= b || b > BigInt(sequence.durationTicks) ||
      a % BigInt(sequence.frameTicks) || b % BigInt(sequence.frameTicks)) throw new Error('Ranges must be ordered, disjoint and frame aligned');
    previous = b;
  }
}

export function predictKeep(sequence, ranges) {
  validateRanges(ranges, sequence);
  const next = structuredClone(sequence);
  for (const track of next.tracks) {
    let destination = 0n;
    track.clips = ranges.flatMap(range => {
      const a = BigInt(range.startTicks), b = BigInt(range.endTicks);
      const pieces = track.clips.flatMap(c => {
        const start = BigInt(c.startTicks), end = BigInt(c.endTicks);
        const left = start > a ? start : a, right = end < b ? end : b;
        if (right <= left) return [];
        return [{ ...c, startTicks: String(destination + left - a), endTicks: String(destination + right - a),
          inTicks: String(BigInt(c.inTicks) + left - start), outTicks: String(BigInt(c.inTicks) + right - start) }];
      });
      destination += b - a;
      return pieces;
    });
  }
  next.durationTicks = String(ranges.reduce((n,r) => n + BigInt(r.endTicks) - BigInt(r.startTicks), 0n));
  return next;
}

export function removalRanges(sequence, keep) {
  validateRanges(keep, sequence);
  let end = 0n;
  const result = [];
  for (const r of keep) {
    const start = BigInt(r.startTicks);
    if (start > end) result.push({ start: ticksToSeconds(end), end: ticksToSeconds(start) });
    end = BigInt(r.endTicks);
  }
  if (end < BigInt(sequence.durationTicks)) result.push({ start: ticksToSeconds(end), end: ticksToSeconds(sequence.durationTicks) });
  return result;
}

// The ranges cover the entire compacted sequence; their array order specifies
// the new order. No clip may straddle a block boundary or be duplicated.
export function predictReorder(sequence, ranges) {
  if (sequence.markers?.length) throw new Error('Reorder requires a marker-free sequence');
  const sorted=[...ranges].sort((a,b)=>BigInt(a.startTicks)<BigInt(b.startTicks)?-1:1);
  validateRanges(sorted,sequence);
  let cursor=0n;
  for(const r of sorted) {
    if(BigInt(r.startTicks)!==cursor) throw new Error('Reorder blocks must cover the entire sequence without gaps');
    cursor=BigInt(r.endTicks);
  }
  if(cursor!==BigInt(sequence.durationTicks)) throw new Error('Reorder blocks must cover the entire sequence without gaps');
  const next=structuredClone(sequence);
  for(const track of next.tracks) {
    let destination=0n;
    const mapped=ranges.flatMap(r=>{
      const a=BigInt(r.startTicks),b=BigInt(r.endTicks);
      const pieces=track.clips.filter(c=>BigInt(c.startTicks)<b&&BigInt(c.endTicks)>a).map(c=>{
        if(BigInt(c.startTicks)<a||BigInt(c.endTicks)>b) throw new Error('Clip straddles a reorder boundary');
        return {...c,startTicks:String(destination+BigInt(c.startTicks)-a),endTicks:String(destination+BigInt(c.endTicks)-a)};
      });
      destination+=b-a;return pieces;
    });
    if(mapped.length!==track.clips.length) throw new Error('Reorder loses or repeats a clip');
    track.clips=mapped.sort((a,b)=>BigInt(a.startTicks)<BigInt(b.startTicks)?-1:1);
  }
  return next;
}
