import { spawn } from 'node:child_process';

export function run(command, args, { timeoutMs = 600000, maxBytes = 16 * 1024 * 1024, env = process.env, onLine, cwd } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', settled = false;
    const timer = setTimeout(() => { child.kill('SIGTERM'); finish(new Error(`Process deadline exceeded: ${command}`)); }, timeoutMs);
    function finish(error) {
      if (settled) return;
      settled = true; clearTimeout(timer);
      if (error) reject(error); else resolve({ stdout, stderr });
    }
    child.on('error', finish);
    child.stdout.on('data', data => {
      stdout += data;
      if (stdout.length + stderr.length > maxBytes) { child.kill('SIGTERM'); finish(new Error('Process output exceeded limit')); }
      if (onLine) onLine(String(data));
    });
    child.stderr.on('data', data => {
      stderr += data;
      if (stdout.length + stderr.length > maxBytes) { child.kill('SIGTERM'); finish(new Error('Process output exceeded limit')); }
    });
    child.on('close', code => code === 0 ? finish() : finish(new Error(`${command} failed (${code}): ${stderr.slice(-2000)}`)));
  });
}
