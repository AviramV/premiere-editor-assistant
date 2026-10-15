import {TICKS_PER_SECOND,ticksToSeconds} from '../core/timing.mjs';

export function editorStartFromPreview(boundary,{sequenceRevision,sourceRevision,frameTicks,range}) {
  if(boundary.kind!=='editor_timecode'||boundary.sequenceRevision!==sequenceRevision||boundary.sourceRevision!==sourceRevision||!boundary.reference) throw new Error('Current revision-bound editor boundary required');
  const fps=boundary.frameRate,frame=BigInt(frameTicks),m=/^(\d{2}):(\d{2}):(\d{2}):(\d{2})$/.exec(boundary.timecode);
  if(!Number.isInteger(fps)||fps<1||fps>60||frame*BigInt(fps)!==TICKS_PER_SECOND||!m)throw new Error('Matching integer frame-rate timecode required');
  const [h,min,sec,f]=m.slice(1).map(Number);
  if(min>=60||sec>=60||f>=fps)throw new Error('Invalid editor timecode');
  const a=BigInt(boundary.previewRange.startTicks),b=BigInt(boundary.previewRange.endTicks),start=a+BigInt(((h*60+min)*60+sec)*fps+f)*frame;
  if(a%frame||b%frame||b<=a||a<BigInt(range.startTicks)||b>BigInt(range.endTicks)||start<a||start>=b)throw new Error('Editor boundary lies outside the reviewed performance');
  return {startTicks:String(start),start:ticksToSeconds(start),evidence:boundary};
}
