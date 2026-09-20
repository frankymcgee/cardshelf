import { battleResult } from '../../utils/battle-api'
import { defineEventHandler, getRouterParam, getQuery, setHeader } from 'h3'
import { platformUser, platformBody } from '../../utils/platform-api'
import { rateLimit } from '../../../lib/auth.mjs'
import { AppError } from '../../../lib/errors.mjs'
import { battleCards, listDecks, getDeck, saveDeck, deleteDeck } from '../../../lib/battle/decks.mjs'
import { listMatches, getMatch, createMatch, joinMatch, actOnMatch } from '../../../lib/battle/matches.mjs'
export default defineEventHandler(event => battleResult(async () => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  const user = await platformUser(event), path = getRouterParam(event, 'action') || '', method = event.method
  await rateLimit('battle:' + (method === 'GET' ? 'read:' : 'write:') + user.id, method === 'GET' ? 600 : 180)
  if (path === 'cards' && method === 'GET') return battleCards(user.id, getQuery(event))
  if (path === 'decks') {
    if (method === 'GET') return listDecks(user.id)
    if (method === 'POST') return saveDeck(user.id, null, await platformBody(event))
  }
  const deck = path.match(/^decks\/([a-f0-9-]{36})$/i)
  if (deck?.[1]) {
    if (method === 'GET') return getDeck(user.id, deck[1])
    if (method === 'PUT') return saveDeck(user.id, deck[1], await platformBody(event))
    if (method === 'DELETE') return deleteDeck(user.id, deck[1], await platformBody(event))
  }
  if (path === 'matches') {
    if (method === 'GET') return listMatches(user.id)
    if (method === 'POST') { await rateLimit('battle:create:' + user.id, 10); return createMatch(user.id, await platformBody(event)) }
  }
  if (path === 'join' && method === 'POST') { await rateLimit('battle:join:' + user.id, 15); return joinMatch(user.id, await platformBody(event)) }
  const match = path.match(/^matches\/([a-f0-9-]{36})(?:\/(actions))?$/i)
  if (match?.[1]) {
    if (method === 'GET' && !match[2]) return getMatch(user.id, match[1])
    if (method === 'POST' && match[2] === 'actions') return actOnMatch(user.id, match[1], await platformBody(event))
  }
  throw new AppError(404, 'Battle endpoint not found.')
}))
