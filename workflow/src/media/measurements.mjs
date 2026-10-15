import { readFile } from 'node:fs/promises';

export async function readMonoWav(filename) {
  const buffer = await readFile(filename);
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') throw new Error('PCM WAV required');
  let format, samples;
  for (let offset = 12; offset + 8 <= buffer.length;) {
    const kind = buffer.toString('ascii', offset, offset + 4), size = buffer.readUInt32LE(offset + 4), data = offset + 8;
    if (data + size > buffer.length) throw new Error('Truncated WAV chunk');
    if (kind === 'fmt ') format = { codec: buffer.readUInt16LE(data), channels: buffer.readUInt16LE(data+2),
      rate: buffer.readUInt32LE(data+4), bits: buffer.readUInt16LE(data+14) };
    if (kind === 'data') samples = buffer.subarray(data, data+size);
    offset = data + size + (size % 2);
  }
  if (!format || format.codec !== 1 || format.channels !== 1 || format.bits !== 16 || !samples || samples.length % 2) throw new Error('Mono 16-bit PCM required');
  const values = new Float32Array(samples.length / 2);
  for (let i = 0; i < values.length; i++) values[i] = samples.readInt16LE(i * 2) / 32768;
  return { samples: values, sampleRate: format.rate, duration: values.length / format.rate };
}

const db = value => 20 * Math.log10(Math.max(value, 1e-9));
const rms = values => Math.sqrt(values.reduce((sum,x) => sum + x*x, 0) / Math.max(1, values.length));

export function analyzeAudio({ samples, sampleRate }, wordRanges = []) {
  if (!samples.length || !Number.isInteger(sampleRate) || sampleRate <= 0) throw new Error('Measured audio samples required');
  const frameSamples = Math.round(sampleRate * 0.02), frames = [];
  let peak = 0, clipped = 0;
  for (const value of samples) { peak = Math.max(peak, Math.abs(value)); if (Math.abs(value) >= 0.995) clipped++; }
  for (let start = 0; start < samples.length; start += frameSamples) {
    frames.push({ start: start/sampleRate, end: Math.min(start+frameSamples,samples.length)/sampleRate,
      rms: rms(samples.subarray(start, start+frameSamples)) });
  }
  const speech = frames.filter(f => wordRanges.some(w => f.end > w.start && f.start < w.end));
  const nonspeech = frames.filter(f => !wordRanges.some(w => f.end > w.start && f.start < w.end));
  const noiseValues = nonspeech.map(f => f.rms).sort((a,b) => a-b);
  const noise = noiseValues.length ? noiseValues[Math.floor(noiseValues.length * 0.2)] : null;
  const speechRms = speech.length ? rms(speech.map(f => f.rms)) : null;
  const dropouts = wordRanges.flatMap((word,index) => {
    const energy = frames.filter(f => f.end > word.start && f.start < word.end);
    // Quiet alone is not a dropout. Flag a word only for near-digital silence;
    // relative signal/noise ambiguity is handled in source comparisons.
    return energy.length && Math.max(...energy.map(f => f.rms)) < 1e-5 ? [{ wordIndex: index, start: word.start, end: word.end }] : [];
  });
  return { duration: samples.length/sampleRate, peakDb: db(peak), rmsDb: db(rms(samples)),
    clippingFraction: clipped/samples.length, speechRmsDb: speechRms === null ? null : db(speechRms),
    noiseEstimateDb: noise === null ? null : db(noise),
    speechNoiseContrastDb: speechRms !== null && noise !== null ? db(speechRms) - db(noise) : null,
    speechCoverage: wordRanges.length ? 1 - dropouts.length/wordRanges.length : null,
    dropouts, quietRecording: db(peak) < -45, frames };
}

export function audioCorrelation(a, b, maxLagSamples = 0) {
  if (!a.length || !b.length || !Number.isInteger(maxLagSamples) || maxLagSamples < 0 || maxLagSamples > 1600) throw new Error('Invalid correlation inputs');
  let best = { correlation: -1, lagSamples: 0 };
  for (let lag = -maxLagSamples; lag <= maxLagSamples; lag++) {
    const startA = Math.max(0,lag), startB = Math.max(0,-lag), count = Math.min(a.length-startA,b.length-startB);
    let sumA = 0, sumB = 0, aa = 0, bb = 0, ab = 0;
    for (let i = 0; i < count; i++) {
      const x = a[startA+i], y = b[startB+i];
      sumA += x; sumB += y; aa += x*x; bb += y*y; ab += x*y;
    }
    const varianceA = aa - sumA*sumA/count, varianceB = bb - sumB*sumB/count;
    const coefficient = varianceA > 1e-12 && varianceB > 1e-12 ? (ab - sumA*sumB/count)/Math.sqrt(varianceA*varianceB) : 0;
    if (coefficient > best.correlation) best = { correlation: coefficient, lagSamples: lag };
  }
  return best;
}
