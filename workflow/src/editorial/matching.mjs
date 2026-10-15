import { digest } from '../premiere/state.mjs';
import { tokens, protectedIssues } from './script.mjs';

const weak = new Set('a an the i my you your me we our it is are in on to and but so this that there with for of'.split(' '));
const weight = token => weak.has(token) ? 0.35 : 1;
const aliases = new Map([['shop','store'], ['picture','photo'], ['reserve','book'], ['create','generate']]);
const canonical = token => aliases.get(token) || token;

function tokenTimeline(words) {
  return words.flatMap((word, index) => tokens(word.text).map(token => ({ token, wordIndex: index })));
}

// Local alignment proposes spans. Meaning/claims are assessed separately; a high
// lexical score alone is never declared proof that a paraphrase is acceptable.
export function lexicalCandidates(passage, transcript) {
  const spoken = tokenTimeline(transcript.words), result = [];
  for (const variant of [passage.text, ...(passage.variants || [])]) {
    const target = tokens(variant), m = target.length, n = spoken.length, stride = n + 1;
    const scores = new Float32Array((m + 1) * stride), moves = new Uint8Array(scores.length);
    const maximum = target.reduce((sum,t) => sum + 2 * weight(t), 0);
    for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) {
      const equal = canonical(target[i-1]) === canonical(spoken[j-1].token);
      const options = [0, scores[(i-1)*stride+j-1] + (equal ? 2 * weight(target[i-1]) : -0.8),
        scores[(i-1)*stride+j] - 0.8 * weight(target[i-1]), scores[i*stride+j-1] - 0.55];
      const best = Math.max(...options);
      scores[i*stride+j] = best; moves[i*stride+j] = options.indexOf(best);
    }
    for (let j = 1; j <= n; j++) {
      let row = 1;
      for (let i = 2; i <= m; i++) if (scores[i*stride+j] > scores[row*stride+j]) row = i;
      const score = scores[row*stride+j];
      if (score < Math.max(3, maximum * 0.32)) continue;
      // End at a spoken match, not at arbitrary trailing filler.
      if (moves[row*stride+j] !== 1 || canonical(target[row-1]) !== canonical(spoken[j-1].token)) continue;
      let i = row, k = j, matched = [], consumed = [];
      while (i > 0 && k > 0 && scores[i*stride+k] > 0) {
        const move = moves[i*stride+k];
        if (move === 1) {
          if (canonical(target[i-1]) === canonical(spoken[k-1].token)) matched.push(i-1);
          consumed.push(k-1); i--; k--;
        } else if (move === 2) i--;
        else if (move === 3) { consumed.push(k-1); k--; }
        else break;
      }
      if (!consumed.length) continue;
      const first = spoken[Math.min(...consumed)].wordIndex, last = spoken[j-1].wordIndex;
      const duration = transcript.words[last].end - transcript.words[first].start;
      if (duration > Math.max(12, m * 1.5) || last - first + 1 > m * 2.2 + 4) continue;
      const matchedWeight = [...new Set(matched)].reduce((sum,index) => sum + weight(target[index]), 0);
      const coverage = matchedWeight / target.reduce((sum,t) => sum + weight(t), 0);
      if (coverage < 0.35) continue;
      result.push({ passageId: passage.id, firstWord: first, lastWord: last, start: transcript.words[first].start,
        end: transcript.words[last].end, text: transcript.words.slice(first,last+1).map(w => w.text).join(' '),
        lexicalCoverage: coverage, lexicalScore: score / maximum, targetStartToken: Math.min(...matched),
        targetEndToken: Math.max(...matched), retrieval: 'alignment', variant });
    }
  }
  return suppressOverlaps(result);
}

export function suppressOverlaps(candidates) {
  const accepted = [];
  for (const candidate of [...candidates].sort((a,b) => (b.lexicalCoverage ?? b.semantic?.similarity ?? 0) - (a.lexicalCoverage ?? a.semantic?.similarity ?? 0))) {
    if (accepted.some(prior => {
      const intersection = Math.max(0, Math.min(prior.end,candidate.end) - Math.max(prior.start,candidate.start));
      return intersection / Math.max(0.001, Math.min(prior.end-prior.start,candidate.end-candidate.start)) > 0.5;
    })) continue;
    accepted.push(candidate);
  }
  return accepted.sort((a,b) => a.start - b.start);
}

