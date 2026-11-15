import path from 'node:path';
import {mkdir,writeFile,rename} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {executableVariables,settingsDirectory} from './settings.mjs';
import {acquireLease,storeRoot,registerConfiguration,withStoreLock} from './lifecycle.mjs';

// Probe children use their own process group so a killed configure process cannot orphan an unprotected user.
const execute=(file,args,options)=>new Promise((resolve,reject)=>{
 lease.beforeSpawn();let child;
 try{child=spawn(file,args,{env:options.env,detached:process.platform!=='win32',stdio:['ignore','pipe','pipe']});lease.started(child.pid);}
 catch(error){if(!child)lease.started();reject(error);return;}
 let stdout='',stderr='',failure,killTimer;
 const kill=signal=>{try{process.platform!=='win32'&&child.pid?process.kill(-child.pid,signal):child.kill(signal);}catch(error){if(error.code!=='ESRCH')failure??=error;}};
 const timer=setTimeout(()=>{failure=new Error('Executable probe timed out');kill('SIGTERM');killTimer=setTimeout(()=>kill('SIGKILL'),2000);},options.timeout);
 child.stdout.on('data',bytes=>{stdout+=bytes;if(stdout.length>options.maxBuffer){failure=new Error('Executable probe output too large');kill('SIGTERM');}});
 child.stderr.on('data',bytes=>{stderr=(stderr+bytes).slice(-options.maxBuffer);});
 child.once('error',error=>{failure=error;});
 child.once('close',code=>{clearTimeout(timer);clearTimeout(killTimer);lease.finished();if(failure||code!==0)reject(failure||new Error(`Executable probe failed: ${stderr}`));else resolve({stdout,stderr});});
});

const args=process.argv.slice(2), selected=new Map();
const usage='Usage: launch.sh configure [--node /absolute/node] [--python /absolute/python] [--ffmpeg /absolute/ffmpeg] [--ffprobe /absolute/ffprobe]';
if(args.length===1&&args[0]==='--help'){console.log(usage);process.exit(0);}
if(!args.length||args.length%2)throw new Error(usage);
for(let i=0;i<args.length;i+=2) {
  const name=args[i].replace(/^--/,''),file=args[i+1];
  if(args[i]!==`--${name}`||!Object.hasOwn(executableVariables,name)||!path.isAbsolute(file)||/[\r\n\0]/.test(file))throw new Error(usage);
  selected.set(name,file);
}
// Validate every requested executable before persisting any of them. Paths are data, never shell code.
const store=storeRoot(),lease=await acquireLease(store,[...selected.values()]);
try {
for(const [name,file] of selected) {
  const probe=name==='node'?['-e','if(Number(process.versions.node.split(".")[0])<22)process.exit(1)']:
    name==='python'?['-c','import sys; assert sys.version_info >= (3,9), "Python 3.9+ required"']:['-version'];
  await execute(file,probe,{timeout:15000,maxBuffer:1024*1024,env:{...process.env,PATH:[path.dirname(process.execPath),process.env.PATH||'/usr/bin:/bin'].join(path.delimiter)}});
}
const directory=settingsDirectory();await mkdir(directory,{recursive:true,mode:0o700});
await withStoreLock(store,async()=>{
for(const [name,file] of selected) {
  const target=path.join(directory,name),temporary=target+`.${process.pid}.tmp`;
  await writeFile(temporary,file+'\n',{mode:0o600});await rename(temporary,target);
}
});
await registerConfiguration(store,directory);
console.log(JSON.stringify({status:'executables_configured',directory,executables:Object.fromEntries(selected),next:'Run doctor through this launcher. Reload the Codex connections or restart Codex before checking tools in the chat.'},null,2));
}finally{await lease.release();}
