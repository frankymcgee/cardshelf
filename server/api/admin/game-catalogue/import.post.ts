import { defineEventHandler } from 'h3'
import { platformResult, platformUser, platformBody } from '../../../utils/platform-api'
import { queueGameImport } from '../../../../lib/game-catalogue.mjs'
export default defineEventHandler(event => platformResult(async () => queueGameImport((await platformUser(event, true)).id, await platformBody(event))))
