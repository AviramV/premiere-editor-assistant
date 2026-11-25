import path from 'node:path';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {root,runtimes,metadata,environment,runtimeReady,beginUse,endUse} from './common.mjs';
import {startupHelpers, workflowCommandNames} from './command-surface.mjs';
import {inspectToolCatalog, compareChatCatalog} from './tool-catalog.mjs';
import {redact} from './setup-recovery.mjs';

const args=process.argv.slice(2),usage='Usage: launch.sh inspect-tools [--chat-inventory /absolute/inventory.json]';
if(args.length===1&&args[0]==='--help'){console.log(usage);process.exit(0);}
if(args.length!==0&&(args.length!==2||args[0]!=='--chat-inventory'||!path.isAbsolute(args[1])))throw new Error(usage);
const chatInventory=args.length?JSON.parse(await readFile(args[1],'utf8')):undefined;
await beginUse();
try {
 await runtimeReady();
 const sdk=path.join(runtimes,'quadlzzz/node_modules/@modelcontextprotocol/sdk/dist/esm');
 const {Client}=await import(pathToFileURL(path.join(sdk,'client/index.js')));
 const {StdioClientTransport}=await import(pathToFileURL(path.join(sdk,'client/stdio.js')));
 const results=[];
 for(const backend of ['premiere_cep','premiere_uxp']) {
  try {
   const raw=await inspectToolCatalog({backend,
    createClient:()=>new Client({name:'premiere-editor-assistant-discovery-check',version:metadata.version}),
    createTransport:()=>new StdioClientTransport({command:process.execPath,args:[path.join(root,'scripts/bridge.mjs'),backend],env:environment()})});
   // Compare the chat with the stable startup surface. Exact lookups may
   // also have activated genuine upstream commands on that chat connection.
   const startup=[...startupHelpers,...Array.from(workflowCommandNames(backend,new Set(raw.modelToolNames)),name=>({name}))];
   const chat=compareChatCatalog(backend,{tools:startup},chatInventory);
   if(chat.chatInventoryCompared) {
    const known=new Set([...raw.modelToolNames,'activation_probe']);
    chat.notInServerCatalog=chat.notInServerCatalog.filter(name=>!known.has(name));
    chat.status=chat.missingFromChat.length||chat.notCallable.length||chat.notInServerCatalog.length?'different':'matches';
   }
   const {modelToolNames,...summary}=raw;
   results.push({...summary,startupToolNames:startup.map(tool=>tool.name),chat});
  }catch(error){results.push({backend,status:'catalog_failed',detail:redact(error.message)});}
 }
 const failed=results.some(result=>result.status!=='catalog_verified'),different=results.some(result=>result.chat?.status==='different');
 console.log(JSON.stringify({schema:1,plugin:{name:metadata.name,version:metadata.version},checkedAt:new Date().toISOString(),
  status:failed?'catalog_check_failed':different?'chat_catalog_mismatch':'server_catalogs_verified',
  scope:'Lists every page from packaged MCP servers. Calls no Premiere operation and performs no cleanup. Server discovery alone does not verify chat adoption.',
  livePremiereConnectionVerified:false,chatConnectionsVerified:false,results,
  next:different?'The supplied chat inventory differs from the servers. Preserve this result, check the host tool filters and refresh only the affected MCP connections. Compare a newly collected chat inventory afterward.':'Verify required tools and read-only host calls through the actual chat before beginning work.'},null,2));
 if(failed||different)process.exitCode=1;
}finally{await endUse();}
