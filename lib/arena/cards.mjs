import { compileGameCard, validateGameDeck } from './cards-multigame.mjs';
import { arenaGameForVersion, arenaVersionForGame } from '../../shared/arena-games.mjs';
/** Version-dispatched compiler: saved v1 matches retain their original rules. */
import { ARENA_VERSION, LEGACY_ARENA_VERSION, LEGACY_EXPANDED_ARENA_VERSION, LEGACY_RULES_ARENA_VERSION, LEGACY_EFFECTS_ARENA_VERSION } from '../../shared/arena.mjs';
import * as core from './cards-v1.mjs';
import * as expanded from './cards-v2.mjs';
import * as rules from './cards-v3.mjs';
import * as effects from './cards-v4.mjs';
import * as current from './cards-v5.mjs';
function compiler(version) {
  if(version===LEGACY_ARENA_VERSION)return core;
  if(version===LEGACY_EXPANDED_ARENA_VERSION)return expanded;
  if(version===LEGACY_RULES_ARENA_VERSION)return rules;
  if(version===LEGACY_EFFECTS_ARENA_VERSION)return effects;
  if(version===ARENA_VERSION)return current;
  throw Error('Unsupported Arena compiler version.');
}
export function compileArenaCard(row,version){version??=arenaVersionForGame(row?.game)||ARENA_VERSION;const game=arenaGameForVersion(version);return game&&game!=='pokemon'?compileGameCard(row,game):compiler(version).compileArenaCard(row);}
export function deckValidation(rows,version){version??=rows?.[0]?.card?.compiler||ARENA_VERSION;const game=arenaGameForVersion(version);return game&&game!=='pokemon'?validateGameDeck(rows,game):compiler(version).deckValidation(rows);}
export function attackProgram(attack,version=ARENA_VERSION){return compiler(version).attackProgram(attack);}
export const cardFingerprint=core.cardFingerprint;
