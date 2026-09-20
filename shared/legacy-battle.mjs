/** Retired routes stay explicit; never infer an arena match ID from a beta ID. */
export function retiredBattleRoute(value) {
  if(typeof value!=='string')return null;
  let path;
  try{path=decodeURIComponent(value.split(/[?#]/,1)[0]).replace(/\/{2,}/g,'/').replace(/\/+$/,'');}catch{return null;}
  if(/[%\\\x00-\x1f]/.test(path))return null;
  const under=root=>path===root||path.startsWith(root+'/');
  if(under('/api/admin/battle'))return {kind:'api',admin:true,to:'/admin/arena'};
  if(under('/api/battle'))return {kind:'api',admin:false,to:'/arena'};
  if(under('/admin/battle'))return {kind:'page',admin:true,to:'/admin/arena'};
  if(under('/battle'))return {kind:'page',admin:false,to:'/arena'};
  return null;
}
