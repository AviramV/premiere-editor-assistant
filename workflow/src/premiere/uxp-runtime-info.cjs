// Read-only provenance for upgrade cleanup. Missing information never authorizes deletion.
async function withRuntimeLocation(uxp,environment) {
 try {
  const fs=uxp.storage.localFileSystem;
  const folder=await fs.getPluginFolder();
  const panelPath=fs.getNativePath(folder);
  if(typeof panelPath!=='string'||!panelPath)throw new Error('Panel path unavailable');
  return {...environment,panelPath};
 }catch{return {...environment,panelPath:null};}
}
module.exports={withRuntimeLocation};
