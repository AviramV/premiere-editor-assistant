import { digest } from '../premiere/state.mjs';
import { sourceToTimeline, ticksToSeconds, snapTicks, secondsToTicks } from '../core/timing.mjs';

export const WORD_BOUNDARY_VERSION = 3;

export function normalizeTranscript(raw, { provider, sourceRevision, sourceStart = 0, duration, channel = 0 }) {
  if (!sourceRevision || !Number.isFinite(duration) || duration <= 0) throw new Error('Transcript source revision and duration required');
  const candidates = Array.isArray(raw.words) ? raw.words : (raw.segments || []).flatMap(s => s.words || []);
  const words = candidates.filter(w => !w.type || w.type === 'word').map(w => ({
    text: String(w.word ?? w.text ?? '').trim(), start: Number(w.start) + sourceStart, end: Number(w.end) + sourceStart,
    confidence: w.probability ?? (Number.isFinite(w.logprob) ? Math.exp(w.logprob) : null), speaker: w.speaker_id ?? null, channel,
  })).filter(w => w.text);
  if (!words.length) throw new Error('Transcript has no timed words');
  const issues = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (!Number.isFinite(w.start) || !Number.isFinite(w.end) || w.start < sourceStart - 0.001 ||
      w.end > sourceStart + duration + 0.04 || w.end < w.start) throw new Error(`Invalid word timing at ${i}`);
    if (i && (w.start < words[i-1].start || w.start < words[i-1].end - 0.02)) throw new Error(`Overlapping or unordered word timing at ${i}`);
    if (w.end === w.start) issues.push({ wordIndex: i, code: 'collapsed_word_timing', text: w.text });
  }
  return { schemaVersion: 1, provider, sourceRevision, sourceStart, duration, channel, language: raw.language_code || raw.language || 'en',
    words, text: words.map(w => w.text).join(' '), issues,
    revision: digest({ provider, sourceRevision, sourceStart, duration, channel, words }) };
}

export function wordInterval(transcript, first, last, placement, frameTicks, handlesFrames = 4) {
  if (!Number.isInteger(first) || !Number.isInteger(last) || first < 0 || last < first || last >= transcript.words.length) throw new Error('Invalid word selection');
  const {headFrames,tailFrames}=typeof handlesFrames==='number'?{headFrames:handlesFrames,tailFrames:handlesFrames}:handlesFrames||{};
  if (![headFrames,tailFrames].every(n=>Number.isInteger(n)&&n>=0&&n<=50)) throw new Error('Zero to fifty head and tail handle frames required');
  if (transcript.issues.some(issue => issue.wordIndex >= first && issue.wordIndex <= last)) throw new Error('Selected word timing requires review');
  const frame = BigInt(frameTicks), head = frame * BigInt(headFrames), tail = frame * BigInt(tailFrames);
  const start = sourceToTimeline(transcript.words[first].start, placement);
  const end = sourceToTimeline(transcript.words[last].end, placement);
  const wordStart = snapTicks(start, frame, 'floor'), wordEnd = snapTicks(end, frame, 'ceil');
  let minimum = snapTicks(placement.startTicks, frame, 'ceil');
  let maximum = snapTicks(placement.endTicks, frame, 'floor');
  const previous = transcript.words[first - 1], next = transcript.words[last + 1];
  const inPoint = BigInt(placement.inTicks), outPoint = BigInt(placement.outTicks);
  if (previous && secondsToTicks(previous.end) >= inPoint) {
    const boundary = sourceToTimeline(previous.end, placement);
    if (transcript.issues.some(i => i.wordIndex === first - 1) && boundary >= start - head) throw new Error('Neighboring word timing requires review');
    const safe = snapTicks(boundary, frame, 'ceil');
    if (safe > minimum) minimum = safe;
  }
  if (next && secondsToTicks(next.start) <= outPoint) {
    const boundary = sourceToTimeline(next.start, placement);
    if (transcript.issues.some(i => i.wordIndex === last + 1) && boundary <= end + tail) throw new Error('Neighboring word timing requires review');
    const safe = snapTicks(boundary, frame, 'floor');
    if (safe < maximum) maximum = safe;
  }
  // Rounding must preserve the complete selected words while staying outside
  // neighboring speech. An indivisible frame requires review, never a cut.
  if (minimum > wordStart || maximum < wordEnd) throw new Error('No safe frame between neighboring words; boundary requires review');
  const requestedStart = snapTicks(start > head ? start - head : 0n, frame, 'floor');
  const requestedEnd = snapTicks(end + tail, frame, 'ceil');
  const a = requestedStart > minimum ? requestedStart : minimum;
  const b = requestedEnd < maximum ? requestedEnd : maximum;
  if (a >= b) throw new Error('Empty or reversed word interval');
  return { startTicks: String(a), endTicks: String(b), start: ticksToSeconds(a), end: ticksToSeconds(b) };
}
