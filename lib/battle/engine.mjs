// Versioned game dispatch. Decks, private lobbies and receipts do not depend on a particular table implementation.
import { ensure } from '../errors.mjs';
import { battleAdapter } from './adapters/index.mjs';
import * as pokemon from './adapters/pokemon-table.mjs';
const tables = Object.freeze({ pokemon });
function table(game, version) {
  battleAdapter(game, version);
  ensure(Object.hasOwn(tables, game), 400, 'This game has no supported battle table.');
  return tables[game];
}
export function newBattle(game, decks, rng) { return table(game).newBattle(game, decks, rng); }
export function applyBattleAction(state, seat, action, rng) { return table(state.game, state.adapter_version).applyBattleAction(state, seat, action, rng); }
export function battleView(state, seat) { return table(state.game, state.adapter_version).battleView(state, seat); }
export { shuffle, SEATS } from './adapters/pokemon-table.mjs';
