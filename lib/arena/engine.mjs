/** Version-pinned dispatch: saved Core matches continue on the frozen v1 rules. */
import { check } from './input.mjs';
import { ARENA_VERSION, ARENA_VERSIONS, LEGACY_ARENA_VERSION, LEGACY_EXPANDED_ARENA_VERSION, LEGACY_RULES_ARENA_VERSION } from '../../shared/arena.mjs';
import * as core from './engine-v1.mjs';
import * as expanded from './engine-v2.mjs';
import * as rules from './engine-v3.mjs';
import * as current from './engine-v4.mjs';
const engine = version => {
  check(ARENA_VERSIONS.includes(version),'This match needs its original engine version.',409);
  return version===LEGACY_ARENA_VERSION?core:version===LEGACY_EXPANDED_ARENA_VERSION?expanded:version===LEGACY_RULES_ARENA_VERSION?rules:current;
};
export const opponent=expanded.opponent;
export const shuffled=expanded.shuffled;
export const energySatisfied=(unit,cost)=>engine(unit.card?.compiler??ARENA_VERSION).energySatisfied(unit,cost);
export const attackDamage=(attack,attacker,defender,rawDamage=attack.damage,benched=false)=>engine(attacker.card.compiler??ARENA_VERSION).attackDamage(attack,attacker,defender,rawDamage,benched);
export const publicCard=card=>engine(card.compiler).publicCard(card);
export const newArena=(decks,options={})=>engine(options.version??ARENA_VERSION).newArena(decks,options);
export const applyArenaAction=(state,...args)=>engine(state?.version).applyArenaAction(state,...args);
export const legalArenaActions=(state,...args)=>engine(state?.version).legalArenaActions(state,...args);
export const arenaView=(state,...args)=>engine(state?.version).arenaView(state,...args);
export const assertArena=state=>engine(state?.version).assertArena(state);
