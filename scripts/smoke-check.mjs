import {retry} from './setup-recovery.mjs';

export async function checkBridge({backend,live,createClient,createTransport,retryOptions={}}) {
 let attempts=0;
 const result=await retry(async attempt=>{
  attempts=attempt;
  const client=createClient();
  try {
   await client.connect(createTransport());
   const {tools}=await client.listTools();
   const required=backend==='premiere_cep'?['get_project_info','get_full_sequence_info']:['ppro_env','ppro_guarded_reorder','ppro_transcript_import'];
   for(const name of required)if(!tools.some(tool=>tool.name===name))throw new Error(`Packaged ${backend} is missing ${name}`);
   const result={backend,status:'handshake_verified',tools:tools.length};
   if(live) {
    const name=backend==='premiere_cep'?'get_project_info':'ppro_env';
    const reply=await client.callTool({name,arguments:{}},undefined,{timeout:20000});
    if(reply.isError)throw new Error(`${backend} live inspection failed: ${JSON.stringify(reply.content)}`);
    const text=reply.content?.filter(item=>item.type==='text').map(item=>item.text).join('\n')||'';
    let parsed;try{parsed=JSON.parse(text);}catch{}
    if(parsed?.ok===false||parsed?.success===false||parsed?.error)throw new Error(`${backend} live inspection reported an error: ${text}`);
    const payload=reply.structuredContent?.data||parsed;
    if(backend==='premiere_cep'?!payload?.path:!payload?.appVersion)throw new Error(`${backend} did not return a recognizable live host response`);
    result.liveReadback=reply;
   }
   return result;
  }finally{await client.close();}
 },retryOptions);
 return {...result,attempts};
}
