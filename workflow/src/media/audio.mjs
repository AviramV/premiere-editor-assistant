import {executable} from '../core/environment.mjs';
import { mkdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { run } from '../core/process.mjs';
import { digest } from '../premiere/state.mjs';
import { atomicJson } from '../premiere/coordinator.mjs';

export async function probeMedia(filename, { ffprobe = executable('ffprobe') } = {}) {
  const metadata = JSON.parse((await run(ffprobe, ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', filename])).stdout);
  const file = await stat(filename);
  const audio = metadata.streams.filter(s => s.codec_type === 'audio');
  return { path: path.resolve(filename), duration: Number(metadata.format.duration), audio,
    video: metadata.streams.filter(s => s.codec_type === 'video'),
    revision: digest({ path: path.resolve(filename), size: file.size, mtimeMs: file.mtimeMs,
      duration: metadata.format.duration, audio: audio.map(s => ({ channels: s.channels, sampleRate: s.sample_rate, codec: s.codec_name })) }) };
}

export async function extractAudio({ input, output, stream = 0, channel = 0, start = 0, duration, normalize = false,
  sampleRate = 16000, ffmpeg = executable('ffmpeg') }) {
  if (path.resolve(input) === path.resolve(output)) throw new Error('Audio output must differ from source');
  const info = await probeMedia(input);
  if (!Number.isInteger(stream) || stream < 0 || !info.audio[stream] || !Number.isInteger(channel) ||
    channel < 0 || channel >= info.audio[stream].channels) throw new Error('Invalid audio stream/channel');
  if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 192000) throw new Error('Invalid output sample rate');
  if (!Number.isFinite(start) || start < 0 || start >= info.duration ||
    (duration !== undefined && (!Number.isFinite(duration) || duration <= 0 || start + duration > info.duration + 0.002))) throw new Error('Invalid audio extraction interval');
  const identity = { sourceRevision: info.revision, sourceStart: start, stream, channel, normalize,
    requestedDuration: duration ?? info.duration - start, sampleRate };
  try {
    const cached = JSON.parse(await readFile(`${output}.source.json`, 'utf8'));
    const extracted = await probeMedia(output);
    if (cached.extractionIdentity === digest(identity) && cached.sourceRevision === info.revision &&
      cached.audioRevision === extracted.revision && cached.audioPath === path.resolve(output) &&
      Number.isFinite(cached.duration) && cached.duration > 0 &&
      Math.abs(extracted.duration - cached.duration) < 0.002 && extracted.audio[0]?.channels === 1 &&
      extracted.audio[0]?.sample_rate === String(sampleRate)) return cached;
  } catch (error) { if (error.code && error.code !== 'ENOENT') throw error; }
  await mkdir(path.dirname(output), { recursive: true });
  const args = ['-nostdin', '-v', 'error', '-y', '-ss', String(start), '-i', input];
  if (duration !== undefined) args.push('-t', String(duration));
  args.push('-map', `0:a:${stream}`, '-af', `pan=mono|c0=c${channel}${normalize ? ',loudnorm=I=-23:TP=-3:LRA=11' : ''}`,
    '-ar', String(sampleRate), '-c:a', 'pcm_s16le', output);
  // Cloud-mounted media may hydrate while demuxing; a fixed ten-minute deadline
  // rejected the 32-minute Ecomm recording after extracting 28 minutes.
  await run(ffmpeg, args, { timeoutMs: Math.max(600000, identity.requestedDuration * 2000) });
  const extracted = await probeMedia(output);
  const source = { audioPath: path.resolve(output), sourcePath: info.path, sourceRevision: info.revision,
    stream, channel, sourceStart: start, duration: extracted.duration, normalized: normalize,
    sampleRate, sourceSampleRate:Number(info.audio[stream].sample_rate), sourceDuration: info.duration,
    requestedDuration:identity.requestedDuration,audioRevision:extracted.revision,extractionIdentity: digest(identity) };
  await atomicJson(`${output}.source.json`, source);
  return source;
}
