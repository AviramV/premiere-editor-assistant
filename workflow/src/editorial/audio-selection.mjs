import { digest } from '../premiere/state.mjs';

function quality(source) {
  const metrics = source.measurements;
  if (!metrics || !Number.isFinite(metrics.speechCoverage) || metrics.speechCoverage < 0 || metrics.speechCoverage > 1 ||
      !Number.isFinite(metrics.clippingFraction) || metrics.clippingFraction < 0 || metrics.clippingFraction > 1) return -Infinity;
  return metrics.speechCoverage * 100 + Math.min(40,metrics.speechNoiseContrastDb ?? 0) * 0.5 -
    Math.min(100,metrics.clippingFraction * 10000);
}

function confirmedDuplicate(a,b,evidence) {
  if (!a.performanceKey || a.performanceKey !== b.performanceKey ||
    a.role !== 'dialogue' || b.role !== 'dialogue' || a.roleConfidence < 0.8 || b.roleConfidence < 0.8) return false;
  return evidence.some(pair => ((pair.sourceA === a.id && pair.sourceB === b.id) ||
    (pair.sourceB === a.id && pair.sourceA === b.id)) && pair.correlation >= 0.75 && pair.noDistinctSpeaker === true);
}

export function chooseDialogueSources(segments, overrides = {}) {
  const decisions = [];
  for (const segment of segments) {
    if (!Number.isFinite(segment.start) || !Number.isFinite(segment.end) || segment.end <= segment.start) throw new Error('Invalid audio decision interval');
    const eligible = segment.sources.filter(source => source.role === 'dialogue' && source.roleConfidence >= 0.8 &&
      Number.isFinite(quality(source)) && source.coverageStart <= segment.start && source.coverageEnd >= segment.end)
      .sort((a,b) => quality(b)-quality(a));
    const override = overrides[segment.id];
    if (override && !segment.sources.some(s => s.id === override)) throw new Error('Audio override references an unknown source');
    const selected = override ? segment.sources.find(s=>s.id===override) : eligible[0];
    const selectionVerified = !!selected && eligible.includes(selected);
    const canDisableAlternatives = selectionVerified && selected.measurements.speechCoverage >= 0.95 && selected.measurements.clippingFraction <= 0.001;
    const disabled = [], preserved = [], issues = [];
    if (!selected) issues.push({ code:'no_verified_dialogue_source' });
    if (selected && !selectionVerified) issues.push({ code:'audio_override_requires_review', sourceId:selected.id });
    if (selected?.measurements?.speechCoverage < 0.95) issues.push({ code:'dialogue_dropout', sourceId:selected.id });
    if (selected?.measurements?.clippingFraction > 0.001) issues.push({ code:'dialogue_clipping', sourceId:selected.id });
    for (const source of segment.sources) {
      if (source.id === selected?.id) continue;
      if (canDisableAlternatives && confirmedDuplicate(selected,source,segment.duplicateEvidence || [])) disabled.push(source.id);
      else {
        preserved.push(source.id);
        if (source.role === 'dialogue' || source.role === 'unknown') issues.push({ code:'audio_overlap_requires_review', sourceId:source.id });
      }
    }
    decisions.push({ id:segment.id, start:segment.start, end:segment.end, selectedSourceId:selected?.id || null,
      selectedTrack:selected?.track ?? null, disabledSourceIds:disabled, preservedSourceIds:preserved,
      overrideApplied:!!override, selectionVerified, issues, scores:eligible.map(s=>({sourceId:s.id,score:quality(s)})),
      evidenceRevision:digest(segment) });
  }
  return { decisions, unresolved:decisions.filter(d=>d.issues.length),
    revision:digest({segments,overrides}) };
}

function fullyCovered(start,end,ranges) {
  let covered = start;
  for (const range of [...ranges].sort((a,b)=>a.start-b.start)) {
    if (range.start > covered + 0.00001) return false;
    if (range.end > covered) covered = range.end;
    if (covered >= end - 0.00001) return true;
  }
  return false;
}

export function audioTrackActions(tracks, segments, decisions) {
  const actions = [];
  for (const track of tracks) {
    if (!track.clips.length) { actions.push({track:track.index,action:'delete_empty',reason:'Track contains no clips'}); continue; }
    const everyClipRedundant = track.clips.every(clip => {
      const ranges = [];
      for (const segment of segments) {
        const decision = decisions.find(d=>d.id===segment.id);
        for (const source of segment.sources.filter(s=>s.track===track.index && s.clipId===clip.id)) {
          if (source.role !== 'dialogue' || !decision?.disabledSourceIds.includes(source.id)) return false;
          ranges.push({start:segment.start,end:segment.end});
        }
      }
      return fullyCovered(clip.start,clip.end,ranges);
    });
    actions.push({track:track.index,action:everyClipRedundant?'mute_redundant':'preserve_track',
      reason:everyClipRedundant?'Every recorded interval is verified redundant dialogue':'Recorded material includes unique, mixed, or unverified roles'});
  }
  return actions;
}
