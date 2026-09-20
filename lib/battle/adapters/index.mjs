import { ensure } from '../../errors.mjs';
import { pokemonAdapter } from './pokemon.mjs';
const adapters = Object.freeze({ pokemon: pokemonAdapter });
export function battleAdapter(game, version = 1) {
  ensure(Object.hasOwn(adapters, game) && adapters[game].version === version, 400, 'Unsupported battle game or saved adapter version.');
  return adapters[game];
}
