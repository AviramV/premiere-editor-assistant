export const TICKS_PER_SECOND = 254016000000n;

// Convert decimal seconds without first multiplying a floating point value.
export function secondsToTicks(value) {
  if (!Number.isFinite(Number(value))) throw new Error('Time must be finite');
  const text = Number(value).toFixed(9);
  const negative = text.startsWith('-');
  const [whole, decimal = ''] = text.replace(/^-/, '').split('.');
  const scale = 10n ** BigInt(decimal.length);
  const numerator = (BigInt(whole) * scale + BigInt(decimal || '0')) * TICKS_PER_SECOND;
  const rounded = (numerator + scale / 2n) / scale;
  return negative ? -rounded : rounded;
}

export function ticksToSeconds(ticks) { return Number(BigInt(ticks)) / Number(TICKS_PER_SECOND); }

export function snapTicks(ticks, frameTicks, rounding = 'nearest') {
  const time = BigInt(ticks), frame = BigInt(frameTicks);
  if (time < 0n || frame <= 0n) throw new Error('Nonnegative time and positive timebase required');
  if (!['floor', 'ceil', 'nearest'].includes(rounding)) throw new Error('Invalid frame rounding');
  const offset = rounding === 'ceil' ? frame - 1n : rounding === 'nearest' ? frame / 2n : 0n;
  return ((time + offset) / frame) * frame;
}

export function frameRange(start, end, frameTicks) {
  const a = snapTicks(secondsToTicks(start), frameTicks, 'floor');
  const b = snapTicks(secondsToTicks(end), frameTicks, 'ceil');
  if (a >= b) throw new Error('Empty or reversed interval');
  return { startTicks: String(a), endTicks: String(b), start: ticksToSeconds(a), end: ticksToSeconds(b) };
}

export function sourceToTimeline(sourceSeconds, placement) {
  if (placement.speed !== 1 || placement.reversed || placement.timeRemapped) {
    throw new Error('Speed changes or time remapping require review');
  }
  const source = secondsToTicks(sourceSeconds);
  const a = BigInt(placement.inTicks), b = BigInt(placement.outTicks);
  if (source < a || source > b) throw new Error('Word lies outside this source placement');
  return BigInt(placement.startTicks) + source - a;
}
