import {retry,pause} from './setup-recovery.mjs';

// Keep the broker alive while the Adobe panel reconnects. Only read-only host probes
// are repeated here; transport initialization retains the separate bounded retry policy.
export async function waitForHost(client,name,{timeoutMs=20000,pollMs=500,now=Date.now,sleep=pause}={}) {
 if(!(timeoutMs>0)||!(pollMs>0))throw new Error('Readiness timeouts must be positive');
 const deadline=now()+timeoutMs;
 let probes=0;
 while(now()<deadline) {
  probes++;
  const reply=await client.callTool({name,arguments:{}},undefined,{timeout:Math.max(1,deadline-now())});
  const text=reply.content?.filter(item=>item.type==='text').map(item=>item.text).join('\n')||'';
  let parsed;try{parsed=JSON.parse(text);}catch{}
  const structured=reply.structuredContent;
  const failed=reply.isError||structured?.ok===false||parsed?.ok===false||parsed?.success===false||parsed?.error;
  if(!failed)return {reply,parsed,probes};
  const detail=JSON.stringify(structured||parsed||text);
  const code=structured?.error?.code||parsed?.error?.code||parsed?.code;
  if(code!=='PANEL_NOT_CONNECTED'&&!/no premierepro panel connected|not connected to Premiere|Premiere.*not connected/i.test(detail))
   throw new Error(`Live inspection failed: ${detail}`);
  const remaining=deadline-now();
  if(remaining>0)await sleep(Math.min(pollMs,remaining));
 }
 throw Object.assign(new Error(`Premiere panel did not connect within ${timeoutMs}ms; open the matching panel and project, then retry.`),{retryable:false,code:'PANEL_READINESS_TIMEOUT',probes});
}

export async function checkBridge({backend,live,createClient,createTransport,retryOptions={},readinessOptions={}}) {
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
    const {reply,parsed,probes}=await waitForHost(client,name,readinessOptions);
    result.readinessProbes=probes;
    const payload=reply.structuredContent?.data||parsed;
    if(backend==='premiere_cep'?!payload?.path:!payload?.appVersion)throw new Error(`${backend} did not return a recognizable live host response`);
    result.liveReadback=reply;
   }
   return result;
  }finally{await client.close();}
 },retryOptions);
 return {...result,attempts};
}
