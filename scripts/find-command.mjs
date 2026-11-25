const backends = ['premiere_cep', 'premiere_uxp'];
const pageSize = 10;

export const findCommandTool = {
  name: 'find_command',
  description: 'Search the Premiere bridge catalog. An exact command name returns its inputs. Discovery is read-only.',
  annotations: {readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false},
  inputSchema: {
    type: 'object',
    properties: {
      backend: {type: 'string', enum: backends},
      query: {type: 'string', minLength: 1, maxLength: 160},
      offset: {type: 'integer', minimum: 0}
    },
    required: ['backend', 'query'],
    additionalProperties: false
  }
};

export async function findCommand(args, catalogFor) {
  if (!args || !backends.includes(args.backend) || typeof args.query !== 'string' ||
      !args.query.trim() || args.query.length > 160 || Object.keys(args).some(key => !['backend', 'query', 'offset'].includes(key))) {
    throw new Error('Supply a Premiere backend and a command name or search terms (1–160 characters).');
  }
  const {backend, offset = 0} = args;
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('Offset must be a nonnegative integer.');
  const query = args.query.trim().toLowerCase();
  const {tools} = await catalogFor(backend);
  const exact = tools.find(tool => tool.name.toLowerCase() === query);
  if (exact) {
    const {name, description, inputSchema, annotations} = exact;
    return {backend, command: {name, description, inputSchema, annotations}};
  }

  const words = query.split(/[\s_-]+/u).filter(Boolean);
  if (!words.length) throw new Error('Search for a command name or one or more words.');
  const matches = [];
  for (const tool of tools) {
    const name = tool.name.toLowerCase();
    const searchable = name + ' ' + (tool.description ?? '').toLowerCase();
    if (words.every(word => searchable.includes(word))) {
      matches.push({tool, score: words.filter(word => name.includes(word)).length});
    }
  }
  matches.sort((a, b) => b.score - a.score || a.tool.name.localeCompare(b.tool.name, 'en'));
  return {
    backend, total: matches.length,
    matches: matches.slice(offset, offset + pageSize).map(({tool}) => ({
      name: tool.name, description: [...(tool.description ?? '')].slice(0, 180).join('')
    })),
    nextOffset: offset + pageSize < matches.length ? offset + pageSize : null
  };
}