// Sentence groups and overlapping windows provide proposals when wording has
// little lexical overlap. Pauses guide proposals, never establish take identity.
export function semanticWindows(transcript) {
  const words = transcript.words, sentences = [];
  let first = 0;
  for (let i = 0; i < words.length; i++) {
    if (/[.!?]$/.test(words[i].text) || i === words.length-1 || (words[i+1].start - words[i].end > 2.5)) {
      sentences.push({ first, last: i }); first = i + 1;
    }
  }
  const windows = [];
  for (let i = 0; i < sentences.length; i++) for (let count = 1; count <= 5 && i + count <= sentences.length; count++) {
    const a = sentences[i].first, b = sentences[i+count-1].last;
    if (b - a > 80 || words[b].end - words[a].start > 45) break;
    if (count > 1 && words[sentences[i+count-1].first].start - words[sentences[i+count-2].last].end > 2.5) break;
    windows.push({ firstWord: a, lastWord: b, start: words[a].start, end: words[b].end,
      text: words.slice(a,b+1).map(w => w.text).join(' '), retrieval: 'semantic_window', boundaryReview: true });
  }
  return windows;
}

export function classifyCandidate(passage, transcript, candidate, semantic = null) {
  const issues = protectedIssues(passage, candidate.text);
  // Entailment can stay high when a failed performance contains all the right
  // words around a restart or a crew interruption. Keep that evidence separate
  // from script coverage so a semantically complete blooper is never selected.
  const interruption = /\b(?:sorry|whatever|shit|fuck|one more|start again|hold on|let me try|take again)\b/gi;
  const allowed = [passage.text, ...(passage.variants || [])].join(' ').toLowerCase();
  const cues = [...String(candidate.text).matchAll(interruption)].map(match => match[0].toLowerCase()).filter(cue => !allowed.includes(cue));
  if (cues.length) issues.push({ code: 'restart_or_interruption', cues: [...new Set(cues)] });
  const selectedWords = transcript.words.slice(candidate.firstWord, candidate.lastWord + 1);
  const pauses = selectedWords.slice(1).flatMap((word, i) => word.start - selectedWords[i].end > 1.8
    ? [{ afterWord: candidate.firstWord + i, seconds: word.start - selectedWords[i].end }] : []);
  if (pauses.length) issues.push({ code: 'internal_pause_requires_review', pauses });
  const timingIssues = transcript.issues.filter(issue => issue.wordIndex >= candidate.firstWord && issue.wordIndex <= candidate.lastWord);
  if (timingIssues.length) issues.push({ code: 'word_timing_requires_review', indices: timingIssues.map(issue => issue.wordIndex) });
  const exact = tokens(candidate.text).join(' ') === tokens(candidate.variant || passage.text).join(' ');
  if (semantic?.contradiction > 0.55) issues.push({ code: 'possible_claim_contradiction', probability: semantic.contradiction });
  const meaningCovered = exact || (semantic?.entailment >= 0.72 && semantic.similarity >= 0.7);
  const partial = !meaningCovered && (candidate.lexicalCoverage || 0) < 0.85;
  if (!exact && !semantic) issues.push({ code: 'semantic_assessment_missing' });
  if (candidate.boundaryReview) issues.push({ code: 'performance_boundaries_require_review' });
  if (!meaningCovered && !partial) issues.push({ code: 'script_meaning_requires_review' });
  return { ...candidate, semantic, exact, coverageStatus: meaningCovered ? 'covered' : partial ? 'partial' : 'uncertain',
    issues, automaticEligible: meaningCovered && issues.length === 0 };
}

export function identifyTakes(script, transcript, semanticResults = []) {
  const takes = [], coverage = [];
  for (const passage of script.passages) {
    const semanticForPassage = semanticResults.filter(c => c.passageId === passage.id);
    const lexical = lexicalCandidates(passage, transcript).map(candidate => {
      const evidence = semanticForPassage.find(c => c.firstWord === candidate.firstWord && c.lastWord === candidate.lastWord);
      return classifyCandidate(passage, transcript, candidate, evidence?.semantic);
    });
    const additional = semanticForPassage.filter(c => c.retrieval === 'semantic_window' && c.semantic.similarity >= 0.7)
      .map(c => classifyCandidate(passage, transcript, c, c.semantic));
    const candidates = suppressOverlaps([...lexical, ...additional]);
    candidates.forEach((c,index) => takes.push({ ...c, takeNumber: index+1, id: `${passage.id}-T${String(index+1).padStart(2,'0')}`,
      performanceKey: digest({ sourceRevision: transcript.sourceRevision, first: c.firstWord, last: c.lastWord }),
      transcriptRevision: transcript.revision, sourceRevision: transcript.sourceRevision,
      meanConfidence: transcript.words.slice(c.firstWord,c.lastWord+1).reduce((n,w) => n + (w.confidence ?? 0.5), 0)/(c.lastWord-c.firstWord+1) }));
    coverage.push({ passageId: passage.id, candidates: candidates.length,
      status: candidates.some(c => c.automaticEligible) ? 'covered' : candidates.length ? 'review' : 'missing' });
  }
  return { schemaVersion: 1, scriptRevision: script.revision, transcriptRevision: transcript.revision,
    takes, coverage, unresolved: coverage.filter(c => c.status !== 'covered') };
}
