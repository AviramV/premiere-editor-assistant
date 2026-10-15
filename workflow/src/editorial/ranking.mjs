export function technicalScore(take, audio) {
  const reasons = [];
  if (!take.automaticEligible) reasons.push('Script coverage or timing needs review');
  if (!audio) return { score: null, eligible: false, reasons: [...reasons, 'Audio measurements unavailable'] };
  const coverage = audio.speechCoverage ?? 0;
  const clipping = audio.clippingFraction ?? 1;
  if (coverage < 0.95) reasons.push('Microphone loses speech coverage');
  if (clipping > 0.001) reasons.push('Clipped audio samples');
  const contrast = Math.max(0,Math.min(40,audio.speechNoiseContrastDb ?? 0))/40;
  const score = 60*coverage + 20*contrast + 20*(take.meanConfidence ?? 0.5) - Math.min(40,clipping*10000);
  return { score, eligible: take.automaticEligible && coverage >= 0.95 && clipping <= 0.001, reasons };
}

export function rankPassage(takes, measurements, audiovisual = null, overrideTakeId = null) {
  if (!takes.length) return { selected: null, alternatives: [], confidence: 'missing', reasons: ['No candidate performance'], review: true };
  if (overrideTakeId && !takes.some(t => t.id === overrideTakeId)) throw new Error('Editor override references an unknown take');
  const ranked = takes.map(take => ({ take, technical: technicalScore(take, measurements[take.id]) }))
    .sort((a,b) => Number(b.technical.eligible)-Number(a.technical.eligible) || (b.technical.score ?? -Infinity)-(a.technical.score ?? -Infinity));
  const shortlist = ranked.filter(r => r.technical.eligible).slice(0,3);
  if (audiovisual) {
    const ids = new Set(shortlist.map(r => r.take.id));
    if (!ids.has(audiovisual.preferredTakeId) || !Array.isArray(audiovisual.comparisons) ||
      audiovisual.comparisons.some(c => !ids.has(c.takeId))) throw new Error('Audiovisual comparison references a non-shortlisted take');
  }
  const chosenId = overrideTakeId || audiovisual?.preferredTakeId || shortlist[0]?.take.id || null;
  const chosen = ranked.find(r => r.take.id === chosenId);
  return { selected: chosenId, shortlist: shortlist.map(r => r.take.id), alternatives: ranked.filter(r => r.take.id !== chosenId).map(r => ({
    takeId: r.take.id, technicalScore: r.technical.score, reasons: r.technical.reasons })),
    confidence: overrideTakeId ? 'editor_choice' : audiovisual?.confidence || (chosen ? 'technical_only' : 'review'),
    reasons: overrideTakeId ? ['Editor choice overrides automatic ranking'] : [
      ...(chosen?.technical.reasons || []), ...(audiovisual?.reasons || []), ...(!audiovisual ? ['Audiovisual delivery comparison unavailable; alternatives retained'] : [])],
    review: !overrideTakeId && (!chosen || !audiovisual || audiovisual.confidence !== 'high'),
    evidence: { ranked: ranked.map(r => ({ takeId: r.take.id, ...r.technical })), audiovisual } };
}
