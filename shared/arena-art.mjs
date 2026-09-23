// Decorative illustrations for the original teaching cards. Catalogue artwork
// remains authoritative; unknown/missing cards never borrow another card's art.
const trainingTiles = new Map([
  ['training:ember-cub', 0], ['training:ember-fox', 1],
  ['training:ember-whelp', 2], ['training:ember-evolution', 3],
  ['training:tide-cub', 4], ['training:tide-fox', 5],
  ['training:tide-whelp', 6], ['training:tide-evolution', 7],
  ['training:potion', 8], ['training:switch', 9],
  ['training:draw', 10], ['training:search', 11],
])
export function arenaTrainingArt(card) {
  const tile = trainingTiles.get(card?.id)
  if (tile === undefined) return undefined
  return { backgroundImage: 'url(/arena/training-art.webp)', backgroundPosition: `${tile % 4 * 100 / 3}% ${Math.floor(tile / 4) * 50}%` }
}
