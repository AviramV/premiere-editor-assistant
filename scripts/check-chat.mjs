import path from 'node:path';
import {readFile} from 'node:fs/promises';
import {checkChatReadiness,workflowTools} from './chat-readiness.mjs';
const usage='Usage: launch.sh check-chat /absolute/chat-inventory.json --workflow organize-project|create-proxies|edit-video|export-omf --project /absolute/project.prproj';
const args=process.argv.slice(2);
if(args.length===1&&args[0]==='--help'){console.log(JSON.stringify({usage,workflows:Object.keys(workflowTools),scope:'Local evidence validation only; no Premiere calls, configuration changes or cleanup'}));process.exit(0);}
if(args.length!==5||!path.isAbsolute(args[0])||args[1]!=='--workflow'||args[3]!=='--project')throw new Error(usage);
const result=checkChatReadiness(JSON.parse(await readFile(args[0],'utf8')),{workflow:args[2],projectPath:args[4]});
console.log(JSON.stringify(result,null,2));if(result.status!=='prerequisites_verified')process.exitCode=1;
