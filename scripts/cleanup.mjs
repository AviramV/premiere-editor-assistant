import {beginUse,endUse,recordRelease,runtimeReady,selectLivePanelPath} from './common.mjs';
import {maintainResources,probePanelLocation} from './maintenance.mjs';
const args=process.argv.slice(2);
if(args.length===1&&args[0]==='--help') {
 console.log('Usage: launch.sh cleanup [--apply]. Preview or remove unused shared dependencies and verified obsolete files from old 0.1.x installations. Apply requires successful smoke --live and a fresh read-only panel-location check. Keeps a prior setup for rollback, cached/pinned releases, running users, Python, project evidence and unknown files. Diagnostic logs are archived before old copies are removed. Host plugin caches are preserved.');
}else {
 if(args.some(a=>a!=='--apply')||args.length>1)throw new Error('Usage: launch.sh cleanup [--apply]');
 await beginUse();
 try {
  const registration=await recordRelease();let panelPath=registration.current.panelPaths?.[0];
  if(args.includes('--apply')) {
   await runtimeReady();
   if(!registration.current.healthy)throw new Error('Run doctor and a successful smoke --live before applying cleanup');
   panelPath=await probePanelLocation();if(panelPath){selectLivePanelPath(panelPath);await recordRelease();}
  }
  const result=await maintainResources({apply:args.includes('--apply'),panelPath});console.log(JSON.stringify(result,null,2));
  if(result.blocked.length||result.migration?.blocked.length)process.exitCode=2;
 }finally{await endUse();}
}
