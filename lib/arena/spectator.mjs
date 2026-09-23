import { arenaView } from './engine.mjs';

/** A neutral public projection, never a player view with its hand hidden in CSS. */
export function arenaSpectatorView(state) {
  const views = [arenaView(state, 0), arenaView(state, 1)], view = views[0];
  const players = [0, 1].map(seat => {
    // Take each field from its opponent's view, including unrevealed setup.
    const p = views[1 - seat].players[seat];
    return { active: p.active, bench: p.bench, discard: p.discard, resolving: p.resolving,
      hand: [], hand_count: p.hand_count, deck_count: p.deck_count, prize_count: p.prize_count, ready: p.ready };
  });
  return { version: view.version, game: view.game, mode: view.mode, phase: view.phase,
    seat: 0, round: view.round, turn: view.turn, turn_number: view.turn_number, players,
    ...(view.stadium !== undefined ? { stadium: view.stadium } : {}),
    result: view.result, result_reason: view.result_reason, waiting_for: view.waiting_for,
    legal: [], prompt: null, attack_blocks: [],
    events: view.events.map(e => Object.fromEntries(['n', 'seat', 'kind', 'text', 'revealed', 'card',
      'attacker', 'target', 'damage', 'attack', 'heads', 'turn'].filter(key => Object.hasOwn(e, key)).map(key => [key, e[key]]))) };
}
