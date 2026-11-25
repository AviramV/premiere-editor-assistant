import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';

export function activationAdvice(status, host, listFeatures) {
  if (!['codex', 'claude'].includes(host)) throw new Error('Expected codex or claude.');
  if (!status || typeof status.connection !== 'string' ||
      !['requested','relisted','confirmed'].every(key => typeof status[key] === 'boolean')) {
    throw new Error('Use the current connection’s activation_status response.');
  }
  if (status.confirmed && status.requested) return 'activation_verified';
  if (!status.requested) return 'test_activation_first';
  if (status.relisted) return 'check_host_permission_or_search';
  if (host !== 'codex') return 'use_fallback';
  let features;
  try { features = listFeatures(); } catch { return 'use_fallback'; }
  const flag = features.split(/\r?\n/).map(line => /^\s*mcp_tool_list_changed\s+(.+?)\s+(true|false)\s*$/.exec(line)).find(Boolean);
  if (!flag || flag[2] === 'true' || !['stable','experimental','under development'].includes(flag[1])) return 'use_fallback';
  return 'offer_if_policy_permits';
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [host, file, cli] = process.argv.slice(2);
  if (!path.isAbsolute(file || '') || (host === 'codex' && !path.isAbsolute(cli || ''))) {
    throw new Error('Usage: activation-advice codex|claude /absolute/status.json [/absolute/active/codex]');
  }
  const status = JSON.parse(await readFile(file, 'utf8'));
  console.log(activationAdvice(status, host, () => execFileSync(cli, ['features', 'list'], {encoding:'utf8', timeout:5000})));
}
