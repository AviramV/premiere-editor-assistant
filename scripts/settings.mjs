import path from 'node:path';
import {homedir} from 'node:os';
import {readFileSync} from 'node:fs';

export const executableVariables = {
  node:'PREMIERE_ASSISTANT_NODE', python:'PREMIERE_ASSISTANT_PYTHON',
  ffmpeg:'PREMIERE_ASSISTANT_FFMPEG', ffprobe:'PREMIERE_ASSISTANT_FFPROBE'
};
export const settingsDirectory = (env=process.env) => path.resolve(env.PREMIERE_ASSISTANT_CONFIG || path.join(homedir(),'Library/Application Support/Premiere Editor Assistant/executables'));
export function configuredExecutables(env=process.env) {
  const configured={};
  for(const [name,variable] of Object.entries(executableVariables)) {
    if(env[variable])continue;
    const file=path.join(settingsDirectory(env),name);
    let value;
    try {value=readFileSync(file,'utf8').replace(/\n$/,'');}
    catch(error) {if(error.code==='ENOENT')continue;throw error;}
    if(!path.isAbsolute(value)||/[\r\n\0]/.test(value))throw new Error(`Invalid executable path in ${file}; expected one absolute path.`);
    configured[variable]=value;
  }
  return configured;
}
