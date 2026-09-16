import { defineEventHandler } from 'h3'
import { accountMembership } from '../../../lib/platform.mjs'
import { platformUser, platformResult } from '../../utils/platform-api'
export default defineEventHandler(event => platformResult(async () => accountMembership((await platformUser(event)).id)))
