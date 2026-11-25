import net from 'node:net';
import path from 'node:path';
import {spawn} from 'node:child_process';

export function proxyEnvironment(env=process.env) {
 const port=Number(env.PPRO_PROXY_PORT||3001);
 if(!Number.isInteger(port)||port<1||port>65535)throw new Error('PPRO_PROXY_PORT must be an integer between 1 and 65535.');
 const url=`ws://127.0.0.1:${port}`;
 if(env.PPRO_PROXY_URL) {
  const configured=new URL(env.PPRO_PROXY_URL);
  if(configured.protocol!=='ws:'||configured.hostname!=='127.0.0.1'||Number(configured.port||80)!==port||configured.pathname!=='/'||configured.search||configured.hash||configured.username||configured.password)
   throw new Error('The managed UXP proxy requires PPRO_PROXY_URL to match the loopback PPRO_PROXY_PORT.');
 }
 return {...env,PPRO_PROXY_HOST:'127.0.0.1',PPRO_PROXY_PORT:String(port),PPRO_PROXY_URL:url};
}

// This is listener readiness only. Premiere/panel readiness still requires a
// read-only native probe through the actual chat, followed by reconciliation.
function listenerReady(port) {
 return new Promise(resolve=>{
  const socket=net.createConnection({host:'127.0.0.1',port});let done=false;
  const finish=value=>{if(done)return;done=true;socket.destroy();resolve(value);};
  socket.setTimeout(400);socket.once('connect',()=>finish(true));
  socket.once('error',()=>finish(false));socket.once('timeout',()=>finish(false));
 });
}
function track(child) {
 const record={child,exited:false,error:null};
 record.closed=new Promise(resolve=>{
  child.once('error',error=>{record.error=error;});
  child.once('close',(code,signal)=>{record.exited=true;resolve({code,signal,error:record.error});});
 });return record;
}
async function terminate(record) {
 if(!record||record.exited)return;
 record.child.kill('SIGTERM');
 const escalation=setTimeout(()=>{if(!record.exited)record.child.kill('SIGKILL');},1000);
 escalation.unref();
 try{await record.closed;}finally{clearTimeout(escalation);}
}

// Each agent session watches the shared listener. A session that borrowed a
// different session's proxy can replace it after that owner exits. Only this
// process's own children are stopped; an existing listener is never killed.
// The MCP process and its transport stay intact during recovery. No tool call
// is inspected or replayed, including requests interrupted by a disconnect.
export async function runUxpBridge({runtime,node=process.execPath,env=process.env,pollMs=1000,startupTimeoutMs=6000,stderr=process.stderr}={}) {
 if(!path.isAbsolute(runtime||''))throw new Error('An absolute UXP runtime directory is required.');
 const childEnv=proxyEnvironment(env),port=Number(childEnv.PPRO_PROXY_PORT);
 let ownedProxy,mcp,stopping=false,signalCode;
 const waits=new Set();
 const wait=ms=>new Promise(resolve=>{const pending={resolve};pending.timer=setTimeout(()=>{waits.delete(pending);resolve();},ms);waits.add(pending);});
 const stop=()=>{stopping=true;for(const pending of waits){clearTimeout(pending.timer);pending.resolve();}waits.clear();};
 const signals={SIGINT:()=>{signalCode=130;stop();},SIGTERM:()=>{signalCode=143;stop();}};
 for(const [signal,handler] of Object.entries(signals))process.on(signal,handler);
 async function ensureProxy() {
  if(stopping)return;
  if(await listenerReady(port)||stopping)return;
  if(!ownedProxy||ownedProxy.exited) {
   stderr.write('[premiere uxp] Starting local proxy; interrupted tool requests are not replayed.\n');
   ownedProxy=track(spawn(node,[path.join(runtime,'proxy/server.js')],{env:childEnv,stdio:['ignore','ignore','inherit']}));
  }
  const deadline=Date.now()+startupTimeoutMs;
  do {
   if(stopping||await listenerReady(port))return;
   await wait(100);
  }while(!stopping&&Date.now()<deadline);
  if(!stopping)throw new Error(`UXP proxy did not open 127.0.0.1:${port}. ${ownedProxy?.error?.message||'Inspect the proxy startup error above; no Premiere command was retried.'}`);
 }
 try {
  await ensureProxy();if(stopping)return signalCode??1;
  mcp=track(spawn(node,[path.join(runtime,'mcp/server.js')],{env:childEnv,stdio:'inherit'}));
  let result;mcp.closed.then(value=>{result=value;stop();});
  while(!stopping){await wait(pollMs);if(!stopping)await ensureProxy();}
  if(signalCode)return signalCode;
  if(result?.error)throw result.error;
  return result?.code??1;
 }finally {
  stop();
  try{await terminate(mcp);await terminate(ownedProxy);}
  finally{for(const [signal,handler] of Object.entries(signals))process.off(signal,handler);}
 }
}
