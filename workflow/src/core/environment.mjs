import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {accessSync, constants} from 'node:fs';
export const codeRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const runtimeRoot = path.resolve(process.env.PREMIERE_ASSISTANT_RUNTIME || path.join(codeRoot, '.local/integrations'));
export const dataRoot = path.resolve(process.env.PREMIERE_ASSISTANT_DATA || path.join(codeRoot, '.local'));
export const helperPath = name => path.join(codeRoot, 'tools', name);
export function executable(name, env = process.env) {
  const override = env[`PREMIERE_ASSISTANT_${name.toUpperCase()}`];
  if (override) return override;
  for (const directory of [...(env.PATH || '').split(path.delimiter).filter(Boolean), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin']) {
    const file = path.join(directory, name);
    try { accessSync(file, constants.X_OK); return file; } catch {}
  }
  return name;
}
export const pythonPath = () => process.env.PREMIERE_ASSISTANT_PYTHON || executable('python3');
