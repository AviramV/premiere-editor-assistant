import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {root, runtimes, metadata, environment, beginUse, runtimeReady, endUse} from './common.mjs';
import {readToolCatalog} from './tool-catalog.mjs';
import {createCommandSurface} from './command-surface.mjs';

const backend = process.argv[2];
if (!['premiere_cep', 'premiere_uxp'].includes(backend)) throw new Error('Unknown Premiere backend');
await beginUse();
let client;
try {
  await runtimeReady();
  const sdk = path.join(runtimes, 'quadlzzz/node_modules/@modelcontextprotocol/sdk/dist/esm');
  const load = file => import(pathToFileURL(path.join(sdk, file)));
  const [{Client}, {StdioClientTransport}, {Server}, {StdioServerTransport}, types] = await Promise.all([
    'client/index.js', 'client/stdio.js', 'server/index.js', 'server/stdio.js', 'types.js'
  ].map(load));
  client = new Client({name: 'premiere-command-adapter', version: metadata.version});
  await client.connect(new StdioClientTransport({
    command: process.execPath, args: [path.join(root, 'scripts/bridge.mjs'), backend], env: environment()
  }));
  const catalog = await readToolCatalog(client);
  const server = new Server({name: backend, version: metadata.version}, {capabilities: {tools: {listChanged: true}}});
  const surface = createCommandSurface({
    backend, tools: catalog.tools, notify: () => server.sendToolListChanged(),
    forward: (name, args, {signal, _meta}) => client.callTool({name, arguments: args, _meta}, undefined,
      {signal, timeout: 90 * 60_000})
  });
  server.setRequestHandler(types.ListToolsRequestSchema, async () => ({tools: surface.list()}));
  server.setRequestHandler(types.CallToolRequestSchema, async ({params}, {signal}) => {
    try { return await surface.call(params.name, params.arguments || {}, {signal, _meta: params._meta}); }
    catch (error) { return {isError: true, content: [{type: 'text', text: error.message}]}; }
  });
  let finish;
  const stopped = new Promise(resolve => { finish = resolve; });
  process.stdin.once('end', finish);
  process.once('SIGTERM', finish);
  process.once('SIGINT', finish);
  server.onclose = finish;
  await server.connect(new StdioServerTransport());
  if (!process.stdin.readableEnded) await stopped;
  await server.close();
} finally {
  try { await client?.close(); } finally { await endUse(); }
}
