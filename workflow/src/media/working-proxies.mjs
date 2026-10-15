import {executable} from '../core/environment.mjs';
import path from 'node:path';
import {mkdir,readFile,stat} from 'node:fs/promises';
import {probeMedia} from './audio.mjs';
import {run} from '../core/process.mjs';
import {digest} from '../premiere/state.mjs';
import {atomicJson} from '../premiere/coordinator.mjs';

export function validateWorkingProxy(source,proxy,{maxWidth=960,maxHeight=540}={}) {
  const s=source.video[0],p=proxy.video[0];
  if(!s||!p||p.width>maxWidth||p.height>maxHeight||p.width<2||p.height<2)throw new Error('Working proxy must have verified lightweight dimensions');
  if(Math.abs(p.width/p.height-s.width/s.height)>.01)throw new Error('Proxy aspect ratio changed');
  if(p.avg_frame_rate!==s.avg_frame_rate||p.nb_frames!==s.nb_frames||!s.nb_frames)throw new Error('Proxy frame rate or frame count changed');
  if(Math.abs(proxy.duration-source.duration)>.002)throw new Error('Proxy duration changed');
  if(proxy.audio.length!==source.audio.length||source.audio.some((a,i)=>a.channels!==proxy.audio[i].channels||a.sample_rate!==proxy.audio[i].sample_rate||a.codec_name!==proxy.audio[i].codec_name))throw new Error('Proxy audio channel layout or copied codec changed');
  return {width:p.width,height:p.height,frames:Number(p.nb_frames),fps:p.avg_frame_rate,audioChannels:proxy.audio.map(a=>a.channels),duration:proxy.duration};
}

export async function createWorkingProxy({input,output,ffmpeg=executable('ffmpeg'),maxWidth=960,maxHeight=540}) {
  if(path.resolve(input)===path.resolve(output))throw new Error('Proxy output must differ from source');
  const source=await probeMedia(input),video=source.video[0];if(!video)throw new Error('Proxy source has no video');
  const identity=digest({source:source.revision,maxWidth,maxHeight,codec:'h264_videotoolbox',audio:'copy'});
  try {await stat(output);const cached=JSON.parse(await readFile(output+'.source.json'));if(cached.identity!==identity)throw new Error('Existing proxy is not bound to this source');validateWorkingProxy(source,await probeMedia(output),{maxWidth,maxHeight});return cached;}
  catch(error){if(error.code!=='ENOENT')throw error;try{await stat(output);throw new Error('Existing proxy without verified source evidence; inspect before retry');}catch(e){if(e.code!=='ENOENT')throw e;}}
  const factor=Math.min(1,maxWidth/video.width,maxHeight/video.height),width=Math.floor(video.width*factor/2)*2,height=Math.floor(video.height*factor/2)*2;
  await mkdir(path.dirname(output),{recursive:true});
  await run(ffmpeg,['-nostdin','-v','error','-n','-i',input,'-map','0:v:0','-map','0:a?','-map_metadata','0','-vf',`scale=${width}:${height}`,'-c:v','h264_videotoolbox','-b:v','1500k','-pix_fmt','yuv420p','-c:a','copy','-movflags','+faststart',output],{timeoutMs:Math.max(600000,source.duration*2000)});
  const proxy=await probeMedia(output),verified=validateWorkingProxy(source,proxy,{maxWidth,maxHeight});
  const evidence={status:'verified',identity,sourcePath:source.path,sourceRevision:source.revision,proxyPath:proxy.path,proxyRevision:proxy.revision,verified,completedAt:new Date().toISOString()};
  await atomicJson(output+'.source.json',evidence);return evidence;
}
