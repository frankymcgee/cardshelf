import { battleResult } from '../../utils/battle-api'
import { defineEventHandler, setHeader, getRouterParam, getQuery } from 'h3'
import { platformUser, platformBody } from '../../utils/platform-api'
import { rateLimit } from '../../../lib/auth.mjs'
import { AppError } from '../../../lib/errors.mjs'
import { arenaAccess } from '../../../lib/arena/access.mjs'
import { arenaCatalogue, arenaDeckList, arenaDeckView, saveArenaDeck, deleteArenaDeck, legacyArenaDeck } from '../../../lib/arena/decks.mjs'
import { arenaCatalogueFilters, previewArenaImport } from '../../../lib/arena/workshop.mjs'
import { arenaMatchList, getArenaMatch, createArenaMatch, joinArenaMatch, actArenaMatch } from '../../../lib/arena/matches.mjs'
import { arenaTournamentList, getArenaTournament, createArenaTournament, actArenaTournament, spectateArenaTournament } from '../../../lib/arena/tournaments.mjs'
export default defineEventHandler(event => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  setHeader(event, 'Vary', 'Cookie')
  return battleResult(async () => {
  const user = await platformUser(event)
  const parts = (getRouterParam(event, 'action') || '').split('/').filter(Boolean)
  const path = parts.join('/'), method = event.method
  // Existing rateLimit windows are fifteen minutes. Visible table polling uses ~450 reads.
  await rateLimit('arena-' + (method === 'GET' ? 'read:' : 'write:') + user.id, method === 'GET' ? 5000 : 2000)
  if (path === 'status' && method === 'GET') return arenaAccess(user.id)
  if (path === 'tournaments' && method === 'GET') return arenaTournamentList(user.id)
  if (path === 'tournaments' && method === 'POST') return createArenaTournament(user.id, await platformBody(event))
  if (parts[0] === 'tournaments' && parts.length === 2 && method === 'GET') return getArenaTournament(user.id, parts[1])
  if (parts[0] === 'tournaments' && parts.length === 3 && parts[2] === 'actions' && method === 'POST') {
    await rateLimit('arena-tournament:' + user.id, 300)
    return actArenaTournament(user.id, parts[1], await platformBody(event))
  }
  if (parts[0] === 'tournaments' && parts.length === 4 && parts[2] === 'spectate' && method === 'GET') return spectateArenaTournament(user.id, parts[1], parts[3])
  if (path === 'catalogue' && method === 'GET') return arenaCatalogue(user.id, getQuery(event))
  if (path === 'catalogue/filters' && method === 'GET') return arenaCatalogueFilters(user.id)
  if (path === 'decks/preview-import' && method === 'POST') {
    await rateLimit('arena-import:' + user.id, 100)
    return previewArenaImport(user.id, await platformBody(event, 65536))
  }
  if (path === 'decks' && method === 'GET') return arenaDeckList(user.id)
  if (path === 'decks' && method === 'POST') return saveArenaDeck(user.id, null, await platformBody(event))
  if (parts[0] === 'decks' && parts.length === 2) {
    if (method === 'GET') return arenaDeckView(user.id, parts[1])
    if (method === 'PUT') return saveArenaDeck(user.id, parts[1], await platformBody(event))
    if (method === 'DELETE') return deleteArenaDeck(user.id, parts[1], await platformBody(event))
  }
  if (parts[0] === 'legacy' && parts.length === 2 && method === 'GET') return legacyArenaDeck(user.id, parts[1])
  if (path === 'matches' && method === 'GET') return arenaMatchList(user.id)
  if (path === 'matches' && method === 'POST') return createArenaMatch(user.id, await platformBody(event))
  if (path === 'join' && method === 'POST') {
    await rateLimit('arena-invite:' + user.id, 30)
    return joinArenaMatch(user.id, await platformBody(event))
  }
  if (parts[0] === 'matches' && parts.length === 2 && method === 'GET') return getArenaMatch(user.id, parts[1])
  if (parts[0] === 'matches' && parts[2] === 'actions' && parts.length === 3 && method === 'POST') return actArenaMatch(user.id, parts[1], await platformBody(event))
  throw new AppError(404, 'Arena endpoint not found.')
  })
})
