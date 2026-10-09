/** Version-dispatched compiler: saved v1 matches retain their original rules. */
import { ARENA_VERSION, LEGACY_ARENA_VERSION, LEGACY_EXPANDED_ARENA_VERSION } from '../../shared/arena.mjs';
import * as core from './cards-v1.mjs';
import * as expanded from './cards-v2.mjs';
import * as current from './cards-v3.mjs';
function compiler(version) {
  if(version===LEGACY_ARENA_VERSION)return core;
  if(version===LEGACY_EXPANDED_ARENA_VERSION)return expanded;
  if(version===ARENA_VERSION)return current;
  throw Error('Unsupported Arena compiler version.');
}
export function compileArenaCard(row,version=ARENA_VERSION){return compiler(version).compileArenaCard(row);}
export function deckValidation(rows,version=ARENA_VERSION){return compiler(version).deckValidation(rows);}
export function attackProgram(attack,version=ARENA_VERSION){return compiler(version).attackProgram(attack);}
export const cardFingerprint=core.cardFingerprint;
