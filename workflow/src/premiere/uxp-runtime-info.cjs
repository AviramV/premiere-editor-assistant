// Premiere 27 removed premierepro.Application. Never touch that legacy class,
// including as a fallback: Adobe's synchronous UXP host is the version source.
function readHostVersion(uxp) {
 try {
  const value=uxp.host.version;
  if(typeof value==='string'&&/^\d+\.\d+(?:\.\d+){0,2}(?:[-+].*)?$/.test(value))return {version:value,source:'uxp.host.version'};
 }catch{}
 return {version:'unknown',source:'none'};
}

// Read-only provenance for upgrade cleanup. Missing information never authorizes deletion.
async function withRuntimeLocation(uxp,environment) {
 let panelPath=null,panelVersion=null;
 try {
  const fs=uxp.storage.localFileSystem;
  const folder=await fs.getPluginFolder();
  const nativePath=fs.getNativePath(folder);
  if(typeof nativePath==='string'&&nativePath)panelPath=nativePath;
  try {
   const manifest=JSON.parse(await (await folder.getEntry('manifest.json')).read());
   if(manifest.id==='com.premieremcp.agent'&&typeof manifest.version==='string')panelVersion=manifest.version;
  }catch{}
 }catch{}
 return {...environment,panelPath,panelVersion};
}
module.exports={withRuntimeLocation,readHostVersion};
