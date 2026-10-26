import path from 'node:path';
import {mkdir,writeFile,rename} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {executableVariables,settingsDirectory} from './settings.mjs';

const execute=promisify(execFile);

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
for(const [name,file] of selected) {
  const probe=name==='node'?['-e','if(Number(process.versions.node.split(".")[0])<22)process.exit(1)']:
    name==='python'?['-c','import sys; assert sys.version_info >= (3,9), "Python 3.9+ required"']:['-version'];
  await execute(file,probe,{timeout:15000,maxBuffer:1024*1024,env:{...process.env,PATH:[path.dirname(process.execPath),process.env.PATH||'/usr/bin:/bin'].join(path.delimiter)}});
}
const directory=settingsDirectory();await mkdir(directory,{recursive:true,mode:0o700});
for(const [name,file] of selected) {
  const target=path.join(directory,name),temporary=target+`.${process.pid}.tmp`;
  await writeFile(temporary,file+'\n',{mode:0o600});await rename(temporary,target);
}
console.log(JSON.stringify({status:'executables_configured',directory,executables:Object.fromEntries(selected),next:'Run doctor through this launcher. Reload the Codex connections or restart Codex before checking tools in the chat.'},null,2));
