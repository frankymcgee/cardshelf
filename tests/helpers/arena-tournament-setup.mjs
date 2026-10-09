import { cpuAction } from '../../lib/arena/bot.mjs';

// Finish both human opening fields using only their own HTTP projections. Resolve
// the toss first: repeatedly picking one seat's reset_setup can starve the other
// seat's first-player choice and make random opening hands look like a UI failure.
export async function prepareTournamentOpening(players, read, act) {
  for (const player of players) {
    const view = await read(player), first = view.table.legal.find(m => m.action.type === 'first');
    if (first) { await act(player, first.action); break; }
  }
  // V4 postpones a lone mulligan until the other field is locked. Re-read both
  // seats after each action rather than assuming the first seat can place first.
  for (let i = 0; i < 24; i++) {
    const views = await Promise.all(players.map(read));
    if (views.every(v => v.table.phase === 'playing')) return;
    let action, index = views.findIndex(v => v.table.prompt);
    if (index >= 0) action = cpuAction(views[index].table);
    else for (const [seat, view] of views.entries()) {
      const move = view.table.legal.find(m => m.action.type === 'setup' && m.action.zone === 'active')
        || view.table.legal.find(m => m.action.type === 'ready');
      if (move) { index = seat; action = move.action; break; }
    }
    if (!action) throw Error('Fixture did not finish opening setup.');
    await act(players[index], action);
  }
  throw Error('Fixture exceeded opening setup/bonus decisions.');
}
