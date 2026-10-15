#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { PremiereTransport } from '../src/premiere/transport.mjs';
import { PremiereCoordinator, atomicJson } from '../src/premiere/coordinator.mjs';
import { revision } from '../src/premiere/state.mjs';

const [command, configFile, outputFile] = process.argv.slice(2);
if (!['inspect', 'keep'].includes(command) || !configFile || !outputFile) {
  console.error('Usage: node tools/workflow.mjs <inspect|keep> config.json output.json');
  process.exit(2);
}
const config = JSON.parse(await readFile(configFile, 'utf8'));
const transport = await new PremiereTransport().connect();
try {
  const coordinator = new PremiereCoordinator({ transport, projectPath: config.projectPath,
    protectedIds: config.protectedIds, directory: path.resolve('.local/workflow/execution') });
  const state = command === 'inspect' ? await coordinator.inspect(config.sequenceId)
    : await coordinator.keepRanges(config);
  await atomicJson(outputFile, command === 'inspect' ? { sequence: state, revision: revision(state) } : state);
  console.log(JSON.stringify({ command, sequenceId: config.sequenceId, outputFile,
    status: command === 'inspect' ? 'inspected' : state.status }));
} finally { await transport.close(); }
