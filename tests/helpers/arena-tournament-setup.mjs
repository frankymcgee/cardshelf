import { cpuAction } from '../../lib/arena/bot.mjs';

// Finish both human opening fields using only their own HTTP projections. Resolve
// the toss first: repeatedly picking one seat's reset_setup can starve the other
// seat's first-player choice and make random opening hands look like a UI failure.
export async function prepareTournamentOpening(players, read, act) {
  for (const player of players) {
    const view = await read(player), first = view.table.legal.find(m => m.action.type === 'first');
    if (first) { await act(player, first.action); break; }
  }
  for (const player of players) {
    let view = await read(player);
    if (!view.table.players[view.seat].active) {
      const place = view.table.legal.find(m => m.action.type === 'setup' && m.action.zone === 'active');
      if (!place) throw Error('Fixture has no legal Active setup.');
      view = await act(player, place.action);
    }
    if (!view.table.players[view.seat].ready) await act(player, { type: 'ready' });
  }
  for (let i = 0; i < 4; i++) {
    const views = await Promise.all(players.map(read)), index = views.findIndex(v => v.table.prompt);
    if (index < 0) {
      if (views.every(v => v.table.phase === 'playing')) return;
      throw Error('Fixture did not finish opening setup.');
    }
    await act(players[index], cpuAction(views[index].table));
  }
  throw Error('Fixture exceeded opening bonus decisions.');
}
