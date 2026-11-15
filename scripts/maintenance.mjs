import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {root,runtimes,location,environment,run} from './common.mjs';
import {settingsDirectory} from './settings.mjs';
import {cleanup} from './lifecycle.mjs';
import {legacyMigrationPlanner} from './legacy-migration.mjs';
import {checkBridge} from './smoke-check.mjs';

export async function probePanelLocation() {
 const sdk=path.join(runtimes,'quadlzzz/node_modules/@modelcontextprotocol/sdk/dist/esm');
 const {Client}=await import(pathToFileURL(path.join(sdk,'client/index.js')));
 const {StdioClientTransport}=await import(pathToFileURL(path.join(sdk,'client/stdio.js')));
 const result=await checkBridge({backend:'premiere_uxp',live:true,
  createClient:()=>new Client({name:'premiere-editor-assistant-migration-check',version:'1.0.0'}),
  createTransport:()=>new StdioClientTransport({command:'/bin/bash',args:[path.join(root,'scripts/launch.sh'),'premiere_uxp'],env:environment()})});
 return result.panelPath;
}
export async function maintainResources({apply=false,panelPath}={}) {
 return cleanup({store:location.store,apply,protectedPaths:[location.directory,environment().PREMIERE_ASSISTANT_PYTHON,process.env.PREMIERE_ASSISTANT_UXP_PANEL].filter(Boolean),
  legacyPlanner:legacyMigrationPlanner({store:location.store,runtimes,root,configuration:settingsDirectory(),python:environment().PREMIERE_ASSISTANT_PYTHON,run,panelPath})});
}
