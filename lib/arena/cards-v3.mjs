/** Same deliberately bounded card pool, stamped for the current rules engine.
 * No unsupported card/effect becomes playable merely by changing the rules date.
 */
import { LEGACY_RULES_ARENA_VERSION as ARENA_VERSION, LEGACY_EXPANDED_ARENA_VERSION } from '../../shared/arena.mjs';
import * as reviewed from './cards-v2.mjs';
export const attackProgram=reviewed.attackProgram;
export function compileArenaCard(row){
  const result=reviewed.compileArenaCard(row);
  return {...result,card:{...result.card,compiler:ARENA_VERSION}};
}
export function deckValidation(rows){
  const compatible=Array.isArray(rows)?rows.map(row=>row?.card?.compiler===ARENA_VERSION?
    {...row,card:{...row.card,compiler:LEGACY_EXPANDED_ARENA_VERSION}}:row):rows;
  const result=reviewed.deckValidation(compatible);
  if(Array.isArray(rows)&&rows.some(row=>row?.card?.compiler!==ARENA_VERSION)){
    return {...result,playable:false,errors:[...result.errors,'Every deck entry must use the current Arena compiler.'],format:ARENA_VERSION};
  }
  return {...result,format:ARENA_VERSION};
}
