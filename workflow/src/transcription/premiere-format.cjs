// Shared by Node and the fixed UXP bridge; no host or filesystem dependencies.
// Format: AdobeDocs/uxp-premiere-pro-samples, assets/transcript_format_spec.json.
const languages = new Set('en-us en-gb zh-hk cmn-hans cmn-hant es-es de-de fr-fr ja-jp pt-pt pt-br ko-kr it-it ru-ru hi-in nb-no sv-se nl-nl da-dk id-id th-th vi-vn ms-my tr-tr pl-pl fil-ph te-in ml-in pa-in ??-??'.split(' '));

function toPremiereTranscript(transcript) {
  const {words, sourceStart, duration} = transcript;
  if (!Array.isArray(words) || !words.length || words.length > 50000 ||
      !Number.isFinite(sourceStart) || sourceStart < 0 || !Number.isFinite(duration) || duration <= 0) {
    throw new Error('A bounded, source-timed transcript is required');
  }
  let language = String(transcript.language || 'en').toLowerCase().replace('_', '-');
  if (language === 'en') language = 'en-us';
  if (!languages.has(language)) language = '??-??';
  const speakers = [], speakerIds = new Map(), segments = [];
  for (const [index, word] of words.entries()) {
    if (typeof word.text !== 'string' || !word.text.trim() || !Number.isFinite(word.start) || !Number.isFinite(word.end) ||
        word.start < sourceStart || word.end < word.start || word.end > sourceStart + duration + 0.04 ||
        (index && word.start < words[index - 1].start)) throw new Error(`Invalid source word ${index}`);
    const key = word.speaker == null ? null : String(word.speaker);
    if (!speakerIds.has(key)) {
      // Stable UUID-shaped local speaker references make repeated exports identical.
      const id = `00000000-0000-4000-8000-${(speakers.length + 1).toString(16).padStart(12, '0')}`;
      speakerIds.set(key, id);
      speakers.push({id, name: key === null ? 'Main voice' : `Speaker ${key}`});
    }
    const speaker = speakerIds.get(key), previous = words[index - 1];
    if (!segments.length || segments.at(-1).speaker !== speaker ||
        word.start - previous.end > 0.8 || /[.!?]["')\]]?$/.test(previous.text)) {
      segments.push({start: word.start, duration: 0, language, speaker, words: []});
    }
    const segment = segments.at(-1);
    segment.words.push({text: word.text, start: word.start, duration: word.end - word.start,
      confidence: Number.isFinite(word.confidence) ? Math.max(0, Math.min(1, word.confidence)) : 0,
      eos: /[.!?]["')\]]?$/.test(word.text), tags: [], type: 'word'});
    segment.duration = Math.max(segment.duration, word.end - segment.start);
  }
  return {language, segments, speakers};
}

function transcriptWords(value) {
  if (typeof value === 'string') value = JSON.parse(value);
  if (!value || !Array.isArray(value.segments)) throw new Error('Native transcript JSON has no segments');
  return value.segments.flatMap(segment => {
    if (!Array.isArray(segment.words)) throw new Error('Native transcript segment has no words');
    return segment.words.filter(word => word.type !== 'punctuation');
  });
}

function sameTranscript(actual, expected) {
  try {
    const a = transcriptWords(actual), b = transcriptWords(expected);
    return a.length === b.length && b.length > 0 && a.every((word, index) => {
      const other = b[index];
      return word.text === other.text && Number.isFinite(word.start) && Number.isFinite(word.duration) &&
        Math.abs(word.start - other.start) <= 0.001 && Math.abs(word.duration - other.duration) <= 0.001;
    });
  } catch { return false; }
}

module.exports = {toPremiereTranscript, transcriptWords, sameTranscript};
