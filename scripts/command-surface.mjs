import {randomUUID} from 'node:crypto';
import {findCommand, findCommandTool} from './find-command.mjs';
import {modelVisible} from './tool-catalog.mjs';
import {workflowTools} from './chat-readiness.mjs';

const optionalWorkflowTools = {
  premiere_cep: ['generate_media_contact_sheet', 'export_sequence', 'close_project', 'open_project',
    'get_bridge_telemetry', 'inspect_operation_recovery', 'acknowledge_operation_recovery'],
  premiere_uxp: []
};
const emptyInput = {type: 'object', properties: {}, additionalProperties: false};
const probe = {
  name: 'activation_probe', description: 'Confirm this connection received an updated tool list.',
  inputSchema: emptyInput, annotations: findCommandTool.annotations
};
const status = {
  name: 'activation_status', description: 'Read this connection’s activation test result.',
  inputSchema: emptyInput, annotations: findCommandTool.annotations
};
const response = value => ({content: [{type: 'text', text: JSON.stringify(value)}]});

// Keep authorization, UI visibility and annotations on the original tool. The
// bridge still validates the original inputs. Exact lookups supply their schema.
function compact(tool) {
  return {
    ...tool, description: 'Use find_command for inputs. ' + (tool.description || '').split('\n')[0].slice(0, 100),
    inputSchema: {type: 'object', properties: {}, additionalProperties: true}
  };
}

export function workflowCommandNames(backend, available) {
  const required = Object.values(workflowTools).flatMap(workflow => workflow[backend] || []);
  return new Set([...required, ...optionalWorkflowTools[backend]].filter(name => available.has(name)));
}

export const startupHelpers = [findCommandTool, status];

export function createCommandSurface({backend, tools, notify, forward}) {
  const commands = new Map(tools.filter(modelVisible).map(tool => [tool.name, tool]));
  for (const name of [probe.name, status.name, findCommandTool.name]) {
    if (commands.has(name)) throw new Error('Reserved lookup name conflicts with upstream tool: ' + name);
  }
  const core = workflowCommandNames(backend, commands);
  const active = new Set();
  const catalog = {tools: [...commands.values()]};
  const connection = randomUUID();
  let requested = false, relisted = false, confirmed = false;
  const activationState = () => ({connection, requested, relisted, confirmed});
  return {
    list() {
      if (requested) relisted = true;
      const names = [...core, ...active];
      return [...startupHelpers, ...(requested ? [probe] : []), ...names.map(name => compact(commands.get(name)))];
    },
    async call(name, args, options) {
      if (name === status.name) return response(activationState());
      if (name === probe.name && requested && relisted) {
        confirmed = true;
        return response(activationState());
      }
      if (name === findCommandTool.name) {
        if (args?.backend !== backend) throw new Error('Use find_command on the requested backend.');
        if (args.query === probe.name) {
          await findCommand(args, () => ({tools: [probe]}));
          requested = true;
          await notify();
          return response({backend, command: probe, activation: activationState()});
        }
        const result = await findCommand(args, () => catalog);
        if (result.command && !core.has(result.command.name)) {
          // Maintain a bounded per-connection working set. A fresh exact lookup
          // can reactivate an evicted name; never dispatch a different command.
          active.delete(result.command.name);
          active.add(result.command.name);
          if (active.size > 4) active.delete(active.values().next().value);
          await notify();
        }
        return response(result);
      }
      if (!core.has(name) && !active.has(name)) throw new Error('Inactive command. Look it up by exact name first.');
      return forward(name, args, options);
    }
  };
}
