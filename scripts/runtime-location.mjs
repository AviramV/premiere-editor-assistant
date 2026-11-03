import path from 'node:path';
import {homedir} from 'node:os';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {mkdir,writeFile,readFile,link,unlink} from 'node:fs/promises';
import {settingsDirectory} from './settings.mjs';

function absolute(value,label) {
 if(!path.isAbsolute(value)||/[\r\n\0]/.test(value))throw new Error(`${label} must contain one absolute directory path`);
 return path.normalize(value);
}
export function runtimeLocation(version,env=process.env,home=homedir()) {
 if(!/^\d+\.\d+\.\d+$/.test(version))throw new Error('Invalid runtime version');
 const registration=path.join(settingsDirectory(env),'runtimes',version);
 let saved;
 try {saved=absolute(readFileSync(registration,'utf8').replace(/\n$/,''),registration);}
 catch(error){if(error.code!=='ENOENT')throw error;}
 const directory=env.PREMIERE_ASSISTANT_DATA?absolute(env.PREMIERE_ASSISTANT_DATA,'PREMIERE_ASSISTANT_DATA'):
  saved||path.join(home,'Library/Application Support/Premiere Editor Assistant',version);
 const legacy=env.PLUGIN_DATA?path.join(absolute(env.PLUGIN_DATA,'PLUGIN_DATA'),version):undefined;
 return {directory,registration,source:env.PREMIERE_ASSISTANT_DATA?'environment':saved?'saved':'shared_default',
  legacyDirectory:legacy!==directory?legacy:undefined};
}
// One registration per version; concurrent or conflicting installations never silently replace it.
export async function registerRuntime(location) {
 await mkdir(path.dirname(location.registration),{recursive:true,mode:0o700});
 const temporary=location.registration+'.'+randomUUID()+'.tmp';
 try {
  await writeFile(temporary,location.directory+'\n',{flag:'wx',mode:0o600});
  try {await link(temporary,location.registration);}
  catch(error) {
   if(error.code!=='EEXIST')throw error;
   const current=(await readFile(location.registration,'utf8')).replace(/\n$/,'');
   if(current!==location.directory)throw new Error(`Runtime location conflict: ${location.registration} already points to ${current}; requested ${location.directory}. Preserve both installations and reconcile the saved path before retrying.`);
  }
 }finally{await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}
