/** Pure bracket layout. The server supplies crypto.randomInt for the draw. */
export function seedTournament(ids, randomInt) {
  if (!Array.isArray(ids) || ids.length < 2 || ids.length > 64 || new Set(ids).size !== ids.length) throw Error('A tournament needs 2–64 distinct entrants.');
  const shuffled = [...ids];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    if (!Number.isInteger(j) || j < 0 || j > i) throw Error('Invalid random draw.');
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const size = 2 ** Math.ceil(Math.log2(ids.length));
  let order = [1, 2];
  while (order.length < size) { const next = order.length * 2 + 1; order = order.flatMap(seed => [seed, next - seed]); }
  return { size, seeds: shuffled, pairs: Array.from({ length: size / 2 }, (_, i) => [shuffled[order[i * 2] - 1] || null, shuffled[order[i * 2 + 1] - 1] || null]) };
}
export function tournamentRoundName(round, size) {
  const remaining = size / (2 ** (round - 1));
  return remaining === 2 ? 'Final' : remaining === 4 ? 'Semifinals' : remaining === 8 ? 'Quarterfinals' : `Round of ${remaining}`;
}
