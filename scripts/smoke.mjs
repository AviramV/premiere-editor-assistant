import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {root,runtimes,environment,runtimeReady} from './common.mjs';
await runtimeReady();
const sdk=path.join(runtimes,'quadlzzz/node_modules/@modelcontextprotocol/sdk/dist/esm');
const {Client}=await import(pathToFileURL(path.join(sdk,'client/index.js')));
const {StdioClientTransport}=await import(pathToFileURL(path.join(sdk,'client/stdio.js')));
const live=process.argv.includes('--live'),results=[];
for(const backend of ['premiere_cep','premiere_uxp']) {
 const client=new Client({name:'premiere-editor-assistant-package-check',version:'0.1.0'});
 try {
  await client.connect(new StdioClientTransport({command:'/bin/bash',args:[path.join(root,'scripts/launch.sh'),backend],env:environment()}));
  const {tools}=await client.listTools();
  const required=backend==='premiere_cep'?['get_project_info','get_full_sequence_info']:['ppro_env','ppro_guarded_reorder','ppro_transcript_import'];
  for(const name of required)if(!tools.some(t=>t.name===name))throw new Error(`Packaged ${backend} is missing ${name}`);
  const result={backend,status:'handshake_verified',tools:tools.length};
  if(live) {
   const tool=backend==='premiere_cep'?'get_project_info':'ppro_env';
   const reply=await client.callTool({name:tool,arguments:{}},undefined,{timeout:20000});
   if(reply.isError)throw new Error(`${backend} live inspection failed: ${JSON.stringify(reply.content)}`);
   const text=reply.content?.filter(c=>c.type==='text').map(c=>c.text).join('\n')||'';
   let parsed;try{parsed=JSON.parse(text);}catch{}
   if(parsed?.ok===false||parsed?.success===false||parsed?.error)throw new Error(`${backend} live inspection reported an error: ${text}`);
   const payload=reply.structuredContent?.data || parsed;
   if(backend==='premiere_cep'?!payload?.path:!payload?.appVersion)throw new Error(`${backend} did not return a recognizable live host response`);
   result.liveReadback=reply;
  }
  results.push(result);
 } finally {await client.close();}
}
console.log(JSON.stringify({status:'verified',livePremiereConnectionVerified:live,results},null,2));
