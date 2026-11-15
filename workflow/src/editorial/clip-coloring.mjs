// The agent checks its current session's UI tools before editing. The bridge
// cannot infer foreground UI access from the agent name or account.
export function resolveClipColoring(value) {
  if (value === undefined) return {available: true}; // Preserve the existing strict color gate.
  if (!value || typeof value.available !== 'boolean' ||
      (value.reason !== undefined && (typeof value.reason !== 'string' || !value.reason.trim())) ||
      (!value.available && !value.reason?.trim())) {
    throw new Error('clipColoring requires boolean available and a reason when unavailable');
  }
  return {available: value.available, ...(value.reason ? {reason: value.reason.trim()} : {})};
}
