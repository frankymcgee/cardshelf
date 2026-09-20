// UI vocabulary only. Server adapters are authoritative; these constants grant no access.
export const BATTLE_GAMES = Object.freeze([{ code: 'pokemon', name: 'Pokémon', mode: 'Assisted casual tabletop' }]);
export const BATTLE_ZONES = Object.freeze([
  { code: 'active', label: 'Active Pokémon' }, { code: 'bench', label: 'Bench' },
  { code: 'stadium', label: 'Stadium / resolving cards' }, { code: 'hand', label: 'Your hand' },
  { code: 'discard', label: 'Discard pile' }, { code: 'lost', label: 'Lost Zone' }
]);
export const BATTLE_CONDITIONS = Object.freeze(['asleep', 'confused', 'paralyzed', 'poisoned', 'burned']);
export const BATTLE_DISCLAIMER = 'Assisted casual play: you and your opponent resolve card effects, attacks, turn restrictions and wins. This is not a tournament legality checker or an automated rules engine.';
export function battleConflict(error) { return [error?.status, error?.statusCode, error?.response?.status].includes(409); }
