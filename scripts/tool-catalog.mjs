import {createHash} from 'node:crypto';

export const modelVisible = tool => !tool._meta?.ui?.visibility || tool._meta.ui.visibility.includes('model');

const namePattern=/^[A-Za-z0-9_.-]+$/;
const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value;

// A tools/list response is a page, not necessarily the complete catalogue.
// Refuse ambiguous catalogues instead of silently publishing a partial result.
export async function readToolCatalog(client,{maxTools=4096,maxPages=256}={}) {
 const tools=[],names=new Set(),cursors=new Set();let cursor;
 for(let page=0;page<maxPages;page++) {
  const response=await client.listTools(cursor===undefined?undefined:{cursor});
  if(!Array.isArray(response.tools))throw new Error('MCP tools/list returned no tool array');
  for(const tool of response.tools) {
   if(!tool||typeof tool.name!=='string'||!namePattern.test(tool.name)||tool.inputSchema?.type!=='object')throw new Error('MCP tools/list returned an invalid name or input schema');
   if(names.has(tool.name))throw new Error(`Duplicate tool across MCP catalogue pages: ${tool.name}`);
   names.add(tool.name);tools.push(tool);
   if(tools.length>maxTools)throw new Error('MCP tool catalogue exceeded the inspection limit; completeness is unverified');
  }
  if(response.nextCursor===undefined||response.nextCursor===null) {
   tools.sort((a,b)=>a.name.localeCompare(b.name,'en'));
   return {tools,pages:page+1,fingerprint:createHash('sha256').update(JSON.stringify(stable(tools))).digest('hex')};
  }
  if(typeof response.nextCursor!=='string'||!response.nextCursor||cursors.has(response.nextCursor))throw new Error('MCP tool catalogue has an invalid or repeated pagination cursor');
  cursors.add(response.nextCursor);cursor=response.nextCursor;
 }
 throw new Error('MCP tool catalogue exceeded the page limit; completeness is unverified');
}

export function compareChatCatalog(backend,catalog,inventory) {
 if(inventory===undefined)return {status:'not_supplied',chatInventoryCompared:false};
 if(inventory?.schema!==1||typeof inventory.collectedAt!=='string'||!Number.isFinite(Date.parse(inventory.collectedAt))||!inventory.servers||typeof inventory.servers!=='object')throw new Error('Chat inventory requires schema: 1, collectedAt, and servers');
 const rows=inventory.servers[backend];
 if(!Array.isArray(rows))throw new Error(`Chat inventory must explicitly include ${backend}, including an empty array when absent`);
 const available=new Set(),unbound=[],upstream=new Set(catalog.tools.map(tool=>tool.name));
 for(const row of rows) {
  if(!row||typeof row.name!=='string'||typeof row.callable!=='boolean')throw new Error('Chat inventory entries require name and callable boolean');
  const split=row.name.lastIndexOf('__'),prefix=split<0?'':row.name.slice(0,split),name=split<0?row.name:row.name.slice(split+2);
  if(!namePattern.test(name)||/(?:^|[_-])eval(?:[_-]|$)/i.test(prefix)||prefix&&!prefix.endsWith(backend))throw new Error(`Chat inventory contains a different or development registration: ${row.name}`);
  if(available.has(name)||unbound.includes(name))throw new Error(`Duplicate chat tool: ${name}`);
  if(row.callable)available.add(name);else unbound.push(name);
 }
 const missing=[...upstream].filter(name=>!available.has(name)).sort(),unexpected=[...available].filter(name=>!upstream.has(name)).sort();
 return {status:missing.length||unexpected.length||unbound.length?'different':'matches',chatInventoryCompared:true,collectedAt:inventory.collectedAt,
  chatToolCount:available.size,missingFromChat:missing,notCallable:unbound.sort(),notInServerCatalog:unexpected,
  scope:'Compares the supplied chat inventory with a fresh server catalogue. It does not prove current chat state, host connectivity, approvals, or write behavior.'};
}

export async function inspectToolCatalog({backend,createClient,createTransport,chatInventory}) {
 const client=createClient();
 try {
  await client.connect(createTransport());
  const catalog=await readToolCatalog(client),info=client.getServerVersion?.();
  return {backend,status:'catalog_verified',server:info?{name:info.name,version:info.version}:null,
   toolCount:catalog.tools.length,pages:catalog.pages,fingerprint:catalog.fingerprint,toolNames:catalog.tools.map(tool=>tool.name),
   modelToolNames:catalog.tools.filter(modelVisible).map(tool=>tool.name),
   chat:compareChatCatalog(backend,catalog,chatInventory),livePremiereConnectionVerified:false};
 }finally{await client.close();}
}
