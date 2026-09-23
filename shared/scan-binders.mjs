// Shared preview/selection rules. The server checks these again under the binder
// and collection locks before it writes any inventory or checklist changes.
export function scanBinderPockets(binder,printingId) {
  if(!binder||!printingId||binder.game!=='pokemon'||!['collection','tracking'].includes(binder.binder_type))return [];
  const count=binder.rows*binder.columns*binder.page_count;
  if(!Number.isSafeInteger(count)||count<1||count>960)return [];
  const slots=new Map((binder.slots||[]).map(s=>[s.position,s]));
  const tracking=binder.binder_type==='tracking';
  const alreadyPlanned=tracking&&[...slots.values()].some(s=>s.printing_id===printingId);
  return Array.from({length:count},(_,position)=>{
    const slot=slots.get(position);
    if(slot?.printing_id!==printingId&&(slot||alreadyPlanned))return null;
    return {position,existing:!!slot,collected:tracking&&slot?.is_collected===true,
      page:Math.floor(position/(binder.rows*binder.columns))+1,pocket:position%(binder.rows*binder.columns)+1};
  }).filter(p=>p!==null);
}
export function automaticScanPocket(binder,printingId) {
  const pockets=scanBinderPockets(binder,printingId);
  // Reuse a planned pocket even when earlier pages have empty space. Repeated
  // scans can reuse collected pockets without creating duplicate checklist rows.
  return (binder?.binder_type==='tracking'?pockets.find(p=>p.existing&&!p.collected):null)
    ||pockets.find(p=>p.existing)||pockets[0]||null;
}
